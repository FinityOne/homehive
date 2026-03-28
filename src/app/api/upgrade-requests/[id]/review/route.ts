import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { action, note } = await req.json() as { action: 'approve' | 'reject'; note?: string }

  // Fetch the request
  const { data: request, error: fetchErr } = await supabaseAdmin
    .from('upgrade_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !request) {
    return Response.json({ error: 'Request not found' }, { status: 404 })
  }

  // Update the request status
  const { error: updateErr } = await supabaseAdmin
    .from('upgrade_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'rejected',
      admin_note: note?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateErr) {
    return Response.json({ error: 'Failed to update request' }, { status: 500 })
  }

  // If approved, upgrade the user's role to landlord
  if (action === 'approve') {
    await supabaseAdmin
      .from('profiles')
      .update({ role: 'landlord' })
      .eq('id', request.user_id)
  }

  // Send email to the user
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const firstName = (request.full_name || '').trim().split(' ')[0] || 'there'

  try {
    if (action === 'approve') {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: request.email,
        subject: `You're approved as a landlord on HomeHive! 🎉`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>

  <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#166534;margin-bottom:4px;">🎉 Landlord Access Approved</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">Welcome to the landlord side!</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${firstName}, you're in! 🎉</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      Your request for landlord access has been approved. You can now create and manage listings, receive qualified leads from students, and track everything from your landlord dashboard.
    </p>
    <div style="background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">What you can do now</div>
      ${['Create and list your property for free', 'Receive pre-screened tenant inquiries', 'Manage leads and tours from your dashboard', 'Access your landlord portal anytime'].map(s => `<div style="display:flex;align-items:flex-start;gap:10px;font-size:13px;color:#3a3a3a;margin-bottom:8px;"><div style="width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">✓</div>${s}</div>`).join('')}
    </div>
    <div style="text-align:center;margin-bottom:20px;">
      <a href="${siteUrl}/landlord/dashboard" style="display:inline-block;background:linear-gradient(135deg,#0f766e,#10b981);color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">Go to Landlord Dashboard →</a>
    </div>
    ${note?.trim() ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#166534;line-height:1.5;"><strong>Note from our team:</strong> ${note.trim()}</div>` : ''}
    <p style="margin:0;font-size:13px;color:#9b9b9b;">Questions? <a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a></p>
  </div>
</div>
</body>
</html>`,
      })
    } else {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: request.email,
        subject: `Update on your landlord access request`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>

  <div style="background:#fff1f2;border-left:4px solid #9f1239;padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9f1239;margin-bottom:4px;">Request Not Approved</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">Landlord access request</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hi ${firstName}, thanks for applying.</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 16px;">
      We reviewed your landlord access request and weren't able to approve it at this time.
    </p>
    ${note?.trim() ? `<div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px 16px;margin-bottom:20px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9f1239;margin-bottom:6px;">Reason from our team</div><p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.6;">${note.trim()}</p></div>` : ''}
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 24px;">
      If you have questions or would like to discuss, please reach out — we're happy to help.
    </p>
    <div style="text-align:center;margin-bottom:20px;">
      <a href="mailto:hello@homehive.live?subject=Landlord access request follow-up" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">Contact Us →</a>
    </div>
    <p style="margin:0;font-size:13px;color:#9b9b9b;"><a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a></p>
  </div>
</div>
</body>
</html>`,
      })
    }
  } catch (_) {}

  return Response.json({ ok: true })
}
