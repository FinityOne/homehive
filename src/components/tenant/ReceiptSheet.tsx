'use client'

/**
 * One payment, as a receipt the tenant can keep.
 *
 * Payment history was a flat list of unclickable rows: a label, a date, and a
 * single line of grey text that crammed the method, the late fee and the
 * processing fee into one run of "· incl." clauses. There was nothing to open,
 * so a tenant who needed to prove they paid — to a housemate, a co-signer, a
 * guarantor, a landlord who had lost the record, or a university that wants
 * evidence of housing costs — had a screenshot of a list row and nothing else.
 * The landlord's own money area gives every payment line a detail sheet; the
 * person who made the payment had less.
 *
 * So each settled row opens this. It states the four things a receipt has to
 * state — who, what for, how much, by what means — and separates the three
 * figures that make up the charge, because "incl. $15 late fee · incl. $12.40
 * processing fee" inside a sentence is not a breakdown anybody can check.
 *
 * It prints. `window.print()` plus the print rules at the bottom of this file
 * reduce the page to this sheet alone, so "save as PDF" produces a one-page
 * document with the property, the date, the breakdown and the reference on it.
 * That is the artefact a tenant is actually being asked for, and it needed no
 * new infrastructure to provide.
 *
 * It states only what was recorded. A row a landlord settled by hand against
 * money taken outside HomeHive has no method and no processing fee, and this
 * says so plainly rather than implying a card payment that never happened.
 */

import { fmtMoney, METHOD_META, type SettledMethod } from '@/lib/rentPayments'
import Icon from '@/components/NavIcons'
import TenantSheet from '@/components/tenant/TenantSheet'
import { settlementTone } from '@/lib/tenantTheme'

export type Receipt = {
  id: string
  /** 'Rent' | 'Deposit' | 'Charge' — what kind of thing was paid. */
  kind: string
  /** The charge's own label, e.g. "Rent — Jun 1, 2026". */
  label: string
  /** Everything that left the tenant's account on this row. */
  amount: number
  /** The part of `amount` that was a late fee. */
  lateFee: number
  /** The platform's processing surcharge, when one was taken. */
  processingFee: number
  /** `paid` or `processing`. */
  status: string
  /** When it settled, `YYYY-MM-DD`. Null on a row with no recorded date. */
  date: string | null
  method: SettledMethod | null
  /** Where the tenant lives, for a receipt that stands on its own. */
  property: string
  unit: string | null
  /** The landlord's own note on the charge, when there is one. */
  note?: string | null
}

const fmtLong = (d: string | null) =>
  d
    ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : 'Date not recorded'

