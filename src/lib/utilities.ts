/**
 * Utilities and shared charges declared once against a lease.
 *
 * The landlord's problem: house internet had to be typed into every payer by
 * hand — six identical $17 line items for one $102 bill, six edits to change
 * it, and no record that it was ever a single charge. So a utility is declared
 * once here, and the database materialises it onto each payer (see the
 * `20261101000000_plan_utilities_and_late_fee_paid` migration).
 *
 * Why the allocation maths lives in *both* places: the function
 * `apply_plan_utility` owns the write, because it has to be atomic and has to
 * apply deltas against whatever it wrote last time. But the landlord needs to
 * see "$102 ÷ 6 = $17 each" *before* saving, so `utilityShares` below computes
 * the same answer for the preview. They must agree exactly, which is why both
 * work in whole cents and hand the rounding remainder to the earliest payers in
 * the same order. If you change one, change the other.
 */
import { supabase } from '@/lib/supabase'

export type UtilityCadence = 'monthly' | 'one_time'

/**
 * How `amount` maps onto people.
 *
 * `even` is the bill as it arrives from the provider, divided up — change the
 * number of tenants and each share moves. `per_payer` is a flat charge every
 * payer owes, which is how the existing internet charge was really being used.
 */
export type UtilitySplit = 'even' | 'per_payer'

export type PlanUtility = {
  id: string
  plan_id: string
  category: string
  label: string
  amount: number
  cadence: UtilityCadence
  split: UtilitySplit
  /** Monthly only. Null means "from the start of the lease". */
  start_date: string | null
  /** Monthly only. Null means "until the lease ends". */
  end_date: string | null
  /** One-time only. */
  due_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Rent is not a utility — it is the thing utilities sit on top of. */
export const UTILITY_CATEGORIES = [
  { value: 'internet',  label: 'Internet' },
  { value: 'water',     label: 'Water' },
  { value: 'electric',  label: 'Electric' },
  { value: 'gas',       label: 'Gas' },
  { value: 'trash',     label: 'Trash' },
  { value: 'utilities', label: 'Utilities (combined)' },
  { value: 'parking',   label: 'Parking' },
  { value: 'pet_fee',   label: 'Pet fee' },
  { value: 'other',     label: 'Other' },
] as const

export const utilityCategoryLabel = (c: string) =>
  UTILITY_CATEGORIES.find(u => u.value === c)?.label ?? 'Charge'

export const CADENCE_LABEL: Record<UtilityCadence, string> = {
  monthly:  'Every month',
  one_time: 'One time',
}

/**
 * Each payer's share, in payer order, summing to exactly the right total.
 *
 * Done in whole cents because the obvious `amount / n` does not add up: $100
 * across three people is $33.333…, and three rounded shares either over- or
 * under-bill the house every single month. The remainder goes out one cent at a
 * time to the earliest payers, so $100 ÷ 3 is 33.34 / 33.33 / 33.33 — exact.
 */
export function utilityShares(amount: number, split: UtilitySplit, payerCount: number): number[] {
  if (payerCount <= 0) return []
  const cents = Math.round(amount * 100)
  if (split === 'per_payer') {
    return Array.from({ length: payerCount }, () => cents / 100)
  }
  const base = Math.floor(cents / payerCount)
  const remainder = cents - base * payerCount
  return Array.from({ length: payerCount }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100)
}

/** What the whole property is charged each period, however `amount` is framed. */
export function utilityHouseTotal(
  u: Pick<PlanUtility, 'amount' | 'split'>,
  payerCount: number,
): number {
  return u.split === 'even'
    ? u.amount
    : Math.round(u.amount * payerCount * 100) / 100
}

/** The monthly utilities among a set — what recurs on top of rent. */
export const monthlyUtilities = (us: PlanUtility[]) => us.filter(u => u.cadence === 'monthly')

export type UtilityInput = {
  planId: string
  category: string
  label: string
  amount: number
  cadence: UtilityCadence
  split: UtilitySplit
  startDate?: string | null
  endDate?: string | null
  dueDate?: string | null
  notes?: string | null
}

export async function getUtilitiesForPlan(planId: string): Promise<PlanUtility[]> {
  const { data, error } = await supabase
    .from('plan_utilities')
    .select('*')
    .eq('plan_id', planId)
    .order('cadence')
    .order('created_at')

  if (error || !data) {
    console.error('getUtilitiesForPlan:', error)
    return []
  }
  return data.map(row => ({ ...row, amount: Number(row.amount) })) as PlanUtility[]
}

/**
 * The write path is always "save the declaration, then ask the database to
 * materialise it". Never the other way round, and never partially: if `apply`
 * fails the declaration is rolled back, because a utility nobody is charged for
 * is worse than no utility at all — it reads as money owed on the lease screen
 * and collects nothing.
 */
export async function createUtility(input: UtilityInput): Promise<{ id: string | null; error: unknown }> {
  const { data, error } = await supabase
    .from('plan_utilities')
    .insert({
      plan_id:    input.planId,
      category:   input.category,
      label:      input.label,
      amount:     input.amount,
      cadence:    input.cadence,
      split:      input.split,
      start_date: input.cadence === 'monthly' ? (input.startDate || null) : null,
      end_date:   input.cadence === 'monthly' ? (input.endDate || null) : null,
      due_date:   input.cadence === 'one_time' ? input.dueDate : null,
      notes:      input.notes || null,
    })
    .select('id')
    .single()

  if (error || !data) return { id: null, error }

  const { error: applyError } = await supabase.rpc('apply_plan_utility', { p_utility_id: data.id })
  if (applyError) {
    await supabase.from('plan_utilities').delete().eq('id', data.id)
    return { id: null, error: applyError }
  }
  return { id: data.id, error: null }
}

export async function updateUtility(
  id: string,
  patch: Partial<Pick<PlanUtility, 'category' | 'label' | 'amount' | 'split' | 'start_date' | 'end_date' | 'due_date' | 'notes'>>,
): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from('plan_utilities')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error }

  // Re-apply: the function diffs against what it wrote last time, so this moves
  // each payer by the difference rather than adding the charge again.
  const { error: applyError } = await supabase.rpc('apply_plan_utility', { p_utility_id: id })
  return { error: applyError ?? null }
}

/** Deleting unwinds the shares first — a BEFORE DELETE trigger does it, so the
 *  payers' rent comes back down instead of keeping a charge that is gone. */
export async function deleteUtility(id: string): Promise<{ error: unknown }> {
  const { error } = await supabase.from('plan_utilities').delete().eq('id', id)
  return { error }
}

/** Re-spread every utility on a plan. Used after the payer list changes, since
 *  an even split depends on how many people are sharing it. */
export async function reapplyPlanUtilities(planId: string): Promise<void> {
  const utilities = await getUtilitiesForPlan(planId)
  for (const u of utilities) {
    if (u.cadence !== 'monthly') continue
    const { error } = await supabase.rpc('apply_plan_utility', { p_utility_id: u.id })
    if (error) console.error('reapplyPlanUtilities:', u.id, error)
  }
}
