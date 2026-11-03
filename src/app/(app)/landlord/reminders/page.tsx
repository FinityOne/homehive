'use client'

/**
 * Reminders — every email the platform has sent a tenant about money.
 *
 * Before this page the only trace a reminder left on screen was a counter on
 * the charge: "reminded 2×". That tells a landlord they did something and
 * nothing else — not when, not to which address, not whether either message
 * arrived. And the automatic seven-day notices left no trace at all, so a
 * tenant who had already been written to looked like one nobody had contacted.
 *
 * So this is a log of sends, newest first, and the thing it insists on saying
 * is the **outcome**: delivered, opened, bounced, refused, marked as spam. That
 * distinction is the entire value of the page. A landlord with a tenant who
 * "never replies to anything" needs to know the address has been bouncing since
 * August, and no counter can ever tell them that.
 *
 * It lives beside Financials rather than inside it on purpose. Financials is
 * money, read at a glance; this is correspondence, read when something has gone
 * quiet. Mixing them made the money page longer and this history harder to
 * find.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import MoneyHub from '@/components/finance/MoneyHub'
import { FINANCE_THEME } from '@/lib/financeTheme'
import {
  OUTCOME_META, KIND_FILTERS, STATE_FILTERS, kindLabel, isProblem,
  type EmailOutcome, type EmailState,
} from '@/lib/paymentEmails'
import Link from 'next/link'

/** One send, as `/api/payments/emails` returns it. */
type SentEmail = {
  id: string
  plan_id: string
  plan_label: string
  recipient_email: string
  recipient_name: string | null
  subject: string
  kind: string
  audience: string
  trigger: 'manual' | 'auto'
  status: 'sent' | 'failed'
  error: string | null
  custom_message: string | null
  amount_total: number
  created_at: string
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  bounced_at: string | null
  complained_at: string | null
  delivery_detail: string | null
  outcome: EmailOutcome
  items: {
    id: string
    scheduled_payment_id: string | null
    special_payment_id: string | null
    label: string
    due_date: string
    amount: number
    kind: string
  }[]
}

type Counts = { all: number; delivered: number; opened: number; problem: number; pending: number }
type Lease = { id: string; label: string }

const EMPTY_COUNTS: Counts = { all: 0, delivered: 0, opened: 0, problem: 0, pending: 0 }

/** "2 hours ago" for the recent, a date for the rest — a reminder sent this
 *  morning and one sent in August are read differently. */
