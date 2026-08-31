#!/usr/bin/env node
/**
 * Diagnose the passwordless sign-in code pipeline end to end.
 *
 *   node scripts/diagnose-auth-email.mjs you@example.com [--send]
 *
 * Checks, in the order they run in /api/auth/send-code:
 *   1. env vars are present
 *   2. the Resend API key is live and the "from" domain is verified
 *   3. Supabase mints an email OTP for the address (and how long it is)
 *   4. with --send, actually delivers a test email through Resend
 *
 * Nothing here writes to the throttle table, so it is safe to re-run.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const FROM = 'HomeHive <hello@homehive.live>'

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      if (process.env[m[1]] === undefined) process.env[m[1]] = value
    }
  } catch { /* file is optional */ }
}

const email = process.argv[2]
const doSend = process.argv.includes('--send')
if (!email) {
  console.error('Usage: node scripts/diagnose-auth-email.mjs you@example.com [--send]')
  process.exit(1)
}

const ok = (m) => console.log(`  ✅ ${m}`)
const bad = (m) => console.log(`  ❌ ${m}`)
const info = (m) => console.log(`     ${m}`)
let failed = false
const fail = (m) => { failed = true; bad(m) }

// ── 1. env ────────────────────────────────────────────────────────────────────
console.log('\n1. Environment')
const { RESEND_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
RESEND_API_KEY
  ? ok(`RESEND_API_KEY present (${RESEND_API_KEY.slice(0, 6)}…, ${RESEND_API_KEY.length} chars)`)
  : fail('RESEND_API_KEY is missing')
NEXT_PUBLIC_SUPABASE_URL ? ok(`Supabase URL ${NEXT_PUBLIC_SUPABASE_URL}`) : fail('NEXT_PUBLIC_SUPABASE_URL is missing')
SUPABASE_SERVICE_ROLE_KEY
  ? ok('SUPABASE_SERVICE_ROLE_KEY present')
  : fail('SUPABASE_SERVICE_ROLE_KEY is missing (generateLink needs it)')

// ── 2. Resend key + sending domain ───────────────────────────────────────────
console.log('\n2. Resend account')
const fromDomain = FROM.match(/@([^>\s]+)/)?.[1]
if (RESEND_API_KEY) {
  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 401 || res.status === 403) {
    fail(`Resend rejected the API key (HTTP ${res.status}): ${body.message || JSON.stringify(body)}`)
    info('Create a fresh key with "Sending access" at https://resend.com/api-keys')
  } else if (!res.ok) {
    fail(`Resend /domains returned HTTP ${res.status}: ${JSON.stringify(body)}`)
  } else {
    const domains = body.data || []
    ok(`API key is valid — ${domains.length} domain(s) on the account`)
    for (const d of domains) info(`${d.name}: ${d.status}${d.region ? ` (${d.region})` : ''}`)
    const match = domains.find((d) => d.name === fromDomain)
    if (!match) fail(`"${fromDomain}" is not on this Resend account, so every send from ${FROM} is rejected`)
    else if (match.status !== 'verified') fail(`"${fromDomain}" is ${match.status}, not verified — sends are rejected`)
    else ok(`"${fromDomain}" is verified`)
  }
}

// ── 3. Supabase OTP ──────────────────────────────────────────────────────────
console.log('\n3. Supabase OTP for', email)
if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) {
    fail(`generateLink failed: ${error.message} (status ${error.status ?? '?'}, code ${error.code ?? '?'})`)
    info('"User not found" just means this address has no account — try one that does.')
    info('A rate-limit error means Supabase Auth → Rate Limits is throttling the project.')
  } else if (!data?.properties?.email_otp) {
    fail('generateLink succeeded but returned no email_otp')
  } else {
    const otp = data.properties.email_otp
    ok(`OTP minted, ${otp.length} digits`)
    if (otp.length !== 6) fail('Set Auth → Email → "Email OTP Length" to 6 in the Supabase dashboard')
  }
}

// ── 4. Real send ─────────────────────────────────────────────────────────────
console.log('\n4. Delivery' + (doSend ? '' : ' (skipped — pass --send to actually email)'))
if (doSend && RESEND_API_KEY) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: email,
      subject: 'HomeHive email delivery test',
      html: '<p>If you are reading this, Resend can deliver HomeHive sign-in codes to this address.</p>',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok) {
    ok(`Resend accepted the message (id ${body.id})`)
    info('If it never arrives, check https://resend.com/emails for bounce/spam status.')
  } else {
    fail(`Resend refused the send (HTTP ${res.status}): ${body.message || JSON.stringify(body)}`)
  }
}

console.log(failed ? '\nResult: found problems above.\n' : '\nResult: every check passed.\n')
process.exit(failed ? 1 : 0)
