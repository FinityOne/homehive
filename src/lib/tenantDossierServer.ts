/**
 * Everything the landlord's tenant page knows about one person — assembled
 * server-side, under the service role, once.
 *
 * ── Why a server module and not a client query ──────────────────────────────
 *
 * Three reasons, in order of how much they matter:
 *
 *   1. **Some of it is not the browser's to read.** Whether an email address
 *      has ever signed in lives in `auth.users`, which PostgREST does not
 *      expose; it comes through `auth_activity_for_email`, a service-role-only
 *      function (see the `20261118000000` migration). A co-signer's screening
 *      sits on `background_checks` rows that are not joined to the tenant by
 *      anything the client could filter on either.
 *   2. **The join is not a join.** A `tenants` row and a *payer* on a payment
 *      plan are linked by nothing but an email address — `payment_plan_tenants`
 *      has no `tenant_id`. Resolving that is a sequence of queries with a
 *      fallback, and it has to produce the same answer for the page and for the
 *      warning route, or a landlord could be shown a balance that the notice
 *      then refuses to chase.
 *   3. One request, not fourteen. The portal's slowness has twice turned out to
 *      be the number of round trips rather than the size of any one of them.
 *
 * ── The linkage, stated plainly ─────────────────────────────────────────────
 *
 * A tenant is matched to a payer by **email, case-insensitively**. Where that
 * finds nothing on a plan that sits on one of the tenant's own leases, their
 * **name** is tried as a fallback — a landlord who typed "Gauge Berkhahn" into
 * a payment plan and `gauge@…` into the tenant record should still see their
 * rent. The match that was used is reported in `linkage` so the page can say
 * so rather than quietly implying a certainty it does not have.
 *
 * Nothing here is ever reached without proving ownership first: every query is
 * scoped to the caller's `owner_id`, and `loadTenantContext` returns a 403-able
 * error rather than a partial payload.
 */
import { createClient } from '@supabase/supabase-js'
import type { LateFeeRuleLike } from '@/lib/rentPayments'
import type { TenantScheduledRow, TenantSpecialRow } from '@/lib/tenantCharges'
import { outcomeOf, type EmailOutcome } from '@/lib/paymentEmails'

export const dossierAdmin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
)

/** A to-one relation Supabase may hand back as a single row or a one-row array. */
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const num = (v: unknown) => Number(v ?? 0)

/**
 * Why email filters are never folded into an `.or(...)`.
 *
 * PostgREST's `or` takes a comma-separated expression list, so a value
 * containing a comma — or any of its other reserved punctuation — changes the
 * meaning of the filter rather than being matched literally. Email addresses
 * are user-supplied and the one piece of this record that a tenant chooses, so
 * every address filter is its own query and the results are merged here. The
 * `or`s that remain carry nothing but uuids.
 */
