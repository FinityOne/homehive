import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const LINE_ITEM_CATEGORIES = [
  { value: 'rent',       label: 'Rent' },
  { value: 'utilities',  label: 'Utilities' },
  { value: 'internet',   label: 'Internet' },
  { value: 'parking',    label: 'Parking' },
  { value: 'pet_fee',    label: 'Pet Fee' },
  { value: 'trash',      label: 'Trash' },
  { value: 'water',      label: 'Water' },
  { value: 'gas',        label: 'Gas' },
  { value: 'electric',   label: 'Electric' },
  { value: 'other',      label: 'Other' },
] as const

export const SPECIAL_CATEGORIES = [
  { value: 'security_deposit', label: 'Security Deposit' },
  { value: 'special',          label: 'Special Charge' },
  { value: 'penalty',          label: 'Penalty' },
  { value: 'other',            label: 'Other' },
] as const

// ─── TYPES ────────────────────────────────────────────────────────────────────

// 'processing' = tenant paid by ACH and the transfer is still clearing.
export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'late' | 'missed' | 'voided' | 'processing'
export type SpecialCategory = 'security_deposit' | 'special' | 'penalty' | 'other'

export type PaymentLineItem = {
  id: string
  plan_tenant_id: string
  category: string
  label: string
  amount: number
  created_at: string
}

export type PaymentPlanTenant = {
  id: string
  plan_id: string
  name: string
  email: string | null
  monthly_total: number
  created_at: string
  line_items: PaymentLineItem[]
  start_date: string | null
  end_date: string | null
  status: 'active' | 'terminated' | 'completed'
  termination_date: string | null
  termination_reason: string | null
}

export type LateFeeRule = {
  id: string
  plan_id: string
  grace_period_days: number
  fee_amount: number
  frequency_days: number
  max_total_fees: number | null
  created_at: string
}

export type ScheduledPayment = {
  id: string
  plan_id: string
  plan_tenant_id: string
  due_date: string          // 'YYYY-MM-DD'
  amount: number
  status: PaymentStatus
  paid_amount: number
  paid_date: string | null
  late_fees_applied: number
  notes: string | null
  void_reason: string | null
  /** How it settled — card/ach = tenant paid online, manual_* = landlord logged it. */
  payment_method: 'card' | 'ach' | 'manual_zelle' | 'manual_other' | null
  recorded_by: 'tenant' | 'landlord' | null
  /** Surcharge the tenant paid on top (5% card, 2% ACH) — not landlord income. */
  processing_fee: number
  stripe_payment_intent_id: string | null
  /** Manual rent reminders sent by the landlord about this charge. */
  reminder_sent_at: string | null
  reminder_count: number
  created_at: string
  updated_at: string
  tenant?: { name: string; email: string | null }
}

export type SpecialPayment = {
  id: string
  plan_id: string
  plan_tenant_id: string | null
  category: SpecialCategory
  label: string
  amount: number
  due_date: string
  status: 'pending' | 'paid' | 'waived'
  paid_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
  tenant?: { name: string } | null
}

export type PaymentPlan = {
  id: string
  owner_id: string
  property_id: string
  lease_id: string
  name: string
  due_day: number
  notes: string | null
  created_at: string
  updated_at: string
  property?: { id: string; name: string; slug: string }
  lease?: { id: string; start_date: string; end_date: string; rent_amount: number | null }
  tenants: PaymentPlanTenant[]
  late_fee_rule?: LateFeeRule | null
  scheduled_payments?: ScheduledPayment[]
  special_payments?: SpecialPayment[]
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

export function getEffectiveStatus(
  payment: Pick<ScheduledPayment, 'status' | 'due_date'>
): PaymentStatus {
  if (payment.status === 'voided') return 'voided'
  if (payment.status !== 'pending') return payment.status
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(payment.due_date + 'T00:00:00')
  return due < today ? 'late' : 'pending'
}

export function isOverdue(payment: Pick<ScheduledPayment, 'status' | 'due_date'>): boolean {
  if (payment.status === 'voided') return false
  const s = getEffectiveStatus(payment)
  return s === 'late' || s === 'missed'
}

// How many days late a payment is (0 if not late)
export function daysLate(dueDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  if (due >= today) return 0
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000)
}

