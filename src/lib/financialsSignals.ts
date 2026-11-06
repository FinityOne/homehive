/**
 * What the numbers *mean* — the judgement layer.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The overview answers "what are the figures". It does not answer the question
 * a landlord actually arrives with, which is **"is anything wrong, and what do
 * I do about it?"** Those are different jobs, and reading the first as the
 * second is work the product was leaving to the human: a 78% collection rate
 * is not information until you know it was 96% for the six months before, and
 * that two tenants at one address account for all of the drop.
 *
 * So this module is the opinion. Each signal names a specific thing that is
 * true of this portfolio right now, in plain words, with the evidence that
 * makes it true and the one place to go and act on it.
 *
 * ── Rules every signal obeys ───────────────────────────────────────────────
 *
 *   1. **Never invent a comparison we cannot make.** Nothing snapshots
 *      arrears, so there is no honest "arrears up 12% this week" and this
 *      module does not pretend otherwise. Comparisons are only ever between
 *      *completed* months, or against a payer's own settled history.
 *   2. **Evidence, always.** A signal that cannot name the leases or people
 *      behind it is a horoscope. Every one carries `evidence` lines, and they
 *      are the reason the landlord will trust the next one.
 *   3. **One route out.** Each signal links to the surface where the work
 *      happens. A signal with nothing to press is a complaint.
 *   4. **Silence is a valid output.** A dashboard that always finds five
 *      problems is one a landlord learns to ignore. On a healthy portfolio
 *      this returns the one positive signal and stops.
 *   5. **Severity is about money and irreversibility**, not loudness. A
 *      closing deposit window outranks a larger debt that is three days old,
 *      because one of them stops being fixable.
 *
 * Pure: dashboard in, signals out. No clock beyond the `now` passed in.
 */

import { fmtCurrency } from '@/lib/payments'

import { monthLabel, type Charge } from '@/lib/financialsMonth'
import { leaseHref, planHref } from '@/lib/financialsTree'
import type { Dashboard } from '@/lib/financialsDashboard'

const round2 = (n: number) => Math.round(n * 100) / 100

// ─── PAYER RELIABILITY ───────────────────────────────────────────────────────

/**
 * How a person actually pays, from their own settled history.
 *
 * This is the figure arrears cannot give you. `overdue` only ever describes
 * what is *still* unpaid, so a tenant who settles three weeks late every single
 * month is invisible in every arrears total the moment their money lands — and
 * they are the tenancy you would not renew. Reliability remembers.
 *
 * `score` exists to sort by, not to show as a grade: a landlord reads the band
 * and the median, and the number only decides who appears first.
 */
