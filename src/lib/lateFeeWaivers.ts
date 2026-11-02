/**
 * The other half of the late-fee ledger: what was written off.
 *
 * A waived fee leaves `lateFeeLedger` by design — it is not owed, so listing it
 * among things to collect would be a lie. But "it vanishes" is the wrong
 * ending. A landlord looking at nothing outstanding needs to know whether that
 * is because the fees were collected or because they forgave four thousand
 * dollars of them, and months later they need to know *which* tenant they
 * forgave, why, and whether the tenant was ever told.
 *
 * That last column is the one worth building a view around. An unannounced
 * waiver is the most expensive kind: the money is given up and no goodwill is
 * bought with it, because the tenant never learned it happened — they just saw
 * a charge quietly stop being displayed. So the model counts those separately
 * and the panel surfaces them as the one thing here with an action left on it.
 *
 * Pure, like `lateFees.ts`: plans and waivers in, numbers out.
 */
import type { LateFeeWaiver } from '@/lib/lateFees'
import type { PaymentPlan, PaymentPlanTenant, ScheduledPayment } from '@/lib/payments'

const round2 = (n: number) => Math.round(n * 100) / 100

export type WaivedLateFee = {
  scheduledPaymentId: string
  planId: string
  propertyName: string
  leaseName: string
  payerId: string | null
  payerName: string
  payerEmail: string | null
  /** 'September 2026 rent' */
  label: string
  dueDate: string
  rentAmount: number
  /** The fee forgiven, frozen as of the decision. */
  amount: number
  waivedOn: string
  /** The landlord's private note. Never shown to the tenant. */
  reason: string | null
  /** The message that went to the tenant, if one did. */
  tenantNote: string | null
  tenantNotifiedAt: string | null
  tenantNotifiedEmail: string | null
}

export type WaivedPayerGroup = {
  key: string
  planId: string
  payerId: string | null
  name: string
  email: string | null
  propertyName: string
  leaseName: string
  fees: WaivedLateFee[]
  total: number
  /** Most recent write-off in the group, for sorting and for the subtitle. */
  lastWaivedOn: string
  /** Fees in this group the tenant was never told about. */
  unannounced: number
  unannouncedTotal: number
}

export type WaivedLedger = {
  groups: WaivedPayerGroup[]
  total: number
  feeCount: number
  payerCount: number
  /** Written off without ever telling the tenant — money spent on nothing. */
  unannouncedTotal: number
  unannouncedCount: number
  empty: boolean
}

export const EMPTY_WAIVED_LEDGER: WaivedLedger = {
  groups: [], total: 0, feeCount: 0, payerCount: 0,
  unannouncedTotal: 0, unannouncedCount: 0, empty: true,
}

/**
 * Every fee these plans have had written off, grouped by tenant.
 *
 * Driven by the waiver rows rather than by the charges: a waiver is a thing
 * that happened, and it stays listed even if today's rule would compute the fee
 * differently. The charge is looked up only for the context around it.
 */
export function waivedLedger(
  plans: PaymentPlan[],
  waivers: LateFeeWaiver[] = [],
): WaivedLedger {
  if (waivers.length === 0) return EMPTY_WAIVED_LEDGER

  // Index the charges once; a landlord with a dozen leases has thousands.
  const charges = new Map<string, {
    sp: ScheduledPayment
    plan: PaymentPlan
    tenant: PaymentPlanTenant | undefined
  }>()
  for (const plan of plans) {
    const payers = new Map(plan.tenants.map(t => [t.id, t]))
    for (const sp of plan.scheduled_payments ?? []) {
      charges.set(sp.id, { sp, plan, tenant: payers.get(sp.plan_tenant_id) })
    }
  }

  const fees: WaivedLateFee[] = []
  for (const w of waivers) {
    const hit = charges.get(w.scheduled_payment_id)
    // A waiver whose charge is not in view belongs to a lease this page is not
    // showing. Skipping it keeps the totals honest for the current scope.
    if (!hit) continue
    const { sp, plan, tenant } = hit
    fees.push({
      scheduledPaymentId: w.scheduled_payment_id,
      planId: plan.id,
      propertyName: plan.property?.name ?? plan.name,
      leaseName: plan.name,
      payerId: sp.plan_tenant_id ?? null,
      payerName: tenant?.name ?? 'The lease',
      payerEmail: tenant?.email ?? null,
      label: new Date(sp.due_date + 'T12:00:00')
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' rent',
      dueDate: sp.due_date,
      rentAmount: Number(sp.amount),
      amount: round2(Number(w.amount ?? 0)),
      waivedOn: w.created_at,
      reason: w.reason ?? null,
      tenantNote: w.tenant_note ?? null,
      tenantNotifiedAt: w.tenant_notified_at ?? null,
      tenantNotifiedEmail: w.tenant_notified_email ?? null,
    })
  }

  if (fees.length === 0) return EMPTY_WAIVED_LEDGER

  const byPayer = new Map<string, WaivedLateFee[]>()
  for (const f of fees) {
    const k = `${f.planId}:${f.payerId ?? 'lease'}`
    const arr = byPayer.get(k)
    if (arr) arr.push(f)
    else byPayer.set(k, [f])
  }

  const groups: WaivedPayerGroup[] = [...byPayer.entries()].map(([key, fs]) => {
    const sorted = fs.slice().sort((a, b) => b.waivedOn.localeCompare(a.waivedOn))
    const silent = fs.filter(f => !f.tenantNotifiedAt)
    return {
      key,
      planId: fs[0].planId,
      payerId: fs[0].payerId,
      name: fs[0].payerName,
      email: fs[0].payerEmail,
      propertyName: fs[0].propertyName,
      leaseName: fs[0].leaseName,
      fees: sorted,
      total: round2(fs.reduce((s, f) => s + f.amount, 0)),
      lastWaivedOn: sorted[0].waivedOn,
      unannounced: silent.length,
      unannouncedTotal: round2(silent.reduce((s, f) => s + f.amount, 0)),
    }
    // Tenants who were never told come first: they are the only rows here with
    // an action left on them. After that, most recently forgiven.
  }).sort((a, b) =>
    b.unannounced - a.unannounced || b.lastWaivedOn.localeCompare(a.lastWaivedOn))

  const silentAll = fees.filter(f => !f.tenantNotifiedAt)
  return {
    groups,
    total: round2(fees.reduce((s, f) => s + f.amount, 0)),
    feeCount: fees.length,
    payerCount: groups.length,
    unannouncedTotal: round2(silentAll.reduce((s, f) => s + f.amount, 0)),
    unannouncedCount: silentAll.length,
    empty: false,
  }
}
