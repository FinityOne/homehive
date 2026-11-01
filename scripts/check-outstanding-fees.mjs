/**
 * Read-only cross-check: what will each tenant actually see?
 *
 * `explainLateFee` produces every figure the portal shows and the payment API
 * charges. This runs it over the live rows and prints the per-payer totals plus
 * a worked example, so the arithmetic can be compared against the same sums
 * computed independently in SQL. If the two disagree, a tenant is about to be
 * shown the wrong number.
 *
 * Performs SELECTs only — it never writes.
 *
 * Run: npx tsx --env-file=.env.local scripts/check-outstanding-fees.mjs [payer name]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { explainLateFee } = await import('../src/lib/rentPayments.ts')

const [, , ...nameArgs] = process.argv
const wanted = nameArgs.join(' ').trim().toLowerCase()

const { data: charges } = await db
  .from('scheduled_payments')
  .select('id, plan_id, plan_tenant_id, due_date, amount, paid_amount, status, paid_date, late_fee_paid')
  .neq('status', 'voided')

const { data: rules } = await db
  .from('late_fee_rules')
  .select('plan_id, grace_period_days, fee_amount, frequency_days, max_total_fees')

const { data: waivers } = await db.from('late_fee_waivers').select('scheduled_payment_id, amount')
const { data: payers } = await db.from('payment_plan_tenants').select('id, name')

const ruleByPlan = new Map((rules ?? []).map(r => [r.plan_id, r]))
const waivedBy = new Map((waivers ?? []).map(w => [w.scheduled_payment_id, Number(w.amount ?? 0)]))
const nameById = new Map((payers ?? []).map(p => [p.id, p.name]))

const fmt = n => `$${n.toFixed(2)}`
const byPayer = new Map()
let total = 0
let rowCount = 0
let onSettled = 0
let creditedRows = 0
let creditedTotal = 0

for (const c of charges ?? []) {
  const x = explainLateFee(
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

  if (x.overpaymentCredit > 0 && x.assessed > 0) {
    creditedRows++
    creditedTotal = Math.round((creditedTotal + Math.min(x.overpaymentCredit, x.assessed)) * 100) / 100
  }

  if (x.outstanding <= 0) continue
  rowCount++
  total = Math.round((total + x.outstanding) * 100) / 100
  if (x.rentSettled) onSettled++

  const cur = byPayer.get(c.plan_tenant_id) ?? { n: 0, sum: 0, rows: [] }
  cur.n++
  cur.sum = Math.round((cur.sum + x.outstanding) * 100) / 100
  cur.rows.push({ due: c.due_date, x })
  byPayer.set(c.plan_tenant_id, cur)
}

console.log(`charges carrying an outstanding fee: ${rowCount}  (on settled rent: ${onSettled})`)
console.log(`payers affected: ${byPayer.size}`)
console.log(`total outstanding: ${fmt(total)}`)
console.log(`overpayment credited back to tenants: ${fmt(creditedTotal)} across ${creditedRows} charge(s)\n`)

for (const [id, v] of [...byPayer.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${(nameById.get(id) ?? id).padEnd(20)} ${String(v.n).padStart(3)} fees   ${fmt(v.sum)}`)
}

// A worked example, which is what the detail sheet has to communicate.
if (wanted) {
  for (const [id, v] of byPayer) {
    if ((nameById.get(id) ?? '').toLowerCase() !== wanted) continue
    console.log(`\n── ${nameById.get(id)} — every fee, as the sheet explains it ──`)
    for (const { due, x } of v.rows.sort((a, b) => a.due.localeCompare(b.due))) {
      const cap = x.cappedBy ? `  [capped by ${x.cappedBy} at ${fmt(x.capAmount)}]` : ''
      const credit = x.overpaymentCredit > 0 ? `  − ${fmt(x.overpaymentCredit)} already paid with rent` : ''
      console.log(
        `  ${due}  rent ${fmt(x.rentDue)} paid ${x.paidDate ?? '—'}  ` +
        `${String(x.daysPastDue).padStart(3)}d late  ` +
        `${x.periods} x ${fmt(x.perPeriod)} = ${fmt(x.accrued)}${cap}${credit}  →  owes ${fmt(x.outstanding)}`,
      )
    }
  }
}
