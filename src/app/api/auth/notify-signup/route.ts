import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: Request) {
  const { name, email, role } = await req.json()

  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) return Response.json({ ok: true }) // silently skip if not configured

  const roleLabel = role === 'landlord' ? 'Landlord' : 'Student / Renter'
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Phoenix',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: adminEmail,
      subject: `New account: ${name} (${roleLabel})`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:12px 12px 0 0;padding:18px 24px;">
    <span style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.2px;">
      Home<em style="color:#FFC627;font-style:italic;">Hive</em>
    </span>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px;padding:28px 24px;">
    <div style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px;">New Signup</div>
    <p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#1a1a1a;">A new user just joined HomeHive.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f5f4f0;width:100px;">Name</td>
        <td style="padding:8px 0;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f5f4f0;">${name}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f5f4f0;">Email</td>
        <td style="padding:8px 0;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f5f4f0;">${email}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f5f4f0;">Role</td>
        <td style="padding:8px 0;border-bottom:1px solid #f5f4f0;">
          <span style="background:${role === 'landlord' ? '#eff6ff' : '#fdf2f5'};color:${role === 'landlord' ? '#1d4ed8' : '#8C1D40'};padding:2px 9px;border-radius:4px;font-size:12px;font-weight:600;">${roleLabel}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#6b6b6b;">Signed up</td>
        <td style="padding:8px 0;color:#1a1a1a;">${now} MST</td>
      </tr>
    </table>
    <div style="margin-top:24px;">
      <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'}/admin/users" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">View in admin →</a>
    </div>
  </div>
</div>
</body>
</html>`,
    })
    await logEmail('', 'admin_new_signup', `New account: ${name} (${roleLabel})`, adminEmail, { userEmail: email, role })
  } catch (_) {
    // Don't fail the signup flow if the email fails
  }

  return Response.json({ ok: true })
}
