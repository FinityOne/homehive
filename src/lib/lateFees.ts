/**
 * Late fees a landlord has not been paid — and what a rent charge is actually
 * made of.
 *
 * Two things live here because they are the same arithmetic question asked at
 * two altitudes: *what is genuinely owed on this charge*, and *across the whole
 * portfolio, which of those fees is still outstanding*.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A late fee in this product is **derived, never billed**. There is no row for
 * it. `lateFeeDue` computes it from the rule when something is rendered, and
 * `scheduled_payments.late_fee_paid` records it if money arrives. Nothing ever
 * put it in front of the landlord as a thing to collect, which has exactly the
 * consequence you would expect: on this database every late fee ever assessed
 * is uncollected — 32 charges, not one of them paid, against rent the tenants
 * *did* eventually pay.
 *
 * That is the real shape of the problem, and it is not the shape a landlord
 * imagines. There are **zero** charges currently accruing a fee. The money is
 * all in the other bucket: rent that arrived late, where the fee was simply
 * never asked for. So this module splits them, because they are different
 * decisions:
 *
 *   • `accruing` — the rent is still unpaid. The fee grows every day. Chasing
 *     it is urgent and uncontroversial; it goes out with the rent demand.
 *   • `uncollected` — the rent is settled and the fee is frozen at whatever it
 *     reached on the day the money landed. Nothing is urgent. The landlord has
 *     a *choice*: bill it late, or write it off. Both are legitimate, and the
 *     UI must not imply the first one is free.
 *
 * ── Why waiving is part of the feature, not a nicety ──────────────────────
 *
 * The frozen bucket on this database totals thousands of dollars under a
 * $15/day uncapped rule, including $741.96 of fees on a single month's $741.96
 * rent that settled in June. Presenting that as "collectable" would be
 * misleading, and in much of the US, billing a fee months after accepting rent
 * in full is unenforceable. A list the landlord cannot zero out is a list they
 * learn to ignore — so a fee can be waived, the waiver is recorded with a
 * reason, and a waived fee leaves the ledger without pretending it was paid.
 *
 * Everything here is pure: give it plans, waivers and a date, get numbers back.
 */
import {
  lateFeeDue, lateFeeCappedByCharge, lateFeeRuleRisk, rentIsSettled, lateFeeAsOf,
  lateFeeFrozen, billingToday,
  type LateFeeRuleLike,
} from '@/lib/rentPayments'
import type { PaymentPlan, PaymentPlanTenant, ScheduledPayment } from '@/lib/payments'

const round2 = (n: number) => Math.round(n * 100) / 100
const DAY = 86_400_000

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / DAY)

/** A recorded decision to not collect a fee. Keyed by the rent row it sat on. */
export type LateFeeWaiver = {
  scheduled_payment_id: string
  /** The fee as it stood when it was waived — history, not a live figure. */
  amount: number
  reason: string | null
  created_at: string
  /** When the tenant was told. Null means the write-off was never announced. */
  tenant_notified_at?: string | null
  tenant_notified_email?: string | null
  /** What the tenant was told, as distinct from the landlord's private reason. */
  tenant_note?: string | null
}

// ─── WHAT ONE RENT CHARGE IS MADE OF ─────────────────────────────────────────

/**
 * The honest decomposition of a single rent row.
 *
 * The ledger used to show `Expected = scheduled_payments.amount` beside
 * `Collected = paid_amount + late_fee_paid`, and then subtract one from the
 * other. Those are not the same quantity: the collected side counted late-fee
 * money that the expected side never asked for. A tenant who paid $736 of rent
 * plus a $105 fee showed as having *overpaid*, and a tenant who owed a $105 fee
 * showed a balance of zero. Neither figure could be reconciled against
 * anything, which is the specific reason the column could not be trusted.
 *
 * So `expected` is now rent **plus** the fee genuinely assessed on it, and both
 * sides of the subtraction include fees. `balance` is then a number a landlord
 * can act on.
 *
 * `amount` on the row already contains any utility share — `apply_plan_utility`
 * folds it in rather than billing it separately — so utilities are reported
 * here as a *decomposition* of rent, never added on top. Double-counting them
 * would overstate every total on the page.
 */
