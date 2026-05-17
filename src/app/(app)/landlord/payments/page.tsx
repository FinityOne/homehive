'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  getPlansForOwner, fmtCurrency, fmtDate, fmtMonth,
  getEffectiveStatus, isOverdue, type PaymentPlan, type ScheduledPayment,
} from '@/lib/payments'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function thisMonthPayments(sp: ScheduledPayment[]) {
  const now = new Date()
  return sp.filter(p => {
    const d = new Date(p.due_date + 'T00:00:00')
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
}

function planStats(plan: PaymentPlan) {
  const sps = plan.scheduled_payments ?? []
  const thisMonth = thisMonthPayments(sps)
  const overdue   = sps.filter(p => isOverdue(p))
  const monthExpected  = thisMonth.reduce((s, p) => s + p.amount, 0)
  const monthCollected = thisMonth.reduce((s, p) => s + p.paid_amount, 0)
  const leaseTotal     = sps.reduce((s, p) => s + p.amount, 0)
  const leaseCollected = sps.filter(p => p.status === 'paid').reduce((s, p) => s + p.paid_amount, 0)
  return { thisMonth, overdue, monthExpected, monthCollected, leaseTotal, leaseCollected }
}

// ─── STATUS CHIP ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  paid:    { bg: '#dcfce7', color: '#166534', label: 'Paid' },
  partial: { bg: '#fef9c3', color: '#854d0e', label: 'Partial' },
  pending: { bg: '#f0f4f8', color: '#475569', label: 'Pending' },
  late:    { bg: '#fee2e2', color: '#991b1b', label: 'Late' },
  missed:  { bg: '#fce7f3', color: '#9d174d', label: 'Missed' },
}

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', letterSpacing: '0.2px' }}>
      {s.label}
    </span>
  )
}

// ─── PLAN CARD ────────────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: PaymentPlan }) {
  const { overdue, monthExpected, monthCollected } = planStats(plan)
  const allPaid = monthExpected > 0 && monthCollected >= monthExpected
  const hasOverdue = overdue.length > 0
  const totalMonthly = plan.tenants.reduce((s, t) => s + t.monthly_total, 0)

  return (
    <a
      href={`/landlord/payments/${plan.id}`}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        background: '#fff', borderRadius: '14px',
        border: hasOverdue ? '1.5px solid #fca5a5' : '1px solid #e2e8f0',
        padding: '20px 22px', transition: 'box-shadow 0.15s, transform 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)'
        el.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'
        el.style.transform = 'translateY(0)'
      }}
    >
      {/* overdue accent bar */}
      {hasOverdue && (
        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '3px', background: '#ef4444', borderRadius: '14px 0 0 14px' }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{plan.property?.name ?? '—'}</div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>{plan.name}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hasOverdue && (
            <span style={{ background: '#fee2e2', color: '#991b1b', fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px' }}>
              {overdue.length} overdue
            </span>
          )}
          {!hasOverdue && allPaid && monthExpected > 0 && (
            <span style={{ background: '#dcfce7', color: '#166534', fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: '20px' }}>
              This month ✓
            </span>
          )}
        </div>
      </div>

      {/* Lease dates */}
      {plan.lease && (
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: 14 }}>
          {fmtDate(plan.lease.start_date)} – {fmtDate(plan.lease.end_date)}
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <Stat label="Tenants"        value={String(plan.tenants.length)} />
        <Stat label="Monthly total"  value={fmtCurrency(totalMonthly)} />
        <Stat label="This month"     value={monthExpected > 0 ? `${fmtCurrency(monthCollected)} / ${fmtCurrency(monthExpected)}` : '—'} />
        <Stat label="Due on"         value={`${plan.due_day}${ordSuffix(plan.due_day)}`} />
      </div>

      {/* Progress bar */}
      {monthExpected > 0 && (
        <div style={{ marginTop: 14, height: '4px', background: '#f1f5f9', borderRadius: '99px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, (monthCollected / monthExpected) * 100)}%`,
            background: hasOverdue ? '#ef4444' : '#10b981',
            borderRadius: '99px',
            transition: 'width 0.4s',
          }} />
        </div>
      )}
    </a>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{value}</div>
    </div>
  )
}

function ordSuffix(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 4] ?? 'th'
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function PaymentsOverviewPage() {
  const [plans, setPlans]   = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = 'Payments — Landlord | HomeHive' }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      getPlansForOwner(user.id).then(data => { setPlans(data); setLoading(false) })
    })
  }, [])

  // Aggregate stats across all plans
  const today = new Date()
  const allSPs = plans.flatMap(p => p.scheduled_payments ?? [])
  const thisMonthAll = allSPs.filter(p => {
    const d = new Date(p.due_date + 'T00:00:00')
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  })
  const totalExpected  = thisMonthAll.reduce((s, p) => s + p.amount, 0)
  const totalCollected = thisMonthAll.reduce((s, p) => s + p.paid_amount, 0)
  const totalOverdue   = allSPs.filter(p => isOverdue(p)).length

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,wght@0,300;1,300&display=swap');`}</style>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>Rent Payments</h1>
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>Track and manage rent across all your leases</p>
        </div>
        <a
          href="/landlord/payments/new"
          style={{ background: '#0f172a', color: '#fff', fontSize: '13px', fontWeight: 600, padding: '10px 18px', borderRadius: '9px', textDecoration: 'none', flexShrink: 0, transition: 'background 0.15s' }}
        >
          + New payment plan
        </a>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px' }}>

        {/* Stats strip */}
        {!loading && plans.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
            {[
              { label: 'Active plans',      value: String(plans.length), icon: '📋', color: '#6366f1' },
              { label: 'Expected this month', value: fmtCurrency(totalExpected), icon: '💰', color: '#10b981' },
              { label: 'Collected this month', value: fmtCurrency(totalCollected), icon: '✓', color: '#0ea5e9' },
              { label: 'Overdue payments',  value: String(totalOverdue), icon: '⚠', color: totalOverdue > 0 ? '#ef4444' : '#94a3b8' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', borderRadius: '12px', padding: '18px 20px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '22px', marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: s.color, marginBottom: 3 }}>{s.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Overdue alert */}
        {!loading && totalOverdue > 0 && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <div>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#991b1b' }}>
                {totalOverdue} payment{totalOverdue !== 1 ? 's' : ''} overdue
              </span>
              <span style={{ fontSize: '13px', color: '#b91c1c', marginLeft: 8 }}>
                — review the affected plans below and follow up with tenants.
              </span>
            </div>
          </div>
        )}

        {/* Plan cards */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ background: '#fff', borderRadius: '14px', height: 170, border: '1px solid #e2e8f0', animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: 14 }}>💳</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: '22px', fontWeight: 300, color: '#0f172a', marginBottom: 8 }}>No payment plans yet</div>
            <div style={{ fontSize: '14px', color: '#64748b', marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
              Create a payment plan for a lease to start tracking rent from each tenant.
            </div>
            <a href="/landlord/payments/new" style={{ background: '#0f172a', color: '#fff', fontSize: '14px', fontWeight: 600, padding: '12px 24px', borderRadius: '10px', textDecoration: 'none', display: 'inline-block' }}>
              Create your first plan →
            </a>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>
              {plans.length} plan{plans.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
              {plans.map(p => <PlanCard key={p.id} plan={p} />)}
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  )
}
