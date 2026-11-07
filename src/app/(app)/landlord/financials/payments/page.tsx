'use client'

/**
 * Payments — every payment collected, as one table.
 *
 * Financials answers "what am I owed", month by month and lease by lease. This
 * tab answers the question that comes up when a tenant says *I already paid
 * you*: what has actually arrived, when, by what route, and — the part the
 * platform could not answer at all before — which attempts did not make it.
 *
 * It is a table, deliberately, where the rest of the money area is a set of
 * nested panels. Reconciling against a bank statement is a scanning job: one
 * row per payment, the same columns in the same places, sortable by the column
 * you are reconciling on, and exportable so the landlord can do the rest in a
 * spreadsheet. Panels are for drilling; a ledger is for scanning.
 *
 * Three states carry the whole page, because a bank payment has three endings
 * and the old "Payments received" list only showed one of them:
 *
 *   Cleared  — the money is in the account.
 *   Clearing — the tenant sent it, the bank still has it. Money to expect,
 *              not money held, so it is never added into collected.
 *   Failed   — it bounced. The charge is unpaid again and the tenant owes it.
 *              Nothing on the charge remembers this (settlement resets the
 *              row), so it comes from `rent_payment_attempts`.
 *
 * The ACH lag gets its own column rather than a footnote. Every bank debit on
 * this platform spends days in flight, so "sent" and "cleared" are different
 * facts about one payment, and a landlord who reads only the second one thinks
 * their tenants pay late when their bank is simply slow.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { METHOD_META } from '@/lib/financialsRollup'
import { arrears, filterPlans, LEASE_FILTERS, type LeaseFilter } from '@/lib/financialsMonth'
import { useMoney } from '@/lib/useMoney'
import {
  paymentLog, filterPayments, paymentTotals, stateCounts, leaseOptions, paymentsCsv,
  PAY_STATE_META, KIND_LABEL, STATE_FILTERS, METHOD_FILTERS, RANGE_FILTERS,
  type PaymentEntry, type AttemptRow, type PayFilter, type StateFilter,
  type MethodFilter, type RangeFilter,
} from '@/lib/paymentsLog'
import MoneyHub from '@/components/finance/MoneyHub'
import { FINANCE_THEME } from '@/lib/financeTheme'
import Link from 'next/link'

/** What the table can be ordered by. The date is the default: this is a log. */
type SortKey = 'at' | 'amount' | 'property' | 'who' | 'due'

