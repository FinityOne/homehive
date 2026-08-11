import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkKind =
  | 'upgrade' | 'repair' | 'tenant_issue' | 'known_issue'
  | 'preventive' | 'turnover' | 'compliance'

export type WorkPriority = 'emergency' | 'high' | 'medium' | 'low'

export type WorkStatus =
  | 'todo' | 'scheduled' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'

export type WorkItem = {
  id: string
  owner_id: string
  property_id: string
  room_id: string | null
  lease_id: string | null
  area: string | null
  title: string
  description: string | null
  kind: WorkKind
  priority: WorkPriority
  status: WorkStatus
  estimated_cost: number | null
  actual_cost: number | null
  target_date: string | null
  scheduled_for: string | null
  completed_at: string | null
  vendor_name: string | null
  vendor_contact: string | null
  assigned_to: string | null
  reported_by: string | null
  notes: string | null
  inspection_item_id: string | null
  position: number
  created_at: string
  updated_at: string
  property?: { id: string; name: string; slug: string }
}

// ── Display metadata ─────────────────────────────────────────────────────────

export const KIND_META: Record<WorkKind, { label: string; blurb: string; icon: string; color: string; bg: string }> = {
  upgrade:      { label: 'Upgrade',       blurb: 'Planned improvement — new flooring, better fixtures, repaint', icon: '⬆', color: '#6d28d9', bg: '#f5f3ff' },
  repair:       { label: 'Repair',        blurb: 'Something broken that needs fixing',                            icon: '🔧', color: '#b45309', bg: '#fffbeb' },
  tenant_issue: { label: 'Tenant issue',  blurb: 'Reported by a tenant during the tenancy',                       icon: '👤', color: '#0e7490', bg: '#ecfeff' },
  known_issue:  { label: 'Known issue',   blurb: 'Accepted defect you are living with for now',                   icon: '⚑', color: '#64748b', bg: '#f8fafc' },
  preventive:   { label: 'Preventive',    blurb: 'Routine servicing on a cycle — filters, gutters, HVAC',         icon: '🔁', color: '#047857', bg: '#ecfdf5' },
  turnover:     { label: 'Turnover',      blurb: 'Make-ready work between tenancies',                             icon: '🔑', color: '#1d4ed8', bg: '#eff6ff' },
  compliance:   { label: 'Compliance',    blurb: 'Safety or legal — alarms, permits, inspections',                icon: '🛡', color: '#9f1239', bg: '#fff1f2' },
}

