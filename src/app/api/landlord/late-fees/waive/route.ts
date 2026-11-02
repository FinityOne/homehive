/**
 * POST   /api/landlord/late-fees/waive   — write fees off, and say so
 * DELETE /api/landlord/late-fees/waive   — put them back
 *
 * Body (POST):
 *   { scheduledPaymentId?, scheduledPaymentIds?: string[],
 *     reason?, tenantNote?, notifyTenant?: boolean, notifyLandlord?: boolean }
 * Body (DELETE): { scheduledPaymentId } | { scheduledPaymentIds }
 *
 * Waiving is not a cosmetic "hide this row". It is the landlord's recorded
 * decision not to collect, and it is what lets the pending-fee list reach zero
 * — a list that cannot reach zero is one a landlord learns to scroll past.
 *
 * Two things this route insists on:
 *
 *   • **The amount is recomputed here**, never taken from the request, for the
 *     same reason the reminder route recomputes: a stale tab must not decide
 *     how much was forgiven. Once written it is frozen, because it is history —
 *     recomputing it later against today's date would quietly rewrite what the
 *     landlord actually chose to forgive.
 *
 *   • **Several fees waived together are one email.** The landlord picks the
 *     tenant, not the charge. Three separate "your fee is waived" emails in one
 *     minute turn a goodwill gesture into noise, exactly as three separate
 *     chases read as harassment — see `/api/landlord/late-fees/remind`.
 *
 * The email is best-effort: a waiver that was recorded but could not be
 * announced is still a waiver, so a send failure reports back as a partial
 * success rather than rolling the decision back. The landlord can see which
 * waivers were never announced, and re-send, from the panel.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { lateFeeDue, type LateFeeRuleLike } from '@/lib/rentPayments'
import {
  buildWaiverTenantEmail, buildWaiverLandlordEmail, type WaivedFeeRow,
} from '@/lib/lateFeeWaiverEmails'
import { logPaymentEmail, type PaymentEmailItem } from '@/lib/paymentEmailLog'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const round2 = (n: number) => Math.round(n * 100) / 100

const monthLabel = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' rent'

/** A to-one relation Supabase may hand back as a single row or a one-row array. */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

type ChargeRow = {
  id: string
  plan_id: string
  plan_tenant_id: string | null
  due_date: string
  amount: number
  paid_amount: number | null
  paid_date: string | null
  submitted_at: string | null
  status: string
  late_fee_paid: number | null
  late_fee_reminder_count: number | null
}

/** Ids from either shape of the body, de-duplicated and capped. */
function idsFrom(body: Record<string, unknown>): string[] {
  const many = Array.isArray(body.scheduledPaymentIds) ? body.scheduledPaymentIds : []
  const single = typeof body.scheduledPaymentId === 'string' ? [body.scheduledPaymentId] : []
  return [...new Set([...many, ...single].filter((x): x is string => typeof x === 'string' && !!x))].slice(0, 60)
}

/**
 * Resolve the caller, load the charges, and prove the caller owns every plan
 * they sit on. All-or-nothing: a request that reaches across an ownership
 * boundary is rejected whole rather than partially honoured.
 */