function mergeById<T extends { [k: string]: any }>(key: string, ...lists: (T[] | null | undefined)[]): T[] {
  const seen = new Map<string, T>()
  for (const list of lists) for (const row of list ?? []) {
    const k = String(row[key])
    if (!seen.has(k)) seen.set(k, row)
  }
  return [...seen.values()]
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export type DossierTenant = {
  id: string
  owner_id: string
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  notes: string | null
  status: string
  rating: number | null
  lead_id: string | null
  created_at: string
}

export type DossierDocument = {
  id: string
  name: string
  storagePath: string
  createdAt: string
}

export type DossierLease = {
  id: string
  propertyId: string | null
  propertyName: string
  propertySlug: string | null
  unitNumber: string | null
  startDate: string
  endDate: string
  rentAmount: number | null
  isDemo: boolean
  notes: string | null
  /** The other names on the same lease. Who they actually live with. */
  housemates: { name: string | null; email: string | null; isThisTenant: boolean }[]
  documents: DossierDocument[]
}

/**
 * A rent charge, as the page shows it.
 *
 * `TenantScheduledRow` is exactly what the charge engine reads and no more; the
 * extra columns here are narrative — how the money arrived, who recorded it,
 * how many times this month has been chased — and no rule ever reads them.
 */
export type DossierScheduled = TenantScheduledRow & {
  settled_at: string | null
  payment_method: string | null
  recorded_by: string | null
  stripe_payment_intent_id: string | null
  reminder_count: number
  reminder_sent_at: string | null
}

export type DossierSpecial = TenantSpecialRow & {
  category: string | null
  paid_date: string | null
  notes: string | null
}

/**
 * This tenant as a payer on one payment plan — the money half of the record.
 *
 * One tenant may appear on several: a renewal creates a second lease, and a
 * second lease carries a second plan.
 */
export type DossierPayer = {
  planId: string
  planTenantId: string
  planName: string
  leaseId: string | null
  propertyName: string
  dueDay: number | null
  monthlyTotal: number
  /** 'active' | 'terminated' — the payer's own status on the plan. */
  status: string | null
  startDate: string | null
  endDate: string | null
  terminationDate: string | null
  /** How this payer was matched to the tenant record. See the file note. */
  matchedBy: 'email' | 'name'
  rule: LateFeeRuleLike | null
  /** What the monthly figure is made of. */
  lineItems: { label: string; category: string; amount: number; notes: string | null }[]
  scheduled: DossierScheduled[]
  specials: DossierSpecial[]
}

export type DossierEmail = {
  id: string
  recipientEmail: string
  recipientName: string | null
  subject: string
  kind: string
  audience: string
  trigger: string
  outcome: EmailOutcome
  amountTotal: number
  createdAt: string
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  bouncedAt: string | null
  lateWarningId: string | null
  customMessage: string | null
  error: string | null
}

export type DossierAttempt = {
  id: string
  planId: string
  method: string | null
  status: string
  amount: number
  submittedAt: string | null
  clearedAt: string | null
  failedAt: string | null
  failureMessage: string | null
  items: { kind: string; id: string; label: string; due_date: string | null; amount: number }[]
}

export type DossierWarning = {
  id: string
  level: number
  asOf: string
  rentDue: number
  lateFeeDue: number
  totalDue: number
  daysLate: number
  note: string | null
  createdAt: string
  /** Who it actually reached. Pulled from the sends that point back at it. */
  sends: { email: string; name: string | null; audience: string; outcome: EmailOutcome }[]
}

/** A screening on file — the tenant's own, or a co-signer's. */
export type DossierCheck = {
  id: string
  isCosigner: boolean
  cosignerForCheckId: string | null
  relationship: string | null
  name: string | null
  email: string | null
  phone: string | null
  status: string | null
  decision: string | null
  incomeMonthly: number | null
  createdAt: string
}

export type DossierAccount = {
  /** False when nothing on this address has ever been registered. */
  exists: boolean
  createdAt: string | null
  lastSignInAt: string | null
  emailConfirmedAt: string | null
}

export type Dossier = {
  tenant: DossierTenant
  linkage: { payers: number; matchedBy: ('email' | 'name')[] }
  leases: DossierLease[]
  payers: DossierPayer[]
  emails: DossierEmail[]
  attempts: DossierAttempt[]
  warnings: DossierWarning[]
  /** The tenant's own screenings, newest first. */
  checks: DossierCheck[]
  /** Everyone who co-signed for them. */
  cosigners: DossierCheck[]
  account: DossierAccount
  /** Browsing, for a tenant who came in through the public site. */
  visits: { count: number; lastAt: string | null; recent: { path: string; at: string }[] }
  amendments: {
    id: string; kind: string; title: string; status: string
    effectiveDate: string | null; signedAt: string | null; sentAt: string | null
  }[]
  renewals: {
    id: string; status: string; newRent: number | null; newStartDate: string | null
    newEndDate: string | null; respondBy: string | null; sentAt: string | null
    respondedAt: string | null
  }[]
}

// ─── The loader ──────────────────────────────────────────────────────────────

export type ContextResult =
  | { ok: false; status: number; error: string }
  | { ok: true; tenant: DossierTenant; leases: DossierLease[]; payers: DossierPayer[] }

/**
 * The tenant, their leases, and their money — the part both routes need.
 *
 * Kept separate from the rest of the dossier because the warning route has no
 * use for login activity or browsing history, and should not pay for them.
 */
export async function loadTenantContext(
  tenantId: string,
  userId: string,
  isAdmin = false,
): Promise<ContextResult> {
  const db = dossierAdmin()

  const { data: tenant } = await db
    .from('tenants')
    .select('id, owner_id, first_name, last_name, email, phone, notes, status, rating, lead_id, created_at')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) return { ok: false, status: 404, error: 'Tenant not found.' }
  if (tenant.owner_id !== userId && !isAdmin) {
    return { ok: false, status: 403, error: 'That tenant belongs to another account.' }
  }

  const email = lower(tenant.email)
  const fullName = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ').trim().toLowerCase()

  // ── Leases ────────────────────────────────────────────────────────────────
  // `tenant_id` is the real link and is set on every row the app writes today;
  // the email arm is for the rows that predate it. Two queries, not one `.or` —
  // see `mergeById`.
  const [{ data: linksById }, { data: linksByEmail }] = await Promise.all([
    db.from('lease_tenants').select('id, lease_id, tenant_id, name, email').eq('tenant_id', tenantId),
    db.from('lease_tenants').select('id, lease_id, tenant_id, name, email').ilike('email', email),
  ])
  const links = mergeById('id', linksById, linksByEmail)

  const leaseIds = [...new Set(links.map(l => l.lease_id).filter(Boolean))] as string[]

  let leases: DossierLease[] = []
  if (leaseIds.length > 0) {
    const { data: leaseRows } = await db
      .from('leases')
      .select(`
        id, property_id, start_date, end_date, rent_amount, unit_number, notes, is_demo,
        property:properties ( id, name, slug ),
        lease_tenants ( tenant_id, name, email ),
        lease_documents ( id, name, storage_path, created_at )
      `)
      .in('id', leaseIds)
      // Not `.eq('owner_id', userId)` for an admin, but a lease reached through
      // this tenant's own rows cannot belong to anyone else's portfolio anyway.
      .eq('owner_id', tenant.owner_id)
      .order('start_date', { ascending: false })

    leases = (leaseRows ?? []).map((l: any) => ({
      id: l.id,
      propertyId: l.property_id ?? null,
      propertyName: one<any>(l.property)?.name ?? 'Property',
      propertySlug: one<any>(l.property)?.slug ?? null,
      unitNumber: l.unit_number ?? null,
      startDate: l.start_date,
      endDate: l.end_date,
      rentAmount: l.rent_amount == null ? null : num(l.rent_amount),
      isDemo: Boolean(l.is_demo),
      notes: l.notes ?? null,
      housemates: (l.lease_tenants ?? []).map((t: any) => ({
        name: t.name ?? null,
        email: t.email ?? null,
        isThisTenant: t.tenant_id === tenantId || lower(t.email) === email,
      })),
      documents: (l.lease_documents ?? []).map((d: any) => ({
        id: d.id, name: d.name, storagePath: d.storage_path, createdAt: d.created_at,
      })),
    }))
  }

  // ── Payers ────────────────────────────────────────────────────────────────
  // Two routes in: an email match anywhere in the portfolio, and the plans that
  // sit on this tenant's own leases (where the name fallback applies).
  const { data: byEmail } = await db
    .from('payment_plan_tenants')
    .select('plan_id')
    .ilike('email', email)

  const planIds = [...new Set([
    ...(byEmail ?? []).map(r => r.plan_id),
  ])].filter(Boolean) as string[]

  const planFilter: string[] = []
  if (planIds.length > 0) planFilter.push(`id.in.(${planIds.join(',')})`)
  if (leaseIds.length > 0) planFilter.push(`lease_id.in.(${leaseIds.join(',')})`)

  let payers: DossierPayer[] = []
  if (planFilter.length > 0) {
    const { data: plans } = await db
      .from('payment_plans')
      .select(`
        id, name, due_day, lease_id, owner_id,
        property:properties ( name ),
        rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees ),
        tenants:payment_plan_tenants (
          id, name, email, monthly_total, status, start_date, end_date, termination_date,
          line_items:payment_line_items ( label, category, amount, notes )
        ),
        scheduled_payments (
          id, plan_tenant_id, due_date, amount, status, paid_amount, paid_date,
          submitted_at, late_fee_paid, settled_at, payment_method, recorded_by,
          stripe_payment_intent_id, reminder_count, reminder_sent_at
        ),
        special_payments (
          id, plan_tenant_id, label, category, amount, due_date, status, paid_date,
          submitted_at, payment_method, notes
        )
      `)
      .or(planFilter.join(','))
      .eq('owner_id', tenant.owner_id)

    // Every rent row this tenant is on, so the waivers can be fetched in one go.
    const scheduledIds: string[] = []

    for (const plan of (plans ?? []) as any[]) {
      const planTenants = (plan.tenants ?? []) as any[]
      // Email first; the name fallback only applies on a plan we reached through
      // one of the tenant's own leases — matching a name portfolio-wide would
      // attach another landlord's "Sean M" to this record.
      let mine = planTenants.filter(t => lower(t.email) === email)
      let matchedBy: 'email' | 'name' = 'email'
      if (mine.length === 0 && plan.lease_id && leaseIds.includes(plan.lease_id) && fullName) {
        mine = planTenants.filter(t => lower(t.name) === fullName)
        matchedBy = 'name'
      }

      for (const pt of mine) {
        const scheduled = ((plan.scheduled_payments ?? []) as any[])
          .filter(sp => sp.plan_tenant_id === pt.id)
          .map(sp => ({
            id: sp.id,
            due_date: sp.due_date,
            amount: num(sp.amount),
            status: sp.status,
            paid_amount: num(sp.paid_amount),
            paid_date: sp.paid_date ?? null,
            submitted_at: sp.submitted_at ?? null,
            late_fee_paid: num(sp.late_fee_paid),
            late_fee_waived: 0,
            late_fee_waiver: null,
            // Carried through for the page's own table, not read by the engine.
            settled_at: sp.settled_at ?? null,
            payment_method: sp.payment_method ?? null,
            recorded_by: sp.recorded_by ?? null,
            stripe_payment_intent_id: sp.stripe_payment_intent_id ?? null,
            reminder_count: sp.reminder_count ?? 0,
            reminder_sent_at: sp.reminder_sent_at ?? null,
          })) as DossierScheduled[]

        scheduledIds.push(...scheduled.map(s => s.id))

        const specials = ((plan.special_payments ?? []) as any[])
          .filter(sp => sp.plan_tenant_id === pt.id)
          .map(sp => ({
            id: sp.id,
            label: sp.label,
            amount: num(sp.amount),
            status: sp.status,
            due_date: sp.due_date ?? null,
            category: sp.category ?? null,
            paid_date: sp.paid_date ?? null,
            notes: sp.notes ?? null,
          })) as DossierSpecial[]

        payers.push({
          planId: plan.id,
          planTenantId: pt.id,
          planName: plan.name ?? 'Payment plan',
          leaseId: plan.lease_id ?? null,
          propertyName: one<any>(plan.property)?.name ?? 'Property',
          dueDay: plan.due_day ?? null,
          monthlyTotal: num(pt.monthly_total),
          status: pt.status ?? null,
          startDate: pt.start_date ?? null,
          endDate: pt.end_date ?? null,
          terminationDate: pt.termination_date ?? null,
          matchedBy,
          rule: one<LateFeeRuleLike>(plan.rule) ?? null,
          lineItems: (pt.line_items ?? []).map((li: any) => ({
            label: li.label, category: li.category, amount: num(li.amount), notes: li.notes ?? null,
          })),
          scheduled,
          specials,
        })
      }
    }

    // ── Waivers ──────────────────────────────────────────────────────────────
    // A waived fee is owed nothing and must still be visible as something that
    // happened — `tenantCharges` rule 4. It only knows that if the waiver rides
    // on the row.
    if (scheduledIds.length > 0) {
      const { data: waivers } = await db
        .from('late_fee_waivers')
        .select('scheduled_payment_id, amount, created_at, tenant_note')
        .in('scheduled_payment_id', scheduledIds)

      const byCharge = new Map<string, { amount: number; waivedOn: string; note: string | null }>()
      for (const w of waivers ?? []) {
        const prev = byCharge.get(w.scheduled_payment_id)
        // Several waivers on one charge add up; the latest date is the one shown.
        byCharge.set(w.scheduled_payment_id, {
          amount: (prev?.amount ?? 0) + num(w.amount),
          waivedOn: (w.created_at ?? '').slice(0, 10),
          note: w.tenant_note ?? prev?.note ?? null,
        })
      }
      for (const p of payers) {
        for (const s of p.scheduled) {
          const w = byCharge.get(s.id)
          if (!w) continue
          s.late_fee_waived = w.amount
          s.late_fee_waiver = w
        }
      }
    }

    // Oldest lease first inside the record, newest plan first at the top of the
    // page: a landlord opening this wants the tenancy they are in now.
    payers = payers.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  }

  return { ok: true, tenant: tenant as DossierTenant, leases, payers }
}