export type Reliability = {
  key: string
  planId: string
  payerId: string | null
  name: string
  email: string | null
  propertyName: string
  leaseName: string
  /** Charges that have settled, ever. */
  settled: number
  onTime: number
  late: number
  /** Share of settled charges that arrived late, 0–100. */
  lateRate: number | null
  /** Typical lateness when they are late — the median, not the mean, so one
   *  disastrous month does not describe a tenant who is usually two days off. */
  medianDaysLate: number
  worstDaysLate: number
  /** Owed right now, fees included. */
  owed: number
  /** Reminders sent about their currently overdue charges. */
  chased: number
  /** 0–100, higher is better. For ranking only. */
  score: number
  band: 'reliable' | 'slips' | 'chronic' | 'delinquent'
  /** The band in words, because a colour is never the only signal. */
  bandLabel: string
  /** One sentence a landlord could read out. */
  note: string
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

const BAND_LABEL: Record<Reliability['band'], string> = {
  reliable:   'Pays on time',
  slips:      'Occasionally late',
  chronic:    'Chronically late',
  delinquent: 'In arrears now',
}

/**
 * Reliability for every payer in view, worst first.
 *
 * Keyed per lease as well as per person, for the reason arrears are: the same
 * name on two tenancies is two separate relationships, and averaging them
 * would describe neither.
 */
export function reliability(charges: Charge[]): Reliability[] {
  const byPayer = new Map<string, Charge[]>()
  for (const c of charges) {
    const k = `${c.planId}:${c.payerId ?? 'lease'}`
    const arr = byPayer.get(k)
    if (arr) arr.push(c)
    else byPayer.set(k, [c])
  }

  const owedOf = new Map<string, number>()
  const chasedOf = new Map<string, number>()
  for (const [k, cs] of byPayer) {
    owedOf.set(k, round2(cs.filter(c => c.state === 'overdue').reduce((n, c) => n + c.totalDue, 0)))
    chasedOf.set(k, cs.filter(c => c.state === 'overdue').reduce((n, c) => Math.max(n, c.chases.count), 0))
  }

  const out: Reliability[] = []
  for (const [key, cs] of byPayer) {
    const settled = cs.filter(c => c.settlement !== null && c.settlement.daysLate !== null)
    const late = settled.filter(c => (c.settlement!.daysLate ?? 0) > 0)
    const lateDays = late.map(c => c.settlement!.daysLate ?? 0)
    const lateRate = settled.length > 0 ? Math.round((late.length / settled.length) * 100) : null
    const med = median(lateDays)
    const owed = owedOf.get(key) ?? 0

    // Lateness dominates, then how late, then whether they are behind today.
    // A tenant with no history scores neutral rather than perfect — we do not
    // know them yet, and ranking them above a proven payer would be wrong.
    const base = settled.length === 0 ? 70 : 100
    const score = Math.max(0, Math.min(100, Math.round(
      base
      - (lateRate ?? 0) * 0.5
      - Math.min(med, 30)
      - (owed > 0 ? 25 : 0),
    )))

    const band: Reliability['band'] =
      owed > 0 ? 'delinquent'
      : (lateRate ?? 0) >= 50 ? 'chronic'
      : (lateRate ?? 0) > 0 ? 'slips'
      : 'reliable'

    const note =
      owed > 0
        ? `Owes ${fmtCurrency(owed)} right now.`
        : settled.length === 0
          ? 'Nothing has settled yet, so there is no pattern to read.'
          : late.length === 0
            ? `All ${settled.length} payment${settled.length !== 1 ? 's' : ''} arrived on time.`
            : `Late on ${late.length} of ${settled.length} payments, typically by ${med} day${med !== 1 ? 's' : ''}.`

    out.push({
      key,
      planId: cs[0].planId,
      payerId: cs[0].payerId,
      name: cs[0].who ?? 'The lease',
      email: cs[0].whoEmail,
      propertyName: cs[0].propertyName,
      leaseName: cs[0].leaseName,
      settled: settled.length,
      onTime: settled.length - late.length,
      late: late.length,
      lateRate,
      medianDaysLate: med,
      worstDaysLate: lateDays.length > 0 ? Math.max(...lateDays) : 0,
      owed,
      chased: chasedOf.get(key) ?? 0,
      score,
      band,
      bandLabel: BAND_LABEL[band],
      note,
    })
  }

  // Worst first: that is the order a landlord works the list in.
  return out.sort((a, b) => a.score - b.score || b.owed - a.owed || a.name.localeCompare(b.name))
}

// ─── SIGNALS ─────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'watch' | 'good'

export type Signal = {
  id: string
  severity: Severity
  /** Short enough to read at a glance; a claim, not a category. */
  title: string
  /** One or two sentences: what is true, and why it matters. */
  detail: string
  /** The specific leases, people or figures behind the claim. */
  evidence: string[]
  /** Where the work happens. */
  action: { label: string; href: string }
  /** The money this signal is about, when it is about money. Sorts ties. */
  amount?: number
  /** An icon key the UI maps to a glyph. */
  icon: 'alert' | 'clock' | 'trend-down' | 'trend-up' | 'mail' | 'calendar' | 'shield' | 'check' | 'users'
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, watch: 1, good: 0 }

/** A lease is in its leverage window once the deposit is about to go back. */
const DEPOSIT_WINDOW_DAYS = 75

/** Below this, a collection rate is a problem rather than a rounding error. */
const RATE_FLOOR = 95

/** Overdue this long with nothing sent is the self-inflicted case. */
const UNCHASED_DAYS = 7

/**
 * Everything worth saying about this portfolio right now, worst first.
 *
 * Reads the dashboard it is given rather than recomputing anything, so a signal
 * can never disagree with the tile above it.
 */
export function signals(d: Dashboard): Signal[] {
  const out: Signal[] = []
  const rel = reliability(d.charges)

  // ── 1. Debt old enough to stop being collectable ──
  const severe = d.aging.find(b => b.id === 'severe')
  if (severe && severe.amount > 0) {
    const people = d.arrears.payers.filter(p => p.maxDaysLate > 60)
    out.push({
      id: 'aged-debt',
      severity: 'critical',
      title: `${fmtCurrency(severe.amount)} has been overdue for more than 60 days`,
      detail:
        'Debt this old is rarely recovered by email. In much of the US it is also the point at which ' +
        'a formal notice is the only step that changes anything.',
      evidence: people.slice(0, 4).map(p =>
        `${p.name} — ${fmtCurrency(p.total)}, oldest charge ${p.maxDaysLate} days past due (${p.propertyName})`),
      action: { label: 'Open the 60+ day list', href: '/landlord/financials/collections?age=severe' },
      amount: severe.amount,
      icon: 'alert',
    })
  }

  // ── 2. The leverage window: a deposit about to go back over an unpaid debt ──
  //
  // The single most expensive mistake in this product's domain. Once the
  // deposit is returned the landlord has no leverage and, in practice, no
  // recovery. It outranks larger debts because it is the only one with a
  // deadline attached.
  for (const l of d.tree.leases) {
    if (l.daysLeft === null || l.daysLeft < 0 || l.daysLeft > DEPOSIT_WINDOW_DAYS) continue
    if (l.owed <= 0 || l.depositsHeld <= 0) continue
    out.push({
      id: `deposit-window-${l.key}`,
      severity: 'critical',
      title: `${l.propertyName} owes ${fmtCurrency(l.owed)} and ends in ${l.daysLeft} days`,
      detail:
        `You are holding ${fmtCurrency(l.depositsHeld)} of deposit against it. Settle or document the ` +
        'debt before the deposit is returned — afterwards there is usually no way to collect it.',
      evidence: [
        `Term ends ${l.termEnd ?? 'unknown'} · ${l.activePayers} tenant${l.activePayers !== 1 ? 's' : ''}`,
        l.owed > l.depositsHeld
          ? `The debt exceeds the deposit by ${fmtCurrency(l.owed - l.depositsHeld)}`
          : `The deposit covers it, with ${fmtCurrency(l.depositsHeld - l.owed)} to spare`,
      ],
      action: { label: 'Open this lease', href: leaseHref(l.key) },
      amount: l.owed,
      icon: 'shield',
    })
  }

  // ── 3. Overdue and never chased ──
  //
  // The one entirely self-inflicted problem on the list. A tenant who has not
  // been asked is not refusing to pay.
  const unchased = d.arrears.payers.filter(p =>
    p.maxDaysLate >= UNCHASED_DAYS &&
    p.charges.every(c => c.chases.count === 0))
  if (unchased.length > 0) {
    const total = round2(unchased.reduce((n, p) => n + p.total, 0))
    out.push({
      id: 'never-chased',
      severity: 'warning',
      title: `${unchased.length} ${unchased.length === 1 ? 'tenant has' : 'tenants have'} never been asked for ${fmtCurrency(total)}`,
      detail:
        'No reminder has been sent about any of these charges. The cheapest collection step in this ' +
        'product has not been taken yet.',
      evidence: unchased.slice(0, 4).map(p =>
        `${p.name} — ${fmtCurrency(p.total)}, ${p.maxDaysLate} days late, 0 reminders (${p.propertyName})`),
      action: { label: 'Chase them', href: '/landlord/financials/collections' },
      amount: total,
      icon: 'mail',
    })
  }

  // ── 4. Collection slipping against this portfolio's own history ──
  //
  // Compared only between *completed* months: a month still running has not
  // finished collecting, and comparing it to a finished one invents a crisis
  // every time a landlord looks before the rent is due.
  const done = d.trend.filter(t => t.position === 'past' && t.rate !== null)
  if (done.length >= 3) {
    const last = done[done.length - 1]
    const priorRates = done.slice(0, -1).map(t => t.rate!)
    const typical = median(priorRates)
    const drop = typical - last.rate!
    if (last.rate! < RATE_FLOOR && drop >= 5) {
      const culprits = d.arrears.payers
        .filter(p => p.charges.some(c => c.dueDate.slice(0, 7) === last.key))
        .slice(0, 4)
      out.push({
        id: 'rate-slip',
        severity: 'warning',
        title: `${last.longLabel} collected ${last.rate}% — ${drop} points below your usual ${typical}%`,
        detail:
          `${fmtCurrency(last.stillDue)} of that month is still outstanding. One weak month is noise; ` +
          'two in a row is a pattern worth acting on.',
        evidence: [
          `Billed ${fmtCurrency(last.billed)}, collected ${fmtCurrency(last.collected)}`,
          ...culprits.map(p => `${p.name} — ${fmtCurrency(p.total)} of it (${p.propertyName})`),
        ],
        action: { label: `Open ${last.longLabel}`, href: `/landlord/financials/schedule?month=${last.key}` },
        amount: last.stillDue,
        icon: 'trend-down',
      })
    }
  }

  // ── 5. Chronically late but never in arrears ──
  //
  // Invisible to every other figure in the product, and the one that decides a
  // renewal. These tenants always pay — just never when they agreed to.
  const chronic = rel.filter(r => r.band === 'chronic' && r.settled >= 3)
  if (chronic.length > 0) {
    out.push({
      id: 'chronic-late',
      severity: 'watch',
      title: `${chronic.length} ${chronic.length === 1 ? 'tenant pays' : 'tenants pay'} late most months`,
      detail:
        'They do pay, so they never appear in arrears — but your rent arrives after you need it. ' +
        'This is the figure to look at before renewing a lease.',
      evidence: chronic.slice(0, 4).map(r =>
        `${r.name} — late on ${r.late} of ${r.settled}, typically ${r.medianDaysLate} days (${r.propertyName})`),
      action: { label: 'See payment behaviour', href: '/landlord/financials/payments' },
      icon: 'clock',
    })
  }

  // ── 6. Arrears concentrated in one place ──
  //
  // Changes the response entirely: one building in trouble is a management
  // problem, the same money spread across nine is simply collections.
  if (d.arrears.total > 0 && d.tree.propertyCount > 1) {
    const worst = d.properties.filter(p => p.owed > 0).sort((a, b) => b.owed - a.owed)[0]
    if (worst && worst.owed / d.arrears.total >= 0.6) {
      out.push({
        id: 'concentration',
        severity: 'watch',
        title: `${Math.round((worst.owed / d.arrears.total) * 100)}% of everything owed is at ${worst.propertyName}`,
        detail:
          'Arrears this concentrated are usually about one building rather than about collections — ' +
          'the unit, the rent level, or the tenants it is attracting.',
        evidence: [
          `${fmtCurrency(worst.owed)} of ${fmtCurrency(d.arrears.total)} portfolio-wide`,
          `${worst.leases.length} lease${worst.leases.length !== 1 ? 's' : ''} · ${worst.payerCount} payer${worst.payerCount !== 1 ? 's' : ''} · ${fmtCurrency(worst.monthly)}/mo contracted`,
        ],
        action: { label: `Open ${worst.propertyName}`, href: `/landlord/financials/portfolio#p-${worst.propertyId}` },
        amount: worst.owed,
        icon: 'users',
      })
    }
  }

  // ── 7. A late-fee rule with no ceiling ──
  if (d.fees.uncappedRules.length > 0) {
    const r = d.fees.uncappedRules[0]
    out.push({
      id: 'uncapped-fee',
      severity: 'watch',
      title: `${d.fees.uncappedRules.length} late-fee rule${d.fees.uncappedRules.length !== 1 ? 's have' : ' has'} no maximum`,
      detail:
        'An uncapped fee grows until it exceeds the rent it is attached to, at which point it is ' +
        'usually unenforceable and always unbillable in practice. Each one is held down to the size ' +
        'of its charge here, but the rule itself should be fixed.',
      evidence: d.fees.uncappedRules.slice(0, 3).map(x => `${x.propertyName} — ${x.note}`),
      action: { label: 'Open the plan', href: planHref(r.planId) },
      icon: 'alert',
    })
  }

  // ── 8. Fees frozen on rent that already settled ──
  if (d.fees.uncollected > 0) {
    out.push({
      id: 'frozen-fees',
      severity: 'watch',
      title: `${fmtCurrency(d.fees.uncollected)} of late fees was never asked for`,
      detail:
        'The rent these sat on has settled in full, so nothing is urgent and nothing is growing. ' +
        'You have a real choice: bill them late, or write them off and clear the list.',
      evidence: [
        `${d.fees.payerCount} ${d.fees.payerCount === 1 ? 'person' : 'people'} · ${d.fees.feeCount} fee${d.fees.feeCount !== 1 ? 's' : ''}`,
        d.fees.waived > 0 ? `${fmtCurrency(d.fees.waived)} already written off` : 'none written off yet',
      ],
      action: { label: 'Open the fee ledger', href: '/landlord/financials/collections#fees' },
      amount: d.fees.uncollected,
      icon: 'clock',
    })
  }

  // ── 9. Money in flight — the one signal that says *stop* ──
  if (d.clearing.amount > 0) {
    out.push({
      id: 'clearing',
      severity: 'watch',
      title: `${fmtCurrency(d.clearing.amount)} is clearing through the bank`,
      detail:
        'Already sent by the tenant and not yet landed. Do not chase it — a bank transfer on this ' +
        'platform spends days in flight, and the lag is the bank’s, not theirs.',
      evidence: [`${d.clearing.count} payment${d.clearing.count !== 1 ? 's' : ''} in flight`],
      action: { label: 'See what is clearing', href: '/landlord/financials/payments?state=clearing' },
      amount: d.clearing.amount,
      icon: 'clock',
    })
  }

  // ── 10. A property with nothing running ──
  const idle = d.tree.properties.filter(p => p.activeLeases === 0)
  if (idle.length > 0) {
    out.push({
      id: 'no-live-lease',
      severity: 'watch',
      title: `${idle.length} propert${idle.length !== 1 ? 'ies have' : 'y has'} no live lease`,
      detail:
        'Nothing is being billed against them, so they contribute no rent this month. If they are ' +
        'let, the lease or its payment plan has not been set up.',
      evidence: idle.slice(0, 4).map(p =>
        `${p.propertyName} — ${p.leases.length} lease${p.leases.length !== 1 ? 's' : ''} on record, none running`),
      action: { label: 'Open the portfolio', href: '/landlord/financials/portfolio?leases=all' },
      icon: 'calendar',
    })
  }

  // ── 11. Credit where it is due ──
  //
  // A dashboard that only ever reports problems teaches its reader that the
  // insights panel is bad news, and they stop reading it. When the portfolio is
  // genuinely healthy, say so — and only then.
  if (out.filter(s => s.severity !== 'watch').length === 0 && d.behaviour.settled >= 3) {
    const rate = d.rate12
    out.push({
      id: 'healthy',
      severity: 'good',
      title: d.owed === 0
        ? 'Nothing is overdue anywhere in the portfolio'
        : `Collection is holding at ${rate}%`,
      detail:
        d.behaviour.rate !== null && d.behaviour.rate >= 90
          ? `${d.behaviour.rate}% of settled charges arrived on or before their due date over the last ` +
            `${d.behaviour.months} months. That is a portfolio you can plan around.`
          : 'Every charge that has come due has been settled.',
      evidence: [
        `${fmtCurrency(d.received12)} collected over the last ${d.behaviour.months} months`,
        d.next30.amount > 0
          ? `${fmtCurrency(d.next30.amount)} due in the next 30 days`
          : 'nothing falls due in the next 30 days',
      ],
      action: { label: 'See the months ahead', href: '/landlord/financials/schedule' },
      icon: 'check',
    })
  }

  return out.sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (b.amount ?? 0) - (a.amount ?? 0)
  )
}

