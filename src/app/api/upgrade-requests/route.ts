import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { Resend } from 'resend'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

// ── POST — Tenant submits a landlord upgrade request ──────────────────────────
export async function POST(req: Request) {
  const { message } = await req.json()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Check for existing pending or approved request
  const { data: existing } = await supabaseAdmin
    .from('upgrade_requests')
    .select('id, status')
    .eq('user_id', user.id)
    .not('status', 'eq', 'rejected')
    .maybeSingle()

  if (existing) {
    return Response.json({ error: 'Request already exists', status: existing.status }, { status: 409 })
  }

  // Get name from profiles
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  const fullName = profile?.full_name || user.user_metadata?.full_name || user.email || ''

  const { data: request, error } = await supabaseAdmin
    .from('upgrade_requests')
    .insert({
      user_id: user.id,
      email: user.email,
      full_name: fullName,
      message: message?.trim() || null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: 'Failed to create request', detail: error.message }, { status: 500 })

  // Notify admin
  const adminEmail = process.env.ADMIN_EMAIL
  const siteUrl = getSiteUrl()

  if (adminEmail) {
    try {
      const now = new Date().toLocaleString('en-US', {
        timeZone: 'America/Phoenix', month: 'short', day: 'numeric',
        year: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: adminEmail,
        subject: `Landlord access request from ${fullName}`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:12px 12px 0 0;padding:18px 24px;">
    <span style="font-size:18px;font-weight:700;color:#fff;">Home<em style="color:#FFC627;font-style:italic;">Hive</em></span>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px;padding:28px 24px;">
    <div style="display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px;">Landlord Upgrade Request</div>
    <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#1a1a1a;">A tenant is requesting landlord access.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f5f4f0;width:100px;">Name</td><td style="padding:8px 0;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f5f4f0;">${fullName}</td></tr>
      <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f5f4f0;">Email</td><td style="padding:8px 0;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f5f4f0;">${user.email}</td></tr>
      <tr><td style="padding:8px 0;color:#6b6b6b;">Submitted</td><td style="padding:8px 0;color:#1a1a1a;">${now} MST</td></tr>
    </table>
    ${message?.trim() ? `<div style="margin-top:16px;background:#faf9f6;border:1px solid #e8e4db;border-radius:8px;padding:12px 16px;font-size:14px;color:#3a3a3a;line-height:1.6;"><div style="font-size:11px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Message</div>${message.trim()}</div>` : ''}
    <div style="margin-top:24px;">
      <a href="${siteUrl}/admin/upgrade-requests" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">Review in admin →</a>
    </div>
  </div>
</div>
</body>
</html>`,
      })
    } catch (_) {}
  }

  return Response.json({ ok: true, id: request.id })
}

// ── GET — Admin lists all upgrade requests ────────────────────────────────────
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('upgrade_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: 'Failed to fetch' }, { status: 500 })
  return Response.json(data ?? [])
}
