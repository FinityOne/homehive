// One feed, four surfaces.
//
// Everything a landlord's residents and applicants do lands in
// `landlord_activity` (see the migrations). This file is the only place that
// decides what any of it *looks like* — the verb, the icon, the colour, which
// filter it answers to, and whether it is the kind of thing that should make a
// badge appear. The bell panel, the full Activity page, and the small feeds
// embedded on a property or a lease all read it, so they cannot drift into
// describing the same event three different ways.
//
// It is deliberately pure: no Supabase, no React, no `Date.now()` captured at
// module scope. `npm run verify:activity` runs the whole thing with fixed
// inputs, including the check that the kind list here still matches the check
// constraint in SQL — the one piece of drift that would render blank rows in
// production and pass every type check on the way there.

// ─── The vocabulary ──────────────────────────────────────────────────────────

/**
 * Mirrors `landlord_activity_kind_check`.
 *
 * Adding a kind means: the SQL constraint, this list, and `KIND_META` below.
 * The verify script fails if the first two disagree, and TypeScript fails if
 * the third is incomplete.
 */
export const ACTIVITY_KINDS = [
  'rent.paid',
  'charge.paid',
  'payment.submitted',
  'payment.failed',
  'email.sent',
  'tenant.login',
  'tenant.signup',
  'lead.new',
  'lead.prescreen',
  'tour.booked',
  'notice.other',
] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** One row of the feed, as the API returns it. */
export type ActivityEvent = {
  id: string
  kind: ActivityKind
  occurred_at: string
  title: string
  detail: string | null
  href: string | null
  actor_name: string | null
  actor_email: string | null
  property_id: string | null
  plan_id: string | null
  amount: number | null
  meta: Record<string, unknown>
}

// ─── What each kind means on screen ──────────────────────────────────────────

/**
 * The lanes the filter chips offer.
 *
 * Four, not eleven. A filter list as long as the feed is a second feed, and
 * the question a landlord actually arrives with is one of these four: did the
 * money come in, did we write to them, are they using the portal, is anything
 * new coming down the funnel.
 */
export const ACTIVITY_LANES = ['money', 'email', 'residents', 'leasing'] as const
export type ActivityLane = (typeof ACTIVITY_LANES)[number]

export const LANE_LABEL: Record<ActivityLane, string> = {
  money: 'Money',
  email: 'Email',
  residents: 'Residents',
  leasing: 'Leasing',
}

export type KindMeta = {
  /** The verb, for a heading that groups several of these together. */
  label: string
  lane: ActivityLane
  /** An `IconName` from `@/components/NavIcons`. */
  icon: 'creditCard' | 'receipt' | 'bell' | 'message' | 'user' | 'userCheck' | 'target' | 'calendar' | 'dot'
  /**
   * Colour family for the row's dot. `good` and `bad` are states, never
   * actions — the money design system reserves blue for things you can click.
   */
  tone: 'good' | 'bad' | 'warn' | 'neutral' | 'info'
  /**
   * Does an unread one of these deserve the landlord's attention *today*?
   *
   * This drives the "Needs attention" tab, not the badge. The badge counts
   * everything unread, because a badge that silently ignores some unread rows
   * is the dishonest kind the write-ups warn about — a count that does not
   * match the list underneath it teaches people to stop reading both.
   */
  attention: boolean
}

export const KIND_META: Record<ActivityKind, KindMeta> = {
  // Money arriving is the single most-read line in any landlord product, so it
  // gets the strongest positive colour and never shares a row style with
  // anything advisory.
  'rent.paid':          { label: 'Rent paid',        lane: 'money',     icon: 'creditCard', tone: 'good',    attention: false },
  'charge.paid':        { label: 'Charge paid',      lane: 'money',     icon: 'receipt',    tone: 'good',    attention: false },
  // Submitted is genuinely ambiguous — the money is in flight. Warn, not good:
  // an ACH transfer that reads as "paid" and then fails three days later is
  // how a landlord learns to distrust the whole screen.
  'payment.submitted':  { label: 'Payment sent',     lane: 'money',     icon: 'creditCard', tone: 'warn',    attention: false },
  'payment.failed':     { label: 'Payment failed',   lane: 'money',     icon: 'creditCard', tone: 'bad',     attention: true },
  'email.sent':         { label: 'Email',            lane: 'email',     icon: 'message',    tone: 'neutral', attention: false },
  'tenant.login':       { label: 'Portal sign-in',   lane: 'residents', icon: 'user',       tone: 'neutral', attention: false },
  'tenant.signup':      { label: 'Account created',  lane: 'residents', icon: 'userCheck',  tone: 'info',    attention: false },
  'lead.new':           { label: 'New lead',         lane: 'leasing',   icon: 'target',     tone: 'info',    attention: true },
  'lead.prescreen':     { label: 'Pre-screen filled',lane: 'leasing',   icon: 'userCheck',  tone: 'info',    attention: true },
  'tour.booked':        { label: 'Tour booked',      lane: 'leasing',   icon: 'calendar',   tone: 'info',    attention: true },
  'notice.other':       { label: 'Notice',           lane: 'leasing',   icon: 'bell',       tone: 'neutral', attention: false },
}

