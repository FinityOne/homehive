/**
 * POST /api/landlord/tenants/[tenantId]/late-warning
 *
 * Post the first formal notice that rent is late — to the resident, and to the
 * co-signers who guaranteed their lease.
 *
 * Body:
 *   {
 *     level?: 1,                  // the sequence; only 1 is offered in the UI today
 *     planTenantId?: string,      // required only when two tenancies are both behind
 *     message?: string,           // the landlord's own words
 *     respondBy?: 'YYYY-MM-DD',   // default: five days from today
 *     cosignerCheckIds?: string[],// which guarantors to copy; default: the approved ones
 *     preview?: true,             // build it and return it, send nothing, record nothing
 *   }
 *
 * ── The rules this route will not bend ──────────────────────────────────────
 *
 *   1. **The figures are recomputed here, from the rule, every time.** The
 *      browser's numbers are a preview. A tab left open since Tuesday must not
 *      be able to post a demand for rent that has since been paid, or a fee
 *      that has since been waived — `/api/tenant/pay` and the late-fee reminder
 *      both work this way, for the same reason.
 *   2. **Nothing may be warned about unless the whole due day has passed.**
 *      `warningBasis().sendable` is the gate, and a 409 is the right answer to
 *      a landlord pressing this on the morning rent is due.
 *   3. **A co-signer is only ever an address already on file.** The recipient
 *      list is filtered against this tenant's own co-signer screenings, so this
 *      endpoint can never be pointed at an arbitrary address. Without that it
 *      would be a send-anything relay wearing the platform's domain.
 *   4. **The notice is recorded even when the mail fails.** A landlord who
 *      believes they have served a notice that in fact bounced is in a worse
 *      position than one who knows it bounced.
 *   5. **It does not touch the charge rows.** `reminder_count` is a count of
 *      reminders; a notice is not a reminder, and quietly incrementing it would
 *      corrupt the one number the rent-reminder flow reasons about.
 */
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { billingToday } from '@/lib/rentPayments'
import { warningBasis } from '@/lib/tenantRecord'
import { buildLateWarningEmail } from '@/lib/lateWarningEmails'
import { logPaymentEmail, type PaymentEmailItem } from '@/lib/paymentEmailLog'
import {
  dossierAdmin, loadTenantContext, loadCosigners, cosignerIsOnTheHook,
  type DossierCheck, type DossierPayer,
} from '@/lib/tenantDossierServer'

const resend = new Resend(process.env.RESEND_API_KEY!)

/** How long the notice gives them, by default. */
const DEFAULT_GRACE_DAYS = 5

