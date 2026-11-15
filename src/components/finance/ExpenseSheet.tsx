'use client'

/**
 * Recording what a property cost.
 *
 * ── Why a sheet and not a page ─────────────────────────────────────────────
 *
 * Entering costs is a *batch* job. Nobody records one expense: they sit down
 * with a shoebox or a bank statement in another tab and enter eleven. A page
 * per entry means eleven navigations away from the ledger they are checking
 * against, so this opens over the list, and on save it offers to stay open for
 * the next one. That single checkbox is the difference between this feature
 * being used and being tried once.
 *
 * ── The repeat control ─────────────────────────────────────────────────────
 *
 * A mortgage payment is the same number twelve times, and asking a landlord to
 * type it twelve times is how a product teaches people that its bookkeeping is
 * not worth doing. So a cost can be posted across a run of months — which
 * writes twelve real rows, now.
 *
 * It is deliberately not a "repeats monthly" flag on the row. A recurrence that
 * generates rows later needs something running to stay true and is wrong in
 * between; this database already carries one corrupt column that drifted that
 * way. Real rows are correct whether or not anything is running, and any single
 * month can then be edited when the premium changes — which a generated series
 * makes awkward and a flag makes impossible.
 *
 * ── On the amount field ────────────────────────────────────────────────────
 *
 * Cents, unlike every other money input in this product. Rent is integer
 * dollars because that is what leases are written in. An insurance premium is
 * $142.67, and a ledger that rounds it is wrong by real money twelve times a
 * year.
 */

import { useEffect, useRef, useState } from 'react'
import {
  CATEGORY_META, CATEGORY_ORDER, GROUP_META,
  createExpense, createExpenseSeries, deleteExpense, updateExpense,
  type Expense, type ExpenseCategory,
} from '@/lib/propertyExpenses'
import { fmtCurrency } from '@/lib/payments'

export type SheetProperty = { id: string; name: string }
export type SheetLease = { id: string; label: string; propertyId: string }

/** What the sheet is opened with: a cost to edit, or a blank with hints. */
export type ExpenseDraft = {
  expense?: Expense
  propertyId?: string
  category?: ExpenseCategory
  /** Pre-fill from a completed maintenance job, which this then posts. */
  workItem?: { id: string; title: string; cost: number | null; date: string | null }
}

