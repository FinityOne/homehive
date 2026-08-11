'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { amountDue, fmtMoney, METHOD_META, type SettledMethod } from '@/lib/rentPayments'
import type { Payable } from '@/components/tenant/PayRentModal'
import StripeModeBanner from '@/components/StripeModeBanner'

const PayRentModal = dynamic(() => import('@/components/tenant/PayRentModal'), { ssr: false })

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Scheduled = {
  id: string; due_date: string; amount: number; status: string
  paid_amount: number; paid_date: string | null; late_fees_applied: number
  payment_method: string | null; processing_fee: number; notes: string | null
}
type Special = {
  id: string; category: string; label: string; amount: number; due_date: string
  status: string; paid_date: string | null; payment_method: string | null; processing_fee: number
}
type Tenancy = {
  lease: {
    id: string; start_date: string; end_date: string; unit_number: string | null
    rent_amount: number | null
    property: { id: string; name: string; address: string; slug: string } | null
  }
  plan: { id: string; due_day: number; name: string } | null
  lateFeeRule: { grace_period_days: number; fee_amount: number; frequency_days: number; max_total_fees: number | null } | null
  me: { id: string; name: string; monthly_total: number; status: string } | null
  housemateCount: number
  lineItems: { id: string; category: string; label: string; amount: number }[]
  scheduled: Scheduled[]
  specials: Special[]
}

type Tab = 'overview' | 'payments' | 'lease'

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const isSettled = (s: string) => s === 'paid' || s === 'processing'

/**
 * The tenant's own view of their tenancy: what they owe, what they've paid, and
 * how their share of the rent is made up. Everything is scoped to them — a
 * housemate's balance is none of their business.
 */
