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
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { ownerId, propertyName, propertyId } = await req.json() as {
    ownerId: string
    propertyName: string
    propertyId: string
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const reviewUrl = `${siteUrl}/admin/properties/review/${propertyId}`

  // Fetch landlord email
  let landlordEmail = ''
  try {
    const { data: { user } } = await supabase.auth.admin.getUserById(ownerId)
    landlordEmail = user?.email || ''
  } catch (_) {}

  // 1. Email landlord — listing under review
  if (landlordEmail) {
    try {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: landlordEmail,
        subject: `Your listing "${propertyName}" is under review`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:12px;color:#9b9b9b;margin-top:4px;">Landlord Platform</div>
  </div>

  <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#92400e;margin-bottom:4px;">Under Review</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${propertyName}</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your listing has been submitted! 🎉</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      We've received your listing and it's now in our review queue. Our team manually verifies every listing on HomeHive to ensure:
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">
      ${['No scams or fraudulent listings', 'Accurate property information', 'A safe, trusted experience for students'].map(item => `
      <div style="display:flex;align-items:center;gap:10px;font-size:13px;color:#3a3a3a;">
        <div style="width:18px;height:18px;border-radius:50%;background:#FFC627;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#1a1a1a;flex-shrink:0;">✓</div>
        ${item}
      </div>`).join('')}
    </div>
    <div style="background:#fdf2f5;border:1px solid #f4c9d5;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
      <div style="font-size:13px;color:#8C1D40;font-weight:600;margin-bottom:4px;">⏱ What to expect</div>
      <p style="margin:0;font-size:13px;color:#3a3a3a;line-height:1.6;">
        Reviews are typically completed within <strong>24 hours</strong>. You'll receive an email as soon as your listing is approved or if we need any changes.
      </p>
    </div>
    <p style="margin:0;font-size:13px;color:#9b9b9b;">
      Questions? Reach us at <a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a>
    </p>
  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · Tempe, AZ
  </div>
</div>
</body>
</html>`,
      })
      await logEmail('', 'listing_submitted', `Your listing "${propertyName}" is under review`, landlordEmail, { propertySlug: slug })
    } catch (_) {}
  }

  // 2. Email admin — new listing to review
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: process.env.ADMIN_EMAIL!,
      subject: `New listing pending review: ${propertyName}`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:700;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,198,39,0.3);">📋 Review Needed</div>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:24px 28px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8C1D40;margin-bottom:8px;">New Listing Submitted</div>
    <div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${propertyName}</div>
    <div style="font-size:13px;color:#9b9b9b;margin-bottom:20px;">Slug: <code style="background:#f5f4f0;padding:2px 6px;border-radius:4px;">${slug}</code></div>
    <div style="font-size:13px;color:#4a4a4a;margin-bottom:8px;">Owner ID: <code style="background:#f5f4f0;padding:2px 6px;border-radius:4px;font-size:11px;">${ownerId}</code></div>
    <div style="margin-top:20px;text-align:center;">
      <a href="${reviewUrl}" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">Review Listing →</a>
    </div>
  </div>
</div>
</body>
</html>`,
    })
    await logEmail('', 'listing_submitted', `New listing pending review: ${propertyName}`, process.env.ADMIN_EMAIL!, { propertySlug: slug })
  } catch (_) {}

  return Response.json({ ok: true })
}
