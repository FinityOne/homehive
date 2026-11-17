/**
 * The tenant's view of their home's maintenance.
 *
 * Two separate jobs live here, and both of them are safety work:
 *
 *  1. **Who may see an item.** A maintenance row belongs to the landlord. A
 *     tenant may see it only when the landlord shared it (`tenant_visible`)
 *     *and* the tenant holds a currently-active lease on that property. Not a
 *     past lease: someone who moved out in May has no business watching this
 *     year's boiler replacement. Not a future one either — a signed lease that
 *     starts in August does not make July's work theirs to read.
 *
 *  2. **What of it they see.** Visibility is per *item*, never per *column*, so
 *     the shaping has to be explicit: an allow-list, not a delete-list. The
 *     estimate, the actual spend, the vendor's phone number, the landlord's
 *     working description, "reported_by: the housemate complained again" —
 *     none of it crosses. `shapeForTenant` is the only way a row becomes
 *     tenant-facing, and it builds a fresh object rather than spreading the
 *     row, so a column added to the table in 2027 is private by default.
 *
 * Pure: no Supabase, no fetch. Proven by `npm run verify:maintenance`.
 */

import { billingToday } from './rentPayments'
import { STATUS_META, KIND_META, type WorkKind, type WorkStatus } from './maintenance'

// ── What crosses the line ────────────────────────────────────────────────────

/** A photo as a tenant receives it: the image and its caption, nothing else. */
export type TenantPhoto = {
  id: string
  url: string
  caption: string | null
}

/**
 * One progress update as a tenant receives it.
 *
 * No `tenant_visible` — by the time one of these exists it has already passed
 * both gates, and shipping the flag would invite a client to re-decide a
 * question the server has answered.
 */
export type TenantWorkUpdate = {
  id: string
  body: string | null
  photos: TenantPhoto[]
  created_at: string
}

/** The update row shape this module reads. A superset arrives. */
export type ShareableUpdateRow = {
  id: string
  work_item_id: string
  body: string | null
  tenant_visible: boolean
  created_at: string
  photos?: { id: string; url: string; caption: string | null; position?: number }[] | null
}

/** A work item as the tenant portal receives it. Deliberately small. */
export type TenantWorkItem = {
  id: string
  property_id: string
  title: string
  kind: WorkKind
  status: WorkStatus
  /** The sentence the landlord wrote *to* the tenant. Never `description`. */
  note: string | null
  area: string | null
  /** When the landlord expects it done, if they committed to a date. */
  target_date: string | null
  scheduled_for: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  /**
   * The shared progress log, newest first. Always an array, never absent —
   * `item.updates.length` is read all over the UI and an optional field there
   * is a crash waiting for the one item nobody has updated.
   */
  updates: TenantWorkUpdate[]
}