export default function PaymentsLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string; method?: string; range?: string; plan?: string; leases?: string
  }>
}) {
  const sp = use(searchParams)

  const { plans, bounced: bouncedCount, loading } = useMoney()
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  /** Set when the attempts table could not be read — failures then cannot be
   *  shown, and the page says so rather than implying there were none. */
  const [attemptsError, setAttemptsError] = useState(false)

  // Active leases by default, exactly as Financials does: a landlord with three
  // years of tenancies behind them should not have to read past all of them.
  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>(
    LEASE_FILTERS.some(f => f.id === sp.leases) ? (sp.leases as LeaseFilter) : 'current'
  )

  const [filter, setFilter] = useState<PayFilter>({
    state: (STATE_FILTERS.some(f => f.id === sp.state) ? sp.state : 'all') as StateFilter,
    method: (METHOD_FILTERS.some(f => f.id === sp.method) ? sp.method : 'all') as MethodFilter,
    range: (RANGE_FILTERS.some(f => f.id === sp.range) ? sp.range : 'all') as RangeFilter,
    planId: sp.plan ?? '',
    query: '',
  })
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'at', desc: true })
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => { document.title = 'Payments — Landlord | HomeHive' }, [])

  /**
   * Only the attempts are loaded here.
   *
   * The plans come from `useMoney`, which every screen in the money area now
   * shares — the portfolio query is the heaviest read in the portal, and this
   * page used to fire its own copy of it on every visit. Failed attempts are
   * this page's alone: nothing else in the area shows them, because the charge
   * itself does not remember a payment that bounced.
   */
  const load = useCallback(async () => {
    // RLS keys this table on plan ownership, so no owner filter is needed here
    // and none would be trustworthy if it were.
    const { data: rows, error } = await supabase
      .from('rent_payment_attempts')
      .select('plan_id, payment_intent_id, method, status, amount, submitted_at, cleared_at, failed_at, failure_code, failure_message, items')
      .order('submitted_at', { ascending: false })
    if (error) { setAttemptsError(true); return }
    setAttemptsError(false)
    setAttempts((rows ?? []).map(r => ({
      ...r,
      amount: Number(r.amount),
      items: Array.isArray(r.items) ? r.items : [],
    })) as AttemptRow[])
  }, [])

  useEffect(() => {
    // Fired through an IIFE so the effect itself stays synchronous and returns
    // nothing — the loader's own writes land in a later tick, as React wants.
    ;(async () => { await load() })()
  }, [load])

  const scoped = useMemo(() => filterPlans(plans, leaseFilter), [plans, leaseFilter])
  // Carried on the Collections tab from here, as it is from every money screen.
  const behind = useMemo(() => arrears(scoped).payerCount, [scoped])
  const all = useMemo(() => paymentLog(scoped, attempts), [scoped, attempts])
  const counts = useMemo(() => stateCounts(all), [all])
  const leases = useMemo(() => leaseOptions(all), [all])
  const rows = useMemo(() => filterPayments(all, filter), [all, filter])
  const totals = useMemo(() => paymentTotals(rows), [rows])

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1
    const val = (r: PaymentEntry) => {
      switch (sort.key) {
        case 'amount':   return r.amount + r.lateFee
        case 'property': return `${r.propertyName} ${r.leaseName}`.toLowerCase()
        case 'who':      return (r.who ?? '').toLowerCase()
        case 'due':      return r.dueDate ?? ''
        default:         return r.at
      }
    }
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [rows, sort])

  const set = (patch: Partial<PayFilter>) => setFilter(f => ({ ...f, ...patch }))
  const clear = () => setFilter({ state: 'all', method: 'all', range: 'all', planId: '', query: '' })
  const filtered = filter.state !== 'all' || filter.method !== 'all'
    || filter.range !== 'all' || !!filter.planId || !!filter.query

  /** Sorting a column the landlord just picked should start useful: money and
   *  dates read large-first, names read A–Z. */
  const sortBy = (key: SortKey) => setSort(s =>
    s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'amount' || key === 'at' || key === 'due' }
  )

  const download = () => {
    const blob = new Blob([paymentsCsv(sorted)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <style>{FINANCE_THEME}{CSS}</style>
      <div className="fin pay-wrap">
        <MoneyHub
          tab="payments"
          title="Payments"
          sub="Every payment your tenants have made — what cleared, what is still moving through the bank, and what bounced."
          alarmCount={bouncedCount}
          dueCount={behind}
          action={{ label: 'Export CSV', onClick: download }}
          meta={
            <div className="meta-row">
              <div className="seg sm pill" role="tablist" aria-label="Which leases">
                {LEASE_FILTERS.map(f => (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={leaseFilter === f.id}
                    className={`seg-btn${leaseFilter === f.id ? ' on' : ''}`}
                    onClick={() => setLeaseFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <section className="kpis" aria-label="Summary">
          <div className="kpi hero">
            <div className="kpi-label">Collected</div>
            <div className="kpi-value fig-in">{fmtCurrency(totals.cleared)}</div>
            <div className="kpi-meta">
              {totals.clearedCount} payment{totals.clearedCount !== 1 ? 's' : ''} landed
              {totals.lateFees > 0 && <> · includes {fmtCurrency(totals.lateFees)} of late fees</>}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Still clearing</div>
            <div className={`kpi-value${totals.clearing > 0 ? ' fig-flight' : ''}`}>
              {totals.clearing > 0 ? fmtCurrency(totals.clearing) : '—'}
            </div>
            <div className="kpi-meta">
              {totals.clearingCount > 0
                ? `${totals.clearingCount} bank payment${totals.clearingCount !== 1 ? 's' : ''} in flight`
                : 'nothing in flight'}
              {totals.avgClearingDays !== null && <> · usually {totals.avgClearingDays} days</>}
            </div>
          </div>
          <div className={`kpi${totals.failedCount > 0 ? ' hot' : ''}`}>
            <div className="kpi-label">Failed</div>
            <div className="kpi-value">
              {totals.failedCount > 0 ? fmtCurrency(totals.failed) : 'None'}
            </div>
            <div className="kpi-meta">
              {totals.failedCount > 0
                ? `${totals.failedCount} bounced — the tenant still owes it`
                : 'nothing has bounced'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Arrived late</div>
            <div className="kpi-value">{totals.lateCount === 0 ? 'None' : totals.lateCount}</div>
            <div className="kpi-meta">
              {totals.lateCount > 0
                ? 'sent after the due date'
                : 'every payment was sent on time'}
            </div>
          </div>
        </section>

        {/* A bounce is the one state here that is actively costing the landlord
            money: the charge is unpaid again and nobody has told them. */}
        {counts.failed > 0 && filter.state !== 'failed' && (
          <button className="alarm-bar" onClick={() => set({ state: 'failed', range: 'all' })}>
            <span>
              <strong>
                {counts.failed} payment{counts.failed !== 1 ? 's' : ''} bounced after the tenant sent {counts.failed !== 1 ? 'them' : 'it'}.
              </strong>{' '}
              The rent went back to unpaid, so it is still owed.
            </span>
            <span className="go">Show {counts.failed !== 1 ? 'them' : 'it'} →</span>
          </button>
        )}

        <div className="controls">
          <div className="seg" role="tablist" aria-label="What happened">
            {STATE_FILTERS.map(f => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter.state === f.id}
                title={f.hint}
                className={`seg-btn${filter.state === f.id ? ' on' : ''}${f.id === 'failed' && counts.failed > 0 ? ' hot' : ''}`}
                onClick={() => set({ state: f.id })}
              >
                {f.label}
                <span className="seg-badge">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          <div className="pickers">
            <select
              className="fsel"
              value={filter.planId}
              onChange={e => set({ planId: e.target.value })}
              aria-label="Lease"
            >
              <option value="">Every property</option>
              {leases.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <select
              className="fsel"
              value={filter.method}
              onChange={e => set({ method: e.target.value as MethodFilter })}
              aria-label="How it was paid"
            >
              {METHOD_FILTERS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select
              className="fsel"
              value={filter.range}
              onChange={e => set({ range: e.target.value as RangeFilter })}
              aria-label="When"
            >
              {RANGE_FILTERS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <input
              className="fsearch"
              type="search"
              value={filter.query}
              placeholder="Search a tenant, address or month"
              onChange={e => set({ query: e.target.value })}
              aria-label="Search payments"
            />
            {filtered && (
              <button className="btn-quiet sm" onClick={clear}>Clear filters</button>
            )}
            <span className="spacer" />
            <button
              className="btn-secondary sm"
              onClick={download}
              disabled={sorted.length === 0}
              title="Exactly the rows below, in the order below"
            >
              Download CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="skeleton" />
        ) : sorted.length === 0 ? (
          <div className="empty">
            <div className="empty-title">
              {counts.all === 0 ? 'No payments yet' : 'Nothing matches those filters'}
            </div>
            <p className="empty-sub">
              {counts.all === 0 ? (
                <>
                  When a tenant pays rent online it appears here the moment it is sent — a card
                  payment lands immediately, a bank transfer takes a few days and shows as
                  clearing until it does. Rent you record by hand appears here too.
                </>
              ) : (
                <>Nothing you have collected matches that combination. Widen the filters to see the rest.</>
              )}
            </p>
            {counts.all > 0 && <button className="btn-primary" onClick={clear}>Clear the filters</button>}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="pay-table">
              <thead>
                <tr>
                  <th className="col-state">Status</th>
                  <Th label="Payment"  k="due"      sort={sort} onSort={sortBy} />
                  <Th label="Property" k="property" sort={sort} onSort={sortBy} />
                  <Th label="Payer"    k="who"      sort={sort} onSort={sortBy} />
                  <Th label="Sent"     k="at"       sort={sort} onSort={sortBy} />
                  <th>Cleared</th>
                  <th>Method</th>
                  <Th label="Amount"   k="amount"   sort={sort} onSort={sortBy} align="right" />
                  <th className="num">Late fee</th>
                  <th aria-label="Detail" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <Row
                    key={r.key}
                    row={r}
                    open={open === r.key}
                    onToggle={() => setOpen(k => (k === r.key ? null : r.key))}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>
                    {sorted.length} payment{sorted.length !== 1 ? 's' : ''}
                    {filtered && <> of {all.length}</>}
                  </td>
                  <td className="num total">{fmtCurrency(totals.cleared + totals.clearing)}</td>
                  <td className="num">{totals.lateFees > 0 ? fmtCurrency(totals.lateFees) : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="foot">
          A card payment clears the moment it is made; a bank transfer (ACH) is sent straight away
          but takes three to five business days to land, and shows as <em>clearing</em> until it
          does. Late fees are judged on the day the tenant <em>sent</em> the money, never on the day
          the bank released it. Every figure here is money credited to you — rent, utilities and
          late fees.
          {attemptsError && (
            <> <strong>Failed payments could not be loaded just now</strong>, so this list may be
            showing only what cleared.</>
          )}
        </p>
      </div>
    </>
  )
}

/** A sortable column header. */
function Th({
  label, k, sort, onSort, align,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; desc: boolean }
  onSort: (k: SortKey) => void
  align?: 'right'
}) {
  const on = sort.key === k
  return (
    <th className={align === 'right' ? 'num' : undefined} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className={`sort${on ? ' on' : ''}`} onClick={() => onSort(k)}>
        {label}
        <span className={`arrow${on && !sort.desc ? ' up' : ''}`} aria-hidden="true">
          {on ? '▾' : ''}
        </span>
      </button>
    </th>
  )
}

/** "Oct 8, 2026" plus the time when we know the exact instant. */
function instant(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  }
}

function Row({ row: r, open, onToggle }: { row: PaymentEntry; open: boolean; onToggle: () => void }) {
  const meta = PAY_STATE_META[r.state]
  const method = r.method ? METHOD_META[r.method as keyof typeof METHOD_META] : null
  const sent = r.submittedAt ? instant(r.submittedAt) : null
  const landed = r.clearedAt ? instant(r.clearedAt) : null

  return (
    <>
      <tr className={`row st-${r.state}${open ? ' open' : ''}`} onClick={onToggle}>
        <td className="col-state">
          <span className={`st st-${meta.tone}`} title={meta.hint}>{meta.label}</span>
        </td>

        <td>
          <span className="what">{r.label}</span>
          <span className="sub">
            {KIND_LABEL[r.kind]}
            {r.dueDate && <> · due {fmtDate(r.dueDate)}</>}
            {(r.daysLate ?? 0) > 0 && <span className="pill bad">{r.daysLate}d late</span>}
          </span>
        </td>

        <td>
          <span className="what">{r.propertyName}</span>
          <span className="sub">{r.leaseName}</span>
        </td>

        <td>
          {r.who ?? <span className="dim">The lease</span>}
          {r.byHand && <span className="pill plain" title="You recorded this yourself">by hand</span>}
        </td>

        <td className="num">
          {sent ? (
            <>
              <span className="what">{sent.date}</span>
              <span className="sub">{sent.time}</span>
            </>
          ) : r.paidDate ? (
            <>
              <span className="what">{fmtDate(r.paidDate)}</span>
              <span className="sub">recorded</span>
            </>
          ) : <span className="dim">—</span>}
        </td>

        <td className="num">
          {landed ? (
            <>
              <span className="what">{landed.date}</span>
              <span className="sub">
                {r.clearingDays !== null && r.clearingDays > 0
                  ? `${r.clearingDays} day${r.clearingDays !== 1 ? 's' : ''} in the bank`
                  : 'same day'}
              </span>
            </>
          ) : r.state === 'clearing' ? (
            <span className="fig-flight">in flight</span>
          ) : r.state === 'failed' ? (
            <span className="fig-late">never</span>
          ) : r.paidDate ? (
            <>
              <span className="what">{fmtDate(r.paidDate)}</span>
              <span className="sub">no exact time</span>
            </>
          ) : <span className="dim">—</span>}
        </td>

        <td>
          {method
            ? <span className="method">{method.label}</span>
            : <span className="dim">—</span>}
        </td>

        <td className={`num amount${r.state === 'failed' ? ' struck' : ''}`}>
          {fmtCurrency(r.amount + r.lateFee)}
        </td>
        <td className="num">{r.lateFee > 0 ? fmtCurrency(r.lateFee) : <span className="dim">—</span>}</td>
        <td className="col-twist"><span className={`twist${open ? ' open' : ''}`} aria-hidden="true" /></td>
      </tr>

      {open && (
        <tr className="detail-row">
          <td colSpan={10}>
            <div className="detail">
              {r.state === 'failed' && (
                <p className="note bad">
                  This payment was refused{r.failureReason ? `: ${r.failureReason}` : '.'} The
                  charge went back to unpaid, any late fee resumed from its due date, and the
                  tenant still owes the money.
                </p>
              )}
              {r.state === 'clearing' && (
                <p className="note info">
                  The tenant sent this{sent ? ` on ${sent.date}` : ''} and the bank has it. Bank
                  transfers take three to five business days to land. It is not counted as
                  collected until it does, and no late fee is accruing while it clears.
                </p>
              )}

              <div className="facts">
                <Fact label="What" value={`${KIND_LABEL[r.kind]} — ${r.label}`} />
                <Fact label="Lease" value={`${r.propertyName} · ${r.leaseName}`} />
                <Fact label="Payer" value={r.who ?? 'Raised against the lease'} />
                <Fact label="Due" value={r.dueDate ? fmtDate(r.dueDate) : '—'} />
                <Fact
                  label="Sent by the tenant"
                  value={sent ? `${sent.date} at ${sent.time}` : (r.byHand ? 'Recorded by you' : '—')}
                />
                <Fact
                  label="Landed"
                  value={landed ? `${landed.date} at ${landed.time}`
                    : r.state === 'clearing' ? 'Still clearing'
                    : r.state === 'failed' ? 'Never — it bounced'
                    : r.paidDate ? fmtDate(r.paidDate) : '—'}
                />
                <Fact
                  label="On time"
                  value={r.daysLate === null ? '—'
                    : r.daysLate > 0 ? `${r.daysLate} day${r.daysLate !== 1 ? 's' : ''} after the due date`
                    : r.daysLate === 0 ? 'On the due date'
                    : `${Math.abs(r.daysLate)} day${Math.abs(r.daysLate) !== 1 ? 's' : ''} early`}
                />
                <Fact label="Method" value={method?.label ?? '—'} />
                <Fact label="Rent and charges" value={fmtCurrency(r.amount)} />
                <Fact label="Late fee collected" value={r.lateFee > 0 ? fmtCurrency(r.lateFee) : '—'} />
                {r.intentId && <Fact label="Stripe payment" value={r.intentId} mono />}
              </div>

              <div className="detail-ft">
                <Link className="btn-quiet" href={`/landlord/financials?plan=${r.planId}`}>
                  Open this lease’s ledger
                </Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="fact">
      <span className="fact-l">{label}</span>
      <span className={`fact-v${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  )
}

const CSS = `
  /* Tokens, buttons, badges, the hub header and the alarm bar come from
     src/lib/financeTheme.ts. What is here is this page's own thing: a wide
     reconciliation table.

     It is deliberately wider than the rest of the money area. Financials is a
     set of nested panels read at a glance and caps itself at a comfortable
     reading measure; this is a ledger being checked line by line against a
     bank statement, and on a desktop the useful thing to do with the space is
     show every column at once instead of hiding half of them behind a scroll. */
  .pay-wrap { max-width: 1760px; margin: 0 auto; padding: 32px clamp(18px, 2.4vw, 40px) 96px; }
  .sub { max-width: 78ch; }
  .meta-row { margin-top: 12px; }
  .seg.sm .seg-btn { padding: 5px 11px; min-height: 28px; font-size: 12.5px; }

  /* The summary row is the area's shared .kpis / .kpi — this page used to
     carry its own near-identical copy, one corner radius and one label case
     away from the rest of the money screens. */
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }

  .controls { display: flex; flex-direction: column; gap: 12px; margin-bottom: 18px; }
  .pickers { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pickers .spacer { flex: 1; }
  .pickers .fsearch { min-width: 260px; }

  .table-wrap {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    overflow: auto hidden;
  }
  .pay-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .pay-table th, .pay-table td { text-align: left; padding: 11px 14px; vertical-align: middle; }
  .pay-table thead th {
    position: sticky; top: 0; z-index: 1;
    background: var(--surface-2); border-bottom: 1px solid var(--line);
    font-size: 11.5px; font-weight: 500; color: var(--ink-3);
    letter-spacing: -0.005em; white-space: nowrap;
  }
  .pay-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pay-table thead th.num { text-align: right; }
  .col-state { width: 96px; }
  .col-twist { width: 26px; }

  /* A sortable header reads as a control only on hover, so a row of them does
     not look like ten buttons competing with the data. */
  .sort {
    display: inline-flex; align-items: center; gap: 5px; background: none; border: none;
    padding: 0; font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit;
    cursor: pointer;
  }
  .sort:hover { color: var(--ink); }
  .sort.on { color: var(--ink); font-weight: 600; }
  .sort .arrow { font-size: 9px; line-height: 1; }
  .sort .arrow.up { transform: rotate(180deg); }
  .pay-table thead th.num .sort { flex-direction: row-reverse; }

  .row { border-top: 1px solid var(--line-2); cursor: pointer; }
  .row:hover { background: #fafafb; }
  .row.open { background: #f7f9fc; }
  .row.st-failed { background: #fffafa; }
  .row.st-failed:hover { background: #fff5f4; }
  .st { justify-content: center; width: 100%; font-weight: 600; }

  .what { display: block; font-weight: 500; letter-spacing: -0.012em; white-space: nowrap; }
  .sub {
    display: block; font-size: 11.5px; color: var(--ink-2); margin-top: 2px;
    letter-spacing: -0.01em; white-space: nowrap;
  }
  .sub .pill { margin-left: 6px; }
  .dim { color: var(--ink-3); }
  .method { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
  .amount { font-weight: 600; font-size: 14px; }
  /* A bounced payment's figure is money that did not arrive. Struck through, so
     it can never be read as collected at a glance. */
  .amount.struck { color: var(--ink-3); text-decoration: line-through; font-weight: 500; }

  .pay-table tfoot td {
    border-top: 1px solid var(--line); background: var(--surface-2);
    font-size: 12.5px; color: var(--ink-2); white-space: nowrap;
  }
  .pay-table tfoot .total { font-size: 14px; font-weight: 600; color: var(--ink); }

  .detail-row { background: #f7f9fc; border-top: 1px solid var(--line-2); }
  .detail-row > td { padding: 0 14px 16px; }
  .detail { padding-top: 4px; }
  .note {
    font-size: 13px; line-height: 1.55; letter-spacing: -0.01em;
    border-radius: 12px; padding: 11px 14px; margin-bottom: 12px; max-width: 92ch;
  }
  .note.bad  { background: var(--late-bg);   color: #8c2f26; border: 1px solid var(--late-line); }
  .note.info { background: var(--flight-bg); color: #0b6164; border: 1px solid var(--flight-line); }

  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px 22px; }
  .fact { min-width: 0; }
  .fact-l { display: block; font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .fact-v { display: block; font-size: 13px; letter-spacing: -0.01em; line-height: 1.45; margin-top: 2px; }
  .fact-v.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--ink-2); overflow-wrap: anywhere; }
  .detail-ft { margin-top: 14px; padding-top: 11px; border-top: 1px solid var(--line-2); }

  .foot { font-size: 12px; color: var(--ink-3); line-height: 1.65; margin-top: 12px; max-width: 110ch; letter-spacing: -0.01em; }

  @media (max-width: 1280px) {
    /* The columns that are nice rather than necessary go first. The table keeps
       a horizontal scroll underneath, so nothing is ever unreachable. */
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 900px) {
    .pay-wrap { padding: 24px 16px 90px; }
    .table-wrap { overflow-x: auto; }
    .pay-table { min-width: 1080px; }
    .pickers .fsearch { min-width: 0; flex: 1; }
  }
`