async function authorizeCharges(req: NextRequest, ids: string[]) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: charges } = await supabaseAdmin
    .from('scheduled_payments')
    .select('id, plan_id, plan_tenant_id, due_date, amount, paid_amount, paid_date, submitted_at, status, late_fee_paid, late_fee_reminder_count')
    .in('id', ids)
    .order('due_date')
  if (!charges || charges.length === 0) {
    return { error: Response.json({ error: 'Charge not found' }, { status: 404 }) }
  }

  const planIds = [...new Set(charges.map(c => c.plan_id))]
  const { data: plans } = await supabaseAdmin
    .from('payment_plans')
    .select(`
      id, owner_id, name,
      property:properties ( name ),
      tenants:payment_plan_tenants ( id, name, email ),
      rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )
    `)
    .in('id', planIds)
  if (!plans || plans.length !== planIds.length) {
    return { error: Response.json({ error: 'Plan not found' }, { status: 404 }) }
  }
  if (plans.some(p => p.owner_id !== user.id)) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { user, charges: charges as ChargeRow[], plans }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ids = idsFrom(body)
  const trim = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  const reason = trim(body.reason, 300)
  const tenantNote = trim(body.tenantNote, 500)
  // Announcing it is the default. The silent write-off stays available — a
  // landlord correcting their own mistake has nothing to tell the tenant — but
  // it has to be chosen, because silence is the behaviour that made a waiver
  // look like a bug to the tenant in the first place.
  const notifyTenant = body.notifyTenant !== false
  const notifyLandlord = body.notifyLandlord !== false

  if (ids.length === 0) {
    return Response.json({ error: 'scheduledPaymentId is required.' }, { status: 400 })
  }

  const auth = await authorizeCharges(req, ids)
  if ('error' in auth) return auth.error
  const { user, charges, plans } = auth

  const planById = new Map(plans.map(p => [p.id, p]))

  // Every charge that genuinely has a fee left to forgive, with the figure
  // recomputed from its own plan's rule.
  const waivable: { charge: ChargeRow; outstanding: number }[] = []
  for (const charge of charges) {
    const plan = planById.get(charge.plan_id)
    if (!plan) continue
    const rule = one<LateFeeRuleLike>(plan.rule as LateFeeRuleLike | LateFeeRuleLike[] | null)
    if (!rule) continue

    const assessed = lateFeeDue(rule, {
      status: charge.status,
      due_date: charge.due_date,
      paid_date: charge.paid_date,
      submitted_at: charge.submitted_at,
      amount: Number(charge.amount),
      paid_amount: Number(charge.paid_amount ?? 0),
    })
    // Only the part still owed can be forgiven. Fee money that already arrived
    // has arrived; "waiving" it would misreport collected income as written off.
    const outstanding = round2(assessed - Number(charge.late_fee_paid ?? 0))
    if (outstanding > 0.005) waivable.push({ charge, outstanding })
  }

  if (waivable.length === 0) {
    return Response.json(
      { error: 'There is no outstanding late fee on that charge.' },
      { status: 409 },
    )
  }

  const stamp = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('late_fee_waivers')
    .upsert(
      waivable.map(({ charge, outstanding }) => ({
        scheduled_payment_id: charge.id,
        plan_id: charge.plan_id,
        amount: outstanding,
        reason,
        tenant_note: tenantNote,
        waived_by: user.id,
        // Set below once a send actually succeeds. Written as null here so a
        // re-waive of a previously-announced fee does not keep a stale stamp.
        tenant_notified_at: null,
        tenant_notified_email: null,
      })),
      // Waiving twice is the same decision, so a repeat updates rather than
      // failing on the unique constraint.
      { onConflict: 'scheduled_payment_id' },
    )

  if (error) {
    console.error('late fee waive failed', ids, error)
    return Response.json({ error: 'Could not record the waiver.' }, { status: 500 })
  }

  const waivedTotal = round2(waivable.reduce((s, w) => s + w.outstanding, 0))

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('full_name, email').eq('id', user.id).maybeSingle()
  const landlordName = profile?.full_name || null
  const landlordEmail = profile?.email || user.email || null

  // One email per payer, covering however many of their charges this call
  // cleared. Keyed on plan + payer because the same person can hold charges on
  // two leases and those are two different conversations.
  const groups = new Map<string, { charge: ChargeRow; outstanding: number }[]>()
  for (const w of waivable) {
    const k = `${w.charge.plan_id}:${w.charge.plan_tenant_id ?? 'lease'}`
    const arr = groups.get(k)
    if (arr) arr.push(w)
    else groups.set(k, [w])
  }

  const notified: { name: string; email: string; amount: number; charges: number }[] = []
  const notNotified: { name: string; why: string }[] = []

  for (const group of groups.values()) {
    const plan = planById.get(group[0].charge.plan_id)!
    const payerId = group[0].charge.plan_tenant_id
    const tenants = (plan.tenants as { id: string; name: string; email: string | null }[] | null) ?? []
    const tenant = tenants.find(t => t.id === payerId) ?? null
    const propertyName = one<{ name: string }>(plan.property as { name: string } | { name: string }[] | null)?.name
      ?? plan.name
    const total = round2(group.reduce((s, g) => s + g.outstanding, 0))

    const rows: WaivedFeeRow[] = group.map(({ charge, outstanding }) => ({
      label: monthLabel(charge.due_date),
      dueDate: charge.due_date,
      amount: outstanding,
      askedBefore: Number(charge.late_fee_reminder_count ?? 0) > 0,
    }))
    // Rent is a separate matter from the fee, and the tenant's email says so
    // once rather than carrying a demand. Voided rent is never in this set.
    const rentOutstanding = round2(group.reduce(
      (s, g) => s + Math.max(0, Number(g.charge.amount) - Number(g.charge.paid_amount ?? 0)), 0))

    const logItems: PaymentEmailItem[] = group.map(({ charge, outstanding }) => ({
      scheduledPaymentId: charge.id,
      specialPaymentId: null,
      label: `Late fee waived — ${monthLabel(charge.due_date)}`,
      dueDate: charge.due_date,
      amount: outstanding,
      kind: 'late_fee',
    }))

    const to = tenant?.email?.trim() || null
    let sentToTenant = false

    if (!notifyTenant) {
      notNotified.push({ name: tenant?.name ?? 'The lease', why: 'you chose not to send an email' })
    } else if (!to) {
      notNotified.push({ name: tenant?.name ?? 'The lease', why: 'no email address on file' })
    } else {
      const built = buildWaiverTenantEmail({
        tenantName: tenant?.name ?? 'there',
        propertyName,
        rows,
        tenantNote,
        landlordName,
        landlordEmail,
        rentOutstanding,
      })
      try {
        const { data: sendData, error: sendErr } = await resend.emails.send({
          from: 'HomeHive <hello@homehive.live>',
          to,
          subject: built.subject,
          html: built.html,
          text: built.text,
          ...(landlordEmail ? { replyTo: landlordEmail } : {}),
        })
        // Resend reports a rejection in `error` rather than throwing, so without
        // this a bounced address would be logged and counted as delivered.
        if (sendErr) throw new Error(sendErr.message || 'Resend rejected the send')

        sentToTenant = true
        await supabaseAdmin
          .from('late_fee_waivers')
          .update({ tenant_notified_at: stamp, tenant_notified_email: to })
          .in('scheduled_payment_id', group.map(g => g.charge.id))

        await logPaymentEmail({
          planId: plan.id, planTenantId: payerId, recipientEmail: to, recipientName: tenant?.name ?? null,
          subject: built.subject, kind: 'late_fee_waived', audience: 'tenant', status: 'sent',
          providerId: sendData?.id ?? null, customMessage: tenantNote, sentBy: user.id, items: logItems,
        })
        notified.push({ name: tenant?.name ?? 'The lease', email: to, amount: total, charges: group.length })
      } catch (e) {
        console.error('late fee waiver notice failed', payerId, e)
        // The waiver stands. A failed notice is history too — silence in the
        // log would read as "never announced" rather than "never arrived".
        await logPaymentEmail({
          planId: plan.id, planTenantId: payerId, recipientEmail: to, recipientName: tenant?.name ?? null,
          subject: built.subject, kind: 'late_fee_waived', audience: 'tenant', status: 'failed',
          error: e instanceof Error ? e.message : String(e),
          customMessage: tenantNote, sentBy: user.id, items: logItems,
        })
        notNotified.push({ name: tenant?.name ?? 'The lease', why: 'the email could not be delivered' })
      }
    }

    // The landlord's own receipt. Sent per payer so it matches the tenant's
    // copy one-for-one, and logged as `audience: 'landlord'` so the tenant
    // reminder history does not count it as a message to a tenant.
    if (notifyLandlord && landlordEmail) {
      const copy = buildWaiverLandlordEmail({
        landlordName,
        tenantName: tenant?.name ?? 'The lease',
        tenantEmail: to,
        propertyName,
        leaseName: plan.name,
        rows,
        reason,
        tenantNote,
        tenantNotified: sentToTenant,
        ledgerUrl: `${getSiteUrl()}/landlord/financials`,
      })
      try {
        const { data: sendData, error: sendErr } = await resend.emails.send({
          from: 'HomeHive <hello@homehive.live>',
          to: landlordEmail,
          subject: copy.subject,
          html: copy.html,
          text: copy.text,
        })
        if (sendErr) throw new Error(sendErr.message || 'Resend rejected the send')
        await logPaymentEmail({
          planId: plan.id, planTenantId: payerId, recipientEmail: landlordEmail, recipientName: landlordName,
          subject: copy.subject, kind: 'late_fee_waived_receipt', audience: 'landlord', status: 'sent',
          providerId: sendData?.id ?? null, sentBy: user.id, items: logItems,
        })
      } catch (e) {
        // The landlord's own copy failing changes nothing they need to act on —
        // they are looking at the result on screen. Logged, never surfaced.
        console.error('late fee waiver receipt failed', user.id, e)
      }
    }
  }

  return Response.json({
    waived: waivedTotal,
    charges: waivable.length,
    skipped: ids.length - waivable.length,
    notified,
    notNotified,
  })
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const ids = idsFrom(body)
  if (ids.length === 0) {
    return Response.json({ error: 'scheduledPaymentId is required.' }, { status: 400 })
  }

  const auth = await authorizeCharges(req, ids)
  if ('error' in auth) return auth.error

  const { error } = await supabaseAdmin
    .from('late_fee_waivers')
    .delete()
    .in('scheduled_payment_id', ids)

  if (error) {
    console.error('late fee unwaive failed', ids, error)
    return Response.json({ error: 'Could not undo the waiver.' }, { status: 500 })
  }

  // The fee is derived, so removing the waiver is all it takes for it to be
  // owed again at whatever the rule now says. No email: a tenant told the fee
  // was forgiven should hear about its return from their landlord in their own
  // words, not from an automated reversal notice.
  return Response.json({ restored: ids.length })
}
