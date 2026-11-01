'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  getPlanById, updateScheduledPayment, updateSpecialPayment, updateSpecialPaymentFull, addSpecialPayment,
  updateTenantScheduleAmount, updateLineItem, addLineItem, deleteLineItem, updateTenantMonthlyTotal,
  getEffectiveStatus, isOverdue, computeLateFees, computeLateFeesByDate, daysLate, daysLateByDate,
  computeProration,
  fmtCurrency, fmtDate, fmtMonth, fmtOrdinal,
  LINE_ITEM_CATEGORIES, SPECIAL_CATEGORIES,
  type PaymentPlan, type ScheduledPayment, type SpecialPayment, type SpecialCategory,
  type PaymentPlanTenant,
} from '@/lib/payments'
import StripeModeBanner from '@/components/StripeModeBanner'
import PaymentEmailHistory, { emailsForCharge, fmtWhen, type PlanEmail } from './PaymentEmailHistory'
import UtilitiesPanel from './UtilitiesPanel'
import PaymentDetailModal from './PaymentDetailModal'
import { getUtilitiesForPlan, reapplyPlanUtilities, type PlanUtility } from '@/lib/utilities'
import { chargeBreakdown, type ChargeBreakdown, type LateFeeWaiver } from '@/lib/lateFees'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Tab = 'schedule' | 'tenants' | 'charges' | 'activity'

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { bg: string; color: string; label: string; dot: string }> = {
  paid:    { bg: '#e8f5ed', color: '#1d8a4e', label: 'Paid',    dot: '#1d8a4e' },
  partial: { bg: '#fef9c3', color: '#b25000', label: 'Partial', dot: '#b25000' },
  pending: { bg: '#f0f0f2', color: '#6e6e73', label: 'Pending', dot: '#8e8e93' },
  late:    { bg: '#fdeceb', color: '#d13b30', label: 'Late',    dot: '#d13b30' },
  missed:  { bg: '#fce7f3', color: '#9d174d', label: 'Missed',  dot: '#db2777' },
  voided:  { bg: '#f0f0f2', color: '#8e8e93', label: 'Voided',  dot: '#d6d6db' },
  // Tenant paid by ACH; the money is in flight and settles in a few days.
  processing: { bg: '#fdf1e3', color: '#b25000', label: 'Clearing', dot: '#b25000' },
}

/**
 * How a payment was settled. "Paid" alone is ambiguous once tenants can pay
 * online — the landlord needs to know whether money actually moved through
 * Stripe or whether they themselves ticked it off after a Zelle transfer.
 */
const METHOD_CFG: Record<string, { label: string; bg: string; color: string }> = {
  card:         { label: 'Card',   bg: '#f5f3ff', color: '#6d28d9' },
  ach:          { label: 'ACH',    bg: '#e8f1fd', color: '#005bb8' },
  manual_zelle: { label: 'Zelle',  bg: '#e6f5f5', color: '#0e7490' },
  manual_other: { label: 'Manual', bg: '#f0f0f2', color: '#6e6e73' },
}