export type ChargeBreakdown = {
  /** What the row asks for: base rent + any utility share folded into it. */
  billed: number
  /** `billed` less the utility share, i.e. rent proper. */
  baseRent: number
  /** The utility share inside `billed`. Zero when it cannot be established. */
  utilities: number
  utilityLines: { id: string; label: string; category: string; amount: number }[]
  /**
   * Whether the rent/utility split is known for *this* row.
   *
   * A utility is materialised only onto future unpaid rent, so a row billed
   * before the utility existed genuinely contains none of it. The split is
   * therefore only claimed when the row's amount still matches the payer's
   * current monthly total; otherwise rent is reported whole, which is the
   * truthful answer rather than a plausible one.
   */
  split: 'known' | 'unknown'
  /** The fee the rule assesses on this row, through `lateFeeDue`. */
  lateFeeAssessed: number
  /** Fee money that genuinely arrived (`late_fee_paid`). */
  lateFeeCollected: number
  /**
   * Fee money that arrived recorded as *rent*, i.e. paid above the charge.
   *
   * Two charges here were overpaid by exactly one and four days' worth of the
   * daily fee: the tenant paid the fee and it landed in `paid_amount`. It is
   * credited against the fee because nothing else on the row could explain it,
   * and leaving it out bills the tenant twice for the same money. The tenant
   * portal applies the identical credit — see `lateFeeOutstanding` in
   * `rentPayments.ts` — so both sides quote one figure.
   */
  lateFeeOverpaid: number
  /** Fee the landlord has written off. */
  lateFeeWaived: number
  /** Still owed in fees: assessed − collected − waived, never negative. */
  lateFeeOutstanding: number
  /** The assessed fee hit the uncapped-rule ceiling (see `lateFeeDue`). */
  lateFeeCapped: boolean
  /** Rent + fee assessed. The figure "Expected" should always have shown. */
  expected: number
  /** Rent + fee money received. */
  collected: number
  /** Rent still owed, ignoring fees. */
  rentOutstanding: number
  /** expected − collected − waived, never negative. */
  balance: number
  settled: boolean
  /** Days past due, measured to `asOf` — see `lateFeeAsOf` for which date that is. */
  daysLate: number
  /**
   * The fee has stopped growing. True once the rent lands, and also true for an
   * ACH debit that is still clearing: it was submitted, so the fee froze there.
   */
  frozen: boolean
  /** The date the fee is measured to. */
  asOf: string
}

/** Utility-sourced line items on a payer, and their total. */
function utilityShareOf(tenant: PaymentPlanTenant | undefined) {
  const lines = (tenant?.line_items ?? []).filter(l => l.utility_id)
  return {
    lines: lines.map(l => ({ id: l.id, label: l.label, category: l.category, amount: Number(l.amount) })),
    total: round2(lines.reduce((s, l) => s + Number(l.amount), 0)),
  }
}