export default function MyLeasePage() {
  const router = useRouter()
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [active, setActive] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [paying, setPaying] = useState<Payable[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => { document.title = 'My Lease — HomeHive' }, [])

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setToken(session.access_token)
    const res = await fetch('/api/tenant/lease', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const json = await res.json().catch(() => ({}))
    setTenancies(json.tenancies ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => { load() }, [load])

  const t = tenancies[active]

  /**
   * A lease schedules every month up front, so most rows sit unsettled for
   * months. Only what has actually reached its due date is *owed* — billing the
   * whole remaining lease would ask a tenant to prepay a year of rent.
   * Future months are shown separately and can be paid early by choice.
   */
  const { owed, upcoming } = useMemo(() => {
    const owedRows: Payable[] = []
    const futureRows: Payable[] = []
    if (!t) return { owed: owedRows, upcoming: futureRows }

    const today = new Date().toISOString().split('T')[0]

    for (const s of t.scheduled) {
      if (isSettled(s.status)) continue
      const due = amountDue(s)
      if (due <= 0) continue
      const row: Payable = { kind: 'scheduled', id: s.id, label: `Rent — ${fmtDate(s.due_date)}`, amount: due }
      ;(s.due_date <= today ? owedRows : futureRows).push(row)
    }
    for (const s of t.specials) {
      if (s.status !== 'pending' || s.amount <= 0) continue
      const row: Payable = { kind: 'special', id: s.id, label: s.label, amount: s.amount }
      ;(!s.due_date || s.due_date <= today ? owedRows : futureRows).push(row)
    }
    return { owed: owedRows, upcoming: futureRows }
  }, [t])

  const totalOwed = owed.reduce((s, r) => s + r.amount, 0)
  const totalUpcoming = upcoming.reduce((s, r) => s + r.amount, 0)
  // Paying ahead is allowed, but only ever by explicit choice.
  const selectedRows = [...owed, ...upcoming].filter(r => selected.has(`${r.kind}-${r.id}`))
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0)

  const history = useMemo(() => {
    if (!t) return []
    return [
      ...t.scheduled.filter(s => isSettled(s.status)).map(s => ({
        id: s.id, kind: 'Rent', label: `Rent — ${fmtDate(s.due_date)}`,
        amount: s.paid_amount || s.amount, date: s.paid_date, status: s.status,
        method: s.payment_method as SettledMethod | null, fee: s.processing_fee,
      })),
      ...t.specials.filter(s => isSettled(s.status)).map(s => ({
        id: s.id, kind: s.category === 'security_deposit' ? 'Deposit' : 'Charge', label: s.label,
        amount: s.amount, date: s.paid_date, status: s.status,
        method: s.payment_method as SettledMethod | null, fee: s.processing_fee,
      })),
    ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }, [t])

  const toggle = (r: Payable) => {
    const key = `${r.kind}-${r.id}`
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (loading) {
    return <div className="tl-loading">Loading your lease…</div>
  }

  if (!t) {
    return (
      <>
        <style>{CSS}</style>
        <div className="tl-wrap">
          <div className="empty">
            <div className="empty-title">No active lease yet</div>
            <div className="empty-sub">
              Once your landlord adds you to a lease, it appears here with your rent, your payment
              history and the option to pay online.
            </div>
            <a href="/homes" className="btn-dark">Browse homes →</a>
          </div>
        </div>
      </>
    )
  }

  const nextDue = t.scheduled.find(s => !isSettled(s.status))

  return (
    <>
      <style>{CSS}</style>
      <div className="tl-wrap">
        {tenancies.length > 1 && (
          <div className="switcher">
            {tenancies.map((x, i) => (
              <button key={x.lease.id} className={`sw${i === active ? ' on' : ''}`} onClick={() => { setActive(i); setSelected(new Set()) }}>
                {x.lease.property?.name ?? 'Lease'}
              </button>
            ))}
          </div>
        )}

        <div className="head">
          <div>
            <h1 className="title">{t.lease.property?.name ?? 'My lease'}</h1>
            <div className="sub">
              {t.lease.property?.address}
              {t.lease.unit_number ? ` · ${t.lease.unit_number}` : ''}
            </div>
          </div>
          {totalOwed > 0 && (
            <button className="btn-dark lg" onClick={() => { setSelected(new Set(owed.map(r => `${r.kind}-${r.id}`))); setPaying(owed) }}>
              Pay {fmtMoney(totalOwed)}
            </button>
          )}
        </div>

        <StripeModeBanner style={{ marginBottom: 16 }} />

        {flash && <div className="ok">{flash}</div>}

        <div className="figs">
          <Fig label="Balance due" value={fmtMoney(totalOwed)} tone={totalOwed > 0 ? 'bad' : 'good'} />
          <Fig label="Your rent" value={t.me ? `${fmtMoney(t.me.monthly_total)}/mo` : '—'} />
          <Fig label="Next due" value={nextDue ? fmtDate(nextDue.due_date) : 'Nothing due'} />
          <Fig label="Lease ends" value={fmtDate(t.lease.end_date)} />
        </div>

        <div className="tabs">
          {(['overview', 'payments', 'lease'] as Tab[]).map(x => (
            <button key={x} className={`tab${tab === x ? ' on' : ''}`} onClick={() => setTab(x)}>
              {x === 'overview' ? 'Overview' : x === 'payments' ? 'Payments' : 'Lease details'}
            </button>
          ))}
        </div>

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <>
            <div className="card">
              <div className="card-hd"><span className="card-title">What your rent covers</span></div>
              <div className="card-bd">
                {t.lineItems.length === 0 ? (
                  <div className="muted">
                    Your rent is {t.me ? fmtMoney(t.me.monthly_total) : '—'} a month.
                  </div>
                ) : (
                  <>
                    {t.lineItems.map(li => (
                      <div key={li.id} className="row">
                        <span>{li.label}</span>
                        <span className="row-amt">{fmtMoney(li.amount)}</span>
                      </div>
                    ))}
                    <div className="row total">
                      <span>Your monthly total</span>
                      <span className="row-amt">{fmtMoney(t.me?.monthly_total ?? 0)}</span>
                    </div>
                  </>
                )}
                {t.housemateCount > 0 && (
                  <div className="hint" style={{ marginTop: 10 }}>
                    You share this home with {t.housemateCount} other{t.housemateCount !== 1 ? 's' : ''}.
                    You only ever see and pay your own share.
                  </div>
                )}
              </div>
            </div>

            {owed.length > 0 && (
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Due now ({owed.length})</span>
                  <span className="card-note">{fmtMoney(totalOwed)}</span>
                </div>
                {/* Only what has reached its due date — never the whole lease. */}
                <div className="card-bd">
                  {owed.map(r => (
                    <div key={`${r.kind}-${r.id}`} className="row">
                      <span>{r.label}</span>
                      <span className="row-amt">{fmtMoney(r.amount)}</span>
                    </div>
                  ))}
                  <button className="btn-dark" style={{ marginTop: 14 }}
                    onClick={() => { setSelected(new Set(owed.map(x => `${x.kind}-${x.id}`))); setPaying(owed) }}>
                    Pay now
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ PAYMENTS ══ */}
        {tab === 'payments' && (
          <>
            <div className="card">
              <div className="card-hd">
                <span className="card-title">Due now</span>
                {selectedRows.length > 0 && (
                  <button className="btn-dark sm" onClick={() => setPaying(selectedRows)}>
                    Pay {fmtMoney(selectedTotal)}
                  </button>
                )}
              </div>
              <div className="card-bd">
                {owed.length === 0 ? (
                  <div className="muted">
                    You&apos;re all paid up — nothing is due right now.
                    {upcoming.length > 0 && ' Your next rent is listed below.'}
                  </div>
                ) : owed.map(r => {
                  const key = `${r.kind}-${r.id}`
                  return (
                    <label key={key} className="pick">
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(r)} />
                      <span style={{ flex: 1 }}>{r.label}</span>
                      <span className="row-amt">{fmtMoney(r.amount)}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Scheduled ahead — visible for planning, never billed by default. */}
            {upcoming.length > 0 && (
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Upcoming ({upcoming.length})</span>
                  <span className="card-note">{fmtMoney(totalUpcoming)}</span>
                </div>
                <div className="card-bd">
                  <div className="hint" style={{ marginBottom: 10 }}>
                    Not due yet — you don&apos;t need to pay these now. Tick any month to pay ahead.
                  </div>
                  {upcoming.map(r => {
                    const key = `${r.kind}-${r.id}`
                    return (
                      <label key={key} className="pick upcoming">
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(r)} />
                        <span style={{ flex: 1 }}>{r.label}</span>
                        <span className="row-amt">{fmtMoney(r.amount)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-hd">
                <span className="card-title">Payment history ({history.length})</span>
              </div>
              <div className="card-bd">
                {history.length === 0 ? (
                  <div className="muted">No payments recorded yet.</div>
                ) : history.map(h => {
                  const m = h.method ? METHOD_META[h.method] : null
                  return (
                    <div key={`${h.kind}-${h.id}`} className="hist">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hist-label">
                          <span className="kind">{h.kind}</span>
                          {h.label}
                        </div>
                        <div className="hist-sub">
                          {h.status === 'processing' ? 'Clearing — bank transfer in progress' : `Paid ${fmtDate(h.date)}`}
                          {m ? ` · ${m.label}` : ''}
                          {h.fee > 0 ? ` · incl. ${fmtMoney(h.fee)} fee` : ''}
                        </div>
                      </div>
                      <div className="hist-amt">
                        {fmtMoney(h.amount)}
                        {h.status === 'processing' && <span className="clearing">Clearing</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ══ LEASE DETAILS ══ */}
        {tab === 'lease' && (
          <div className="card">
            <div className="card-hd"><span className="card-title">Lease details</span></div>
            <div className="card-bd">
              <div className="row"><span>Property</span><span className="row-amt">{t.lease.property?.name ?? '—'}</span></div>
              <div className="row"><span>Address</span><span className="row-amt">{t.lease.property?.address ?? '—'}</span></div>
              {t.lease.unit_number && <div className="row"><span>Room / unit</span><span className="row-amt">{t.lease.unit_number}</span></div>}
              <div className="row"><span>Term</span><span className="row-amt">{fmtDate(t.lease.start_date)} – {fmtDate(t.lease.end_date)}</span></div>
              <div className="row"><span>Your monthly rent</span><span className="row-amt">{t.me ? fmtMoney(t.me.monthly_total) : '—'}</span></div>
              {t.plan && <div className="row"><span>Rent due</span><span className="row-amt">{t.plan.due_day}{ord(t.plan.due_day)} of each month</span></div>}
              {t.lateFeeRule && (
                <div className="row">
                  <span>Late fees</span>
                  <span className="row-amt">
                    {fmtMoney(t.lateFeeRule.fee_amount)} per {t.lateFeeRule.frequency_days === 1 ? 'day' : `${t.lateFeeRule.frequency_days} days`}
                    {t.lateFeeRule.grace_period_days > 0 ? `, after ${t.lateFeeRule.grace_period_days} days` : ''}
                  </span>
                </div>
              )}
              <div className="hint" style={{ marginTop: 12 }}>
                Questions about your lease? Contact your landlord directly — HomeHive shows what
                they&apos;ve recorded.
              </div>
            </div>
          </div>
        )}
      </div>

      {paying && (
        <PayRentModal
          payables={paying}
          authToken={token}
          onClose={() => setPaying(null)}
          onPaid={(_m, ach) => {
            setPaying(null)
            setSelected(new Set())
            setFlash(ach
              ? 'Payment submitted. Bank transfers take 2–5 business days to clear — it shows as clearing until then.'
              : 'Payment received. Thank you!')
            setTimeout(() => { load(); setFlash(null) }, 6000)
            load()
          }}
        />
      )}
    </>
  )
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="fig">
      <div className="fig-l">{label}</div>
      <div className={`fig-v${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

function ord(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 4] ?? 'th'
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .tl-loading { min-height: 60vh; display: flex; align-items: center; justify-content: center; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #9b9b9b; }
  .tl-wrap { max-width: 780px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }

  .switcher { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .sw { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 20px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; font-family: inherit; }
  .sw.on { background: #0f172a; color: #fff; border-color: #0f172a; }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .sub { font-size: 13px; color: #64748b; margin-top: 3px; }

  .figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .fig { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 15px; }
  .fig-l { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 4px; }
  .fig-v { font-size: 17px; font-weight: 700; color: #0f172a; }
  .fig-v.bad { color: #dc2626; }
  .fig-v.good { color: #059669; }

  .tabs { display: flex; gap: 2px; border-bottom: 1px solid #e2e8f0; margin-bottom: 18px; }
  .tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 11px 16px; font-size: 13.5px; font-weight: 500; color: #64748b; cursor: pointer; font-family: inherit; }
  .tab.on { color: #0f172a; font-weight: 700; border-bottom-color: #0f172a; }

  .card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
  .card-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 17px; border-bottom: 1px solid #f1f5f9; }
  .card-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px; }
  .card-note { font-size: 13px; font-weight: 700; color: #0f172a; }
  .card-bd { padding: 15px 17px; }

  .row { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid #f8fafc; font-size: 13.5px; color: #475569; }
  .row:last-child { border-bottom: none; }
  .row.total { border-top: 1.5px solid #e2e8f0; border-bottom: none; margin-top: 4px; padding-top: 11px; font-weight: 700; color: #0f172a; }
  .row-amt { font-weight: 600; color: #0f172a; text-align: right; }

  .pick { display: flex; align-items: center; gap: 11px; padding: 11px 0; border-bottom: 1px solid #f8fafc; font-size: 13.5px; color: #334155; cursor: pointer; }
  .pick:last-child { border-bottom: none; }
  .pick input { accent-color: #0f172a; width: 16px; height: 16px; cursor: pointer; }
  .pick.upcoming { color: #94a3b8; }
  .pick.upcoming .row-amt { color: #64748b; font-weight: 500; }

  .hist { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid #f8fafc; }
  .hist:last-child { border-bottom: none; }
  .hist-label { font-size: 13.5px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 8px; }
  .kind { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #f1f5f9; color: #64748b; padding: 2px 7px; border-radius: 5px; }
  .hist-sub { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }
  .hist-amt { font-size: 14px; font-weight: 700; color: #0f172a; white-space: nowrap; text-align: right; }
  .clearing { display: block; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #b45309; background: #fef3c7; padding: 2px 7px; border-radius: 20px; margin-top: 3px; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 10px; padding: 11px 20px; font-size: 13.5px; font-weight: 700; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
  .btn-dark.lg { padding: 13px 24px; font-size: 15px; }
  .btn-dark.sm { padding: 7px 14px; font-size: 12.5px; }

  .ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 10px; padding: 12px 15px; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }
  .muted { font-size: 13px; color: #94a3b8; }
  .hint { font-size: 11.5px; color: #94a3b8; line-height: 1.55; }

  .empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 48px 34px; text-align: center; }
  .empty-title { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 8px; }
  .empty-sub { font-size: 13.5px; color: #64748b; line-height: 1.6; max-width: 400px; margin: 0 auto 20px; }

  @media (max-width: 700px) {
    .figs { grid-template-columns: repeat(2, 1fr); }
  }
`
