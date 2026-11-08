/**
 * Chase one overdue rent charge by email, from the command line.
 *
 * This exists because the landlord asked for a reminder to go to one tenant and
 * there was no browser session available to press the button with. It is the
 * admin path, not a second implementation: it imports `buildRentReminderEmail`
 * and `logPaymentEmail` — the same two functions POST
 * /api/payments/[planId]/remind calls — so the email and the history row are
 * what the portal would have produced. The only thing it skips is the
 * bearer-token check; ownership is asserted below against
 * `payment_plans.owner_id` instead, so a wrong plan id fails rather than
 * mailing a stranger's tenant.
 *
 * It keeps the route's bookkeeping: on a successful send it stamps
 * `reminder_sent_at` and bumps `reminder_count` on the charge, so Financials
 * shows the tenant was chased. A failed send is logged too — silence in the
 * history reads as "never chased" rather than "never arrived".
 *
 * Dry run (default — prints the email and sends nothing):
 *   node --experimental-strip-types --no-warnings --env-file=.env.local \
 *     --import ./scripts/ts-resolve.mjs scripts/send-gauge-rent-reminder.mjs
 *
 * For real:
 *   … scripts/send-gauge-rent-reminder.mjs --send
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const { buildRentReminderEmail } = await import('../src/lib/rentReminderEmails.ts')
const { logPaymentEmail } = await import('../src/lib/paymentEmailLog.ts')
const { fmtMoney, billingToday } = await import('../src/lib/rentPayments.ts')

const SEND = process.argv.includes('--send')
const FORCE = process.argv.includes('--force')

/** A second nudge inside this window is a mis-run, not a decision. */
const COOLDOWN_HOURS = 48