export function chargeBreakdown(
  sp: ScheduledPayment,
  rule: LateFeeRuleLike | null | undefined,
  tenant: PaymentPlanTenant | undefined,
  waiver: LateFeeWaiver | null | undefined,
  now = new Date(),
): ChargeBreakdown {
  const billed = Number(sp.amount)
  const util = utilityShareOf(tenant)

  // Only decompose when this row plainly still carries the payer's current
  // make-up. A prorated first month, a hand-edited amount, or a month billed
  // before the utility was declared must not be told it contains utilities.
  const monthly = Number(tenant?.monthly_total ?? 0)
  const splitKnown = util.total > 0 && Math.abs(billed - monthly) < 0.005

  const voided = sp.status === 'voided'
  const assessed = voided ? 0 : lateFeeDue(rule, sp, now)
  const collectedFee = Number(sp.late_fee_paid ?? 0)
  const overpaid = Math.max(0, round2(Number(sp.paid_amount ?? 0) - billed))
  const waived = waiver ? Math.min(assessed, Number(waiver.amount)) : 0
  const settled = rentIsSettled(sp)
  const asOf = lateFeeAsOf(sp, now)

  const rentOutstanding = voided ? 0 : Math.max(0, round2(billed - Number(sp.paid_amount ?? 0)))
  const expected = round2(billed + assessed)
  const collected = round2(Number(sp.paid_amount ?? 0) + collectedFee)

  return {
    billed,
    baseRent: splitKnown ? round2(billed - util.total) : billed,
    utilities: splitKnown ? util.total : 0,
    utilityLines: splitKnown ? util.lines : [],
    split: splitKnown ? 'known' : 'unknown',
    lateFeeAssessed: assessed,
    lateFeeCollected: collectedFee,
    lateFeeOverpaid: Math.min(assessed, overpaid),
    lateFeeWaived: waived,
    lateFeeOutstanding: Math.max(0, round2(assessed - collectedFee - overpaid - waived)),
    lateFeeCapped: voided ? false : lateFeeCappedByCharge(rule, sp, now),
    expected,
    collected,
    rentOutstanding,
    balance: Math.max(0, round2(expected - collected - waived)),
    settled,
    daysLate: Math.max(0, daysBetween(sp.due_date, asOf)),
    frozen: lateFeeFrozen(sp),
    asOf,
  }
}

// ─── ONE OUTSTANDING FEE ─────────────────────────────────────────────────────

/**
 * Which conversation a pending fee belongs to.
 *
 * `accruing` is a collections problem, `uncollected` is a decision, and the
 * difference is entirely whether the rent underneath has landed. Keeping them
 * in one list sorted by size would bury four urgent dollars under four hundred
 * stale ones.
 */
export type LateFeeBucket = 'accruing' | 'uncollected'

export const BUCKET_META: Record<LateFeeBucket, { label: string; hint: string; tone: 'bad' | 'warn' }> = {
  accruing: {
    label: 'Still growing',
    hint: 'The rent has not arrived, so the fee is getting bigger every day. Chase it with the rent.',
    tone: 'bad',
  },
  uncollected: {
    label: 'Never collected',
    hint: 'The rent was paid late and settled. The fee stopped there and was never asked for — bill it or write it off.',
    tone: 'warn',
  },
}

export type PendingLateFee = {
  /** The rent row the fee sits on. There is no row for the fee itself. */
  scheduledPaymentId: string
  planId: string
  leaseId: string | null
  propertyName: string
  leaseName: string
  payerId: string | null
  payerName: string
  payerEmail: string | null
  payerStatus: PaymentPlanTenant['status'] | null
  /** 'October 2026 rent' */
  label: string
  dueDate: string
  /** The rent the fee is attached to. */
  rentAmount: number
  /** Rent still owed on that charge. Zero for the `uncollected` bucket. */
  rentOutstanding: number
  bucket: LateFeeBucket
  /** The fee outstanding right now. */
  amount: number
  assessed: number
  collected: number
  daysLate: number
  /** How much more it accrues per day while it is still growing. */
  perDay: number
  /** What it will be 30 days from now if nothing changes. */
  in30Days: number
  capped: boolean
  /** Date the fee stopped growing, for a settled charge. */
  frozenOn: string | null
  /** The rule, so the email and the UI can explain the number. */
  rule: LateFeeRuleLike
  /** Late-fee reminders already sent about this charge. */
  reminderCount: number
  lastReminderAt: string | null
}

/** The fee's daily rate under its rule, for projecting it forward. */
const perDayOf = (rule: LateFeeRuleLike) =>
  round2(rule.fee_amount / Math.max(1, rule.frequency_days))

// ─── GROUPED FOR A HUMAN ─────────────────────────────────────────────────────

/**
 * One tenant's pending fees on one lease.
 *
 * Keyed per lease as well as per person, for the reason arrears are: the same
 * name on two tenancies is two separate conversations, and one email covering
 * both would be unanswerable.
 */
