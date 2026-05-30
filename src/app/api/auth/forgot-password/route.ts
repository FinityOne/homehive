import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)
const SITE_URL = getSiteUrl()

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}))
  if (!email || typeof email !== 'string') {
    return Response.json({ error: 'Email required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: email.trim().toLowerCase(),
    options: { redirectTo: `${SITE_URL}/auth/callback?next=/reset-password` },
  })

  // Always return ok — never reveal whether an email exists
  if (error || !data?.properties?.action_link) {
    return Response.json({ ok: true })
  }

  const resetUrl = data.properties.action_link

  await resend.emails.send({
    from: 'HomeHive <hello@homehive.live>',
    to: email,
    subject: 'Reset your HomeHive password',
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,198,39,0.3);">
      🔑 Password Reset
    </div>
  </div>

  <!-- Card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">

    <div style="font-size:22px;font-weight:300;color:#1a1a1a;margin-bottom:8px;letter-spacing:-0.3px;">
      Reset your password
    </div>
    <div style="font-size:14px;color:#6b6b6b;line-height:1.6;margin-bottom:28px;">
      We received a request to reset the password for your HomeHive account
      (<strong style="color:#1a1a1a;">${email}</strong>).
      Click the button below to choose a new password.
    </div>

    <!-- CTA button -->
    <div style="text-align:center;margin-bottom:28px;">
      <a href="${resetUrl}"
        style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.1px;">
        Set new password →
      </a>
    </div>

    <!-- Expiry note -->
    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:10px;padding:14px 16px;font-size:13px;color:#6b6b6b;line-height:1.5;">
      ⏱ This link expires in <strong style="color:#1a1a1a;">1 hour</strong>.
      If you didn't request a password reset, you can safely ignore this email — your account won't be changed.
    </div>

    <!-- Fallback link -->
    <div style="margin-top:20px;font-size:12px;color:#9b9b9b;line-height:1.6;">
      If the button above doesn't work, copy and paste this link into your browser:<br/>
      <a href="${resetUrl}" style="color:#8C1D40;word-break:break-all;">${resetUrl}</a>
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>

</div>
</body>
</html>`,
  })

  return Response.json({ ok: true })
}
