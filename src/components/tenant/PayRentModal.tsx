'use client'

/**
 * Pay rent — method first, then details.
 *
 * The pricing behaviour here is unchanged and must stay that way: the figures
 * shown before the intent exists are a *preview*, the server recomputes every
 * amount from the database, and from the moment the server's quote is known it
 * is the only number this sheet may show. See `ServerQuote` below.
 *
 * What changed is the sheet itself.
 *
 *   • **It is a dialog now.** It had no `role="dialog"`, so a screen reader
 *     announced nothing when it opened; no Escape handler; and no focus trap,
 *     which on a payment form means Tab from the last field walked out of the
 *     sheet into the page behind it and a tenant could be typing card details
 *     into something they could not see. All of that now comes from
 *     `TenantSheet`, and it is a bottom sheet on a phone rather than a card
 *     floating in the middle of the screen.
 *   • **It cannot be dismissed mid-charge.** Once `confirmPayment` is in
 *     flight, the backdrop and Escape are withdrawn. Losing the sheet at that
 *     moment is the one dismissal that is never what anybody meant.
 *   • **The methods are a radio group.** They were `<button>`s whose selected
 *     state existed only as a border colour, so the choice was invisible to
 *     assistive technology and to anyone who cannot see a 2px maroon edge.
 *   • **It says what happens next.** A tenant choosing ACH is told, before
 *     they choose, that the money moves in a few days and that their rent is
 *     credited immediately — which is the question the old sheet answered only
 *     after the payment had been taken.
 *   • **It is in the portal's own colours**, including Stripe's own fields via
 *     the Elements appearance below. A maroon portal that hands over to a
 *     navy-and-emerald card form at the final step looks like a redirect to
 *     somewhere else, which is precisely the feeling to avoid here.
 */

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { computeFee, fmtMoney, FEE_RATES, type PayMethod } from '@/lib/rentPayments'
import Icon from '@/components/NavIcons'
import TenantSheet from '@/components/tenant/TenantSheet'
import { stripePublishableKey } from '@/lib/stripeEnv'
import StripeModeBanner from '@/components/StripeModeBanner'

const PUBLISHABLE = stripePublishableKey()
const stripePromise = PUBLISHABLE ? loadStripe(PUBLISHABLE) : null

/** Stripe's own inputs, in the portal's language rather than Stripe's. */
const APPEARANCE = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#8C1D40',
    colorText: '#1F1517',
    colorTextSecondary: '#6E5B59',
    colorDanger: '#B3261E',
    borderRadius: '8px',
    fontFamily: "'DM Sans', sans-serif",
    fontSizeBase: '14px',
  },
}

export type Payable = {
  /**
   * `late_fee` is a fee being paid on its own, which is how nearly every
   * outstanding fee has to be paid: the rent underneath it was settled months
   * ago, so there is no rent line left to carry it.
   */
  kind: 'scheduled' | 'special' | 'late_fee'
  id: string
  label: string
  /** Rent or charge owed, excluding any late fee. Zero on a `late_fee` row. */
  amount: number
  /**
   * The late fee, as its own figure.
   *
   * Kept separate from `amount` all the way to the total so the tenant can see
   * why they are being asked for more than their rent. A late fee folded into
   * the rent line is indistinguishable from a rent increase.
   */
  lateFee?: number
  /** `late_fee` only: the rent this fee was charged against, already paid. */
  rentSettled?: boolean
  /** How many days past due, for the row's own explanation. */
  daysLate?: number
}

/**
 * What the server actually priced, returned by `POST /api/tenant/pay`.
 *
 * The figures on this sheet before the intent exists are a *preview*: they come
 * from whatever the lease page computed when it last loaded. The server
 * recomputes every amount from the database, and the two can legitimately
 * disagree — a late fee stops growing the moment an ACH debit is submitted, the
 * landlord may have waived a fee since the page loaded, or a housemate's
 * payment may have part-settled the month. Stripe charges the server's figure,
 * so from the moment it is known it is the only number this sheet may show. The
 * button used to keep quoting the preview, which is how a tenant could press
 * "Pay $150" and have $90 leave their account.
 */
type ServerQuote = {
  rent: number
  lateFee: number
  fee: number
  total: number
  ratePct: number
  items: { id: string; label: string; amount: number; kind: string }[]
}

const METHODS: { id: PayMethod; icon: 'bank' | 'creditCard'; name: string; blurb: string }[] = [
  {
    id: 'ach',
    icon: 'bank',
    name: 'Bank account',
    blurb: 'Lower fee. Your rent is credited straight away and the transfer settles in 2–5 business days.',
  },
  {
    id: 'card',
    icon: 'creditCard',
    name: 'Debit or credit card',
    blurb: 'Clears immediately. Higher fee.',
  },
]

