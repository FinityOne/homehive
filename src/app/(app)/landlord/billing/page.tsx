'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type PlanType = 'per_lead' | 'single_listing' | 'two_listing' | 'lifetime' | null

interface Plan {
  plan_type: PlanType
  status: 'active' | 'cancelled' | 'past_due'
  current_period_end: string | null
  stripe_customer_id: string
}

const PLAN_NAMES: Record<NonNullable<PlanType>, string> = {
  per_lead:       'Pay Per Lead',
  single_listing: 'Single Listing Plan',
  two_listing:    'Two Listing Plan',
  lifetime:       'Lifetime Founding Member',
}

function formatDate(iso: string | null) {
  if (!iso) return 'Lifetime'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function BillingPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [slots, setSlots] = useState<{ total_slots: number; slots_used: number } | null>(null)
  const [unlockCount, setUnlockCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      loadData(user.id)
    })
  }, [])

  async function loadData(uid: string) {
    const [planRes, slotsRes, unlocksRes] = await Promise.all([
      supabase.from('landlord_plans').select('plan_type, status, current_period_end, stripe_customer_id').eq('landlord_id', uid).eq('status', 'active').maybeSingle(),
      supabase.from('lifetime_slots').select('total_slots, slots_used').single(),
      supabase.from('lead_unlocks').select('id', { count: 'exact', head: true }).eq('landlord_id', uid),
    ])

    setPlan(planRes.data as Plan | null)
    setSlots(slotsRes.data)
    setUnlockCount(unlocksRes.count ?? 0)
    setLoading(false)
  }

  const openPortal = async () => {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url, error } = await res.json()
      if (url) window.location.href = url
      else alert(error ?? 'Could not open billing portal')
    } catch {
      alert('Could not open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  const isLifetime = plan?.plan_type === 'lifetime'
  const hasPlan = !!plan

  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    border: '1.5px solid #e8e4db',
    borderRadius: '12px',
    padding: '20px 24px',
    marginBottom: '16px',
    fontFamily: "'DM Sans', sans-serif",
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    color: '#8C1D40',
    marginBottom: '12px',
  }

  if (loading) return (
    <div style={{ padding: '40px 24px', fontFamily: "'DM Sans', sans-serif", color: '#9b9b9b' }}>
      Loading billing…
    </div>
  )

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.5px' }}>
          Billing
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif" }}>
          Manage your plan and lead unlocks
        </p>
      </div>

      {/* Current Plan */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Current Plan</div>
        {hasPlan ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '17px', color: '#1a1a1a' }}>
                {PLAN_NAMES[plan.plan_type!]}
              </div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '4px' }}>
                {isLifetime ? 'Lifetime access — never expires' : (
                  plan.status === 'active'
                    ? `Renews ${formatDate(plan.current_period_end)}`
                    : plan.status === 'past_due'
                    ? '⚠️ Payment past due'
                    : 'Cancelled'
                )}
              </div>
            </div>
            <span style={{
              background: isLifetime ? '#fffbeb' : plan.status === 'active' ? '#f0fdf4' : '#fef2f2',
              color: isLifetime ? '#92400e' : plan.status === 'active' ? '#166534' : '#dc2626',
              border: `1px solid ${isLifetime ? '#fde68a' : plan.status === 'active' ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 10px',
            }}>
              {isLifetime ? 'Founding Member ⭐' : plan.status === 'active' ? 'Active' : plan.status === 'past_due' ? 'Past Due' : 'Cancelled'}
            </span>
          </div>
        ) : (
          <div style={{ color: '#9b9b9b', fontSize: '14px' }}>
            No active plan — using pay per lead
          </div>
        )}
      </div>

      {/* Usage */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Usage This Month</div>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#1a1a1a' }}>{unlockCount}</div>
            <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>total leads unlocked</div>
          </div>
        </div>
      </div>

      {/* Lifetime Slots Counter */}
      {slots && (
        <div style={sectionStyle}>
          <div style={labelStyle}>Founding Member Slots</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1, background: '#f5f4f0', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                background: '#8C1D40',
                width: `${(slots.slots_used / slots.total_slots) * 100}%`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ fontSize: '13px', color: '#6b6b6b', fontWeight: 600, whiteSpace: 'nowrap' }}>
              🔥 {slots.total_slots - slots.slots_used} of {slots.total_slots} remaining
            </div>
          </div>
        </div>
      )}

      {/* Upgrade options (if not lifetime) */}
      {!isLifetime && (
        <div style={sectionStyle}>
          <div style={labelStyle}>Upgrade Your Plan</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            {[
              { id: 'single_listing', name: '1 Listing', price: '$29.99/mo', desc: 'Unlimited leads for one listing', highlight: false },
              { id: 'two_listing', name: '2 Listings', price: '$49.99/mo', desc: 'Unlimited leads for any two listings', highlight: true },
            ].map(p => (
              <div key={p.id} style={{
                background: p.highlight ? '#f5f4f0' : '#fff',
                border: p.highlight ? '2px solid #1a1a1a' : '1.5px solid #e8e4db',
                borderRadius: '10px',
                padding: '16px 12px',
                position: 'relative',
                cursor: 'default',
              }}>
                {p.highlight && (
                  <div style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: '#FFC627', color: '#1a1a1a', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                    BEST VALUE
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#1a1a1a' }}>{p.name}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#8C1D40', margin: '4px 0' }}>{p.price}</div>
                <div style={{ fontSize: '12px', color: '#6b6b6b', marginBottom: '12px' }}>{p.desc}</div>
                <a
                  href="/landlord/leads"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    background: '#1a1a1a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '7px',
                    padding: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Start Plan →
                </a>
              </div>
            ))}
          </div>

          {/* Lifetime upsell */}
          <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#1a1a1a' }}>Lifetime Access</div>
              <div style={{ fontSize: '12px', color: '#92400e', marginTop: '2px' }}>
                $299 · One time · {slots ? `${slots.total_slots - slots.slots_used} founding slots left` : 'Limited slots'}
              </div>
            </div>
            <a
              href="/landlord/leads"
              style={{
                display: 'inline-block',
                background: '#8C1D40',
                color: '#fff',
                border: 'none',
                borderRadius: '7px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Claim Lifetime →
            </a>
          </div>
        </div>
      )}

      {/* Manage subscription */}
      {hasPlan && !isLifetime && (
        <div style={sectionStyle}>
          <div style={labelStyle}>Subscription Management</div>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#6b6b6b' }}>
            Update payment method, download invoices, or cancel your subscription.
          </p>
          <button
            onClick={openPortal}
            disabled={portalLoading}
            style={{
              background: portalLoading ? '#c5c1b8' : '#1a1a1a',
              color: '#fff',
              border: 'none',
              borderRadius: '7px',
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              cursor: portalLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {portalLoading ? 'Opening…' : 'Manage Subscription →'}
          </button>
        </div>
      )}
    </div>
  )
}