export type LateFeePayer = {
  key: string
  planId: string
  leaseId: string | null
  payerId: string | null
  name: string
  email: string | null
  payerStatus: PaymentPlanTenant['status'] | null
  propertyName: string
  leaseName: string
  fees: PendingLateFee[]
  total: number
  accruing: number
  uncollected: number
  perDay: number
  maxDaysLate: number
  oldestDue: string
  /** Rent still unpaid across these charges — what the fee rides on. */
  rentOutstanding: number
  rule: LateFeeRuleLike
  /** Highest reminder count across the charges. */
  reminderCount: number
  lastReminderAt: string | null
  /** Why sending this might be a bad idea. Empty when it is routine. */
  cautions: string[]
}

export type LateFeeProperty = {
  propertyName: string
  payers: LateFeePayer[]
  total: number
  accruing: number
  uncollected: number
}

export type LateFeeLedger = {
  payers: LateFeePayer[]
  properties: LateFeeProperty[]
  /** Everything outstanding in fees. */
  total: number
  accruing: number
  uncollected: number
  /** Daily growth across the whole portfolio. */
  perDay: number
  /** Fees genuinely received, for context beside what is owed. */
  collected: number
  /** Fees the landlord has written off. */
  waived: number
  feeCount: number
  payerCount: number
  maxDaysLate: number
  /** Rules with no ceiling, which is what makes these numbers explosive. */
  uncappedRules: { planId: string; leaseName: string; propertyName: string; note: string }[]
  empty: boolean
}

export const EMPTY_LEDGER: LateFeeLedger = {
  payers: [], properties: [], total: 0, accruing: 0, uncollected: 0, perDay: 0,
  collected: 0, waived: 0, feeCount: 0, payerCount: 0, maxDaysLate: 0,
  uncappedRules: [], empty: true,
}

/**
 * Reasons to hesitate before emailing a tenant about a fee.
 *
 * This is the judgement the product owes the landlord. Every pending fee on
 * this database is attached to rent that was accepted in full, some of it
 * months ago, under a rule with no ceiling — the worst case is a $741.96 fee on
 * $741.96 of rent that settled in June. A landlord who fires off 32 of those
 * will have a tenant revolt and, in many states, an unenforceable claim. So the
 * reasons are surfaced on the row, before the send, in plain words.
 */
function cautionsFor(fees: PendingLateFee[], now: Date): string[] {
  const out: string[] = []
  const settled = fees.filter(f => f.bucket === 'uncollected')
  const total = round2(fees.reduce((s, f) => s + f.amount, 0))
  const rent = round2(fees.reduce((s, f) => s + f.rentAmount, 0))

  if (settled.length === fees.length && fees.length > 0) {
    const today = billingToday(now)
    const oldest = settled.reduce((m, f) => (f.frozenOn && f.frozenOn < m ? f.frozenOn : m), today)
    const age = Math.max(0, daysBetween(oldest, today))
    if (age > 60) out.push(
      `The rent these fees sit on was settled ${age} days ago. Billing a fee this long after accepting rent in full is often unenforceable — check your state's rules first.`
    )
    else out.push('The rent is already settled, so this is a fee asked for after the fact rather than a nudge to pay.')
  }
  if (rent > 0 && total >= rent * 0.5) out.push(
    `The fees come to ${Math.round((total / rent) * 100)}% of the rent they are attached to. That is a consequence of an uncapped rule, not of how late the rent was.`
  )
  if (fees.some(f => f.capped)) out.push(
    'At least one fee was already trimmed to the size of its own rent charge, because the rule has no maximum.'
  )
  const chased = Math.max(0, ...fees.map(f => f.reminderCount))
  if (chased >= 2) out.push(`This tenant has already been asked about these fees ${chased} times.`)
  return out
}

/**
 * Every late fee still owed across these plans.
 *
 * `plans` should be whatever the page has in view; `waivers` are the landlord's
 * recorded write-offs, keyed by rent row. Voided rent is skipped — it was
 * cancelled, so there is nothing for a fee to attach to.
 */
