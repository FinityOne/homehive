'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { getCurrentUser, supabase } from '@/lib/supabase'
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
 *
 * The rollup is organised around one question at a time. Six equal-weight KPIs
 * stacked above two long lists asked the landlord to decide what mattered before
 * they could read anything; now a single figure answers "how exposed am I right
 * now", and everything else sits behind a segmented control. Nothing was
 * removed — it is the same data, disclosed in the order it gets used.
 */

const MONTHS_BACK = 6

type View = 'overview' | 'leases' | 'charges' | 'activity'
const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'leases',   label: 'Leases' },
  { id: 'charges',  label: 'Charges' },
  { id: 'activity', label: 'Activity' },
]

/** One payment request, as the portfolio log returns it. */
type SentEmail = {
  id: string
  plan_id: string
  plan_label: string
  recipient_email: string
  recipient_name: string | null
  subject: string
  status: 'sent' | 'failed'
  error: string | null
  amount_total: number
  created_at: string
  items: { label: string; due_date: string; amount: number; kind: 'rent' | 'charge' }[]
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

const catLabel = (c: string) =>
  SPECIAL_CATEGORIES.find(s => s.value === c)?.label ?? 'Charge'

/** "2 hours ago" / "Aug 12" — recent things get relative time, older get a date. */
export function whenLabel(iso: string): string {
  const then = new Date(iso)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (mins < 1)    return 'Just now'
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; view?: string }>
}) {
  const { plan: planParam, view: viewParam } = use(searchParams)

  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)
  // Which lease's ledger is open. null = the portfolio rollup.
  const [openPlanId, setOpenPlanId] = useState<string | null>(planParam ?? null)
  const [view, setView] = useState<View>(
    VIEWS.some(v => v.id === viewParam) ? (viewParam as View) : 'overview'
  )

  const [emails, setEmails] = useState<SentEmail[] | null>(null)
  // A ref, not state: this only guards against a second fetch, and flipping
  // state synchronously inside the effect would cascade a render for nothing.
  const emailsRequested = useRef(false)

  useEffect(() => { document.title = 'Financials — Landlord | HomeHive' }, [])

  // The portfolio log is only fetched once the landlord asks for it — it is the
  // one section here that costs a round trip nobody else needs.
  const loadEmails = useCallback(async () => {
    if (emailsRequested.current) return
    emailsRequested.current = true
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/payments/emails', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const json = await res.json()
      setEmails(res.ok ? (json.emails ?? []) : [])
    } catch {
      setEmails([])
    }
  }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return
      getPlansForOwner(user.id).then(data => { setPlans(data); setLoading(false) })
      // Deep-linked straight to ?view=activity — nothing will click for us.
      if (viewParam === 'activity') loadEmails()
    })
  }, [viewParam, loadEmails])

  // Keep the open ledger in the URL so it can be linked, refreshed and shared —
  // and pushed, so Back returns to the rollup rather than leaving the page.
  const openPlan = (id: string | null) => {
    setOpenPlanId(id)
    window.history.pushState(null, '', id ? `/landlord/financials?plan=${id}` : '/landlord/financials')
    window.scrollTo({ top: 0 })
  }

  // The section is a replace, not a push: flicking between tabs should not fill
  // the back stack with places the landlord never meant to go.
  const selectView = (v: View) => {
    setView(v)
    if (v === 'activity') loadEmails()
    window.history.replaceState(null, '', v === 'overview' ? '/landlord/financials' : `/landlord/financials?view=${v}`)
  }

  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search)
      setOpenPlanId(q.get('plan'))
      const v = q.get('view')
      setView(VIEWS.some(x => x.id === v) ? (v as View) : 'overview')
      if (v === 'activity') loadEmails()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [loadEmails])

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
  const outstanding = Math.max(0, expected - collected)
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
          <button className="back" onClick={() => openPlan(null)}>
            <span className="back-chev" aria-hidden="true" />
            Financials
          </button>

          <header className="led-head">
            <div className="led-head-main">
              <h1 className="title">{current ? (current.property?.name ?? current.name) : 'Rent ledger'}</h1>
              <p className="sub">
                {current ? current.name : 'Loading…'}
                {current?.lease && ` · ${fmtDate(current.lease.start_date)} – ${fmtDate(current.lease.end_date)}`}
              </p>
            </div>
            {current?.lease_id && (
              <a href={`/landlord/leases/${current.lease_id}`} className="btn-quiet">View lease</a>
            )}
          </header>

          {current?.lease_id && (
            <p className="led-note">
              Rent, deposits and one-off charges live here. The{' '}
              <a href={`/landlord/leases/${current.lease_id}`} className="lnk">lease</a> holds the
              tenancy itself — people, documents and move-out.
            </p>
          )}

          <PlanWorkspace planId={openPlanId} embedded />
        </div>
      </>
    )
  }

  // ── Portfolio rollup ─────────────────────────────────────────────────────
  const heroTone = overdueAmt > 0 ? 'bad' : outstanding > 0 ? 'warn' : 'good'

  return (
    <>
      <style>{CSS}</style>
      <div className="fin-wrap">
        <header className="fin-head">
          <div>
            <h1 className="title">Financials</h1>
            <p className="sub">Rent, deposits and one-off charges across every lease.</p>
          </div>
          <a href="/landlord/financials/new" className="btn-primary">New plan</a>
        </header>

        {loading ? (
          <div className="skeleton-hero" />
        ) : plans.length === 0 ? (
          <div className="empty">
            <div className="empty-title">No rent being tracked yet</div>
            <p className="empty-sub">
              Set up a payment plan against a lease to schedule rent, track who has paid, and record
              deposits and one-off charges.
            </p>
            <a href="/landlord/financials/new" className="btn-primary">Create your first plan</a>
          </div>
        ) : (
          <>
            {/* The one figure worth leading with: what is still owed right now. */}
            <section className="hero">
              <div className="hero-label">
                {outstanding > 0 ? 'Outstanding this month' : 'Collected this month'}
              </div>
              <div className={`hero-value ${heroTone}`}>
                {fmtCurrency(outstanding > 0 ? outstanding : collected)}
              </div>
              <div className="hero-meta">
                {expected > 0 ? (
                  <>
                    {fmtCurrency(collected)} of {fmtCurrency(expected)} collected
                    {rate !== null && <> · {rate}%</>}
                  </>
                ) : 'Nothing scheduled this month'}
              </div>
              {expected > 0 && (
                <div className="hero-bar">
                  <div
                    className="hero-bar-fill"
                    style={{ width: `${Math.min(100, rate ?? 0)}%` }}
                    data-tone={heroTone}
                  />
                </div>
              )}
              {overdueAmt > 0 && (
                <button className="hero-alert" onClick={() => selectView('leases')}>
                  {fmtCurrency(overdueAmt)} overdue across {overdueSPs.length} payment
                  {overdueSPs.length !== 1 ? 's' : ''}
                  <span className="hero-alert-chev" aria-hidden="true" />
                </button>
              )}
            </section>

            {/* Segmented control — one question on screen at a time. */}
            <div className="seg" role="tablist" aria-label="Financials sections">
              {VIEWS.map(v => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  className={`seg-btn${view === v.id ? ' on' : ''}`}
                  onClick={() => selectView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {view === 'overview' && (
              <>
                <div className="stat-row">
                  <Stat label="Overdue" value={overdueSPs.length > 0 ? fmtCurrency(overdueAmt) : 'None'} tone={overdueSPs.length > 0 ? 'bad' : 'good'} />
                  <Stat label="One-off charges" value={openSpecials.length > 0 ? fmtCurrency(openSpecialsAmt) : 'None'} tone={openSpecials.length > 0 ? 'warn' : 'good'} />
                  <Stat label="Deposits held" value={fmtCurrency(depositsHeld)} />
                </div>

                <section className="panel">
                  <div className="panel-hd">
                    <h2 className="panel-title">Collected vs expected</h2>
                    <span className="panel-note">Last {MONTHS_BACK} months</span>
                  </div>
                  <div className="panel-bd">
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
                  </div>
                </section>
              </>
            )}

            {view === 'leases' && (
              <section className="panel">
                <div className="panel-hd">
                  <h2 className="panel-title">By lease</h2>
                  <span className="panel-note">{rows.length} · sorted by what needs chasing</span>
                </div>
                <div className="panel-bd flush">
                  {rows.map(r => {
                    const pct = r.monthExpected > 0 ? (r.monthCollected / r.monthExpected) * 100 : 0
                    return (
                      <div
                        key={r.plan.id}
                        className="row"
                        role="button"
                        tabIndex={0}
                        onClick={() => openPlan(r.plan.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlan(r.plan.id) } }}
                      >
                        <div className="row-main">
                          <div className="row-name">
                            {r.plan.property?.name ?? r.plan.name}
                            {r.overdueCount > 0 && <span className="pill bad">{r.overdueCount} overdue</span>}
                            {r.overdueCount === 0 && r.monthExpected > 0 && r.monthCollected >= r.monthExpected && (
                              <span className="pill good">Paid up</span>
                            )}
                            {r.openCharges > 0 && <span className="pill warn">{r.openCharges} one-off</span>}
                          </div>
                          <div className="row-sub">
                            {r.plan.name} · {r.payers} payer{r.payers !== 1 ? 's' : ''} · {fmtCurrency(r.monthlyTotal)}/mo
                            {r.plan.lease_id && (
                              <>
                                {' · '}
                                <a href={`/landlord/leases/${r.plan.lease_id}`} className="lnk" onClick={e => e.stopPropagation()}>lease</a>
                              </>
                            )}
                          </div>
                          {r.monthExpected > 0 && (
                            <div className="mini-bar">
                              <div className="mini-fill" data-tone={r.overdueCount > 0 ? 'bad' : 'good'} style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                          )}
                        </div>
                        <div className="row-fig">
                          <div className="row-amt">
                            {r.monthExpected > 0 ? `${fmtCurrency(r.monthCollected)} / ${fmtCurrency(r.monthExpected)}` : '—'}
                          </div>
                          <div className="row-amt-lbl">
                            {r.overdueAmount > 0 ? `${fmtCurrency(r.overdueAmount)} overdue` : 'this month'}
                          </div>
                        </div>
                        <span className="row-chev" aria-hidden="true" />
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {view === 'charges' && (
              <section className="panel">
                <div className="panel-hd">
                  <h2 className="panel-title">Deposits &amp; one-off charges</h2>
                  <span className="panel-note">
                    {openSpecials.length > 0 ? `${fmtCurrency(openSpecialsAmt)} outstanding` : 'Nothing outstanding'}
                  </span>
                </div>
                <div className={`panel-bd${openSpecials.length ? ' flush' : ''}`}>
                  {openSpecials.length === 0 ? (
                    <p className="muted">
                      Every deposit and one-off charge on file has been settled. New ones are added
                      inside a lease&apos;s ledger, under Charges.
                    </p>
                  ) : openSpecials.slice(0, 12).map(({ plan, sp }) => {
                    const late = sp.due_date < new Date().toISOString().slice(0, 10)
                    return (
                      <div
                        key={sp.id}
                        className="row"
                        role="button"
                        tabIndex={0}
                        onClick={() => openPlan(plan.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlan(plan.id) } }}
                      >
                        <div className="row-main">
                          <div className="row-name">
                            {sp.label}
                            <span className="pill plain">{catLabel(sp.category)}</span>
                            {late && <span className="pill bad">past due</span>}
                          </div>
                          <div className="row-sub">
                            {plan.property?.name ?? plan.name} · due {fmtDate(sp.due_date)}
                          </div>
                        </div>
                        <div className="row-fig">
                          <div className="row-amt">{fmtCurrency(sp.amount)}</div>
                          <div className="row-amt-lbl">outstanding</div>
                        </div>
                        <span className="row-chev" aria-hidden="true" />
                      </div>
                    )
                  })}
                  {openSpecials.length > 12 && (
                    <div className="row-more">+ {openSpecials.length - 12} more inside their leases</div>
                  )}
                </div>
              </section>
            )}

            {view === 'activity' && (
              <section className="panel">
                <div className="panel-hd">
                  <h2 className="panel-title">Payment requests sent</h2>
                  <span className="panel-note">
                    {emails === null ? '' : `${emails.length} across every lease`}
                  </span>
                </div>
                <div className={`panel-bd${emails && emails.length ? ' flush' : ''}`}>
                  {emails === null ? (
                    <p className="muted">Loading…</p>
                  ) : emails.length === 0 ? (
                    <p className="muted">
                      No payment requests sent yet. Chasing rent or a deposit from a lease&apos;s
                      ledger records it here, so you can see who was asked, for what, and when.
                    </p>
                  ) : emails.map(e => (
                    <div key={e.id} className="row static">
                      <div className="row-main">
                        <div className="row-name">
                          {e.recipient_name || e.recipient_email}
                          {e.status === 'failed'
                            ? <span className="pill bad">not delivered</span>
                            : <span className="pill good">sent</span>}
                        </div>
                        <div className="row-sub">
                          {e.plan_label} · {e.items.map(i => i.label).join(', ') || e.subject}
                        </div>
                        {e.status === 'failed' && e.error && (
                          <div className="row-err">{e.error}</div>
                        )}
                      </div>
                      <div className="row-fig">
                        <div className="row-amt">{fmtCurrency(e.amount_total)}</div>
                        <div className="row-amt-lbl">{whenLabel(e.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-val${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* A restrained palette and a lot of air: one accent, hairline separators,
     and figures set in tabular numerals so columns of money line up. */
  .fin-wrap {
    --ink:      #1d1d1f;
    --ink-2:    #6e6e73;
    --ink-3:    #8e8e93;
    --line:     #e5e5ea;
    --surface:  #ffffff;
    --accent:   #0071e3;
    --good:     #1d8a4e;
    --warn:     #b25000;
    --bad:      #d13b30;
    max-width: 940px; margin: 0 auto; padding: 32px 22px 96px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }

  .title { font-size: 30px; font-weight: 600; letter-spacing: -0.022em; line-height: 1.15; }
  .sub   { font-size: 14px; color: var(--ink-2); margin-top: 5px; letter-spacing: -0.01em; }

  .fin-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 26px; }

  .btn-primary {
    background: var(--accent); color: #fff; border: none; border-radius: 980px;
    padding: 9px 18px; font-size: 14px; font-weight: 500; font-family: inherit;
    cursor: pointer; text-decoration: none; display: inline-block; white-space: nowrap;
    letter-spacing: -0.01em; transition: opacity 0.15s;
  }
  .btn-primary:hover { opacity: 0.85; }
  .btn-quiet {
    background: none; border: none; color: var(--accent); font-size: 14px;
    text-decoration: none; white-space: nowrap; letter-spacing: -0.01em; cursor: pointer;
    font-family: inherit; padding: 0;
  }
  .btn-quiet:hover { text-decoration: underline; }

  /* ── Back affordance ── */
  .back {
    display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
    padding: 0; margin-bottom: 16px; cursor: pointer; font-family: inherit;
    font-size: 14px; color: var(--accent); letter-spacing: -0.01em;
  }
  .back-chev {
    width: 7px; height: 7px; border-left: 1.7px solid currentColor; border-bottom: 1.7px solid currentColor;
    transform: rotate(45deg); display: inline-block;
  }
  .back:hover { text-decoration: underline; }

  .led-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .led-head-main { min-width: 0; }
  .led-note {
    font-size: 13px; color: var(--ink-2); line-height: 1.6; margin-bottom: 18px;
    letter-spacing: -0.01em;
  }

  /* ── Hero: the single number ── */
  .hero {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 30px 28px 26px; margin-bottom: 22px;
  }
  .hero-label {
    font-size: 13px; font-weight: 500; color: var(--ink-2);
    letter-spacing: -0.01em; margin-bottom: 8px;
  }
  .hero-value {
    font-size: 52px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.02;
    font-variant-numeric: tabular-nums; color: var(--ink);
  }
  .hero-value.good { color: var(--good); }
  .hero-value.warn { color: var(--ink); }
  .hero-value.bad  { color: var(--bad); }
  .hero-meta {
    font-size: 14px; color: var(--ink-2); margin-top: 10px;
    letter-spacing: -0.01em; font-variant-numeric: tabular-nums;
  }
  .hero-bar { height: 4px; background: #f0f0f2; border-radius: 99px; overflow: hidden; margin-top: 18px; }
  .hero-bar-fill { height: 100%; border-radius: 99px; background: var(--good); transition: width 0.4s cubic-bezier(0.4,0,0.2,1); }
  .hero-bar-fill[data-tone="bad"]  { background: var(--bad); }
  .hero-bar-fill[data-tone="warn"] { background: #e8a33d; }

  .hero-alert {
    display: flex; align-items: center; gap: 6px; margin-top: 18px;
    background: none; border: none; padding: 0; cursor: pointer; font-family: inherit;
    font-size: 13.5px; font-weight: 500; color: var(--bad); letter-spacing: -0.01em;
  }
  .hero-alert-chev {
    width: 6px; height: 6px; border-top: 1.7px solid currentColor; border-right: 1.7px solid currentColor;
    transform: rotate(45deg); display: inline-block;
  }
  .hero-alert:hover { text-decoration: underline; }

  /* ── Segmented control ── */
  .seg {
    display: inline-flex; background: #f0f0f2; border-radius: 10px; padding: 2px;
    margin-bottom: 22px; gap: 2px; max-width: 100%; overflow-x: auto;
  }
  .seg-btn {
    border: none; background: none; font-family: inherit; cursor: pointer;
    padding: 7px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 500;
    color: var(--ink-2); letter-spacing: -0.01em; white-space: nowrap;
    transition: background 0.18s, color 0.18s, box-shadow 0.18s;
  }
  .seg-btn:hover { color: var(--ink); }
  .seg-btn.on {
    background: var(--surface); color: var(--ink);
    box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(0,0,0,0.04);
  }

  /* ── Secondary stats ── */
  .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 22px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
  .stat-label { font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em; margin-bottom: 6px; }
  .stat-val { font-size: 21px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat-val.good { color: var(--good); }
  .stat-val.bad  { color: var(--bad); }
  .stat-val.warn { color: var(--warn); }

  /* ── Panels ── */
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; margin-bottom: 20px; overflow: hidden; }
  .panel-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 18px 22px 14px; }
  .panel-title { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
  .panel-note { font-size: 12.5px; color: var(--ink-3); letter-spacing: -0.01em; text-align: right; }
  .panel-bd { padding: 4px 22px 20px; }
  .panel-bd.flush { padding: 0; }

  /* ── Chart ── */
  .chart { display: flex; align-items: flex-end; gap: 16px; height: 150px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .col-stack { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
  .col-exp { width: 100%; max-width: 46px; background: #f0f0f2; border-radius: 7px 7px 0 0; display: flex; align-items: flex-end; min-height: 3px; }
  .col-col { width: 100%; background: var(--good); border-radius: 7px 7px 0 0; }
  .col-pct { font-size: 11.5px; font-weight: 500; color: var(--ink-2); margin-top: 8px; font-variant-numeric: tabular-nums; }
  .col-label { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }

  /* ── Rows ── */
  .row {
    display: flex; align-items: center; gap: 14px; padding: 15px 22px;
    border-top: 1px solid var(--line); text-decoration: none; color: inherit; cursor: pointer;
    transition: background 0.12s;
  }
  .row:first-child { border-top: none; }
  .row:hover { background: #fafafa; }
  .row.static { cursor: default; }
  .row.static:hover { background: none; }
  .row-main { flex: 1; min-width: 0; }
  .row-name { font-size: 14.5px; font-weight: 500; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row-sub { font-size: 12.5px; color: var(--ink-2); margin-top: 3px; letter-spacing: -0.01em; }
  .row-err { font-size: 12px; color: var(--bad); margin-top: 3px; }
  .row-fig { text-align: right; white-space: nowrap; }
  .row-amt { font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .row-amt-lbl { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
  .row-chev {
    width: 7px; height: 7px; border-top: 1.6px solid #c7c7cc; border-right: 1.6px solid #c7c7cc;
    transform: rotate(45deg); flex-shrink: 0;
  }
  .row-more { padding: 14px 22px; font-size: 12.5px; color: var(--ink-3); border-top: 1px solid var(--line); }
  .mini-bar { height: 3px; background: #f0f0f2; border-radius: 99px; overflow: hidden; margin-top: 8px; max-width: 240px; }
  .mini-fill { height: 100%; border-radius: 99px; background: var(--good); }
  .mini-fill[data-tone="bad"] { background: var(--bad); }

  /* ── Pills ── */
  .pill { font-size: 11px; font-weight: 500; padding: 2px 9px; border-radius: 980px; letter-spacing: -0.005em; }
  .pill.bad   { background: #fdeceb; color: var(--bad); }
  .pill.good  { background: #e8f5ed; color: var(--good); }
  .pill.warn  { background: #fdf1e3; color: var(--warn); }
  .pill.plain { background: #f0f0f2; color: var(--ink-2); }

  /* ── Empty / loading ── */
  .empty { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 56px 36px; text-align: center; }
  .empty-title { font-size: 19px; font-weight: 600; letter-spacing: -0.015em; margin-bottom: 8px; }
  .empty-sub { font-size: 14px; color: var(--ink-2); line-height: 1.6; max-width: 400px; margin: 0 auto 22px; letter-spacing: -0.01em; }
  .skeleton-hero { height: 190px; border-radius: 18px; background: linear-gradient(90deg,#f2f2f4,#f7f7f9,#f2f2f4); background-size: 200% 100%; animation: sk 1.4s ease-in-out infinite; }
  @keyframes sk { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

  .lnk { color: var(--accent); text-decoration: none; }
  .lnk:hover { text-decoration: underline; }
  .muted { font-size: 13.5px; color: var(--ink-2); line-height: 1.6; letter-spacing: -0.01em; }

  @media (max-width: 720px) {
    .fin-wrap { padding: 24px 16px 90px; }
    .title { font-size: 26px; }
    .hero-value { font-size: 42px; }
    .stat-row { grid-template-columns: 1fr; }
    .row-fig { display: none; }
    .seg { display: flex; width: 100%; }
    .seg-btn { flex: 1; }
  }
`
