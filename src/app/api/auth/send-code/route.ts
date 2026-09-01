import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
const RESEND_API_KEY = process.env.RESEND_API_KEY
const resend = new Resend(RESEND_API_KEY)

// Throttle limits (anti inbox-bombing)
const MIN_GAP_SECONDS = 30   // no more than one code every 30s per email
const MAX_PER_HOUR    = 6    // hard cap per email per hour

type Mode = 'login' | 'signup'

// The code length we design for. Supabase's Auth "Email OTP Length" setting is
// the source of truth for what generateLink actually returns.
const EXPECTED_CODE_LENGTH = 6

// Must be an address on a domain verified in Resend, or every send 403s.
const EMAIL_FROM = 'HomeHive <hello@homehive.live>'

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
  // On login, generateLink('magiclink') *creates* the account when the address
  // is unknown, which would both mint accounts from typos and mail a code to
  // whoever owns that address. Look the user up first and stay silent instead.
  let recipient = email
  if (mode === 'login') {
    const existing = await findUserByEmail(email)
    if (!existing) {
      await supabaseAdmin.from('auth_code_sends').insert({ email, ip: clientIp(req), mode })
      return Response.json({ ok: true })
    }
    // Address the email to the account's stored address, so the code can only
    // ever reach the user it belongs to.
    recipient = existing
  }

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
  // Anything *else* going wrong is a real failure: it must be logged and
  // surfaced, never disguised as a delivered code.
  if (linkErr || !code) {
    if (isUnknownUserError(linkErr)) {
      // Record it so an unknown address is rate-limited exactly like a real one.
      await supabaseAdmin.from('auth_code_sends').insert({ email, ip: clientIp(req), mode })
      return Response.json({ ok: true })
    }

    console.error('[send-code] generateLink failed', {
      mode,
      status: linkErr?.status,
      code: linkErr?.code,
      message: linkErr?.message || 'no email_otp returned',
    })
    return Response.json(
      { error: 'We could not send your code right now. Please try again in a moment.' },
      { status: 502 }
    )
  }

  // The code must be exactly six digits. Supabase's "Email OTP Length" setting
  // is the only thing that controls this, so a mismatch is a project
  // misconfiguration we surface loudly rather than paper over.
  if (!/^\d+$/.test(code) || code.length !== EXPECTED_CODE_LENGTH) {
    console.error(
      `[send-code] Supabase returned "${code.length} char" OTP (digits only: ${/^\d+$/.test(code)}); ` +
      `expected ${EXPECTED_CODE_LENGTH} digits. ` +
      `Set Auth → Email → "Email OTP Length" to ${EXPECTED_CODE_LENGTH} in the Supabase dashboard.`
    )
  }

  // ── Send the code ───────────────────────────────────────────────────────────
  // The Resend SDK resolves with `{ error }` instead of throwing, so an
  // unchecked call silently drops the email while the UI says "code sent".
  if (!RESEND_API_KEY) {
    console.error('[send-code] RESEND_API_KEY is not set — no sign-in code can be delivered.')
    return Response.json(
      { error: 'Email delivery is not configured. Please contact support.' },
      { status: 500 }
    )
  }

  let sendResult
  try {
    sendResult = await resend.emails.send({
      from: EMAIL_FROM,
      to: recipient,
      subject: `${code} is your HomeHive sign-in code`,
      html: codeEmailHtml(code, mode),
    })
  } catch (err) {
    console.error('[send-code] Resend threw while sending the code', err)
    return Response.json(
      { error: 'We could not send your code right now. Please try again in a moment.' },
      { status: 502 }
    )
  }

  if (sendResult.error) {
    console.error('[send-code] Resend rejected the sign-in code email', {
      from: EMAIL_FROM,
      name: sendResult.error.name,
      message: sendResult.error.message,
    })
    return Response.json(
      { error: 'We could not send your code right now. Please try again in a moment.' },
      { status: 502 }
    )
  }

  await supabaseAdmin.from('auth_code_sends').insert({ email, ip: clientIp(req), mode })

  return Response.json({ ok: true, codeLength: code.length })
}

/**
 * Return the account's stored email address, or null when no account exists.
 * Uses the admin users endpoint's email filter — `listUsers` in supabase-js
 * only paginates, and we need an exact-match answer per request.
 */
async function findUserByEmail(email: string): Promise<string | null> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users` +
    `?filter=${encodeURIComponent(email)}&per_page=10`
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) {
      console.error('[send-code] admin user lookup failed', res.status)
      return null
    }
    const body = await res.json()
    const match = (body.users || []).find(
      (u: { email?: string }) => (u.email || '').toLowerCase() === email
    )
    return match?.email ?? null
  } catch (err) {
    console.error('[send-code] admin user lookup threw', err)
    return null
  }
}

/**
 * True only when Supabase is telling us the address has no account. That case
 * stays silent so the endpoint never reveals which emails are registered; every
 * other error is a delivery failure the caller deserves to hear about.
 */
function isUnknownUserError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'user_not_found') return true
  const msg = (err.message || '').toLowerCase()
  return msg.includes('user not found') || msg.includes('no user found')
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
