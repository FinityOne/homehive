/**
 * Read-only cross-check: what will each tenant actually see?
 *
 * `lateFeeOutstanding` is the figure the portal quotes and the payment API
 * charges. This runs it over the live rows and prints the per-payer totals, so
 * they can be compared against the same sum computed independently in SQL. If
 * the two disagree, a tenant is about to be shown the wrong number.
 *
 * Performs SELECTs only — it never writes.
 *
 * Run: node --env-file=.env.local scripts/check-outstanding-fees.mjs
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { lateFeeOutstanding } = await import('../src/lib/rentPayments.ts')

const { data: charges } = await db
  .from('scheduled_payments')
  .select('id, plan_id, plan_tenant_id, due_date, amount, paid_amount, status, paid_date, late_fee_paid')
  .neq('status', 'voided')

const { data: rules } = await db
  .from('late_fee_rules')
  .select('plan_id, grace_period_days, fee_amount, frequency_days, max_total_fees')

const { data: waivers } = await db
  .from('late_fee_waivers')
  .select('scheduled_payment_id, amount')

const { data: payers } = await db
  .from('payment_plan_tenants')
  .select('id, name')

const ruleByPlan = new Map((rules ?? []).map(r => [r.plan_id, r]))
const waivedBy = new Map((waivers ?? []).map(w => [w.scheduled_payment_id, Number(w.amount ?? 0)]))
const nameById = new Map((payers ?? []).map(p => [p.id, p.name]))

const byPayer = new Map()
let total = 0
let rowCount = 0
let onSettled = 0

for (const c of charges ?? []) {
  const owed = lateFeeOutstanding(
    ruleByPlan.get(c.plan_id),
    {
      status: c.status,
      due_date: c.due_date,
      paid_date: c.paid_date,
      amount: Number(c.amount),
      paid_amount: Number(c.paid_amount ?? 0),
      late_fee_paid: Number(c.late_fee_paid ?? 0),
    },
    waivedBy.get(c.id) ?? 0,
  )
  if (owed <= 0) continue
  rowCount++
  total = Math.round((total + owed) * 100) / 100
  const settled = c.status === 'paid' || Number(c.paid_amount ?? 0) >= Number(c.amount)
  if (settled) onSettled++
  const key = c.plan_tenant_id
  const cur = byPayer.get(key) ?? { n: 0, sum: 0 }
  byPayer.set(key, { n: cur.n + 1, sum: Math.round((cur.sum + owed) * 100) / 100 })
}

const fmt = n => `$${n.toFixed(2)}`
console.log(`charges carrying an outstanding fee: ${rowCount}  (on settled rent: ${onSettled})`)
console.log(`payers affected: ${byPayer.size}`)
console.log(`total outstanding: ${fmt(total)}\n`)

for (const [id, v] of [...byPayer.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${(nameById.get(id) ?? id).padEnd(20)} ${String(v.n).padStart(3)} fees   ${fmt(v.sum)}`)
}