/** The row shape this module needs. A superset arrives; only this is read. */
export type ShareableWorkRow = {
  id: string
  property_id: string
  lease_id: string | null
  title: string
  kind: WorkKind
  status: WorkStatus
  tenant_visible: boolean
  tenant_note: string | null
  area: string | null
  target_date: string | null
  scheduled_for: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Strip a landlord row down to what a tenant may read.
 *
 * Written as construction, not subtraction. `{ ...row, estimated_cost:
 * undefined }` is the version of this function that leaks: it leaks the next
 * column somebody adds, and it leaks it silently.
 */
/**
 * The progress updates on one item that this tenant may read.
 *
 * **Two gates, and the second is the one that is easy to miss.** An update is
 * shown only when the update is shared *and the item itself is shared*. An
 * update published against a private job would otherwise reveal the job — "the
 * plumber comes Thursday" tells a tenant about plumbing work they were never
 * told about, which is exactly the leak the item-level flag exists to prevent.
 * A landlord who shares an update and forgets the item has published nothing,
 * and the landlord UI says so in words (`updateReach`).
 *
 * Empty updates are dropped: a row with no note and no photo renders as a
 * timestamped bubble saying nothing, which reads as a bug.
 *
 * Newest first, because the tenant's live question is "where is this now".
 */
export function visibleUpdates(
  item: { id: string; tenant_visible: boolean },
  updates: ShareableUpdateRow[],
): TenantWorkUpdate[] {
  if (!item.tenant_visible) return []
  // `rows.map(shapeForTenant)` is the obvious way to call the shaper, and
  // `Array.prototype.map` passes the *index* as the second argument — so this
  // arrives as `0` and `.filter` throws. Guarding here rather than trusting
  // every call site to write the arrow out.
  if (!Array.isArray(updates)) return []
  return updates
    .filter(u => u.work_item_id === item.id && u.tenant_visible)
    .map(u => ({
      id: u.id,
      body: u.body?.trim() || null,
      // Built field by field, like the item itself — `storage_path` and
      // `owner_id` are on the row and neither is the tenant's business.
      photos: [...(u.photos ?? [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(p => ({ id: p.id, url: p.url, caption: p.caption ?? null })),
      created_at: u.created_at,
    }))
    .filter(u => !!u.body || u.photos.length > 0)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

export function shapeForTenant(
  row: ShareableWorkRow,
  updates: ShareableUpdateRow[] = [],
): TenantWorkItem {
  return {
    id: row.id,
    property_id: row.property_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    note: row.tenant_note ?? null,
    area: row.area ?? null,
    target_date: row.target_date ?? null,
    scheduled_for: row.scheduled_for ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    updates: visibleUpdates(row, updates),
  }
}

// ── Who may see it ───────────────────────────────────────────────────────────

export type LeaseWindow = {
  id: string
  property_id: string
  start_date: string | null
  end_date: string | null
}

/**
 * Is this tenancy running right now?
 *
 * Judged on the Phoenix calendar, like rent — a UTC `new Date()` rolls over at
 * 5pm local and would end a tenancy on the afternoon of its last day, locking
 * a tenant out of the portal while they still live there. An open-ended lease
 * (no end date) counts as running; a lease with no start date does not, because
 * that is a draft, not a tenancy.
 */
export function leaseIsActive(lease: LeaseWindow, now = new Date()): boolean {
  const today = billingToday(now)
  if (!lease.start_date) return false
  if (lease.start_date > today) return false
  if (lease.end_date && lease.end_date < today) return false
  return true
}

/**
 * The items a given set of tenancies may see.
 *
 * Three gates, all of which must hold:
 *   • the landlord shared the item
 *   • the tenant holds an *active* lease at that property
 *   • if the item names a lease, it is one of theirs — work scoped to unit 2's
 *     tenancy is not unit 3's business, even in the same building
 */
export function visibleToTenant(
  rows: ShareableWorkRow[],
  leases: LeaseWindow[],
  now = new Date(),
  updates: ShareableUpdateRow[] = [],
): TenantWorkItem[] {
  const active = leases.filter(l => leaseIsActive(l, now))
  if (active.length === 0) return []
  const properties = new Set(active.map(l => l.property_id))
  const leaseIds = new Set(active.map(l => l.id))

  return rows
    .filter(r =>
      r.tenant_visible &&
      properties.has(r.property_id) &&
      (r.lease_id === null || leaseIds.has(r.lease_id)))
    .map(r => shapeForTenant(r, updates))
}

/** An active lease plus the people on it, for counting an audience. */
export type AudienceLease = LeaseWindow & { tenants?: { id: string }[] | null }

/**
 * Who would actually see an item shared on this property, right now.
 *
 * The landlord side needs this because the share toggle is otherwise a promise
 * with no stated audience: flipping it on a vacant unit looks like it published
 * something and publishes nothing, and flipping it on an occupied one gives no
 * hint that six housemates are about to read the sentence you typed. Both of
 * those get a landlord to distrust the control, so the control states its own
 * reach.
 *
 * Counted off *active* leases only — the same gate the tenant route applies, so
 * the number a landlord is shown is the number of people who can really see it.
 */
export function shareAudience(
  propertyId: string,
  leases: AudienceLease[],
  now = new Date(),
): { leases: number; residents: number } {
  const active = leases.filter(l => l.property_id === propertyId && leaseIsActive(l, now))
  return {
    leases: active.length,
    residents: active.reduce((n, l) => n + (l.tenants?.length ?? 0), 0),
  }
}

/** The audience in words, for a label next to the toggle. */
export function describeAudience(a: { leases: number; residents: number }): string {
  if (a.leases === 0) return 'No active tenancy here — nobody can see shared items yet'
  if (a.residents === 0) return 'Active tenancy, but no residents are recorded on it yet'
  return a.residents === 1 ? '1 resident can see shared items' : `${a.residents} residents can see shared items`
}

// ── How it reads ─────────────────────────────────────────────────────────────

/**
 * What a tenant is told about a status.
 *
 * Not the landlord's labels. "To do" is a landlord's word for a queue position
 * and reads to a tenant as "nobody has looked at this"; `blocked` is worse —
 * it is an internal state ("waiting on a part") that reads as "abandoned". The
 * tenant's question is only ever "is someone dealing with this, and when", so
 * every status answers that. `cancelled` is deliberately absent: an item the
 * landlord called off is not a thing to show a tenant as a half-event, so it
 * is filtered out entirely below.
 */
export const TENANT_STATUS_META: Record<
  Exclude<WorkStatus, 'cancelled'>,
  { label: string; blurb: string; color: string; bg: string; done: boolean }
> = {
  todo:        { label: 'Reported',    blurb: 'Logged and queued — your landlord has it', color: '#475569', bg: '#f1f5f9', done: false },
  scheduled:   { label: 'Scheduled',   blurb: 'Booked in with a date',                    color: '#1d4ed8', bg: '#eff6ff', done: false },
  in_progress: { label: 'In progress', blurb: 'Work has started',                         color: '#b45309', bg: '#fef3c7', done: false },
  blocked:     { label: 'On hold',     blurb: 'Waiting on a part, a quote or access',     color: '#9f1239', bg: '#fff1f2', done: false },
  completed:   { label: 'Completed',   blurb: 'Finished',                                 color: '#065f46', bg: '#d1fae5', done: true },
}

/** Tenant-facing wording for the type of work. Landlord jargon doesn't travel. */
export const TENANT_KIND_LABEL: Record<WorkKind, string> = {
  repair:       'Repair',
  tenant_issue: 'Reported issue',
  upgrade:      'Improvement',
  preventive:   'Routine servicing',
  compliance:   'Safety & compliance',
  turnover:     'Make-ready',
  known_issue:  'Known issue',
}

export const tenantKindLabel = (k: WorkKind) => TENANT_KIND_LABEL[k] ?? KIND_META[k]?.label ?? 'Work'

export const isTenantDone = (i: TenantWorkItem) => i.status === 'completed'

/**
 * Split into the two lists a tenant actually asked for.
 *
 * "Pending and completed" is the whole mental model: what is still coming, and
 * proof of what has been done. Cancelled items are dropped — showing a tenant
 * work that was called off invites a question the portal cannot answer.
 *
 * Pending sorts by the soonest committed date first, because that is the only
 * thing a waiting tenant wants ranked; items with no date fall to the end
 * (newest first) rather than pretending to a position in the queue. Completed
 * sorts most-recently-finished first.
 */
export function splitForTenant(items: TenantWorkItem[]): {
  pending: TenantWorkItem[]
  completed: TenantWorkItem[]
} {
  const live = items.filter(i => i.status !== 'cancelled')

  const when = (i: TenantWorkItem) => i.scheduled_for || i.target_date || null

  const pending = live.filter(i => !isTenantDone(i)).sort((a, b) => {
    const da = when(a), db = when(b)
    if (da && db) return da < db ? -1 : da > db ? 1 : 0
    if (da) return -1
    if (db) return 1
    return a.created_at < b.created_at ? 1 : -1
  })

  const completed = live.filter(isTenantDone).sort((a, b) => {
    const da = a.completed_at ?? a.updated_at
    const db = b.completed_at ?? b.updated_at
    return da < db ? 1 : da > db ? -1 : 0
  })

  return { pending, completed }
}

/**
 * One line for the top of the section.
 *
 * A tenant with nothing outstanding should be told that in words, not left to
 * infer it from an empty list — an empty list looks like a page that failed to
 * load, and "nothing outstanding" is genuinely good news worth stating.
 */
export function summarise(
  items: TenantWorkItem[],
  now = new Date(),
): { pendingCount: number; completedCount: number; scheduledNext: TenantWorkItem | null; headline: string } {
  const { pending, completed } = splitForTenant(items)
  const today = billingToday(now)
  const scheduledNext = pending.find(i => {
    const d = i.scheduled_for || i.target_date
    return !!d && d >= today
  }) ?? null

  const headline =
    pending.length === 0
      ? completed.length === 0
        ? 'No maintenance has been shared with you for this home yet.'
        : 'Nothing outstanding — every shared job here is done.'
      : pending.length === 1
        ? '1 job is open on this home.'
        : `${pending.length} jobs are open on this home.`

  return { pendingCount: pending.length, completedCount: completed.length, scheduledNext, headline }
}

/** `STATUS_META` is the landlord's; re-exported so a caller can't cross them. */
export { STATUS_META as LANDLORD_STATUS_META }
