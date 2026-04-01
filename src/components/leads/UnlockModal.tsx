'use client'

import { useState, useEffect, useRef } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const APPEARANCE = {
  theme: 'stripe' as const,
  variables: { colorPrimary: '#8C1D40', borderRadius: '7px', fontFamily: "'DM Sans', sans-serif" },
}

type PlanId = 'per_lead' | 'single_listing' | 'two_listing' | 'lifetime'

interface UnlockModalProps {
  leadId: string
  onSuccess: (unlockType: string) => void
  onClose: () => void
}

const PLANS: {
  id: PlanId
  name: string
  price: string
  freq: string
  desc: string
  features: string[]
  highlight: boolean
  badge?: string
}[] = [
  {
    id: 'per_lead',
    name: 'Single Unlock',
    price: '$1.99',
    freq: 'one time',
    desc: 'This lead only',
    features: ['Instant contact access', 'No commitment', 'Pay as you go'],
    highlight: false,
  },
  {
    id: 'single_listing',
    name: '1 Listing',
    price: '$29.99',
    freq: '/ mo',
    desc: 'One listing, unlimited leads',
    features: ['All leads on 1 listing', 'Unlimited unlocks', 'Cancel anytime'],
    highlight: false,
  },
  {
    id: 'two_listing',
    name: 'Unlimited Listings',
    price: '$49.99',
    freq: '/ mo',
    desc: 'Every listing you own',
    features: ['All your listings covered', 'Unlimited unlocks', 'Cancel anytime'],
    highlight: true,
    badge: 'BEST VALUE',
  },
  {
    id: 'lifetime',
    name: 'Lifetime Deal',
    price: '$299',
    freq: 'once',
    desc: 'All listings, forever',
    features: ['All listings, forever', 'No monthly fees', 'Early adopter rate'],
    highlight: false,
    badge: '🔥 LIMITED',
  },
]

