import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

const resend = new Resend(process.env.RESEND_API_KEY!)

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Get the authenticated user from the session cookie
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find property by claim token
  const { data: property, error: fetchErr } = await supabaseAdmin
    .from('properties')
    .select('id, slug, name, owner_id, is_claimable, claim_token')
    .eq('claim_token', token)
    .single()

  if (fetchErr || !property) {
    return Response.json({ error: 'Claim link not found' }, { status: 404 })
  }

  if (!property.is_claimable || property.owner_id !== null) {
    return Response.json({ error: 'This listing has already been claimed' }, { status: 409 })
  }

  // Assign the listing to this user
  const { error: updateErr } = await supabaseAdmin
    .from('properties')
    .update({
      owner_id: user.id,
      is_claimable: false,
      claim_token: null,
    })
    .eq('id', property.id)

  if (updateErr) {
    return Response.json({ error: 'Failed to claim listing' }, { status: 500 })
  }

  // Upgrade user profile to landlord role if not already
  await supabaseAdmin
    .from('profiles')
    .update({ role: 'landlord' })
    .eq('id', user.id)

  // Notify admin of the claim
  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail) {
    const siteUrl = getSiteUrl()
    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/Phoenix', month: 'short', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    try {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: adminEmail,
        subject: `[Claim] ${property.name} was just claimed`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:12px 12px 0 0;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:18px;font-weight:700;color:#fff;">Home<em style="color:#FFC627;font-style:italic;">Hive</em></span>
    <span style="font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#4ade80;background:rgba(74,222,128,0.15);padding:4px 10px;border-radius:12px;border:1px solid rgba(74,222,128,0.3);">🏠 Listing Claimed</span>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
    <p style="margin:0 0 18px;font-size:15px;font-weight:700;color:#1a1a1a;">A landlord just claimed a listing.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:7px 0;color:#6b6b6b;width:110px;border-bottom:1px solid #f4f1eb;">Listing</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f4f1eb;">${property.name}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">User ID</td><td style="padding:7px 0;font-size:12px;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">${user.id}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">User email</td><td style="padding:7px 0;border-bottom:1px solid #f4f1eb;"><a href="mailto:${user.email}" style="color:#8C1D40;text-decoration:none;">${user.email}</a></td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;">Claimed at</td><td style="padding:7px 0;">${now} MST</td></tr>
    </table>
    <div style="margin-top:20px;">
      <a href="${siteUrl}/admin/properties" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">View properties →</a>
    </div>
  </div>
</div>
</body>
</html>`,
      })
      await logEmail('', 'admin_claim_notify', `[Claim] ${property.name} was just claimed`, adminEmail, {
        propertySlug: property.slug, propertyName: property.name, userId: user.id, userEmail: user.email,
      })
    } catch (_) {}
  }

  return Response.json({ ok: true, slug: property.slug, name: property.name })
}