export const PRIORITY_META: Record<WorkPriority, { label: string; color: string; bg: string; border: string }> = {
  emergency: { label: 'Emergency', color: '#991b1b', bg: '#fee2e2', border: '#fca5a5' },
  high:      { label: 'High',      color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  medium:    { label: 'Medium',    color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  low:       { label: 'Low',       color: '#64748b', bg: '#f1f5f9', border: '#e2e8f0' },
}

export const STATUS_META: Record<WorkStatus, { label: string; color: string; bg: string; open: boolean }> = {
  todo:        { label: 'To do',       color: '#475569', bg: '#f1f5f9', open: true },
  scheduled:   { label: 'Scheduled',   color: '#1d4ed8', bg: '#eff6ff', open: true },
  in_progress: { label: 'In progress', color: '#b45309', bg: '#fef3c7', open: true },
  blocked:     { label: 'Blocked',     color: '#9f1239', bg: '#fff1f2', open: true },
  completed:   { label: 'Completed',   color: '#065f46', bg: '#d1fae5', open: false },
  cancelled:   { label: 'Cancelled',   color: '#94a3b8', bg: '#f8fafc', open: false },
}

export const KIND_ORDER: WorkKind[] = ['upgrade', 'repair', 'tenant_issue', 'turnover', 'preventive', 'compliance', 'known_issue']
export const PRIORITY_ORDER: WorkPriority[] = ['emergency', 'high', 'medium', 'low']
export const STATUS_ORDER: WorkStatus[] = ['todo', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled']

const PRIORITY_WEIGHT: Record<WorkPriority, number> = { emergency: 0, high: 1, medium: 2, low: 3 }
const STATUS_WEIGHT: Record<WorkStatus, number> = {
  blocked: 0, in_progress: 1, scheduled: 2, todo: 3, completed: 4, cancelled: 5,
}

export const isOpen = (item: WorkItem) => STATUS_META[item.status].open

/**
 * Default ordering: the thing most likely to bite you first.
 * Open work outranks closed, emergencies outrank everything, then an overdue
 * target date, then priority, then oldest — so nothing quietly rots at the
 * bottom of the list.
 */
export function sortWorkItems(items: WorkItem[], today = new Date()): WorkItem[] {
  const stamp = today.toISOString().split('T')[0]
  const overdue = (i: WorkItem) =>
    isOpen(i) && !!i.target_date && i.target_date < stamp ? 0 : 1

  return [...items].sort((a, b) =>
    (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) ||
    PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] ||
    overdue(a) - overdue(b) ||
    STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
    (a.created_at < b.created_at ? -1 : 1)
  )
}

export function isOverdue(item: WorkItem, today = new Date()): boolean {
  if (!isOpen(item) || !item.target_date) return false
  return item.target_date < today.toISOString().split('T')[0]
}

// ── Money ────────────────────────────────────────────────────────────────────

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export type WorkTotals = {
  open: number
  completed: number
  /** Estimated cost of everything still open — the committed spend ahead. */
  estimatedOpen: number
  /** Actual spend on completed work. */
  actualSpent: number
  /** Estimate vs actual on completed items only; positive = over budget. */
  variance: number
  varianceBase: number
  emergencies: number
  overdue: number
}

export function computeTotals(items: WorkItem[], today = new Date()): WorkTotals {
  const cents = (n: number | null) => Math.round((n ?? 0) * 100)
  let estimatedOpen = 0, actualSpent = 0, estOnCompleted = 0
  let open = 0, completed = 0, emergencies = 0, overdue = 0

  for (const i of items) {
    if (i.status === 'cancelled') continue
    if (isOpen(i)) {
      open++
      estimatedOpen += cents(i.estimated_cost)
      if (i.priority === 'emergency') emergencies++
      if (isOverdue(i, today)) overdue++
    } else {
      completed++
      actualSpent += cents(i.actual_cost)
      // Only compare where both numbers exist, or the variance is meaningless.
      if (i.actual_cost != null && i.estimated_cost != null) {
        estOnCompleted += cents(i.estimated_cost)
      }
    }
  }

  const actualOnComparable = items
    .filter(i => !isOpen(i) && i.status !== 'cancelled' && i.actual_cost != null && i.estimated_cost != null)
    .reduce((s, i) => s + cents(i.actual_cost), 0)

  return {
    open,
    completed,
    estimatedOpen: estimatedOpen / 100,
    actualSpent: actualSpent / 100,
    variance: (actualOnComparable - estOnCompleted) / 100,
    varianceBase: estOnCompleted / 100,
    emergencies,
    overdue,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

const SELECT = `*, property:properties ( id, name, slug )`

function map(row: any): WorkItem {
  return {
    ...row,
    estimated_cost: row.estimated_cost == null ? null : Number(row.estimated_cost),
    actual_cost: row.actual_cost == null ? null : Number(row.actual_cost),
  }
}

export async function getWorkItems(ownerId: string): Promise<WorkItem[]> {
  const { data, error } = await supabase
    .from('property_work_items')
    .select(SELECT)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map(map)
}

export async function getWorkItemsForProperty(propertyId: string): Promise<WorkItem[]> {
  const { data, error } = await supabase
    .from('property_work_items')
    .select(SELECT)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map(map)
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type WorkItemInput = {
  property_id: string
  title: string
  kind: WorkKind
  priority: WorkPriority
  status: WorkStatus
  area?: string | null
  room_id?: string | null
  lease_id?: string | null
  description?: string | null
  estimated_cost?: number | null
  actual_cost?: number | null
  target_date?: string | null
  scheduled_for?: string | null
  vendor_name?: string | null
  vendor_contact?: string | null
  assigned_to?: string | null
  reported_by?: string | null
  notes?: string | null
  inspection_item_id?: string | null
}

/**
 * Create through the API so the landlord gets their notification email — the
 * Resend key is server-only, and a silent list is a list people stop trusting.
 */
export async function createWorkItem(
  input: WorkItemInput
): Promise<{ item: WorkItem | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/maintenance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(input),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { item: null, error: json.error || 'Could not add the item.' }
  return { item: json.item ? map(json.item) : null, error: null }
}

export async function updateWorkItem(
  id: string,
  patch: Partial<WorkItemInput>
): Promise<{ error: any }> {
  const { error } = await supabase.from('property_work_items').update(patch).eq('id', id)
  return { error }
}

export async function deleteWorkItem(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('property_work_items').delete().eq('id', id)
  return { error }
}