/** Unknown kinds fall back rather than rendering an empty row. */
export function metaFor(kind: string): KindMeta {
  return KIND_META[kind as ActivityKind] ?? KIND_META['notice.other']
}

// ─── Email outcome ───────────────────────────────────────────────────────────

/**
 * An email row's real state, promoted out of `meta` because it is the only
 * thing that makes a send worth reading twice.
 *
 * A bounce is not a neutral fact in a feed — it is the reason a tenant "never
 * replies". So it overrides the row's tone.
 */
export type EmailOutcome = 'sent' | 'delivered' | 'opened' | 'bounced' | 'complained' | 'failed'

const OUTCOME_TONE: Record<EmailOutcome, KindMeta['tone']> = {
  sent: 'neutral',
  delivered: 'neutral',
  opened: 'good',
  bounced: 'bad',
  complained: 'bad',
  failed: 'bad',
}

export const OUTCOME_LABEL: Record<EmailOutcome, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Opened',
  bounced: 'Bounced',
  complained: 'Marked spam',
  failed: 'Failed to send',
}

export function emailOutcome(e: ActivityEvent): EmailOutcome | null {
  if (e.kind !== 'email.sent') return null
  const raw = e.meta?.outcome
  return typeof raw === 'string' && raw in OUTCOME_LABEL ? (raw as EmailOutcome) : 'sent'
}

/** The tone actually painted on a row, after an email's outcome has its say. */
export function toneFor(e: ActivityEvent): KindMeta['tone'] {
  const outcome = emailOutcome(e)
  if (outcome) return OUTCOME_TONE[outcome]
  return metaFor(e.kind).tone
}

/**
 * True when a row is a problem the landlord has not dealt with.
 *
 * A delivered email is history. A bounced one is a job. Same kind, different
 * answer — which is why this reads the outcome rather than the kind alone.
 */
export function needsAttention(e: ActivityEvent): boolean {
  const outcome = emailOutcome(e)
  if (outcome) return outcome === 'bounced' || outcome === 'complained' || outcome === 'failed'
  return metaFor(e.kind).attention
}

// ─── Read state ──────────────────────────────────────────────────────────────

/**
 * Unread is a watermark comparison, not a flag.
 *
 * `lastReadAt` of null means the landlord has never opened the feed — which
 * happens only for an account created after the backfill, so everything they
 * have is genuinely new to them.
 */
export function isUnread(e: ActivityEvent, lastReadAt: string | null): boolean {
  if (!lastReadAt) return true
  return new Date(e.occurred_at).getTime() > new Date(lastReadAt).getTime()
}

export function unreadCount(events: ActivityEvent[], lastReadAt: string | null): number {
  return events.reduce((n, e) => n + (isUnread(e, lastReadAt) ? 1 : 0), 0)
}

/**
 * What the badge says.
 *
 * Capped, because the number stops being information somewhere around twenty —
 * past that a landlord is reading "a lot", and an exact 147 only makes the
 * list feel like a chore before it is opened.
 */
export const BADGE_CAP = 20
export function badgeLabel(count: number): string {
  if (count <= 0) return ''
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count)
}

// ─── Filtering ───────────────────────────────────────────────────────────────

export type ActivityFilter = {
  /** Null means every lane. */
  lane?: ActivityLane | null
  /** Only rows the landlord has not seen. */
  unreadOnly?: boolean
  /** Only rows that are a problem — the "Needs attention" tab. */
  attentionOnly?: boolean
  /** Free-text over title, detail and the person's name/email. */
  query?: string
}