const addDays = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const nameOf = (t: { first_name: string; last_name: string | null }) =>
  [t.first_name, t.last_name].filter(Boolean).join(' ').trim()

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db = dossierAdmin()
  const { data: { user }, error: authErr } = await db.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const preview = body.preview === true
  const level = ([1, 2, 3] as const).includes(body.level) ? (body.level as 1 | 2 | 3) : 1
  const message: string | null = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 600)
    : null

  const { data: profile } = await db
    .from('profiles').select('role, full_name, email').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'

  const ctxResult = await loadTenantContext(tenantId, user.id, isAdmin)
  if (!ctxResult.ok) return Response.json({ error: ctxResult.error }, { status: ctxResult.status })
  const { tenant, leases, payers } = ctxResult

  const to = tenant.email?.trim()
  if (!to) {
    return Response.json({ error: 'This tenant has no email address on file.' }, { status: 409 })
  }

  // ── Which tenancy is this notice about? ───────────────────────────────────
  const now = new Date()
  const today = billingToday(now)
  const withBasis = payers.map(p => ({
    payer: p,
    basis: warningBasis(p.scheduled, p.specials, p.rule, now),
  }))
  const behind = withBasis.filter(x => x.basis.sendable)

  if (behind.length === 0) {
    // Rule 2. Being precise about *why* matters: "nothing is late" and "they owe
    // nothing" are different facts and a landlord will act differently on each.
    const owesFeesOnly = withBasis.some(x => x.basis.feeTotal > 0)
    return Response.json({
      error: owesFeesOnly
        ? 'Nothing is past due. There is an outstanding late fee on rent that has since been paid — send a late fee reminder for that instead.'
        : 'Nothing is past due for this tenant, so there is no first notice to send.',
    }, { status: 409 })
  }

  let chosen = behind[0]
  if (body.planTenantId) {
    const match = behind.find(x => x.payer.planTenantId === body.planTenantId)
    if (!match) {
      return Response.json({ error: 'Nothing is past due on that tenancy.' }, { status: 409 })
    }
    chosen = match
  } else if (behind.length > 1) {
    // Two tenancies behind at once is rare and ambiguous. Guessing would post a
    // notice about the wrong home, so the caller is asked.
    return Response.json({
      error: 'This tenant is behind on more than one tenancy. Choose which one the notice is about.',
      choices: behind.map(x => ({
        planTenantId: x.payer.planTenantId,
        propertyName: x.payer.propertyName,
        total: x.basis.total,
      })),
    }, { status: 409 })
  }

  const payer: DossierPayer = chosen.payer
  const basis = chosen.basis
  const lease = leases.find(l => l.id === payer.leaseId) ?? null

  // ── Who gets a copy ───────────────────────────────────────────────────────
  const { cosigners } = await loadCosigners(tenant)
  const requested: string[] | null = Array.isArray(body.cosignerCheckIds)
    ? body.cosignerCheckIds.filter((v: unknown) => typeof v === 'string')
    : null

  // Rule 3: always a filter over what is on file, never a list taken on trust.
  const copies: DossierCheck[] = requested
    ? cosigners.filter(c => requested.includes(c.id) && Boolean(c.email))
    : cosigners.filter(cosignerIsOnTheHook)

  const respondBy: string = typeof body.respondBy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.respondBy)
    // A deadline in the past is not a deadline.
    && body.respondBy > today
    ? body.respondBy
    : addDays(today, DEFAULT_GRACE_DAYS)

  const tenantName = nameOf(tenant) || tenant.email
  const payUrl = `${getSiteUrl()}/dashboard/lease?tab=payments&pay=1`
  const shared = {
    level,
    tenantName,
    propertyName: payer.propertyName,
    unitLabel: lease?.unitNumber ?? null,
    basis,
    payUrl,
    respondBy,
    rule: payer.rule,
    landlordName: profile?.full_name ?? null,
    landlordEmail: profile?.email ?? user.email ?? null,
    customMessage: message,
  }

  const tenantEmail = buildLateWarningEmail({
    ...shared,
    audience: 'tenant',
    // The resident is told who else was written to. See `lateWarningEmails.ts`.
    copiedTo: copies.map(c => c.name || c.email!).filter(Boolean) as string[],
  })

  const cosignerEmails = copies.map(c => ({
    check: c,
    built: buildLateWarningEmail({
      ...shared,
      audience: 'cosigner',
      recipientName: c.name,
      relationship: c.relationship,
    }),
  }))

  // ── Preview ───────────────────────────────────────────────────────────────
  // Nothing is sent and nothing is recorded. A first notice is the one email on
  // this platform a landlord should be able to read in full before it goes.
  if (preview) {
    return Response.json({
      preview: true,
      asOf: basis.asOf,
      respondBy,
      basis,
      tenancy: {
        planTenantId: payer.planTenantId,
        planId: payer.planId,
        propertyName: payer.propertyName,
        unitLabel: lease?.unitNumber ?? null,
      },
      messages: [
        { audience: 'tenant', to, name: tenantName, ...tenantEmail },
        ...cosignerEmails.map(c => ({
          audience: 'cosigner' as const,
          to: c.check.email!,
          name: c.check.name,
          relationship: c.check.relationship,
          checkId: c.check.id,
          ...c.built,
        })),
      ],
      cosignersOnFile: cosigners.map(c => ({
        id: c.id, name: c.name, email: c.email, relationship: c.relationship,
        status: c.status, included: copies.some(x => x.id === c.id),
      })),
    })
  }

  // ── Record the notice first ───────────────────────────────────────────────
  // Rule 4. The row is the notice; the sends are how it travelled. Writing it
  // before the mail goes means a send that half-fails still leaves a trail.
  const { data: warning, error: warnErr } = await db
    .from('rent_late_warnings')
    .insert([{
      owner_id: tenant.owner_id,
      tenant_id: tenant.id,
      plan_id: payer.planId,
      plan_tenant_id: payer.planTenantId,
      lease_id: payer.leaseId,
      property_id: lease?.propertyId ?? null,
      level,
      as_of: basis.asOf,
      rent_due: basis.rentTotal + basis.chargeTotal,
      late_fee_due: basis.feeTotal,
      total_due: basis.total,
      days_late: basis.oldestDaysLate,
      note: message,
      sent_by: user.id,
    }])
    .select('id')
    .single()

  if (warnErr || !warning) {
    console.error('late warning insert failed', warnErr)
    return Response.json({ error: 'Could not record the notice, so nothing was sent.' }, { status: 500 })
  }

  // What the notice covered, as the recipients were shown it. A charge edited
  // tomorrow must not rewrite what was asked for today.
  const items: PaymentEmailItem[] = [...basis.rent, ...basis.charges, ...basis.fees].map(l => ({
    scheduledPaymentId: l.kind === 'charge' ? null : l.id,
    specialPaymentId:   l.kind === 'charge' ? l.id : null,
    label: l.label,
    dueDate: l.dueDate,
    amount: l.amount,
    kind: l.kind,
  }))

  const replyTo = shared.landlordEmail ? { replyTo: shared.landlordEmail } : {}
  // Captured out of the closure below, which otherwise loses the narrowing the
  // guards above already proved.
  const warningId = warning.id
  const sentBy = user.id
  const sent: { audience: string; to: string; name: string | null }[] = []
  const failed: { audience: string; to: string; reason: string }[] = []

  async function post(
    audience: 'tenant' | 'cosigner',
    address: string,
    name: string | null,
    built: { subject: string; html: string; text: string },
  ) {
    try {
      const { data, error } = await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: address,
        subject: built.subject,
        html: built.html,
        text: built.text,
        ...replyTo,
      })
      // Resend reports a refusal in `error` rather than by throwing, so without
      // this a bounced address is logged as delivered.
      if (error) throw new Error(error.message || 'Resend rejected the send')

      await logPaymentEmail({
        planId: payer.planId,
        // A co-signer is not a payer on the plan, so there is no plan-tenant to
        // attribute their copy to. The warning id is what ties it back.
        planTenantId: audience === 'tenant' ? payer.planTenantId : null,
        recipientEmail: address,
        recipientName: name,
        subject: built.subject,
        kind: `late_warning_${level}`,
        audience,
        trigger: 'manual',
        status: 'sent',
        providerId: data?.id ?? null,
        customMessage: message,
        sentBy,
        lateWarningId: warningId,
        items,
      })
      sent.push({ audience, to: address, name })
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.error('late warning send failed', audience, address, reason)
      await logPaymentEmail({
        planId: payer.planId,
        planTenantId: audience === 'tenant' ? payer.planTenantId : null,
        recipientEmail: address,
        recipientName: name,
        subject: built.subject,
        kind: `late_warning_${level}`,
        audience,
        trigger: 'manual',
        status: 'failed',
        error: reason,
        customMessage: message,
        sentBy,
        lateWarningId: warningId,
        items,
      })
      failed.push({ audience, to: address, reason })
    }
  }

  // The resident first, always. If only one of these lands it should be theirs:
  // a co-signer told before the tenant is how a tenancy turns adversarial.
  await post('tenant', to, tenantName, tenantEmail)
  for (const c of cosignerEmails) {
    await post('cosigner', c.check.email!, c.check.name, c.built)
  }

  return Response.json({
    warningId: warning.id,
    level,
    asOf: basis.asOf,
    respondBy,
    total: basis.total,
    sent,
    failed,
  })
}