export default function PayRentModal({
  payables, authToken, onClose, onPaid,
}: {
  payables: Payable[]
  authToken: string | null
  onClose: () => void
  onPaid: (method: PayMethod, ach: boolean) => void
}) {
  const [method, setMethod] = useState<PayMethod>('ach')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  /** The server's own pricing, once it has priced it. Authoritative. */
  const [priced, setPriced] = useState<ServerQuote | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** True from `confirmPayment` until it resolves: the sheet locks shut. */
  const [charging, setCharging] = useState(false)

  const rent = payables.reduce((s, p) => s + p.amount, 0)
  const lateFees = Math.round(payables.reduce((s, p) => s + (p.lateFee ?? 0), 0) * 100) / 100
  const feeOnly = payables.filter(p => p.kind === 'late_fee')
  // The surcharge applies to everything being charged, late fees included —
  // the same base the server recomputes, so the two figures always agree.
  const base = Math.round((rent + lateFees) * 100) / 100
  const quote = computeFee(base, method)
  const achSaving = Math.round((quote.fee - computeFee(base, 'ach').fee) * 100) / 100

  /**
   * The rows as they should be shown right now.
   *
   * Before pricing: the selection, at the amounts the lease page computed.
   * After: whatever the server agreed to charge, at its amounts, keeping this
   * sheet's own wording for any row it recognises.
   */
  const lines = (priced
    ? priced.items.map(it => {
        const own = payables.find(p => p.id === it.id && p.kind === it.kind)
        return {
          id: it.id,
          kind: it.kind,
          label: own?.label ?? it.label,
          amount: it.amount,
          rentSettled: own?.rentSettled === true,
        }
      })
    : payables.map(p => ({
        id: p.id,
        kind: p.kind as string,
        label: p.label,
        amount: p.kind === 'late_fee' ? (p.lateFee ?? 0) : p.amount,
        rentSettled: p.rentSettled === true,
      })))

  async function start() {
    setStarting(true); setError(null)
    const res = await fetch('/api/tenant/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        method,
        scheduledIds: payables.filter(p => p.kind === 'scheduled').map(p => p.id),
        specialIds: payables.filter(p => p.kind === 'special').map(p => p.id),
        lateFeeIds: feeOnly.map(p => p.id),
      }),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    setStarting(false)
    if (!res) { setError('We couldn’t reach HomeHive. Check your connection and try again — nothing has been charged.'); return }
    if (!res.ok) { setError(json.error || 'Could not start the payment.'); return }
    setPriced({
      rent: Number(json.rent ?? 0),
      lateFee: Number(json.lateFee ?? 0),
      fee: Number(json.fee ?? 0),
      total: Number(json.total ?? 0),
      ratePct: Number(json.ratePct ?? quote.ratePct),
      items: Array.isArray(json.items) ? json.items : [],
    })
    setClientSecret(json.clientSecret)
  }

  const payableCount = lines.length

  return (
    <TenantSheet
      kicker={clientSecret ? 'Step 2 of 2' : 'Step 1 of 2'}
      title={clientSecret ? (method === 'ach' ? 'Your bank details' : 'Your card details') : 'Make a payment'}
      subtitle={`${payableCount} ${payableCount === 1 ? 'charge' : 'charges'} · ${fmtMoney(priced ? priced.total : quote.total)} total`}
      onClose={onClose}
      dismissible={!charging}
    >
      {/* Impossible to mistake a sandbox run for a real one. */}
      <StripeModeBanner detail style={{ marginBottom: 16 }} />

      {/* What's being paid. Once the server has priced it, these are its
          lines — which also drops a charge that turned out to be settled
          already. The amount is always the server's; the wording stays the
          tenant's, matched by charge id rather than by label. */}
      <div className="pr-lines">
        {lines.map(l => (
          <div key={`${l.kind}-${l.id}`} className="pr-line">
            <span>
              {l.label}
              {l.kind === 'late_fee' && l.rentSettled && (
                <em className="pr-line-note">The rent for this month is already paid.</em>
              )}
            </span>
            <span className="pr-line-amt tp-money">{fmtMoney(l.amount)}</span>
          </div>
        ))}
      </div>

      {!clientSecret ? (
        <>
          <div className="pr-sec" id="pr-method-label">How would you like to pay?</div>
          <div className="pr-methods" role="radiogroup" aria-labelledby="pr-method-label">
            {METHODS.map(m => {
              const q = computeFee(base, m.id)
              const on = method === m.id
              return (
                <label key={m.id} className={`tp-option${on ? ' on' : ''} pr-method`}>
                  <input
                    type="radio"
                    name="pay-method"
                    value={m.id}
                    checked={on}
                    onChange={() => setMethod(m.id)}
                    className="pr-radio"
                  />
                  <span className="pr-method-ic"><Icon name={m.icon} size={18} /></span>
                  <span className="pr-method-bd">
                    <span className="pr-method-top">
                      <span className="pr-method-name">{m.name}</span>
                      <span className="pr-method-rate">{FEE_RATES[m.id] * 100}% fee</span>
                    </span>
                    <span className="pr-method-sub">{m.blurb}</span>
                    <span className="pr-method-total tp-money">
                      {fmtMoney(q.total)} <em>total</em>
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="pr-totals">
            {/* A fee-only payment has no rent in it. Showing "Rent &
                charges $0.00" above a late-fee line reads like an error. */}
            {rent > 0 && (
              <div className="pr-tot"><span>Rent &amp; charges</span><span className="tp-money">{fmtMoney(rent)}</span></div>
            )}
            {lateFees > 0 && (
              <div className="pr-tot fee">
                <span>
                  Late fees
                  {payables.some(p => (p.daysLate ?? 0) > 0) && (
                    <em> · {Math.max(...payables.map(p => p.daysLate ?? 0))} days past due</em>
                  )}
                </span>
                <span className="tp-money">{fmtMoney(lateFees)}</span>
              </div>
            )}
            <div className="pr-tot">
              <span>Processing fee ({quote.ratePct}%)</span>
              <span className="tp-money">{fmtMoney(quote.fee)}</span>
            </div>
            <div className="pr-tot grand"><span>Total</span><span className="tp-money">{fmtMoney(quote.total)}</span></div>
          </div>

          {method === 'card' && achSaving > 0 && (
            <div className="tp-note good" style={{ display: 'flex', gap: 9 }}>
              <Icon name="info" size={16} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>
                Paying from a bank account instead would cost{' '}
                <strong>{fmtMoney(achSaving)} less</strong>, and your rent is still credited
                today.
              </span>
            </div>
          )}

          {error && <div className="tp-note bad" role="alert">{error}</div>}

          <button
            className="tp-btn tp-btn-primary full lg"
            onClick={start}
            disabled={starting || !stripePromise}
          >
            {starting ? 'Preparing…' : `Continue · ${fmtMoney(quote.total)}`}
          </button>
          <div className="tp-hint" style={{ marginTop: 10, textAlign: 'center' }}>
            Nothing is charged until you confirm on the next step.
          </div>
          {!stripePromise && (
            <div className="tp-note bad" style={{ marginTop: 12 }} role="alert">
              Card payments aren&apos;t configured yet — the Stripe publishable key is missing.
            </div>
          )}
        </>
      ) : (
        <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret, appearance: APPEARANCE }}>
          <PayForm
            clientSecret={clientSecret}
            authToken={authToken}
            method={method}
            total={priced ? priced.total : quote.total}
            lateFee={priced ? priced.lateFee : lateFees}
            processingFee={priced ? priced.fee : quote.fee}
            ratePct={priced ? priced.ratePct : quote.ratePct}
            /* Only ever shown when the two genuinely disagree, which is
               rare — but silence there is the one thing we must not do. */
            adjustedFrom={priced && Math.abs(priced.total - quote.total) > 0.005
              ? quote.total : null}
            onBack={() => { setClientSecret(null); setPriced(null) }}
            onCharging={setCharging}
            onPaid={() => onPaid(method, method === 'ach')}
          />
        </Elements>
      )}

      <style>{CSS}</style>
    </TenantSheet>
  )
}

function PayForm({
  clientSecret, authToken, method, total, lateFee, processingFee, ratePct,
  adjustedFrom, onBack, onCharging, onPaid,
}: {
  clientSecret: string
  authToken: string | null
  method: PayMethod
  /** The server's total — exactly what Stripe will take. */
  total: number
  lateFee: number
  processingFee: number
  ratePct: number
  /** The preview this replaced, when it differed. Null when they agreed. */
  adjustedFrom: number | null
  onBack: () => void
  /** Locks the sheet shut while the charge is in flight. */
  onCharging: (v: boolean) => void
  onPaid: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true); setError(null)

    const { error: submitErr } = await elements.submit()
    if (submitErr) { setError(submitErr.message ?? 'Check your details.'); setSubmitting(false); return }

    onCharging(true)
    const { error: confirmErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })
    if (confirmErr) {
      onCharging(false)
      setError(confirmErr.message ?? 'Payment failed.')
      setSubmitting(false)
      return
    }

    // Stripe has the money; the rent rows still say "owing" until something
    // writes them. The webhook does that in production, but it is asynchronous
    // — and on a local run without `stripe listen` it never arrives at all. So
    // tell the server to check with Stripe now, and only then show success.
    await fetch('/api/tenant/pay/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ paymentIntentId: paymentIntent?.id, clientSecret }),
    }).catch(() => {})   // The webhook is still the backstop — never block on this.

    onCharging(false)
    onPaid()
  }

  return (
    <form onSubmit={submit}>
      {adjustedFrom !== null && (
        <div className="tp-note warn" role="status">
          This came to <strong>{fmtMoney(total)}</strong>, not {fmtMoney(adjustedFrom)}.
          {total < adjustedFrom
            ? ' Part of what was selected has already been settled or waived, so you are being asked for less.'
            : ' The balance moved since this page loaded. This is the up-to-date figure.'}
        </div>
      )}
      <div className="pr-totals" style={{ borderTop: 'none', paddingTop: 0 }}>
        {lateFee > 0 && (
          <div className="pr-tot fee"><span>Late fees</span><span className="tp-money">{fmtMoney(lateFee)}</span></div>
        )}
        <div className="pr-tot">
          <span>Processing fee ({ratePct}%)</span><span className="tp-money">{fmtMoney(processingFee)}</span>
        </div>
        <div className="pr-tot grand"><span>Total</span><span className="tp-money">{fmtMoney(total)}</span></div>
      </div>

      <div className="pr-sec" style={{ marginTop: 16 }}>
        {method === 'ach' ? 'Your bank details' : 'Card details'}
      </div>
      <PaymentElement options={{ layout: 'tabs' }} />

      {error && <div className="tp-note bad" style={{ marginTop: 12 }} role="alert">{error}</div>}

      <button className="tp-btn tp-btn-primary full lg" type="submit" style={{ marginTop: 16 }}
        disabled={!stripe || submitting}>
        {submitting ? 'Processing — do not close this' : `Pay ${fmtMoney(total)}`}
      </button>
      <button type="button" className="tp-btn tp-btn-ghost full" onClick={onBack} disabled={submitting}>
        ← Change payment method
      </button>

      {method === 'ach' && (
        <div className="tp-note flight" style={{ marginTop: 12, marginBottom: 0 }}>
          <strong>What happens next.</strong> Your rent is marked as paid as soon as you submit
          this, and shows as <em>clearing</em> until your bank settles it — usually 2–5 business
          days. No late fee can grow on it in the meantime.
        </div>
      )}
    </form>
  )
}