export function lateFeeLedger(
  plans: PaymentPlan[],
  waivers: LateFeeWaiver[] = [],
  now = new Date(),
): LateFeeLedger {
  const waiverBy = new Map(waivers.map(w => [w.scheduled_payment_id, w]))
  const fees: PendingLateFee[] = []
  let collected = 0
  let waived = 0
  const uncappedRules: LateFeeLedger['uncappedRules'] = []

  for (const plan of plans) {
    const rule = plan.late_fee_rule ?? null
    if (!rule || rule.fee_amount <= 0) continue

    const propertyName = plan.property?.name ?? plan.name
    const risk = lateFeeRuleRisk(rule)
    if (risk) uncappedRules.push({ planId: plan.id, leaseName: plan.name, propertyName, note: risk })

    const payers = new Map(plan.tenants.map(t => [t.id, t]))

    for (const sp of plan.scheduled_payments ?? []) {
      if (sp.status === 'voided') continue
      const tenant = payers.get(sp.plan_tenant_id)
      const waiver = waiverBy.get(sp.id) ?? null
      const b = chargeBreakdown(sp, rule, tenant, waiver, now)

      collected += b.lateFeeCollected
      waived += b.lateFeeWaived
      if (b.lateFeeOutstanding <= 0.005) continue

      // Keyed on `frozen`, not `settled`: an ACH debit still clearing has not
      // landed, but it was submitted, so its fee stopped there. Calling that
      // "still growing" would tell the landlord to chase a fee that cannot get
      // any bigger and bill a tenant whose money is already on its way.
      const bucket: LateFeeBucket = b.frozen ? 'uncollected' : 'accruing'
      const perDay = bucket === 'accruing' ? perDayOf(rule) : 0

      fees.push({
        scheduledPaymentId: sp.id,
        planId: plan.id,
        leaseId: plan.lease_id ?? null,
        propertyName,
        leaseName: plan.name,
        payerId: sp.plan_tenant_id ?? null,
        payerName: tenant?.name ?? 'The lease',
        payerEmail: tenant?.email ?? null,
        payerStatus: tenant?.status ?? null,
        label: new Date(sp.due_date + 'T12:00:00')
          .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' rent',
        dueDate: sp.due_date,
        rentAmount: b.billed,
        rentOutstanding: b.rentOutstanding,
        bucket,
        amount: b.lateFeeOutstanding,
        assessed: b.lateFeeAssessed,
        collected: b.lateFeeCollected,
        daysLate: b.daysLate,
        perDay,
        // A capped fee has stopped growing even though the rent has not landed,
        // so projecting it forward would promise money the cap will not allow.
        in30Days: b.lateFeeCapped
          ? b.lateFeeOutstanding
          : round2(b.lateFeeOutstanding + perDay * 30),
        capped: b.lateFeeCapped,
        // The day it froze — submission for an in-flight debit, otherwise the
        // day the rent landed. `asOf` is already exactly that date.
        frozenOn: b.frozen ? b.asOf : null,
        rule,
        reminderCount: 0,
        lastReminderAt: null,
      })
    }
  }

  if (fees.length === 0) {
    return {
      ...EMPTY_LEDGER,
      collected: round2(collected),
      waived: round2(waived),
      uncappedRules,
      empty: true,
    }
  }

  const byPayer = new Map<string, PendingLateFee[]>()
  for (const f of fees) {
    const k = `${f.planId}:${f.payerId ?? 'lease'}`
    const arr = byPayer.get(k)
    if (arr) arr.push(f)
    else byPayer.set(k, [f])
  }

  const payers: LateFeePayer[] = [...byPayer.entries()].map(([key, fs]) => {
    const sorted = fs.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    return {
      key,
      planId: fs[0].planId,
      leaseId: fs[0].leaseId,
      payerId: fs[0].payerId,
      name: fs[0].payerName,
      email: fs[0].payerEmail,
      payerStatus: fs[0].payerStatus,
      propertyName: fs[0].propertyName,
      leaseName: fs[0].leaseName,
      fees: sorted,
      total: round2(fs.reduce((s, f) => s + f.amount, 0)),
      accruing: round2(fs.filter(f => f.bucket === 'accruing').reduce((s, f) => s + f.amount, 0)),
      uncollected: round2(fs.filter(f => f.bucket === 'uncollected').reduce((s, f) => s + f.amount, 0)),
      perDay: round2(fs.reduce((s, f) => s + f.perDay, 0)),
      maxDaysLate: fs.reduce((m, f) => Math.max(m, f.daysLate), 0),
      oldestDue: sorted[0].dueDate,
      rentOutstanding: round2(fs.reduce((s, f) => s + f.rentOutstanding, 0)),
      rule: fs[0].rule,
      reminderCount: Math.max(0, ...fs.map(f => f.reminderCount)),
      lastReminderAt: fs.reduce<string | null>(
        (m, f) => (f.lastReminderAt && (!m || f.lastReminderAt > m) ? f.lastReminderAt : m), null),
      cautions: cautionsFor(fs, now),
    }
    // Still-growing money first: it is the only part that gets worse by waiting.
  }).sort((a, b) =>
    b.accruing - a.accruing || b.total - a.total || a.name.localeCompare(b.name)
  )

  const byProperty = new Map<string, LateFeePayer[]>()
  for (const p of payers) {
    const arr = byProperty.get(p.propertyName)
    if (arr) arr.push(p)
    else byProperty.set(p.propertyName, [p])
  }

  const properties: LateFeeProperty[] = [...byProperty.entries()].map(([propertyName, ps]) => ({
    propertyName,
    payers: ps,
    total: round2(ps.reduce((s, p) => s + p.total, 0)),
    accruing: round2(ps.reduce((s, p) => s + p.accruing, 0)),
    uncollected: round2(ps.reduce((s, p) => s + p.uncollected, 0)),
  })).sort((a, b) => b.accruing - a.accruing || b.total - a.total)

  return {
    payers,
    properties,
    total: round2(payers.reduce((s, p) => s + p.total, 0)),
    accruing: round2(payers.reduce((s, p) => s + p.accruing, 0)),
    uncollected: round2(payers.reduce((s, p) => s + p.uncollected, 0)),
    perDay: round2(payers.reduce((s, p) => s + p.perDay, 0)),
    collected: round2(collected),
    waived: round2(waived),
    feeCount: fees.length,
    payerCount: payers.length,
    maxDaysLate: payers.reduce((m, p) => Math.max(m, p.maxDaysLate), 0),
    uncappedRules,
    empty: false,
  }
}

