/**
 * Close out Alex Maxwell's 2025–26 tenancy by email — to him and to his
 * co-signer.
 *
 * ── Why this is a script and not the notice button ──────────────────────────
 *
 * The portal's first-notice flow (POST /api/landlord/tenants/[id]/late-warning)
 * refuses this send, correctly. Its gate is `warningBasis().sendable`, which
 * asks "is something past due *today*" — and on this tenancy nothing is. All
 * twelve months of rent are settled. What remains is eleven late fees that
 * froze when each month's rent landed, the last of them in June. The route even
 * says so in its 409: *"There is an outstanding late fee on rent that has since
 * been paid — send a late fee reminder for that instead."*
 *
 * But the late-fee reminder is not right either: it is written for a live
 * tenancy, one month at a time. This is a closed lease, a whole year of fees,
 * and a year-end tidy-up. Hence `buildLeaseCloseoutEmail`, and hence this
 * script — the admin path for a send the UI has no button for.
 *
 * It is not a second implementation of the arithmetic. The fee on every row
 * comes from `explainLateFee` in `src/lib/rentPayments.ts`, which is the one
 * engine the tenant portal, `/api/tenant/pay`, the landlord's ledger and
 * `scripts/check-outstanding-fees.mjs` all read. `late_fees_applied` is never
 * consulted: that column is corrupt on this database (it holds $4,050 against a
 * row paid three days early). If this script and the portal ever disagree, the
 * portal is right and this is the bug.
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 *
 *   • `background_checks` — two rows, and only if they are missing: a record
 *     for Alex, and the co-signer record for Joseph Maxwell hanging off it.
 *     Alex has no `lead_id`, so his row is keyed on `tenant_id`, which
 *     `loadCosigners` reads. See "On the co-signer record" below.
 *   • `payment_emails` (+ `payment_email_items`) — one row per recipient, via
 *     `logPaymentEmail`, the same function every other email path uses. Sent
 *     *and* failed are both logged: silence in the history reads as "never
 *     chased" rather than "never arrived".
 *
 * It deliberately touches **no money rows**. No `reminder_count`, no
 * `late_fee_reminder_sent_at`, no `late_fee_paid`. Those columns belong to the
 * flows that own them, and a year-end letter is not a rent reminder.
 *
 * ── On the co-signer record ─────────────────────────────────────────────────
 *
 * Joseph's row is created with `status: 'approved'` and `decision: null`, and
 * the distinction is deliberate. In this codebase `status === 'approved'` is
 * what `cosignerIsOnTheHook` reads to decide "is this someone we should write
 * to about this lease" — and the landlord has stated he is. `decision` is the
 * outcome of a *screening*, and no screening was ever run through the platform,
 * so it stays null rather than being filled in with a result nobody produced.
 * The provenance goes in `notes` so a later reader knows where the row came
 * from.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 *
 * Dry run — prints both letters, writes nothing, sends nothing:
 *   node --experimental-strip-types --no-warnings --env-file=.env.local \
 *     --import ./scripts/ts-resolve.mjs scripts/send-maxwell-closeout-notice.mjs
 *
 * For real:
 *   … scripts/send-maxwell-closeout-notice.mjs --send
 *
 * `--send` creates the co-signer rows if they are missing. Nothing is written
 * on a dry run, so a dry run can be repeated freely.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const { buildLeaseCloseoutEmail } = await import('../src/lib/leaseCloseoutEmails.ts')
const { logPaymentEmail } = await import('../src/lib/paymentEmailLog.ts')
const { fmtMoney, explainLateFee, rentIsSettled, billingToday } = await import('../src/lib/rentPayments.ts')

const SEND = process.argv.includes('--send')
const FORCE = process.argv.includes('--force')

/** A second copy of a year-end letter inside this window is a mis-run. */
const COOLDOWN_HOURS = 48

