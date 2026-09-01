'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  getPlanById, updateScheduledPayment, updateSpecialPayment, updateSpecialPaymentFull, addSpecialPayment,
  updateTenantScheduleAmount, updateLineItem, addLineItem, deleteLineItem, updateTenantMonthlyTotal,
  getEffectiveStatus, isOverdue, computeLateFees, computeLateFeesByDate, daysLate, daysLateByDate,
  fmtCurrency, fmtDate, fmtMonth, fmtOrdinal,
  LINE_ITEM_CATEGORIES, SPECIAL_CATEGORIES,
  type PaymentPlan, type ScheduledPayment, type SpecialPayment, type PaymentStatus, type SpecialCategory,
  type PaymentPlanTenant, type PaymentLineItem,
} from '@/lib/payments'
import StripeModeBanner from '@/components/StripeModeBanner'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Tab = 'schedule' | 'tenants' | 'charges'

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { bg: string; color: string; label: string; dot: string }> = {
  paid:    { bg: '#dcfce7', color: '#166534', label: 'Paid',    dot: '#16a34a' },
  partial: { bg: '#fef9c3', color: '#92400e', label: 'Partial', dot: '#d97706' },
  pending: { bg: '#f1f5f9', color: '#475569', label: 'Pending', dot: '#94a3b8' },
  late:    { bg: '#fee2e2', color: '#991b1b', label: 'Late',    dot: '#ef4444' },
  missed:  { bg: '#fce7f3', color: '#9d174d', label: 'Missed',  dot: '#db2777' },
  voided:  { bg: '#f1f5f9', color: '#94a3b8', label: 'Voided',  dot: '#cbd5e1' },
  // Tenant paid by ACH; the money is in flight and settles in a few days.
  processing: { bg: '#fef3c7', color: '#92400e', label: 'Clearing', dot: '#f59e0b' },
}

/**
 * How a payment was settled. "Paid" alone is ambiguous once tenants can pay
 * online — the landlord needs to know whether money actually moved through
 * Stripe or whether they themselves ticked it off after a Zelle transfer.
 */
