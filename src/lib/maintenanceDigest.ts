/**
 * The weekly maintenance digest — what a landlord's work list looks like on a
 * Friday morning.
 *
 * Pure: it takes the rows and returns the shape of the email. No Supabase, no
 * Resend, no `new Date()` without being handed one — so the Friday cron and a
 * manual send cannot disagree about what "overdue" means, and the buckets are
 * testable without a mailbox.
 *
 * ── Why these buckets ─────────────────────────────────────────────────────
 *
 * A digest that just counts open items is wallpaper; it reads the same every
 * week and gets filtered. These five answer different questions, in the order
 * a landlord actually cares about them:
 *
 *   • `overdue`     — the target date has passed. The only bucket that is a
 *                     failure, so it leads, and it says how late.
 *   • `dueSoon`     — lands in the next 7 days. This is the week's work, and
 *                     the whole reason the mail goes out on a Friday.
 *   • `stalled`     — `blocked`, or `in_progress` for longer than a fortnight.
 *                     Work that is technically moving is how a list rots
 *                     without ever looking bad.
 *   • `completed`   — finished since the last digest, with what it cost. The
 *                     only bucket that is good news, and the reason to open
 *                     next week's.
 *   • `openRest`    — every other open item: no target date, or a date further
 *                     out than the horizon. The point of this one is
 *                     completeness, so the mail *is* the list and nobody has
 *                     to open the app to see what is outstanding.
 *
 * `undatedCount` survives as a nudge — those items are listed in `openRest`
 * now, but "8 of these will never show up as due" is a prompt to go and set
 * dates, which the list alone does not say.
 *
 * Deliberately *not* here: cancelled work. It was decided against, and listing
 * it invites the landlord to re-litigate a closed call every Friday.
 */
import {
  isOpen,
  isOverdue,
  computeTotals,
  type WorkItem,
  type WorkTotals,
} from './maintenance'
import { billingToday } from './rentPayments'

/** The window a digest reports on: a week back, a week forward. */
export const DIGEST_WINDOW_DAYS = 7

/**
 * How long `in_progress` is allowed to mean "being worked on".
 *
 * A fortnight, because a genuine job spans a weekend and a vendor callback,
 * and nagging on day three teaches the landlord to ignore the mail. Past that
 * it is not in progress, it is forgotten.
 */
export const STALLED_AFTER_DAYS = 14

/** The opt-out category for this mail. Shared with the unsubscribe route. */
export const MAINTENANCE_DIGEST_CATEGORY = 'maintenance_digest'

export type DigestLine = {
  id: string
  title: string
  propertyName: string
  propertySlug: string | null
  area: string | null
  kind: WorkItem['kind']
  priority: WorkItem['priority']
  status: WorkItem['status']
  targetDate: string | null
  /** Days past the target date. Positive only, and only for `overdue`. */
  daysLate: number | null
  /** Days until the target date. `0` means today. Only for `dueSoon`. */
  daysUntil: number | null
  /** How long it has sat in its current status. Only for `stalled`. */
  daysInStatus: number | null
  /** Open, with no target date at all — so it can never read as due. */
  undated?: boolean
  estimatedCost: number | null
  actualCost: number | null
  tenantVisible: boolean
}

export type MaintenanceDigest = {
  /** The Phoenix calendar date this digest describes. */
  asOf: string
  /** Start of the look-back window, inclusive. */
  since: string
  overdue: DigestLine[]
  dueSoon: DigestLine[]
  stalled: DigestLine[]
  completed: DigestLine[]
  /**
   * Every open item not already named above — undated, or dated past the
   * horizon. Together with the three buckets before it this covers the whole
   * open list, so the email never hides outstanding work behind a count.
   */
  openRest: DigestLine[]
  /** Open items carrying no target date. Listed in `openRest`, counted here. */
  undatedCount: number
  /** Items added during the look-back window. */
  addedCount: number
  /** Properties with at least one open item. */
  propertyCount: number
  totals: WorkTotals
  /** Actual cost booked on work completed inside the window. */
  spentInWindow: number
  /**
   * Is there anything here worth an email?
   *
   * False means send nothing at all. A landlord with an empty list does not
   * need a weekly reminder that it is empty — that mail trains them to filter
   * the one that matters.
   */
  worthSending: boolean
}

const DAY = 86_400_000