/**
 * The one sentence that goes at the top of the page.
 *
 * A landlord who reads nothing else should still leave knowing the state of
 * their business and what to press. It is deliberately not a figure — the
 * figures are directly underneath it — and it never says "everything is fine"
 * unless it is.
 */
export type Pulse = {
  tone: 'critical' | 'warning' | 'calm'
  /** The state of the business, in one clause. */
  headline: string
  /** Why, in one sentence. */
  line: string
  action: { label: string; href: string } | null
}

export function pulse(d: Dashboard, list: Signal[]): Pulse {
  if (d.empty) {
    return {
      tone: 'calm',
      headline: 'Nothing is being tracked yet',
      line: 'Set up a payment plan against a lease and this page fills in — collection, arrears, what is coming.',
      action: { label: 'Create a payment plan', href: '/landlord/financials/new' },
    }
  }

  const worst = list[0]
  const month = monthLabel(d.thisMonth.key)

  if (d.owed > 0) {
    const tone = list.some(s => s.severity === 'critical') ? 'critical' : 'warning'
    return {
      tone,
      headline: `${fmtCurrency(d.owed)} is overdue`,
      line:
        `From ${d.owedPayers} ${d.owedPayers === 1 ? 'person' : 'people'} across ` +
        `${d.owedCharges} charge${d.owedCharges !== 1 ? 's' : ''}, the oldest ${d.worstDaysLate} ` +
        `day${d.worstDaysLate !== 1 ? 's' : ''} past due. ` +
        (worst && worst.severity === 'critical'
          ? worst.title + '.'
          : `${fmtCurrency(d.thisMonth.collected)} of ${month} has been collected so far.`),
      action: { label: 'Work the collections list', href: '/landlord/financials/collections' },
    }
  }

  return {
    tone: 'calm',
    headline: 'Everyone is up to date',
    line:
      `Every charge that has come due has been paid. ${
        d.next30.amount > 0
          ? `${fmtCurrency(d.next30.amount)} falls due in the next 30 days across ${d.next30.count} charge${d.next30.count !== 1 ? 's' : ''}.`
          : 'Nothing falls due in the next 30 days.'
      }`,
    action: d.expiring.length > 0
      ? {
          label: `${d.expiring.length} lease${d.expiring.length !== 1 ? 's' : ''} ending soon`,
          href: '/landlord/renewals',
        }
      : { label: 'See the months ahead', href: '/landlord/financials/schedule' },
  }
}