// Compute accrued late fees for a given payment, as of today
export function computeLateFees(rule: Pick<LateFeeRule, 'grace_period_days' | 'fee_amount' | 'frequency_days' | 'max_total_fees'>, dueDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  const cutoff = new Date(due)
  cutoff.setDate(cutoff.getDate() + rule.grace_period_days)
  if (today <= cutoff) return 0
  const daysOver = Math.floor((today.getTime() - cutoff.getTime()) / 86_400_000)
  const periods = Math.floor(daysOver / rule.frequency_days)
  const total = periods * rule.fee_amount
  return rule.max_total_fees !== null ? Math.min(total, rule.max_total_fees) : total
}

// Compute late fees as of a specific date (e.g. when tenant actually paid)
export function computeLateFeesByDate(
  rule: Pick<LateFeeRule, 'grace_period_days' | 'fee_amount' | 'frequency_days' | 'max_total_fees'>,
  dueDate: string,
  asOfDate: string,
): number {
  const asOf = new Date(asOfDate + 'T00:00:00')
  const due  = new Date(dueDate  + 'T00:00:00')
  const cutoff = new Date(due)
  cutoff.setDate(cutoff.getDate() + rule.grace_period_days)
  if (asOf <= cutoff) return 0
  const daysOver = Math.floor((asOf.getTime() - cutoff.getTime()) / 86_400_000)
  const periods  = Math.floor(daysOver / rule.frequency_days)
  const total    = periods * rule.fee_amount
  return rule.max_total_fees !== null ? Math.min(total, rule.max_total_fees) : total
}

// Days between due_date and paid_date (0 if paid on time)
export function daysLateByDate(dueDate: string, paidDate: string): number {
  const paid = new Date(paidDate + 'T00:00:00')
  const due  = new Date(dueDate  + 'T00:00:00')
  if (paid <= due) return 0
  return Math.floor((paid.getTime() - due.getTime()) / 86_400_000)
}