/** How a rule reads in a sentence, for the UI and the email alike. */
export function ruleSentence(rule: LateFeeRuleLike): string {
  const every = rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`
  const grace = rule.grace_period_days > 0
    ? ` after a ${rule.grace_period_days}-day grace period`
    : ', starting the day after rent is due'
  const cap = rule.max_total_fees != null
    ? ` It stops at $${rule.max_total_fees.toLocaleString('en-US')}.`
    : ' It has no maximum.'
  return `$${rule.fee_amount.toLocaleString('en-US')} every ${every}${grace}.${cap}`
}

/** Attach reminder history, which lives outside the plan rows. */
export function withReminderHistory(
  ledger: LateFeeLedger,
  history: Record<string, { count: number; lastAt: string | null }>,
): LateFeeLedger {
  if (ledger.empty) return ledger
  const patch = (f: PendingLateFee): PendingLateFee => {
    const h = history[f.scheduledPaymentId]
    return h ? { ...f, reminderCount: h.count, lastReminderAt: h.lastAt } : f
  }
  const payers = ledger.payers.map(p => {
    const fees = p.fees.map(patch)
    return {
      ...p,
      fees,
      reminderCount: Math.max(0, ...fees.map(f => f.reminderCount)),
      lastReminderAt: fees.reduce<string | null>(
        (m, f) => (f.lastReminderAt && (!m || f.lastReminderAt > m) ? f.lastReminderAt : m), null),
    }
  })
  return {
    ...ledger,
    payers,
    properties: ledger.properties.map(pr => ({
      ...pr,
      payers: pr.payers.map(p => payers.find(x => x.key === p.key) ?? p),
    })),
  }
}