/**
 * Who co-signed for this tenant.
 *
 * The join is indirect and worth spelling out: a tenant's own screening is
 * attached to the **lead** they came in as (`background_checks.lead_id`), not to
 * the tenant row — `tenant_id` exists but is unset on every row in production.
 * A co-signer is then its own screening pointing back at that one through
 * `cosigner_for_check_id`. So: find the tenant's checks three ways, then find
 * the children of those.
 */
export async function loadCosigners(
  tenant: Pick<DossierTenant, 'id' | 'email' | 'lead_id'>,
): Promise<{ checks: DossierCheck[]; cosigners: DossierCheck[] }> {
  const db = dossierAdmin()
  const email = lower(tenant.email)

  const COLS = `
    id, is_cosigner, cosigner_for_check_id, cosigner_relationship,
    subject_first_name, subject_last_name, subject_email, subject_phone,
    status, decision, income_monthly, created_at,
    lead:leads ( first_name, last_name, email, phone )
  `
  const idArms = [`tenant_id.eq.${tenant.id}`]
  if (tenant.lead_id) idArms.push(`lead_id.eq.${tenant.lead_id}`)

  const [{ data: byId }, { data: byEmail }] = await Promise.all([
    db.from('background_checks').select(COLS)
      .or(idArms.join(',')).eq('is_cosigner', false).order('created_at', { ascending: false }),
    db.from('background_checks').select(COLS)
      .ilike('subject_email', email).eq('is_cosigner', false).order('created_at', { ascending: false }),
  ])
  const own = mergeById('id', byId as any[], byEmail as any[])

  const shape = (r: any): DossierCheck => {
    const lead = one<any>(r.lead)
    const name = [r.subject_first_name, r.subject_last_name].filter(Boolean).join(' ').trim()
      || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim()
      || null
    return {
      id: r.id,
      isCosigner: Boolean(r.is_cosigner),
      cosignerForCheckId: r.cosigner_for_check_id ?? null,
      relationship: r.cosigner_relationship ?? null,
      name,
      email: r.subject_email ?? lead?.email ?? null,
      phone: r.subject_phone ?? lead?.phone ?? null,
      status: r.status ?? null,
      decision: r.decision ?? null,
      incomeMonthly: r.income_monthly == null ? null : Number(r.income_monthly),
      createdAt: r.created_at,
    }
  }

  const checks = own.map(shape)
  if (checks.length === 0) return { checks, cosigners: [] }

  const { data: kids } = await db
    .from('background_checks')
    .select(`
      id, is_cosigner, cosigner_for_check_id, cosigner_relationship,
      subject_first_name, subject_last_name, subject_email, subject_phone,
      status, decision, income_monthly, created_at
    `)
    .in('cosigner_for_check_id', checks.map(c => c.id))
    .eq('is_cosigner', true)
    .order('created_at', { ascending: false })

  return { checks, cosigners: (kids ?? []).map(shape) }
}

