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

export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'late' | 'missed'
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
  if (payment.status !== 'pending') return payment.status
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(payment.due_date + 'T00:00:00')
  return due < today ? 'late' : 'pending'
}

export function isOverdue(payment: Pick<ScheduledPayment, 'status' | 'due_date'>): boolean {
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

    const schedule = generateScheduleDates(input.leaseStart, input.leaseEnd, input.dueDay)
    if (schedule.length > 0) {
      const { error: sErr } = await supabase
        .from('scheduled_payments')
        .insert(schedule.map(due_date => ({
          plan_id:          planId,
          plan_tenant_id:   tenant.id,
          due_date,
          amount:           t.monthlyTotal,
          status:           'pending',
          paid_amount:      0,
          late_fees_applied: 0,
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
