/**
 * POST /api/payments/[planId]/remind
 *
 * Landlord manually emails tenants about rent they owe. One email per tenant,
 * however many charges it covers — three separate nudges for three months of
 * arrears reads as harassment and gets filtered.
 *
 * Body: { paymentIds?: string[] }  — omit to remind on everything outstanding.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildRentReminderEmail, type ReminderRow } from '@/lib/rentReminderEmails'
import { fmtMoney } from '@/lib/rentPayments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const DAY = 86_400_000
const daysLate = (due: string) => {
  const d = new Date(due + 'T00:00:00').getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - d) / DAY))
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ planId: string }> }) {
  const { planId } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const requestedIds: string[] | undefined = Array.isArray(body.paymentIds) ? body.paymentIds : undefined
  const customMessage: string | null = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 500)
    : null

  // The plan must belong to the caller.
  const { data: plan } = await supabaseAdmin
    .from('payment_plans')
    .select('id, owner_id, lease_id, property:properties ( name ), tenants:payment_plan_tenants ( id, name, email ), rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )')
    .eq('id', planId)
    .maybeSingle()

  if (!plan) return Response.json({ error: 'Plan not found' }, { status: 404 })
  if (plan.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  let q = supabaseAdmin
    .from('scheduled_payments')
    .select('id, plan_tenant_id, due_date, amount, paid_amount, status')
    .eq('plan_id', planId)
    // Anything not settled and not written off — a whitelist of statuses would
    // quietly drop rows a landlord had marked 'missed' and still wants to chase.
    .not('status', 'in', '(paid,processing,voided)')
    .order('due_date')

  if (requestedIds && requestedIds.length > 0) q = q.in('id', requestedIds)

  const { data: payments } = await q
  if (!payments || payments.length === 0) {
    return Response.json({ error: 'Nothing outstanding to remind about.' }, { status: 409 })
  }

  // Group by tenant — one email each.
  const byTenant = new Map<string, typeof payments>()
  for (const p of payments) {
    const due = Number(p.amount) - Number(p.paid_amount ?? 0)
    if (due <= 0) continue
    const list = byTenant.get(p.plan_tenant_id) ?? []
    list.push(p)
    byTenant.set(p.plan_tenant_id, list)
  }

  const propertyName = (plan.property as any)?.name ?? 'your home'
  const rawRule = Array.isArray(plan.rule) ? plan.rule[0] : plan.rule
  const lateFeeNote = rawRule
    ? `Late fees of ${fmtMoney(Number(rawRule.fee_amount))} apply every ` +
      `${rawRule.frequency_days === 1 ? 'day' : `${rawRule.frequency_days} days`}` +
      `${rawRule.grace_period_days > 0 ? `, after a ${rawRule.grace_period_days}-day grace period` : ''}.`
    : null

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('full_name, first_name, email').eq('id', user.id).maybeSingle()
  const landlordName = profile?.full_name || profile?.first_name || null
  const landlordEmail = profile?.email || user.email || null

  // Tenants pay from their own portal; deep-link them straight into the payment
  // flow rather than the overview tab, and open the sheet on arrival. Signed
  // out, the login page carries this destination through via `next`.
  const payUrl = `${getSiteUrl()}/dashboard/lease?tab=payments&pay=1`

  const sent: { name: string; email: string; amount: number }[] = []
  const skipped: { name: string; reason: string }[] = []
  const remindedIds: string[] = []

  for (const [tenantId, rows] of byTenant) {
    const tenant = (plan.tenants as any[]).find(t => t.id === tenantId)
    if (!tenant) continue
    const to = tenant.email?.trim()
    if (!to) { skipped.push({ name: tenant.name, reason: 'no email address on file' }); continue }

    const reminderRows: ReminderRow[] = rows.map(r => ({
      label: `Rent — ${new Date(r.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
      dueDate: r.due_date,
      amount: Number(r.amount) - Number(r.paid_amount ?? 0),
      daysLate: daysLate(r.due_date),
    }))
    const total = reminderRows.reduce((s, r) => s + r.amount, 0)

    const { subject, html, text } = buildRentReminderEmail({
      tenantName: tenant.name,
      propertyName,
      rows: reminderRows,
      payUrl,
      landlordName,
      landlordEmail,
      // Only mention late fees when something is actually late.
      lateFeeNote: reminderRows.some(r => r.daysLate > 0) ? lateFeeNote : null,
      customMessage,
    })

    try {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to,
        subject,
        html,
        text,
        ...(landlordEmail ? { replyTo: landlordEmail } : {}),
      })
      sent.push({ name: tenant.name, email: to, amount: total })
      remindedIds.push(...rows.map(r => r.id))
    } catch (e) {
      console.error('rent reminder failed', tenantId, e)
      skipped.push({ name: tenant.name, reason: 'delivery failed' })
    }
  }

  if (remindedIds.length > 0) {
    const stamp = new Date().toISOString()
    // Bump each row's counter individually — a blanket update would reset the
    // history of how often a given tenant has been chased.
    for (const id of remindedIds) {
      const { data: row } = await supabaseAdmin
        .from('scheduled_payments').select('reminder_count').eq('id', id).maybeSingle()
      await supabaseAdmin
        .from('scheduled_payments')
        .update({ reminder_sent_at: stamp, reminder_count: (row?.reminder_count ?? 0) + 1 })
        .eq('id', id)
    }
  }

  return Response.json({ sent: sent.length, recipients: sent, skipped })
}
