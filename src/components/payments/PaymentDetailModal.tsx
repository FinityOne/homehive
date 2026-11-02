'use client'

/**
 * One rent charge, opened in full.
 *
 * Two problems this replaces. A ledger row said `$766` and gave no hint that it
 * was `$749 rent + $17 internet` — the composition existed only inside the
 * payer's line items, two screens away. And the editing form was an inline
 * expander, so reading a charge and changing it were the same gesture, in a
 * strip squeezed under a table row.
 *
 * So: click a line, get the charge. What it is made of, what it has accrued,
 * what actually arrived, how it was paid, who was chased about it — and the
 * controls to record a payment, in that order. One disclosure, not two.
 *
 * The breakdown is shown only when it is *true* of this charge. A payer's line
 * items describe what they owe each month **now**; a prorated first month or a
 * rent change means this row was never that sum. Rather than itemising a figure
 * that would not add up, the modal says the amount was set directly and shows
 * the current monthly composition separately, clearly labelled as current.
 */
import { useEffect, useState } from 'react'
import {
  updateScheduledPayment, getEffectiveStatus,
  computeLateFees, computeLateFeesByDate, daysLate, daysLateByDate,
  fmtCurrency, fmtDate, fmtMonth,
  type ScheduledPayment, type PaymentStatus, type PaymentPlanTenant,
} from '@/lib/payments'
import PaymentEmailHistory, { type PlanEmail } from './PaymentEmailHistory'
import { type PlanUtility } from '@/lib/utilities'

type Rule = {
  grace_period_days: number
  fee_amount: number
  frequency_days: number
  max_total_fees: number | null
} | null

const INP: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e2e8f0',
  borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif",
  background: '#fff', color: '#0f172a', boxSizing: 'border-box',
}
const LBL: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4,
}
const btnDark: React.CSSProperties = {
  padding: '8px 18px', borderRadius: '7px', border: 'none', background: '#0f172a',
  color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
}
const btnQuiet: React.CSSProperties = {
  padding: '8px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff',
  color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
}

