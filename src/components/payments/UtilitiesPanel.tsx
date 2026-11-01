'use client'

/**
 * Utilities and shared charges on a lease — declared once, charged to everyone.
 *
 * The landlord was entering house internet six times, once per tenant, because
 * the only place a charge could live was inside a single payer's line items.
 * This panel is the one place that charge now lives; the database spreads it
 * (see src/lib/utilities.ts and `apply_plan_utility`).
 *
 * The preview line is the point of the whole screen: before saving, it says in
 * words what each person will be charged, because "$102 split six ways" is the
 * thing a landlord needs to check and the thing that was previously only
 * discoverable by opening six payers in turn.
 */
import { useState } from 'react'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import type { PaymentPlan } from '@/lib/payments'
import {
  UTILITY_CATEGORIES, CADENCE_LABEL, utilityShares, utilityHouseTotal,
  utilityCategoryLabel, createUtility, updateUtility, deleteUtility,
  type PlanUtility, type UtilityCadence, type UtilitySplit,
} from '@/lib/utilities'

const INP: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: '13px', border: '1.5px solid #e2e8f0',
  borderRadius: '7px', outline: 'none', fontFamily: "'DM Sans', sans-serif",
  background: '#fff', color: '#0f172a', boxSizing: 'border-box',
}

const LBL: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4,
}

const btnDark: React.CSSProperties = {
  padding: '7px 16px', borderRadius: '7px', border: 'none', background: '#0f172a',
  color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
}

const btnQuiet: React.CSSProperties = {
  padding: '7px 14px', borderRadius: '7px', border: '1.5px solid #e2e8f0', background: '#fff',
  color: '#475569', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
}

type Draft = {
  category: string
  label: string
  amount: string
  cadence: UtilityCadence
  split: UtilitySplit
  startDate: string
  endDate: string
  dueDate: string
  notes: string
}

const emptyDraft = (): Draft => ({
  category: 'internet',
  label: 'Internet',
  amount: '',
  cadence: 'monthly',
  split: 'even',
  startDate: '',
  endDate: '',
  dueDate: new Date().toISOString().split('T')[0],
  notes: '',
})

/** "$102.00 split evenly → $17.00 each" — what will actually be charged. */
function SharePreview({
  amount, split, payerCount,
}: { amount: number; split: UtilitySplit; payerCount: number }) {
  if (payerCount === 0) {
    return (
      <div style={{ fontSize: '12px', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '7px', padding: '8px 11px', lineHeight: 1.5 }}>
        No active payers on this lease yet, so there is nobody to charge. Add payers and this
        will spread across them automatically.
      </div>
    )
  }
  if (!(amount > 0)) return null

  const shares = utilityShares(amount, split, payerCount)
  const house = utilityHouseTotal({ amount, split }, payerCount)
  const uneven = shares.length > 1 && shares.some(s => s !== shares[0])

  return (
    <div style={{ fontSize: '12px', color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '7px', padding: '9px 12px', lineHeight: 1.55 }}>
      <strong>{fmtCurrency(house)}</strong> for the property
      {split === 'even'
        ? <> split across {payerCount} payer{payerCount !== 1 ? 's' : ''} → <strong>{fmtCurrency(shares[0])} each</strong></>
        : <> — <strong>{fmtCurrency(amount)} each</strong> for {payerCount} payer{payerCount !== 1 ? 's' : ''}</>}
      {uneven && (
        <div style={{ marginTop: 3, color: '#115e59' }}>
          Does not divide evenly, so the odd cents go to the first payers:{' '}
          {shares.map(s => fmtCurrency(s)).join(' · ')}
        </div>
      )}
    </div>
  )
}

