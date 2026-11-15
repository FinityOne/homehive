'use client'

/**
 * The rent roll — the portfolio as one page, built to leave the building.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every outside party who deals with a rental owner asks for the same
 * document, and until now this product could not produce it. A lender
 * underwriting a refinance, an insurer pricing a policy, a buyer in diligence,
 * a co-owner, an accountant at year end — all of them ask for one row per
 * unit: who is in it, what they pay, until when, what you hold, what they owe.
 *
 * The portfolio tab is the right way to *work* a portfolio and exactly the
 * wrong thing to hand over: it is a tree you expand, its figures are spread
 * across four levels, and it cannot be printed into anything a lender would
 * read. So landlords were retyping it into a spreadsheet, which is where the
 * mistakes in these documents come from.
 *
 * ── The vacancies are the point ───────────────────────────────────────────
 *
 * This is a rent roll rather than a list of leases because an empty room is a
 * row. A six-bedroom house with four tenants looks like four healthy tenancies
 * on a lease list and reads as a full property; here it is six rows, two of
 * them vacant, with the rent the building *could* produce stated beside the
 * rent it does.
 *
 * That is not a nicety. Anybody assessing the asset needs both figures, and a
 * document that quietly drops the empty rooms is the sort of omission that ends
 * a diligence conversation badly. See `src/lib/rentRoll.ts`.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It does not price a vacancy whose listing has no asking rent, and it does not
 * infer a unit count from the number of tenants — which would make every
 * property read as exactly full. Where either is missing the document says so,
 * by name, above the total. A total that silently rests on an assumption is
 * worse than one that admits a gap, because this page is read by people who
 * were not there.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useMoney } from '@/lib/useMoney'
import { arrears } from '@/lib/financialsMonth'
import { buildTree, leaseHref, propertyHref } from '@/lib/financialsTree'
import { downloadCsv } from '@/lib/propertyExpenses'
import { rentRoll, rentRollCsv, ROLL_STATE_META, type RollRow } from '@/lib/rentRoll'
import type { PropertyFacts } from '@/lib/propertyMoney'
import MoneyHub from '@/components/finance/MoneyHub'
import { StatusDot } from '@/components/finance/Panels'
import { FINANCE_THEME } from '@/lib/financeTheme'

export default function RentRollPage() {
  const { plans, bounced, loading } = useMoney()
  const [facts, setFacts] = useState<PropertyFacts[]>([])
  const [includeEnded, setIncludeEnded] = useState(false)
  const [propertyId, setPropertyId] = useState('')

  useEffect(() => { document.title = 'Rent roll — Financials | HomeHive' }, [])

  /**
   * The listings, for room counts and asking rents.
   *
   * The money data carries only `id, name, slug` per property, and the two
   * fields that make this a rent roll rather than a lease list — how many rooms
   * there are and what each is advertised at — live on the listing. Filtered on
   * `owner_id` as well as leaning on RLS, so a roll can never pick up a
   * property from elsewhere.
   */
  useEffect(() => {
    ;(async () => {
      const user = await getCurrentUser()
      if (!user) return
      const { data } = await supabase
        .from('properties')
        .select('id, name, slug, address, price, total_rooms, beds, baths, security_deposit, listing_status, available_from')
        .eq('owner_id', user.id)
      setFacts((data as PropertyFacts[]) ?? [])
    })()
  }, [])

  const tree = useMemo(() => buildTree(plans, []), [plans])
  const scopedTree = useMemo(
    () => (propertyId
      ? { ...tree, properties: tree.properties.filter(p => p.propertyId === propertyId) }
      : tree),
    [tree, propertyId],
  )
  const roll = useMemo(
    () => rentRoll(scopedTree, facts, { includeEnded }),
    [scopedTree, facts, includeEnded],
  )
  const behind = useMemo(() => arrears(plans).payerCount, [plans])

  /** Today, stated on the document — a rent roll without an as-of date is
   *  unusable: every figure on it is a snapshot. */
  const asOf = useMemo(
    () => new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    [],
  )

  /** Rows grouped by property, so the document reads building by building. */
  const grouped = useMemo<
    { id: string; name: string; address: string | null; rows: RollRow[] }[]
  >(() => {
    const out: { id: string; name: string; address: string | null; rows: RollRow[] }[] = []
    for (const r of roll.rows) {
      const last = out[out.length - 1]
      if (last && last.id === r.propertyId) last.rows.push(r)
      else out.push({ id: r.propertyId, name: r.propertyName, address: r.address, rows: [r] })
    }
    return out
  }, [roll.rows])

  const propName = propertyId
    ? tree.properties.find(p => p.propertyId === propertyId)?.propertyName
    : null

  return (
    <>
      <style>{FINANCE_THEME}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="portfolio"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Portfolio', href: '/landlord/financials/portfolio' },
            { label: 'Rent roll' },
          ]}
          title="Rent roll"
          sub={propName
            ? `${propName} — every unit, who is in it, what they pay and what they owe.`
            : 'Every unit you own, who is in it, what they pay and what they owe — the document a lender, insurer or accountant asks for.'}
          action={roll.rows.length > 0 ? { label: 'Print', onClick: () => window.print() } : undefined}
          secondary={roll.rows.length > 0
            ? { label: 'Export CSV', onClick: () => downloadCsv(`rent-roll-${new Date().toISOString().slice(0, 10)}.csv`, rentRollCsv(roll)) }
            : undefined}
          alarmCount={bounced}
          dueCount={behind}
          filters={
            <div className="filters">
              {tree.properties.length > 1 && (
                <select
                  className={`fsel${propertyId ? ' on' : ''}`}
                  value={propertyId}
                  onChange={e => setPropertyId(e.target.value)}
                  aria-label="Which property"
                >
                  <option value="">Every property</option>
                  {tree.properties.map(p => (
                    <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>
                  ))}
                </select>
              )}
              <label className="chk">
                <input
                  type="checkbox"
                  checked={includeEnded}
                  onChange={e => setIncludeEnded(e.target.checked)}
                />
                Include ended tenancies
              </label>
              <span className="fcount">
                {roll.units} unit{roll.units !== 1 ? 's' : ''} ·
                {' '}{roll.occupied} occupied · {roll.vacant} vacant
              </span>
            </div>
          }
        />

        {/* The document's own letterhead. Printed; invisible on screen it would
            be redundant with the hub, so it carries the as-of date instead. */}
        <div className="doc-head">
          <div>
            <div className="doc-kicker">Rent roll</div>
            <div className="doc-title">{propName ?? 'Whole portfolio'}</div>
          </div>
          <div className="doc-asof">
            <span>As at</span>
            <strong>{asOf}</strong>
          </div>
        </div>

        {loading ? (
          <div className="skeleton-hero" />
        ) : roll.rows.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Nothing to roll up yet</div>
            <p className="empty-sub">
              A rent roll is built from your payment plans and your listings. Set up a plan
              against a lease and each tenancy appears here as a row; add a room count to a
              listing and its empty rooms appear too, which is what makes this a rent roll
              rather than a list of leases.
            </p>
            <Link className="btn-primary" href="/landlord/financials/new">Create a payment plan</Link>
          </div>
        ) : (
          <>
            {/* ══ THE TOTALS, FIRST — it is what the reader came for ══ */}
            <section className="kpis" aria-label="Summary">
              <div className="kpi hero">
                <div className="kpi-label">Contracted rent</div>
                <div className="kpi-value fig-in">{fmtCurrency(roll.contracted)}<span className="per">/mo</span></div>
                <div className="kpi-meta">
                  across {roll.occupied} occupied unit{roll.occupied !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Fully let</div>
                <div className="kpi-value">{fmtCurrency(roll.potential)}<span className="per">/mo</span></div>
                <div className="kpi-meta">
                  {roll.vacant === 0
                    ? 'every unit is let'
                    : <>contracted plus asking rent on {roll.vacant} vacanc{roll.vacant !== 1 ? 'ies' : 'y'}</>}
                </div>
              </div>
              <div className={`kpi${roll.vacancyLoss > 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Vacancy</div>
                <div className={`kpi-value${roll.vacancyLoss > 0 ? ' fig-late' : ''}`}>
                  {roll.vacant === 0 ? 'None' : fmtCurrency(roll.vacancyLoss)}
                </div>
                <div className="kpi-meta">
                  {roll.occupancyPct !== null
                    ? `${roll.occupancyPct}% occupied`
                    : 'occupancy unknown'}
                  {roll.vacancyLossPartial && ' · some vacancies not priced'}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Deposits held</div>
                <div className="kpi-value">{fmtCurrency(roll.deposits)}</div>
                <div className="kpi-meta">
                  {roll.balance > 0
                    ? <>and {fmtCurrency(roll.balance)} owed to you</>
                    : 'nothing outstanding'}
                </div>
              </div>
            </section>

            {/* The document has to declare what it does not know, above the
                table, where a reader cannot miss it. */}
            {(roll.unknownUnitCounts.length > 0 || roll.vacancyLossPartial) && (
              <div className="doc-caveat">
                <strong>What this roll does not know.</strong>
                <ul>
                  {roll.unknownUnitCounts.length > 0 && (
                    <li>
                      {roll.unknownUnitCounts.join(', ')} {roll.unknownUnitCounts.length === 1 ? 'has' : 'have'} no
                      room count on the listing, so {roll.unknownUnitCounts.length === 1 ? 'its' : 'their'} units
                      here are tenancies rather than rooms and any empty rooms are not shown.
                      The occupancy figure excludes {roll.unknownUnitCounts.length === 1 ? 'it' : 'them'}.
                    </li>
                  )}
                  {roll.vacancyLossPartial && (
                    <li>
                      At least one vacant room has no asking rent on its listing, so the
                      vacancy figure is lower than the real one. This page will not price a
                      room the landlord has not priced.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* ══ THE ROLL ══ */}
            {grouped.map(g => (
              <section className="card flush" key={g.id}>
                <div className="card-hd top">
                  <div>
                    <h2 className="card-title">
                      <Link className="cell-link" href={propertyHref(g.id)}>{g.name}</Link>
                    </h2>
                    <p className="card-sub">
                      {g.address ?? 'No address on the listing'}
                      {' · '}{g.rows.length} unit{g.rows.length !== 1 ? 's' : ''}
                      {' · '}
                      {fmtCurrency(g.rows.reduce((n, r) => n + (r.rentIsAsking ? 0 : r.rent ?? 0), 0))}/mo contracted
                    </p>
                  </div>
                </div>

                <div className="tbl-scroll">
                  <table className="tbl roomy">
                    <thead>
                      <tr>
                        <th>Unit / tenancy</th>
                        <th>Tenants</th>
                        <th>Term</th>
                        <th className="num">Rent</th>
                        <th className="num">Deposit</th>
                        <th className="num">Owed</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(r => (
                        <tr key={r.key} className={r.state === 'vacant' ? 'vac' : ''}>
                          <td>
                            {r.leaseKey
                              ? <Link className="cell-link" href={leaseHref(r.leaseKey)}>{r.unit}</Link>
                              : <span className="vac-name">{r.unit}</span>}
                          </td>
                          <td>
                            {r.tenants.length > 0
                              ? r.tenants.join(', ')
                              : <span className="muted">—</span>}
                          </td>
                          <td className="nowrap">
                            {r.termStart && r.termEnd
                              ? <>{fmtDate(r.termStart)} – {fmtDate(r.termEnd)}</>
                              : <span className="muted">—</span>}
                            {r.daysLeft !== null && r.daysLeft > 0 && r.daysLeft <= 90 && (
                              <span className="pill warn">{r.daysLeft}d</span>
                            )}
                          </td>
                          <td className="num">
                            {r.rent === null
                              ? <span className="muted">not priced</span>
                              : <>
                                  {fmtCurrency(r.rent)}
                                  {r.rentIsAsking && <span className="pill plain">asking</span>}
                                </>}
                          </td>
                          <td className="num">
                            {r.deposit > 0 ? fmtCurrency(r.deposit) : <span className="muted">—</span>}
                          </td>
                          <td className="num">
                            {r.balance > 0
                              ? <span className="fig-late">{fmtCurrency(r.balance)}</span>
                              : <span className="muted">—</span>}
                          </td>
                          <td>
                            <StatusDot tone={ROLL_STATE_META[r.state].tone}>
                              {ROLL_STATE_META[r.state].label}
                            </StatusDot>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            {/* ══ THE BOTTOM LINE ══ */}
            <section className="card">
              <div className="card-hd top">
                <div>
                  <h2 className="card-title">Totals</h2>
                  <p className="card-sub">
                    {propName ?? 'Whole portfolio'} · as at {asOf}
                  </p>
                </div>
              </div>
              <div className="tot-lines">
                <div className="tot-line">
                  <span>Contracted monthly rent</span>
                  <strong>{fmtCurrency(roll.contracted)}</strong>
                </div>
                <div className="tot-line">
                  <span>Asking rent on vacant units</span>
                  <strong>{roll.vacancyLoss > 0 ? fmtCurrency(roll.vacancyLoss) : '—'}</strong>
                </div>
                <div className="tot-line rule">
                  <span>Monthly rent fully let</span>
                  <strong>{fmtCurrency(roll.potential)}</strong>
                </div>
                <div className="tot-line">
                  <span>Annualised, fully let</span>
                  <strong>{fmtCurrency(roll.potential * 12)}</strong>
                </div>
                <div className="tot-line">
                  <span>Deposits held (a liability, not income)</span>
                  <strong>{fmtCurrency(roll.deposits)}</strong>
                </div>
                <div className="tot-line">
                  <span>Rent owed as at today</span>
                  <strong className={roll.balance > 0 ? 'fig-late' : ''}>
                    {roll.balance > 0 ? fmtCurrency(roll.balance) : '—'}
                  </strong>
                </div>
              </div>
              <p className="card-note">
                Rent figures are monthly and contracted — what the leases say, not what has
                been collected. Collection is on the{' '}
                <Link className="lnk" href="/landlord/financials">Overview</Link>, and a
                month’s receipts with the arithmetic shown are on the{' '}
                <Link className="lnk" href="/landlord/financials/statement">owner statement</Link>.
                Deposits are money held on someone else’s behalf and are deliberately not
                added into any rent total here.
                {!includeEnded && ' Ended tenancies are excluded; tick the box above to include them.'}
              </p>
            </section>
          </>
        )}
      </div>
    </>
  )
}

const CSS = `
  /* ── The letterhead ─────────────────────────────────────────────────────── */
  .fin .doc-head {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 16px; padding: 0 2px 14px; margin-bottom: 18px;
    border-bottom: 2px solid var(--ink);
  }
  .fin .doc-kicker {
    font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--ink-2);
  }
  .fin .doc-title {
    font-size: 23px; font-weight: 600; letter-spacing: -0.022em; margin-top: 3px;
  }
  .fin .doc-asof {
    display: grid; gap: 2px; text-align: right;
    font-size: 11.5px; color: var(--ink-2);
  }
  .fin .doc-asof strong { font-size: 13px; color: var(--ink); font-weight: 600; }

  /* A caveat a reader cannot miss, because the people this page is for were
     not there and will take every figure at face value. */
  .fin .doc-caveat {
    border: 1px solid var(--fee-line); background: var(--fee-bg);
    border-radius: 14px; padding: 13px 16px; margin-bottom: 18px;
    font-size: 12.5px; line-height: 1.55; color: var(--ink);
  }
  .fin .doc-caveat ul { margin: 6px 0 0; padding-left: 18px; }
  .fin .doc-caveat li { margin-bottom: 4px; }

  .fin .chk {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 12px; color: var(--ink-2); cursor: pointer; white-space: nowrap;
  }

  .fin .kpi-value .per { font-size: 12px; font-weight: 400; color: var(--ink-2); }

  /* A vacancy reads as an absence rather than as a row that failed. */
  .fin .tbl tr.vac td { background: var(--surface-2); color: var(--ink-2); }
  .fin .vac-name { font-style: italic; }
  .fin .cell-link { color: inherit; text-decoration: none; font-weight: 500; }
  .fin .cell-link:hover { text-decoration: underline; }
  .fin .nowrap { white-space: nowrap; }

  /* ── Totals ─────────────────────────────────────────────────────────────── */
  .fin .tot-lines { display: grid; gap: 1px; }
  .fin .tot-line {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 14px; padding: 9px 0; font-size: 13px; color: var(--ink-2);
    border-bottom: 1px solid var(--line-2);
  }
  .fin .tot-line:last-child { border-bottom: 0; }
  .fin .tot-line strong {
    font-size: 15px; font-weight: 600; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .fin .tot-line.rule {
    border-top: 1px solid var(--ink); border-bottom-color: var(--line);
    margin-top: 4px; padding-top: 11px;
  }
  .fin .tot-line.rule span { color: var(--ink); font-weight: 500; }
  .fin .tot-line.rule strong { font-size: 19px; letter-spacing: -0.02em; }

  @media print {
    /* The letterhead is the one thing that must print, and it is the heading
       the hub's own title row cannot be. */
    .fin .doc-head { page-break-after: avoid; }
    .fin .chk { display: none !important; }
    .fin .card { break-inside: auto; }
    .fin .tbl tr { break-inside: avoid; }
  }

  @media (max-width: 700px) {
    .fin .doc-head { flex-direction: column; align-items: flex-start; gap: 10px; }
    .fin .doc-asof { text-align: left; }
  }
`