export function filterEvents(
  events: ActivityEvent[],
  filter: ActivityFilter,
  lastReadAt: string | null,
): ActivityEvent[] {
  const q = (filter.query ?? '').trim().toLowerCase()
  return events.filter(e => {
    if (filter.lane && metaFor(e.kind).lane !== filter.lane) return false
    if (filter.unreadOnly && !isUnread(e, lastReadAt)) return false
    if (filter.attentionOnly && !needsAttention(e)) return false
    if (q) {
      const hay = [e.title, e.detail, e.actor_name, e.actor_email]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * The counts behind the tabs.
 *
 * Computed over the *unfiltered* list on purpose: a tab whose number changes
 * when you click a different tab is a tab nobody can navigate by.
 */
export type LaneCounts = { all: number; unread: number; attention: number } & Record<ActivityLane, number>

export function laneCounts(events: ActivityEvent[], lastReadAt: string | null): LaneCounts {
  const counts = {
    all: events.length,
    unread: 0,
    attention: 0,
    money: 0, email: 0, residents: 0, leasing: 0,
  } as LaneCounts
  for (const e of events) {
    if (isUnread(e, lastReadAt)) counts.unread++
    if (needsAttention(e)) counts.attention++
    counts[metaFor(e.kind).lane]++
  }
  return counts
}

// ─── Grouping and time ───────────────────────────────────────────────────────

/**
 * "Today" is a Phoenix day, not a UTC one.
 *
 * Rent due on the 1st and paid at 7pm Phoenix on the 1st is a UTC 2nd. Every
 * date in this product is decided in America/Phoenix for exactly that reason,
 * and a feed that files a payment under tomorrow is a feed a landlord will
 * quietly stop believing.
 */
export const BILLING_TZ = 'America/Phoenix'

export function phoenixDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  // en-CA gives YYYY-MM-DD, which sorts.
  return d.toLocaleDateString('en-CA', { timeZone: BILLING_TZ })
}

export type ActivityDay = { day: string; label: string; events: ActivityEvent[] }

/**
 * Group into day buckets, newest first, with a human heading.
 *
 * Grouping is what turns a feed into something scannable: a landlord looking
 * for "what happened while I was away" navigates by day, never by row.
 */
export function groupByDay(events: ActivityEvent[], now: Date = new Date()): ActivityDay[] {
  const today = phoenixDay(now)
  const yesterday = phoenixDay(new Date(now.getTime() - 86400000))

  const buckets = new Map<string, ActivityEvent[]>()
  for (const e of events) {
    const day = phoenixDay(e.occurred_at)
    const list = buckets.get(day)
    if (list) list.push(e)
    else buckets.set(day, [e])
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({
      day,
      label: day === today ? 'Today' : day === yesterday ? 'Yesterday' : dayLabel(day),
      events: list.sort(
        (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
      ),
    }))
}

/** "Mon 3 Nov" from a YYYY-MM-DD, with the year once it is not this one. */
export function dayLabel(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number)
  // Noon avoids the date moving when the string is reinterpreted as UTC.
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  const sameYear = y === Number(phoenixDay(now).slice(0, 4))
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short', month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** "4m ago" for the recent, a clock time for the rest of today, else a date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const mins = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (phoenixDay(then) === phoenixDay(now)) {
    return then.toLocaleTimeString('en-US', {
      timeZone: BILLING_TZ, hour: 'numeric', minute: '2-digit',
    })
  }
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return dayLabel(phoenixDay(then), now)
}

/** `$1,234.56`, or an empty string — a feed never prints `$0.00` for "no amount". */
export function money(amount: number | null | undefined): string {
  if (amount == null) return ''
  return amount.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  })
}

// ─── Scoping, for the embedded feeds ─────────────────────────────────────────

/**
 * Which rows belong on a given page.
 *
 * The same feed is shown on a property, on a lease's money page and (once it
 * lands) on a tenant's record. Each is a narrowing, never a different list —
 * which is what lets every one of them link to the same Activity page with the
 * same filter applied, instead of being a dead end.
 *
 * A tenant is scoped **by email**, because that is the only thing joining a
 * `tenants` row to a payer: `payment_plan_tenants` has no `tenant_id`.
 */
export type ActivityScope = {
  propertyId?: string | null
  planId?: string | null
  email?: string | null
}

export function scopeMatches(e: ActivityEvent, scope: ActivityScope): boolean {
  if (scope.propertyId && e.property_id !== scope.propertyId) return false
  if (scope.planId && e.plan_id !== scope.planId) return false
  if (scope.email && (e.actor_email ?? '').toLowerCase() !== scope.email.toLowerCase()) return false
  return true
}

/** The Activity page URL that shows exactly what an embedded feed is showing. */
export function activityHref(scope: ActivityScope = {}, lane?: ActivityLane | null): string {
  const params = new URLSearchParams()
  if (scope.propertyId) params.set('property', scope.propertyId)
  if (scope.planId) params.set('plan', scope.planId)
  if (scope.email) params.set('email', scope.email)
  if (lane) params.set('lane', lane)
  const qs = params.toString()
  return qs ? `/landlord/activity?${qs}` : '/landlord/activity'
}

/**
 * The line under an event's title: who, and how much.
 *
 * Built here rather than in the row component so the bell panel, the page and
 * the embedded feeds all say the same thing in the same order.
 */
export function subtitleFor(e: ActivityEvent): string {
  const parts: string[] = []
  const who = e.actor_name || e.actor_email
  if (who) parts.push(who)
  if (e.amount != null && e.kind !== 'email.sent') parts.push(money(e.amount))
  if (e.detail) parts.push(e.detail)
  return parts.join(' · ')
}