function UtilityForm({
  planId, payerCount, existing, onDone, onCancel,
}: {
  planId: string
  payerCount: number
  existing?: PlanUtility
  onDone: () => void
  onCancel: () => void
}) {
  const [d, setD] = useState<Draft>(() => existing
    ? {
        category: existing.category,
        label: existing.label,
        amount: String(existing.amount),
        cadence: existing.cadence,
        split: existing.split,
        startDate: existing.start_date ?? '',
        endDate: existing.end_date ?? '',
        dueDate: existing.due_date ?? new Date().toISOString().split('T')[0],
        notes: existing.notes ?? '',
      }
    : emptyDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const amount = parseFloat(d.amount) || 0
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }))

  // Picking a category names the charge, but never overwrites a label the
  // landlord has already typed over.
  const pickCategory = (value: string) => {
    const auto = utilityCategoryLabel(value)
    setD(prev => ({
      ...prev,
      category: value,
      label: prev.label === utilityCategoryLabel(prev.category) || !prev.label ? auto : prev.label,
    }))
  }

  const submit = async () => {
    if (!(amount > 0)) { setError('Enter an amount above zero.'); return }
    if (!d.label.trim()) { setError('Give the charge a name.'); return }
    if (d.cadence === 'one_time' && !d.dueDate) { setError('A one-time charge needs a due date.'); return }
    if (d.cadence === 'monthly' && d.startDate && d.endDate && d.endDate < d.startDate) {
      setError('The end month cannot be before the start month.'); return
    }

    setSaving(true)
    setError('')

    const { error: err } = existing
      ? await updateUtility(existing.id, {
          category: d.category,
          label: d.label.trim(),
          amount,
          split: d.split,
          start_date: d.cadence === 'monthly' ? (d.startDate || null) : null,
          end_date: d.cadence === 'monthly' ? (d.endDate || null) : null,
          due_date: d.cadence === 'one_time' ? d.dueDate : null,
          notes: d.notes.trim() || null,
        })
      : await createUtility({
          planId,
          category: d.category,
          label: d.label.trim(),
          amount,
          cadence: d.cadence,
          split: d.split,
          startDate: d.startDate || null,
          endDate: d.endDate || null,
          dueDate: d.dueDate,
          notes: d.notes.trim() || null,
        })

    setSaving(false)
    if (err) {
      setError('Could not save that charge. Please try again.')
      return
    }
    onDone()
  }

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '11px', padding: '15px 16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 0.9fr', gap: 10, marginBottom: 11 }}>
        <div>
          <label style={LBL}>WHAT IS IT</label>
          <select style={INP} value={d.category} onChange={e => pickCategory(e.target.value)}>
            {UTILITY_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label style={LBL}>NAME ON THE TENANT&apos;S BILL</label>
          <input style={INP} value={d.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Internet" />
        </div>
        <div>
          <label style={LBL}>AMOUNT ($)</label>
          <input style={INP} type="number" step="0.01" min={0} value={d.amount}
            onChange={e => set('amount', e.target.value)} placeholder="102.00" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 11 }}>
        <div>
          <label style={LBL}>HOW OFTEN</label>
          {/* Cadence decides which table the charge is materialised into, so it
              cannot be switched after the fact — the existing rows would be of
              the wrong kind. Delete and re-add instead. */}
          <select style={INP} value={d.cadence} disabled={!!existing}
            onChange={e => set('cadence', e.target.value as UtilityCadence)}>
            <option value="monthly">Every month — added to rent</option>
            <option value="one_time">One time — its own charge</option>
          </select>
          {existing && (
            <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: 4 }}>
              Fixed once created. Delete and re-add to change it.
            </div>
          )}
        </div>
        <div>
          <label style={LBL}>THE AMOUNT ABOVE IS…</label>
          <select style={INP} value={d.split} onChange={e => set('split', e.target.value as UtilitySplit)}>
            <option value="even">the whole bill — split it evenly</option>
            <option value="per_payer">what each payer owes</option>
          </select>
        </div>
      </div>

      {d.cadence === 'monthly' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 11 }}>
          <div>
            <label style={LBL}>FIRST MONTH (OPTIONAL)</label>
            <input style={INP} type="date" value={d.startDate} onChange={e => set('startDate', e.target.value)} />
            <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: 4 }}>Blank = from the start of the lease</div>
          </div>
          <div>
            <label style={LBL}>LAST MONTH (OPTIONAL)</label>
            <input style={INP} type="date" value={d.endDate} onChange={e => set('endDate', e.target.value)} />
            <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: 4 }}>Blank = until the lease ends</div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 11, maxWidth: 240 }}>
          <label style={LBL}>DUE DATE</label>
          <input style={INP} type="date" value={d.dueDate} onChange={e => set('dueDate', e.target.value)} />
        </div>
      )}

      <div style={{ marginBottom: 11 }}>
        <label style={LBL}>NOTE (OPTIONAL)</label>
        <input style={INP} value={d.notes} onChange={e => set('notes', e.target.value)}
          placeholder="e.g. Cox gigabit, billed to the house" />
      </div>

      <div style={{ marginBottom: 12 }}>
        <SharePreview amount={amount} split={d.split} payerCount={payerCount} />
      </div>

      {d.cadence === 'monthly' && (
        <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.55, marginBottom: 12 }}>
          Added to each payer&apos;s monthly total and to their rent that is still unpaid and not
          yet due. Rent already paid, part paid, clearing or past its due date is left exactly
          as it is.
        </div>
      )}

      {error && (
        <div style={{ fontSize: '12px', color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '7px', padding: '8px 11px', marginBottom: 11 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...btnDark, ...(saving ? { background: '#94a3b8', cursor: 'not-allowed' } : {}) }}
          onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add charge'}
        </button>
        <button style={btnQuiet} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function UtilityCard({
  u, payerCount, onChanged,
}: { u: PlanUtility; payerCount: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const shares = utilityShares(u.amount, u.split, payerCount)
  const house = utilityHouseTotal(u, payerCount)

  const remove = async () => {
    setBusy(true)
    await deleteUtility(u.id)
    setBusy(false)
    onChanged()
  }

  if (editing) {
    return (
      <UtilityForm
        planId={u.plan_id}
        payerCount={payerCount}
        existing={u}
        onDone={() => { setEditing(false); onChanged() }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '11px', padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{u.label}</span>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569', background: '#f1f5f9', borderRadius: '20px', padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {CADENCE_LABEL[u.cadence]}
            </span>
            {u.category !== 'other' && (
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>{utilityCategoryLabel(u.category)}</span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
            {payerCount === 0
              ? 'No active payers to charge'
              : u.split === 'even'
                ? <>{fmtCurrency(house)} for the property · {fmtCurrency(shares[0])} each across {payerCount}</>
                : <>{fmtCurrency(u.amount)} each · {fmtCurrency(house)} for the property</>}
            {u.cadence === 'one_time' && u.due_date && <> · due {fmtDate(u.due_date)}</>}
            {u.cadence === 'monthly' && (u.start_date || u.end_date) && (
              <> · {u.start_date ? `from ${fmtDate(u.start_date)}` : 'from lease start'}
                {u.end_date ? ` to ${fmtDate(u.end_date)}` : ''}</>
            )}
          </div>
          {u.notes && (
            <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: 4, fontStyle: 'italic' }}>{u.notes}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              {fmtCurrency(payerCount > 0 ? shares[0] : u.amount)}
            </div>
            <div style={{ fontSize: '10.5px', color: '#94a3b8' }}>
              per payer{u.cadence === 'monthly' ? ' / mo' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btnQuiet} onClick={() => setEditing(true)}>Edit</button>
            <button
              style={{ ...btnQuiet, color: '#b91c1c', borderColor: '#fecaca' }}
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <div style={{ marginTop: 11, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '9px', padding: '11px 13px' }}>
          <div style={{ fontSize: '12.5px', color: '#991b1b', lineHeight: 1.55, marginBottom: 10 }}>
            {u.cadence === 'monthly' ? (
              <>Remove <strong>{u.label}</strong>? Each payer&apos;s monthly total drops by their share,
              and it comes off rent that is still unpaid and not yet due. Rent already paid is
              untouched.</>
            ) : (
              <>Remove <strong>{u.label}</strong>? Unpaid charges for it are deleted. Anything a
              tenant has already paid stays on the books.</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{ ...btnDark, background: busy ? '#94a3b8' : '#b91c1c' }}
              onClick={remove}
              disabled={busy}
            >
              {busy ? 'Removing…' : 'Remove it'}
            </button>
            <button style={btnQuiet} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function UtilitiesPanel({
  planId, tenants, utilities, onChanged,
}: {
  planId: string
  tenants: PaymentPlan['tenants']
  utilities: PlanUtility[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const payerCount = tenants.filter(t => t.status === 'active').length

  const monthlyHouse = utilities
    .filter(u => u.cadence === 'monthly')
    .reduce((s, u) => s + utilityHouseTotal(u, payerCount), 0)

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
            Utilities &amp; shared charges
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Declared once for the lease and charged to every payer
            {monthlyHouse > 0 && <> · {fmtCurrency(monthlyHouse)}/mo across the property</>}
          </div>
        </div>
        {!adding && (
          <button style={btnDark} onClick={() => setAdding(true)}>+ Add utility</button>
        )}
      </div>

      {adding && (
        <div style={{ marginBottom: 12 }}>
          <UtilityForm
            planId={planId}
            payerCount={payerCount}
            onDone={() => { setAdding(false); onChanged() }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {utilities.length === 0 && !adding ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.6, maxWidth: 430, margin: '0 auto' }}>
            No utilities on this lease. Add one here — internet, water, trash — and it is charged
            to every payer at once, instead of being typed into each of them by hand.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {utilities.map(u => (
            <UtilityCard key={u.id} u={u} payerCount={payerCount} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}
