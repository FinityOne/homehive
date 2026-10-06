'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import PlanPicker from '@/components/billing/PlanPicker'
import {
  PLANS,
  isPlanTier,
  planDisplayName,
  formatMonthly,
  formatPropertyLimit,
  UNLIMITED_PROPERTIES,
} from '@/lib/landlordPlans'

/**
 * Plan and billing.
 *
 * Reads as three answers in order: what am I on, how much of it am I using,
 * and what would change if I moved. The usage bar is the honest version of an
 * upsell — a landlord at 5 of 5 properties does not need to be sold anything,
 * they need to see the number.
 */

type PlanState = {
  planType: string | null
  status: string | null
  currentPeriodEnd: string | null
  hasBillingAccount: boolean
  hasSubscription: boolean
  hasAccess: boolean
  propertyCount: number
  propertyLimit: number
  canAddProperty: boolean
}

function formatDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const section: React.CSSProperties = {
  background: '#fff',
  border: '1.5px solid #e8e4db',
  borderRadius: 12,
  padding: '20px 24px',
  marginBottom: 16,
  fontFamily: "'DM Sans', sans-serif",
}

const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: '#8C1D40',
  marginBottom: 12,
}

export default function BillingPage() {
  const router = useRouter()
  const [state, setState] = useState<PlanState | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => { document.title = 'Plan & Billing — Landlord | HomeHive' }, [])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const res = await fetch('/api/landlord/plan')
    if (res.ok) setState(await res.json())
    setLoading(false)
  }, [router])

  useEffect(() => { load() }, [load])

  const openPortal = async () => {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url, error } = await res.json()
      if (url) window.location.href = url
      else alert(error ?? 'Could not open the billing portal.')
    } catch {
      alert('Could not open the billing portal.')
    } finally {
      setPortalLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px 24px', fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b' }}>
        Loading billing…
      </div>
    )
  }

  const planType = state?.planType ?? null
  const active = state?.hasAccess ?? false
  const pastDue = state?.status === 'past_due'
  const tier = isPlanTier(planType) ? PLANS[planType] : null
  const limit = state?.propertyLimit ?? 0
  const used = state?.propertyCount ?? 0
  const unlimited = limit >= UNLIMITED_PROPERTIES
  const pctUsed = unlimited || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
  const renews = formatDate(state?.currentPeriodEnd ?? null)

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px 72px' }}>

      <div style={{ marginBottom: 26 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.5px' }}>
          Plan &amp; Billing
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif" }}>
          One flat monthly price. Priced by how many properties you list — nothing else.
        </p>
      </div>

      {pastDue && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
          padding: '12px 16px', fontSize: 13, color: '#b91c1c', marginBottom: 16,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <strong>Your last payment failed.</strong> You still have full access — update your card
          in the billing portal below to keep it that way.
        </div>
      )}

      {/* ── Current plan ──────────────────────────────────────────────────── */}
      <div style={section}>
        <div style={label}>Current plan</div>
        {active ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#1a1a1a' }}>
                {planDisplayName(planType)}
                {tier && (
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#6b6b6b', marginLeft: 8 }}>
                    {formatMonthly(tier.priceCents)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#9b9b9b', marginTop: 4 }}>
                {pastDue ? '⚠️ Payment past due'
                  : renews ? `Renews ${renews}`
                  : 'Active'}
              </div>
            </div>
            <span style={{
              background: pastDue ? '#fef2f2' : '#f0fdf4',
              color: pastDue ? '#dc2626' : '#166534',
              border: `1px solid ${pastDue ? '#fecaca' : '#bbf7d0'}`,
              borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '3px 10px',
            }}>
              {pastDue ? 'Past due' : 'Active'}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.6 }}>
            You don’t have an active plan, so your listings aren’t live and the portal is
            limited. Pick a plan below to switch everything back on.
          </div>
        )}
      </div>

      {/* ── Usage ─────────────────────────────────────────────────────────── */}
      {active && (
        <div style={section}>
          <div style={label}>Properties used</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-1px' }}>{used}</span>
            <span style={{ fontSize: 14, color: '#9b9b9b' }}>
              of {formatPropertyLimit(limit)} on {planDisplayName(planType)}
            </span>
          </div>
          {!unlimited && limit > 0 && (
            <div style={{ background: '#f5f4f0', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{
                height: '100%',
                width: `${pctUsed}%`,
                background: pctUsed >= 100 ? '#dc2626' : pctUsed >= 80 ? '#f59e0b' : '#10b981',
                transition: 'width 0.4s ease',
              }} />
            </div>
          )}
          <div style={{ fontSize: 13, color: '#6b6b6b', lineHeight: 1.6 }}>
            {state?.canAddProperty
              ? `You can add ${unlimited ? 'as many properties as you like' : `${limit - used} more`}.`
              : 'You’ve used every property on this plan — move up a tier to add another.'}
            {' '}
            <a href="/landlord/listings/new" style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
              Add a listing →
            </a>
          </div>
        </div>
      )}

      {/* ── Plans ─────────────────────────────────────────────────────────── */}
      <div style={section}>
        <div style={label}>{active ? 'Change plan' : 'Choose a plan'}</div>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#6b6b6b', lineHeight: 1.6 }}>
          Switching takes effect immediately and Stripe prorates the difference — you are
          never charged twice for the same month.
        </p>
        <PlanPicker
          currentTier={planType}
          propertyCount={used}
          onChanged={() => load()}
          compact
        />
      </div>

      {/* ── Manage ────────────────────────────────────────────────────────── */}
      {state?.hasBillingAccount && (
        <div style={section}>
          <div style={label}>Payment &amp; invoices</div>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b6b6b', lineHeight: 1.6 }}>
            Update your card, download invoices, or cancel. Cancelling keeps your access until
            the end of the period you have already paid for.
          </p>
          <button
            onClick={openPortal}
            disabled={portalLoading}
            style={{
              background: portalLoading ? '#c5c1b8' : '#1a1a1a',
              color: '#fff', border: 'none', borderRadius: 7,
              padding: '9px 20px', fontSize: 13, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              cursor: portalLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {portalLoading ? 'Opening…' : 'Manage billing →'}
          </button>
        </div>
      )}

      <p style={{ fontSize: 12, color: '#b0a898', textAlign: 'center', fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}>
        Renters never pay to use HomeHive. Your plan is the only platform fee.
      </p>
    </div>
  )
}