/** A row in the "what is this made of" list. */
function BreakLine({
  label, meta, amount, strong, tone,
}: { label: string; meta?: string; amount: number; strong?: boolean; tone?: 'fee' | 'muted' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: strong ? 700 : 500, color: tone === 'muted' ? '#64748b' : '#0f172a' }}>
          {label}
        </span>
        {meta && <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 8 }}>{meta}</span>}
      </div>
      <span style={{
        fontSize: strong ? '15px' : '13px', fontWeight: strong ? 800 : 700,
        color: tone === 'fee' ? '#c2410c' : '#0f172a', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {tone === 'fee' ? '+' : ''}{fmtCurrency(amount)}
      </span>
    </div>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const color = tone === 'good' ? '#16a34a' : tone === 'bad' ? '#dc2626' : tone === 'warn' ? '#d97706' : '#0f172a'
  return (
    <div style={{ background: '#f8fafc', borderRadius: '9px', padding: '10px 12px' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.45px', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: '14.5px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

export default function PaymentDetailModal({
  payment, tenant, utilities, rule, history = [], onUpdate, onRemind, onResendReceipt, onClose,
}: {
  payment: ScheduledPayment
  /** The payer, for the monthly composition. Undefined if they were removed. */
  tenant?: PaymentPlanTenant
  utilities: PlanUtility[]
  rule: Rule
  history?: PlanEmail[]
  onUpdate: (id: string, updates: Parameters<typeof updateScheduledPayment>[1]) => void
  onRemind?: (p: ScheduledPayment) => void
  onResendReceipt?: (p: ScheduledPayment) => void
  onClose: () => void
}) {
  const [saving, setSaving]   = useState(false)
  const [paidAmt, setPaidAmt] = useState(payment.paid_amount > 0 ? String(payment.paid_amount) : '')
  const [paidDate, setPaidDate] = useState(payment.paid_date ?? new Date().toISOString().split('T')[0])
  const [notes, setNotes]     = useState(payment.notes ?? '')
  const [newStatus, setNewStatus] = useState<PaymentStatus>(payment.status)
  const [dueDate, setDueDate] = useState(payment.due_date)
  const [lateFeeIn, setLateFeeIn] = useState(payment.late_fee_paid > 0 ? String(payment.late_fee_paid) : '')

  // Escape closes, and the page behind must not scroll under the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const effStatus = getEffectiveStatus(payment)
  const isPaidOrPartial = ['paid', 'partial'].includes(newStatus)

  const dlRow = payment.paid_date
    ? daysLateByDate(payment.due_date, payment.paid_date)
    : daysLate(payment.due_date)

  const feeNow = rule
    ? (payment.paid_date
        ? computeLateFeesByDate(rule, payment.due_date, payment.paid_date)
        : (dlRow > 0 ? computeLateFees(rule, payment.due_date) : 0))
    : 0

  // Reactive to the edited due date, so an extension shows its effect before saving.
  const editDl = isPaidOrPartial ? daysLateByDate(dueDate, paidDate) : daysLate(dueDate)
  const editLateFee = rule && editDl > 0
    ? (isPaidOrPartial ? computeLateFeesByDate(rule, dueDate, paidDate) : computeLateFees(rule, dueDate))
    : 0
  const dueDateMoved = dueDate !== payment.due_date
  const feeClearedByMove = dueDateMoved && feeNow > 0 && editLateFee < feeNow ? feeNow - editLateFee : 0

  // ── What this charge is made of ───────────────────────────────────────────
  const items = tenant?.line_items ?? []
  const monthlyTotal = tenant?.monthly_total ?? 0
  // Only itemise when the row really is this month's standing composition.
  const composed = items.length > 0 && Math.abs(payment.amount - monthlyTotal) < 0.01
  const utilityById = new Map(utilities.map(u => [u.id, u]))
  const rentItems = items.filter(i => !i.utility_id)
  const utilItems = items.filter(i => i.utility_id)

  const collected = payment.paid_amount
  const feeCollected = payment.late_fee_paid
  const expected = payment.amount + feeNow
  const received = collected + feeCollected
  const shortfall = Math.round((expected - received) * 100) / 100

  const save = async () => {
    setSaving(true)
    await onUpdate(payment.id, {
      status: newStatus,
      paid_amount: parseFloat(paidAmt) || 0,
      paid_date: isPaidOrPartial ? paidDate : null,
      notes: notes || undefined,
      ...(dueDateMoved ? { due_date: dueDate } : {}),
      late_fees_applied: editLateFee,
      // Recorded deliberately, never inferred: a landlord who collected the fee
      // in cash is the only person who knows that it happened.
      late_fee_paid: parseFloat(lateFeeIn) || 0,
    })
    setSaving(false)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${fmtMonth(payment.due_date)} rent for ${payment.tenant?.name ?? 'tenant'}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 16px', overflowY: 'auto', fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '16px', width: '100%', maxWidth: 620,
          boxShadow: '0 24px 64px rgba(15,23,42,0.28)', overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{ padding: '18px 22px 15px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
              {fmtMonth(payment.due_date)} rent
            </div>
            <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: 3 }}>
              {payment.tenant?.name ?? 'Unknown payer'} · due {fmtDate(payment.due_date)}
              {payment.paid_date && <> · paid {fmtDate(payment.paid_date)}</>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: '22px', lineHeight: 1, color: '#94a3b8', cursor: 'pointer', padding: '0 2px' }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '16px 22px 20px' }}>
          {/* ── The four facts, before any form ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 18 }}>
            <Fact label="Charged" value={fmtCurrency(expected)} />
            <Fact label="Received" value={fmtCurrency(received)} tone={received > 0 ? 'good' : undefined} />
            <Fact
              label={shortfall > 0.01 ? 'Still owed' : 'Balance'}
              value={shortfall > 0.01 ? fmtCurrency(shortfall) : 'Settled'}
              tone={shortfall > 0.01 ? (dlRow > 0 ? 'bad' : 'warn') : 'good'}
            />
            <Fact
              label="Status"
              value={payment.status === 'voided' ? 'Voided' : effStatus === 'paid' ? 'Paid' : effStatus.charAt(0).toUpperCase() + effStatus.slice(1)}
            />
          </div>

          {/* ── Breakdown ── */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', letterSpacing: '0.02em', marginBottom: 6 }}>
              WHAT THIS IS MADE OF
            </div>

            {composed ? (
              <>
                {rentItems.map(i => (
                  <BreakLine key={i.id} label={i.label} amount={i.amount} />
                ))}
                {utilItems.map(i => {
                  const u = i.utility_id ? utilityById.get(i.utility_id) : undefined
                  return (
                    <BreakLine
                      key={i.id}
                      label={i.label}
                      meta={u
                        ? `lease utility · ${u.split === 'even' ? `${fmtCurrency(u.amount)} split` : 'per payer'}`
                        : 'lease utility'}
                      amount={i.amount}
                    />
                  )
                })}
                {feeNow > 0 && (
                  <BreakLine
                    label="Late fee"
                    meta={`${dlRow} day${dlRow !== 1 ? 's' : ''} late`}
                    amount={feeNow}
                    tone="fee"
                  />
                )}
                <BreakLine label="Total charged" amount={expected} strong />
              </>
            ) : (
              <>
                <BreakLine
                  label="Rent charged"
                  meta={items.length > 0 ? 'set directly for this month' : undefined}
                  amount={payment.amount}
                />
                {feeNow > 0 && (
                  <BreakLine label="Late fee" meta={`${dlRow} day${dlRow !== 1 ? 's' : ''} late`} amount={feeNow} tone="fee" />
                )}
                <BreakLine label="Total charged" amount={expected} strong />
                {items.length > 0 && (
                  <div style={{ fontSize: '11.5px', color: '#94a3b8', lineHeight: 1.55, marginTop: 8 }}>
                    This month&apos;s amount differs from {payment.tenant?.name ?? 'this payer'}&apos;s
                    standing total of {fmtCurrency(monthlyTotal)} — a prorated month, or an amount
                    changed by hand — so it is not itemised. Their composition today is{' '}
                    {items.map(i => `${i.label} ${fmtCurrency(i.amount)}`).join(', ')}.
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── How it was paid, when there is anything to say ── */}
          {(payment.payment_method || feeCollected > 0 || payment.settled_at) && (
            <div style={{ marginBottom: 18, background: '#f8fafc', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', letterSpacing: '0.02em', marginBottom: 8 }}>
                HOW IT WAS PAID
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '12.5px', color: '#334155', lineHeight: 1.5 }}>
                {payment.payment_method && (
                  <div>
                    {payment.payment_method === 'card' ? 'Card' :
                     payment.payment_method === 'ach' ? 'Bank transfer (ACH)' :
                     payment.payment_method === 'manual_zelle' ? 'Zelle, confirmed by you' : 'Recorded by you'}
                    {payment.recorded_by === 'tenant' ? ' — paid by the tenant online' : ''}
                  </div>
                )}
                {payment.settled_at && (
                  <div>Settled {new Date(payment.settled_at).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}</div>
                )}
                {feeCollected > 0 && (
                  <div style={{ color: '#15803d', fontWeight: 600 }}>
                    Includes {fmtCurrency(feeCollected)} of late fees collected
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Record a payment ── */}
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', letterSpacing: '0.02em', marginBottom: 8 }}>
            RECORD OR ADJUST
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 11 }}>
            <div>
              <label style={LBL}>STATUS</label>
              <select style={INP} value={newStatus} onChange={e => setNewStatus(e.target.value as PaymentStatus)}>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="late">Late</option>
                <option value="missed">Missed</option>
              </select>
            </div>
            <div>
              <label style={LBL}>RENT COLLECTED ($)</label>
              <input style={INP} type="number" step="0.01" min={0} value={paidAmt}
                placeholder={String(payment.amount)}
                onChange={e => setPaidAmt(e.target.value)} />
            </div>
            <div>
              <label style={LBL}>LATE FEE COLLECTED ($)</label>
              <input style={INP} type="number" step="0.01" min={0} value={lateFeeIn}
                placeholder={editLateFee > 0 ? String(editLateFee) : '0.00'}
                onChange={e => setLateFeeIn(e.target.value)} />
              <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: 4, lineHeight: 1.45 }}>
                {editLateFee > 0
                  ? `${fmtCurrency(editLateFee)} has accrued. Enter what you actually took — it counts toward collected.`
                  : 'Only if you took a late fee on top of the rent.'}
              </div>
            </div>
            <div>
              <label style={LBL}>DATE PAID</label>
              <input style={INP} type="date" value={paidDate} disabled={!isPaidOrPartial}
                onChange={e => setPaidDate(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 11 }}>
            <label style={LBL}>DUE DATE</label>
            <input style={{ ...INP, maxWidth: 220 }} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            <div style={{ fontSize: '10.5px', color: dueDateMoved ? '#0f766e' : '#94a3b8', marginTop: 4, lineHeight: 1.45 }}>
              {dueDateMoved
                ? `Extension — was ${fmtDate(payment.due_date)}`
                : 'Push this out to grant an extension; the late fee follows it'}
            </div>
          </div>

          {dueDateMoved && (
            <div style={{ background: feeClearedByMove > 0 ? '#f0fdf4' : '#f8fafc', border: `1px solid ${feeClearedByMove > 0 ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: '9px', padding: '10px 13px', marginBottom: 11, fontSize: '12px', color: feeClearedByMove > 0 ? '#166534' : '#475569', lineHeight: 1.55, fontWeight: 600 }}>
              {feeClearedByMove > 0
                ? `Moving the due date to ${fmtDate(dueDate)} clears ${fmtCurrency(feeClearedByMove)} in late fees${editLateFee > 0 ? ` — ${fmtCurrency(editLateFee)} still stands` : ' — this charge will no longer show as late'}.`
                : `Due date moves to ${fmtDate(dueDate)}. Save to apply.`}
            </div>
          )}

          {/* The gap between what is owed and what came in, including the fee. */}
          {(() => {
            const inRent = parseFloat(paidAmt) || 0
            const inFee  = parseFloat(lateFeeIn) || 0
            const owed   = Math.round(((payment.amount + editLateFee) - (inRent + inFee)) * 100) / 100
            if (inRent + inFee <= 0) return null
            if (owed > 0.01) return (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '9px 12px', marginBottom: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#991b1b', fontWeight: 600 }}>
                  Short of {fmtCurrency(payment.amount + editLateFee)} charged
                  {editLateFee > 0 && inFee < editLateFee ? ' — late fee not fully collected' : ''}
                </span>
                <span style={{ fontSize: '14px', fontWeight: 800, color: '#dc2626' }}>{fmtCurrency(owed)}</span>
              </div>
            )
            return (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '9px 12px', marginBottom: 11, fontSize: '12px', color: '#166534', fontWeight: 600 }}>
                Settled in full{inFee > 0 ? `, including ${fmtCurrency(inFee)} of late fees` : ''}
              </div>
            )
          })()}

          <div style={{ marginBottom: 14 }}>
            <label style={LBL}>NOTES (OPTIONAL)</label>
            <input style={INP} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid via Zelle" />
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 13, marginBottom: 15 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', letterSpacing: '0.02em', marginBottom: 8 }}>
              REQUEST HISTORY
            </div>
            <PaymentEmailHistory
              emails={history}
              priorCount={payment.reminder_count ?? 0}
              empty="No requests sent for this month yet."
            />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ ...btnDark, ...(saving ? { background: '#94a3b8', cursor: 'not-allowed' } : {}) }}
              onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button style={btnQuiet} onClick={onClose}>Cancel</button>

            {onRemind && (
              <button
                style={{ ...btnQuiet, marginLeft: 'auto' }}
                onClick={() => onRemind(payment)}
                title={payment.reminder_sent_at
                  ? `Last reminded ${new Date(payment.reminder_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : 'Email this tenant about this charge'}
              >
                {(() => {
                  const n = Math.max(history.length, payment.reminder_count ?? 0)
                  return n > 0 ? `Remind again (${n})` : 'Send reminder'
                })()}
              </button>
            )}

            {onResendReceipt && (payment.status === 'paid' || payment.status === 'processing') && (
              <button
                style={{ ...btnQuiet, ...(onRemind ? {} : { marginLeft: 'auto' }) }}
                onClick={() => onResendReceipt(payment)}
                title="Send the payment confirmation again"
              >
                Resend confirmation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