function MethodBadge({ method, recordedBy }: { method: string | null; recordedBy?: string | null }) {
  if (!method) return null
  const c = METHOD_CFG[method] ?? METHOD_CFG.manual_other
  const online = method === 'card' || method === 'ach'
  return (
    <span
      title={online
        ? `Paid online by the tenant (${c.label})`
        : `Recorded${recordedBy === 'landlord' ? ' by you' : ''} — ${c.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: c.bg, color: c.color, fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap' }}
    >
      {online ? '⚡' : '✎'} {c.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.pending
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: c.bg, color: c.color, fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', letterSpacing: '0.2px', whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {c.label}
    </span>
  )
}

// ─── PAYMENT ROW (schedule) ───────────────────────────────────────────────────

/**
 * The schedule's columns.
 *
 * It used to read `Tenant · Expected · Collected · Status · Days Late · Late
 * Fee`, and the first two could not be reconciled with each other. "Expected"
 * was `scheduled_payments.amount` — rent only — while "Collected" counted rent
 * *plus* late-fee money that had genuinely arrived. Subtracting one from the
 * other therefore compared two different quantities: a tenant who paid $736 of
 * rent and a $105 fee appeared to have overpaid, and a tenant who still owed a
 * $105 fee showed a balance of nothing.
 *
 * It also could not say what a rent figure was made of. A utility is folded
 * into the rent charge by `apply_plan_utility` rather than billed separately,
 * so a payer's $766 was silently $749 of rent and $17 of internet, with nothing
 * on the page to say so.
 *
 * So the columns now name the parts and then total them: rent and utilities
 * compose the charge, the late fee is added to it, and `Due` is what the tenant
 * actually owes. `Balance` closes the loop — `Due − Collected` — and every
 * figure on the row adds up in the direction it is read.
 */
const ROW_COLS = '1fr 78px 80px 86px 92px 92px 90px 100px'

const COL_HEADS = ['Tenant', 'Rent', 'Utilities', 'Late fee', 'Due', 'Collected', 'Balance', 'Status'] as const

/** A money cell: tabular figures, right-aligned, em dash when there is nothing. */
function Amt({
  value, bold, color, zero = '—', title, sub,
}: {
  value: number
  bold?: boolean
  color?: string
  zero?: string
  title?: string
  sub?: React.ReactNode
}) {
  return (
    <div style={{ textAlign: 'right' }} title={title}>
      {value > 0.005 ? (
        <span style={{ fontSize: '13px', fontWeight: bold ? 700 : 600, color: color ?? '#1d1d1f', fontVariantNumeric: 'tabular-nums' }}>
          {fmtCurrency(value)}
        </span>
      ) : (
        <span style={{ fontSize: '12px', color: '#d6d6db' }}>{zero}</span>
      )}
      {sub}
    </div>
  )
}

/**
 * One line of the schedule. Reading it is this component's whole job — the
 * detail and every control live in PaymentDetailModal, which clicking opens.
 *
 * Keeping the row this thin is deliberate: the ledger renders 72 of them on the
 * live lease, and each one used to carry a full edit form's worth of state for
 * a panel almost none of them would ever show.
 */
function PaymentRow({
  payment, rule, tenant, waiver, onOpen,
}: {
  payment: ScheduledPayment
  rule?: { grace_period_days: number; fee_amount: number; frequency_days: number; max_total_fees: number | null } | null
  /** The payer, for the rent/utility split — their line items say what the
   *  charge is actually made of. */
  tenant?: PaymentPlanTenant
  waiver?: LateFeeWaiver | null
  onOpen: (p: ScheduledPayment) => void
}) {
  const effStatus = getEffectiveStatus(payment)
  const isVoided = payment.status === 'voided'

  // One source for every figure on the row, so the columns cannot disagree with
  // each other the way they used to. `lateFeeDue` underneath is also the only
  // sanctioned way to value a fee — this row previously called `computeLateFees`
  // directly, which skips the cap that stops an uncapped rule billing a tenant
  // more than the rent charge itself is worth.
  const b = chargeBreakdown(payment, rule, tenant, waiver ?? null)

  return (
    <div style={{ borderBottom: '1px solid #f0f0f2', opacity: isVoided ? 0.55 : 1 }}>
      <div
        role={isVoided ? undefined : 'button'}
        tabIndex={isVoided ? undefined : 0}
        aria-label={isVoided ? undefined : `Open ${fmtMonth(payment.due_date)} rent for ${payment.tenant?.name ?? 'tenant'}`}
        style={{ display: 'grid', gridTemplateColumns: ROW_COLS, gap: 8, alignItems: 'center', padding: '11px 16px', cursor: isVoided ? 'default' : 'pointer', transition: 'background 0.1s' }}
        onClick={() => !isVoided && onOpen(payment)}
        onKeyDown={e => {
          if (isVoided) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(payment) }
        }}
        onMouseEnter={e => !isVoided && ((e.currentTarget as HTMLElement).style.background = '#fafafb')}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        {/* Tenant */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e5e5ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#6e6e73', flexShrink: 0 }}>
            {(payment.tenant?.name ?? 'T')[0].toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f' }}>{payment.tenant?.name ?? '—'}</div>
            {payment.tenant?.email && <div style={{ fontSize: '11px', color: '#8e8e93' }}>{payment.tenant.email}</div>}
          </div>
        </div>

        {/* Rent — the charge less any utility share folded inside it */}
        <Amt value={b.baseRent} />

        {/* Utilities inside this charge. An em dash means none; a bare dash
            means the split is genuinely unknown for this row — it predates the
            utility, or the amount was hand-edited — rather than zero. */}
        <Amt
          value={b.utilities}
          color="#0e7490"
          zero={b.split === 'unknown' && !isVoided ? '–' : '—'}
          title={
            b.utilities > 0
              ? b.utilityLines.map(l => `${l.label}: ${fmtCurrency(l.amount)}`).join(', ')
              : b.split === 'unknown'
                ? 'This charge does not match the payer\'s current monthly make-up, so how much of it is a utility share cannot be established.'
                : 'No utility share is folded into this charge.'
          }
        />

        {/* Late fee assessed on this charge, and what became of it */}
        <Amt
          value={b.lateFeeAssessed}
          color={b.lateFeeOutstanding > 0.005 ? '#b25000' : '#1d8a4e'}
          title={b.lateFeeCapped ? 'Trimmed to the size of this charge — the rule has no maximum.' : undefined}
          sub={
            b.lateFeeAssessed > 0.005 ? (
              <div style={{ fontSize: '10px', color: b.lateFeeWaived > 0.005 ? '#6e6e73' : b.lateFeeOutstanding > 0.005 ? '#b25000' : '#1d8a4e' }}>
                {b.lateFeeWaived > 0.005
                  ? 'written off'
                  : b.lateFeeOutstanding > 0.005
                    ? `${b.daysLate}d late · unpaid`
                    : `${b.daysLate}d late · paid`}
              </div>
            ) : undefined
          }
        />

        {/* Due — rent plus the fee it actually carries. What "Expected" should
            always have been. */}
        <Amt value={b.expected} bold />

        {/* Collected — rent plus fee money that genuinely arrived */}
        <Amt
          value={b.collected}
          bold
          color="#1d8a4e"
          sub={
            b.lateFeeCollected > 0.005 ? (
              <div style={{ fontSize: '10px', color: '#1d8a4e' }}>incl. {fmtCurrency(b.lateFeeCollected)} fee</div>
            ) : undefined
          }
        />

        {/* Balance — what is left, fees and all */}
        <Amt
          value={b.balance}
          bold
          color={isVoided ? '#8e8e93' : effStatus === 'late' ? '#d13b30' : '#b25000'}
          zero={isVoided ? '—' : '✓'}
          sub={
            b.lateFeeWaived > 0.005 ? (
              <div style={{ fontSize: '10px', color: '#6e6e73' }}>{fmtCurrency(b.lateFeeWaived)} waived</div>
            ) : undefined
          }
        />

        {/* Status */}
        <div style={{ textAlign: 'center' }}>
          <StatusBadge status={isVoided ? 'voided' : effStatus} />
          {payment.payment_method && (
            <div style={{ marginTop: 3 }}>
              <MethodBadge method={payment.payment_method} recordedBy={payment.recorded_by} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── MONTH GROUP ──────────────────────────────────────────────────────────────

function MonthGroup({
  month, payments, rule, tenants, waivers, onOpen, defaultOpen,
}: {
  month: string
  payments: ScheduledPayment[]
  rule: PaymentPlan['late_fee_rule']
  /** Payers on the plan, so each row can decompose its own charge. */
  tenants: PaymentPlanTenant[]
  waivers: Record<string, LateFeeWaiver>
  /** Rows are read-only; the modal owns recording and chasing. */
  onOpen: (payment: ScheduledPayment) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const byId = new Map(tenants.map(t => [t.id, t]))
  const active = payments.filter(p => p.status !== 'voided')

  // The month's figures are the sum of the rows', computed the same way, so the
  // footer and the rows above it can never disagree. They used to: `expected`
  // was rent alone while `collected` included late-fee money, which made the
  // month's "outstanding" wrong in both directions at once.
  const sums = active.reduce((acc, p) => {
    const b = chargeBreakdown(p, rule ?? null, byId.get(p.plan_tenant_id), waivers[p.id] ?? null)
    return {
      rent:      acc.rent + b.baseRent,
      utilities: acc.utilities + b.utilities,
      fees:      acc.fees + b.lateFeeAssessed,
      due:       acc.due + b.expected,
      collected: acc.collected + b.collected,
      balance:   acc.balance + b.balance,
      feesPaid:  acc.feesPaid + b.lateFeeCollected,
      waived:    acc.waived + b.lateFeeWaived,
    }
  }, { rent: 0, utilities: 0, fees: 0, due: 0, collected: 0, balance: 0, feesPaid: 0, waived: 0 })

  const paid    = active.filter(p => p.status === 'paid').length
  const overdue = active.filter(p => isOverdue(p)).length
  const voided  = payments.filter(p => p.status === 'voided').length

  return (
    <div style={{ marginBottom: 6, border: '1px solid #e5e5ea', borderRadius: '11px', overflow: 'hidden', background: '#fff' }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: open ? '#fff' : '#fafafb' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#1d1d1f' }}>{fmtMonth(month)}</span>
          {overdue > 0 && <span style={{ background: '#fdeceb', color: '#d13b30', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{overdue} overdue</span>}
          {overdue === 0 && paid === active.length && active.length > 0 && <span style={{ background: '#e8f5ed', color: '#1d8a4e', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>All paid ✓</span>}
          {/* A month can be fully paid and still owe fees. Saying "All paid"
              and nothing else is how $4,050 of fees went unnoticed. */}
          {sums.balance > 0.005 && paid === active.length && active.length > 0 && (
            <span style={{ background: '#fdf1e3', color: '#b25000', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>
              {fmtCurrency(sums.balance)} in fees owed
            </span>
          )}
          {voided > 0 && <span style={{ background: '#f0f0f2', color: '#8e8e93', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{voided} voided</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '12px', color: '#6e6e73' }}>
            {paid}/{active.length} paid · {fmtCurrency(sums.collected)}/{fmtCurrency(sums.due)}
          </span>
          <span style={{ fontSize: '11px', color: '#8e8e93', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid #f0f0f2' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: ROW_COLS, gap: 8, padding: '8px 16px', background: '#fafafb' }}>
            {COL_HEADS.map(h => (
              <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: h === 'Tenant' ? 'left' : h === 'Status' ? 'center' : 'right' }}>
                {h}
              </div>
            ))}
          </div>
          {payments.map(p => (
            <PaymentRow
              key={p.id}
              payment={p}
              rule={rule ?? undefined}
              tenant={byId.get(p.plan_tenant_id)}
              waiver={waivers[p.id] ?? null}
              onOpen={onOpen}
            />
          ))}

          {/* The month's own bottom line, in the same columns as the rows above
              it — so a shared lease's six payers visibly sum to one figure. */}
          <div style={{ display: 'grid', gridTemplateColumns: ROW_COLS, gap: 8, padding: '10px 16px', background: '#fafafb', borderTop: '1px solid #e5e5ea', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#6e6e73' }}>
              {fmtMonth(month)} total
            </div>
            <Amt value={sums.rent} bold />
            <Amt value={sums.utilities} bold color="#0e7490" />
            <Amt value={sums.fees} bold color={sums.fees - sums.feesPaid - sums.waived > 0.005 ? '#b25000' : '#1d8a4e'} />
            <Amt value={sums.due} bold />
            <Amt
              value={sums.collected}
              bold
              color="#1d8a4e"
              sub={sums.feesPaid > 0.005 ? <div style={{ fontSize: '10px', color: '#1d8a4e' }}>incl. {fmtCurrency(sums.feesPaid)} fees</div> : undefined}
            />
            <Amt
              value={sums.balance}
              bold
              color={overdue > 0 ? '#d13b30' : '#b25000'}
              zero="✓"
              sub={sums.waived > 0.005 ? <div style={{ fontSize: '10px', color: '#6e6e73' }}>{fmtCurrency(sums.waived)} waived</div> : undefined}
            />
            <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: sums.balance > 0.005 ? (overdue > 0 ? '#d13b30' : '#b25000') : '#8e8e93' }}>
              {sums.balance > 0.005 ? 'outstanding' : 'settled'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── LINE ITEM EDITOR ─────────────────────────────────────────────────────────

type DraftItem = {
  id: string | null
  category: string
  label: string
  amount: string
  isNew?: boolean
  /** Set when the line is materialised from a lease utility. Such a line is
   *  owned by that declaration — editing it here would leave the two
   *  disagreeing, so it is shown but not editable. */
  utilityId?: string | null
}

function LineItemEditor({
  tenant, onSaved,
}: {
  tenant: PaymentPlanTenant
  onSaved: (newTotal: number) => void
}) {
  const [editing, setEditing]   = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [draft,   setDraft]     = useState<DraftItem[]>([])
  const [totalOverride, setTotalOverride] = useState('')
  const [totalMode,     setTotalMode]     = useState<'sum' | 'custom'>('sum')

  const openEdit = () => {
    setDraft(tenant.line_items.map(li => ({
      id: li.id, category: li.category, label: li.label, amount: String(li.amount),
      utilityId: li.utility_id,
    })))
    const sum = tenant.line_items.reduce((s, li) => s + li.amount, 0)
    setTotalOverride(String(tenant.monthly_total))
    setTotalMode(Math.abs(sum - tenant.monthly_total) < 0.005 ? 'sum' : 'custom')
    setEditing(true)
  }

  const cancel = () => { setEditing(false); setDraft([]) }

  const updateDraft = (idx: number, key: keyof DraftItem, val: string) => {
    setDraft(prev => prev.map((item, i) => i === idx ? { ...item, [key]: val } : item))
  }

  const addRow = () => {
    setDraft(prev => [...prev, { id: null, category: 'rent', label: 'Rent', amount: '', isNew: true }])
  }

  const removeRow = (idx: number) => {
    setDraft(prev => prev.filter((_, i) => i !== idx))
  }

  const lineSum = draft.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0)
  const finalTotal = totalMode === 'sum' ? lineSum : (parseFloat(totalOverride) || lineSum)
  const mismatch = totalMode === 'custom' && Math.abs(finalTotal - lineSum) > 0.005

  const iS: React.CSSProperties = {
    padding: '6px 9px', fontSize: '12px', border: '1.5px solid #e5e5ea', borderRadius: '6px',
    outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0071e3',
    boxSizing: 'border-box',
  }

  const save = async () => {
    setSaving(true)

    // 1. Handle deletions — items in original that are gone from draft.
    //    Utility-owned lines are excluded: they belong to the lease's utility
    //    declaration and are removed by deleting that, which also unwinds
    //    everyone's share. Deleting one here would leave the declaration
    //    claiming a charge that no longer exists on this payer.
    const utilityOwned = new Set(tenant.line_items.filter(li => li.utility_id).map(li => li.id))
    const originalIds = new Set(tenant.line_items.map(li => li.id))
    const draftIds    = new Set(draft.filter(d => d.id).map(d => d.id!))
    const toDelete    = [...originalIds].filter(id => !draftIds.has(id) && !utilityOwned.has(id))
    for (const id of toDelete) await deleteLineItem(id)

    // 2. Update existing + insert new, again leaving utility lines alone.
    for (const item of draft) {
      if (item.utilityId) continue
      const amt = parseFloat(item.amount) || 0
      if (item.id) {
        await updateLineItem(item.id, { label: item.label, amount: amt, category: item.category })
      } else {
        await addLineItem(tenant.id, { category: item.category, label: item.label, amount: amt })
      }
    }

    // 3. Update monthly_total
    await updateTenantMonthlyTotal(tenant.id, finalTotal)

    setSaving(false)
    setEditing(false)
    onSaved(finalTotal)
  }

  const iS2: React.CSSProperties = { ...iS, fontSize: '13px', padding: '7px 10px' }

  if (!editing) {
    return (
      <button
        onClick={openEdit}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4, padding: '5px 10px', border: '1px solid #e5e5ea', borderRadius: '6px', background: '#fafafb', color: '#6e6e73', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'border-color 0.15s, color 0.15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#8e8e93'; (e.currentTarget as HTMLElement).style.color = '#0071e3' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e5e5ea'; (e.currentTarget as HTMLElement).style.color = '#6e6e73' }}
      >
        ✏ Edit breakdown
      </button>
    )
  }

  return (
    <div style={{ marginTop: 10, background: '#fafafb', border: '1.5px solid #d6d6db', borderRadius: '10px', padding: '14px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Edit line items</div>
      {draft.some(d => d.utilityId) && (
        <div style={{ fontSize: '11.5px', color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '7px', padding: '8px 11px', marginBottom: 10, lineHeight: 1.5 }}>
          Lines marked <strong>UTILITY</strong> come from a charge set once for the whole lease.
          Change the amount under <strong>Charges → Utilities &amp; shared charges</strong> and every
          payer moves together.
        </div>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px 28px', gap: 6, marginBottom: 4 }}>
        {['Category', 'Label', 'Amount', ''].map(h => (
          <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</div>
        ))}
      </div>

      {/* Line item rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {draft.map((item, idx) => item.utilityId ? (
          /* A lease utility's share. Shown so the payer's total visibly adds
             up, read-only because the charge is declared once for the whole
             lease — edited here, the two would quietly disagree. */
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px 28px', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '5px', padding: '4px 6px', textAlign: 'center', letterSpacing: '0.02em' }}>
              UTILITY
            </span>
            <span style={{ fontSize: '12px', color: '#6e6e73' }}>
              {item.label}
              <span style={{ color: '#8e8e93', marginLeft: 6 }}>· set on the lease</span>
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#6e6e73', textAlign: 'right', paddingRight: 4 }}>
              {fmtCurrency(parseFloat(item.amount) || 0)}
            </span>
            <span />
          </div>
        ) : (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px 28px', gap: 6, alignItems: 'center' }}>
            <select
              style={{ ...iS, width: '100%' }}
              value={item.category}
              onChange={e => {
                const cat = LINE_ITEM_CATEGORIES.find(c => c.value === e.target.value)
                updateDraft(idx, 'category', e.target.value)
                if (cat) updateDraft(idx, 'label', cat.label)
              }}
            >
              {LINE_ITEM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input
              style={{ ...iS, width: '100%' }}
              value={item.label}
              onChange={e => updateDraft(idx, 'label', e.target.value)}
              placeholder="Label"
            />
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#8e8e93', pointerEvents: 'none' }}>$</span>
              <input
                style={{ ...iS, width: '100%', paddingLeft: 18 }}
                type="number" min={0} step="0.01"
                value={item.amount}
                onChange={e => updateDraft(idx, 'amount', e.target.value)}
                placeholder="0"
              />
            </div>
            <button
              onClick={() => removeRow(idx)}
              style={{ width: 26, height: 26, border: 'none', borderRadius: '5px', background: 'none', color: '#8e8e93', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#d13b30'; (e.currentTarget as HTMLElement).style.background = '#fdeceb' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8e8e93'; (e.currentTarget as HTMLElement).style.background = 'none' }}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Add row */}
      <button
        onClick={addRow}
        style={{ fontSize: '11px', fontWeight: 600, color: '#6e6e73', background: 'none', border: '1px dashed #d6d6db', borderRadius: '5px', padding: '5px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}
      >
        + Add line item
      </button>

      {/* Sum + total */}
      <div style={{ borderTop: '1px solid #e5e5ea', paddingTop: 10 }}>
        {/* Auto-sum row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '12px', color: '#6e6e73' }}>Sum of line items</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f' }}>{fmtCurrency(lineSum)}</span>
        </div>

        {/* Total mode toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['sum', 'custom'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => {
                setTotalMode(mode)
                if (mode === 'custom') setTotalOverride(String(finalTotal))
              }}
              style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: `1.5px solid ${totalMode === mode ? '#0071e3' : '#e5e5ea'}`, background: totalMode === mode ? '#0071e3' : '#fff', color: totalMode === mode ? '#fff' : '#6e6e73', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
            >
              {mode === 'sum' ? 'Use sum' : 'Custom total'}
            </button>
          ))}
        </div>

        {totalMode === 'custom' ? (
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Monthly total ($)</label>
            <input
              style={{ ...iS2, width: '100%', fontWeight: 700 }}
              type="number" min={0} step="0.01"
              value={totalOverride}
              onChange={e => setTotalOverride(e.target.value)}
            />
            {mismatch && (
              <div style={{ marginTop: 5, fontSize: '11px', color: '#b25000' }}>
                ⚠ Total ({fmtCurrency(finalTotal)}) differs from sum ({fmtCurrency(lineSum)}) by {fmtCurrency(Math.abs(finalTotal - lineSum))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: '#f0f0f2', borderRadius: '7px', padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#6e6e73' }}>Monthly total</span>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#1d1d1f' }}>{fmtCurrency(finalTotal)}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={save} disabled={saving}
          style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: saving ? '#8e8e93' : '#0071e3', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={cancel}
          style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── TENANT RENT EDITOR ───────────────────────────────────────────────────────

function TenantRentEditor({
  tenant, sps, onSaved,
}: {
  tenant: PaymentPlanTenant
  sps: ScheduledPayment[]
  onSaved: () => void
}) {
  const [open,    setOpen]    = useState(false)
  const [newAmt,  setNewAmt]  = useState(String(tenant.monthly_total))
  const [applyTo, setApplyTo] = useState<'unpaid' | 'all'>('unpaid')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  const unpaidCount = sps.filter(sp => ['pending', 'late'].includes(sp.status)).length
  const allCount    = sps.length
  const preview     = applyTo === 'unpaid' ? unpaidCount : allCount
  const parsedAmt   = parseFloat(newAmt)
  const changed     = !isNaN(parsedAmt) && parsedAmt > 0 && Math.abs(parsedAmt - tenant.monthly_total) > 0.005

  const iS: React.CSSProperties = {
    padding: '8px 11px', fontSize: '13px', border: '1.5px solid #e5e5ea', borderRadius: '8px',
    outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0071e3',
    boxSizing: 'border-box',
  }

  const save = async () => {
    if (!changed) return
    setSaving(true)
    const { error } = await updateTenantScheduleAmount(tenant.id, parsedAmt, applyTo)
    setSaving(false)
    if (!error) {
      setSaved(true)
      onSaved()
      setTimeout(() => { setOpen(false); setSaved(false); setNewAmt(String(parsedAmt)) }, 1200)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ marginTop: 12, width: '100%', padding: '8px 0', border: '1.5px dashed #d6d6db', borderRadius: '8px', background: 'none', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'border-color 0.15s, color 0.15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#8e8e93'; (e.currentTarget as HTMLElement).style.color = '#0071e3' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#d6d6db'; (e.currentTarget as HTMLElement).style.color = '#6e6e73' }}
      >
        ✏ Edit rent amount
      </button>
    )
  }

  return (
    <div style={{ marginTop: 12, background: '#fafafb', border: '1.5px solid #e5e5ea', borderRadius: '10px', padding: '16px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1d1d1f', marginBottom: 12 }}>Update rent for entire lease</div>

      {/* New amount */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>New monthly amount ($)</label>
        <input
          style={{ ...iS, width: '100%', fontSize: '16px', fontWeight: 700, color: '#1d1d1f' }}
          type="number" min={0} step="0.01"
          value={newAmt}
          onChange={e => setNewAmt(e.target.value)}
        />
        {changed && (
          <div style={{ marginTop: 5, fontSize: '11px', color: parsedAmt > tenant.monthly_total ? '#1d8a4e' : '#b25000', fontWeight: 600 }}>
            {parsedAmt > tenant.monthly_total
              ? `↑ Increase of ${fmtCurrency(parsedAmt - tenant.monthly_total)}/mo from current ${fmtCurrency(tenant.monthly_total)}`
              : `↓ Decrease of ${fmtCurrency(tenant.monthly_total - parsedAmt)}/mo from current ${fmtCurrency(tenant.monthly_total)}`}
          </div>
        )}
      </div>

      {/* Apply to */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Apply to</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            { value: 'unpaid', label: 'Unpaid payments only', sub: `${unpaidCount} pending or late payment${unpaidCount !== 1 ? 's' : ''}` },
            { value: 'all',    label: 'All payments (entire lease)', sub: `${allCount} total payment${allCount !== 1 ? 's' : ''}, including already-paid` },
          ] as const).map(opt => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', borderRadius: '8px', border: `1.5px solid ${applyTo === opt.value ? '#0071e3' : '#e5e5ea'}`, background: applyTo === opt.value ? '#f0f0f2' : '#fff', cursor: 'pointer' }}
            >
              <input
                type="radio" name={`applyTo-${tenant.id}`} value={opt.value}
                checked={applyTo === opt.value}
                onChange={() => setApplyTo(opt.value)}
                style={{ marginTop: 2, accentColor: '#0071e3', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#1d1d1f' }}>{opt.label}</div>
                <div style={{ fontSize: '11px', color: '#8e8e93', marginTop: 1 }}>{opt.sub}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Preview */}
      {changed && (
        <div style={{ background: '#e8f1fd', border: '1px solid #bfdbfe', borderRadius: '7px', padding: '9px 12px', marginBottom: 12, fontSize: '12px', color: '#005bb8' }}>
          Will update <strong>{preview} payment{preview !== 1 ? 's' : ''}</strong> to <strong>{fmtCurrency(parsedAmt)}/mo</strong>
        </div>
      )}

      {saved && (
        <div style={{ background: '#e8f5ed', border: '1px solid #e8f5ed', borderRadius: '7px', padding: '9px 12px', marginBottom: 12, fontSize: '12px', color: '#1d8a4e', fontWeight: 600 }}>
          ✓ Updated successfully
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={save} disabled={saving || !changed || saved}
          style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: saving || !changed ? '#8e8e93' : '#0071e3', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: (saving || !changed) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Saving…' : `Update ${preview} payment${preview !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={() => { setOpen(false); setNewAmt(String(tenant.monthly_total)) }}
          style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── SPECIAL CHARGE CARD ─────────────────────────────────────────────────────

type SpecialMode = 'view' | 'edit' | 'confirm'

function SpecialChargeCard({
  sp, multiTenant, onUpdate, onRemind, onResendReceipt, history = [],
}: {
  sp: SpecialPayment
  multiTenant: boolean
  onUpdate: (id: string, updates: Parameters<typeof updateSpecialPaymentFull>[1]) => Promise<void>
  /** Email the tenant about this charge. Absent once it's settled or waived. */
  onRemind?: (sp: SpecialPayment) => void
  onResendReceipt?: (sp: SpecialPayment) => void
  history?: PlanEmail[]
}) {
  const [mode,     setMode]     = useState<SpecialMode>('view')
  const [saving,   setSaving]   = useState(false)

  // edit fields
  const [category, setCategory] = useState(sp.category)
  const [label,    setLabel]    = useState(sp.label)
  const [amount,   setAmount]   = useState(String(sp.amount))
  const [dueDate,  setDueDate]  = useState(sp.due_date)
  const [status,   setStatus]   = useState<SpecialPayment['status']>(sp.status)
  const [paidDate, setPaidDate] = useState(sp.paid_date ?? '')
  const [notes,    setNotes]    = useState(sp.notes ?? '')

  const openEdit = () => {
    setCategory(sp.category); setLabel(sp.label); setAmount(String(sp.amount))
    setDueDate(sp.due_date);  setStatus(sp.status)
    setPaidDate(sp.paid_date ?? ''); setNotes(sp.notes ?? '')
    setMode('edit')
  }

  const catLabel = (cat: string) => SPECIAL_CATEGORIES.find(c => c.value === cat)?.label ?? cat

  // Build a human-readable diff for the confirmation step
  const parsedAmt = parseFloat(amount) || 0
  type Change = { field: string; from: string; to: string }
  const changes: Change[] = []
  if (sp.category !== category)              changes.push({ field: 'Type',      from: catLabel(sp.category),            to: catLabel(category) })
  if (sp.label    !== label)                 changes.push({ field: 'Label',     from: sp.label,                         to: label })
  if (Math.abs(sp.amount - parsedAmt) > 0.005) changes.push({ field: 'Amount',  from: fmtCurrency(sp.amount),           to: fmtCurrency(parsedAmt) })
  if (sp.due_date !== dueDate)               changes.push({ field: 'Due date',  from: fmtDate(sp.due_date),             to: fmtDate(dueDate) })
  if (sp.status   !== status)                changes.push({ field: 'Status',    from: sp.status,                        to: status })
  if ((sp.paid_date ?? '') !== paidDate)     changes.push({ field: 'Paid date', from: sp.paid_date ? fmtDate(sp.paid_date) : '—', to: paidDate ? fmtDate(paidDate) : '—' })
  if ((sp.notes   ?? '') !== notes)          changes.push({ field: 'Notes',     from: sp.notes || '—',                  to: notes || '—' })

  const confirm = async () => {
    if (changes.length === 0) { setMode('view'); return }
    setSaving(true)
    await onUpdate(sp.id, {
      category,
      label,
      amount:    parsedAmt,
      due_date:  dueDate,
      status,
      paid_date: status === 'paid' && paidDate ? paidDate : (status === 'paid' ? new Date().toISOString().split('T')[0] : null),
      notes:     notes || null,
    })
    setSaving(false)
    setMode('view')
  }

  const isOverdueCharge = sp.status === 'pending' && new Date(sp.due_date + 'T00:00:00') < new Date()
  const [showHistory, setShowHistory] = useState(false)
  // Sends recorded on the charge itself cover the era before the email log.
  const requestCount = Math.max(history.length, sp.reminder_count ?? 0)

  const iS: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e5e5ea',
    borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif",
    background: '#fff', color: '#0071e3', boxSizing: 'border-box',
  }

  // ── VIEW mode ──
  if (mode === 'view') {
    return (
      <div style={{ background: '#fff', borderRadius: '11px', border: `1px solid ${isOverdueCharge ? '#f3c6c2' : '#e5e5ea'}`, padding: '16px 20px' }}>
       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#1d1d1f' }}>{sp.label}</span>
            <span style={{ background: '#f0f0f2', color: '#6e6e73', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{catLabel(sp.category)}</span>
            {sp.tenant && <span style={{ fontSize: '12px', color: '#8e8e93' }}>→ {sp.tenant.name}</span>}
            {!sp.tenant && multiTenant && <span style={{ fontSize: '12px', color: '#8e8e93' }}>→ All tenants</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#6e6e73' }}>
            Due {fmtDate(sp.due_date)}
            {sp.paid_date && ` · Paid ${fmtDate(sp.paid_date)}`}
            {sp.notes && ` · ${sp.notes}`}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#1d1d1f', marginBottom: 6 }}>{fmtCurrency(sp.amount)}</div>
          <StatusBadge status={sp.status} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            onClick={openEdit}
            style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
          >
            ✏ Edit
          </button>
          {sp.status !== 'paid' && onRemind && (
            <button
              onClick={() => onRemind(sp)}
              title={sp.reminder_sent_at
                ? `Last requested ${new Date(sp.reminder_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : 'Email this tenant a request for this charge'}
              style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
            >
              {(() => {
                const n = Math.max(history.length, sp.reminder_count ?? 0)
                return n > 0 ? `Request again (${n})` : 'Send request'
              })()}
            </button>
          )}
          {sp.status === 'paid' && onResendReceipt && (
            <button
              onClick={() => onResendReceipt(sp)}
              title="Send the payment confirmation again"
              style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
            >
              Resend confirmation
            </button>
          )}
          {sp.status !== 'paid' && (
            <>
              <button
                onClick={() => onUpdate(sp.id, { status: 'paid', paid_date: new Date().toISOString().split('T')[0] })}
                style={{ padding: '6px 12px', borderRadius: '7px', border: 'none', background: '#0071e3', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                Mark paid
              </button>
              <button
                onClick={() => onUpdate(sp.id, { status: 'waived' })}
                style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#8e8e93', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                Waive
              </button>
            </>
          )}
        </div>
       </div>

        {/* When this charge was actually asked for — the deposit at move-in is
            the one a landlord most often has to prove they chased. */}
        {requestCount > 0 && (
          <div style={{ borderTop: '1px solid #f0f0f2', marginTop: 14, paddingTop: 12 }}>
            <button
              onClick={() => setShowHistory(v => !v)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '11.5px', fontWeight: 600, color: '#6e6e73' }}
            >
              {showHistory ? 'Hide' : 'Show'} request history ({requestCount})
            </button>
            {showHistory && (
              <div style={{ marginTop: 10 }}>
                <PaymentEmailHistory
                  emails={history}
                  priorCount={sp.reminder_count ?? 0}
                  empty="No requests sent for this charge yet."
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── EDIT mode ──
  if (mode === 'edit') {
    return (
      <div style={{ background: '#fff', borderRadius: '11px', border: '1.5px solid #0071e3', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f' }}>Edit charge</span>
          <button onClick={() => setMode('view')} style={{ background: 'none', border: 'none', color: '#8e8e93', fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Type</label>
            <select style={iS} value={category} onChange={e => {
              const cat = SPECIAL_CATEGORIES.find(c => c.value === e.target.value)
              setCategory(e.target.value as typeof category)
              if (cat) setLabel(cat.label)
            }}>
              {SPECIAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Label</label>
            <input style={iS} value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Amount ($)</label>
            <input style={iS} type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Status</label>
            <select style={iS} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
              {/* Only offered while the debit is actually in flight: it is a
                  state Stripe owns, not one a landlord should be able to pick. */}
              {sp.status === 'processing' && <option value="processing">Clearing (ACH)</option>}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Due date</label>
            <input style={iS} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Paid date</label>
            <input style={iS} type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} disabled={status !== 'paid'} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Notes</label>
            <input style={iS} value={notes} placeholder="Optional note" onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => changes.length > 0 ? setMode('confirm') : setMode('view')}
            disabled={!parsedAmt || !dueDate}
            style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: (!parsedAmt || !dueDate) ? '#8e8e93' : '#0071e3', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: (!parsedAmt || !dueDate) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          >
            {changes.length === 0 ? 'No changes' : `Review ${changes.length} change${changes.length !== 1 ? 's' : ''} →`}
          </button>
          <button onClick={() => setMode('view')} style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── CONFIRM mode ──
  return (
    <div style={{ background: '#fff', borderRadius: '11px', border: '1.5px solid #0071e3', padding: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f', marginBottom: 4 }}>Confirm changes</div>
      <div style={{ fontSize: '12px', color: '#6e6e73', marginBottom: 14 }}>Review before saving — this cannot be undone.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {changes.map(ch => (
          <div key={ch.field} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 14px 1fr', gap: 8, alignItems: 'center', background: '#fafafb', borderRadius: '7px', padding: '8px 10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{ch.field}</span>
            <span style={{ fontSize: '12px', color: '#6e6e73', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.from}</span>
            <span style={{ fontSize: '11px', color: '#8e8e93', textAlign: 'center' }}>→</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.to}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={confirm} disabled={saving}
          style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: saving ? '#8e8e93' : '#0071e3', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Saving…' : 'Confirm & save'}
        </button>
        <button onClick={() => setMode('edit')} style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
          ← Back
        </button>
      </div>
    </div>
  )
}

// ─── ADD SPECIAL CHARGE FORM ──────────────────────────────────────────────────

function AddChargeForm({ planId, tenants, onAdded }: { planId: string; tenants: PaymentPlan['tenants']; onAdded: () => void }) {
  const [open,       setOpen]      = useState(false)
  const [saving,     setSaving]    = useState(false)
  const [category,   setCategory]  = useState<SpecialCategory>('special')
  const [label,      setLabel]     = useState('Special Charge')
  const [amount,     setAmount]    = useState('')
  const [dueDate,    setDueDate]   = useState(new Date().toISOString().split('T')[0])
  const [tenantId,   setTenantId]  = useState<string | undefined>(undefined)
  const [notes,      setNotes]     = useState('')

  const iS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e5e5ea', borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0071e3', boxSizing: 'border-box' }

  const save = async () => {
    if (!amount || !dueDate) return
    setSaving(true)
    await addSpecialPayment(planId, {
      planTenantId: tenantId,
      category, label, amount: parseFloat(amount), dueDate, notes: notes || undefined,
    })
    setSaving(false)
    setOpen(false)
    setAmount(''); setNotes(''); setLabel('Special Charge'); setCategory('special')
    onAdded()
  }

  return (
    <div>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ padding: '9px 16px', border: '1.5px dashed #d6d6db', borderRadius: '9px', background: 'none', color: '#6e6e73', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
          + Add charge
        </button>
      ) : (
        <div style={{ border: '1.5px solid #e5e5ea', borderRadius: '10px', padding: '18px 20px', background: '#fafafb' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f', marginBottom: 14 }}>New charge</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4 }}>TYPE</label>
              <select style={iS} value={category} onChange={e => { setCategory(e.target.value as SpecialCategory); setLabel(SPECIAL_CATEGORIES.find(c => c.value === e.target.value)?.label ?? label) }}>
                {SPECIAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4 }}>LABEL</label>
              <input style={iS} value={label} onChange={e => setLabel(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4 }}>AMOUNT ($)</label>
              <input style={iS} type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <input style={iS} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            {tenants.length > 1 && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4 }}>APPLIES TO</label>
                <select style={iS} value={tenantId ?? ''} onChange={e => setTenantId(e.target.value || undefined)}>
                  <option value="">All tenants</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ gridColumn: tenants.length > 1 ? 'auto' : '1/-1' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#6e6e73', display: 'block', marginBottom: 4 }}>NOTES</label>
              <input style={iS} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving || !amount || !dueDate} style={{ padding: '7px 16px', borderRadius: '7px', border: 'none', background: saving ? '#8e8e93' : '#0071e3', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              {saving ? 'Saving…' : 'Add charge'}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: '7px 14px', borderRadius: '7px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TENANT RATING HELPERS ────────────────────────────────────────────────────

function computeTenantRating(sps: ScheduledPayment[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const evaluable = sps.filter(sp => new Date(sp.due_date + 'T00:00:00') < today)
  if (evaluable.length === 0) return { score: null, grade: 'No history', color: '#8e8e93', label: 'N/A' }

  const paid    = evaluable.filter(sp => ['paid', 'partial'].includes(sp.status))
  const missed  = evaluable.filter(sp => sp.status === 'missed')
  const overdue = evaluable.filter(sp => ['pending', 'late'].includes(sp.status))

  const onTime  = paid.filter(sp => sp.paid_date && daysLateByDate(sp.due_date, sp.paid_date) === 0)
  const latePaid = paid.filter(sp => sp.paid_date && daysLateByDate(sp.due_date, sp.paid_date) > 0)

  const totalDaysLate =
    latePaid.reduce((s, sp) => s + (sp.paid_date ? daysLateByDate(sp.due_date, sp.paid_date) : 0), 0) +
    overdue.reduce((s, sp) => s + daysLate(sp.due_date), 0) +
    missed.reduce((s, sp) => s + daysLate(sp.due_date), 0)

  const n = evaluable.length
  // Component 1 — payment completion rate (40 pts)
  const comp1 = (paid.length / n) * 40
  // Component 2 — on-time rate of paid (35 pts)
  const comp2 = paid.length > 0 ? (onTime.length / paid.length) * 35 : 0
  // Component 3 — days late severity (25 pts), avg > 60 days = 0
  const avgDays = totalDaysLate / n
  const comp3   = Math.max(0, 25 - (avgDays / 60) * 25)

  const score = Math.min(100, Math.max(0, Math.round(comp1 + comp2 + comp3)))

  let grade: string, color: string, label: string
  if (score >= 92) { grade = 'Excellent'; color = '#1d8a4e'; label = 'A+' }
  else if (score >= 85) { grade = 'Great';      color = '#1d8a4e'; label = 'A'  }
  else if (score >= 75) { grade = 'Good';       color = '#0d7f82'; label = 'B'  }
  else if (score >= 60) { grade = 'Fair';       color = '#b25000'; label = 'C'  }
  else if (score >= 40) { grade = 'Poor';       color = '#d13b30'; label = 'D'  }
  else                  { grade = 'Critical';   color = '#d13b30'; label = 'F'  }

  return { score, grade, color, label, onTime: onTime.length, latePaid: latePaid.length, missed: missed.length, overdue: overdue.length, totalDaysLate, n }
}

// ─── TENANT DETAIL VIEW ───────────────────────────────────────────────────────

function TenantDetailView({
  tenant, sps, rule, onBack, onUpdatePayment,
}: {
  tenant: PaymentPlanTenant
  sps: ScheduledPayment[]
  rule: PaymentPlan['late_fee_rule']
  onBack: () => void
  onUpdatePayment: (id: string, updates: Parameters<typeof updateScheduledPayment>[1]) => void
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // ── Computed metrics ──────────────────────────────────────────────────────
  const pastDue   = sps.filter(sp => new Date(sp.due_date + 'T00:00:00') < today)
  const upcoming  = sps.filter(sp => new Date(sp.due_date + 'T00:00:00') >= today && sp.status === 'pending')
  const paid      = sps.filter(sp => ['paid', 'partial'].includes(sp.status))
  const overdue   = sps.filter(sp => ['pending', 'late'].includes(sp.status) && new Date(sp.due_date + 'T00:00:00') < today)
  const missed    = sps.filter(sp => sp.status === 'missed')

  const totalCollected    = paid.reduce((s, sp) => s + sp.paid_amount, 0)
  const totalExpectedPast = pastDue.reduce((s, sp) => s + sp.amount, 0)
  const totalUpcoming     = upcoming.reduce((s, sp) => s + sp.amount, 0)
  const rentOwedNow = overdue.reduce((s, sp) => s + sp.amount, 0) + missed.reduce((s, sp) => s + sp.amount, 0)

  // Per-payment late fee map: tracks fee total, how much was collected, and how much wasn't
  type LateFeeEntry = { fee: number; collected: number; uncollected: number }
  const lateFeeMap = new Map<string, LateFeeEntry>()
  if (rule) {
    // Unpaid past-due: fee accrues as of today, none collected
    for (const sp of [...overdue, ...missed]) {
      const fee = computeLateFees(rule, sp.due_date)
      if (fee > 0) lateFeeMap.set(sp.id, { fee, collected: 0, uncollected: fee })
    }
    // Paid late: fee frozen at paid_date; check if paid_amount covered rent + fee
    for (const sp of paid) {
      if (!sp.paid_date) continue
      const dl = daysLateByDate(sp.due_date, sp.paid_date)
      if (dl <= 0) continue
      const fee = computeLateFeesByDate(rule, sp.due_date, sp.paid_date)
      if (fee <= 0) continue
      const surplus     = sp.paid_amount - sp.amount
      const collected   = Math.min(fee, Math.max(0, surplus))
      const uncollected = fee - collected
      lateFeeMap.set(sp.id, { fee, collected, uncollected })
    }
  }
  const lateFeesCollected = Array.from(lateFeeMap.values()).reduce((s, v) => s + v.collected, 0)
  // Pending = fees on unpaid payments + fees not covered by paid-rent-only payments
  const lateFeesPending   = Array.from(lateFeeMap.values()).reduce((s, v) => s + v.uncollected, 0)
  const totalOwedNow      = rentOwedNow + lateFeesPending
  const totalDaysLate =
    paid.filter(sp => sp.paid_date).reduce((s, sp) => s + daysLateByDate(sp.due_date, sp.paid_date!), 0) +
    overdue.reduce((s, sp) => s + daysLate(sp.due_date), 0)

  const rating = computeTenantRating(sps)

  // ── Rating arc SVG ────────────────────────────────────────────────────────
  const R = 38, cx = 46, cy = 46
  const circ = 2 * Math.PI * R
  const arc  = rating.score !== null ? (rating.score / 100) * circ : 0

  // ── Group payments by month for the table ─────────────────────────────────
  const byMonth: Record<string, ScheduledPayment[]> = {}
  for (const sp of [...sps].sort((a, b) => b.due_date.localeCompare(a.due_date))) {
    const key = sp.due_date.slice(0, 7)
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(sp)
  }

  const statCard = (label: string, value: string, sub: string, accent: string, bg: string) => (
    <div style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: '12px', padding: '16px 18px', flex: '1 1 140px', minWidth: 0 }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: accent, letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#8e8e93', marginTop: 4 }}>{sub}</div>
    </div>
  )

  const TABLE_COLS = '90px 90px 1fr 90px 90px 70px 90px'

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', border: '1px solid #e5e5ea', borderRadius: '8px', background: '#fff', color: '#6e6e73', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          ← Tenants
        </button>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
          {tenant.name[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.3px' }}>{tenant.name}</div>
          {tenant.email && <div style={{ fontSize: '12px', color: '#6e6e73' }}>{tenant.email}</div>}
        </div>
      </div>

      {/* Snapshot + Rating */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'stretch' }}>

        {/* Metric cards */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
          {statCard('Collected', fmtCurrency(totalCollected), `of ${fmtCurrency(totalExpectedPast)} billed`, '#1d1d1f', '#fafafb')}
          {statCard(
            'Currently Owed',
            fmtCurrency(totalOwedNow),
            lateFeesPending > 0
              ? `${fmtCurrency(rentOwedNow)} rent + ${fmtCurrency(lateFeesPending)} fees`
              : `${overdue.length + missed.length} payment${(overdue.length + missed.length) !== 1 ? 's' : ''} past due`,
            totalOwedNow > 0 ? '#d13b30' : '#1d1d1f', '#fff'
          )}
          {statCard('Upcoming', fmtCurrency(totalUpcoming), `${upcoming.length} payment${upcoming.length !== 1 ? 's' : ''} scheduled`, '#0d7f82', '#fff')}
          {statCard('Late Fees Owed', fmtCurrency(lateFeesPending), lateFeesCollected > 0 ? `${fmtCurrency(lateFeesCollected)} already collected` : 'none collected yet', lateFeesPending > 0 ? '#b25000' : '#1d1d1f', '#fff')}
          {statCard('Days Late Total', String(totalDaysLate), `across ${sps.length} payment${sps.length !== 1 ? 's' : ''}`, totalDaysLate > 0 ? '#b25000' : '#1d1d1f', '#fff')}
        </div>

        {/* Rating card */}
        <div style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: '12px', padding: '18px 22px', minWidth: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Payment Rating</div>

          {/* Arc gauge */}
          <div style={{ position: 'relative', width: 92, height: 92, marginBottom: 8 }}>
            <svg width="92" height="92" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f0f0f2" strokeWidth="8" />
              {rating.score !== null && (
                <circle cx={cx} cy={cy} r={R} fill="none" stroke={rating.color} strokeWidth="8"
                  strokeDasharray={`${arc} ${circ}`} strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.6s ease' }}
                />
              )}
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: rating.score !== null ? '22px' : '14px', fontWeight: 800, color: rating.color, lineHeight: 1 }}>
                {rating.score !== null ? rating.score : '—'}
              </div>
              {rating.score !== null && <div style={{ fontSize: '10px', color: '#8e8e93', fontWeight: 600 }}>/100</div>}
            </div>
          </div>

          <div style={{ fontSize: '14px', fontWeight: 700, color: rating.color }}>{rating.grade}</div>

          {/* Mini breakdown */}
          {rating.score !== null && 'onTime' in rating && (
            <div style={{ marginTop: 10, width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { label: 'On time',   value: rating.onTime,   color: '#1d8a4e' },
                { label: 'Late',      value: rating.latePaid, color: '#b25000' },
                { label: 'Overdue',   value: rating.overdue,  color: '#d13b30' },
                { label: 'Missed',    value: rating.missed,   color: '#9d174d' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                  <span style={{ color: '#6e6e73' }}>{row.label}</span>
                  <span style={{ fontWeight: 700, color: row.value > 0 ? row.color : '#d6d6db' }}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment history table */}
      <div style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: '13px', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0f0f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f' }}>Payment History</div>
          <div style={{ fontSize: '12px', color: '#6e6e73' }}>{sps.length} total · {paid.length} paid · {overdue.length + missed.length} outstanding</div>
        </div>

        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '8px 18px', background: '#fafafb', borderBottom: '1px solid #f0f0f2' }}>
          {['Month', 'Due Date', 'Period', 'Expected', 'Collected', 'Days Late', 'Late Fee'].map((h, i) => (
            <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>

        {/* Rows grouped by month (newest first) */}
        {Object.entries(byMonth).map(([monthKey, monthSPs]) => {
          const monthPaid      = monthSPs.reduce((s, sp) => s + sp.paid_amount, 0)
          const monthExpected  = monthSPs.reduce((s, sp) => s + sp.amount, 0)
          const allPaid        = monthSPs.every(sp => sp.status === 'paid')
          const anyLate        = monthSPs.some(sp => isOverdue(sp) || (sp.paid_date && daysLateByDate(sp.due_date, sp.paid_date) > 0))

          const monthOverdue    = monthSPs.filter(sp => isOverdue(sp))
          // Include uncollected fees from both overdue AND paid-but-late payments
          const monthLateFees   = monthSPs.reduce((s, sp) => s + (lateFeeMap.get(sp.id)?.uncollected ?? 0), 0)
          const monthBalanceDue = monthOverdue.reduce((s, sp) => s + sp.amount, 0) + monthLateFees

          return (
            <div key={monthKey}>
              {/* Month sub-header */}
              <div style={{ padding: '7px 18px', background: '#fafafb', borderBottom: '1px solid #f0f0f2', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#6e6e73' }}>{fmtMonth(monthKey + '-01')}</span>
                {allPaid && !anyLate && <span style={{ fontSize: '10px', background: '#e8f5ed', color: '#1d8a4e', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>All on time ✓</span>}
                {allPaid && anyLate  && <span style={{ fontSize: '10px', background: '#fef9c3', color: '#b25000', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>Paid late</span>}
                {monthBalanceDue > 0 && (
                  <span style={{ fontSize: '10px', background: '#fdeceb', color: '#d13b30', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>
                    Balance due: {fmtCurrency(monthBalanceDue)}{monthLateFees > 0 ? ` (incl. ${fmtCurrency(monthLateFees)} fees)` : ''}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#8e8e93' }}>{fmtCurrency(monthPaid)} / {fmtCurrency(monthExpected)}</span>
              </div>

              {monthSPs.map(sp => {
                const effSt         = getEffectiveStatus(sp)
                const dlDisp        = sp.paid_date ? daysLateByDate(sp.due_date, sp.paid_date) : daysLate(sp.due_date)
                const lateFeeEntry  = lateFeeMap.get(sp.id)
                const lfDisp        = lateFeeEntry?.fee ?? 0
                const lfUncollected = lateFeeEntry?.uncollected ?? 0
                const shortfall     = sp.amount + lfDisp - sp.paid_amount
                const stCfg         = STATUS_CFG[effSt] ?? STATUS_CFG.pending

                return (
                  <div
                    key={sp.id}
                    style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '10px 18px', borderBottom: '1px solid #fafafb', alignItems: 'center', background: isOverdue(sp) ? '#fefefe' : '#fff' }}
                  >
                    <div style={{ fontSize: '12px', color: '#6e6e73' }}>{new Date(sp.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
                    <div style={{ fontSize: '12px', color: '#6e6e73' }}>{fmtDate(sp.due_date)}</div>
                    <div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: stCfg.bg, color: stCfg.color, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: stCfg.dot, flexShrink: 0 }} />{stCfg.label}
                      </span>
                      {sp.paid_date && <span style={{ fontSize: '10px', color: '#8e8e93', marginLeft: 6 }}>paid {fmtDate(sp.paid_date)}</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {lfDisp > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          <span style={{ fontSize: '11px', color: '#6e6e73' }}>{fmtCurrency(sp.amount)} rent</span>
                          <span style={{ fontSize: '11px', color: '#b25000' }}>+{fmtCurrency(lfDisp)} fee</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: lfUncollected > 0 ? '#d13b30' : '#1d8a4e' }}>{fmtCurrency(sp.amount + lfDisp)}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f' }}>{fmtCurrency(sp.amount)}</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {sp.paid_amount > 0 ? (
                        <span style={{ fontSize: '13px', fontWeight: 700, color: shortfall > 0.01 ? '#b25000' : '#1d8a4e' }}>{fmtCurrency(sp.paid_amount)}</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#d6d6db' }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {dlDisp > 0
                        ? <span style={{ fontSize: '11px', fontWeight: 700, color: sp.paid_date ? '#b25000' : '#d13b30', background: sp.paid_date ? '#fdf1e3' : '#fdeceb', padding: '2px 6px', borderRadius: '5px' }}>{dlDisp}d</span>
                        : <span style={{ fontSize: '12px', color: '#d6d6db' }}>—</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {lfDisp > 0 ? (
                        lfUncollected > 0
                          ? <span style={{ fontSize: '11px', fontWeight: 700, color: '#b25000', background: '#fdf1e3', border: '1px solid #f6dcc0', padding: '2px 6px', borderRadius: '5px' }}>🚩 {fmtCurrency(lfUncollected)}</span>
                          : <span style={{ fontSize: '11px', fontWeight: 700, color: '#1d8a4e', background: '#e8f5ed', border: '1px solid #e8f5ed', padding: '2px 6px', borderRadius: '5px' }}>✓ {fmtCurrency(lfDisp)}</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#d6d6db' }}>—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Totals footer */}
        <div style={{ borderTop: '2px solid #e5e5ea' }}>
          <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '12px 18px', background: '#fafafb' }}>
            <div style={{ gridColumn: '1 / 4', fontSize: '12px', fontWeight: 700, color: '#1d1d1f' }}>Totals</div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, color: '#1d1d1f' }}>{fmtCurrency(sps.reduce((s, sp) => s + sp.amount, 0))}</div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, color: totalCollected > 0 ? '#1d8a4e' : '#d6d6db' }}>{fmtCurrency(totalCollected)}</div>
            <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: totalDaysLate > 0 ? '#b25000' : '#d6d6db' }}>{totalDaysLate}d</div>
            <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: lateFeesPending > 0 ? '#b25000' : '#d6d6db' }}>{lateFeesPending > 0 ? `🚩 ${fmtCurrency(lateFeesPending)}` : '—'}</div>
          </div>
          {totalOwedNow > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '10px 18px', background: '#fdeceb', borderTop: '1px solid #f3c6c2' }}>
              <div style={{ gridColumn: '1 / 4', fontSize: '12px', fontWeight: 700, color: '#d13b30', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span> Balance Due
                {lateFeesPending > 0 && <span style={{ fontSize: '11px', fontWeight: 500, color: '#d13b30' }}>({fmtCurrency(rentOwedNow)} rent + {fmtCurrency(lateFeesPending)} fees)</span>}
              </div>
              <div style={{ gridColumn: '4 / 5', textAlign: 'right', fontSize: '15px', fontWeight: 800, color: '#d13b30' }}>{fmtCurrency(totalOwedNow)}</div>
              <div style={{ gridColumn: '5 / -1' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── PAYER ADMINISTRATION ─────────────────────────────────────────────────────

const INP: React.CSSProperties = {
  width: '100%', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '9px 11px',
  fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', color: '#0071e3',
}

function FieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * Add a payer to the plan. Putting someone on the money is a financial act — it
 * generates a schedule and can prorate a first month — so it lives with the
 * ledger, while the lease only records who lives there.
 */
function AddPayerForm({
  plan, onDone, onCancel,
}: {
  plan: PaymentPlan
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const [name, setName]           = useState('')
  const [email, setEmail]         = useState('')
  const [monthly, setMonthly]     = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [schedule, setSchedule]   = useState(true)
  const [prorate, setProrate]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const preview = (() => {
    if (!startDate || !monthly || !prorate || !schedule) return null
    const amt = parseFloat(monthly)
    if (isNaN(amt) || amt <= 0) return null
    return computeProration(amt, startDate, plan.due_day)
  })()

  const blocked = !name || !monthly || saving

  async function submit() {
    if (!name || !monthly) return
    setSaving(true); setError('')
    const res = await fetch(`/api/payments/${plan.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: email || null,
        monthly_total: parseFloat(monthly),
        start_date: startDate || null,
        end_date: endDate || null,
        generate_schedule: schedule,
        include_proration: prorate,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setError(json.error || 'Failed to add payer'); return }
    onDone(
      schedule
        ? `${name} added with ${json.payments_created} payment${json.payments_created !== 1 ? 's' : ''} scheduled.`
        : `${name} added.`
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5ea', borderRadius: 13, padding: '18px 20px', marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1d1d1f', marginBottom: 12 }}>Add payer</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <FieldBox label="Full name *">
          <input style={INP} value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
        </FieldBox>
        <FieldBox label="Email">
          <input style={INP} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@email.com" />
        </FieldBox>
        <FieldBox label="Monthly amount *">
          <input style={INP} type="number" min="0" step="0.01" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="750" />
        </FieldBox>
        <FieldBox label="Start date">
          <input style={INP} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </FieldBox>
        <FieldBox label="End date">
          <input style={INP} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </FieldBox>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6e6e73', marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={schedule} onChange={e => setSchedule(e.target.checked)} />
        Generate payment schedule
      </label>
      {schedule && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6e6e73', marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={prorate} onChange={e => setProrate(e.target.checked)} />
          Prorate first month
        </label>
      )}

      {preview && (
        <div style={{ background: '#fafafb', border: '1px solid #e5e5ea', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#6e6e73', marginTop: 8, lineHeight: 1.55 }}>
          <strong>Proration preview:</strong> first payment on {fmtDate(startDate)} is{' '}
          <strong>{fmtCurrency(preview.proratedAmount)}</strong> ({preview.proratedDays} of {preview.totalDays} days).
          Full payments of <strong>{fmtCurrency(parseFloat(monthly))}</strong> start {fmtDate(preview.firstDueDate)}.
        </div>
      )}

      {error && (
        <div style={{ background: '#fdeceb', border: '1px solid #f3c6c2', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#d13b30', marginTop: 10 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
        <button
          onClick={submit}
          disabled={blocked}
          style={{ background: '#0071e3', color: '#fff', border: 'none', borderRadius: 980, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.55 : 1, fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Adding…' : 'Add payer'}
        </button>
        <button
          onClick={onCancel}
          style={{ background: '#fff', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, color: '#6e6e73', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * End a payer's obligation mid-term. Shows exactly how many future charges get
 * voided before the landlord commits to it.
 */
function TerminatePayerPanel({
  plan, tenant, onDone, onCancel,
}: {
  plan: PaymentPlan
  tenant: PaymentPlanTenant
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const [date, setDate]       = useState('')
  const [reason, setReason]   = useState('')
  const [preview, setPreview] = useState<number | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  async function loadPreview(afterDate: string) {
    if (!afterDate) { setPreview(null); return }
    const { count } = await supabase
      .from('scheduled_payments')
      .select('*', { count: 'exact', head: true })
      .eq('plan_tenant_id', tenant.id)
      .in('status', ['pending', 'late'])
      .gt('due_date', afterDate)
    setPreview(count ?? 0)
  }

  async function submit() {
    if (!date) return
    setSaving(true); setError('')
    const res = await fetch(`/api/payments/${plan.id}/members/${tenant.id}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termination_date: date, termination_reason: reason }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setError(json.error || 'Failed to terminate'); return }
    onDone(`${tenant.name} terminated. ${json.voided} future payment${json.voided !== 1 ? 's' : ''} voided.`)
  }

  return (
    <div style={{ background: '#fff7f7', border: '1.5px solid #f3c6c2', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#d13b30', marginBottom: 12 }}>
        Early termination — {tenant.name}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <FieldBox label="Termination date">
          <input style={INP} type="date" value={date} onChange={e => { setDate(e.target.value); loadPreview(e.target.value) }} />
        </FieldBox>
        <FieldBox label="Reason (optional)">
          <input style={INP} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Moved out early" />
        </FieldBox>
      </div>

      {preview !== null && date && (
        <div style={{ fontSize: 12.5, color: '#d13b30', marginTop: 10 }}>
          {preview === 0
            ? 'No future pending payments to void.'
            : `${preview} future payment${preview !== 1 ? 's' : ''} will be voided after ${fmtDate(date)}.`}
        </div>
      )}
      {error && <div style={{ fontSize: 12.5, color: '#d13b30', marginTop: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
        <button
          onClick={submit}
          disabled={!date || saving}
          style={{ background: '#d13b30', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: !date || saving ? 'not-allowed' : 'pointer', opacity: !date || saving ? 0.55 : 1, fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Terminating…' : 'Confirm termination'}
        </button>
        <button
          onClick={onCancel}
          style={{ background: '#fff', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, color: '#6e6e73', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

/**
 * The rent ledger for one payment plan: schedule, payers and special charges.
 *
 * Rendered inside Financials, which supplies the breadcrumb, the property title
 * and the link back to the lease — so in embedded mode this drops its own page
 * chrome and shows only the money.
 */
export default function PlanWorkspace({
  planId,
  embedded = false,
}: {
  planId: string
  embedded?: boolean
}) {
  const [plan,             setPlan]             = useState<PaymentPlan | null>(null)
  const [loading,          setLoading]          = useState(true)
  const [tab,              setTab]              = useState<Tab>('schedule')
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null)
  // Reminder confirmation — nothing emails a tenant without passing through it.
  const [remindTarget, setRemindTarget] = useState<{ ids: string[]; specialIds?: string[]; label: string } | null>(null)
  const [remindMsg, setRemindMsg] = useState('')
  const [reminding, setReminding] = useState(false)
  const [remindResult, setRemindResult] = useState<{ ok: boolean; text: string } | null>(null)
  /** Every payment request sent on this plan — rows filter to their own. */
  const [emails, setEmails] = useState<PlanEmail[]>([])
  // Re-sending a confirmation for money that already arrived.
  const [receiptTarget, setReceiptTarget] = useState<
    { scheduledIds: string[]; specialIds: string[]; label: string; amount: number } | null
  >(null)
  const [receiptAudience, setReceiptAudience] = useState<'tenant' | 'landlord' | 'both'>('both')
  const [sendingReceipt, setSendingReceipt] = useState(false)
  // Payer administration — adding and ending someone's obligation on this plan.
  const [showAddPayer, setShowAddPayer] = useState(false)
  const [terminateTarget, setTerminateTarget] = useState<string | null>(null)
  const [payerMsg, setPayerMsg] = useState('')
  /** Lease-level utilities — declared once, charged to every payer. */
  const [utilities, setUtilities] = useState<PlanUtility[]>([])
  /** The charge whose detail sheet is open. One modal, not one per row. */
  const [openPayment, setOpenPayment] = useState<ScheduledPayment | null>(null)
  /**
   * Late fees the landlord has written off, keyed by the rent row they sat on.
   *
   * Needed in the ledger as well as in Financials: a fee shown as owed here
   * when it has already been forgiven would contradict a decision the landlord
   * made on the other page, and they would have no way to tell which page was
   * lying.
   */
  const [waivers, setWaivers] = useState<Record<string, LateFeeWaiver>>({})

  const loadWaivers = async () => {
    // RLS keys this table on plan ownership, so the plan filter is for volume,
    // not for safety.
    const { data } = await supabase
      .from('late_fee_waivers')
      .select('scheduled_payment_id, amount, reason, created_at')
      .eq('plan_id', planId)
    const next: Record<string, LateFeeWaiver> = {}
    for (const w of data ?? []) {
      next[w.scheduled_payment_id] = { ...w, amount: Number(w.amount) }
    }
    setWaivers(next)
  }

  const load = () => {
    setLoading(true)
    getPlanById(planId).then(p => { setPlan(p); setLoading(false) })
    getUtilitiesForPlan(planId).then(setUtilities)
    loadWaivers()
  }

  /** A utility changed: its shares and everyone's totals moved with it, so the
   *  whole plan is re-read rather than patched in place. */
  const reloadAfterUtility = () => {
    getPlanById(planId).then(p => { if (p) setPlan(p) })
    getUtilitiesForPlan(planId).then(setUtilities)
  }

  /** Request history is independent of the ledger, so a failure here must not
   *  take the money view down with it — the rows just show no history. */
  const loadEmails = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/payments/${planId}/emails`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      if (!res.ok) return
      const json = await res.json()
      setEmails(json.emails ?? [])
    } catch { /* leave history empty */ }
  }

  useEffect(() => {
    if (!embedded) document.title = 'Payment Plan — Landlord | HomeHive'
  }, [embedded])

  useEffect(() => { load(); loadEmails() }, [planId])

  const handleUpdateScheduled = async (id: string, updates: Parameters<typeof updateScheduledPayment>[1]) => {
    await updateScheduledPayment(id, updates)
    // Refresh just the scheduled_payments without full reload for responsiveness
    setPlan(prev => prev ? {
      ...prev,
      scheduled_payments: prev.scheduled_payments?.map(sp =>
        sp.id === id ? { ...sp, ...updates } : sp
      ),
    } : prev)
    // The sheet reads from this row too, so keep it on the saved values rather
    // than the ones it opened with.
    setOpenPayment(prev => prev && prev.id === id ? { ...prev, ...updates } as ScheduledPayment : prev)
  }

  /** Chase a single charge from its row. */
  function remindOne(p: ScheduledPayment) {
    const who = plan?.tenants.find(t => t.id === p.plan_tenant_id)?.name ?? 'this tenant'
    setRemindTarget({ ids: [p.id], label: `${fmtMonth(p.due_date)} rent for ${who}` })
  }

  /** Ask for one deposit or one-off charge. */
  function remindSpecial(sp: SpecialPayment) {
    const who = sp.tenant?.name ?? (plan?.tenants.length === 1 ? plan.tenants[0].name : 'the tenants')
    setRemindTarget({ ids: [], specialIds: [sp.id], label: `${sp.label} for ${who}` })
  }

  /** Confirm settled rent again — the receipt, not a chase. */
  function resendReceiptFor(p: ScheduledPayment) {
    setReceiptAudience('both')
    setReceiptTarget({ scheduledIds: [p.id], specialIds: [], label: `${fmtMonth(p.due_date)} rent`, amount: p.amount })
  }

  function resendReceiptForSpecial(sp: SpecialPayment) {
    setReceiptAudience('both')
    setReceiptTarget({ scheduledIds: [], specialIds: [sp.id], label: sp.label, amount: sp.amount })
  }

  async function sendReceipt() {
    if (!receiptTarget) return
    setSendingReceipt(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/payments/${planId}/resend-receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        scheduledIds: receiptTarget.scheduledIds,
        specialIds: receiptTarget.specialIds,
        audience: receiptAudience,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setSendingReceipt(false)
    setReceiptTarget(null)

    if (!res.ok || !json.ok) {
      const why = json.error || (json.skipped ?? []).join(' · ') || 'Could not send the confirmation.'
      setRemindResult({ ok: false, text: why })
      setTimeout(() => setRemindResult(null), 7000)
      return
    }
    const who = (json.sent ?? []).map((x: { role: string }) => x.role).join(' and ')
    setRemindResult({ ok: true, text: `Confirmation sent to ${who || 'the recipients'}` })
    setTimeout(() => setRemindResult(null), 6000)
    loadEmails()
  }

  /** Email the tenants behind the selected charges. One email per person. */
  async function sendReminders() {
    if (!remindTarget) return
    setReminding(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/payments/${planId}/remind`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        paymentIds: remindTarget.ids,
        specialPaymentIds: remindTarget.specialIds ?? [],
        message: remindMsg || undefined,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setReminding(false)

    if (!res.ok) {
      setRemindResult({ ok: false, text: json.error || 'Could not send reminders.' })
      return
    }
    setRemindTarget(null)
    setRemindMsg('')
    loadEmails()
    const bits = [`Reminder sent to ${json.sent} tenant${json.sent !== 1 ? 's' : ''}`]
    if (json.skipped?.length) bits.push(`${json.skipped.length} skipped (${json.skipped[0].reason})`)
    setRemindResult({ ok: json.sent > 0, text: bits.join(' · ') })
    setTimeout(() => setRemindResult(null), 6000)
    load()
  }

  const handleUpdateSpecial = async (id: string, updates: Parameters<typeof updateSpecialPaymentFull>[1]) => {
    await updateSpecialPaymentFull(id, updates)
    setPlan(prev => prev ? {
      ...prev,
      special_payments: prev.special_payments?.map(sp => sp.id === id ? { ...sp, ...updates } : sp),
    } : prev)
  }

  if (loading) {
    return (
      <div style={{ minHeight: embedded ? '160px' : '100vh', background: embedded ? 'transparent' : '#fafafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '14px', color: '#6e6e73' }}>Loading…</div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div style={{ minHeight: embedded ? '160px' : '100vh', background: embedded ? 'transparent' : '#fafafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#1d1d1f' }}>Plan not found</div>
          <a href="/landlord/financials" style={{ display: 'inline-block', marginTop: 16, color: '#6e6e73', fontSize: '13px' }}>← Back to financials</a>
        </div>
      </div>
    )
  }

  // ── Computed stats ──
  const sps         = plan.scheduled_payments ?? []
  const specials    = plan.special_payments ?? []
  const today       = new Date()
  const thisMonthSPs = sps.filter(sp => {
    const d = new Date(sp.due_date + 'T00:00:00')
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  })
  const overdueSPs    = sps.filter(p => isOverdue(p))
  // What a landlord would ask for today: this month's rent plus anything still
  // owed from before. Overdue on its own misses the common case — the 1st has
  // arrived, nothing is late yet, and rent still needs requesting.
  const unsettled     = (p: ScheduledPayment) =>
    p.status !== 'paid' && p.status !== 'processing' && p.status !== 'voided' && p.amount - p.paid_amount > 0
  const requestableSPs = [
    ...thisMonthSPs.filter(unsettled),
    ...overdueSPs.filter(p => unsettled(p) && !thisMonthSPs.some(m => m.id === p.id)),
  ]
  const requestableTotal = requestableSPs.reduce((s, p) => s + (p.amount - p.paid_amount), 0)
  // Same rule as the month groups: all money received, not only the rows that
  // settled in full, and voided rent is not expected of anyone.
  const totalPaid     = thisMonthSPs.filter(p => p.status !== 'voided').reduce((s, p) => s + p.paid_amount, 0)
  const totalMonthly  = plan.tenants.reduce((s, t) => s + t.monthly_total, 0)
  const leaseRent     = plan.lease?.rent_amount ?? 0
  const amountMismatch = leaseRent > 0 && Math.abs(totalMonthly - leaseRent) > 0.01

  // Group scheduled payments by month
  const byMonth: Record<string, ScheduledPayment[]> = {}
  for (const sp of sps) {
    const key = sp.due_date.slice(0, 7) // YYYY-MM
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(sp)
  }
  const monthKeys = Object.keys(byMonth).sort()
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return (
    <div style={{ minHeight: embedded ? undefined : '100vh', background: embedded ? 'transparent' : '#fafafb', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,wght@0,300;1,300&display=swap'); input:focus,select:focus{border-color:#0071e3!important;}`}</style>

      {/* Header */}
      <div style={{ background: embedded ? 'transparent' : '#fff', borderBottom: embedded ? 'none' : '1px solid #e5e5ea' }}>
        {!embedded && (
          <div style={{ padding: '16px 28px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid #f0f0f2' }}>
            <a href="/landlord/financials" style={{ color: '#6e6e73', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}>← Financials</a>
            <span style={{ color: '#d6d6db' }}>/</span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1d1d1f' }}>{plan.name}</span>
            {plan.lease_id && (
              <>
                <span style={{ color: '#d6d6db' }}>·</span>
                <a href={`/landlord/leases/${plan.lease_id}`} style={{ color: '#1d8a4e', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
                  Open lease →
                </a>
              </>
            )}
          </div>
        )}

        <div style={{ padding: embedded ? 0 : '20px 28px' }}>
          {!embedded && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1d1d1f', marginBottom: 4 }}>{plan.property?.name ?? plan.name}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#6e6e73' }}>{plan.name}</span>
                  {plan.lease && (
                    <span style={{ fontSize: '13px', color: '#8e8e93' }}>
                      {fmtDate(plan.lease.start_date)} – {fmtDate(plan.lease.end_date)}
                    </span>
                  )}
                  <span style={{ fontSize: '13px', color: '#6e6e73' }}>Due {fmtOrdinal(plan.due_day)} of month</span>
                </div>
              </div>

              {/* Summary pills */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#1d1d1f' }}>{fmtCurrency(totalMonthly)}</div>
                  <div style={{ fontSize: '11px', color: '#8e8e93' }}>monthly total</div>
                </div>
                <div style={{ width: '1px', background: '#e5e5ea' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: overdueSPs.length > 0 ? '#d13b30' : '#1d1d1f' }}>{overdueSPs.length}</div>
                  <div style={{ fontSize: '11px', color: '#8e8e93' }}>overdue</div>
                </div>
                <div style={{ width: '1px', background: '#e5e5ea' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#1d8a4e' }}>{fmtCurrency(totalPaid)}</div>
                  <div style={{ fontSize: '11px', color: '#8e8e93' }}>this month</div>
                </div>
              </div>
            </div>
          )}

          {/* Collect this month's rent — the everyday action, not just chasing arrears */}
          {requestableSPs.length > 0 && (
            <div style={{ marginTop: 14, background: '#e8f5ed', border: '1px solid #cfe9d9', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#1d8a4e', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>💸</span>
              <span style={{ flex: 1, minWidth: 200 }}>
                <strong>{fmtCurrency(requestableTotal)}</strong> outstanding across{' '}
                {requestableSPs.length} payment{requestableSPs.length !== 1 ? 's' : ''}
                {' '}— email everyone a request with a link to pay online.
              </span>
              <button
                onClick={() => setRemindTarget({
                  ids: requestableSPs.map(p => p.id),
                  label: `${requestableSPs.length} outstanding payment${requestableSPs.length !== 1 ? 's' : ''} (${fmtCurrency(requestableTotal)})`,
                })}
                style={{ background: '#0071e3', color: '#fff', border: 'none', borderRadius: 980, padding: '8px 16px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', minHeight: 36 }}
              >
                ✉ Send rent requests
              </button>
            </div>
          )}

          {/* Warnings — and the action a landlord actually wants here */}
          {overdueSPs.length > 0 && (
            <div style={{ marginTop: 14, background: '#fdeceb', border: '1px solid #f3c6c2', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#d13b30', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>⚠️</span>
              <span style={{ flex: 1, minWidth: 200 }}>
                <strong>{overdueSPs.length} payment{overdueSPs.length !== 1 ? 's' : ''}</strong> past due
                {' '}({fmtCurrency(overdueSPs.reduce((s, p) => s + (p.amount - p.paid_amount), 0))})
                {' '}— click any row to mark as paid, or send a reminder.
              </span>
              <button
                onClick={() => setRemindTarget({ ids: overdueSPs.map(p => p.id), label: `${overdueSPs.length} overdue payment${overdueSPs.length !== 1 ? 's' : ''}` })}
                style={{ background: '#0071e3', color: '#fff', border: 'none', borderRadius: 980, padding: '8px 16px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', minHeight: 36 }}
              >
                ✉ Send reminders
              </button>
            </div>
          )}

          {amountMismatch && (
            <div style={{ marginTop: 10, background: '#fdf1e3', border: '1px solid #f6dcc0', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#b25000', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠</span>
              <span>Payer totals ({fmtCurrency(totalMonthly)}) don't match lease rent ({fmtCurrency(leaseRent)}). Difference: {fmtCurrency(Math.abs(totalMonthly - leaseRent))}.</span>
            </div>
          )}

          {/* Late fee info */}
          {plan.late_fee_rule && (
            <div style={{ marginTop: 10, background: '#fafafb', border: '1px solid #e5e5ea', borderRadius: '9px', padding: '10px 16px', fontSize: '12px', color: '#6e6e73', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📋</span>
              <span>
                Late fees: <strong>{fmtCurrency(plan.late_fee_rule.fee_amount)}</strong> every {plan.late_fee_rule.frequency_days} day{plan.late_fee_rule.frequency_days !== 1 ? 's' : ''}
                {plan.late_fee_rule.grace_period_days > 0 ? `, after ${plan.late_fee_rule.grace_period_days}d grace` : ''}
                {plan.late_fee_rule.max_total_fees ? ` (max ${fmtCurrency(plan.late_fee_rule.max_total_fees)})` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, paddingLeft: embedded ? 0 : 28, borderTop: embedded ? 'none' : '1px solid #f0f0f2', borderBottom: embedded ? '1px solid #e5e5ea' : 'none', marginTop: embedded ? 4 : 0 }}>
          {(['schedule', 'tenants', 'charges', 'activity'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: tab === t ? 700 : 500,
                color: tab === t ? '#1d1d1f' : '#6e6e73',
                borderBottom: `2px solid ${tab === t ? '#0071e3' : 'transparent'}`,
                fontFamily: "'DM Sans', sans-serif", transition: 'color 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {t === 'charges'
                ? `Charges${specials.length ? ` (${specials.length})` : ''}`
                : t === 'activity'
                  ? `Activity${emails.length ? ` (${emails.length})` : ''}`
                  : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'schedule' && overdueSPs.length > 0 && (
                <span style={{ marginLeft: 6, background: '#d13b30', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px' }}>{overdueSPs.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: embedded ? 'none' : 1050, margin: '0 auto', padding: embedded ? '18px 0 0' : '24px 20px' }}>
        <StripeModeBanner style={{ marginBottom: 16 }} />

        {/* ── SCHEDULE TAB ── */}
        {tab === 'schedule' && (
          <div>
            {monthKeys.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: '14px', border: '1px solid #e5e5ea' }}>
                <div style={{ fontSize: '13px', color: '#8e8e93' }}>No payments in schedule.</div>
              </div>
            ) : (
              <>
                {/* Current / upcoming months first, past months below a fold */}
                {(() => {
                  const future = monthKeys.filter(k => k >= currentMonthKey)
                  const past   = monthKeys.filter(k => k <  currentMonthKey)
                  return (
                    <>
                      {future.map(k => (
                        <MonthGroup key={k} month={k + '-01'} payments={byMonth[k]} rule={plan.late_fee_rule} tenants={plan.tenants} waivers={waivers} onOpen={setOpenPayment} defaultOpen={k === currentMonthKey} />
                      ))}
                      {past.length > 0 && (
                        <details style={{ marginTop: 12 }}>
                          <summary style={{ fontSize: '12px', fontWeight: 600, color: '#8e8e93', cursor: 'pointer', padding: '8px 4px', userSelect: 'none' }}>
                            {past.length} past month{past.length !== 1 ? 's' : ''} (click to expand)
                          </summary>
                          <div style={{ marginTop: 8, opacity: 0.7 }}>
                            {past.slice().reverse().map(k => (
                              <MonthGroup key={k} month={k + '-01'} payments={byMonth[k]} rule={plan.late_fee_rule} tenants={plan.tenants} waivers={waivers} onOpen={setOpenPayment} defaultOpen={false} />
                            ))}
                          </div>
                        </details>
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </div>
        )}

        {/* ── TENANTS TAB ── */}
        {tab === 'tenants' && selectedTenantId && (() => {
          const tenant    = plan.tenants.find(t => t.id === selectedTenantId)
          const tenantSPs = sps.filter(sp => sp.plan_tenant_id === selectedTenantId)
          if (!tenant) return null
          return (
            <TenantDetailView
              tenant={tenant}
              sps={tenantSPs}
              rule={plan.late_fee_rule}
              onBack={() => setSelectedTenantId(null)}
              onUpdatePayment={handleUpdateScheduled}
            />
          )
        })()}
        {tab === 'tenants' && !selectedTenantId && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1d1d1f', marginBottom: 2 }}>
                  Who pays ({plan.tenants.length})
                </div>
                <div style={{ fontSize: '12px', color: '#6e6e73' }}>
                  What each person owes each month, and what they have paid
                </div>
              </div>
              <button
                onClick={() => { setShowAddPayer(v => !v); setTerminateTarget(null) }}
                style={{ background: '#0071e3', color: '#fff', border: 'none', borderRadius: 980, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                {showAddPayer ? 'Cancel' : '+ Add payer'}
              </button>
            </div>

            {payerMsg && (
              <div style={{ background: '#e8f5ed', border: '1px solid #cfe9d9', borderRadius: 9, padding: '10px 14px', fontSize: 13, color: '#1d8a4e', marginBottom: 14 }}>
                {payerMsg}
              </div>
            )}

            {showAddPayer && (
              <AddPayerForm
                plan={plan}
                onCancel={() => setShowAddPayer(false)}
                onDone={msg => {
                  setShowAddPayer(false)
                  setPayerMsg(msg)
                  setTimeout(() => setPayerMsg(''), 5000)
                  // An even split divides by the number of active payers, so a
                  // new payer re-prices every monthly utility — including onto
                  // the person who just joined, who otherwise pays no share of
                  // the internet everyone else is covering.
                  reapplyPlanUtilities(planId).then(load)
                }}
              />
            )}

            {terminateTarget && (() => {
              const target = plan.tenants.find(t => t.id === terminateTarget)
              if (!target) return null
              return (
                <TerminatePayerPanel
                  plan={plan}
                  tenant={target}
                  onCancel={() => setTerminateTarget(null)}
                  onDone={msg => {
                    setTerminateTarget(null)
                    setPayerMsg(msg)
                    setTimeout(() => setPayerMsg(''), 6000)
                    // One fewer person sharing the bill — the rest absorb it.
                    reapplyPlanUtilities(planId).then(load)
                  }}
                />
              )
            })()}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {plan.tenants.map(t => {
              const tenantSPs     = sps.filter(sp => sp.plan_tenant_id === t.id)
              const tenantOverdue = tenantSPs.filter(p => isOverdue(p)).length
              const tenantPaid    = tenantSPs.filter(p => p.status === 'paid').length
              const rating        = computeTenantRating(tenantSPs)
              return (
                <div key={t.id} style={{ background: '#fff', borderRadius: '13px', border: tenantOverdue > 0 ? '1.5px solid #f3c6c2' : '1px solid #e5e5ea', padding: '20px 22px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                  onClick={() => setSelectedTenantId(t.id)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
                      {t.name[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#1d1d1f', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        {t.name}
                        {t.status !== 'active' && (
                          <span style={{ background: '#f0f0f2', color: '#6e6e73', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px' }}>
                            {t.status === 'terminated' ? 'Terminated' : 'Completed'}
                          </span>
                        )}
                      </div>
                      {t.email && <div style={{ fontSize: '12px', color: '#6e6e73' }}>{t.email}</div>}
                      {(t.start_date || t.end_date || t.termination_date) && (
                        <div style={{ fontSize: '11.5px', color: '#8e8e93', marginTop: 2 }}>
                          {t.start_date && `from ${fmtDate(t.start_date)}`}
                          {t.end_date && ` → ${fmtDate(t.end_date)}`}
                          {t.termination_date && ` · terminated ${fmtDate(t.termination_date)}`}
                          {t.termination_reason && ` (${t.termination_reason})`}
                        </div>
                      )}
                    </div>
                    {t.status === 'active' && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setShowAddPayer(false)
                          setTerminateTarget(terminateTarget === t.id ? null : t.id)
                        }}
                        style={{ background: '#fff', border: '1.5px solid #f3c6c2', color: '#d13b30', borderRadius: 7, padding: '5px 10px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}
                      >
                        Terminate
                      </button>
                    )}
                  </div>

                  {/* Line items */}
                  <div style={{ marginBottom: 10 }}>
                    {t.line_items.map(li => (
                      <div key={li.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #fafafb' }}>
                        <span style={{ fontSize: '13px', color: '#6e6e73' }}>{li.label}</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f' }}>{fmtCurrency(li.amount)}</span>
                      </div>
                    ))}
                    {t.line_items.length > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #e5e5ea' }}>
                        <span style={{ fontSize: '11px', color: '#8e8e93' }}>Sum</span>
                        <span style={{ fontSize: '12px', color: '#8e8e93' }}>{fmtCurrency(t.line_items.reduce((s, li) => s + li.amount, 0))}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#1d1d1f' }}>Monthly total</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {t.line_items.length > 0 && Math.abs(t.line_items.reduce((s, li) => s + li.amount, 0) - t.monthly_total) > 0.005 && (
                          <span style={{ fontSize: '10px', color: '#b25000', background: '#fdf1e3', border: '1px solid #f6dcc0', padding: '1px 6px', borderRadius: '4px' }}>custom</span>
                        )}
                        <span style={{ fontSize: '15px', fontWeight: 700, color: '#1d1d1f' }}>{fmtCurrency(t.monthly_total)}</span>
                      </div>
                    </div>
                    <LineItemEditor
                      tenant={t}
                      onSaved={newTotal => {
                        setPlan(prev => prev ? {
                          ...prev,
                          tenants: prev.tenants.map(pt => pt.id === t.id ? { ...pt, monthly_total: newTotal } : pt),
                        } : prev)
                        load()
                      }}
                    />
                  </div>

                  {/* Quick stats + rating */}
                  <div style={{ display: 'flex', gap: 10, background: '#fafafb', borderRadius: '8px', padding: '10px 12px', marginBottom: 10, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#1d8a4e' }}>{tenantPaid}</div>
                      <div style={{ fontSize: '10px', color: '#8e8e93' }}>Paid</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: tenantOverdue > 0 ? '#d13b30' : '#8e8e93' }}>{tenantOverdue}</div>
                      <div style={{ fontSize: '10px', color: '#8e8e93' }}>Overdue</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#1d1d1f' }}>{tenantSPs.length}</div>
                      <div style={{ fontSize: '10px', color: '#8e8e93' }}>Total</div>
                    </div>
                    <div style={{ width: '1px', background: '#e5e5ea', alignSelf: 'stretch' }} />
                    <div style={{ textAlign: 'center', paddingLeft: 4 }}>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: rating.color }}>{rating.score ?? '—'}</div>
                      <div style={{ fontSize: '10px', color: rating.color, fontWeight: 600 }}>{rating.label}</div>
                    </div>
                  </div>

                  {/* View payments link */}
                  <div style={{ textAlign: 'right', marginBottom: 8 }}>
                    <span style={{ fontSize: '12px', color: '#0d7f82', fontWeight: 600, cursor: 'pointer' }}>
                      View payments →
                    </span>
                  </div>

                  <TenantRentEditor
                    tenant={t}
                    sps={tenantSPs}
                    onSaved={() => {
                      setPlan(prev => prev ? {
                        ...prev,
                        tenants: prev.tenants.map(pt =>
                          pt.id === t.id ? { ...pt, monthly_total: parseFloat(String(t.monthly_total)) } : pt
                        ),
                      } : prev)
                      load()
                    }}
                  />
                </div>
              )
            })}
          </div>
          </>
        )}

        {/* ── SPECIAL CHARGES TAB ── */}
        {tab === 'charges' && (
          <div>
            {/* Recurring, lease-wide money comes first: it is what a landlord
                sets up once and then stops thinking about. The one-off charges
                below it are the exceptions. */}
            <UtilitiesPanel
              planId={planId}
              tenants={plan.tenants}
              utilities={utilities}
              onChanged={reloadAfterUtility}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderTop: '1px solid #e5e5ea', paddingTop: 20 }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1d1d1f', marginBottom: 2 }}>Deposits &amp; one-off charges</div>
                <div style={{ fontSize: '12px', color: '#6e6e73' }}>Security deposits, penalties and anything charged once</div>
              </div>
              <AddChargeForm planId={planId} tenants={plan.tenants} onAdded={load} />
            </div>

            {specials.length === 0 ? (
              <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e5ea', padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: '#8e8e93' }}>No special charges. Use the button above to add one.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {specials
                  .slice()
                  .sort((a, b) => {
                    if (a.category === 'security_deposit' && b.category !== 'security_deposit') return -1
                    if (b.category === 'security_deposit' && a.category !== 'security_deposit') return 1
                    return a.due_date.localeCompare(b.due_date)
                  })
                  .map(sp => (
                    <SpecialChargeCard
                      key={sp.id}
                      sp={sp}
                      multiTenant={plan.tenants.length > 1}
                      onUpdate={handleUpdateSpecial}
                      onRemind={sp.status === 'pending' ? remindSpecial : undefined}
                      onResendReceipt={resendReceiptForSpecial}
                      history={emailsForCharge(emails, { specialId: sp.id })}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {/* ── ACTIVITY ── every request sent on this lease, newest first ── */}
        {tab === 'activity' && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#1d1d1f', marginBottom: 2 }}>Payment requests</div>
              <div style={{ fontSize: '12px', color: '#6e6e73' }}>
                Every rent reminder and charge request sent on this lease — who it went to, what it
                covered, and whether it was delivered.
              </div>
            </div>

            {emails.length === 0 ? (
              <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e5ea', padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: '#8e8e93' }}>
                  Nothing sent yet. Requests you send from the schedule or a charge show up here.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {emails.map(e => (
                  <div key={e.id} style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e5e5ea', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#1d1d1f' }}>
                        {e.recipient_name || e.recipient_email}
                        <span style={{
                          marginLeft: 8, fontSize: '10.5px', fontWeight: 600, padding: '2px 8px', borderRadius: 980,
                          background: e.status === 'failed' ? '#fdeceb' : '#e8f5ed',
                          color:      e.status === 'failed' ? '#d13b30' : '#1d8a4e',
                        }}>
                          {e.status === 'failed' ? 'Not delivered' : 'Sent'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8e8e93' }}>{fmtWhen(e.created_at)}</div>
                    </div>

                    <div style={{ fontSize: '12.5px', color: '#6e6e73', marginTop: 6 }}>
                      {e.recipient_email}
                    </div>

                    {/* What the request actually asked for, month by month. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f2' }}>
                      {e.items.map(i => (
                        <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '12.5px' }}>
                          <span style={{ color: '#1d1d1f' }}>{i.label}</span>
                          <span style={{ color: '#6e6e73', fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(i.amount)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '12.5px', fontWeight: 700, marginTop: 4 }}>
                        <span>Total requested</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(e.amount_total)}</span>
                      </div>
                    </div>

                    {e.custom_message && (
                      <div style={{ fontSize: '12px', color: '#6e6e73', marginTop: 10, fontStyle: 'italic' }}>
                        &ldquo;{e.custom_message}&rdquo;
                      </div>
                    )}
                    {e.status === 'failed' && e.error && (
                      <div style={{ fontSize: '12px', color: '#d13b30', marginTop: 8 }}>{e.error}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Result toast */}
      {remindResult && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          background: remindResult.ok ? '#1d8a4e' : '#d13b30', color: '#fff',
          padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif", boxShadow: '0 8px 30px rgba(15,23,42,0.25)',
        }}>
          {remindResult.text}
        </div>
      )}

      {/* Resend a confirmation — the landlord picks who hears about it again */}
      {receiptTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => !sendingReceipt && setReceiptTarget(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: 420, fontFamily: "'DM Sans', sans-serif", boxShadow: '0 20px 60px rgba(15,23,42,0.3)' }}
          >
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.01em' }}>
              Resend confirmation
            </div>
            <div style={{ fontSize: '13px', color: '#6e6e73', marginTop: 6, lineHeight: 1.55 }}>
              {receiptTarget.label} · {fmtCurrency(receiptTarget.amount)}. This confirms money that
              has already been received — it does not ask for anything.
            </div>

            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { id: 'both',     label: 'Tenant and landlord', hint: 'Receipt to the tenant, a copy to you' },
                { id: 'tenant',   label: 'Tenant only',         hint: 'Just the receipt' },
                { id: 'landlord', label: 'Landlord only',       hint: 'Just your own copy' },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setReceiptAudience(opt.id)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    textAlign: 'left', padding: '11px 14px', borderRadius: '10px', cursor: 'pointer',
                    fontFamily: 'inherit', background: receiptAudience === opt.id ? '#f0f7ff' : '#fff',
                    border: `1.5px solid ${receiptAudience === opt.id ? '#0071e3' : '#e5e5ea'}`,
                  }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1d1d1f' }}>{opt.label}</span>
                  <span style={{ fontSize: '11.5px', color: '#6e6e73' }}>{opt.hint}</span>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button
                onClick={sendReceipt}
                disabled={sendingReceipt}
                style={{ flex: 1, padding: '10px 0', borderRadius: '9px', border: 'none', background: sendingReceipt ? '#8e8e93' : '#0071e3', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: sendingReceipt ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                {sendingReceipt ? 'Sending…' : 'Send confirmation'}
              </button>
              <button
                onClick={() => setReceiptTarget(null)}
                disabled={sendingReceipt}
                style={{ padding: '10px 16px', borderRadius: '9px', border: '1.5px solid #e5e5ea', background: '#fff', color: '#6e6e73', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reminder confirmation — who gets it, and what they'll be told */}
      {remindTarget && (() => {
        const rows = sps.filter(p => remindTarget.ids.includes(p.id))
        const chargeRows = specials.filter(sp => (remindTarget.specialIds ?? []).includes(sp.id))
        // A charge with no tenant is the household's. That resolves to a person
        // only when there is exactly one — otherwise the server skips it, and
        // the landlord should see that here before they hit send.
        const soleTenant = plan.tenants.length === 1 ? plan.tenants[0] : null
        const unassignedCharges = chargeRows.filter(sp => !sp.plan_tenant_id && !soleTenant)

        const byTenant = new Map<string, { name: string; email: string | null; total: number; count: number }>()
        const addFor = (tenantId: string | null, amount: number) => {
          const t = plan.tenants.find(x => x.id === tenantId)
          if (!t) return
          const cur = byTenant.get(t.id) ?? { name: t.name, email: t.email, total: 0, count: 0 }
          cur.total += amount
          cur.count += 1
          byTenant.set(t.id, cur)
        }
        for (const r of rows) addFor(r.plan_tenant_id, r.amount - r.paid_amount)
        for (const sp of chargeRows) addFor(sp.plan_tenant_id ?? soleTenant?.id ?? null, sp.amount)

        const people = [...byTenant.values()]
        const withEmail = people.filter(p => p.email)
        const onlyCharges = rows.length === 0 && chargeRows.length > 0
        const lastReminded = [...rows, ...chargeRows]
          .map(r => r.reminder_sent_at).filter(Boolean)
          .sort().pop()

        return (
          <div
            onClick={() => !reminding && setRemindTarget(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, fontFamily: "'DM Sans', sans-serif", overflow: 'hidden' }}>
              <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f0f0f2' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1d1d1f' }}>
                  {onlyCharges ? 'Send payment request' : 'Send rent reminder'}
                </div>
                <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 2 }}>
                  Covering {remindTarget.label} · one email per tenant
                </div>
              </div>

              <div style={{ padding: '16px 20px' }}>
                {lastReminded && (
                  <div style={{ background: '#fdf1e3', border: '1px solid #f6dcc0', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#b25000', marginBottom: 14, lineHeight: 1.5 }}>
                    Last {onlyCharges ? 'requested' : 'reminded'} {new Date(lastReminded).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
                    Chasing too often tends to get filtered.
                  </div>
                )}

                {unassignedCharges.length > 0 && (
                  <div style={{ background: '#fdeceb', border: '1px solid #f3c6c2', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#d13b30', marginBottom: 14, lineHeight: 1.5 }}>
                    {unassignedCharges.length === 1 ? 'One charge is' : `${unassignedCharges.length} charges are`} not assigned to a tenant
                    and will be skipped — open the charge and pick who owes it.
                  </div>
                )}

                {people.map(p => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #fafafb' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1d1d1f' }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: p.email ? '#8e8e93' : '#b25000' }}>
                        {p.email ?? 'No email on file — will be skipped'}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f', whiteSpace: 'nowrap' }}>
                      {fmtCurrency(p.total)}
                      <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: '#8e8e93', textAlign: 'right' }}>
                        {p.count} charge{p.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>
                    Add a note (optional)
                  </label>
                  <textarea
                    value={remindMsg}
                    onChange={e => setRemindMsg(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Happy to set up a payment plan if that helps — just let me know."
                    style={{ width: '100%', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '9px 11px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', color: '#0071e3' }}
                  />
                  <div style={{ fontSize: 11, color: '#8e8e93', marginTop: 4 }}>
                    The email shows the amount, each {onlyCharges ? 'item' : 'charge'}, how late it is, and a button to pay online.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 20px', borderTop: '1px solid #f0f0f2' }}>
                <button
                  onClick={() => setRemindTarget(null)}
                  disabled={reminding}
                  style={{ background: '#fff', border: '1.5px solid #e5e5ea', borderRadius: 8, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, color: '#6e6e73', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  Cancel
                </button>
                <button
                  onClick={sendReminders}
                  disabled={reminding || withEmail.length === 0}
                  style={{ background: '#0071e3', color: '#fff', border: 'none', borderRadius: 980, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: withEmail.length === 0 ? 'not-allowed' : 'pointer', opacity: withEmail.length === 0 ? 0.5 : 1, fontFamily: "'DM Sans', sans-serif" }}
                >
                  {reminding ? 'Sending…' : `Send to ${withEmail.length} tenant${withEmail.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── One charge, in full. Rows are read-only; this owns the detail and
             every control that changes a charge. ── */}
      {openPayment && (
        <PaymentDetailModal
          payment={openPayment}
          tenant={plan.tenants.find(t => t.id === openPayment.plan_tenant_id)}
          utilities={utilities}
          rule={plan.late_fee_rule ?? null}
          history={emailsForCharge(emails, { scheduledId: openPayment.id })}
          onUpdate={handleUpdateScheduled}
          onRemind={openPayment.status === 'paid' ? undefined : p => { setOpenPayment(null); remindOne(p) }}
          onResendReceipt={p => { setOpenPayment(null); resendReceiptFor(p) }}
          onClose={() => setOpenPayment(null)}
        />
      )}
    </div>
  )
}
