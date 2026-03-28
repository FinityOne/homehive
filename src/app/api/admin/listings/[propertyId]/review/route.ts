import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const { propertyId } = await params
  const { action, note } = await req.json() as { action: 'approve' | 'reject'; note?: string }

  // Fetch the property
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select('id, name, slug, owner_id')
    .eq('id', propertyId)
    .single()

  if (propErr || !property) {
    return Response.json({ error: 'Property not found' }, { status: 404 })
  }

  // Update status
  const adminStatus = action === 'approve' ? 'active' : 'rejected'
  const { error: updateErr } = await supabase
    .from('properties')
    .update({
      admin_status: adminStatus,
      is_active: adminStatus === 'active',
      is_test: false,
      ...(note !== undefined ? { review_note: note || null } : { review_note: null }),
    })
    .eq('id', propertyId)

  if (updateErr) {
    return Response.json({ error: 'Failed to update status' }, { status: 500 })
  }

  // Fetch landlord email
  let landlordEmail = ''
  try {
    const { data: { user } } = await supabase.auth.admin.getUserById(property.owner_id)
    landlordEmail = user?.email || ''
  } catch (_) {}

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const listingUrl = `${siteUrl}/landlord/listings/${property.slug}`

  if (landlordEmail) {
    if (action === 'approve') {
      try {
        await resend.emails.send({
          from: 'HomeHive <hello@homehive.live>',
          to: landlordEmail,
          subject: `Your listing "${property.name}" is approved and live! 🎉`,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>

  <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#166534;margin-bottom:4px;">✓ Approved &amp; Live</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${property.name}</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your listing is live! 🎉</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 24px;">
      <strong>${property.name}</strong> has been approved and is now visible to students on HomeHive. Leads will start coming in as students discover your listing.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${listingUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c002a,#8c1d40);color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">View Your Listing →</a>
    </div>
    <p style="margin:0;font-size:13px;color:#9b9b9b;">
      Questions? <a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a>
    </p>
  </div>
</div>
</body>
</html>`,
        })
        await logEmail('', 'listing_approved', `Your listing "${property.name}" is approved and live!`, landlordEmail, { propertySlug: property.slug })
      } catch (_) {}
    } else {
      try {
        await resend.emails.send({
          from: 'HomeHive <hello@homehive.live>',
          to: landlordEmail,
          subject: `Update on your listing "${property.name}"`,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>

  <div style="background:#fff1f2;border-left:4px solid #9f1239;padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9f1239;margin-bottom:4px;">Not Approved</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${property.name}</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your listing wasn't approved this time.</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 16px;">
      After reviewing <strong>${property.name}</strong>, our team was unable to approve it at this time.
    </p>
    ${note ? `
    <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9f1239;margin-bottom:6px;">Reason</div>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.6;">${note}</p>
    </div>` : ''}
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 24px;">
      Please reach out to us and we'll help you get your listing approved as quickly as possible.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="mailto:hello@homehive.live?subject=Listing review: ${encodeURIComponent(property.name)}" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">Contact Us →</a>
    </div>
    <p style="margin:0;font-size:13px;color:#9b9b9b;">
      <a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a> · +1 (949) 867-0499
    </p>
  </div>
</div>
</body>
</html>`,
        })
        await logEmail('', 'listing_rejected', `Update on your listing "${property.name}"`, landlordEmail, { propertySlug: property.slug, note })
      } catch (_) {}
    }
  }

  return Response.json({ ok: true })
}
