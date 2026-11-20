/**
 * What the portal needs this tenant to do, ranked.
 *
 * The tenant home page used to be a feed of things that *exist* — inquiries,
 * recommendations, a banner about listing a property — in a fixed order, with
 * the one genuinely time-sensitive item (an unsigned lease amendment) not on it
 * at all. A tenant three days past due with a document waiting for their
 * signature opened the portal to a greeting and a list of homes to browse. The
 * two things that have a deadline were one click down on another screen.
 *
 * So the home page leads with this: a short, ranked list of the things that are
 * actually waiting, each one naming its own next step. Everything else on the
 * page is browsing, and browsing goes below.
 *
 * Three rules it obeys:
 *
 *   1. **Nothing is invented.** Every figure and date here is read off a row
 *      the server sent. There are no projections, no "you'll probably owe", no
 *      estimated totals. If we do not know it, the action does not mention it.
 *   2. **Past due is decided by the billing day, not by the clock.** A tenant
 *      in Phoenix on the due date is not late, whatever UTC says — so dates
 *      are compared through `isPastDue`/`billingToday`, never
 *      `new Date()` arithmetic. See `src/lib/rentPayments.ts`.
 *   3. **One action per thing.** The engine returns at most one card per
 *      subject, because a list of five cards all saying "pay your rent" is a
 *      list a person stops reading.
 *
 * Pure, so it can be verified without a database: `npm run verify:tenant-actions`.
 */

import { billingToday, isPastDue, fmtMoney } from '@/lib/rentPayments'

/** How loudly an action is drawn, and in what order it sits. */
export type ActionUrgency = 'now' | 'soon' | 'info'

export type TenantAction = {
  /** Stable, so React keys and the verifier can both address it. */
  id: string
  urgency: ActionUrgency
  /** An icon name from `@/components/NavIcons`. */
  icon: 'creditCard' | 'signature' | 'calendar' | 'wrench' | 'refresh' | 'alert' | 'mail'
  title: string
  /** One or two sentences. Never speculative. */
  body: string
  cta: { label: string; href: string }
}

export type TenantActionInput = {
  /** Rent and charges that have reached their due date and are unpaid. */
  owed: number
  /** Outstanding late fees, separately — they are a different conversation. */
  lateFeesOwed: number
  /** The due date of the oldest unpaid charge, `YYYY-MM-DD`. */
  oldestDueDate: string | null
  /** The next charge still to come, when nothing is owed yet. */
  nextDueDate: string | null
  nextDueAmount: number | null
  /** Amendments addressed to this tenant and still unsigned. */
  pendingAmendments: { id: string; title: string; token: string; respondBy: string | null }[]
  /** A confirmed, upcoming tour, if there is one. */
  tour: { date: string; propertySlug: string | null; propertyName: string | null } | null
  /** Maintenance the landlord has shared that is still open on their home. */
  openMaintenance: number
  /** The end of the lease, for the renewal nudge. */
  leaseEnd: string | null
  /** A lease whose rent schedule has no payer matching this tenant. */
  unmatchedPlan?: boolean
  /** A demo tenancy collects nothing, so it must raise no money actions. */
  isDemo?: boolean
}

const ORDER: Record<ActionUrgency, number> = { now: 0, soon: 1, info: 2 }