// ── Who this run writes to ──────────────────────────────────────────────────
//
// Hard-coded rather than taken from flags, for the same reason the rent
// reminder and amendment scripts hard-code theirs: a script that mails a real
// family about $1,400 should be read before it is run, and these values are
// what a reader checks. Every one of them is re-verified against the database
// below, and a mismatch refuses rather than guessing.
const TARGET = {
  tenantId:     '66d0f836-acfd-4f26-97aa-60521dbe271d',
  ownerId:      '16f7ab29-9a38-4883-9fa9-816185f73f60',
  planId:       '917bba81-2949-46a6-8437-adcfc33f91dd',
  planTenantId: 'e57bc3b4-ee54-4625-9e32-dc245db518d9',
  leaseId:      'a912b266-7b70-44d2-af0c-e4a5bbdd64ff',

  tenantName:  'Alex Maxwell',
  tenantEmail: 'alexandermaxwell2303@gmail.com',

  cosigner: {
    firstName:    'Joseph',
    lastName:     'Maxwell',
    email:        'maxwellfam.az@gmail.com',
    relationship: 'Parent',
  },

  /** The date the letter asks for an answer by. */
  settleBy: '2026-12-05',

  // Nothing extra from the landlord. The template already says what is owed,
  // how it was worked out, why it is arriving now, and what is being asked.
  customMessage: null,
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost')
  ? 'https://homehive.live'
  : (process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const die = (...msg) => { console.error(...msg); process.exit(1) }

const monthYear = d =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

// ── The tenant, and that this is the right one ──────────────────────────────

const { data: tenant, error: tenantErr } = await db
  .from('tenants')
  .select('id, owner_id, first_name, last_name, email, lead_id')
  .eq('id', TARGET.tenantId)
  .maybeSingle()

if (tenantErr || !tenant) die('REFUSED — tenant not found:', tenantErr)
if (tenant.owner_id !== TARGET.ownerId) {
  die(`REFUSED — tenant ${TARGET.tenantId} belongs to ${tenant.owner_id}, not ${TARGET.ownerId}.`)
}

const tenantName = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ').trim()
// The address we mail is the one on the record, not the one typed above; the
// constant exists so a reader can see who this is, not to override the record.
const to = (tenant.email || '').trim()
if (!to) die(`REFUSED — ${tenantName} has no email address on file.`)
if (to.toLowerCase() !== TARGET.tenantEmail.toLowerCase()) {
  die(`REFUSED — the record has ${to}, but this script was written for ${TARGET.tenantEmail}.`,
      '\nCheck who you mean to write to before changing this.')
}

// ── The plan, the lease, and the fee rule ───────────────────────────────────

const { data: plan, error: planErr } = await db
  .from('payment_plans')
  .select(`
    id, owner_id, lease_id,
    property:properties ( name ),
    lease:leases ( id, start_date, end_date, unit_number ),
    tenants:payment_plan_tenants ( id, name, email ),
    rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )
  `)
  .eq('id', TARGET.planId)
  .maybeSingle()

if (planErr || !plan) die('REFUSED — payment plan not found:', planErr)
if (plan.owner_id !== TARGET.ownerId) {
  die(`REFUSED — plan ${TARGET.planId} belongs to ${plan.owner_id}, not ${TARGET.ownerId}.`)
}

const one = v => (Array.isArray(v) ? v[0] ?? null : v ?? null)
const lease = one(plan.lease)
const property = one(plan.property)
const rawRule = one(plan.rule)

if (!lease) die('REFUSED — this plan has no lease, so there is no tenancy to close out.')
if (lease.id !== TARGET.leaseId) {
  die(`REFUSED — the plan's lease is ${lease.id}, not ${TARGET.leaseId}.`)
}
if (!rawRule || Number(rawRule.fee_amount) <= 0) {
  die('REFUSED — this plan carries no late fee rule, so there are no fees to ask for.')
}

const planTenant = (plan.tenants ?? []).find(t => t.id === TARGET.planTenantId)
if (!planTenant) die(`REFUSED — ${TARGET.planTenantId} is not a payer on this plan.`)

const rule = {
  grace_period_days: Number(rawRule.grace_period_days ?? 0),
  fee_amount:        Number(rawRule.fee_amount),
  frequency_days:    Number(rawRule.frequency_days ?? 1),
  max_total_fees:    rawRule.max_total_fees == null ? null : Number(rawRule.max_total_fees),
}

// The whole premise of this letter. A lease that has not ended gets the live
// notice flow, not a year-end closeout.
const today = billingToday()
if (!lease.end_date || lease.end_date >= today) {
  die(`REFUSED — the lease ends ${lease.end_date ?? 'never'}, which is not in the past (today is ${today}).`,
      '\nA live tenancy belongs in the first-notice flow, not a closeout letter.')
}

// ── The charges, and the fees the one engine says are still owed ────────────

const { data: charges, error: chargeErr } = await db
  .from('scheduled_payments')
  .select('id, due_date, amount, paid_amount, paid_date, submitted_at, status, late_fee_paid, payment_method')
  .eq('plan_tenant_id', TARGET.planTenantId)
  .order('due_date', { ascending: true })

if (chargeErr) die('REFUSED — could not read the charges:', chargeErr)
if (!charges?.length) die('REFUSED — this payer has no rent charges.')

const { data: waivers } = await db
  .from('late_fee_waivers')
  .select('scheduled_payment_id, amount')
  .in('scheduled_payment_id', charges.map(c => c.id))

const waivedBy = new Map((waivers ?? []).map(w => [w.scheduled_payment_id, Number(w.amount ?? 0)]))

const live = charges.filter(c => c.status !== 'voided')

let feeAssessed = 0
let feeCredited = 0
let feeWaived = 0
let rentCollected = 0
let rentOutstanding = 0
let monthsLate = 0
const rows = []

for (const c of live) {
  const billed = Number(c.amount)
  const paid = Number(c.paid_amount ?? 0)

  /**
   * Whether this month's rent is in, asked of the engine rather than of the
   * arithmetic.
   *
   * These are not the same question on this plan, and the difference is $1,484.
   * May and June 2026 are both `status: 'paid'` — the landlord marked them
   * settled against a Zelle transfer on 25 June — but their `paid_amount` was
   * left at 0.00 while every other month has it keyed in. Subtracting
   * `paid_amount` from `amount` therefore reports $1,483.92 of unpaid rent on a
   * tenancy the landlord's own record says is square.
   *
   * `rentIsSettled` is the platform's one answer to "is this month in", and it
   * reads `status === 'paid'`, so the letter now says what the record says. The
   * blank `paid_amount` is a bookkeeping gap and is NOT corrected here: this
   * script writes nothing to the money rows, and inventing a figure to make a
   * letter tidier is exactly the kind of silent rewrite that makes a ledger
   * untrustworthy. It is reported at the end of the run instead, for a human to
   * fix in the ledger where it belongs.
   *
   * Note the fee total is unaffected either way. The uncapped rule is held to
   * the size of the charge, and `max(0, 741.96 − 0) || 741.96` and
   * `max(0, 741.96 − 741.96) || 741.96` both come to $741.96, so May's capped
   * fee is $741.96 whichever figure the row carries.
   */
  const settled = rentIsSettled({ status: c.status, amount: billed, paid_amount: paid })

  // What "received in full" means for a settled month: the amount billed. For
  // an unsettled one, only the money actually recorded against it.
  rentCollected += settled ? billed : paid
  if (!settled) rentOutstanding += Math.max(0, billed - paid)

  // One engine, same arguments the portal passes. `submitted_at` matters: a fee
  // judged on a bank's clearing date bills the tenant for the ACH window.
  const x = explainLateFee(rule, {
    status:        c.status,
    due_date:      c.due_date,
    paid_date:     c.paid_date,
    submitted_at:  c.submitted_at,
    amount:        billed,
    paid_amount:   paid,
    late_fee_paid: Number(c.late_fee_paid ?? 0),
  }, waivedBy.get(c.id) ?? 0)

  feeAssessed += x.assessed
  // Fee money that genuinely arrived, by either route: recorded as a fee
  // (`late_fee_paid`), or paid above the rent on the charge and credited.
  feeCredited += x.feePaid + x.overpaymentCredit
  feeWaived += x.waived
  if (x.daysPastDue > 0) monthsLate += 1

  if (x.outstanding <= 0) continue

  rows.push({
    label: `${monthYear(c.due_date)} rent`,
    dueDate: c.due_date,
    rentAmount: billed,
    fee: x.outstanding,
    daysLate: x.daysPastDue,
    // Per-row, for the same reason as the total: a settled month owes no rent,
    // whatever its `paid_amount` column happens to say.
    rentOutstanding: settled ? 0 : Math.max(0, billed - paid),
    paidOn: settled ? c.paid_date : null,
    capped: x.cappedBy === 'charge',
    scheduledPaymentId: c.id,
  })
}

const feeOutstanding = Math.round(rows.reduce((s, r) => s + r.fee, 0) * 100) / 100

// Months the record calls settled but has no money keyed against. Not touched,
// not corrected, and not hidden either — printed so the gap gets closed in the
// ledger by a human who can check it against a bank statement.
const unkeyed = live.filter(c =>
  rentIsSettled({ status: c.status, amount: Number(c.amount), paid_amount: Number(c.paid_amount ?? 0) })
  && Number(c.paid_amount ?? 0) < Number(c.amount),
)

if (feeOutstanding <= 0) {
  die('REFUSED — nothing is outstanding on this tenancy. There is nothing to close out.')
}

const basis = {
  leaseStart: lease.start_date,
  leaseEnd: lease.end_date,
  monthsBilled: live.length,
  monthsLate,
  rentCollected: Math.round(rentCollected * 100) / 100,
  rows,
  feeAssessed: Math.round(feeAssessed * 100) / 100,
  feeCredited: Math.round(feeCredited * 100) / 100,
  feeOutstanding,
  rentOutstanding: Math.round(rentOutstanding * 100) / 100,
  asOf: today,
}

// ── The landlord, for the signature and the reply-to ───────────────────────

const { data: profile } = await db
  .from('profiles').select('full_name, email').eq('id', TARGET.ownerId).maybeSingle()

// `profiles` has no `first_name`; selecting a column that does not exist nulls
// the WHOLE row in PostgREST, which once killed every landlord rent email.
const landlordName = profile?.full_name || null
const landlordEmail = profile?.email || null

// ── The co-signer record ───────────────────────────────────────────────────
//
// Read first. The rows are only created under --send, so a dry run reports what
// *would* be created without touching anything.

const CHECK_COLS = `
  id, is_cosigner, cosigner_for_check_id, cosigner_relationship,
  subject_first_name, subject_last_name, subject_email, status, decision
`

const idArms = [`tenant_id.eq.${tenant.id}`]
if (tenant.lead_id) idArms.push(`lead_id.eq.${tenant.lead_id}`)

const { data: ownChecks } = await db
  .from('background_checks').select(CHECK_COLS)
  .or(idArms.join(',')).eq('is_cosigner', false)
  .order('created_at', { ascending: false })

let parentCheck = (ownChecks ?? [])[0] ?? null
let existingCosigners = []

if (parentCheck) {
  const { data: kids } = await db
    .from('background_checks').select(CHECK_COLS)
    .eq('cosigner_for_check_id', parentCheck.id).eq('is_cosigner', true)
  existingCosigners = kids ?? []
}

let cosignerRow = existingCosigners.find(
  c => (c.subject_email || '').toLowerCase() === TARGET.cosigner.email.toLowerCase(),
) ?? null

const willCreateParent = !parentCheck
const willCreateCosigner = !cosignerRow

// ── Build both letters ─────────────────────────────────────────────────────

const cosignerName = cosignerRow
  ? [cosignerRow.subject_first_name, cosignerRow.subject_last_name].filter(Boolean).join(' ').trim()
  : `${TARGET.cosigner.firstName} ${TARGET.cosigner.lastName}`
const cosignerEmail = (cosignerRow?.subject_email || TARGET.cosigner.email).trim()
const relationship = cosignerRow?.cosigner_relationship || TARGET.cosigner.relationship

const shared = {
  tenantName,
  propertyName: property?.name ?? 'your home',
  unitLabel: lease.unit_number ?? null,
  basis,
  rule,
  settleBy: TARGET.settleBy,
  // Null on purpose, and this is the important one. `/api/tenant/pay` only
  // collects a fee riding on rent that is STILL OWED; every fee here sits on
  // rent that has settled, so there is nothing for it to attach to. A "Pay now"
  // button would land both readers on a page that cannot charge them.
  payUrl: null,
  landlordName,
  landlordEmail,
  customMessage: TARGET.customMessage,
}

const tenantLetter = buildLeaseCloseoutEmail({
  ...shared,
  audience: 'tenant',
  copiedTo: [cosignerName],
})

const cosignerLetter = buildLeaseCloseoutEmail({
  ...shared,
  audience: 'cosigner',
  recipientName: cosignerName,
  relationship,
})

// ── Report ─────────────────────────────────────────────────────────────────

console.log('═'.repeat(68))
console.log('TENANT COPY')
console.log('═'.repeat(68))
console.log(tenantLetter.text)
console.log('\n' + '═'.repeat(68))
console.log('CO-SIGNER COPY')
console.log('═'.repeat(68))
console.log(cosignerLetter.text)

console.log('\n' + '─'.repeat(68))
console.log(`tenant           ${tenantName} <${to}>`)
console.log(`co-signer        ${cosignerName} <${cosignerEmail}> (${relationship})`)
console.log(`property         ${property?.name}${lease.unit_number ? ` · ${lease.unit_number}` : ''}`)
console.log(`lease            ${lease.start_date} → ${lease.end_date} (ended)`)
console.log(`rule             ${fmtMoney(rule.fee_amount)} / ${rule.frequency_days}d, grace ${rule.grace_period_days}d, cap ${rule.max_total_fees ?? 'none (held to the charge)'}`)
console.log(`months billed    ${basis.monthsBilled} · late ${basis.monthsLate}`)
console.log(`rent collected   ${fmtMoney(basis.rentCollected)}`)
console.log(`rent outstanding ${fmtMoney(basis.rentOutstanding)}`)
if (unkeyed.length) {
  const gap = unkeyed.reduce((s, c) => s + (Number(c.amount) - Number(c.paid_amount ?? 0)), 0)
  console.log(`\n⚠ LEDGER GAP — ${unkeyed.length} month(s) marked paid with no amount keyed in:`)
  for (const c of unkeyed) {
    console.log(`    ${c.due_date}  billed ${fmtMoney(Number(c.amount))}, `
      + `paid_amount ${fmtMoney(Number(c.paid_amount ?? 0))}, `
      + `marked paid ${c.paid_date} via ${c.payment_method ?? 'unknown'}`)
  }
  console.log(`    ${fmtMoney(gap)} of received rent is unrecorded. This script does NOT`)
  console.log(`    change it, and the letter follows the 'paid' status. Fix it in the ledger.`)
  console.log(`    The late fee total is unaffected either way.\n`)
}
console.log(`fees assessed    ${fmtMoney(basis.feeAssessed)}`)
console.log(`fees credited    ${fmtMoney(basis.feeCredited)}  (arrived with rent)`)
if (feeWaived > 0) console.log(`fees waived      ${fmtMoney(feeWaived)}`)
console.log(`FEES OUTSTANDING ${fmtMoney(basis.feeOutstanding)}  across ${rows.length} month(s)`)
console.log(`settle by        ${TARGET.settleBy}`)
console.log(`pay button       none (fees ride on settled rent — not payable online)`)
console.log(`cosigner record  ${willCreateCosigner ? 'WILL BE CREATED' : `exists (${cosignerRow.id})`}`)
console.log(`tenant record    ${willCreateParent ? 'WILL BE CREATED' : `exists (${parentCheck.id})`}`)
console.log(`tenant subject   "${tenantLetter.subject}"`)
console.log(`cosigner subject "${cosignerLetter.subject}"`)

if (!SEND) {
  console.log('\nDRY RUN — nothing was sent, nothing was written. Re-run with --send.')
  process.exit(0)
}

// ── Guard against a double send ────────────────────────────────────────────
//
// Unlike a button, a script gets re-run: a shell history arrow-up is one
// keystroke away. Two identical year-end letters in a day reads as a system
// malfunction and undermines the one it is meant to settle.
const { data: priorSends } = await db
  .from('payment_emails')
  .select('id, recipient_email, created_at, kind')
  .eq('plan_id', TARGET.planId)
  .eq('kind', 'lease_closeout')
  .order('created_at', { ascending: false })
  .limit(1)

if (priorSends?.length && !FORCE) {
  const hours = (Date.now() - new Date(priorSends[0].created_at).getTime()) / 3_600_000
  if (hours < COOLDOWN_HOURS) {
    die(`\nREFUSED — a closeout letter already went out on this plan ` +
        `${hours < 1 ? 'less than an hour' : `${Math.floor(hours)} hours`} ago.`,
        `\nWait out the ${COOLDOWN_HOURS}h cooldown, or pass --force if you mean it.`)
  }
}

// ── Create the co-signer record if it is missing ───────────────────────────
//
// Before the sends, so the letters that go out are backed by a record on file
// rather than by two constants in this script.

if (willCreateParent) {
  const { data: created, error } = await db
    .from('background_checks')
    .insert([{
      tenant_id: tenant.id,
      landlord_id: TARGET.ownerId,
      is_cosigner: false,
      cosigner: 'yes',
      // He leased the property and completed the full term — that is a fact of
      // the tenancy, not a screening result, so `decision` stays null.
      status: 'approved',
      subject_first_name: tenant.first_name,
      subject_last_name: tenant.last_name,
      subject_email: tenant.email,
      notes: 'Record created to attach the co-signer on the 2025–26 lease. '
           + 'No platform screening was run; status reflects an accepted, completed tenancy.',
    }])
    .select(CHECK_COLS)
    .single()
  if (error || !created) die('REFUSED — could not create the tenant record, so nothing was sent:', error)
  parentCheck = created
  console.log(`\nCreated tenant record ${created.id}`)
}

if (willCreateCosigner) {
  const { data: created, error } = await db
    .from('background_checks')
    .insert([{
      landlord_id: TARGET.ownerId,
      is_cosigner: true,
      cosigner_for_check_id: parentCheck.id,
      cosigner_relationship: TARGET.cosigner.relationship,
      subject_first_name: TARGET.cosigner.firstName,
      subject_last_name: TARGET.cosigner.lastName,
      subject_email: TARGET.cosigner.email,
      // 'approved' is what `cosignerIsOnTheHook` reads to decide whether to
      // write to someone about this lease, and the landlord has stated he is
      // the co-signer. `decision` is a screening outcome and no screening was
      // run, so it stays null rather than being invented.
      status: 'approved',
      notes: 'Co-signer on the 2025–26 lease, recorded at the landlord\'s direction '
           + 'for the year-end closeout letter. No platform screening was run.',
    }])
    .select(CHECK_COLS)
    .single()
  if (error || !created) die('REFUSED — could not create the co-signer record, so nothing was sent:', error)
  cosignerRow = created
  console.log(`Created co-signer record ${created.id} for ${cosignerName}`)
}

// ── Send, and log either way ───────────────────────────────────────────────

// What the letters covered, as the recipients were shown it. A charge edited
// tomorrow must not rewrite what was asked for today.
const items = rows.map(r => ({
  scheduledPaymentId: r.scheduledPaymentId,
  specialPaymentId: null,
  label: `${r.label} — late fee`,
  dueDate: r.dueDate,
  amount: r.fee,
  kind: 'late_fee',
}))

const resend = new Resend(process.env.RESEND_API_KEY)
const sent = []
const failed = []

async function post(audience, address, name, built) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: address,
      subject: built.subject,
      html: built.html,
      text: built.text,
      ...(landlordEmail ? { replyTo: landlordEmail } : {}),
    })
    // Resend reports a refusal in `error` rather than by throwing, so without
    // this a rejected address is logged as delivered.
    if (error) throw new Error(error.message || 'Resend rejected the send')

    await logPaymentEmail({
      planId: TARGET.planId,
      // A co-signer is not a payer on the plan, so there is no plan-tenant to
      // attribute their copy to.
      planTenantId: audience === 'tenant' ? TARGET.planTenantId : null,
      recipientEmail: address,
      recipientName: name,
      subject: built.subject,
      kind: 'lease_closeout',
      audience,
      trigger: 'manual',
      status: 'sent',
      providerId: data?.id ?? null,
      customMessage: TARGET.customMessage,
      sentBy: TARGET.ownerId,
      items,
    })
    sent.push({ audience, address })
    console.log(`sent     ${audience.padEnd(9)} ${address}`)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    await logPaymentEmail({
      planId: TARGET.planId,
      planTenantId: audience === 'tenant' ? TARGET.planTenantId : null,
      recipientEmail: address,
      recipientName: name,
      subject: built.subject,
      kind: 'lease_closeout',
      audience,
      trigger: 'manual',
      status: 'failed',
      error: reason,
      customMessage: TARGET.customMessage,
      sentBy: TARGET.ownerId,
      items,
    })
    failed.push({ audience, address, reason })
    console.error(`FAILED   ${audience.padEnd(9)} ${address} — ${reason}`)
  }
}

// The former resident first, always. If only one of these lands it should be
// his: a co-signer told before the tenant is how a tenancy turns adversarial,
// and a parent hearing it first is exactly the outcome to avoid.
await post('tenant', to, tenantName, tenantLetter)
await post('cosigner', cosignerEmail, cosignerName, cosignerLetter)

console.log(`\n${sent.length} sent, ${failed.length} failed. Logged to payment_emails as 'lease_closeout'.`)
if (failed.length) process.exit(1)
