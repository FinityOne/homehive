'use client'

import { useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/supabase'
import {
  getPlansForOwner, fmtCurrency, isOverdue,
  type PaymentPlan, type ScheduledPayment,
} from '@/lib/payments'

/**
 * Portfolio financials.
 *
 * Deliberately a rollup, not a workspace: it answers "how much is due, how much
 * came in, who is behind" across every lease, then hands off. All the actual
 * rent work — schedules, marking paid, charges — happens inside the lease it
 * belongs to, so there's one place per tenancy rather than two.
 */

const MONTHS_BACK = 6

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

export default function FinancialsPage() {
  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return
      getPlansForOwner(user.id).then(data => { setPlans(data); setLoading(false) })
    })
  }, [])

  const today = new Date()
  const thisKey = monthKey(today)
  const allSPs: ScheduledPayment[] = plans.flatMap(p => p.scheduled_payments ?? [])

  const inMonth = (sp: ScheduledPayment, key: string) => sp.due_date.slice(0, 7) === key
  const thisMonth   = allSPs.filter(sp => inMonth(sp, thisKey))
  const expected    = thisMonth.reduce((s, p) => s + p.amount, 0)
  const collected   = thisMonth.reduce((s, p) => s + p.paid_amount, 0)
  const overdueSPs  = allSPs.filter(p => isOverdue(p))
  const overdueAmt  = overdueSPs.reduce((s, p) => s + (p.amount - p.paid_amount), 0)
  const rate        = expected > 0 ? Math.round((collected / expected) * 100) : null

  // Six-month collection history — the trend that tells you if things are slipping.
  const history = Array.from({ length: MONTHS_BACK }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (MONTHS_BACK - 1 - i), 1)
    const key = monthKey(d)
    const rows = allSPs.filter(sp => inMonth(sp, key))
    return {
      key,
      label: monthLabel(key),
      expected: rows.reduce((s, p) => s + p.amount, 0),
      collected: rows.reduce((s, p) => s + p.paid_amount, 0),
    }
  })
  const peak = Math.max(1, ...history.map(h => h.expected))

  // One row per lease, worst first — the landlord's follow-up list.
  const rows = plans.map(plan => {
    const sps = plan.scheduled_payments ?? []
    const month = sps.filter(sp => inMonth(sp, thisKey))
    const od = sps.filter(p => isOverdue(p))
    return {
      plan,
      monthExpected: month.reduce((s, p) => s + p.amount, 0),
      monthCollected: month.reduce((s, p) => s + p.paid_amount, 0),
      overdueCount: od.length,
      overdueAmount: od.reduce((s, p) => s + (p.amount - p.paid_amount), 0),
      monthlyTotal: plan.tenants.filter(t => t.status === 'active').reduce((s, t) => s + t.monthly_total, 0),
    }
  }).sort((a, b) => b.overdueAmount - a.overdueAmount || b.monthExpected - a.monthExpected)

  return (
    <>
      <style>{CSS}</style>
      <div className="fin-wrap">
        <div className="fin-head">
          <div>
            <h1 className="fin-title">Financials</h1>
            <p className="fin-sub">Rent across every lease. Open a lease to work its ledger.</p>
          </div>
          <a href="/landlord/payments/new" className="btn-dark">+ New payment plan</a>
        </div>

        {loading ? (
          <div className="muted">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">💳</div>
            <div className="empty-title">No rent being tracked yet</div>
            <div className="empty-sub">
              Set up a payment plan against a lease to schedule rent, track who has paid, and record
              deposits and one-off charges.
            </div>
            <a href="/landlord/payments/new" className="btn-dark">Create your first plan →</a>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="kpis">
              <Kpi label="Expected this month" value={fmtCurrency(expected)} />
              <Kpi label="Collected this month" value={fmtCurrency(collected)} tone="good" />
              <Kpi
                label="Outstanding"
                value={fmtCurrency(Math.max(0, expected - collected))}
                tone={expected - collected > 0 ? 'warn' : undefined}
              />
              <Kpi
                label="Overdue"
                value={overdueSPs.length > 0 ? `${fmtCurrency(overdueAmt)} · ${overdueSPs.length}` : 'None'}
                tone={overdueSPs.length > 0 ? 'bad' : 'good'}
              />
            </div>

            {rate !== null && (
              <div className="rate">
                <div className="rate-top">
                  <span className="rate-label">Collection rate this month</span>
                  <span className="rate-val">{rate}%</span>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${Math.min(100, rate)}%`, background: rate >= 95 ? '#10b981' : rate >= 70 ? '#f59e0b' : '#ef4444' }} />
                </div>
              </div>
            )}

            {/* Trend */}
            <div className="card">
              <div className="card-hd"><span className="card-title">Collected vs expected</span></div>
              <div className="card-bd">
                <div className="chart">
                  {history.map(h => {
                    const pct = h.expected > 0 ? Math.round((h.collected / h.expected) * 100) : null
                    return (
                      <div key={h.key} className="col">
                        <div className="col-stack" title={`${fmtCurrency(h.collected)} of ${fmtCurrency(h.expected)}`}>
                          <div className="col-exp" style={{ height: `${(h.expected / peak) * 100}%` }}>
                            <div className="col-col" style={{ height: `${h.expected > 0 ? (h.collected / h.expected) * 100 : 0}%` }} />
                          </div>
                        </div>
                        <div className="col-pct">{pct === null ? '—' : `${pct}%`}</div>
                        <div className="col-label">{h.label}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="legend">
                  <span><i className="sw sw-col" /> Collected</span>
                  <span><i className="sw sw-exp" /> Expected</span>
                </div>
              </div>
            </div>

            {/* Per-lease rollup */}
            <div className="card">
              <div className="card-hd">
                <span className="card-title">By lease ({rows.length})</span>
                <span className="card-note">Sorted by what needs chasing</span>
              </div>
              <div className="card-bd" style={{ padding: 0 }}>
                {rows.map(r => {
                  const pct = r.monthExpected > 0 ? (r.monthCollected / r.monthExpected) * 100 : 0
                  const href = r.plan.lease_id
                    ? `/landlord/leases/${r.plan.lease_id}?tab=payments`
                    : `/landlord/payments/${r.plan.id}`
                  return (
                    <a key={r.plan.id} href={href} className="lease-row">
                      <div className="lease-main">
                        <div className="lease-name">
                          {r.plan.property?.name ?? r.plan.name}
                          {r.overdueCount > 0 && (
                            <span className="pill-bad">{r.overdueCount} overdue</span>
                          )}
                          {r.overdueCount === 0 && r.monthExpected > 0 && r.monthCollected >= r.monthExpected && (
                            <span className="pill-good">Paid up</span>
                          )}
                        </div>
                        <div className="lease-sub">
                          {r.plan.name} · {r.plan.tenants.filter(t => t.status === 'active').length} payer
                          {r.plan.tenants.filter(t => t.status === 'active').length !== 1 ? 's' : ''} ·{' '}
                          {fmtCurrency(r.monthlyTotal)}/mo
                        </div>
                        {r.monthExpected > 0 && (
                          <div className="bar sm">
                            <div className="bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: r.overdueCount > 0 ? '#ef4444' : '#10b981' }} />
                          </div>
                        )}
                      </div>
                      <div className="lease-fig">
                        <div className="lease-amt">
                          {r.monthExpected > 0 ? `${fmtCurrency(r.monthCollected)} / ${fmtCurrency(r.monthExpected)}` : '—'}
                        </div>
                        <div className="lease-amt-lbl">
                          {r.overdueAmount > 0 ? `${fmtCurrency(r.overdueAmount)} overdue` : 'this month'}
                        </div>
                      </div>
                      <span className="lease-arrow">→</span>
                    </a>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-val${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .fin-wrap { max-width: 1000px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .fin-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
  .fin-title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .fin-sub { font-size: 13px; color: #64748b; margin-top: 3px; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
  .kpi { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 15px 17px; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 5px; }
  .kpi-val { font-size: 20px; font-weight: 700; color: #0f172a; }
  .kpi-val.good { color: #059669; }
  .kpi-val.bad { color: #dc2626; }
  .kpi-val.warn { color: #b45309; }

  .rate { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 17px; margin-bottom: 16px; }
  .rate-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .rate-label { font-size: 12px; font-weight: 600; color: #64748b; }
  .rate-val { font-size: 17px; font-weight: 700; color: #0f172a; }
  .bar { height: 6px; background: #f1f5f9; border-radius: 99px; overflow: hidden; }
  .bar.sm { height: 4px; margin-top: 7px; max-width: 260px; }
  .bar-fill { height: 100%; border-radius: 99px; background: #10b981; }

  .card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
  .card-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 18px; border-bottom: 1px solid #f1f5f9; }
  .card-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px; }
  .card-note { font-size: 11.5px; color: #94a3b8; }
  .card-bd { padding: 16px 18px; }

  .chart { display: flex; align-items: flex-end; gap: 14px; height: 150px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .col-stack { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
  .col-exp { width: 100%; max-width: 54px; background: #eef2f7; border-radius: 6px 6px 0 0; display: flex; align-items: flex-end; min-height: 3px; }
  .col-col { width: 100%; background: #10b981; border-radius: 6px 6px 0 0; }
  .col-pct { font-size: 10.5px; font-weight: 700; color: #64748b; margin-top: 6px; }
  .col-label { font-size: 11px; color: #94a3b8; margin-top: 1px; }
  .legend { display: flex; gap: 16px; margin-top: 12px; font-size: 11.5px; color: #94a3b8; }
  .legend span { display: flex; align-items: center; gap: 6px; }
  .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .sw-col { background: #10b981; }
  .sw-exp { background: #eef2f7; }

  .lease-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; text-decoration: none; color: inherit; }
  .lease-row:last-child { border-bottom: none; }
  .lease-row:hover { background: #fafbfc; }
  .lease-main { flex: 1; min-width: 0; }
  .lease-name { font-size: 14px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lease-sub { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }
  .lease-fig { text-align: right; white-space: nowrap; }
  .lease-amt { font-size: 13.5px; font-weight: 700; color: #0f172a; }
  .lease-amt-lbl { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
  .lease-arrow { color: #cbd5e1; font-size: 14px; }
  .pill-bad { background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .pill-good { background: #dcfce7; color: #166534; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }

  .empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 50px 36px; text-align: center; }
  .empty-icon { font-size: 34px; margin-bottom: 12px; }
  .empty-title { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 7px; }
  .empty-sub { font-size: 13.5px; color: #64748b; line-height: 1.6; max-width: 400px; margin: 0 auto 20px; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 9px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
  .muted { font-size: 13px; color: #94a3b8; }

  @media (max-width: 820px) {
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .lease-fig { display: none; }
  }
`