const today = () => {
  // The landlord's own calendar day, not UTC — which in Tempe rolls over at
  // 5pm and would default an evening's entries into tomorrow. Same rule the
  // rent side follows with `billingToday`.
  const d = new Date()
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

export default function ExpenseSheet({
  draft, properties, leases, onClose, onSaved,
}: {
  draft: ExpenseDraft
  properties: SheetProperty[]
  leases: SheetLease[]
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const existing = draft.expense
  const editing = !!existing

  const [propertyId, setPropertyId] = useState(
    existing?.property_id ?? draft.propertyId ?? properties[0]?.id ?? '',
  )
  const [category, setCategory] = useState<ExpenseCategory>(
    existing?.category ?? draft.category ?? 'repairs',
  )
  const [amount, setAmount] = useState(
    existing ? String(existing.amount) : draft.workItem?.cost != null ? String(draft.workItem.cost) : '',
  )
  const [date, setDate] = useState(
    existing?.incurred_on ?? draft.workItem?.date?.slice(0, 10) ?? today(),
  )
  const [vendor, setVendor] = useState(existing?.vendor ?? '')
  const [memo, setMemo] = useState(existing?.memo ?? draft.workItem?.title ?? '')
  const [receipt, setReceipt] = useState(existing?.receipt_url ?? '')
  const [leaseId, setLeaseId] = useState(existing?.lease_id ?? '')
  /** How many months to post this across. 1 = just this one. */
  const [repeat, setRepeat] = useState(1)
  const [again, setAgain] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)

  const meta = CATEGORY_META[category]
  const propertyLeases = leases.filter(l => l.propertyId === propertyId)
  /**
   * The lease actually in force on the form.
   *
   * Derived rather than corrected: switching property makes a previously
   * chosen lease invalid, and clearing it in an effect would render the form
   * once with another property's tenancy selected. This way that state never
   * exists — and `leaseId` is left alone, so switching back restores the
   * choice instead of having silently destroyed it.
   */
  const effectiveLeaseId = propertyLeases.some(l => l.id === leaseId) ? leaseId : ''
  const n = Number(amount)
  const valid = propertyId !== '' && amount.trim() !== '' && Number.isFinite(n) && n >= 0 && !!date

  useEffect(() => {
    // The page beneath must not scroll while a layer is over it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    amountRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const reset = () => {
    setAmount('')
    setVendor('')
    setMemo('')
    setReceipt('')
    setRepeat(1)
    setError(null)
    amountRef.current?.focus()
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)

    const input = {
      property_id: propertyId,
      category,
      amount: Math.round(n * 100) / 100,
      incurred_on: date,
      lease_id: effectiveLeaseId || null,
      vendor: vendor.trim() || null,
      memo: memo.trim() || null,
      receipt_url: receipt.trim() || null,
      work_item_id: draft.workItem?.id ?? null,
    }

    const res = editing
      ? await updateExpense(existing!.id, input)
      : repeat > 1
        ? await createExpenseSeries(input, repeat)
        : await createExpense(input)

    setSaving(false)
    if (res.error) { setError(res.error); return }

    await onSaved()
    if (!editing && again) reset()
    else onClose()
  }

  const remove = async () => {
    if (!existing || saving) return
    setSaving(true)
    const { error: err } = await deleteExpense(existing.id)
    setSaving(false)
    if (err) { setError(err); return }
    await onSaved()
    onClose()
  }

  /** What the repeat control is about to write, said in money and in months. */
  const seriesTotal = Number.isFinite(n) ? n * repeat : 0

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={editing ? 'Edit cost' : 'Record a cost'}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-hd">
          <div className="sheet-id">
            <div className="sheet-title">{editing ? 'Edit this cost' : 'Record a cost'}</div>
            <div className="sheet-sub">
              {draft.workItem
                ? <>Posting “{draft.workItem.title}” from your maintenance list</>
                : <>What you spent on the property — the other half of what it earns</>}
            </div>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="sheet-bd">
          <div className="sheet-sec">
            <div className="sheet-sec-hd"><h3>What and how much</h3></div>

            <div className="xf-grid">
              <label className="xf">
                <span className="xf-lbl">Amount</span>
                <span className="xf-money">
                  <span className="xf-cur">$</span>
                  <input
                    ref={amountRef}
                    className="xf-in"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                  />
                </span>
                <span className="xf-hint">Cents matter here — a premium is not a round number.</span>
              </label>

              <label className="xf">
                <span className="xf-lbl">Date of the cost</span>
                <input
                  className="xf-in"
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                />
                <span className="xf-hint">
                  The month and tax year this belongs to — not the day you typed it.
                </span>
              </label>
            </div>

            <label className="xf">
              <span className="xf-lbl">Category</span>
              <select
                className="xf-in"
                value={category}
                onChange={e => setCategory(e.target.value as ExpenseCategory)}
              >
                {CATEGORY_ORDER.map(c => (
                  <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                ))}
              </select>
              <span className="xf-hint">{meta.blurb}.</span>
            </label>

            <div className="xf-cat" style={{ background: meta.bg, color: meta.color }}>
              <strong>{GROUP_META[meta.group].label}</strong>
              <span>{GROUP_META[meta.group].blurb}</span>
              <span className="xf-tax">
                {meta.capital
                  ? 'Depreciated, not deducted — kept out of NOI and out of your expense total.'
                  : `Schedule E ${meta.taxLine} at tax time.`}
              </span>
            </div>
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-hd"><h3>Where it belongs</h3></div>

            <label className="xf">
              <span className="xf-lbl">Property</span>
              <select
                className="xf-in"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                disabled={properties.length <= 1 && propertyId !== ''}
              >
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            {propertyLeases.length > 0 && (
              <label className="xf">
                <span className="xf-lbl">Tenancy <span className="xf-opt">optional</span></span>
                <select
                  className="xf-in"
                  value={effectiveLeaseId}
                  onChange={e => setLeaseId(e.target.value)}
                >
                  <option value="">The building, not a particular tenancy</option>
                  {propertyLeases.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <span className="xf-hint">
                  Set this for a turnover clean, a letting fee or tenant damage, so it can be
                  read against that tenancy and its deposit.
                </span>
              </label>
            )}
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-hd"><h3>For your records</h3></div>

            <label className="xf">
              <span className="xf-lbl">Paid to <span className="xf-opt">optional</span></span>
              <input
                className="xf-in"
                type="text"
                placeholder="Who you paid"
                value={vendor}
                onChange={e => setVendor(e.target.value)}
              />
            </label>

            <label className="xf">
              <span className="xf-lbl">Note <span className="xf-opt">optional</span></span>
              <input
                className="xf-in"
                type="text"
                placeholder="What it was for"
                value={memo}
                onChange={e => setMemo(e.target.value)}
              />
              <span className="xf-hint">
                Private to you — a tenant never sees this. Worth writing: next April
                “$340, other” means nothing.
              </span>
            </label>

            <label className="xf">
              <span className="xf-lbl">Receipt link <span className="xf-opt">optional</span></span>
              <input
                className="xf-in"
                type="url"
                placeholder="https://…"
                value={receipt}
                onChange={e => setReceipt(e.target.value)}
              />
            </label>
          </div>

          {!editing && (
            <div className="sheet-sec">
              <div className="sheet-sec-hd"><h3>Does it repeat?</h3></div>
              <label className="xf">
                <span className="xf-lbl">Post it for</span>
                <select
                  className="xf-in"
                  value={repeat}
                  onChange={e => setRepeat(Number(e.target.value))}
                >
                  <option value={1}>Just this month</option>
                  <option value={3}>3 months</option>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                  <option value={24}>24 months</option>
                </select>
                <span className="xf-hint">
                  {repeat === 1
                    ? 'One entry, on the date above.'
                    : <>Writes {repeat} real entries from {date}, {fmtCurrency(seriesTotal)} in
                       total. Each one can be edited or deleted on its own afterwards — useful
                       when a premium changes mid-year.</>}
                </span>
              </label>
            </div>
          )}

          {error && <p className="xf-err" role="alert">{error}</p>}
        </div>

        <div className="sheet-ft">
          {editing ? (
            confirmDelete ? (
              <span className="xf-confirm">
                <span>Delete this cost?</span>
                <button className="btn-danger sm" onClick={remove} disabled={saving}>
                  Yes, delete
                </button>
                <button className="btn-quiet sm" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button className="btn-quiet sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete
              </button>
            )
          ) : (
            <label className="xf-again">
              <input type="checkbox" checked={again} onChange={e => setAgain(e.target.checked)} />
              Keep this open to add another
            </label>
          )}

          <span className="xf-spacer" />
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!valid || saving}>
            {saving
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : repeat > 1 ? `Record ${repeat} entries` : 'Record it'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const EXPENSE_SHEET_CSS = `
  .fin .xf { display: block; margin-bottom: 14px; }
  .fin .xf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .fin .xf-lbl {
    display: block; font-size: 12px; font-weight: 600; color: var(--ink);
    margin-bottom: 5px; letter-spacing: -0.005em;
  }
  .fin .xf-opt { font-weight: 400; color: var(--ink-2); font-size: 11px; }
  .fin .xf-in {
    width: 100%; box-sizing: border-box;
    padding: 9px 11px; font: inherit; font-size: 13.5px;
    border: 1px solid var(--line); border-radius: 10px;
    background: var(--surface); color: var(--ink);
  }
  .fin .xf-in:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .fin .xf-money { position: relative; display: block; }
  .fin .xf-money .xf-cur {
    position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
    font-size: 13.5px; color: var(--ink-2); pointer-events: none;
  }
  .fin .xf-money .xf-in { padding-left: 24px; font-variant-numeric: tabular-nums; }
  .fin .xf-hint {
    display: block; font-size: 11.5px; color: var(--ink-2);
    line-height: 1.45; margin-top: 5px;
  }
  /* The category's consequence, in its own colour. A landlord choosing
     "capital improvement" should see the words "not deducted" before they
     save, not discover it in the tax summary in April. */
  .fin .xf-cat {
    display: grid; gap: 3px; padding: 11px 13px; border-radius: 12px;
    font-size: 11.5px; line-height: 1.45; margin-top: 2px;
  }
  .fin .xf-cat strong { font-size: 12px; }
  .fin .xf-cat .xf-tax { opacity: 0.85; }
  .fin .xf-err {
    margin: 0; padding: 10px 12px; border-radius: 10px;
    background: var(--late-bg); color: var(--late); font-size: 12.5px; line-height: 1.45;
  }
  .fin .xf-again {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--ink-2); cursor: pointer;
  }
  .fin .xf-confirm { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .fin .xf-spacer { flex: 1; }

  @media (max-width: 560px) {
    .fin .xf-grid { grid-template-columns: 1fr; }
  }
`
