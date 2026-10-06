/**
 * GET /api/cron/rent-reminders
 *
 * Emails tenants a courtesy notice seven days before rent is due.
 *
 * Runs daily and looks at exactly one day — the charges due in 7 days' time —
 * rather than a range. A range would re-send to the same tenant every morning
 * until the due date arrived; a single day plus the claim log in
 * `rent_reminder_sends` means each charge is announced once, and a retry after a
 * partial failure picks up only what it missed.
 *
 * One email per tenant, not per charge: somebody paying rent plus a parking fee
 * on the same date should get one notice listing both, which is also why the
 * existing `buildRentReminderEmail` is reused rather than a new template — the
 * tenant should recognise it as the same mail their landlord sends by hand.
 *
 * Secured with CRON_SECRET, like the other cron routes.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { buildRentReminderEmail, type ReminderRow } from '@/lib/rentReminderEmails'
import { getSiteUrl } from '@/lib/siteUrl'
import { amountDue, lateFeeRuleRisk, fmtMoney, type LateFeeRuleLike } from '@/lib/rentPayments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const FROM = 'HomeHive <hello@homehive.live>'

/** How far ahead of the due date the notice goes out. */
const DAYS_AHEAD = 7
const KIND = `upcoming_${DAYS_AHEAD}d`

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type Target = {
  tenantId: string
  tenantName: string
  email: string
  propertyName: string
  planId: string
  landlordName: string | null
  landlordEmail: string | null
  rule: LateFeeRuleLike | null
  rows: ReminderRow[]
  /** Charge ids to claim once the email is away. */
  scheduledIds: string[]
  specialIds: string[]
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: 'Email is not configured' }, { status: 500 })
  }

  // `?dry=1` reports what would be sent without emailing or claiming anything,
  // which is the only safe way to check this against production data.
  const params = new URL(req.url).searchParams
  const dryRun = params.get('dry') === '1'

  // `?date=` aims the run at a specific due date, and is honoured only together
  // with `dry=1`. Rent lands on the 1st, so a live dry run on an arbitrary day
  // finds nothing and proves nothing; this makes the grouping inspectable
  // without ever being able to send mail for the wrong day.
  const override = dryRun ? params.get('date') : null
  let dueDate: string
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    dueDate = override
  } else {
    const target = new Date()
    target.setDate(target.getDate() + DAYS_AHEAD)
    dueDate = isoDay(target)
  }

  // Rent falling due that day and not already settled or clearing.
  const { data: sched, error: schedErr } = await supabaseAdmin
    .from('scheduled_payments')
    .select('id, plan_id, plan_tenant_id, due_date, amount, paid_amount, status')
    .eq('due_date', dueDate)
    .not('status', 'in', '(paid,processing,voided)')
  if (schedErr) {
    console.error('[rent-reminders] scheduled lookup failed', schedErr.message)
    return Response.json({ error: 'Lookup failed' }, { status: 500 })
  }

  const { data: specials } = await supabaseAdmin
    .from('special_payments')
    .select('id, plan_id, plan_tenant_id, due_date, amount, label, status')
    .eq('due_date', dueDate)
    .eq('status', 'pending')

  const schedRows = sched ?? []
  const specialRows = specials ?? []
  if (schedRows.length === 0 && specialRows.length === 0) {
    return Response.json({ ok: true, dueDate, sent: 0, note: 'nothing due in 7 days' })
  }

  // Skip anything already announced. Checked up front so a re-run costs one
  // query rather than one failed insert per charge.
  const { data: already } = await supabaseAdmin
    .from('rent_reminder_sends')
    .select('scheduled_payment_id, special_payment_id')
    .eq('kind', KIND)
    .or([
      schedRows.length ? `scheduled_payment_id.in.(${schedRows.map(r => r.id).join(',')})` : null,
      specialRows.length ? `special_payment_id.in.(${specialRows.map(r => r.id).join(',')})` : null,
    ].filter(Boolean).join(','))
  const claimedSched = new Set((already ?? []).map(r => r.scheduled_payment_id).filter(Boolean))
  const claimedSpecial = new Set((already ?? []).map(r => r.special_payment_id).filter(Boolean))

  const planIds = [...new Set([...schedRows, ...specialRows].map(r => r.plan_id).filter(Boolean))]
  const [{ data: plans }, { data: payers }, { data: rules }] = await Promise.all([
    supabaseAdmin.from('payment_plans').select('id, owner_id, property:properties ( name )').in('id', planIds),
    supabaseAdmin.from('payment_plan_tenants').select('id, plan_id, name, email, status').in('plan_id', planIds),
    supabaseAdmin.from('late_fee_rules')
      .select('plan_id, grace_period_days, fee_amount, frequency_days, max_total_fees')
      .in('plan_id', planIds),
  ])

  const ownerIds = [...new Set((plans ?? []).map(p => p.owner_id).filter(Boolean))]
  const { data: profiles } = ownerIds.length
    ? await supabaseAdmin.from('profiles').select('id, full_name, first_name, email').in('id', ownerIds)
    : { data: [] as { id: string; full_name: string | null; first_name: string | null; email: string | null }[] }

  const planById = new Map((plans ?? []).map(p => [p.id, p]))
  const payerById = new Map((payers ?? []).map(t => [t.id, t]))
  const ruleByPlan = new Map((rules ?? []).map(r => [r.plan_id, r as LateFeeRuleLike]))
  const profileById = new Map((profiles ?? []).map(p => [p.id, p]))

  const propertyNameOf = (planId: string): string => {
    const raw = (planById.get(planId) as { property?: unknown } | undefined)?.property
    const prop = Array.isArray(raw) ? raw[0] : raw
    return (prop as { name?: string } | null)?.name ?? 'your home'
  }

  // Group by payer: one email listing everything that person owes on the date.
  const byTenant = new Map<string, Target>()

  const ensure = (planId: string, payerId: string | null): Target | null => {
    if (!payerId) return null
    const payer = payerById.get(payerId)
    // A terminated payer still has rows on the schedule; reminding them to pay
    // rent they no longer owe would be worse than staying quiet.
    if (!payer || payer.status !== 'active') return null
    const email = payer.email?.trim()
    if (!email) return null

    const existing = byTenant.get(payerId)
    if (existing) return existing

    const plan = planById.get(planId)
    const profile = plan ? profileById.get(plan.owner_id) : undefined
    const t: Target = {
      tenantId: payerId,
      tenantName: payer.name ?? 'there',
      email,
      propertyName: propertyNameOf(planId),
      planId,
      landlordName: profile?.full_name || profile?.first_name || null,
      landlordEmail: profile?.email?.trim() || null,
      rule: ruleByPlan.get(planId) ?? null,
      rows: [],
      scheduledIds: [],
      specialIds: [],
    }
    byTenant.set(payerId, t)
    return t
  }

  for (const r of schedRows) {
    if (claimedSched.has(r.id)) continue
    const due = amountDue({ amount: Number(r.amount), paid_amount: Number(r.paid_amount ?? 0) })
    if (due <= 0) continue
    const t = ensure(r.plan_id, r.plan_tenant_id)
    if (!t) continue
    t.rows.push({
      label: `Rent — ${new Date(r.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
      dueDate: r.due_date,
      amount: due,
      // Nothing here is late — that is the whole point of a notice sent in
      // advance, and it is what picks the email's gentler tone.
      daysLate: 0,
      kind: 'rent',
    })
    t.scheduledIds.push(r.id)
  }

  for (const r of specialRows) {
    if (claimedSpecial.has(r.id)) continue
    if (Number(r.amount) <= 0) continue
    const t = ensure(r.plan_id, r.plan_tenant_id)
    if (!t) continue
    t.rows.push({ label: r.label, dueDate: r.due_date, amount: Number(r.amount), daysLate: 0, kind: 'charge' })
    t.specialIds.push(r.id)
  }

  const targets = [...byTenant.values()].filter(t => t.rows.length > 0)
  if (targets.length === 0) {
    return Response.json({ ok: true, dueDate, sent: 0, note: 'everything already reminded or nobody eligible' })
  }

  if (dryRun) {
    return Response.json({
      ok: true, dryRun: true, dueDate,
      would_send: targets.map(t => ({
        to: t.email, tenant: t.tenantName, property: t.propertyName,
        total: t.rows.reduce((s, r) => s + r.amount, 0),
        items: t.rows.map(r => r.label),
      })),
    })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const sent: string[] = []
  const failed: { to: string; reason: string }[] = []

  for (const t of targets) {
    try {
      // What the late-fee rule will cost them if this slips. Stated as the rule,
      // not as a threat, and omitted entirely when there is no rule to quote.
      const risk = lateFeeRuleRisk(t.rule)
      // The ceiling has to be stated, and it has to be the one actually
      // enforced. An uncapped rule is held to the size of the charge (see
      // `lateFeeDue`), so quoting "$15 per day" with no limit would overstate
      // what this tenant can ever be billed.
      const rentTotal = t.rows.reduce((s, r) => s + r.amount, 0)
      const ceiling = t.rule?.max_total_fees ?? rentTotal
      const lateFeeNote = t.rule && t.rule.fee_amount > 0
        ? `If this isn't paid on time, a late fee of ${fmtMoney(t.rule.fee_amount)} applies`
          + (t.rule.frequency_days === 1 ? ' per day' : ` every ${t.rule.frequency_days} days`)
          + (t.rule.grace_period_days > 0 ? `, after a ${t.rule.grace_period_days}-day grace period` : '')
          + `, up to a maximum of ${fmtMoney(ceiling)}.`
        : null

      const { subject, html, text } = buildRentReminderEmail({
        tenantName: t.tenantName,
        propertyName: t.propertyName,
        rows: t.rows,
        payUrl: `${getSiteUrl()}/dashboard/lease?tab=payments&pay=1`,
        landlordName: t.landlordName,
        landlordEmail: t.landlordEmail,
        lateFeeNote,
      })

      const { error } = await resend.emails.send({
        from: FROM, to: t.email, subject, html, text,
        ...(t.landlordEmail ? { replyTo: t.landlordEmail } : {}),
      })
      if (error) {
        failed.push({ to: t.email, reason: error.message })
        continue
      }

      // Claim only after the send succeeded, so a failure is retried tomorrow
      // rather than silently swallowed. The unique index absorbs a double claim.
      // Rent and one-off charges are claimed separately: each has its own
      // partial unique index, and one `onConflict` cannot name both.
      const claimErrs: string[] = []
      if (t.scheduledIds.length > 0) {
        const { error } = await supabaseAdmin
          .from('rent_reminder_sends')
          .upsert(
            t.scheduledIds.map(id => ({ scheduled_payment_id: id, kind: KIND, recipient_email: t.email })),
            { onConflict: 'scheduled_payment_id,kind', ignoreDuplicates: true },
          )
        if (error) claimErrs.push(error.message)
      }
      if (t.specialIds.length > 0) {
        const { error } = await supabaseAdmin
          .from('rent_reminder_sends')
          .upsert(
            t.specialIds.map(id => ({ special_payment_id: id, kind: KIND, recipient_email: t.email })),
            { onConflict: 'special_payment_id,kind', ignoreDuplicates: true },
          )
        if (error) claimErrs.push(error.message)
      }
      if (claimErrs.length > 0) {
        // The tenant already has the email. Log loudly rather than fail the run —
        // the worst case is one duplicate notice, which beats crashing the cron.
        console.error('[rent-reminders] could not record claim for', t.email, claimErrs.join(' · '))
      }
      sent.push(t.email)
      if (risk) console.warn('[rent-reminders] uncapped late-fee rule on plan', t.planId, '—', risk)
    } catch (e) {
      failed.push({ to: t.email, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  return Response.json({ ok: true, dueDate, sent: sent.length, failed })
}