/** Whole days between two YYYY-MM-DD calendar dates. Positive if `b` is later. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)
}

/** A calendar date `n` days from `from`, in the same YYYY-MM-DD shape. */
function shiftDate(from: string, n: number): string {
  return new Date(Date.parse(`${from}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

const propertyNameOf = (i: WorkItem): string =>
  i.property?.name?.trim() || 'Your property'

function lineOf(i: WorkItem, extra: Partial<DigestLine> = {}): DigestLine {
  return {
    id: i.id,
    title: i.title,
    propertyName: propertyNameOf(i),
    propertySlug: i.property?.slug ?? null,
    area: i.area,
    kind: i.kind,
    priority: i.priority,
    status: i.status,
    targetDate: i.target_date,
    daysLate: null,
    daysUntil: null,
    daysInStatus: null,
    estimatedCost: i.estimated_cost,
    actualCost: i.actual_cost,
    tenantVisible: i.tenant_visible,
    ...extra,
  }
}

/** Worst first, by priority then by how late. */
const PRIORITY_RANK: Record<WorkItem['priority'], number> = {
  emergency: 0, high: 1, medium: 2, low: 3,
}

export function buildMaintenanceDigest(
  items: WorkItem[],
  now = new Date(),
): MaintenanceDigest {
  // One Phoenix calendar date for the whole computation. Asking the clock twice
  // is how a digest generated at 23:59 reports two different days.
  const asOf = billingToday(now)
  const since = shiftDate(asOf, -DIGEST_WINDOW_DAYS)
  const horizon = shiftDate(asOf, DIGEST_WINDOW_DAYS)

  const overdue: DigestLine[] = []
  const dueSoon: DigestLine[] = []
  const stalled: DigestLine[] = []
  const completed: DigestLine[] = []
  const openRest: DigestLine[] = []
  const openProperties = new Set<string>()
  // Which open items a named bucket has already claimed. The catch-all is the
  // remainder, computed rather than re-derived from the same conditions — two
  // copies of "is this due soon?" is how an item ends up printed twice or not
  // at all.
  const named = new Set<string>()
  let undatedCount = 0
  let addedCount = 0
  let spentInWindow = 0

  for (const i of items) {
    // Cancelled work is not news. It was decided against, and listing it
    // invites the landlord to re-litigate a closed call every Friday.
    if (i.status === 'cancelled') continue

    const createdDate = billingToday(new Date(i.created_at))
    if (createdDate >= since) addedCount++

    if (isOpen(i)) {
      openProperties.add(i.property_id)

      if (isOverdue(i, now)) {
        overdue.push(lineOf(i, { daysLate: daysBetween(i.target_date!, asOf) }))
        named.add(i.id)
      } else if (i.target_date && i.target_date <= horizon) {
        dueSoon.push(lineOf(i, { daysUntil: daysBetween(asOf, i.target_date) }))
        named.add(i.id)
      }

      if (!i.target_date) undatedCount++

      // Stalled is orthogonal to the dates above — a blocked item with next
      // week's target date belongs in both, and saying so twice is the point.
      const sinceUpdate = daysBetween(billingToday(new Date(i.updated_at)), asOf)
      if (i.status === 'blocked' || (i.status === 'in_progress' && sinceUpdate >= STALLED_AFTER_DAYS)) {
        stalled.push(lineOf(i, { daysInStatus: sinceUpdate }))
        named.add(i.id)
      }

      // Anything still unnamed is open work the landlord has not been shown.
      if (!named.has(i.id)) {
        openRest.push(lineOf(i, i.target_date
          ? { daysUntil: daysBetween(asOf, i.target_date) }
          : { undated: true }))
      }
      continue
    }

    // Completed. Only what landed inside the window — the digest reports on a
    // week, not on the history of the property.
    const doneDate = i.completed_at ? billingToday(new Date(i.completed_at)) : null
    if (doneDate && doneDate >= since) {
      completed.push(lineOf(i))
      spentInWindow += Math.round((i.actual_cost ?? 0) * 100)
    }
  }

  const byPriority = (a: DigestLine, b: DigestLine) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]

  overdue.sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0) || byPriority(a, b))
  dueSoon.sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0) || byPriority(a, b))
  stalled.sort((a, b) => (b.daysInStatus ?? 0) - (a.daysInStatus ?? 0) || byPriority(a, b))
  completed.sort((a, b) => byPriority(a, b) || a.propertyName.localeCompare(b.propertyName))
  // Dated work first, soonest to furthest, then the undated tail. An item with
  // a date is a commitment; one without is a wish, and it reads as the backlog
  // it is when it sits at the bottom.
  openRest.sort((a, b) =>
    (a.daysUntil == null ? 1 : 0) - (b.daysUntil == null ? 1 : 0) ||
    (a.daysUntil ?? 0) - (b.daysUntil ?? 0) ||
    byPriority(a, b) ||
    a.propertyName.localeCompare(b.propertyName)
  )

  const totals = computeTotals(items, now)

  return {
    asOf,
    since,
    overdue,
    dueSoon,
    stalled,
    completed,
    openRest,
    undatedCount,
    addedCount,
    propertyCount: openProperties.size,
    totals,
    spentInWindow: spentInWindow / 100,
    // Open work, or something finished this week. Both empty means the list is
    // genuinely quiet and there is nothing to say.
    worthSending: totals.open > 0 || completed.length > 0,
  }
}

/**
 * The subject line.
 *
 * Leads with the number that should change behaviour, because that is all a
 * phone shows. Overdue beats everything, then this week's work, then the
 * finished-something case, which is the only cheerful one.
 */
export function digestSubject(d: MaintenanceDigest, label?: string | null): string {
  const where = label ? ` — ${label}` : ''
  const n = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`

  if (d.overdue.length > 0) {
    const due = d.dueSoon.length > 0 ? `, ${n(d.dueSoon.length, 'due this week')}` : ''
    return `${n(d.overdue.length, 'maintenance item')} overdue${due}${where}`
  }
  if (d.dueSoon.length > 0) {
    return `${n(d.dueSoon.length, 'maintenance item')} due this week${where}`
  }
  if (d.stalled.length > 0) {
    return `${n(d.stalled.length, 'maintenance item')} waiting on you${where}`
  }
  if (d.completed.length > 0) {
    return `${n(d.completed.length, 'maintenance item')} finished this week${where}`
  }
  return `Your maintenance list — ${n(d.totals.open, 'open item')}${where}`
}
