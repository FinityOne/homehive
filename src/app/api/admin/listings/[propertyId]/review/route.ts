import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'
import { sendListingLiveEmail } from '@/lib/listingEmails'
import { getPlatformStats } from '@/lib/platformStats'
import { computeIsActive, type ListingStatus } from '@/lib/listingStatus'

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
    .select('id, name, slug, owner_id, listing_status, show_when_rented, owner_plan_active')
    .eq('id', propertyId)
    .single()

  if (propErr || !property) {
    return Response.json({ error: 'Property not found' }, { status: 404 })
  }

  // Update status
  const adminStatus = action === 'approve' ? 'active' : 'rejected'
  // Approving must not override the landlord's own status. Forcing `is_active`
  // true here used to republish a home the landlord had marked Rented or
  // Inactive, so it is derived from both axes instead — the same rule
  // computeIsActive applies everywhere else.
  const { error: updateErr } = await supabase
    .from('properties')
    .update({
      admin_status: adminStatus,
      is_active: computeIsActive({
        listing_status: (property.listing_status ?? 'active') as ListingStatus,
        show_when_rented: property.show_when_rented ?? false,
        admin_status: adminStatus,
      }),
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

  if (landlordEmail) {
    if (action === 'approve') {
      // One shared template, two truths. A listing only reaches students while
      // its landlord is paying, so an approved listing whose owner has no plan
      // is not "live" and must not be described that way — the needs_plan
      // version tells them it is ready and what publishing it takes.
      const stats = await getPlatformStats(supabase)
      await sendListingLiveEmail({
        to: landlordEmail,
        propertyName: property.name,
        propertySlug: property.slug,
        state: property.owner_plan_active ? 'live' : 'needs_plan',
        stats,
      })
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