function whenLabel(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const exactWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export default function RemindersPage() {
  const [emails, setEmails] = useState<SentEmail[] | null>(null)
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS)
  const [leases, setLeases] = useState<Lease[]>([])
  const [error, setError] = useState<string | null>(null)

  // Arriving from the alarm banner on Financials means "show me the ones that
  // did not arrive" — landing on an unfiltered log would make the landlord
  // repeat a filter they already chose by clicking.
  const [state, setState] = useState<EmailState>(() => {
    if (typeof window === 'undefined') return 'all'
    const wanted = new URLSearchParams(window.location.search).get('state')
    return STATE_FILTERS.some(f => f.id === wanted) ? (wanted as EmailState) : 'all'
  })
  const [kind, setKind] = useState('')
  // Arriving from one lease ("see what this tenant was sent") lands on that
  // lease, not on the whole portfolio.
  const [plan, setPlan] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('plan') ?? ''
  })
  const [audience, setAudience] = useState<'tenant' | 'all'>('tenant')
  // The box the landlord types in, and the value actually sent. Debounced so a
  // tenant's name does not cost one request per keystroke.
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => { document.title = 'Reminders — Landlord | HomeHive' }, [])

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const q = new URLSearchParams({ state, audience })
      if (kind) q.set('kind', kind)
      if (plan) q.set('plan', plan)
      if (query) q.set('q', query)
      const res = await fetch(`/api/payments/emails?${q}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the email history')
      setEmails(json.emails ?? [])
      setCounts(json.counts ?? EMPTY_COUNTS)
      // The lease list comes from the rows, so it is only trustworthy when
      // nothing is narrowing them. Keep the last full list otherwise.
      // The lease list is derived from the rows, so it is only complete when
      // nothing is narrowing them — but a deep link arrives pre-narrowed, so
      // an empty list would strand the landlord on one property with no way
      // back. Keep whatever we last knew, and fill it when unfiltered.
      const unfiltered = !plan && !query && !kind && state === 'all'
      setLeases(prev => (unfiltered || prev.length === 0) ? (json.leases ?? []) : prev)
    } catch (e) {
      setEmails([])
      setError(e instanceof Error ? e.message : 'Could not load the email history')
    }
  }, [state, kind, plan, audience, query])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Headline figures over the fetched window, not over all time: "of what I
  // sent, how much landed" is the question, and it only means anything against
  // a known set of sends.
  const stats = useMemo(() => {
    const total = counts.all
    const landed = counts.delivered
    return {
      total,
      problem: counts.problem,
      openRate: landed > 0 ? Math.round((counts.opened / landed) * 100) : null,
      deliveryRate: total > 0 ? Math.round((landed / total) * 100) : null,
      pending: counts.pending,
    }
  }, [counts])

  // `?? []` inline would be a fresh array on every render, and the grouping
  // below memoises on it.
  const rows = useMemo(() => emails ?? [], [emails])

  // Reading a log, the day is the unit: "three reminders went out on Tuesday"
  // is how a landlord remembers chasing people.
  const byDay = useMemo(() => {
    const groups = new Map<string, SentEmail[]>()
    for (const e of rows) {
      const day = new Date(e.created_at).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
      const arr = groups.get(day)
      if (arr) arr.push(e); else groups.set(day, [e])
    }
    return [...groups.entries()]
  }, [rows])

  return (
    <>
      <style>{FINANCE_THEME}{CSS}</style>
      <div className="fin rem-wrap">
        <MoneyHub
          tab="reminders"
          title="Reminders"
          sub="Every email sent to a tenant about rent, charges and late fees — and what happened to it after it left."
          alarmCount={counts.problem}
          // Sending happens from the charge being chased, never from a log, so
          // this page's one action is the way back to the money.
          action={{ label: 'Go to Financials', href: '/landlord/financials' }}
        />

        <section className="tiles" aria-label="Summary">
          <div className="tile">
            <div className="tile-label">Emails sent</div>
            <div className="tile-value">{stats.total}</div>
            <div className="tile-meta">
              {audience === 'tenant' ? 'to tenants, most recent first' : 'including your own copies'}
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Reached the tenant</div>
            <div className="tile-value">{stats.deliveryRate === null ? '—' : `${stats.deliveryRate}%`}</div>
            <div className="tile-meta">
              {counts.delivered} of {stats.total} confirmed delivered
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Opened</div>
            <div className="tile-value">{stats.openRate === null ? '—' : `${stats.openRate}%`}</div>
            <div className="tile-meta">
              {counts.opened} opened of those delivered
            </div>
          </div>
          <div className={`tile${stats.problem > 0 ? ' bad' : ''}`}>
            <div className="tile-label">Needs a look</div>
            <div className="tile-value">{stats.problem === 0 ? 'None' : stats.problem}</div>
            <div className="tile-meta">
              {stats.problem > 0
                ? 'bounced, refused or marked as spam'
                : 'nothing bounced or was refused'}
            </div>
          </div>
        </section>

        {/* A bounce is the one outcome that is actively costing the landlord
            money — the tenant is not ignoring them, they never got the mail. */}
        {stats.problem > 0 && state !== 'problem' && (
          <button className="alarm-bar" onClick={() => setState('problem')}>
            <span>
              <strong>
                {stats.problem} email{stats.problem !== 1 ? 's' : ''} never reached the tenant.
              </strong>{' '}
              A bounced reminder looks exactly like a tenant ignoring you.
            </span>
            <span className="go">Show them →</span>
          </button>
        )}

        <div className="controls">
          <div className="seg" role="tablist" aria-label="Outcome">
            {STATE_FILTERS.map(f => {
              const n = f.id === 'all' ? counts.all
                : f.id === 'problem' ? counts.problem
                : f.id === 'opened' ? counts.opened
                : f.id === 'delivered' ? counts.delivered
                : counts.pending
              return (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={state === f.id}
                  title={f.hint}
                  className={`seg-btn${state === f.id ? ' on' : ''}${f.id === 'problem' && n > 0 ? ' hot' : ''}`}
                  onClick={() => setState(f.id)}
                >
                  {f.label}
                  <span className="seg-badge">{n}</span>
                </button>
              )
            })}
          </div>

          <div className="pickers">
            <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind of email">
              {KIND_FILTERS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            <select value={plan} onChange={e => setPlan(e.target.value)} aria-label="Lease">
              <option value="">Every property</option>
              {leases.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <input
              type="search"
              value={search}
              placeholder="Search a tenant or address"
              onChange={e => setSearch(e.target.value)}
              aria-label="Search recipient"
            />
            <label className="switch" title="Receipts are also copied to you; this is how you see those">
              <input
                type="checkbox"
                checked={audience === 'all'}
                onChange={e => setAudience(e.target.checked ? 'all' : 'tenant')}
              />
              Include my own copies
            </label>
          </div>
        </div>

        {error ? (
          <div className="empty">
            <div className="empty-title">That didn’t load</div>
            <p className="empty-sub">{error}</p>
            <button className="btn-primary" onClick={load}>Try again</button>
          </div>
        ) : emails === null ? (
          <div className="skeleton" />
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="empty-title">
              {counts.all === 0 ? 'No emails sent yet' : 'Nothing matches those filters'}
            </div>
            <p className="empty-sub">
              {counts.all === 0 ? (
                <>
                  Rent requests you send from a lease ledger, late-fee reminders, payment receipts
                  and the automatic notice that goes out seven days before rent is due all appear
                  here — with whether each one was delivered and opened.
                </>
              ) : (
                <>Nothing sent matches that combination. Widen the filters to see the rest.</>
              )}
            </p>
            {counts.all > 0 && (
              <button className="btn-primary" onClick={() => {
                setState('all'); setKind(''); setPlan(''); setSearch('')
              }}>Clear the filters</button>
            )}
          </div>
        ) : (
          byDay.map(([day, group]) => (
            <section key={day} className="day">
              <div className="day-hd">
                <h2>{day}</h2>
                <span>{group.length} email{group.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="log">
                {group.map(e => {
                  const meta = OUTCOME_META[e.outcome]
                  const isOpen = open.has(e.id)
                  return (
                    <div key={e.id} className={`sendrow${isProblem(e.outcome) ? ' hot' : ''}`}>
                      <button
                        className="send"
                        onClick={() => toggle(e.id)}
                        aria-expanded={isOpen}
                      >
                        <span className={`out out-${meta.tone}`} title={meta.hint}>{meta.label}</span>
                        <span className="send-main">
                          <span className="send-who">
                            {e.recipient_name || e.recipient_email}
                            {e.trigger === 'auto' && (
                              <span className="pill plain" title="Sent automatically, with nobody pressing a button">
                                automatic
                              </span>
                            )}
                            {e.audience !== 'tenant' && <span className="pill plain">your copy</span>}
                          </span>
                          <span className="send-sub">
                            {kindLabel(e.kind)} · {e.plan_label}
                            {e.items.length > 0 && <> · {e.items.length} charge{e.items.length !== 1 ? 's' : ''}</>}
                          </span>
                        </span>
                        <span className="send-fig">
                          {e.amount_total > 0 && <span className="send-amt">{fmtCurrency(e.amount_total)}</span>}
                          <span className="send-when" title={exactWhen(e.created_at)}>{whenLabel(e.created_at)}</span>
                        </span>
                        <span className={`twist${isOpen ? ' open' : ''}`} aria-hidden="true" />
                      </button>

                      {isOpen && (
                        <div className="detail">
                          <div className="dl">
                            <span className="dt">Subject</span>
                            <span className="dd">{e.subject}</span>
                          </div>
                          <div className="dl">
                            <span className="dt">To</span>
                            <span className="dd">{e.recipient_email}</span>
                          </div>
                          {e.custom_message && (
                            <div className="dl">
                              <span className="dt">Your note</span>
                              <span className="dd quote">{e.custom_message}</span>
                            </div>
                          )}

                          {/* The lifecycle, as observed rather than assumed.
                              Each step is a fact with a time on it, and a step
                              that never happened is simply absent — which is
                              how a landlord sees that a mail was accepted three
                              weeks ago and never delivered. */}
                          <div className="dl">
                            <span className="dt">What happened</span>
                            <span className="dd">
                              <span className="track">
                                <Step label="Sent" at={e.created_at} done />
                                <Step label="Delivered" at={e.delivered_at} done={!!e.delivered_at} />
                                <Step label="Opened" at={e.opened_at} done={!!e.opened_at} />
                                {e.clicked_at && <Step label="Clicked the pay link" at={e.clicked_at} done />}
                                {e.bounced_at && <Step label="Bounced" at={e.bounced_at} done bad />}
                                {e.complained_at && <Step label="Marked as spam" at={e.complained_at} done bad />}
                              </span>
                              {e.delivery_detail && <span className="track-note">{e.delivery_detail}</span>}
                              {e.status === 'failed' && (
                                <span className="track-note bad">
                                  Never left our end{e.error ? `: ${e.error}` : '.'}
                                </span>
                              )}
                              {e.outcome === 'pending' && (
                                <span className="track-note">
                                  The provider has not reported back yet. Delivery reports need the
                                  Resend webhook configured.
                                </span>
                              )}
                            </span>
                          </div>

                          {e.items.length > 0 && (
                            <div className="dl">
                              <span className="dt">What it asked about</span>
                              <span className="dd">
                                {e.items.map(i => (
                                  <span key={i.id} className="item">
                                    <span className="item-lbl">
                                      {i.label}
                                      {i.kind === 'late_fee' && <span className="pill warn">late fee</span>}
                                    </span>
                                    <span className="item-due">due {fmtDate(i.due_date)}</span>
                                    <span className="item-amt">{fmtCurrency(i.amount)}</span>
                                  </span>
                                ))}
                              </span>
                            </div>
                          )}

                          <div className="detail-ft">
                            <Link className="btn-quiet" href={`/landlord/financials?plan=${e.plan_id}`}>
                              Open the lease ledger
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        )}

        {rows.length > 0 && (
          <p className="foot">
            Showing the {rows.length} most recent. Delivery and open reports arrive from the email
            provider after the send, so a very recent email may still read as “Sent”.
          </p>
        )}
      </div>
    </>
  )
}

/** One observed step in a message's life. No time, no step. */
function Step({ label, at, done, bad }: { label: string; at: string | null; done: boolean; bad?: boolean }) {
  return (
    <span className={`step${done ? ' done' : ''}${bad ? ' bad' : ''}`}>
      <span className="step-dot" aria-hidden="true" />
      <span className="step-lbl">{label}</span>
      <span className="step-at">{at ? exactWhen(at) : 'not yet'}</span>
    </span>
  )
}

const CSS = `
  /* Tokens, buttons, badges, panels, the hub header and the alarm bar all come
     from src/lib/financeTheme.ts. What is left here is this page's own layout:
     the summary tiles, the filter bar and the day-grouped log. */
  .rem-wrap { max-width: 1060px; margin: 0 auto; padding: 32px 22px 96px; }
  .sub { max-width: 64ch; }

  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
  .tile {
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 15px 17px 14px;
  }
  .tile.bad { background: #fff8f7; border-color: #f6cfcb; }
  .tile-label { font-size: 11.5px; font-weight: 500; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.055em; }
  .tile-value { font-size: 26px; font-weight: 600; letter-spacing: -0.024em; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .tile.bad .tile-value { color: var(--bad); }
  .tile-meta { font-size: 12px; color: var(--ink-3); margin-top: 4px; line-height: 1.45; font-variant-numeric: tabular-nums; }

  .controls { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .pickers { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pickers select, .pickers input[type="search"] {
    font-family: inherit; font-size: 13px; color: var(--ink); background: var(--surface);
    border: 1px solid var(--line); border-radius: 10px; padding: 7px 11px; letter-spacing: -0.01em;
  }
  .pickers input[type="search"] { min-width: 220px; }
  .switch { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em; cursor: pointer; }

  .day { margin-bottom: 22px; }
  .day-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .day-hd h2 { font-size: 12px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .day-hd span { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .log { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
  .sendrow { border-top: 1px solid var(--line-2); }
  .sendrow:first-child { border-top: none; }
  .sendrow.hot { background: #fffafa; }
  .send {
    display: grid; grid-template-columns: 96px minmax(0, 1fr) auto 14px;
    gap: 14px; align-items: center; width: 100%; text-align: left;
    background: none; border: none; font-family: inherit; color: inherit;
    padding: 13px 18px; cursor: pointer;
  }
  .send:hover { background: #fafafb; }
  /* The outcome badge is the theme's; it only needs to fill its column here so
     a stack of them reads as one edge down the page. */
  .out { justify-content: center; width: 100%; font-weight: 600; }
  .send-main { min-width: 0; }
  .send-who {
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    font-size: 14px; font-weight: 500; letter-spacing: -0.012em;
  }
  .send-sub { display: block; font-size: 12.5px; color: var(--ink-2); margin-top: 2px; letter-spacing: -0.01em; }
  .send-fig { text-align: right; white-space: nowrap; }
  .send-amt { display: block; font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .send-when { display: block; font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .detail { padding: 2px 18px 16px 128px; background: #fcfcfd; border-top: 1px solid var(--line-2); }
  .dl { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; padding: 7px 0; font-size: 13px; }
  .dt { font-size: 11.5px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.05em; padding-top: 2px; }
  .dd { min-width: 0; letter-spacing: -0.01em; line-height: 1.5; }
  .dd.quote { border-left: 2px solid var(--line); padding-left: 10px; color: var(--ink-2); font-style: italic; }

  .track { display: flex; flex-direction: column; gap: 5px; }
  .step { display: grid; grid-template-columns: 10px 1fr auto; gap: 9px; align-items: center; font-size: 12.5px; color: var(--ink-3); }
  .step-dot { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--line); }
  .step.done .step-dot { background: var(--in); border-color: var(--in); }
  .step.done { color: var(--ink); }
  .step.bad .step-dot { background: var(--late); border-color: var(--late); }
  .step.bad { color: var(--late); }
  .step-lbl { min-width: 0; letter-spacing: -0.01em; }
  .step-at { font-variant-numeric: tabular-nums; color: var(--ink-3); font-size: 11.5px; }
  .track-note { display: block; font-size: 12px; color: var(--ink-2); margin-top: 7px; line-height: 1.5; }
  .track-note.bad { color: var(--bad); }

  .item { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: baseline; padding: 4px 0; }
  .item-lbl { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
  .item-due { font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
  .item-amt { font-variant-numeric: tabular-nums; font-weight: 500; }
  .detail-ft { margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--line-2); }

  .foot { font-size: 12px; color: var(--ink-3); line-height: 1.6; margin-top: 4px; letter-spacing: -0.01em; }

  @media (max-width: 900px) {
    .tiles { grid-template-columns: repeat(2, 1fr); }
    .detail { padding-left: 18px; }
    .dl { grid-template-columns: 1fr; gap: 2px; }
  }
  @media (max-width: 680px) {
    .rem-wrap { padding: 24px 16px 90px; }
    .send { grid-template-columns: 1fr auto; row-gap: 8px; }
    .send > .out { grid-column: 1 / -1; justify-self: start; }
    .send > .twist { display: none; }
    .pickers input[type="search"] { min-width: 0; flex: 1; }
  }
`