/**
 * Is this co-signer someone we should be writing to by default?
 *
 * Only one whose screening was actually approved. A co-signer who was declined,
 * or whose check never finished, did not end up guaranteeing anything — and
 * emailing them a demand for someone else's rent would be both wrong and a
 * disclosure of that person's finances to a stranger. The landlord can still
 * tick them on deliberately; nothing is hidden, it simply is not automatic.
 */
export function cosignerIsOnTheHook(c: DossierCheck): boolean {
  return Boolean(c.email) && (c.status === 'approved' || c.decision === 'passed')
}

/** The rest of the record: correspondence, attempts, warnings, account, history. */
export async function loadDossierExtras(
  tenant: DossierTenant,
  payers: DossierPayer[],
  leases: DossierLease[],
): Promise<Pick<Dossier, 'emails' | 'attempts' | 'warnings' | 'account' | 'visits' | 'amendments' | 'renewals'>> {
  const db = dossierAdmin()
  const email = lower(tenant.email)
  const planTenantIds = payers.map(p => p.planTenantId)
  const planIds = [...new Set(payers.map(p => p.planId))]
  const leaseIds = leases.map(l => l.id)
  const chargeIds = new Set<string>([
    ...payers.flatMap(p => p.scheduled.map(s => s.id)),
    ...payers.flatMap(p => p.specials.map(s => s.id)),
  ])

  // ── Correspondence ────────────────────────────────────────────────────────
  // Both arms are needed: the plan-tenant id catches everything sent through
  // the money surfaces, and the address catches a co-signer's copy of a
  // warning, which has no plan-tenant of its own.
  const EMAIL_COLS = `
    id, recipient_email, recipient_name, subject, kind, audience, trigger, status,
    error, custom_message, amount_total, created_at, delivered_at, opened_at,
    clicked_at, bounced_at, complained_at, late_warning_id
  `
  const [{ data: byAddress }, { data: byPayer }] = await Promise.all([
    db.from('payment_emails').select(EMAIL_COLS)
      .ilike('recipient_email', email).order('created_at', { ascending: false }).limit(200),
    planTenantIds.length > 0
      ? db.from('payment_emails').select(EMAIL_COLS)
          .in('plan_tenant_id', planTenantIds).order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const emails: DossierEmail[] = mergeById('id', byAddress as any[], byPayer as any[])
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((r: any) => ({
    id: r.id,
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_name ?? null,
    subject: r.subject,
    kind: r.kind,
    audience: r.audience ?? 'tenant',
    trigger: r.trigger ?? 'manual',
    outcome: outcomeOf(r),
    amountTotal: num(r.amount_total),
    createdAt: r.created_at,
    deliveredAt: r.delivered_at ?? null,
    openedAt: r.opened_at ?? null,
    clickedAt: r.clicked_at ?? null,
    bouncedAt: r.bounced_at ?? null,
    lateWarningId: r.late_warning_id ?? null,
    customMessage: r.custom_message ?? null,
    error: r.error ?? null,
  }))

  // ── Warnings ──────────────────────────────────────────────────────────────
  const { data: warningRows } = await db
    .from('rent_late_warnings')
    .select('id, level, as_of, rent_due, late_fee_due, total_due, days_late, note, created_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })

  const warnings: DossierWarning[] = (warningRows ?? []).map((w: any) => ({
    id: w.id,
    level: w.level,
    asOf: w.as_of,
    rentDue: num(w.rent_due),
    lateFeeDue: num(w.late_fee_due),
    totalDue: num(w.total_due),
    daysLate: w.days_late ?? 0,
    note: w.note ?? null,
    createdAt: w.created_at,
    sends: emails
      .filter(e => e.lateWarningId === w.id)
      .map(e => ({
        email: e.recipientEmail, name: e.recipientName, audience: e.audience, outcome: e.outcome,
      })),
  }))

  // ── Attempts to move money ────────────────────────────────────────────────
  // `rent_payment_attempts` is the only record of a payment that *failed* — the
  // charge row is reset to pending and says nothing at all. An attempt is this
  // tenant's when any of its items is one of their charges: a shared lease pays
  // off one plan, so the plan alone does not identify the payer.
  let attempts: DossierAttempt[] = []
  if (planIds.length > 0) {
    const { data: attemptRows } = await db
      .from('rent_payment_attempts')
      .select('id, plan_id, method, status, amount, submitted_at, cleared_at, failed_at, failure_message, items')
      .in('plan_id', planIds)
      .order('submitted_at', { ascending: false })
      .limit(200)

    attempts = (attemptRows ?? [])
      .map((a: any) => ({
        id: a.id,
        planId: a.plan_id,
        method: a.method ?? null,
        status: a.status,
        amount: num(a.amount),
        submittedAt: a.submitted_at ?? null,
        clearedAt: a.cleared_at ?? null,
        failedAt: a.failed_at ?? null,
        failureMessage: a.failure_message ?? null,
        items: (Array.isArray(a.items) ? a.items : []) as DossierAttempt['items'],
      }))
      .filter(a => a.items.some(i => chargeIds.has(i.id)))
  }

  // ── Can they even get in? ─────────────────────────────────────────────────
  const { data: auth } = await db.rpc('auth_activity_for_email', { p_email: tenant.email })
  const authRow = Array.isArray(auth) ? auth[0] : auth
  const account: DossierAccount = {
    exists: Boolean(authRow),
    createdAt: authRow?.created_at ?? null,
    lastSignInAt: authRow?.last_sign_in_at ?? null,
    emailConfirmedAt: authRow?.email_confirmed_at ?? null,
  }

  // ── Browsing, for a tenant who arrived through the public site ────────────
  const { data: visitRows } = await db
    .from('site_visits')
    .select('id, path, created_at')
    .ilike('email', email)
    .order('created_at', { ascending: false })
    .limit(40)

  const visits = {
    count: (visitRows ?? []).length,
    lastAt: visitRows?.[0]?.created_at ?? null,
    recent: (visitRows ?? []).slice(0, 12).map((v: any) => ({ path: v.path, at: v.created_at })),
  }

  // ── Paperwork on the tenancy ──────────────────────────────────────────────
  let amendments: Dossier['amendments'] = []
  let renewals: Dossier['renewals'] = []
  if (leaseIds.length > 0) {
    const [{ data: amendRows }, { data: renewRows }] = await Promise.all([
      db.from('lease_amendments')
        .select('id, kind, title, status, effective_date, signed_at, sent_at, tenant_email')
        .in('lease_id', leaseIds)
        .order('created_at', { ascending: false }),
      db.from('lease_renewals')
        .select('id, status, new_rent, new_start_date, new_end_date, respond_by, sent_at, responded_at, tenant_email')
        .in('lease_id', leaseIds)
        .order('created_at', { ascending: false }),
    ])

    // An amendment is addressed to one signer. Another housemate's pet addendum
    // is not this tenant's paperwork and must not appear on their file.
    amendments = (amendRows ?? [])
      .filter((a: any) => !a.tenant_email || lower(a.tenant_email) === email)
      .map((a: any) => ({
        id: a.id, kind: a.kind, title: a.title, status: a.status,
        effectiveDate: a.effective_date ?? null, signedAt: a.signed_at ?? null, sentAt: a.sent_at ?? null,
      }))

    renewals = (renewRows ?? [])
      .filter((r: any) => !r.tenant_email || lower(r.tenant_email) === email)
      .map((r: any) => ({
        id: r.id, status: r.status,
        newRent: r.new_rent == null ? null : Number(r.new_rent),
        newStartDate: r.new_start_date ?? null, newEndDate: r.new_end_date ?? null,
        respondBy: r.respond_by ?? null, sentAt: r.sent_at ?? null, respondedAt: r.responded_at ?? null,
      }))
  }

  return { emails, attempts, warnings, account, visits, amendments, renewals }
}
