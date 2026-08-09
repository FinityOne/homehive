import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

// Throttle limits (anti inbox-bombing)
const MIN_GAP_SECONDS = 30   // no more than one code every 30s per email
const MAX_PER_HOUR    = 6    // hard cap per email per hour

type Mode = 'login' | 'signup'

// The code length we design for. Supabase's Auth "Email OTP Length" setting is
// the source of truth for what generateLink actually returns.
const EXPECTED_CODE_LENGTH = 6

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const mode: Mode = body.mode === 'signup' ? 'signup' : 'login'
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const role = body.role === 'landlord' ? 'landlord' : 'tenant'
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''

  if (!email || !isValidEmail(email)) {
    return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }
  if (mode === 'signup' && !name) {
    return Response.json({ error: 'Please enter your name.' }, { status: 400 })
  }

  // ── Throttle ──────────────────────────────────────────────────────────────
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabaseAdmin
    .from('auth_code_sends')
    .select('created_at')
    .eq('email', email)
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false })

  if (recent && recent.length > 0) {
    const lastMs = Date.now() - new Date(recent[0].created_at).getTime()
    if (lastMs < MIN_GAP_SECONDS * 1000) {
      const wait = Math.ceil((MIN_GAP_SECONDS * 1000 - lastMs) / 1000)
      return Response.json(
        { error: `Please wait ${wait}s before requesting another code.` },
        { status: 429 }
      )
    }
    if (recent.length >= MAX_PER_HOUR) {
      return Response.json(
        { error: 'Too many code requests. Please try again later.' },
        { status: 429 }
      )
    }
  }

  // ── Ensure the account exists for the given mode ────────────────────────────
  if (mode === 'signup') {
    // Create the user (passwordless, unconfirmed). The handle_new_user trigger
    // provisions the profiles row from this metadata.
    const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: {
        full_name: name,
        role,
        ...(phone ? { phone } : {}),
      },
    })

    if (createErr) {
      const msg = (createErr.message || '').toLowerCase()
      const isDuplicate =
        msg.includes('already') ||
        msg.includes('registered') ||
        msg.includes('exists') ||
        createErr.status === 422
      if (isDuplicate) {
        return Response.json({ error: 'exists' }, { status: 409 })
      }
      return Response.json({ error: 'Could not start sign up. Please try again.' }, { status: 500 })
    }
  }

  // ── Generate the code via Supabase's native OTP ─────────────────────────────
  // For both login and (freshly created) signup users we mint a magic-link OTP
  // and pull out the code to deliver ourselves via Resend. The length comes from
  // the project's Auth "Email OTP Length" setting (we want 6) — we report the
  // actual length back to the client so the input can never be shorter than the
  // code we emailed, even if that setting drifts.
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  const code = linkData?.properties?.email_otp

  // On login for a non-existent account we must not reveal that — record the
  // attempt and return ok without sending anything (mirrors forgot-password).
  if (linkErr || !code) {
    await supabaseAdmin.from('auth_code_sends').insert({ email, ip: clientIp(req), mode })
    return Response.json({ ok: true })
  }

  if (code.length !== EXPECTED_CODE_LENGTH) {
    console.warn(
      `[send-code] Supabase returned a ${code.length}-digit OTP; expected ${EXPECTED_CODE_LENGTH}. ` +
      `Set Auth → Email → "Email OTP Length" to ${EXPECTED_CODE_LENGTH} in the Supabase dashboard.`
    )
  }

  // ── Send the code ───────────────────────────────────────────────────────────
  await resend.emails.send({
    from: 'HomeHive <hello@homehive.live>',
    to: email,
    subject: `${code} is your HomeHive sign-in code`,
    html: codeEmailHtml(code, mode),
  })

  await supabaseAdmin.from('auth_code_sends').insert({ email, ip: clientIp(req), mode })

  return Response.json({ ok: true, codeLength: code.length })
}

function codeEmailHtml(code: string, mode: Mode): string {
  const heading = mode === 'signup' ? 'Confirm your email' : 'Your sign-in code'
  const intro =
    mode === 'signup'
      ? 'Welcome to HomeHive! Enter the code below to confirm your email and finish creating your account.'
      : 'Use the code below to sign in to your HomeHive account.'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>

  <!-- Card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">

    <div style="font-size:22px;font-weight:300;color:#1a1a1a;margin-bottom:8px;letter-spacing:-0.3px;">
      ${heading}
    </div>
    <div style="font-size:14px;color:#6b6b6b;line-height:1.6;margin-bottom:26px;">
      ${intro}
    </div>

    <!-- Code -->
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:10px;">
        Your code
      </div>
      <div style="display:inline-block;background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:18px 28px;">
        <span style="font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:38px;font-weight:700;letter-spacing:10px;color:#1a1a1a;padding-left:10px;">${code}</span>
      </div>
    </div>

    <!-- Expiry note -->
    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:10px;padding:14px 16px;font-size:13px;color:#6b6b6b;line-height:1.5;">
      ⏱ This code expires in <strong style="color:#1a1a1a;">1 hour</strong> and can only be used once.
      If you didn't request this, you can safely ignore this email.
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>

</div>
</body>
</html>`
}