// ── The one charge this run chases ──────────────────────────────────────────
//
// Hard-coded rather than taken from flags, for the same reason the amendment
// script hard-codes its plan: a script that mails a real tenant about money
// should be read before it is run, and these values are what a reader checks.
//
// Deliberately ONE scheduled payment. This plan carries eight further pending
// months (Dec 2026 → Jul 2027) that are not yet due; the route's "remind on
// everything outstanding" default would ask Gauge for all nine at once, which
// is a $7,386 demand for a $820.67 debt.
const PLAN = {
  planId:       '6c952c27-93c3-4c7f-9dc4-4326a63d056e',
  ownerId:      '16f7ab29-9a38-4883-9fa9-816185f73f60',
  planTenantId: '011a7bed-356c-42dc-92a0-d3a1554b2015',
  paymentId:    '1db71f8e-30f7-4f52-a008-f17174efaf23',

  tenantName:   'Gauge Berkhahn',
  tenantEmail:  'gaugeberkhahn06@gmail.com',

  // No extra sentence from the landlord. The template already says what is
  // owed, by when, and what the late fee does.
  customMessage: null,
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost')
  ? 'https://homehive.live'
  : (process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// ── Read the plan, and refuse if it is not this landlord's ──────────────────

const { data: plan, error: planErr } = await db
  .from('payment_plans')
  .select('id, owner_id, property:properties ( name ), tenants:payment_plan_tenants ( id, name, email ), rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )')
  .eq('id', PLAN.planId)
  .maybeSingle()

if (planErr || !plan) {
  console.error('REFUSED — plan not found:', planErr)
  process.exit(1)
}
if (plan.owner_id !== PLAN.ownerId) {
  console.error(`REFUSED — plan ${PLAN.planId} belongs to ${plan.owner_id}, not ${PLAN.ownerId}.`)
  process.exit(1)
}

const planTenant = (plan.tenants ?? []).find(t => t.id === PLAN.planTenantId)
if (!planTenant) {
  console.error(`REFUSED — ${PLAN.planTenantId} is not a tenant on this plan.`)
  process.exit(1)
}
// The address we mail is the one on the plan, not the one typed above; the
// constant exists so a reader can see who this is, not to override the record.
const to = (planTenant.email || '').trim()
if (!to) {
  console.error(`REFUSED — ${planTenant.name} has no email address on file.`)
  process.exit(1)
}
if (to.toLowerCase() !== PLAN.tenantEmail.toLowerCase()) {
  console.error(`REFUSED — the plan has ${to}, but this script was written for ${PLAN.tenantEmail}.`)
  console.error('Check who you mean to chase before changing this.')
  process.exit(1)
}

// ── Read the charge, and refuse if it is no longer owed ─────────────────────

const { data: payment, error: payErr } = await db
  .from('scheduled_payments')
  .select('id, plan_id, plan_tenant_id, due_date, amount, paid_amount, status, reminder_count, reminder_sent_at')
  .eq('id', PLAN.paymentId)
  .maybeSingle()

if (payErr || !payment) {
  console.error('REFUSED — charge not found:', payErr)
  process.exit(1)
}
if (payment.plan_id !== PLAN.planId || payment.plan_tenant_id !== PLAN.planTenantId) {
  console.error('REFUSED — that charge does not belong to this plan/tenant.')
  process.exit(1)
}
// Re-read rather than trust the note above: the tenant may have paid between
// writing this and running it, and asking for settled rent is the one mistake
// that costs a landlord their credibility.
if (['paid', 'processing', 'voided'].includes(payment.status)) {
  console.error(`REFUSED — the charge is '${payment.status}'. Nothing to chase.`)
  process.exit(1)
}
const owed = Number(payment.amount) - Number(payment.paid_amount ?? 0)
if (owed <= 0) {
  console.error(`REFUSED — the charge is settled (${fmtMoney(Number(payment.amount))} asked, ${fmtMoney(Number(payment.paid_amount ?? 0))} paid).`)
  process.exit(1)
}

// ── Build the email ─────────────────────────────────────────────────────────

// Days late in the billing timezone, never the server's. A machine in UTC
// would call Phoenix's due day over before it is.
const DAY = 86_400_000
const today = new Date(billingToday() + 'T00:00:00Z').getTime()
const daysLate = Math.max(0, Math.floor((today - new Date(payment.due_date + 'T00:00:00Z').getTime()) / DAY))

const rows = [{
  label: `Rent — ${new Date(payment.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
  dueDate: payment.due_date,
  amount: owed,
  daysLate,
  kind: 'rent',
}]

const rawRule = Array.isArray(plan.rule) ? plan.rule[0] : plan.rule
const lateFeeNote = rawRule
  ? `Late fees of ${fmtMoney(Number(rawRule.fee_amount))} apply every ` +
    `${rawRule.frequency_days === 1 ? 'day' : `${rawRule.frequency_days} days`}` +
    `${rawRule.grace_period_days > 0 ? `, after a ${rawRule.grace_period_days}-day grace period` : ''}.`
  : null

const { data: profile } = await db
  .from('profiles').select('full_name, email').eq('id', PLAN.ownerId).maybeSingle()

const payUrl = `${SITE}/dashboard/lease?tab=payments&pay=1`

const built = buildRentReminderEmail({
  tenantName: planTenant.name,
  propertyName: plan.property?.name ?? 'your home',
  rows,
  payUrl,
  landlordName: profile?.full_name || null,
  landlordEmail: profile?.email || null,
  lateFeeNote: daysLate > 0 ? lateFeeNote : null,
  customMessage: PLAN.customMessage,
})

console.log(built.text)
console.log('\n────────────────────────────────────────────────────────────────')
console.log(`recipient        ${planTenant.name} <${to}>`)
console.log(`property         ${plan.property?.name}`)
console.log(`covering         ${rows[0].label}`)
console.log(`amount           ${fmtMoney(owed)}`)
console.log(`due              ${payment.due_date} — ${daysLate} day${daysLate === 1 ? '' : 's'} late (${billingToday()} in Phoenix)`)
console.log(`late fee         ${daysLate > 0 && lateFeeNote ? lateFeeNote : 'not mentioned'}`)
console.log(`reminders so far ${payment.reminder_count ?? 0}`)
console.log(`subject          "${built.subject}"`)

if (!SEND) {
  console.log('\nDRY RUN — nothing was sent and nothing was recorded. Re-run with --send.')
  process.exit(0)
}

// ── Guard against a double send ─────────────────────────────────────────────
//
// Unlike the portal, a script gets re-run — a shell history arrow-up is one
// keystroke away. Chasing the same tenant for the same month twice in a day
// reads as harassment and gets the sender filtered, so it takes --force.
if (payment.reminder_sent_at && !FORCE) {
  const hours = (Date.now() - new Date(payment.reminder_sent_at).getTime()) / 3_600_000
  if (hours < COOLDOWN_HOURS) {
    console.error(`\nREFUSED — ${planTenant.name} was already reminded about this charge ` +
      `${hours < 1 ? 'less than an hour' : `${Math.floor(hours)} hours`} ago ` +
      `(${payment.reminder_count ?? 0} so far).`)
    console.error(`Wait out the ${COOLDOWN_HOURS}h cooldown, or pass --force if you mean it.`)
    process.exit(1)
  }
}

// ── Send, log either way, and stamp the charge only on success ─────────────

const logItems = [{
  scheduledPaymentId: payment.id,
  specialPaymentId: null,
  label: rows[0].label,
  dueDate: rows[0].dueDate,
  amount: rows[0].amount,
  kind: 'rent',
}]

const resend = new Resend(process.env.RESEND_API_KEY)
let providerId = null
try {
  const { data, error } = await resend.emails.send({
    from: 'HomeHive <hello@homehive.live>',
    to,
    subject: built.subject,
    html: built.html,
    text: built.text,
    ...(profile?.email ? { replyTo: profile.email } : {}),
  })
  // Resend reports a rejected send in `error` rather than throwing.
  if (error) throw new Error(error.message || 'Resend rejected the send')
  providerId = data?.id ?? null
} catch (e) {
  await logPaymentEmail({
    planId: PLAN.planId, planTenantId: PLAN.planTenantId,
    recipientEmail: to, recipientName: planTenant.name,
    subject: built.subject, status: 'failed',
    error: e instanceof Error ? e.message : String(e),
    trigger: 'manual', audience: 'tenant',
    customMessage: PLAN.customMessage, sentBy: PLAN.ownerId, items: logItems,
  })
  console.error('\nSend failed — logged as failed, and the charge was NOT stamped:', e)
  process.exit(1)
}

await logPaymentEmail({
  planId: PLAN.planId, planTenantId: PLAN.planTenantId,
  recipientEmail: to, recipientName: planTenant.name,
  subject: built.subject, status: 'sent', providerId,
  trigger: 'manual', audience: 'tenant',
  customMessage: PLAN.customMessage, sentBy: PLAN.ownerId, items: logItems,
})

await db
  .from('scheduled_payments')
  .update({
    reminder_sent_at: new Date().toISOString(),
    reminder_count: (payment.reminder_count ?? 0) + 1,
  })
  .eq('id', payment.id)

console.log(`\nemail sent       "${built.subject}"`)
console.log(`                 → ${to}`)
console.log(`provider id      ${providerId}`)
console.log(`he pays at       ${payUrl}`)
console.log(`you track at     ${SITE}/landlord/financials/plan/${PLAN.planId}`)
