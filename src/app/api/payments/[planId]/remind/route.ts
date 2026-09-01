/**
 * POST /api/payments/[planId]/remind
 *
 * Landlord manually emails tenants about rent they owe. One email per tenant,
 * however many charges it covers — three separate nudges for three months of
 * arrears reads as harassment and gets filtered.
 *
 * Body: { paymentIds?: string[], specialPaymentIds?: string[] }
 *   — omit both to remind on everything outstanding, rent and charges alike.
 *
 * Deposits and one-off charges live in `special_payments`, not
 * `scheduled_payments`. At move-in the deposit is the largest single amount a
 * landlord ever asks for, so it has to be requestable too.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildRentReminderEmail, type ReminderRow } from '@/lib/rentReminderEmails'
import { fmtMoney } from '@/lib/rentPayments'
import { logPaymentEmail, type PaymentEmailItem } from '@/lib/paymentEmailLog'

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
  const requestedSpecialIds: string[] | undefined = Array.isArray(body.specialPaymentIds) ? body.specialPaymentIds : undefined
  // Naming nothing means "everything outstanding"; naming anything means only
  // what was named — including naming charges but no rent.
  const explicit = (requestedIds?.length ?? 0) > 0 || (requestedSpecialIds?.length ?? 0) > 0
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

  let sq = supabaseAdmin
    .from('special_payments')
    .select('id, plan_tenant_id, due_date, amount, label, category, status')
    .eq('plan_id', planId)
    // 'waived' is the landlord saying they no longer want it; 'paid' is settled.
    .eq('status', 'pending')
    .order('due_date')

  if (requestedSpecialIds && requestedSpecialIds.length > 0) sq = sq.in('id', requestedSpecialIds)

  // Naming charges but no rent must not drag every unpaid month in behind them,
  // and vice versa — so a table nobody asked for isn't queried at all.
  const wantScheduled = !explicit || (requestedIds?.length ?? 0) > 0
  const wantSpecials  = !explicit || (requestedSpecialIds?.length ?? 0) > 0

  const [payments, specials] = await Promise.all([
    wantScheduled ? q.then(r => r.data) : Promise.resolve(null),
    wantSpecials  ? sq.then(r => r.data) : Promise.resolve(null),
  ])

  const planTenants = (plan.tenants as any[]) ?? []
  // A charge with no tenant is owed by the household. With one tenant that is
  // unambiguous; with housemates, asking each of them for the full amount would
  // be four demands for one debt, so it is skipped rather than guessed at.
  const soleTenantId = planTenants.length === 1 ? planTenants[0].id : null

  type Row = { id: string; table: 'scheduled' | 'special'; tenantId: string; label: string; dueDate: string; amount: number }
  const rowsAll: Row[] = []
  const skipped: { name: string; reason: string }[] = []

  for (const p of payments ?? []) {
    const due = Number(p.amount) - Number(p.paid_amount ?? 0)
    if (due <= 0) continue
    rowsAll.push({
      id: p.id,
      table: 'scheduled',
      tenantId: p.plan_tenant_id,
      label: `Rent — ${new Date(p.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
      dueDate: p.due_date,
      amount: due,
    })
  }

  for (const sp of specials ?? []) {
    const amount = Number(sp.amount)
    if (amount <= 0) continue
    const tenantId = sp.plan_tenant_id ?? soleTenantId
    if (!tenantId) {
      skipped.push({ name: sp.label, reason: 'charge is not assigned to a tenant' })
      continue
    }
    rowsAll.push({ id: sp.id, table: 'special', tenantId, label: sp.label, dueDate: sp.due_date, amount })
  }

  if (rowsAll.length === 0) {
    return Response.json({ error: 'Nothing outstanding to remind about.' }, { status: 409 })
  }

  // Group by tenant — one email each.
  const byTenant = new Map<string, Row[]>()
  for (const r of rowsAll) {
    const list = byTenant.get(r.tenantId) ?? []
    list.push(r)
    byTenant.set(r.tenantId, list)
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
  const remindedIds: string[] = []
  const remindedSpecialIds: string[] = []

  for (const [tenantId, rows] of byTenant) {
    const tenant = planTenants.find(t => t.id === tenantId)
    if (!tenant) continue
    const to = tenant.email?.trim()
    if (!to) { skipped.push({ name: tenant.name, reason: 'no email address on file' }); continue }

    const reminderRows: ReminderRow[] = rows.map(r => ({
      label: r.label,
      dueDate: r.dueDate,
      amount: r.amount,
      daysLate: daysLate(r.dueDate),
      kind: r.table === 'special' ? 'charge' : 'rent',
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
      // Late fees are a rent rule — quoting them under a late deposit would
      // threaten a charge they don't actually apply to.
      lateFeeNote: reminderRows.some(r => r.daysLate > 0 && r.kind !== 'charge') ? lateFeeNote : null,
      customMessage,
    })

    // What this email covered, recorded as the tenant was shown it — editing a
    // charge later must not rewrite what we once asked for.
    const logItems: PaymentEmailItem[] = rows.map(r => ({
      scheduledPaymentId: r.table === 'scheduled' ? r.id : null,
      specialPaymentId:   r.table === 'special'   ? r.id : null,
      label:    r.label,
      dueDate:  r.dueDate,
      amount:   r.amount,
      kind:     r.table === 'special' ? 'charge' : 'rent',
    }))

    try {
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to,
        subject,
        html,
        text,
        ...(landlordEmail ? { replyTo: landlordEmail } : {}),
      })
      // Resend reports a rejected send in `error` rather than by throwing, so a
      // bounced address would otherwise be logged and counted as delivered.
      if (sendErr) throw new Error(sendErr.message || 'Resend rejected the send')

      await logPaymentEmail({
        planId, planTenantId: tenantId, recipientEmail: to, recipientName: tenant.name,
        subject, status: 'sent', providerId: sendData?.id ?? null,
        customMessage, sentBy: user.id, items: logItems,
      })
      sent.push({ name: tenant.name, email: to, amount: total })
      for (const r of rows) {
        (r.table === 'special' ? remindedSpecialIds : remindedIds).push(r.id)
      }
    } catch (e) {
      console.error('rent reminder failed', tenantId, e)
      // A failed request is history too — otherwise the ledger shows silence
      // and the landlord reads it as "never chased" rather than "never arrived".
      await logPaymentEmail({
        planId, planTenantId: tenantId, recipientEmail: to, recipientName: tenant.name,
        subject, status: 'failed', error: e instanceof Error ? e.message : String(e),
        customMessage, sentBy: user.id, items: logItems,
      })
      skipped.push({ name: tenant.name, reason: 'delivery failed' })
    }
  }

  const stamp = new Date().toISOString()
  // Bump each row's counter individually — a blanket update would reset the
  // history of how often a given tenant has been chased.
  for (const [table, ids] of [['scheduled_payments', remindedIds], ['special_payments', remindedSpecialIds]] as const) {
    for (const id of ids) {
      const { data: row } = await supabaseAdmin
        .from(table).select('reminder_count').eq('id', id).maybeSingle()
      await supabaseAdmin
        .from(table)
        .update({ reminder_sent_at: stamp, reminder_count: (row?.reminder_count ?? 0) + 1 })
        .eq('id', id)
    }
  }

  return Response.json({ sent: sent.length, recipients: sent, skipped })
}