const CSS = `
  .pr-lines { border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden;
    margin-bottom: 18px; }
  .pr-line { display: flex; justify-content: space-between; gap: 12px; padding: 11px 13px;
    font-size: 13px; color: var(--ink-2); }
  .pr-line + .pr-line { border-top: 1px solid var(--line-2); }
  .pr-line-amt { font-weight: 700; color: var(--ink); white-space: nowrap; }
  .pr-line-note { display: block; font-style: normal; font-size: 11.5px; color: var(--ink-4);
    margin-top: 3px; }

  .pr-sec { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px;
    color: var(--ink-4); margin-bottom: 9px; }

  .pr-methods { display: flex; flex-direction: column; gap: 9px; margin-bottom: 16px; }
  .pr-method { display: flex; align-items: flex-start; gap: 12px; }
  /* The radio stays in the DOM for the keyboard and the accessibility tree,
     but the whole card is the target — so it is positioned, not hidden. */
  .pr-radio { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .pr-method-ic { flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px;
    background: var(--idle-wash); color: var(--ink-3);
    display: flex; align-items: center; justify-content: center; }
  .tp-option.on .pr-method-ic { background: var(--primary); color: #fff; }
  .pr-method-bd { flex: 1; min-width: 0; }
  .pr-method-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .pr-method-name { font-size: 14px; font-weight: 600; color: var(--ink); }
  .pr-method-rate { font-size: 11px; font-weight: 700; color: var(--ink-3);
    background: var(--surface); border: 1px solid var(--line); padding: 2px 8px;
    border-radius: 20px; white-space: nowrap; }
  .pr-method-sub { display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 4px;
    line-height: 1.5; }
  .pr-method-total { display: block; font-size: 15px; font-weight: 700; color: var(--ink);
    margin-top: 7px; }
  .pr-method-total em { font-style: normal; font-size: 11px; font-weight: 500;
    color: var(--ink-4); }
  /* The selected card gets the ring, so the choice survives being read out,
     being colour-blind, and being printed. */
  .pr-radio:focus-visible + .pr-method-ic { outline: 2px solid var(--primary);
    outline-offset: 2px; }

  .pr-totals { border-top: 1px solid var(--line-2); padding-top: 12px; margin-bottom: 14px; }
  .pr-tot { display: flex; justify-content: space-between; gap: 12px; font-size: 13px;
    color: var(--ink-2); padding: 4px 0; }
  .pr-tot.fee { color: var(--fee); }
  .pr-tot.fee em { font-style: normal; font-size: 11.5px; opacity: .85; }
  .pr-tot.grand { font-size: 16px; font-weight: 700; color: var(--ink);
    border-top: 1px solid var(--line); margin-top: 7px; padding-top: 11px; }
`
