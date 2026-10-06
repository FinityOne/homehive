'use client'

import { useState } from 'react'
import {
  PLANS,
  PLAN_ORDER,
  type PlanTier,
  formatUsd,
  formatPropertyLimit,
} from '@/lib/landlordPlans'

/**
 * The three tiers, side by side, with a button that charges a card.
 *
 * Shared by the post-signup paywall and the billing page so a landlord sees the
 * same three cards whether they are buying for the first time or moving up —
 * the only difference is which one is marked as theirs.
 */

export type PlanPickerProps = {
  /** The tier they are on now, if any. Rendered as "Current plan". */
  currentTier?: string | null
  /** Live properties they own — used to flag a tier that would not fit. */
  propertyCount?: number
  /** Called after an in-place upgrade; a first purchase redirects to Stripe. */
  onChanged?: (tier: PlanTier) => void
  compact?: boolean
}

export default function PlanPicker({
  currentTier = null,
  propertyCount = 0,
  onChanged,
  compact = false,
}: PlanPickerProps) {
  const [busy, setBusy] = useState<PlanTier | null>(null)
  const [error, setError] = useState('')

  const choose = async (tier: PlanTier) => {
    setBusy(tier)
    setError('')
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: tier }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || 'Could not start checkout. Please try again.')
        setBusy(null)
        return
      }
      if (data.url) {
        window.location.href = data.url
        return
      }
      // Changed in place — no card to collect, so stay here and refresh state.
      onChanged?.(tier)
      setBusy(null)
    } catch {
      setError('Network error. Check your connection and try again.')
      setBusy(null)
    }
  }

  return (
    <>
      <style>{`
        .pp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .pp-card {
          background: #fff; border: 1.5px solid #e8e4db; border-radius: 14px;
          padding: 22px 20px; display: flex; flex-direction: column;
          position: relative; transition: border-color 0.15s, box-shadow 0.15s;
        }
        .pp-card:hover { border-color: #d4c9b0; box-shadow: 0 4px 18px rgba(0,0,0,0.05); }
        .pp-card.featured { border-color: #1a1a1a; border-width: 2px; }
        .pp-card.current { border-color: #10b981; background: #f6fefb; }
        .pp-flag {
          position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
          font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
          padding: 3px 10px; border-radius: 20px; white-space: nowrap;
        }
        .pp-flag.best { background: #FFC627; color: #1a1a1a; }
        .pp-flag.yours { background: #10b981; color: #fff; }
        .pp-name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
        .pp-limit { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .pp-price { font-size: 32px; font-weight: 800; color: #1a1a1a; letter-spacing: -1.2px; margin: 14px 0 0; }
        .pp-price span { font-size: 13px; font-weight: 500; color: #9b9b9b; letter-spacing: 0; }
        .pp-audience { font-size: 12px; color: #6b6b6b; line-height: 1.55; margin: 10px 0 16px; min-height: 36px; }
        .pp-features { list-style: none; padding: 0; margin: 0 0 18px; display: flex; flex-direction: column; gap: 7px; flex: 1; }
        .pp-features li { font-size: 12.5px; color: #4a4a4a; line-height: 1.45; display: flex; gap: 8px; align-items: flex-start; }
        .pp-tick { color: #10b981; font-weight: 700; flex-shrink: 0; }
        .pp-btn {
          width: 100%; border: none; border-radius: 8px; padding: 11px;
          font-size: 13.5px; font-weight: 700; cursor: pointer;
          font-family: 'DM Sans', sans-serif; background: #1a1a1a; color: #fff;
          transition: background 0.15s;
        }
        .pp-btn:hover:not(:disabled) { background: #8C1D40; }
        .pp-btn:disabled { background: #d6d2ca; cursor: not-allowed; }
        .pp-btn.owned { background: #ecfdf5; color: #047857; cursor: default; }
        .pp-note { font-size: 11px; color: #b45309; margin-top: 8px; line-height: 1.45; }
        @media (max-width: 760px) { .pp-grid { grid-template-columns: 1fr; } }
      `}</style>

      {error && (
        <div style={{
          background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: 8,
          padding: '10px 14px', fontSize: 13, color: '#8C1D40', marginBottom: 14,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {error}
        </div>
      )}

      <div className="pp-grid">
        {PLAN_ORDER.map(tier => {
          const def = PLANS[tier]
          const isCurrent = currentTier === tier
          const tooSmall = propertyCount > def.propertyLimit
          const features = compact ? def.features.slice(0, 4) : def.features

          return (
            <div
              key={tier}
              className={`pp-card${def.highlight && !isCurrent ? ' featured' : ''}${isCurrent ? ' current' : ''}`}
            >
              {isCurrent
                ? <span className="pp-flag yours">YOUR PLAN</span>
                : def.highlight && <span className="pp-flag best">MOST POPULAR</span>}

              <div className="pp-name">{def.name}</div>
              <div className="pp-limit">
                {formatPropertyLimit(def.propertyLimit)}{' '}
                {def.propertyLimit === 1 ? 'property' : 'properties'}
              </div>
              <div className="pp-price">{formatUsd(def.priceCents)}<span> /month</span></div>
              <p className="pp-audience">{def.audience}</p>

              <ul className="pp-features">
                {features.map(f => (
                  <li key={f}><span className="pp-tick">✓</span>{f}</li>
                ))}
              </ul>

              {isCurrent ? (
                <button className="pp-btn owned" disabled>Current plan</button>
              ) : (
                <button
                  className="pp-btn"
                  disabled={busy !== null || tooSmall}
                  onClick={() => choose(tier)}
                >
                  {busy === tier ? 'Opening checkout…' : currentTier ? `Switch to ${def.name}` : `Choose ${def.name}`}
                </button>
              )}

              {tooSmall && !isCurrent && (
                <div className="pp-note">
                  You have {propertyCount} live properties — too many for this plan.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
