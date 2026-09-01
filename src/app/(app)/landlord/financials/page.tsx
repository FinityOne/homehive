'use client'

import { use, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { getCurrentUser } from '@/lib/supabase'
import {
  getPlansForOwner, fmtCurrency, fmtDate, isOverdue, SPECIAL_CATEGORIES,
  type PaymentPlan, type ScheduledPayment, type SpecialPayment,
} from '@/lib/payments'

const PlanWorkspace = dynamic(() => import('@/components/payments/PlanWorkspace'), { ssr: false })

/**
 * Financials — the one place money lives.
 *
 * Rent and one-off charges used to be split between here (a rollup) and the
 * Payments tab of each lease (the actual work), which meant two answers to
 * "what is owed" and no single page to reconcile a month. Now this page is both:
 * the portfolio view, and — at ?plan= — the full ledger for one lease, opened in
 * place. The lease itself stays a click away for the tenancy side of the story:
 * people, paperwork, move-out.
 */

const MONTHS_BACK = 6

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

const catLabel = (c: string) =>
  SPECIAL_CATEGORIES.find(s => s.value === c)?.label ?? 'Charge'

export default function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const { plan: planParam } = use(searchParams)

  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  // Which lease's ledger is open. null = the portfolio rollup.
  const [openPlanId, setOpenPlanId] = useState<string | null>(planParam ?? null)

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return
      getPlansForOwner(user.id).then(data => { setPlans(data); setLoading(false) })
    })
  }, [])

  // Keep the open ledger in the URL so it can be linked, refreshed and shared —
  // and pushed, so Back returns to the rollup rather than leaving the page.
  const openPlan = (id: string | null) => {
    setOpenPlanId(id)
    window.history.pushState(null, '', id ? `/landlord/financials?plan=${id}` : '/landlord/financials')
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const onPop = () => {
      setOpenPlanId(new URLSearchParams(window.location.search).get('plan'))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const today = new Date()
  const thisKey = monthKey(today)
  const allSPs: ScheduledPayment[] = plans.flatMap(p => p.scheduled_payments ?? [])
  const allSpecials: { plan: PaymentPlan; sp: SpecialPayment }[] = plans.flatMap(
    p => (p.special_payments ?? []).map(sp => ({ plan: p, sp }))
  )

  const inMonth = (sp: ScheduledPayment, key: string) => sp.due_date.slice(0, 7) === key
  const thisMonth   = allSPs.filter(sp => inMonth(sp, thisKey))
  const expected    = thisMonth.reduce((s, p) => s + p.amount, 0)
  const collected   = thisMonth.reduce((s, p) => s + p.paid_amount, 0)
  const overdueSPs  = allSPs.filter(p => isOverdue(p))
  const overdueAmt  = overdueSPs.reduce((s, p) => s + (p.amount - p.paid_amount), 0)
  const rate        = expected > 0 ? Math.round((collected / expected) * 100) : null

  // One-off money: deposits, penalties and special charges, across every lease.
  const openSpecials = allSpecials
    .filter(x => x.sp.status === 'pending')
    .sort((a, b) => a.sp.due_date.localeCompare(b.sp.due_date))
  const openSpecialsAmt = openSpecials.reduce((s, x) => s + x.sp.amount, 0)
  const depositsHeld = allSpecials
    .filter(x => x.sp.category === 'security_deposit' && x.sp.status === 'paid')
    .reduce((s, x) => s + x.sp.amount, 0)

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
    const active = plan.tenants.filter(t => t.status === 'active')
    return {
      plan,
      monthExpected: month.reduce((s, p) => s + p.amount, 0),
      monthCollected: month.reduce((s, p) => s + p.paid_amount, 0),
      overdueCount: od.length,
      overdueAmount: od.reduce((s, p) => s + (p.amount - p.paid_amount), 0),
      payers: active.length,
      monthlyTotal: active.reduce((s, t) => s + t.monthly_total, 0),
      openCharges: (plan.special_payments ?? []).filter(s => s.status === 'pending').length,
    }
  }).sort((a, b) => b.overdueAmount - a.overdueAmount || b.monthExpected - a.monthExpected)

  // ── Ledger for one lease, opened in place ────────────────────────────────
  if (openPlanId) {
    const current = plans.find(p => p.id === openPlanId)
    return (
      <>
        <style>{CSS}</style>
        <div className="fin-wrap">
          <div className="fin-crumb">
            <button className="lnk-btn" onClick={() => openPlan(null)}>← Financials</button>
            {current && <span className="crumb-sep">/</span>}
            {current && <span>{current.property?.name ?? current.name}</span>}
          </div>

          <div className="led-head">
            <div>
              <h1 className="fin-title">{current ? (current.property?.name ?? current.name) : 'Rent ledger'}</h1>
              <p className="fin-sub">
                {current ? current.name : 'Loading…'}
                {current?.lease && ` · ${fmtDate(current.lease.start_date)} – ${fmtDate(current.lease.end_date)}`}
              </p>
            </div>
            {current?.lease_id && (
              <a href={`/landlord/leases/${current.lease_id}`} className="btn-lease">
                View lease →
              </a>
            )}
          </div>

          {current?.lease_id && (
            <div className="lease-note">
              Rent, deposits and one-off charges for this tenancy are managed here. The{' '}
              <a href={`/landlord/leases/${current.lease_id}`} className="lnk">lease</a> holds the
              tenancy itself — the people on it, documents and move-out.
            </div>
          )}

          <PlanWorkspace planId={openPlanId} embedded />
        </div>
      </>
    )
  }

  // ── Portfolio rollup ─────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="fin-wrap">
        <div className="fin-head">
          <div>
            <h1 className="fin-title">Financials</h1>
            <p className="fin-sub">Rent, deposits and one-off charges across every lease.</p>
          </div>
          <a href="/landlord/financials/new" className="btn-dark">+ New payment plan</a>
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
            <a href="/landlord/financials/new" className="btn-dark">Create your first plan →</a>
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

            <div className="kpis two">
              <Kpi
                label="One-off charges outstanding"
                value={openSpecials.length > 0 ? `${fmtCurrency(openSpecialsAmt)} · ${openSpecials.length}` : 'None'}
                tone={openSpecials.length > 0 ? 'warn' : 'good'}
              />
              <Kpi label="Deposits held" value={fmtCurrency(depositsHeld)} />
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
                  return (
                    <div
                      key={r.plan.id}
                      className="lease-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => openPlan(r.plan.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlan(r.plan.id) } }}
                    >
                      <div className="lease-main">
                        <div className="lease-name">
                          {r.plan.property?.name ?? r.plan.name}
                          {r.overdueCount > 0 && (
                            <span className="pill-bad">{r.overdueCount} overdue</span>
                          )}
                          {r.overdueCount === 0 && r.monthExpected > 0 && r.monthCollected >= r.monthExpected && (
                            <span className="pill-good">Paid up</span>
                          )}
                          {r.openCharges > 0 && (
                            <span className="pill-warn">{r.openCharges} one-off</span>
                          )}
                        </div>
                        <div className="lease-sub">
                          {r.plan.name} · {r.payers} payer{r.payers !== 1 ? 's' : ''} ·{' '}
                          {fmtCurrency(r.monthlyTotal)}/mo
                          {r.plan.lease_id && (
                            <>
                              {' · '}
                              <a
                                href={`/landlord/leases/${r.plan.lease_id}`}
                                className="lnk"
                                onClick={e => e.stopPropagation()}
                              >
                                lease ↗
                              </a>
                            </>
                          )}
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
                    </div>
                  )
                })}
              </div>
            </div>

            {/* One-off money — deposits, penalties, special charges */}
            <div className="card">
              <div className="card-hd">
                <span className="card-title">Deposits &amp; one-off charges</span>
                <span className="card-note">
                  {openSpecials.length > 0 ? `${fmtCurrency(openSpecialsAmt)} outstanding` : 'Nothing outstanding'}
                </span>
              </div>
              <div className="card-bd" style={{ padding: openSpecials.length ? 0 : undefined }}>
                {openSpecials.length === 0 ? (
                  <div className="muted">
                    Every deposit and one-off charge on file has been settled. New ones are added
                    inside a lease&apos;s ledger, under Special Charges.
                  </div>
                ) : openSpecials.slice(0, 12).map(({ plan, sp }) => {
                  const late = sp.due_date < new Date().toISOString().slice(0, 10)
                  return (
                    <div
                      key={sp.id}
                      className="lease-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => openPlan(plan.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlan(plan.id) } }}
                    >
                      <div className="lease-main">
                        <div className="lease-name">
                          {sp.label}
                          <span className="pill-plain">{catLabel(sp.category)}</span>
                          {late && <span className="pill-bad">past due</span>}
                        </div>
                        <div className="lease-sub">
                          {plan.property?.name ?? plan.name} · due {fmtDate(sp.due_date)}
                          {plan.lease_id && (
                            <>
                              {' · '}
                              <a
                                href={`/landlord/leases/${plan.lease_id}`}
                                className="lnk"
                                onClick={e => e.stopPropagation()}
                              >
                                lease ↗
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="lease-fig">
                        <div className="lease-amt">{fmtCurrency(sp.amount)}</div>
                        <div className="lease-amt-lbl">outstanding</div>
                      </div>
                      <span className="lease-arrow">→</span>
                    </div>
                  )
                })}
                {openSpecials.length > 12 && (
                  <div className="lease-more">+ {openSpecials.length - 12} more inside their leases</div>
                )}
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

  .fin-crumb { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #64748b; margin-bottom: 12px; }
  .crumb-sep { color: #cbd5e1; }
  .led-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
  .btn-lease { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 9px; padding: 9px 15px; font-size: 12.5px; font-weight: 700; color: #0f172a; text-decoration: none; white-space: nowrap; }
  .btn-lease:hover { border-color: #cbd5e1; }
  .lease-note { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 11px 15px; font-size: 12.5px; color: #64748b; line-height: 1.6; margin-bottom: 4px; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
  .kpis.two { grid-template-columns: repeat(2, 1fr); }
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

  .lease-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; text-decoration: none; color: inherit; cursor: pointer; }
  .lease-row:last-child { border-bottom: none; }
  .lease-row:hover { background: #fafbfc; }
  .lease-main { flex: 1; min-width: 0; }
  .lease-name { font-size: 14px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lease-sub { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }
  .lease-fig { text-align: right; white-space: nowrap; }
  .lease-amt { font-size: 13.5px; font-weight: 700; color: #0f172a; }
  .lease-amt-lbl { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
  .lease-arrow { color: #cbd5e1; font-size: 14px; }
  .lease-more { padding: 12px 18px; font-size: 12px; color: #94a3b8; }
  .pill-bad { background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .pill-good { background: #dcfce7; color: #166534; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .pill-warn { background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
  .pill-plain { background: #f1f5f9; color: #475569; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }

  .empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 50px 36px; text-align: center; }
  .empty-icon { font-size: 34px; margin-bottom: 12px; }
  .empty-title { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 7px; }
  .empty-sub { font-size: 13.5px; color: #64748b; line-height: 1.6; max-width: 400px; margin: 0 auto 20px; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 9px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
  .lnk { color: #0284c7; text-decoration: none; font-weight: 600; }
  .lnk:hover { text-decoration: underline; }
  .lnk-btn { background: none; border: none; padding: 0; font-family: inherit; font-size: 13px; color: #64748b; font-weight: 600; cursor: pointer; }
  .lnk-btn:hover { color: #0f172a; }
  .muted { font-size: 13px; color: #94a3b8; line-height: 1.6; }

  @media (max-width: 820px) {
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .lease-fig { display: none; }
  }
`