const METHOD_CFG: Record<string, { label: string; bg: string; color: string }> = {
  card:         { label: 'Card',   bg: '#f5f3ff', color: '#6d28d9' },
  ach:          { label: 'ACH',    bg: '#eff6ff', color: '#1d4ed8' },
  manual_zelle: { label: 'Zelle',  bg: '#ecfeff', color: '#0e7490' },
  manual_other: { label: 'Manual', bg: '#f1f5f9', color: '#64748b' },
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

const ROW_COLS = '1fr 88px 88px 110px 68px 96px'

function PaymentRow({
  payment, rule, onUpdate, onRemind,
}: {
  payment: ScheduledPayment
  rule?: { grace_period_days: number; fee_amount: number; frequency_days: number; max_total_fees: number | null } | null
  onUpdate: (id: string, updates: Parameters<typeof updateScheduledPayment>[1]) => void
  /** Chase this one charge. Absent when the row is already settled. */
  onRemind?: (payment: ScheduledPayment) => void
}) {
  const [open,      setOpen]      = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [paidAmt,   setPaidAmt]   = useState(payment.paid_amount > 0 ? String(payment.paid_amount) : '')
  const [paidDate,  setPaidDate]  = useState(payment.paid_date ?? new Date().toISOString().split('T')[0])
  const [notes,     setNotes]     = useState(payment.notes ?? '')
  const [newStatus, setNewStatus] = useState<PaymentStatus>(payment.status)
  // Moving the due date is how a landlord grants an extension: every late-fee
  // number in this panel is derived from it, so pushing it out calls the fee off.
  const [dueDate,   setDueDate]   = useState(payment.due_date)

  const effStatus = getEffectiveStatus(payment)
  const isPaidOrPartial = ['paid', 'partial'].includes(newStatus)

  // Late days: use paid_date for paid/partial, today for unpaid late
  const dlRow = payment.paid_date
    ? daysLateByDate(payment.due_date, payment.paid_date)
    : daysLate(payment.due_date)

  // Late fee in row: use paid_date if paid, today otherwise
  const lateFeeRow = rule
    ? (payment.paid_date
        ? computeLateFeesByDate(rule, payment.due_date, payment.paid_date)
        : (dlRow > 0 ? computeLateFees(rule, payment.due_date) : 0))
    : 0

  // Reactive late fee in the edit panel: keyed off the *edited* due date (so an
  // extension shows its effect before saving) and the paidDate field when paid/partial.
  const editDl = isPaidOrPartial
    ? daysLateByDate(dueDate, paidDate)
    : daysLate(dueDate)
  const editLateFee = rule && editDl > 0
    ? (isPaidOrPartial
        ? computeLateFeesByDate(rule, dueDate, paidDate)
        : computeLateFees(rule, dueDate))
    : 0

  const dueDateMoved = dueDate !== payment.due_date
  // What the extension is worth: the fee that stood on the original date, gone.
  const feeClearedByMove = dueDateMoved && lateFeeRow > 0 && editLateFee < lateFeeRow
    ? lateFeeRow - editLateFee
    : 0

  const collectedAmt  = payment.paid_amount
  const expectedTotal = payment.amount + lateFeeRow
  const shortfall     = expectedTotal - collectedAmt

  const save = async () => {
    setSaving(true)
    const amt         = parseFloat(paidAmt) || 0
    const finalStatus = newStatus as PaymentStatus
    await onUpdate(payment.id, {
      status:             finalStatus,
      paid_amount:        amt,
      paid_date:          isPaidOrPartial ? paidDate : null,
      notes:              notes || undefined,
      ...(dueDateMoved ? { due_date: dueDate } : {}),
      // Always written, never conditionally: an extension has to be able to
      // clear a fee that was already applied, not just raise a new one.
      late_fees_applied:  editLateFee,
    })
    setSaving(false)
    setOpen(false)
  }

  const iS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e2e8f0', borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0f172a', boxSizing: 'border-box' }

  const isVoided = payment.status === 'voided'

  return (
    <div style={{ borderBottom: '1px solid #f1f5f9', opacity: isVoided ? 0.55 : 1 }}>
      <div
        style={{ display: 'grid', gridTemplateColumns: ROW_COLS, gap: 8, alignItems: 'center', padding: '11px 16px', cursor: isVoided ? 'default' : 'pointer', transition: 'background 0.1s' }}
        onClick={() => !isVoided && setOpen(v => !v)}
        onMouseEnter={e => !isVoided && ((e.currentTarget as HTMLElement).style.background = '#fafafa')}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        {/* Tenant */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: '#475569', flexShrink: 0 }}>
            {(payment.tenant?.name ?? 'T')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{payment.tenant?.name ?? '—'}</div>
            {payment.tenant?.email && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{payment.tenant.email}</div>}
          </div>
        </div>

        {/* Expected */}
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>
          {fmtCurrency(payment.amount)}
        </div>

        {/* Collected */}
        <div style={{ textAlign: 'right' }}>
          {collectedAmt > 0 ? (
            <span style={{ fontSize: '13px', fontWeight: 700, color: shortfall > 0.01 ? '#d97706' : '#16a34a' }}>
              {fmtCurrency(collectedAmt)}
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>
          )}
        </div>

        {/* Status */}
        <div style={{ textAlign: 'center' }}>
          <StatusBadge status={isVoided ? 'voided' : effStatus} />
          {payment.payment_method && (
            <div style={{ marginTop: 3 }}>
              <MethodBadge method={payment.payment_method} recordedBy={payment.recorded_by} />
            </div>
          )}
        </div>

        {/* Days late (from paid_date, not today) */}
        <div style={{ textAlign: 'right' }}>
          {dlRow > 0
            ? <span style={{ fontSize: '11px', fontWeight: 700, color: payment.paid_date ? '#d97706' : '#ef4444', background: payment.paid_date ? '#fff7ed' : '#fef2f2', padding: '2px 6px', borderRadius: '5px' }}>{dlRow}d</span>
            : <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>}
        </div>

        {/* Late fee flag */}
        <div style={{ textAlign: 'right' }}>
          {lateFeeRow > 0 ? (
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', padding: '2px 7px', borderRadius: '5px' }}>
              🚩 {fmtCurrency(lateFeeRow)}
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>
          )}
        </div>
      </div>

      {/* Inline expand */}
      {open && (
        <div style={{ background: '#f8fafc', borderTop: '1px solid #f1f5f9', padding: '16px 16px 18px', borderLeft: '3px solid #0f172a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>STATUS</label>
              <select style={iS} value={newStatus} onChange={e => setNewStatus(e.target.value as PaymentStatus)}>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="late">Late</option>
                <option value="missed">Missed</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>AMOUNT COLLECTED ($)</label>
              <input
                style={iS} type="number" step="0.01" min={0}
                placeholder={fmtCurrency(payment.amount).replace('$', '')}
                value={paidAmt}
                onChange={e => setPaidAmt(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>DATE PAID</label>
              <input style={iS} type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} disabled={!isPaidOrPartial} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <input style={iS} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              <div style={{ fontSize: '10.5px', color: dueDateMoved ? '#0f766e' : '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
                {dueDateMoved
                  ? `Extension — was ${fmtDate(payment.due_date)}`
                  : 'Push this out to grant an extension'}
              </div>
            </div>
          </div>

          {/* An extension is only worth granting if the landlord can see what it costs them. */}
          {dueDateMoved && (
            <div style={{ background: feeClearedByMove > 0 ? '#f0fdf4' : '#f8fafc', border: `1px solid ${feeClearedByMove > 0 ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: '9px', padding: '10px 13px', marginBottom: 12, fontSize: '12px', color: feeClearedByMove > 0 ? '#166534' : '#475569', lineHeight: 1.55, fontWeight: 600 }}>
              {feeClearedByMove > 0
                ? `Moving the due date to ${fmtDate(dueDate)} clears ${fmtCurrency(feeClearedByMove)} in late fees${editLateFee > 0 ? ` — ${fmtCurrency(editLateFee)} still stands` : ' — this charge will no longer show as late'}.`
                : `Due date moves to ${fmtDate(dueDate)}. Save to apply.`}
            </div>
          )}

          {/* Late fee analysis — reactive */}
          {editLateFee > 0 && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '9px', padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span>🚩</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#c2410c' }}>
                  {isPaidOrPartial ? `Paid ${editDl} day${editDl !== 1 ? 's' : ''} late` : `${editDl} day${editDl !== 1 ? 's' : ''} overdue`} — Expected late fee: <strong>{fmtCurrency(editLateFee)}</strong>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div style={{ background: '#fff', borderRadius: '7px', padding: '8px 10px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>Rent Due</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(payment.amount)}</div>
                </div>
                <div style={{ background: '#fff', borderRadius: '7px', padding: '8px 10px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>Late Fee</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#c2410c' }}>+{fmtCurrency(editLateFee)}</div>
                </div>
                <div style={{ background: '#fff', borderRadius: '7px', padding: '8px 10px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>Total Expected</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(payment.amount + editLateFee)}</div>
                </div>
              </div>
              {/* Gap between collected and expected */}
              {(() => {
                const collected = parseFloat(paidAmt) || 0
                const gap = (payment.amount + editLateFee) - collected
                if (gap > 0.01 && collected > 0) return (
                  <div style={{ marginTop: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '7px', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#991b1b', fontWeight: 600 }}>Late fees not collected</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#dc2626' }}>{fmtCurrency(gap)}</span>
                  </div>
                )
                if (collected >= payment.amount + editLateFee) return (
                  <div style={{ marginTop: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: '#166534', fontWeight: 600 }}>
                    ✓ Late fee collected in full
                  </div>
                )
                return null
              })()}
            </div>
          )}

          {/* Shortfall when no late fee but paid less than expected */}
          {editLateFee === 0 && (() => {
            const collected = parseFloat(paidAmt) || 0
            const gap = payment.amount - collected
            if (gap > 0.01 && collected > 0) return (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '7px', padding: '8px 12px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#991b1b', fontWeight: 600 }}>Short by</span>
                <span style={{ fontSize: '14px', fontWeight: 800, color: '#dc2626' }}>{fmtCurrency(gap)}</span>
              </div>
            )
            return null
          })()}

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>NOTES (optional)</label>
            <input style={iS} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid via Zelle" />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', background: saving ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: '7px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              Cancel
            </button>

            {/* Chase this one charge, without touching anyone else's. */}
            {onRemind && (
              <button
                onClick={() => onRemind(payment)}
                title={payment.reminder_sent_at
                  ? `Last reminded ${new Date(payment.reminder_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : 'Email this tenant about this charge'}
                style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                ✉ {payment.reminder_sent_at ? `Remind again (${payment.reminder_count})` : 'Send reminder'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MONTH GROUP ──────────────────────────────────────────────────────────────

function MonthGroup({
  month, payments, rule, onUpdate, onRemind, defaultOpen,
}: {
  month: string
  payments: ScheduledPayment[]
  rule: PaymentPlan['late_fee_rule']
  onUpdate: (id: string, u: Parameters<typeof updateScheduledPayment>[1]) => void
  onRemind?: (payment: ScheduledPayment) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const active   = payments.filter(p => p.status !== 'voided')
  const paid     = active.filter(p => p.status === 'paid').length
  const overdue  = active.filter(p => isOverdue(p)).length
  const expected = active.reduce((s, p) => s + p.amount, 0)
  const collected = active.filter(p => p.status === 'paid').reduce((s, p) => s + p.paid_amount, 0)
  const voided   = payments.filter(p => p.status === 'voided').length

  return (
    <div style={{ marginBottom: 6, border: '1px solid #e2e8f0', borderRadius: '11px', overflow: 'hidden', background: '#fff' }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: open ? '#fff' : '#fafafa' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{fmtMonth(month)}</span>
          {overdue > 0 && <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{overdue} overdue</span>}
          {overdue === 0 && paid === active.length && active.length > 0 && <span style={{ background: '#dcfce7', color: '#166534', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>All paid ✓</span>}
          {voided > 0 && <span style={{ background: '#f1f5f9', color: '#94a3b8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{voided} voided</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {paid}/{active.length} paid · {fmtCurrency(collected)}/{fmtCurrency(expected)}
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: ROW_COLS, gap: 8, padding: '8px 16px', background: '#f8fafc' }}>
            {['Tenant', 'Expected', 'Collected', 'Status', 'Days Late', 'Late Fee'].map(h => (
              <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: h !== 'Tenant' ? 'right' : 'left', ...(h === 'Status' ? { textAlign: 'center' } : {}) }}>
                {h}
              </div>
            ))}
          </div>
          {payments.map(p => (
            <PaymentRow key={p.id} payment={p} rule={rule ?? undefined} onUpdate={onUpdate} onRemind={onRemind} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── LINE ITEM EDITOR ─────────────────────────────────────────────────────────

type DraftItem = { id: string | null; category: string; label: string; amount: string; isNew?: boolean }

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
    padding: '6px 9px', fontSize: '12px', border: '1.5px solid #e2e8f0', borderRadius: '6px',
    outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0f172a',
    boxSizing: 'border-box',
  }

  const save = async () => {
    setSaving(true)

    // 1. Handle deletions — items in original that are gone from draft
    const originalIds = new Set(tenant.line_items.map(li => li.id))
    const draftIds    = new Set(draft.filter(d => d.id).map(d => d.id!))
    const toDelete    = [...originalIds].filter(id => !draftIds.has(id))
    for (const id of toDelete) await deleteLineItem(id)

    // 2. Update existing + insert new
    for (const item of draft) {
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
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4, padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#f8fafc', color: '#475569', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'border-color 0.15s, color 0.15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#94a3b8'; (e.currentTarget as HTMLElement).style.color = '#0f172a' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLElement).style.color = '#475569' }}
      >
        ✏ Edit breakdown
      </button>
    )
  }

  return (
    <div style={{ marginTop: 10, background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '10px', padding: '14px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Edit line items</div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px 28px', gap: 6, marginBottom: 4 }}>
        {['Category', 'Label', 'Amount', ''].map(h => (
          <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</div>
        ))}
      </div>

      {/* Line item rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {draft.map((item, idx) => (
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
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#94a3b8', pointerEvents: 'none' }}>$</span>
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
              style={{ width: 26, height: 26, border: 'none', borderRadius: '5px', background: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.background = '#fef2f2' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.background = 'none' }}
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
        style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', background: 'none', border: '1px dashed #cbd5e1', borderRadius: '5px', padding: '5px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}
      >
        + Add line item
      </button>

      {/* Sum + total */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
        {/* Auto-sum row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Sum of line items</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(lineSum)}</span>
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
              style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: `1.5px solid ${totalMode === mode ? '#0f172a' : '#e2e8f0'}`, background: totalMode === mode ? '#0f172a' : '#fff', color: totalMode === mode ? '#fff' : '#64748b', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
            >
              {mode === 'sum' ? 'Use sum' : 'Custom total'}
            </button>
          ))}
        </div>

        {totalMode === 'custom' ? (
          <div>
            <label style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Monthly total ($)</label>
            <input
              style={{ ...iS2, width: '100%', fontWeight: 700 }}
              type="number" min={0} step="0.01"
              value={totalOverride}
              onChange={e => setTotalOverride(e.target.value)}
            />
            {mismatch && (
              <div style={{ marginTop: 5, fontSize: '11px', color: '#d97706' }}>
                ⚠ Total ({fmtCurrency(finalTotal)}) differs from sum ({fmtCurrency(lineSum)}) by {fmtCurrency(Math.abs(finalTotal - lineSum))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: '#f1f5f9', borderRadius: '7px', padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Monthly total</span>
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{fmtCurrency(finalTotal)}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={save} disabled={saving}
          style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: saving ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={cancel}
          style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
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
    padding: '8px 11px', fontSize: '13px', border: '1.5px solid #e2e8f0', borderRadius: '8px',
    outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0f172a',
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
        style={{ marginTop: 12, width: '100%', padding: '8px 0', border: '1.5px dashed #cbd5e1', borderRadius: '8px', background: 'none', color: '#64748b', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'border-color 0.15s, color 0.15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#94a3b8'; (e.currentTarget as HTMLElement).style.color = '#0f172a' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#cbd5e1'; (e.currentTarget as HTMLElement).style.color = '#64748b' }}
      >
        ✏ Edit rent amount
      </button>
    )
  }

  return (
    <div style={{ marginTop: 12, background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>Update rent for entire lease</div>

      {/* New amount */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>New monthly amount ($)</label>
        <input
          style={{ ...iS, width: '100%', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}
          type="number" min={0} step="0.01"
          value={newAmt}
          onChange={e => setNewAmt(e.target.value)}
        />
        {changed && (
          <div style={{ marginTop: 5, fontSize: '11px', color: parsedAmt > tenant.monthly_total ? '#059669' : '#d97706', fontWeight: 600 }}>
            {parsedAmt > tenant.monthly_total
              ? `↑ Increase of ${fmtCurrency(parsedAmt - tenant.monthly_total)}/mo from current ${fmtCurrency(tenant.monthly_total)}`
              : `↓ Decrease of ${fmtCurrency(tenant.monthly_total - parsedAmt)}/mo from current ${fmtCurrency(tenant.monthly_total)}`}
          </div>
        )}
      </div>

      {/* Apply to */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Apply to</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            { value: 'unpaid', label: 'Unpaid payments only', sub: `${unpaidCount} pending or late payment${unpaidCount !== 1 ? 's' : ''}` },
            { value: 'all',    label: 'All payments (entire lease)', sub: `${allCount} total payment${allCount !== 1 ? 's' : ''}, including already-paid` },
          ] as const).map(opt => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', borderRadius: '8px', border: `1.5px solid ${applyTo === opt.value ? '#0f172a' : '#e2e8f0'}`, background: applyTo === opt.value ? '#f1f5f9' : '#fff', cursor: 'pointer' }}
            >
              <input
                type="radio" name={`applyTo-${tenant.id}`} value={opt.value}
                checked={applyTo === opt.value}
                onChange={() => setApplyTo(opt.value)}
                style={{ marginTop: 2, accentColor: '#0f172a', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{opt.label}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 1 }}>{opt.sub}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Preview */}
      {changed && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '7px', padding: '9px 12px', marginBottom: 12, fontSize: '12px', color: '#1d4ed8' }}>
          Will update <strong>{preview} payment{preview !== 1 ? 's' : ''}</strong> to <strong>{fmtCurrency(parsedAmt)}/mo</strong>
        </div>
      )}

      {saved && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', padding: '9px 12px', marginBottom: 12, fontSize: '12px', color: '#166534', fontWeight: 600 }}>
          ✓ Updated successfully
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={save} disabled={saving || !changed || saved}
          style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: saving || !changed ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: (saving || !changed) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Saving…' : `Update ${preview} payment${preview !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={() => { setOpen(false); setNewAmt(String(tenant.monthly_total)) }}
          style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
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
  sp, multiTenant, onUpdate, onRemind,
}: {
  sp: SpecialPayment
  multiTenant: boolean
  onUpdate: (id: string, updates: Parameters<typeof updateSpecialPaymentFull>[1]) => Promise<void>
  /** Email the tenant about this charge. Absent once it's settled or waived. */
  onRemind?: (sp: SpecialPayment) => void
}) {
  const [mode,     setMode]     = useState<SpecialMode>('view')
  const [saving,   setSaving]   = useState(false)

  // edit fields
  const [category, setCategory] = useState(sp.category)
  const [label,    setLabel]    = useState(sp.label)
  const [amount,   setAmount]   = useState(String(sp.amount))
  const [dueDate,  setDueDate]  = useState(sp.due_date)
  const [status,   setStatus]   = useState<'pending' | 'paid' | 'waived'>(sp.status)
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

  const iS: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e2e8f0',
    borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif",
    background: '#fff', color: '#0f172a', boxSizing: 'border-box',
  }

  // ── VIEW mode ──
  if (mode === 'view') {
    return (
      <div style={{ background: '#fff', borderRadius: '11px', border: `1px solid ${isOverdueCharge ? '#fca5a5' : '#e2e8f0'}`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{sp.label}</span>
            <span style={{ background: '#f1f5f9', color: '#475569', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{catLabel(sp.category)}</span>
            {sp.tenant && <span style={{ fontSize: '12px', color: '#94a3b8' }}>→ {sp.tenant.name}</span>}
            {!sp.tenant && multiTenant && <span style={{ fontSize: '12px', color: '#94a3b8' }}>→ All tenants</span>}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Due {fmtDate(sp.due_date)}
            {sp.paid_date && ` · Paid ${fmtDate(sp.paid_date)}`}
            {sp.notes && ` · ${sp.notes}`}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{fmtCurrency(sp.amount)}</div>
          <StatusBadge status={sp.status} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button
            onClick={openEdit}
            style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
          >
            ✏ Edit
          </button>
          {sp.status !== 'paid' && onRemind && (
            <button
              onClick={() => onRemind(sp)}
              title={sp.reminder_sent_at
                ? `Last requested ${new Date(sp.reminder_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : 'Email this tenant a request for this charge'}
              style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
            >
              ✉ {sp.reminder_sent_at ? `Request again (${sp.reminder_count ?? 1})` : 'Send request'}
            </button>
          )}
          {sp.status !== 'paid' && (
            <>
              <button
                onClick={() => onUpdate(sp.id, { status: 'paid', paid_date: new Date().toISOString().split('T')[0] })}
                style={{ padding: '6px 12px', borderRadius: '7px', border: 'none', background: '#0f172a', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                Mark paid
              </button>
              <button
                onClick={() => onUpdate(sp.id, { status: 'waived' })}
                style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                Waive
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── EDIT mode ──
  if (mode === 'edit') {
    return (
      <div style={{ background: '#fff', borderRadius: '11px', border: '1.5px solid #0f172a', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Edit charge</span>
          <button onClick={() => setMode('view')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Type</label>
            <select style={iS} value={category} onChange={e => {
              const cat = SPECIAL_CATEGORIES.find(c => c.value === e.target.value)
              setCategory(e.target.value as typeof category)
              if (cat) setLabel(cat.label)
            }}>
              {SPECIAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Label</label>
            <input style={iS} value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Amount ($)</label>
            <input style={iS} type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Status</label>
            <select style={iS} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Due date</label>
            <input style={iS} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Paid date</label>
            <input style={iS} type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} disabled={status !== 'paid'} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Notes</label>
            <input style={iS} value={notes} placeholder="Optional note" onChange={e => setNotes(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => changes.length > 0 ? setMode('confirm') : setMode('view')}
            disabled={!parsedAmt || !dueDate}
            style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: (!parsedAmt || !dueDate) ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: (!parsedAmt || !dueDate) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          >
            {changes.length === 0 ? 'No changes' : `Review ${changes.length} change${changes.length !== 1 ? 's' : ''} →`}
          </button>
          <button onClick={() => setMode('view')} style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── CONFIRM mode ──
  return (
    <div style={{ background: '#fff', borderRadius: '11px', border: '1.5px solid #0f172a', padding: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Confirm changes</div>
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: 14 }}>Review before saving — this cannot be undone.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {changes.map(ch => (
          <div key={ch.field} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 14px 1fr', gap: 8, alignItems: 'center', background: '#f8fafc', borderRadius: '7px', padding: '8px 10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{ch.field}</span>
            <span style={{ fontSize: '12px', color: '#64748b', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.from}</span>
            <span style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>→</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.to}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={confirm} disabled={saving}
          style={{ flex: 1, padding: '8px 0', borderRadius: '7px', border: 'none', background: saving ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          {saving ? 'Saving…' : 'Confirm & save'}
        </button>
        <button onClick={() => setMode('edit')} style={{ padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
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

  const iS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e2e8f0', borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0f172a', boxSizing: 'border-box' }

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
        <button onClick={() => setOpen(true)} style={{ padding: '9px 16px', border: '1.5px dashed #cbd5e1', borderRadius: '9px', background: 'none', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
          + Add charge
        </button>
      ) : (
        <div style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '18px 20px', background: '#f8fafc' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: 14 }}>New charge</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>TYPE</label>
              <select style={iS} value={category} onChange={e => { setCategory(e.target.value as SpecialCategory); setLabel(SPECIAL_CATEGORIES.find(c => c.value === e.target.value)?.label ?? label) }}>
                {SPECIAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>LABEL</label>
              <input style={iS} value={label} onChange={e => setLabel(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>AMOUNT ($)</label>
              <input style={iS} type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <input style={iS} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            {tenants.length > 1 && (
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>APPLIES TO</label>
                <select style={iS} value={tenantId ?? ''} onChange={e => setTenantId(e.target.value || undefined)}>
                  <option value="">All tenants</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ gridColumn: tenants.length > 1 ? 'auto' : '1/-1' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>NOTES</label>
              <input style={iS} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving || !amount || !dueDate} style={{ padding: '7px 16px', borderRadius: '7px', border: 'none', background: saving ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              {saving ? 'Saving…' : 'Add charge'}
            </button>
            <button onClick={() => setOpen(false)} style={{ padding: '7px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
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
  if (evaluable.length === 0) return { score: null, grade: 'No history', color: '#94a3b8', label: 'N/A' }

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
  if (score >= 92) { grade = 'Excellent'; color = '#16a34a'; label = 'A+' }
  else if (score >= 85) { grade = 'Great';      color = '#059669'; label = 'A'  }
  else if (score >= 75) { grade = 'Good';       color = '#0284c7'; label = 'B'  }
  else if (score >= 60) { grade = 'Fair';       color = '#d97706'; label = 'C'  }
  else if (score >= 40) { grade = 'Poor';       color = '#dc2626'; label = 'D'  }
  else                  { grade = 'Critical';   color = '#991b1b'; label = 'F'  }

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
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 18px', flex: '1 1 140px', minWidth: 0 }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: accent, letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: 4 }}>{sub}</div>
    </div>
  )

  const TABLE_COLS = '90px 90px 1fr 90px 90px 70px 90px'

  return (
    <div>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <button
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff', color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
        >
          ← Tenants
        </button>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
          {tenant.name[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.3px' }}>{tenant.name}</div>
          {tenant.email && <div style={{ fontSize: '12px', color: '#64748b' }}>{tenant.email}</div>}
        </div>
      </div>

      {/* Snapshot + Rating */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'stretch' }}>

        {/* Metric cards */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
          {statCard('Collected', fmtCurrency(totalCollected), `of ${fmtCurrency(totalExpectedPast)} billed`, '#0f172a', '#f8fafc')}
          {statCard(
            'Currently Owed',
            fmtCurrency(totalOwedNow),
            lateFeesPending > 0
              ? `${fmtCurrency(rentOwedNow)} rent + ${fmtCurrency(lateFeesPending)} fees`
              : `${overdue.length + missed.length} payment${(overdue.length + missed.length) !== 1 ? 's' : ''} past due`,
            totalOwedNow > 0 ? '#dc2626' : '#0f172a', '#fff'
          )}
          {statCard('Upcoming', fmtCurrency(totalUpcoming), `${upcoming.length} payment${upcoming.length !== 1 ? 's' : ''} scheduled`, '#0284c7', '#fff')}
          {statCard('Late Fees Owed', fmtCurrency(lateFeesPending), lateFeesCollected > 0 ? `${fmtCurrency(lateFeesCollected)} already collected` : 'none collected yet', lateFeesPending > 0 ? '#c2410c' : '#0f172a', '#fff')}
          {statCard('Days Late Total', String(totalDaysLate), `across ${sps.length} payment${sps.length !== 1 ? 's' : ''}`, totalDaysLate > 0 ? '#d97706' : '#0f172a', '#fff')}
        </div>

        {/* Rating card */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 22px', minWidth: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Payment Rating</div>

          {/* Arc gauge */}
          <div style={{ position: 'relative', width: 92, height: 92, marginBottom: 8 }}>
            <svg width="92" height="92" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f1f5f9" strokeWidth="8" />
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
              {rating.score !== null && <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>/100</div>}
            </div>
          </div>

          <div style={{ fontSize: '14px', fontWeight: 700, color: rating.color }}>{rating.grade}</div>

          {/* Mini breakdown */}
          {rating.score !== null && 'onTime' in rating && (
            <div style={{ marginTop: 10, width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                { label: 'On time',   value: rating.onTime,   color: '#16a34a' },
                { label: 'Late',      value: rating.latePaid, color: '#d97706' },
                { label: 'Overdue',   value: rating.overdue,  color: '#ef4444' },
                { label: 'Missed',    value: rating.missed,   color: '#9d174d' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                  <span style={{ color: '#64748b' }}>{row.label}</span>
                  <span style={{ fontWeight: 700, color: row.value > 0 ? row.color : '#cbd5e1' }}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment history table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '13px', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Payment History</div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>{sps.length} total · {paid.length} paid · {overdue.length + missed.length} outstanding</div>
        </div>

        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '8px 18px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
          {['Month', 'Due Date', 'Period', 'Expected', 'Collected', 'Days Late', 'Late Fee'].map((h, i) => (
            <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
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
              <div style={{ padding: '7px 18px', background: '#fafafa', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569' }}>{fmtMonth(monthKey + '-01')}</span>
                {allPaid && !anyLate && <span style={{ fontSize: '10px', background: '#dcfce7', color: '#166534', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>All on time ✓</span>}
                {allPaid && anyLate  && <span style={{ fontSize: '10px', background: '#fef9c3', color: '#92400e', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>Paid late</span>}
                {monthBalanceDue > 0 && (
                  <span style={{ fontSize: '10px', background: '#fee2e2', color: '#991b1b', padding: '1px 7px', borderRadius: '10px', fontWeight: 700 }}>
                    Balance due: {fmtCurrency(monthBalanceDue)}{monthLateFees > 0 ? ` (incl. ${fmtCurrency(monthLateFees)} fees)` : ''}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#94a3b8' }}>{fmtCurrency(monthPaid)} / {fmtCurrency(monthExpected)}</span>
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
                    style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '10px 18px', borderBottom: '1px solid #f8fafc', alignItems: 'center', background: isOverdue(sp) ? '#fefefe' : '#fff' }}
                  >
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{new Date(sp.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
                    <div style={{ fontSize: '12px', color: '#475569' }}>{fmtDate(sp.due_date)}</div>
                    <div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: stCfg.bg, color: stCfg.color, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: stCfg.dot, flexShrink: 0 }} />{stCfg.label}
                      </span>
                      {sp.paid_date && <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: 6 }}>paid {fmtDate(sp.paid_date)}</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {lfDisp > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>{fmtCurrency(sp.amount)} rent</span>
                          <span style={{ fontSize: '11px', color: '#c2410c' }}>+{fmtCurrency(lfDisp)} fee</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: lfUncollected > 0 ? '#dc2626' : '#16a34a' }}>{fmtCurrency(sp.amount + lfDisp)}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{fmtCurrency(sp.amount)}</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {sp.paid_amount > 0 ? (
                        <span style={{ fontSize: '13px', fontWeight: 700, color: shortfall > 0.01 ? '#d97706' : '#16a34a' }}>{fmtCurrency(sp.paid_amount)}</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {dlDisp > 0
                        ? <span style={{ fontSize: '11px', fontWeight: 700, color: sp.paid_date ? '#d97706' : '#ef4444', background: sp.paid_date ? '#fff7ed' : '#fef2f2', padding: '2px 6px', borderRadius: '5px' }}>{dlDisp}d</span>
                        : <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {lfDisp > 0 ? (
                        lfUncollected > 0
                          ? <span style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', padding: '2px 6px', borderRadius: '5px' }}>🚩 {fmtCurrency(lfUncollected)}</span>
                          : <span style={{ fontSize: '11px', fontWeight: 700, color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '5px' }}>✓ {fmtCurrency(lfDisp)}</span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Totals footer */}
        <div style={{ borderTop: '2px solid #e2e8f0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '12px 18px', background: '#f8fafc' }}>
            <div style={{ gridColumn: '1 / 4', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>Totals</div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(sps.reduce((s, sp) => s + sp.amount, 0))}</div>
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 700, color: totalCollected > 0 ? '#16a34a' : '#cbd5e1' }}>{fmtCurrency(totalCollected)}</div>
            <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: totalDaysLate > 0 ? '#d97706' : '#cbd5e1' }}>{totalDaysLate}d</div>
            <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 700, color: lateFeesPending > 0 ? '#c2410c' : '#cbd5e1' }}>{lateFeesPending > 0 ? `🚩 ${fmtCurrency(lateFeesPending)}` : '—'}</div>
          </div>
          {totalOwedNow > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: TABLE_COLS, gap: 8, padding: '10px 18px', background: '#fef2f2', borderTop: '1px solid #fca5a5' }}>
              <div style={{ gridColumn: '1 / 4', fontSize: '12px', fontWeight: 700, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span> Balance Due
                {lateFeesPending > 0 && <span style={{ fontSize: '11px', fontWeight: 500, color: '#b91c1c' }}>({fmtCurrency(rentOwedNow)} rent + {fmtCurrency(lateFeesPending)} fees)</span>}
              </div>
              <div style={{ gridColumn: '4 / 5', textAlign: 'right', fontSize: '15px', fontWeight: 800, color: '#dc2626' }}>{fmtCurrency(totalOwedNow)}</div>
              <div style={{ gridColumn: '5 / -1' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

/**
 * The rent ledger for one payment plan: schedule, payers and special charges.
 *
 * Rendered two ways — standalone at /landlord/payments/[planId], and embedded in
 * the Payments tab of a lease. When embedded the page chrome (breadcrumb, title
 * block, full-height background) is dropped, because the lease hub already
 * supplies all of it; only the money itself is shown.
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

  const load = () => {
    setLoading(true)
    getPlanById(planId).then(p => { setPlan(p); setLoading(false) })
  }

  useEffect(() => {
    if (!embedded) document.title = 'Payment Plan — Landlord | HomeHive'
  }, [embedded])

  useEffect(() => { load() }, [planId])

  const handleUpdateScheduled = async (id: string, updates: Parameters<typeof updateScheduledPayment>[1]) => {
    await updateScheduledPayment(id, updates)
    // Refresh just the scheduled_payments without full reload for responsiveness
    setPlan(prev => prev ? {
      ...prev,
      scheduled_payments: prev.scheduled_payments?.map(sp =>
        sp.id === id ? { ...sp, ...updates } : sp
      ),
    } : prev)
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
      <div style={{ minHeight: embedded ? '160px' : '100vh', background: embedded ? 'transparent' : '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '14px', color: '#64748b' }}>Loading…</div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div style={{ minHeight: embedded ? '160px' : '100vh', background: embedded ? 'transparent' : '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>Plan not found</div>
          <a href="/landlord/financials" style={{ display: 'inline-block', marginTop: 16, color: '#64748b', fontSize: '13px' }}>← Back to financials</a>
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
  const totalExpected = thisMonthSPs.reduce((s, p) => s + p.amount, 0)
  const totalPaid     = thisMonthSPs.filter(p => p.status === 'paid').reduce((s, p) => s + p.paid_amount, 0)
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
    <div style={{ minHeight: embedded ? undefined : '100vh', background: embedded ? 'transparent' : '#f0f4f8', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,wght@0,300;1,300&display=swap'); input:focus,select:focus{border-color:#0f172a!important;}`}</style>

      {/* Header */}
      <div style={{ background: embedded ? 'transparent' : '#fff', borderBottom: embedded ? 'none' : '1px solid #e2e8f0' }}>
        {!embedded && (
          <div style={{ padding: '16px 28px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid #f1f5f9' }}>
            <a href="/landlord/financials" style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}>← Financials</a>
            <span style={{ color: '#cbd5e1' }}>/</span>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{plan.name}</span>
            {plan.lease_id && (
              <>
                <span style={{ color: '#cbd5e1' }}>·</span>
                <a href={`/landlord/leases/${plan.lease_id}`} style={{ color: '#10b981', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>
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
                <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{plan.property?.name ?? plan.name}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{plan.name}</span>
                  {plan.lease && (
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                      {fmtDate(plan.lease.start_date)} – {fmtDate(plan.lease.end_date)}
                    </span>
                  )}
                  <span style={{ fontSize: '13px', color: '#64748b' }}>Due {fmtOrdinal(plan.due_day)} of month</span>
                </div>
              </div>

              {/* Summary pills */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(totalMonthly)}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>monthly total</div>
                </div>
                <div style={{ width: '1px', background: '#e2e8f0' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: overdueSPs.length > 0 ? '#ef4444' : '#0f172a' }}>{overdueSPs.length}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>overdue</div>
                </div>
                <div style={{ width: '1px', background: '#e2e8f0' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981' }}>{fmtCurrency(totalPaid)}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>this month</div>
                </div>
              </div>
            </div>
          )}

          {/* Collect this month's rent — the everyday action, not just chasing arrears */}
          {requestableSPs.length > 0 && (
            <div style={{ marginTop: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#065f46', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
                style={{ background: '#065f46', color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                ✉ Send rent requests
              </button>
            </div>
          )}

          {/* Warnings — and the action a landlord actually wants here */}
          {overdueSPs.length > 0 && (
            <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#991b1b', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>⚠️</span>
              <span style={{ flex: 1, minWidth: 200 }}>
                <strong>{overdueSPs.length} payment{overdueSPs.length !== 1 ? 's' : ''}</strong> past due
                {' '}({fmtCurrency(overdueSPs.reduce((s, p) => s + (p.amount - p.paid_amount), 0))})
                {' '}— click any row to mark as paid, or send a reminder.
              </span>
              <button
                onClick={() => setRemindTarget({ ids: overdueSPs.map(p => p.id), label: `${overdueSPs.length} overdue payment${overdueSPs.length !== 1 ? 's' : ''}` })}
                style={{ background: '#991b1b', color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                ✉ Send reminders
              </button>
            </div>
          )}

          {amountMismatch && (
            <div style={{ marginTop: 10, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#c2410c', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠</span>
              <span>Payer totals ({fmtCurrency(totalMonthly)}) don't match lease rent ({fmtCurrency(leaseRent)}). Difference: {fmtCurrency(Math.abs(totalMonthly - leaseRent))}.</span>
            </div>
          )}

          {/* Late fee info */}
          {plan.late_fee_rule && (
            <div style={{ marginTop: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '9px', padding: '10px 16px', fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: 8 }}>
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
        <div style={{ display: 'flex', gap: 0, paddingLeft: embedded ? 0 : 28, borderTop: embedded ? 'none' : '1px solid #f1f5f9', borderBottom: embedded ? '1px solid #e2e8f0' : 'none', marginTop: embedded ? 4 : 0 }}>
          {(['schedule', 'tenants', 'charges'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: tab === t ? 700 : 500,
                color: tab === t ? '#0f172a' : '#64748b',
                borderBottom: `2px solid ${tab === t ? '#0f172a' : 'transparent'}`,
                fontFamily: "'DM Sans', sans-serif", transition: 'color 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {t === 'charges' ? `Special Charges${specials.length ? ` (${specials.length})` : ''}` : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'schedule' && overdueSPs.length > 0 && (
                <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px' }}>{overdueSPs.length}</span>
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
              <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>No payments in schedule.</div>
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
                        <MonthGroup key={k} month={k + '-01'} payments={byMonth[k]} rule={plan.late_fee_rule} onUpdate={handleUpdateScheduled} onRemind={remindOne} defaultOpen={k === currentMonthKey} />
                      ))}
                      {past.length > 0 && (
                        <details style={{ marginTop: 12 }}>
                          <summary style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', cursor: 'pointer', padding: '8px 4px', userSelect: 'none' }}>
                            {past.length} past month{past.length !== 1 ? 's' : ''} (click to expand)
                          </summary>
                          <div style={{ marginTop: 8, opacity: 0.7 }}>
                            {past.slice().reverse().map(k => (
                              <MonthGroup key={k} month={k + '-01'} payments={byMonth[k]} rule={plan.late_fee_rule} onUpdate={handleUpdateScheduled} onRemind={remindOne} defaultOpen={false} />
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {plan.tenants.map(t => {
              const tenantSPs     = sps.filter(sp => sp.plan_tenant_id === t.id)
              const tenantOverdue = tenantSPs.filter(p => isOverdue(p)).length
              const tenantPaid    = tenantSPs.filter(p => p.status === 'paid').length
              const rating        = computeTenantRating(tenantSPs)
              return (
                <div key={t.id} style={{ background: '#fff', borderRadius: '13px', border: tenantOverdue > 0 ? '1.5px solid #fca5a5' : '1px solid #e2e8f0', padding: '20px 22px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                  onClick={() => setSelectedTenantId(t.id)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
                      {t.name[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{t.name}</div>
                      {t.email && <div style={{ fontSize: '12px', color: '#64748b' }}>{t.email}</div>}
                    </div>
                  </div>

                  {/* Line items */}
                  <div style={{ marginBottom: 10 }}>
                    {t.line_items.map(li => (
                      <div key={li.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f8fafc' }}>
                        <span style={{ fontSize: '13px', color: '#475569' }}>{li.label}</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{fmtCurrency(li.amount)}</span>
                      </div>
                    ))}
                    {t.line_items.length > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>Sum</span>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{fmtCurrency(t.line_items.reduce((s, li) => s + li.amount, 0))}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Monthly total</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {t.line_items.length > 0 && Math.abs(t.line_items.reduce((s, li) => s + li.amount, 0) - t.monthly_total) > 0.005 && (
                          <span style={{ fontSize: '10px', color: '#d97706', background: '#fff7ed', border: '1px solid #fed7aa', padding: '1px 6px', borderRadius: '4px' }}>custom</span>
                        )}
                        <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(t.monthly_total)}</span>
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
                  <div style={{ display: 'flex', gap: 10, background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', marginBottom: 10, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>{tenantPaid}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Paid</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: tenantOverdue > 0 ? '#ef4444' : '#94a3b8' }}>{tenantOverdue}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Overdue</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{tenantSPs.length}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Total</div>
                    </div>
                    <div style={{ width: '1px', background: '#e2e8f0', alignSelf: 'stretch' }} />
                    <div style={{ textAlign: 'center', paddingLeft: 4 }}>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: rating.color }}>{rating.score ?? '—'}</div>
                      <div style={{ fontSize: '10px', color: rating.color, fontWeight: 600 }}>{rating.label}</div>
                    </div>
                  </div>

                  {/* View payments link */}
                  <div style={{ textAlign: 'right', marginBottom: 8 }}>
                    <span style={{ fontSize: '12px', color: '#0284c7', fontWeight: 600, cursor: 'pointer' }}>
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
        )}

        {/* ── SPECIAL CHARGES TAB ── */}
        {tab === 'charges' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>Special Charges</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Security deposits, one-time fees, and penalties</div>
              </div>
              <AddChargeForm planId={planId} tenants={plan.tenants} onAdded={load} />
            </div>

            {specials.length === 0 ? (
              <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>No special charges. Use the button above to add one.</div>
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
                    />
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
          background: remindResult.ok ? '#065f46' : '#991b1b', color: '#fff',
          padding: '12px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif", boxShadow: '0 8px 30px rgba(15,23,42,0.25)',
        }}>
          {remindResult.text}
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
              <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                  {onlyCharges ? 'Send payment request' : 'Send rent reminder'}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  Covering {remindTarget.label} · one email per tenant
                </div>
              </div>

              <div style={{ padding: '16px 20px' }}>
                {lastReminded && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#92400e', marginBottom: 14, lineHeight: 1.5 }}>
                    Last {onlyCharges ? 'requested' : 'reminded'} {new Date(lastReminded).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
                    Chasing too often tends to get filtered.
                  </div>
                )}

                {unassignedCharges.length > 0 && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#991b1b', marginBottom: 14, lineHeight: 1.5 }}>
                    {unassignedCharges.length === 1 ? 'One charge is' : `${unassignedCharges.length} charges are`} not assigned to a tenant
                    and will be skipped — open the charge and pick who owes it.
                  </div>
                )}

                {people.map(p => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: p.email ? '#94a3b8' : '#b45309' }}>
                        {p.email ?? 'No email on file — will be skipped'}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {fmtCurrency(p.total)}
                      <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: '#94a3b8', textAlign: 'right' }}>
                        {p.count} charge{p.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 14 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>
                    Add a note (optional)
                  </label>
                  <textarea
                    value={remindMsg}
                    onChange={e => setRemindMsg(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Happy to set up a payment plan if that helps — just let me know."
                    style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical', outline: 'none', color: '#0f172a' }}
                  />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    The email shows the amount, each {onlyCharges ? 'item' : 'charge'}, how late it is, and a button to pay online.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 20px', borderTop: '1px solid #f1f5f9' }}>
                <button
                  onClick={() => setRemindTarget(null)}
                  disabled={reminding}
                  style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  Cancel
                </button>
                <button
                  onClick={sendReminders}
                  disabled={reminding || withEmail.length === 0}
                  style={{ background: '#0f172a', color: '#34d399', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: withEmail.length === 0 ? 'not-allowed' : 'pointer', opacity: withEmail.length === 0 ? 0.5 : 1, fontFamily: "'DM Sans', sans-serif" }}
                >
                  {reminding ? 'Sending…' : `Send to ${withEmail.length} tenant${withEmail.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