/** "Nov 24" — the short form used on every date in the portal. */
function shortDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Whole days from today (in the billing zone) to a date. Negative if past. */
function daysUntil(d: string, now = new Date()): number {
  const today = billingToday(now)
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  const b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

export function tenantActions(input: TenantActionInput, now = new Date()): TenantAction[] {
  const out: TenantAction[] = []
  const money = input.owed + input.lateFeesOwed

  // ── Money ────────────────────────────────────────────────────────────────
  // A demo lease collects nothing. Raising a payment action on one would ask
  // a tenant for money that no part of the system is able to take.
  if (!input.isDemo && money > 0.005) {
    const late = input.oldestDueDate ? isPastDue(input.oldestDueDate, now) : false
    const days = input.oldestDueDate ? -daysUntil(input.oldestDueDate, now) : 0
    // Said in the order a tenant needs it: the amount, then whether they are
    // behind, then what the fee part is — because the fee is the bit that
    // makes the total disagree with the rent they expected.
    const feePart = input.lateFeesOwed > 0.005
      ? ` That includes ${fmtMoney(input.lateFeesOwed)} in late fees.`
      : ''
    out.push({
      id: 'pay',
      urgency: late ? 'now' : 'soon',
      icon: 'creditCard',
      title: late
        ? `${fmtMoney(money)} is past due`
        : `${fmtMoney(money)} is due`,
      body: late
        ? `Your rent was due ${shortDate(input.oldestDueDate!)}, ${days} ${days === 1 ? 'day' : 'days'} ago.${feePart}`
        : `Due ${shortDate(input.oldestDueDate!)}.${feePart}`,
      cta: { label: 'Pay now', href: '/dashboard/lease?tab=payments&pay=1' },
    })
  } else if (!input.isDemo && input.nextDueDate && input.nextDueAmount != null) {
    const d = daysUntil(input.nextDueDate, now)
    // Only inside a week. A rent payment 23 days out is not a thing anybody
    // needs an action card about, and putting it here is how the stack stops
    // meaning "these need you".
    if (d >= 0 && d <= 7) {
      out.push({
        id: 'pay-soon',
        urgency: 'soon',
        icon: 'creditCard',
        title: `${fmtMoney(input.nextDueAmount)} due ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`,
        body: `Your next rent is due ${shortDate(input.nextDueDate)}. Paying by bank transfer costs less than by card and takes 2–5 business days to clear.`,
        cta: { label: 'Pay early', href: '/dashboard/lease?tab=payments' },
      })
    }
  }

  // ── A document waiting on a signature ────────────────────────────────────
  // Always `now`: it is their landlord waiting, it changes the terms they live
  // under, and an email about it has very likely been buried.
  for (const a of input.pendingAmendments) {
    const by = a.respondBy ? daysUntil(a.respondBy, now) : null
    out.push({
      id: `amendment-${a.id}`,
      urgency: 'now',
      icon: 'signature',
      title: `Sign: ${a.title}`,
      body: by == null
        ? 'Your landlord has sent a change to your lease. Nothing takes effect until you sign it.'
        : by < 0
          ? `Your landlord asked for an answer by ${shortDate(a.respondBy!)}. It is still open — you can read it and sign or decline.`
          : by === 0
            ? 'Your landlord asked for an answer today.'
            : `Your landlord asked for an answer by ${shortDate(a.respondBy!)} — ${by} ${by === 1 ? 'day' : 'days'} away.`,
      cta: { label: 'Read and sign', href: `/dashboard/lease/amendments/${a.token}` },
    })
  }

  // ── A lease we cannot bill ───────────────────────────────────────────────
  // Not a money action — there is nothing to pay — but it is the only reason a
  // housed tenant would see an empty ledger, and it is fixable in one message.
  if (input.unmatchedPlan && !input.isDemo) {
    out.push({
      id: 'unmatched',
      urgency: 'now',
      icon: 'alert',
      title: 'We can’t match you to your rent schedule',
      body: 'Your landlord has a rent schedule for your home, but none of the payers on it uses your email address. Ask them to add it and your rent will appear here.',
      cta: { label: 'See your lease', href: '/dashboard/lease' },
    })
  }

  // ── A tour, while it is still ahead ──────────────────────────────────────
  if (input.tour) {
    const d = daysUntil(input.tour.date, now)
    if (d >= 0) {
      out.push({
        id: 'tour',
        urgency: d <= 1 ? 'now' : 'soon',
        icon: 'calendar',
        title: d === 0
          ? `Your tour is today`
          : d === 1 ? 'Your tour is tomorrow' : `Tour in ${d} days`,
        body: `${input.tour.propertyName ?? 'Your tour'} · ${shortDate(input.tour.date)}. The landlord confirmed it — they are expecting you.`,
        cta: input.tour.propertySlug
          ? { label: 'See the home', href: `/homes/${input.tour.propertySlug}` }
          : { label: 'See your inquiries', href: '/dashboard' },
      })
    }
  }

  // ── Renewal ──────────────────────────────────────────────────────────────
  // 90 days is when a student starts looking for next year, which is exactly
  // when a landlord wants them thinking about staying instead.
  if (input.leaseEnd) {
    const d = daysUntil(input.leaseEnd, now)
    if (d > 0 && d <= 90) {
      out.push({
        id: 'lease-ending',
        urgency: 'info',
        icon: 'refresh',
        title: `Your lease ends ${shortDate(input.leaseEnd)}`,
        body: `That is ${d} ${d === 1 ? 'day' : 'days'} away. If your landlord offers a renewal it will arrive by email and appear here — there is nothing to do yet.`,
        cta: { label: 'See lease details', href: '/dashboard/lease?tab=lease' },
      })
    }
  }

  // ── Work on their home ───────────────────────────────────────────────────
  if (input.openMaintenance > 0) {
    out.push({
      id: 'maintenance',
      urgency: 'info',
      icon: 'wrench',
      title: `${input.openMaintenance} open ${input.openMaintenance === 1 ? 'job' : 'jobs'} on your home`,
      body: 'Your landlord is tracking work here. Progress notes and photos appear as they happen.',
      cta: { label: 'See progress', href: '/dashboard/lease?tab=maintenance' },
    })
  }

  return out.sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency])
}