export default function ReceiptSheet({
  receipt, onClose,
}: {
  receipt: Receipt
  onClose: () => void
}) {
  const r = receipt
  const state = settlementTone(r.status)
  const method = r.method ? METHOD_META[r.method] : null
  /** What the charge itself was, once the fee parts are taken out. */
  const principal = Math.round((r.amount - r.lateFee) * 100) / 100
  /**
   * The surcharge is charged *on top* of the rent, so the total that left the
   * tenant's account is the charge plus the fee — not `amount`, which is what
   * the landlord was credited. Shown as its own line and added at the bottom,
   * which is the only arrangement where the arithmetic is checkable.
   */
  const paidInTotal = Math.round((r.amount + r.processingFee) * 100) / 100

  return (
    <TenantSheet
      kicker="Receipt"
      title={r.label}
      subtitle={`${r.property}${r.unit ? ` · ${r.unit}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <button className="tp-btn tp-btn-secondary" onClick={onClose}>Close</button>
          <button className="tp-btn tp-btn-primary" onClick={() => window.print()}>
            <Icon name="receipt" size={16} />Print or save as PDF
          </button>
        </>
      }
    >
      <div className="rc">
        <div className="rc-top">
          <div className="rc-fig tp-money">{fmtMoney(paidInTotal)}</div>
          <div className={`tp-badge ${state.tone}`}>{state.label}</div>
        </div>
        <div className="rc-when">{fmtLong(r.date)}</div>

        {r.status === 'processing' && (
          <div className="tp-note flight" style={{ marginTop: 14 }}>
            <strong>This bank transfer is still clearing.</strong> It was submitted and your rent
            is already credited as paid; banks take 2–5 business days to settle. Nothing more is
            needed from you.
          </div>
        )}

        <div className="rc-sec">Breakdown</div>
        <div className="rc-table">
          <div className="rc-r">
            <span>{r.kind === 'Rent' ? 'Rent' : r.kind}</span>
            <span className="rc-amt tp-money">{fmtMoney(principal)}</span>
          </div>
          {r.lateFee > 0 && (
            <div className="rc-r fee">
              <span>Late fee</span>
              <span className="rc-amt tp-money">{fmtMoney(r.lateFee)}</span>
            </div>
          )}
          {r.processingFee > 0 && (
            <div className="rc-r">
              <span>
                Processing fee
                <em className="rc-note">
                  Charged by HomeHive for taking the payment, not by your landlord.
                </em>
              </span>
              <span className="rc-amt tp-money">{fmtMoney(r.processingFee)}</span>
            </div>
          )}
          <div className="rc-r total">
            <span>Total paid</span>
            <span className="rc-amt tp-money">{fmtMoney(paidInTotal)}</span>
          </div>
        </div>

        <div className="rc-sec">Details</div>
        <div className="rc-table">
          <div className="rc-r">
            <span>Paid by</span>
            <span className="rc-amt">
              {method
                ? method.label
                : 'Recorded by your landlord'}
            </span>
          </div>
          {!method && (
            <div className="rc-r">
              <span className="rc-note" style={{ marginTop: 0 }}>
                Your landlord marked this as settled against money received outside HomeHive, so
                there is no card or bank record attached to it.
              </span>
            </div>
          )}
          <div className="rc-r">
            <span>Home</span>
            <span className="rc-amt">{r.property}{r.unit ? ` · ${r.unit}` : ''}</span>
          </div>
          <div className="rc-r">
            <span>Reference</span>
            {/* The charge's own id. Short enough to read down a phone line,
                and it is what support will ask for. */}
            <span className="rc-amt rc-ref">{r.id.slice(0, 8).toUpperCase()}</span>
          </div>
        </div>

        {r.note && (
          <>
            <div className="rc-sec">From your landlord</div>
            <div className="rc-quote">{r.note}</div>
          </>
        )}

        <div className="tp-hint" style={{ marginTop: 16 }}>
          Keep this if you need to show proof of rent — a co-signer, a guarantor or a university
          office will usually accept the printed version.
        </div>
      </div>

      <style>{CSS}</style>
    </TenantSheet>
  )
}

const CSS = `
  .rc-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .rc-fig { font-family: var(--display); font-size: 34px; font-weight: 600;
    letter-spacing: -1px; color: var(--ink); line-height: 1; }
  .rc-when { font-size: 13px; color: var(--ink-3); margin-top: 6px; }

  .rc-sec { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .8px; color: var(--ink-4); margin: 20px 0 8px; }

  .rc-table { border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; }
  .rc-r { display: flex; justify-content: space-between; gap: 14px; padding: 11px 13px;
    font-size: 13px; color: var(--ink-2); }
  .rc-r + .rc-r { border-top: 1px solid var(--line-2); }
  .rc-r.fee { color: var(--fee); }
  .rc-r.total { background: var(--surface-2); font-weight: 700; color: var(--ink);
    font-size: 14px; }
  .rc-amt { font-weight: 600; color: var(--ink); text-align: right; white-space: nowrap; }
  .rc-r.fee .rc-amt { color: var(--fee); }
  .rc-ref { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .5px; }
  .rc-note { display: block; font-style: normal; font-size: 11.5px; color: var(--ink-4);
    line-height: 1.5; margin-top: 3px; max-width: 42ch; }
  .rc-quote { font-size: 13px; color: var(--ink-2); line-height: 1.6; padding-left: 12px;
    border-left: 2px solid var(--line); }

  /* ── Print ────────────────────────────────────────────────────────────────
     Reduce the page to this sheet. Everything else — the portal shell, the
     lease page behind it, the backdrop — is removed rather than hidden, so the
     receipt starts at the top of page one instead of after a blank sheet. ── */
  @media print {
    body > *:not(.tp-sheet-back) { display: none !important; }
    .tp-sheet-back { position: static !important; inset: auto !important;
      padding: 0 !important; background: none !important; backdrop-filter: none !important;
      display: block !important; }
    .tp-sheet { max-width: none !important; max-height: none !important;
      box-shadow: none !important; border-radius: 0 !important; animation: none !important; }
    .tp-sheet-bd { overflow: visible !important; }
    .tp-sheet-x, .tp-sheet-ft { display: none !important; }
    .rc-table, .tp-note { break-inside: avoid; }
  }
`