// Generate array of due-date strings for each month of a lease
export function generateScheduleDates(
  leaseStart: string,
  leaseEnd: string,
  dueDay: number
): string[] {
  const dates: string[] = []
  const start = new Date(leaseStart + 'T00:00:00')
  const end   = new Date(leaseEnd   + 'T00:00:00')
  let year  = start.getFullYear()
  let month = start.getMonth()  // 0-indexed

  while (true) {
    // Clamp day to last day of month (e.g. Feb 28/29)
    const lastDay = new Date(year, month + 1, 0).getDate()
    const day = Math.min(dueDay, lastDay)
    const d = new Date(year, month, day)
    if (d > end) break
    // Only include if on/after lease start
    if (d >= start) {
      dates.push(
        `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      )
    }
    month++
    if (month > 11) { month = 0; year++ }
  }
  return dates
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(n)
}

export function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function fmtMonth(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  })
}

export function fmtOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// Average number of days in a month, per the lease's proration clause:
// "the number of days prorated times the monthly rate divided by 30.2".
export const PRORATION_DAYS_PER_MONTH = 30.2

// Prorated rent for a partial period.
// Per the lease: (days prorated) × (monthly rate) ÷ 30.2, rounded UP to the closest dollar.
// e.g. $700/mo for 10 days → ceil(700 × 10 / 30.2) = ceil(231.79) = $232.
export function computeProratedRent(monthlyAmount: number, proratedDays: number): number {
  if (proratedDays <= 0 || monthlyAmount <= 0) return 0
  return Math.ceil((monthlyAmount * proratedDays) / PRORATION_DAYS_PER_MONTH)
}

// Whole number of days from `from` (inclusive) up to `to` (exclusive).
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime()
  const b = new Date(to   + 'T00:00:00').getTime()
  return Math.round((b - a) / 86_400_000)
}

// Prorate a monthly amount for a partial first month.
// startDate is when the tenant starts; dueDay is the plan's payment due day.
// Returns { proratedAmount, fullMonths, startDate } to show a preview.
export function computeProration(monthlyAmount: number, startDate: string, dueDay: number): {
  proratedAmount: number
  proratedDays: number
  totalDays: number
  firstDueDate: string
} {
  const start = new Date(startDate + 'T00:00:00')
  const year  = start.getFullYear()
  const month = start.getMonth()

  // Last day of start month
  const lastDay = new Date(year, month + 1, 0).getDate()
  // Due day clamped
  const clampedDueDay = Math.min(dueDay, lastDay)

  // If start is on/before due day, first full payment is this month (prorate from start → due day)
  // If start is after due day, first full payment is next month (prorate from start → end of month)
  let proratedDays: number
  const totalDays = PRORATION_DAYS_PER_MONTH // average month
  let firstDueYear = year
  let firstDueMonth = month + 1 // next month (0-indexed → 1-indexed → shift +1)

  const dueThisMonth = new Date(year, month, clampedDueDay)
  if (start <= dueThisMonth) {
    // Start before/on due day this month → prorate start→dueDay
    proratedDays = clampedDueDay - start.getDate() + 1
    firstDueYear = year
    firstDueMonth = month  // 0-indexed
  } else {
    // Start after due day → prorate remainder of month, full rent starts next month
    proratedDays = lastDay - start.getDate() + 1
    firstDueYear = month === 11 ? year + 1 : year
    firstDueMonth = (month + 1) % 12
  }

  const proratedAmount = computeProratedRent(monthlyAmount, proratedDays)

  // First full month due date
  const nextLastDay = new Date(firstDueYear, firstDueMonth + 1, 0).getDate()
  const nextDueDay  = Math.min(dueDay, nextLastDay)
  const firstDueDate = `${firstDueYear}-${String(firstDueMonth + 1).padStart(2, '0')}-${String(nextDueDay).padStart(2, '0')}`

  return { proratedAmount, proratedDays, totalDays, firstDueDate }
}

// A single row in a generated payment schedule.
//   move_in          — full month's rent, due on the first day of the lease
//   prorated_credit  — the following month, reduced by the prorated amount
//   regular          — a normal full-rent payment
export type ScheduleEntryKind = 'move_in' | 'prorated_credit' | 'regular'
export type ScheduleEntry = {
  due_date: string
  amount: number
  kind: ScheduleEntryKind
}

// Build the full payment schedule for one payer over the life of the lease,
// applying the lease's mid-month proration convention:
//
//   • If the lease starts on the due day, every payment is the full monthly amount.
//   • Otherwise the tenant pays the FULL first month's rent on the first day of the
//     lease (move-in). They only owe the prorated rent for the days actually occupied
//     that partial first month, so the full payment overpays by a credit of
//     (monthly rent − prorated rent). That credit is applied to the following month,
//     making it: following = monthly rent − credit = the prorated rent itself
//     = (daysStayed × rate ÷ 30.2, rounded up). All later payments are the full amount.
//
// Worked example — $847/mo, lease starts May 9 (23 days in residence), due day 1:
//   prorated May rent = ceil(23 × 847 ÷ 30.2) = $646
//   move-in (May 9)   = $847 (full)
//   credit            = 847 − 646 = $201
//   June 1            = 847 − 201 = $646  (== the prorated rent)
export function buildPaymentSchedule(
  leaseStart: string,
  leaseEnd: string,
  dueDay: number,
  monthlyAmount: number,
): ScheduleEntry[] {
  const regular = generateScheduleDates(leaseStart, leaseEnd, dueDay)
  if (regular.length === 0) return []

  // No partial first period — the lease starts on (or after) the first due day.
  if (daysBetween(leaseStart, regular[0]) <= 0) {
    return regular.map(due_date => ({ due_date, amount: monthlyAmount, kind: 'regular' as const }))
  }

  // Partial first month → full rent at move-in; the following month is the prorated
  // rent for the days occupied (equivalently, full rent minus the move-in overpayment).
  const daysStayed   = daysBetween(leaseStart, regular[0])
  const followingAmt = computeProratedRent(monthlyAmount, daysStayed)

  const entries: ScheduleEntry[] = [
    // Full first month's rent, paid on the first day of the lease.
    { due_date: leaseStart, amount: monthlyAmount, kind: 'move_in' },
    // Following month = prorated first-month rent (full rent − move-in credit).
    { due_date: regular[0], amount: followingAmt, kind: 'prorated_credit' },
  ]
  // Remaining months at full rent.
  for (let i = 1; i < regular.length; i++) {
    entries.push({ due_date: regular[i], amount: monthlyAmount, kind: 'regular' })
  }
  return entries
}

// Preview of how proration affects a payer's first two payments, for the create-plan UI.
export function previewProration(
  leaseStart: string,
  leaseEnd: string,
  dueDay: number,
  monthlyAmount: number,
): {
  applies: boolean
  daysStayed: number        // occupied days of the partial first month
  proratedRent: number      // prorated rent owed for those occupied days
  credit: number            // move-in overpayment applied to the following month
  moveInDate: string
  moveInAmount: number
  followingDate: string
  followingAmount: number
} | null {
  const regular = generateScheduleDates(leaseStart, leaseEnd, dueDay)
  if (regular.length === 0) return null
  const daysStayed = daysBetween(leaseStart, regular[0])
  if (daysStayed <= 0) {
    return {
      applies: false,
      daysStayed: 0,
      proratedRent: 0,
      credit: 0,
      moveInDate: leaseStart,
      moveInAmount: monthlyAmount,
      followingDate: regular[0],
      followingAmount: monthlyAmount,
    }
  }
  const proratedRent = computeProratedRent(monthlyAmount, daysStayed)
  return {
    applies: true,
    daysStayed,
    proratedRent,
    credit: Math.max(0, monthlyAmount - proratedRent),
    moveInDate: leaseStart,
    moveInAmount: monthlyAmount,
    followingDate: regular[0],
    followingAmount: proratedRent,
  }
}

// ─── DATA ACCESS ─────────────────────────────────────────────────────────────

// Summary list for the overview page (no scheduled_payments detail)
export async function getPlansForOwner(ownerId: string): Promise<PaymentPlan[]> {
  const { data, error } = await supabase
    .from('payment_plans')
    .select(`
      *,
      property:properties(id, name, slug),
      lease:leases(id, start_date, end_date, rent_amount),
      tenants:payment_plan_tenants(id, name, email, monthly_total),
      late_fee_rule:late_fee_rules(*),
      scheduled_payments(id, due_date, status, paid_amount, amount, plan_tenant_id)
    `)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  if (error || !data) { console.error('getPlansForOwner:', error); return [] }

  return data.map((row: any) => ({
    ...row,
    tenants:        (row.tenants || []).map((t: any) => ({ ...t, line_items: [] })),
    late_fee_rule:  Array.isArray(row.late_fee_rule) ? (row.late_fee_rule[0] ?? null) : (row.late_fee_rule ?? null),
    property:       row.property   ?? undefined,
    lease:          row.lease      ?? undefined,
    scheduled_payments: row.scheduled_payments || [],
  })) as PaymentPlan[]
}

// Full detail for the plan detail page
export async function getPlanById(planId: string): Promise<PaymentPlan | null> {
  const { data, error } = await supabase
    .from('payment_plans')
    .select(`
      *,
      property:properties(id, name, slug),
      lease:leases(id, start_date, end_date, rent_amount),
      tenants:payment_plan_tenants(*, line_items:payment_line_items(*)),
      late_fee_rule:late_fee_rules(*),
      scheduled_payments(*),
      special_payments(*)
    `)
    .eq('id', planId)
    .single()

  if (error || !data) { console.error('getPlanById:', error); return null }

  const tenants: PaymentPlanTenant[] = (data.tenants || []).map((t: any) => ({
    ...t,
    line_items: t.line_items || [],
  }))
  const tenantMap = new Map(tenants.map(t => [t.id, t]))

  const scheduled: ScheduledPayment[] = (data.scheduled_payments || []).map((sp: any) => ({
    ...sp,
    tenant: tenantMap.has(sp.plan_tenant_id)
      ? { name: tenantMap.get(sp.plan_tenant_id)!.name, email: tenantMap.get(sp.plan_tenant_id)!.email }
      : undefined,
  }))

  const special: SpecialPayment[] = (data.special_payments || []).map((sp: any) => ({
    ...sp,
    tenant: sp.plan_tenant_id && tenantMap.has(sp.plan_tenant_id)
      ? { name: tenantMap.get(sp.plan_tenant_id)!.name }
      : null,
  }))

  // Sort scheduled by due_date asc
  scheduled.sort((a, b) => a.due_date.localeCompare(b.due_date))

  return {
    ...data,
    tenants,
    late_fee_rule: Array.isArray(data.late_fee_rule) ? (data.late_fee_rule[0] ?? null) : (data.late_fee_rule ?? null),
    property:      data.property ?? undefined,
    lease:         data.lease    ?? undefined,
    scheduled_payments: scheduled,
    special_payments:   special,
  } as PaymentPlan
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

export type CreatePlanInput = {
  ownerId:   string
  propertyId: string
  leaseId:   string
  name:      string
  dueDay:    number
  notes?:    string
  leaseStart: string
  leaseEnd:  string
  tenants: {
    name:         string
    email?:       string
    monthlyTotal: number
    lineItems: { category: string; label: string; amount: number }[]
  }[]
  lateFeeRule?: {
    gracePeriodDays: number
    feeAmount:       number
    frequencyDays:   number
    maxTotalFees?:   number
  }
  specialCharges?: {
    planTenantIndex?: number   // which tenant (undefined = whole plan)
    category:  SpecialCategory
    label:     string
    amount:    number
    dueDate:   string
    notes?:    string
  }[]
}

export async function createPlan(
  input: CreatePlanInput
): Promise<{ planId: string | null; error: any }> {
  // 1 — payment_plans row
  const { data: plan, error: planErr } = await supabase
    .from('payment_plans')
    .insert({
      owner_id:    input.ownerId,
      property_id: input.propertyId,
      lease_id:    input.leaseId,
      name:        input.name,
      due_day:     input.dueDay,
      notes:       input.notes || null,
    })
    .select('id')
    .single()

  if (planErr || !plan) return { planId: null, error: planErr }
  const planId = plan.id

  const tenantIds: string[] = []

  // 2 — tenants + line items + schedule
  for (const t of input.tenants) {
    const { data: tenant, error: tErr } = await supabase
      .from('payment_plan_tenants')
      .insert({
        plan_id:       planId,
        name:          t.name,
        email:         t.email || null,
        monthly_total: t.monthlyTotal,
      })
      .select('id')
      .single()

    if (tErr || !tenant) return { planId, error: tErr }
    tenantIds.push(tenant.id)

    if (t.lineItems.length > 0) {
      const { error: liErr } = await supabase
        .from('payment_line_items')
        .insert(t.lineItems.map(li => ({
          plan_tenant_id: tenant.id,
          category:       li.category,
          label:          li.label,
          amount:         li.amount,
        })))
      if (liErr) return { planId, error: liErr }
    }

    const schedule = buildPaymentSchedule(input.leaseStart, input.leaseEnd, input.dueDay, t.monthlyTotal)
    if (schedule.length > 0) {
      const { error: sErr } = await supabase
        .from('scheduled_payments')
        .insert(schedule.map(e => ({
          plan_id:          planId,
          plan_tenant_id:   tenant.id,
          due_date:         e.due_date,
          amount:           e.amount,
          status:           'pending',
          paid_amount:      0,
          late_fees_applied: 0,
          notes:
            e.kind === 'move_in'
              ? 'First month — full rent due at move-in'
              : e.kind === 'prorated_credit'
                ? 'Prorated first month — rent for days occupied (full rent minus move-in credit)'
                : null,
        })))
      if (sErr) return { planId, error: sErr }
    }
  }

  // 3 — late fee rule
  if (input.lateFeeRule) {
    const { error: lfErr } = await supabase
      .from('late_fee_rules')
      .insert({
        plan_id:           planId,
        grace_period_days: input.lateFeeRule.gracePeriodDays,
        fee_amount:        input.lateFeeRule.feeAmount,
        frequency_days:    input.lateFeeRule.frequencyDays,
        max_total_fees:    input.lateFeeRule.maxTotalFees ?? null,
      })
    if (lfErr) return { planId, error: lfErr }
  }

  // 4 — special charges (security deposit, one-offs)
  if (input.specialCharges && input.specialCharges.length > 0) {
    const rows = input.specialCharges.map(sc => ({
      plan_id:         planId,
      plan_tenant_id:  sc.planTenantIndex != null ? (tenantIds[sc.planTenantIndex] ?? null) : null,
      category:        sc.category,
      label:           sc.label,
      amount:          sc.amount,
      due_date:        sc.dueDate,
      status:          'pending',
      notes:           sc.notes ?? null,
    }))
    const { error: scErr } = await supabase.from('special_payments').insert(rows)
    if (scErr) return { planId, error: scErr }
  }

  return { planId, error: null }
}

export async function updateScheduledPayment(
  id: string,
  updates: Partial<{
    status:             PaymentStatus
    paid_amount:        number
    paid_date:          string | null
    late_fees_applied:  number
    notes:              string
  }>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('scheduled_payments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error }
}

export async function updateSpecialPayment(
  id: string,
  updates: Partial<{
    status:    'pending' | 'paid' | 'waived'
    paid_date: string | null
    notes:     string
  }>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('special_payments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error }
}

export async function updateSpecialPaymentFull(
  id: string,
  updates: Partial<{
    category:  SpecialCategory
    label:     string
    amount:    number
    due_date:  string
    status:    'pending' | 'paid' | 'waived'
    paid_date: string | null
    notes:     string | null
  }>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('special_payments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error }
}

export async function addSpecialPayment(
  planId: string,
  data: {
    planTenantId?: string
    category:  SpecialCategory
    label:     string
    amount:    number
    dueDate:   string
    notes?:    string
  }
): Promise<{ error: any }> {
  const { error } = await supabase.from('special_payments').insert({
    plan_id:         planId,
    plan_tenant_id:  data.planTenantId ?? null,
    category:        data.category,
    label:           data.label,
    amount:          data.amount,
    due_date:        data.dueDate,
    status:          'pending',
    notes:           data.notes ?? null,
  })
  return { error }
}

// ─── LINE ITEM MUTATIONS ──────────────────────────────────────────────────────

export async function updateLineItem(
  id: string,
  updates: Partial<{ label: string; amount: number; category: string }>
): Promise<{ error: any }> {
  const { error } = await supabase.from('payment_line_items').update(updates).eq('id', id)
  return { error }
}

export async function addLineItem(
  planTenantId: string,
  item: { category: string; label: string; amount: number }
): Promise<{ error: any; id: string | null }> {
  const { data, error } = await supabase
    .from('payment_line_items')
    .insert({ plan_tenant_id: planTenantId, ...item })
    .select('id')
    .single()
  return { error, id: data?.id ?? null }
}

export async function deleteLineItem(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('payment_line_items').delete().eq('id', id)
  return { error }
}

export async function updateTenantMonthlyTotal(
  planTenantId: string,
  monthlyTotal: number
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('payment_plan_tenants')
    .update({ monthly_total: monthlyTotal })
    .eq('id', planTenantId)
  return { error }
}

// Bulk-update scheduled payment amounts for one tenant across their lease
export async function updateTenantScheduleAmount(
  planTenantId: string,
  newAmount: number,
  applyTo: 'unpaid' | 'all',
): Promise<{ error: any; updatedCount: number }> {
  // Keep monthly_total in sync on the tenant record
  const { error: tenantErr } = await supabase
    .from('payment_plan_tenants')
    .update({ monthly_total: newAmount })
    .eq('id', planTenantId)
  if (tenantErr) return { error: tenantErr, updatedCount: 0 }

  let query = supabase
    .from('scheduled_payments')
    .update({ amount: newAmount, updated_at: new Date().toISOString() })
    .eq('plan_tenant_id', planTenantId)

  if (applyTo === 'unpaid') {
    query = query.in('status', ['pending', 'late'])
  }

  const { data, error: spErr } = await query.select('id')
  return { error: spErr, updatedCount: data?.length ?? 0 }
}

// Count of pending payments past their due date (for nav badge)
export async function getOverduePaymentCount(ownerId: string): Promise<number> {
  const { data: plans } = await supabase
    .from('payment_plans')
    .select('id')
    .eq('owner_id', ownerId)

  if (!plans || plans.length === 0) return 0

  const today = new Date().toISOString().split('T')[0]
  const { count } = await supabase
    .from('scheduled_payments')
    .select('id', { count: 'exact', head: true })
    .in('plan_id', plans.map(p => p.id))
    .eq('status', 'pending')
    .lt('due_date', today)

  return count ?? 0
}
