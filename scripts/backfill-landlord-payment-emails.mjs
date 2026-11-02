/**
 * Send the landlord copy of a rent-payment confirmation for payments that
 * already settled.
 *
 * Why this exists: `loadContext` in rentPaymentNotify.ts asked PostgREST for
 * `profiles.first_name`, a column `profiles` has never had. That doesn't null a
 * field — it fails the whole request, so the landlord's row came back null, the
 * landlord's *email address* with it, and every landlord copy was skipped on the
 * quiet `!ctx.landlordEmail` branch while the tenant's receipt went out
 * normally. Nobody saw an error. The fix is in the same commit; this script
 * covers the payments that were missed in the meantime.
 *
 * Usage (from the repo root):
 *
 *   # what would be sent, and to whom — sends nothing
 *   node --experimental-strip-types --no-warnings --import ./scripts/ts-resolve.mjs \
 *     scripts/backfill-landlord-payment-emails.mjs --from 2026-11-01
 *
 *   # actually send
 *   ... scripts/backfill-landlord-payment-emails.mjs --from 2026-11-01 --send
 *
 * Flags:
 *   --from <YYYY-MM-DD>  earliest settlement date to cover (required)
 *   --to   <YYYY-MM-DD>  latest, exclusive (default: tomorrow)
 *   --send               really send; without it this is a dry run
 *
 * Safe to re-run: a payment whose landlord has already been emailed — by the
 * automatic path or by an earlier run of this script — is skipped.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// ─── env ──────────────────────────────────────────────────────────────────────
// Next loads .env.local for the app; a bare node script has to do it itself.
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const val = m[2].replace(/^["']|["']$/g, '')
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
} catch { /* fall back to the real environment */ }

const need = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']
const missing = need.filter(k => !process.env[k])
if (missing.length) {
  console.error('Missing env: ' + missing.join(', '))
  process.exit(1)
}

// ─── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = name => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? null : argv[i + 1]
}
const SEND = argv.includes('--send')
const FROM = flag('from')
const TO = flag('to') ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10)
if (!FROM) {
  console.error('Pass --from <YYYY-MM-DD> (earliest settlement date to cover).')
  process.exit(1)
}

// Imported only now, and dynamically: the module graph under it builds Supabase
// clients at import time, which fails if .env.local hasn't been read yet.
const { resendRentPaymentEmails } = await import('../src/lib/rentPaymentNotify.ts')

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const money = n => '$' + Number(n).toFixed(2)
const monthLabel = due =>
  'Rent — ' + new Date(due + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

/**
 * Settled money in the window.
 *
 * `processing` counts: an ACH debit in flight is exactly the thing a landlord
 * wants to know is coming, and it's what the live path emails about too.
 */
async function settledRows() {
  const out = []
  const { data: sched, error: schedErr } = await db
    .from('scheduled_payments')
    .select('id, plan_id, due_date, amount, paid_amount, status, payment_method, processing_fee, stripe_payment_intent_id, submitted_at, paid_date, settled_at')
    .in('status', ['paid', 'processing'])
  if (schedErr) throw new Error('scheduled_payments: ' + schedErr.message)
  const { data: spec, error: specErr } = await db
    .from('special_payments')
    .select('id, plan_id, label, amount, status, payment_method, processing_fee, stripe_payment_intent_id, submitted_at, paid_date, settled_at')
    .in('status', ['paid', 'processing'])
  if (specErr) throw new Error('special_payments: ' + specErr.message)

  // The day the money moved, preferring the timestamps that mean it.
  const when = r => r.settled_at ?? r.submitted_at ?? (r.paid_date ? r.paid_date + 'T12:00:00Z' : null)

  for (const r of sched ?? []) {
    const w = when(r)
    if (!w) continue
    const day = w.slice(0, 10)
    if (day < FROM || day >= TO) continue
    out.push({ kind: 'scheduled', label: monthLabel(r.due_date), when: w, ...r })
  }
  for (const r of spec ?? []) {
    const w = when(r)
    if (!w) continue
    const day = w.slice(0, 10)
    if (day < FROM || day >= TO) continue
    out.push({ kind: 'special', label: r.label, when: w, ...r })
  }
  return out
}

/** Charge ids a landlord has already been emailed about. */
async function alreadyTold() {
  const { data: emails, error } = await db
    .from('payment_emails').select('id').eq('audience', 'landlord')
  if (error) throw new Error('payment_emails: ' + error.message)
  const ids = (emails ?? []).map(e => e.id)
  if (ids.length === 0) return new Set()
  const { data: items, error: itemErr } = await db
    .from('payment_email_items').select('scheduled_payment_id, special_payment_id').in('email_id', ids)
  if (itemErr) throw new Error('payment_email_items: ' + itemErr.message)
  const seen = new Set()
  for (const i of items ?? []) {
    if (i.scheduled_payment_id) seen.add(i.scheduled_payment_id)
    if (i.special_payment_id) seen.add(i.special_payment_id)
  }
  return seen
}

const rows = await settledRows()
const told = await alreadyTold()

// One email per Stripe intent — that's one act of payment, however many charges
// it covered. Rows with no intent (offline, recorded by hand) group by their own
// id so each still gets exactly one email.
const groups = new Map()
for (const r of rows) {
  const key = r.stripe_payment_intent_id ?? 'manual:' + r.id
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}

console.log(`${rows.length} settled charge(s) between ${FROM} and ${TO} in ${groups.size} payment(s).`)
console.log(SEND ? 'Sending for real.\n' : 'DRY RUN — pass --send to actually send.\n')

let sentCount = 0, skippedCount = 0
for (const [intentId, group] of groups) {
  const lead = group[0]
  if (group.every(r => told.has(r.id))) {
    console.log(`· skip ${intentId} — landlord already emailed`)
    skippedCount++
    continue
  }

  const { data: plan } = await db
    .from('payment_plans').select('id, owner_id, property:properties ( name )').eq('id', lead.plan_id).maybeSingle()
  const { data: owner } = plan
    ? await db.from('profiles').select('full_name, email').eq('id', plan.owner_id).maybeSingle()
    : { data: null }
  const prop = Array.isArray(plan?.property) ? plan.property[0] : plan?.property
  const total = group.reduce((s, r) => s + Number(r.amount), 0)
  const event = lead.status === 'processing' ? 'processing' : 'paid'

  const who = owner?.email ?? '(no landlord email!)'
  console.log(`· ${intentId}  ${money(total)}  ${event}  ${prop?.name ?? '?'}  → ${who}`)
  for (const r of group) console.log(`    ${r.label} ${money(r.amount)}`)

  if (!SEND) continue

  const result = await resendRentPaymentEmails({
    db,
    intent: { id: intentId, receipt_email: null },
    event,
    method: lead.payment_method === 'ach' ? 'ach' : 'card',
    fee: Number(lead.processing_fee ?? 0),
    rows: group.map(r => ({ kind: r.kind, id: r.id, amount: Number(r.amount), label: r.label })),
    // Only the side that was missed. The tenant already has their receipt, and
    // a second copy weeks later reads like a second charge.
    audience: 'landlord',
    // The email must date itself when the money moved, not when this ran.
    paidOn: new Date(lead.when),
  })
  if (result.sent.length > 0) {
    sentCount++
    console.log(`    sent → ${result.sent.map(s => s.to).join(', ')}`)
  } else {
    console.log(`    NOT SENT: ${result.skipped.join(' · ')}`)
  }
}

console.log(`\n${SEND ? sentCount + ' email(s) sent' : 'dry run'}, ${skippedCount} already covered.`)