// ─── Inline payment form ──────────────────────────────────────────────────────
function PaymentForm({ clientSecret, buttonLabel, onSuccess }: {
  clientSecret: string
  buttonLabel: string
  onSuccess: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true); setError(null)
    const { error: submitErr } = await elements.submit()
    if (submitErr) { setError(submitErr.message ?? 'Payment failed'); setSubmitting(false); return }
    const { error: confirmErr } = await stripe.confirmPayment({
      elements, clientSecret,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })
    if (confirmErr) { setError(confirmErr.message ?? 'Payment failed'); setSubmitting(false); return }
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '20px' }}>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#dc2626', fontFamily: "'DM Sans', sans-serif" }}>{error}</p>
      )}
      <button
        type="submit" disabled={!stripe || submitting}
        style={{
          marginTop: '14px', width: '100%',
          background: submitting ? '#c5c1b8' : '#8C1D40', color: '#fff',
          border: 'none', borderRadius: '9px', padding: '14px',
          fontSize: '15px', fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
          cursor: submitting ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        }}
      >
        {submitting
          ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />Processing…</>
          : buttonLabel}
      </button>
    </form>
  )
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function UnlockModal({ leadId, onSuccess, onClose }: UnlockModalProps) {
  const [selected, setSelected] = useState<PlanId | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loadingSecret, setLoadingSecret] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => { modalRef.current?.focus() }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const selectPlan = async (planId: PlanId) => {
    if (selected === planId) return
    setSelected(planId)
    setClientSecret(null)
    setSecretError(null)
    setLoadingSecret(true)
    try {
      if (planId === 'per_lead') {
        const r = await fetch('/api/stripe/payment-intent', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId }),
        })
        const d = await r.json()
        if (d.clientSecret) setClientSecret(d.clientSecret)
        else setSecretError(d.error ?? 'Unable to initialize payment')
      } else if (planId === 'lifetime') {
        const r = await fetch('/api/stripe/lifetime', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const d = await r.json()
        if (d.clientSecret) setClientSecret(d.clientSecret)
        else setSecretError(d.error ?? 'Unable to initialize payment')
      } else {
        const r = await fetch('/api/stripe/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: planId, listingIds: [] }),
        })
        const d = await r.json()
        if (d.clientSecret) setClientSecret(d.clientSecret)
        else setSecretError(d.error ?? 'Unable to initialize plan')
      }
    } catch { setSecretError('Unable to initialize payment') }
    finally { setLoadingSecret(false) }
  }

  const selectedPlan = PLANS.find(p => p.id === selected)

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes slideUp { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        .unlock-plan-card { border-radius: 12px; padding: 16px 14px; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; position: relative; text-align: left; width: 100%; font-family: 'DM Sans', sans-serif; }
        .unlock-plan-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
      `}</style>

      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div
          ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Unlock Lead"
          onClick={e => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '520px',
            maxHeight: '94vh', overflowY: 'auto', padding: '0 0 40px',
            animation: 'slideUp 0.22s ease-out', outline: 'none',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '22px 24px 16px' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif" }}>
                Unlock Contact Details
              </div>
              <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '3px', fontFamily: "'DM Sans', sans-serif" }}>
                Choose the option that works best for you
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b9b9b', fontSize: '20px', padding: '0 0 0 8px', lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: '0 24px' }}>
            {/* Plan comparison cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: selected ? '20px' : '0' }}>
              {PLANS.map(plan => {
                const isSelected = selected === plan.id
                return (
                  <button
                    key={plan.id}
                    className="unlock-plan-card"
                    onClick={() => selectPlan(plan.id)}
                    style={{
                      background: isSelected ? '#fdf2f5' : plan.highlight ? '#f8f7f4' : '#fff',
                      border: isSelected
                        ? '2px solid #8C1D40'
                        : plan.highlight
                        ? '2px solid #1a1a1a'
                        : '1.5px solid #e8e4db',
                    }}
                  >
                    {plan.badge && (
                      <div style={{
                        position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)',
                        background: '#FFC627', color: '#1a1a1a', fontSize: '9px', fontWeight: 800,
                        padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap', letterSpacing: '0.5px',
                      }}>
                        {plan.badge}
                      </div>
                    )}

                    {/* Plan name */}
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b6b6b', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {plan.name}
                    </div>

                    {/* Price */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '22px', fontWeight: 800, color: isSelected ? '#8C1D40' : '#1a1a1a', letterSpacing: '-0.5px' }}>
                        {plan.price}
                      </span>
                      <span style={{ fontSize: '11px', color: '#9b9b9b', fontWeight: 500 }}>{plan.freq}</span>
                    </div>

                    {/* Description */}
                    <div style={{ fontSize: '11px', color: '#6b6b6b', marginBottom: '10px', lineHeight: 1.4 }}>
                      {plan.desc}
                    </div>

                    {/* Features */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {plan.features.map(f => (
                        <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#4a4a4a' }}>
                          <span style={{ color: '#10b981', fontSize: '10px', fontWeight: 700, flexShrink: 0 }}>✓</span>
                          {f}
                        </div>
                      ))}
                    </div>

                    {/* Selected indicator */}
                    {isSelected && (
                      <div style={{ marginTop: '10px', fontSize: '11px', color: '#8C1D40', fontWeight: 700 }}>
                        Selected ↓
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Payment section — appears when a plan is selected */}
            {selected && (
              <div style={{
                borderTop: '1.5px solid #e8e4db', paddingTop: '20px',
                animation: 'slideUp 0.18s ease-out',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a', marginBottom: '14px', fontFamily: "'DM Sans', sans-serif" }}>
                  {selectedPlan?.id === 'per_lead'
                    ? 'Pay $1.99 to unlock this lead'
                    : selectedPlan?.id === 'lifetime'
                    ? 'Lifetime access — pay $299 once, unlock everything forever'
                    : `Start ${selectedPlan?.name} plan — ${selectedPlan?.price}/mo`
                  }
                </div>

                {loadingSecret && (
                  <div style={{ textAlign: 'center', padding: '24px', color: '#9b9b9b', fontSize: '13px', fontFamily: "'DM Sans', sans-serif" }}>
                    <div style={{ width: 20, height: 20, border: '2px solid #e8e4db', borderTopColor: '#8C1D40', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 8px' }} />
                    Preparing payment…
                  </div>
                )}

                {secretError && (
                  <p style={{ color: '#dc2626', fontSize: '13px', fontFamily: "'DM Sans', sans-serif" }}>{secretError}</p>
                )}

                {clientSecret && !loadingSecret && (
                  <Elements key={clientSecret} stripe={stripePromise} options={{ clientSecret, appearance: APPEARANCE }}>
                    <PaymentForm
                      clientSecret={clientSecret}
                      buttonLabel={
                        selected === 'per_lead' ? 'Unlock Now — $1.99 →'
                        : selected === 'lifetime' ? 'Get Lifetime Access — $299 →'
                        : `Start ${selectedPlan?.name} Plan →`
                      }
                      onSuccess={() => onSuccess(selected === 'per_lead' ? 'per_lead' : 'subscription')}
                    />
                  </Elements>
                )}
              </div>
            )}

            {/* No selection nudge */}
            {!selected && (
              <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '12px', color: '#c5c1b8', fontFamily: "'DM Sans', sans-serif" }}>
                Select a plan above to continue
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
