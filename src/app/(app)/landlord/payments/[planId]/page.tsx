'use client'

import { useEffect, useState, use } from 'react'
import {
  getPlanById, updateScheduledPayment, updateSpecialPayment, addSpecialPayment,
  getEffectiveStatus, isOverdue, computeLateFees, daysLate,
  fmtCurrency, fmtDate, fmtMonth, fmtOrdinal,
  LINE_ITEM_CATEGORIES, SPECIAL_CATEGORIES,
  type PaymentPlan, type ScheduledPayment, type SpecialPayment, type PaymentStatus, type SpecialCategory,
} from '@/lib/payments'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Tab = 'schedule' | 'tenants' | 'charges'

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { bg: string; color: string; label: string; dot: string }> = {
  paid:    { bg: '#dcfce7', color: '#166534', label: 'Paid',    dot: '#16a34a' },
  partial: { bg: '#fef9c3', color: '#92400e', label: 'Partial', dot: '#d97706' },
  pending: { bg: '#f1f5f9', color: '#475569', label: 'Pending', dot: '#94a3b8' },
  late:    { bg: '#fee2e2', color: '#991b1b', label: 'Late',    dot: '#ef4444' },
  missed:  { bg: '#fce7f3', color: '#9d174d', label: 'Missed',  dot: '#db2777' },
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

function PaymentRow({
  payment, rule, onUpdate,
}: {
  payment: ScheduledPayment
  rule?: { grace_period_days: number; fee_amount: number; frequency_days: number; max_total_fees: number | null } | null
  onUpdate: (id: string, updates: Parameters<typeof updateScheduledPayment>[1]) => void
}) {
  const [open,       setOpen]       = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [paidAmt,    setPaidAmt]    = useState(String(payment.paid_amount || payment.amount))
  const [paidDate,   setPaidDate]   = useState(payment.paid_date ?? new Date().toISOString().split('T')[0])
  const [notes,      setNotes]      = useState(payment.notes ?? '')
  const [newStatus,  setNewStatus]  = useState<PaymentStatus>(payment.status)

  const effStatus  = getEffectiveStatus(payment)
  const dl         = daysLate(payment.due_date)
  const lateFee    = rule && dl > 0 ? computeLateFees(rule, payment.due_date) : 0

  const save = async () => {
    setSaving(true)
    const amt = parseFloat(paidAmt) || 0
    const finalStatus: PaymentStatus = newStatus === 'paid' ? 'paid'
      : newStatus === 'partial' ? 'partial'
      : newStatus === 'missed'  ? 'missed'
      : newStatus === 'late'    ? 'late'
      : newStatus
    await onUpdate(payment.id, {
      status:      finalStatus,
      paid_amount: amt,
      paid_date:   ['paid', 'partial'].includes(finalStatus) ? paidDate : null,
      notes:       notes || undefined,
      ...(lateFee > 0 ? { late_fees_applied: lateFee } : {}),
    })
    setSaving(false)
    setOpen(false)
  }

  const iS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e2e8f0', borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif", background: '#fff', color: '#0f172a', boxSizing: 'border-box' }

  return (
    <div style={{ borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 100px 100px', gap: 8, alignItems: 'center', padding: '12px 16px', cursor: 'pointer', transition: 'background 0.1s' }}
        onClick={() => setOpen(v => !v)}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#fafafa'}
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

        {/* Amount */}
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>
          {fmtCurrency(payment.amount)}
        </div>

        {/* Status */}
        <div style={{ textAlign: 'center' }}>
          <StatusBadge status={effStatus} />
        </div>

        {/* Paid / Late info */}
        <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'right' }}>
          {payment.paid_date ? fmtDate(payment.paid_date) : dl > 0 ? <span style={{ color: '#ef4444', fontWeight: 600 }}>{dl}d late</span> : '—'}
        </div>

        {/* Accrued late fee */}
        <div style={{ fontSize: '12px', textAlign: 'right' }}>
          {lateFee > 0 ? <span style={{ color: '#ef4444', fontWeight: 600 }}>+{fmtCurrency(lateFee)}</span> : <span style={{ color: '#cbd5e1' }}>—</span>}
        </div>
      </div>

      {/* Inline expand */}
      {open && (
        <div style={{ background: '#f8fafc', borderTop: '1px solid #f1f5f9', padding: '16px 16px 18px', borderLeft: '3px solid #0f172a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
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
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>PAID AMOUNT</label>
              <input style={iS} type="number" step="0.01" value={paidAmt} onChange={e => setPaidAmt(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>DATE PAID</label>
              <input style={iS} type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>NOTES (optional)</label>
            <input style={iS} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid via Zelle" />
          </div>
          {lateFee > 0 && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '7px', padding: '8px 12px', marginBottom: 12, fontSize: '12px', color: '#c2410c' }}>
              ⚠ Accrued late fee: <strong>{fmtCurrency(lateFee)}</strong> — will be recorded if you save.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', background: saving ? '#94a3b8' : '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              {saving ? 'Saving…' : 'Save'}
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

// ─── MONTH GROUP ──────────────────────────────────────────────────────────────

function MonthGroup({
  month, payments, rule, onUpdate, defaultOpen,
}: {
  month: string
  payments: ScheduledPayment[]
  rule: PaymentPlan['late_fee_rule']
  onUpdate: (id: string, u: Parameters<typeof updateScheduledPayment>[1]) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const paid     = payments.filter(p => p.status === 'paid').length
  const overdue  = payments.filter(p => isOverdue(p)).length
  const expected = payments.reduce((s, p) => s + p.amount, 0)
  const collected = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.paid_amount, 0)

  return (
    <div style={{ marginBottom: 6, border: '1px solid #e2e8f0', borderRadius: '11px', overflow: 'hidden', background: '#fff' }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: open ? '#fff' : '#fafafa' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{fmtMonth(month)}</span>
          {overdue > 0 && <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{overdue} overdue</span>}
          {overdue === 0 && paid === payments.length && <span style={{ background: '#dcfce7', color: '#166534', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>All paid ✓</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {paid}/{payments.length} paid · {fmtCurrency(collected)}/{fmtCurrency(expected)}
          </span>
          <span style={{ fontSize: '11px', color: '#94a3b8', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 100px 100px', gap: 8, padding: '8px 16px', background: '#f8fafc' }}>
            {['Tenant', 'Amount', 'Status', 'Paid Date', 'Late Fee'].map(h => (
              <div key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: h !== 'Tenant' ? 'right' : 'left', ...(h === 'Status' ? { textAlign: 'center' } : {}) }}>
                {h}
              </div>
            ))}
          </div>
          {payments.map(p => (
            <PaymentRow key={p.id} payment={p} rule={rule ?? undefined} onUpdate={onUpdate} />
          ))}
        </div>
      )}
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

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function PlanDetailPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params)
  const [plan,    setPlan]    = useState<PaymentPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<Tab>('schedule')

  const load = () => {
    setLoading(true)
    getPlanById(planId).then(p => { setPlan(p); setLoading(false) })
  }

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

  const handleUpdateSpecial = async (id: string, updates: Parameters<typeof updateSpecialPayment>[1]) => {
    await updateSpecialPayment(id, updates)
    setPlan(prev => prev ? {
      ...prev,
      special_payments: prev.special_payments?.map(sp => sp.id === id ? { ...sp, ...updates } : sp),
    } : prev)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '14px', color: '#64748b' }}>Loading…</div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>Plan not found</div>
          <a href="/landlord/payments" style={{ display: 'inline-block', marginTop: 16, color: '#64748b', fontSize: '13px' }}>← Back to payments</a>
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
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,wght@0,300;1,300&display=swap'); input:focus,select:focus{border-color:#0f172a!important;}`}</style>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ padding: '16px 28px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid #f1f5f9' }}>
          <a href="/landlord/payments" style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}>← Payments</a>
          <span style={{ color: '#cbd5e1' }}>/</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{plan.name}</span>
        </div>

        <div style={{ padding: '20px 28px' }}>
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

          {/* Warnings */}
          {overdueSPs.length > 0 && (
            <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠️</span>
              <span><strong>{overdueSPs.length} payment{overdueSPs.length !== 1 ? 's' : ''}</strong> past due — click any row to mark as paid or update status.</span>
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
        <div style={{ display: 'flex', gap: 0, paddingLeft: 28, borderTop: '1px solid #f1f5f9' }}>
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
      <div style={{ maxWidth: 1050, margin: '0 auto', padding: '24px 20px' }}>

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
                        <MonthGroup key={k} month={k + '-01'} payments={byMonth[k]} rule={plan.late_fee_rule} onUpdate={handleUpdateScheduled} defaultOpen={k === currentMonthKey} />
                      ))}
                      {past.length > 0 && (
                        <details style={{ marginTop: 12 }}>
                          <summary style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', cursor: 'pointer', padding: '8px 4px', userSelect: 'none' }}>
                            {past.length} past month{past.length !== 1 ? 's' : ''} (click to expand)
                          </summary>
                          <div style={{ marginTop: 8, opacity: 0.7 }}>
                            {past.slice().reverse().map(k => (
                              <MonthGroup key={k} month={k + '-01'} payments={byMonth[k]} rule={plan.late_fee_rule} onUpdate={handleUpdateScheduled} defaultOpen={false} />
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
        {tab === 'tenants' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {plan.tenants.map(t => {
              const tenantSPs    = sps.filter(sp => sp.plan_tenant_id === t.id)
              const tenantOverdue = tenantSPs.filter(p => isOverdue(p)).length
              const tenantPaid   = tenantSPs.filter(p => p.status === 'paid').length
              return (
                <div key={t.id} style={{ background: '#fff', borderRadius: '13px', border: tenantOverdue > 0 ? '1.5px solid #fca5a5' : '1px solid #e2e8f0', padding: '20px 22px' }}>
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
                  <div style={{ marginBottom: 14 }}>
                    {t.line_items.map(li => (
                      <div key={li.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f8fafc' }}>
                        <span style={{ fontSize: '13px', color: '#475569' }}>{li.label}</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{fmtCurrency(li.amount)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Monthly total</span>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(t.monthly_total)}</span>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div style={{ display: 'flex', gap: 14, background: '#f8fafc', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#10b981' }}>{tenantPaid}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Paid</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: tenantOverdue > 0 ? '#ef4444' : '#94a3b8' }}>{tenantOverdue}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Overdue</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{tenantSPs.length}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Total</div>
                    </div>
                  </div>
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
                {/* Security deposits first */}
                {specials
                  .slice()
                  .sort((a, b) => {
                    if (a.category === 'security_deposit' && b.category !== 'security_deposit') return -1
                    if (b.category === 'security_deposit' && a.category !== 'security_deposit') return 1
                    return a.due_date.localeCompare(b.due_date)
                  })
                  .map(sp => {
                    const catLabel = SPECIAL_CATEGORIES.find(c => c.value === sp.category)?.label ?? sp.category
                    return (
                      <div key={sp.id} style={{ background: '#fff', borderRadius: '11px', border: `1px solid ${sp.status === 'pending' && new Date(sp.due_date + 'T00:00:00') < new Date() ? '#fca5a5' : '#e2e8f0'}`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{sp.label}</span>
                            <span style={{ background: '#f1f5f9', color: '#475569', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px' }}>{catLabel}</span>
                            {sp.tenant && <span style={{ fontSize: '12px', color: '#94a3b8' }}>→ {sp.tenant.name}</span>}
                            {!sp.tenant && plan.tenants.length > 1 && <span style={{ fontSize: '12px', color: '#94a3b8' }}>→ All tenants</span>}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            Due {fmtDate(sp.due_date)}
                            {sp.paid_date && ` · Paid ${fmtDate(sp.paid_date)}`}
                            {sp.notes && ` · ${sp.notes}`}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{fmtCurrency(sp.amount)}</div>
                          <StatusBadge status={sp.status} />
                        </div>
                        {sp.status !== 'paid' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <button
                              onClick={() => handleUpdateSpecial(sp.id, { status: 'paid', paid_date: new Date().toISOString().split('T')[0] })}
                              style={{ padding: '6px 12px', borderRadius: '7px', border: 'none', background: '#0f172a', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
                            >
                              Mark paid
                            </button>
                            <button
                              onClick={() => handleUpdateSpecial(sp.id, { status: 'waived' })}
                              style={{ padding: '6px 12px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
                            >
                              Waive
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
