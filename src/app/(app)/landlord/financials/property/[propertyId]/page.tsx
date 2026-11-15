'use client'

/**
 * One property's money — both sides of it.
 *
 * ── The thing that was missing ─────────────────────────────────────────────
 *
 * This area had a page for a lease and a page for a payment plan, and none for
 * a *property*. A landlord asking the most natural question they have — "how is
 * 412 Maple doing" — had an anchor on a tree to expand and nothing else. Every
 * figure about a building existed somewhere; none of them were ever in one
 * place, and three of them did not exist at all.
 *
 * That is backwards. A lease is a contract and a plan is a billing
 * arrangement; neither is a thing anybody owns. The property is the asset, the
 * unit of a decision — keep it, refinance it, raise the rent, sell it — and
 * every one of those decisions needs figures this product could not previously
 * put on one screen.
 *
 * ── What it answers, in order ──────────────────────────────────────────────
 *
 *   1. **Is it making money.** Collected, cost, NOI, cash flow — the four
 *      figures, over a window you choose. Not available anywhere before this
 *      page, because the product held no costs.
 *   2. **Is it full, and what is the empty part costing.** A six-bed house with
 *      four tenants is not four successes, it is a $1,400 hole, valued at the
 *      landlord's own asking rent.
 *   3. **Is the rent right.** Contracted against what the listing asks for the
 *      same space — and silent when there is no asking price, rather than
 *      inventing a market figure.
 *   4. **Who is in it and who owes.** Every tenancy, with its arrears, linking
 *      down to the lease page.
 *   5. **Where the money went.** Cost by category, with the ledger a click
 *      away.
 *   6. **Month by month.** The twelve-month table, both sides, with the month
 *      opening in the schedule.
 *
 * ── The restraint ─────────────────────────────────────────────────────────
 *
 * Several figures here are *absent* rather than estimated, and that is the
 * design. No cap rate: that needs a current valuation this product has no
 * honest source for. No market rent: the comps pool is still too small to
 * advise on. No projected NOI: a forecast of costs that have not been incurred
 * is a model pretending to be a ledger. Where a number cannot be derived from
 * something the landlord themselves entered, this page says so in words.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { supabase } from '@/lib/supabase'
import { useMoney } from '@/lib/useMoney'
import { useExpenses } from '@/lib/useExpenses'
import { allCharges, arrears, monthLabel } from '@/lib/financialsMonth'
import { buildTree, leaseHref } from '@/lib/financialsTree'
import {
  CATEGORY_META, GROUP_META, GROUP_ORDER, downloadCsv, expensesCsv,
  totalExpenses,
} from '@/lib/propertyExpenses'
import {
  askGap, monthlyPnl, occupancy, periodPnl, windowLabel, windowMonths,
  PNL_WINDOWS, type PnlWindow, type PropertyFacts,
} from '@/lib/propertyMoney'
import MoneyHub from '@/components/finance/MoneyHub'
import ExpenseSheet, { EXPENSE_SHEET_CSS, type ExpenseDraft } from '@/components/finance/ExpenseSheet'
import { StatusDot, PANEL_CSS } from '@/components/finance/Panels'
import { FINANCE_THEME } from '@/lib/financeTheme'

export default function PropertyMoneyPage({
  params,
}: {
  params: Promise<{ propertyId: string }>
}) {
  const { propertyId } = use(params)
  const { plans, bounced, loading: moneyLoading } = useMoney()
  const { items: allExpenses, loading: expLoading, reload } = useExpenses()

  const [win, setWin] = useState<PnlWindow>('12m')
  const [facts, setFacts] = useState<PropertyFacts | null>(null)
  /** Null until the lookup finishes; false once we know there is no such row. */
  const [factsLoaded, setFactsLoaded] = useState(false)
  const [draft, setDraft] = useState<ExpenseDraft | null>(null)

  /**
   * The listing row, which the money data does not carry.
   *
   * `useMoney` loads plans with only `id, name, slug` of the property, and
   * widening that select would add columns to the heaviest read in the portal
   * for the benefit of one page. So this page asks for its own five fields —
   * the ones that decide what the property *could* earn, which is the whole
   * point of occupancy and the asking-rent comparison.
   *
   * RLS keys `properties` on ownership, so the filter here is the id alone and
   * an owner mismatch returns nothing rather than someone else's building.
   */
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('properties')
        .select('id, name, slug, address, price, total_rooms, beds, baths, security_deposit, listing_status, available_from')
        .eq('id', propertyId)
        .maybeSingle()
      setFacts((data as PropertyFacts) ?? null)
      setFactsLoaded(true)
    })()
  }, [propertyId])

  const tree = useMemo(() => buildTree(plans, []), [plans])
  const prop = useMemo(
    () => tree.properties.find(p => p.propertyId === propertyId) ?? null,
    [tree.properties, propertyId],
  )

  const scopedPlans = useMemo(
    () => plans.filter(p => (p.property?.id ?? p.property_id) === propertyId),
    [plans, propertyId],
  )
  const charges = useMemo(() => allCharges(scopedPlans), [scopedPlans])
  const expenses = useMemo(
    () => allExpenses.filter(e => e.property_id === propertyId),
    [allExpenses, propertyId],
  )

  const months = windowMonths(win)
  const series = useMemo(() => monthlyPnl(charges, expenses, months), [charges, expenses, months])
  const period = useMemo(() => periodPnl(series, windowLabel(win)), [series, win])
  const spend = useMemo(() => totalExpenses(expenses), [expenses])
  const occ = useMemo(() => occupancy(facts, prop), [facts, prop])
  const ask = useMemo(() => askGap(facts, prop), [facts, prop])
  const ar = useMemo(() => arrears(scopedPlans), [scopedPlans])
  const behindAll = useMemo(() => arrears(plans).payerCount, [plans])

  const name = prop?.propertyName ?? facts?.name ?? 'This property'
  const loading = moneyLoading || expLoading || !factsLoaded

  useEffect(() => { document.title = `${name} — Financials | HomeHive` }, [name])

  const onSaved = useCallback(async () => { await reload() }, [reload])

  /** The window's own expenses, for the breakdown panel and the export. */
  const windowExpenses = useMemo(() => {
    const keys = new Set(series.filter(m => m.position !== 'future').map(m => m.key))
    return expenses.filter(e => keys.has(e.incurred_on.slice(0, 7)))
  }, [expenses, series])
  const windowSpend = useMemo(() => totalExpenses(windowExpenses), [windowExpenses])

  /** The scale for the month table's inline bars. */
  const peak = Math.max(1, ...series.map(m => Math.max(m.received, m.billed, m.expenses.all)))

  // A property with no plans *and* no listing row is not a property this
  // landlord has — an id typed into the URL, or one since deleted.
  if (!loading && !prop && !facts) {
    return (
      <>
        <style>{FINANCE_THEME}</style>
        <div className="fin fin-wrap">
          <MoneyHub
            tab={null}
            crumbs={[
              { label: 'Financials', href: '/landlord/financials' },
              { label: 'Portfolio', href: '/landlord/financials/portfolio' },
              { label: 'Not found' },
            ]}
            title="No such property"
            sub="It may have been deleted, or belong to another account."
            action={{ label: 'Back to the portfolio', href: '/landlord/financials/portfolio' }}
          />
        </div>
      </>
    )
  }

  return (
    <>
      <style>{FINANCE_THEME}{PANEL_CSS}{EXPENSE_SHEET_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="portfolio"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Portfolio', href: '/landlord/financials/portfolio' },
            { label: name },
          ]}
          title={name}
          sub={facts?.address
            ? facts.address
            : prop
              ? `${prop.leases.length} tenanc${prop.leases.length !== 1 ? 'ies' : 'y'} · ${fmtCurrency(prop.monthly)}/mo contracted`
              : 'No rent is being tracked against this property yet.'}
          action={{ label: 'Record a cost', onClick: () => setDraft({ propertyId }) }}
          secondary={{
            label: 'Owner statement',
            href: `/landlord/financials/statement?property=${propertyId}`,
          }}
          alarmCount={bounced}
          dueCount={behindAll}
          filters={
            <div className="filters">
              <select
                className="fsel on"
                value={win}
                onChange={e => setWin(e.target.value as PnlWindow)}
                aria-label="Window"
              >
                {PNL_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
              <span className="fcount">
                {period.completedMonths} finished month{period.completedMonths !== 1 ? 's' : ''} of data
                {windowSpend.count === 0 && ' · no costs recorded'}
              </span>
              {facts?.slug && (
                <Link className="btn-quiet sm" href={`/homes/${facts.slug}`}>
                  View the listing →
                </Link>
              )}
            </div>
          }
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : (
          <>
            {/* ══ 1. IS IT MAKING MONEY ══ */}
            <section className="kpis" aria-label="Performance">
              <div className="kpi hero">
                <div className="kpi-label">Collected</div>
                <div className="kpi-value fig-in">{fmtCurrency(period.received)}</div>
                <div className="kpi-meta">
                  over {windowLabel(win).toLowerCase()}
                  {period.billed > 0 && <> · {Math.round((period.received / period.billed) * 100)}% of {fmtCurrency(period.billed)} billed</>}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Running cost</div>
                <div className={`kpi-value${period.expenses.operating > 0 ? ' fig-fee' : ''}`}>
                  {period.expenses.operating > 0 ? fmtCurrency(period.expenses.operating) : '—'}
                </div>
                <div className="kpi-meta">
                  {period.expenses.operating > 0
                    ? 'fixed and operating, debt excluded'
                    : 'nothing recorded for this property'}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">NOI</div>
                <div className={`kpi-value${period.pnl.noi < 0 ? ' fig-late' : ''}`}>
                  {fmtCurrency(period.pnl.noi)}
                </div>
                <div className="kpi-meta">
                  {period.expenses.operating === 0
                    ? 'no costs recorded — this is just the rent'
                    : period.pnl.margin !== null
                      ? `${period.pnl.margin}% margin on what came in`
                      : 'what the building earns, debt aside'}
                </div>
              </div>
              <div className={`kpi${period.pnl.cashFlow < 0 ? ' hot' : ''}`}>
                <div className="kpi-label">Cash flow</div>
                <div className={`kpi-value${period.pnl.cashFlow < 0 ? ' fig-late' : ''}`}>
                  {fmtCurrency(period.pnl.cashFlow)}
                </div>
                <div className="kpi-meta">
                  {period.perMonth !== null
                    ? `${fmtCurrency(period.perMonth)} a month across ${period.completedMonths} finished month${period.completedMonths !== 1 ? 's' : ''}`
                    : 'no finished month in this window yet'}
                </div>
              </div>
            </section>

            {windowSpend.count === 0 && (
              <div className="note-bar">
                <span>
                  <strong>No costs recorded against {name}.</strong> So its NOI and cash
                  flow above are simply its rent, which tells you nothing about whether it
                  is worth owning. Mortgage interest, property tax and insurance are the
                  three that decide it for most rentals.
                </span>
                <button className="btn-secondary sm" onClick={() => setDraft({ propertyId })}>
                  Record a cost
                </button>
              </div>
            )}

            {prop && prop.owed > 0 && (
              <Link className="alarm-bar" href="/landlord/financials/collections">
                <span>
                  <strong>{fmtCurrency(prop.owed)} overdue on this property.</strong>{' '}
                  {ar.payerCount} {ar.payerCount === 1 ? 'person is' : 'people are'} behind
                  {ar.maxDaysLate > 0 && <> — the worst by {ar.maxDaysLate} days</>}.
                </span>
                <span className="go">Work collections →</span>
              </Link>
            )}

            <div className="grid-2">
              {/* ══ 2. IS IT FULL ══ */}
              <section className="card">
                <div className="card-hd top">
                  <div>
                    <h2 className="card-title">Occupancy</h2>
                    <p className="card-sub">
                      {occ.rooms !== null
                        ? <>{occ.filled} of {occ.rooms} room{occ.rooms !== 1 ? 's' : ''} let</>
                        : <>Who is paying right now</>}
                    </p>
                  </div>
                  {occ.pct !== null && (
                    <span className={`pill ${occ.pct === 100 ? 'good' : occ.pct >= 70 ? 'warn' : 'bad'}`}>
                      {occ.pct}% full
                    </span>
                  )}
                </div>

                {occ.rooms === null ? (
                  <p className="muted card-prose">
                    This listing does not say how many rooms it has, so occupancy cannot be
                    worked out — and guessing it from the number of tenants would always
                    read as 100% full. {occ.filled} {occ.filled === 1 ? 'person is' : 'people are'}{' '}
                    paying on a live lease.
                    {facts?.slug && <> <Link className="lnk" href={`/landlord/listings`}>Set the room count</Link> and this fills in.</>}
                  </p>
                ) : (
                  <>
                    <div className="occ-rooms" aria-hidden="true">
                      {Array.from({ length: occ.rooms }, (_, i) => (
                        <span key={i} className={`occ-room${i < occ.filled ? ' on' : ''}`} />
                      ))}
                    </div>
                    <div className="occ-lines">
                      <div className="occ-line">
                        <span>Let</span>
                        <strong>{occ.filled} room{occ.filled !== 1 ? 's' : ''}</strong>
                      </div>
                      <div className="occ-line">
                        <span>Empty</span>
                        <strong className={occ.empty! > 0 ? 'fig-late' : ''}>
                          {occ.empty} room{occ.empty !== 1 ? 's' : ''}
                        </strong>
                      </div>
                      {occ.monthlyLoss !== null && occ.monthlyLoss > 0 && (
                        <div className="occ-line big">
                          <span>Costing you each month</span>
                          <strong className="fig-late">{fmtCurrency(occ.monthlyLoss)}</strong>
                        </div>
                      )}
                    </div>
                    {occ.empty! > 0 && occ.monthlyLoss === null && (
                      <p className="card-note">
                        {occ.empty} room{occ.empty !== 1 ? 's are' : ' is'} empty. The listing
                        carries no asking price, so what that is costing cannot be stated —
                        and a figure derived from what sitting tenants pay would be a
                        different number pretending to be this one.
                      </p>
                    )}
                    {occ.empty! > 0 && occ.monthlyLoss !== null && (
                      <p className="card-note">
                        At {occ.lossBasis}. Over a year that is{' '}
                        {fmtCurrency(occ.monthlyLoss * 12)} — usually far more than the
                        concession it would take to fill {occ.empty !== 1 ? 'them' : 'it'}.
                      </p>
                    )}
                  </>
                )}

                {occ.empty !== null && occ.empty > 0 && (
                  <div className="card-ft">
                    <Link className="btn-secondary sm" href="/landlord/leads">Who is enquiring →</Link>
                    <Link className="btn-quiet sm" href="/landlord/performance">Listing performance →</Link>
                  </div>
                )}
              </section>

              {/* ══ 3. IS THE RENT RIGHT ══ */}
              <section className="card">
                <div className="card-hd top">
                  <div>
                    <h2 className="card-title">The rent</h2>
                    <p className="card-sub">What it is contracted at, against what you ask</p>
                  </div>
                </div>

                <div className="occ-lines">
                  <div className="occ-line big">
                    <span>Contracted now</span>
                    <strong>{fmtCurrency(ask.contracted)}<span className="per">/mo</span></strong>
                  </div>
                  {ask.asking !== null && (
                    <div className="occ-line">
                      <span>Fully let at today’s ask</span>
                      <strong>{fmtCurrency(ask.asking)}<span className="per">/mo</span></strong>
                    </div>
                  )}
                  {prop && prop.utilitiesMonthly > 0 && (
                    <div className="occ-line">
                      <span>Of which utilities</span>
                      <strong>{fmtCurrency(prop.utilitiesMonthly)}<span className="per">/mo</span></strong>
                    </div>
                  )}
                  {prop && (
                    <div className="occ-line">
                      <span>Deposits you are holding</span>
                      <strong>{fmtCurrency(prop.depositsHeld)}</strong>
                    </div>
                  )}
                </div>

                {ask.gap === null ? (
                  <p className="card-note">
                    The listing carries no asking price, so there is nothing to compare the
                    contracted rent against. This product will not invent a market figure —
                    the comparable pool it holds is still too small to advise on, and a made-up
                    “you are under market by $300” would be the most damaging number on this
                    page.
                  </p>
                ) : ask.gap > 0 ? (
                  <p className="card-note">
                    <strong>{fmtCurrency(ask.gap)} a month below what you ask</strong> ({ask.basis}).
                    That is the gap between the rent you have signed and the price you have
                    decided the space is worth — usually empty rooms, sometimes a concession
                    given to keep a good tenant.
                  </p>
                ) : (
                  <p className="card-note">
                    Contracted rent is at or above {ask.basis}. Nothing to recover from
                    pricing here; the question is renewals, not rate.
                  </p>
                )}

                <div className="card-ft">
                  <Link className="btn-secondary sm" href="/landlord/renewals">Renewals →</Link>
                  {prop && prop.leases.length > 0 && (
                    <Link className="btn-quiet sm" href="/landlord/financials/schedule">
                      What falls due →
                    </Link>
                  )}
                </div>
              </section>
            </div>

            {/* ══ 4. WHO IS IN IT ══ */}
            <section className="card flush">
              <div className="card-hd top">
                <div>
                  <h2 className="card-title">Tenancies</h2>
                  <p className="card-sub">
                    {prop
                      ? <>{prop.leases.length} on this property · {prop.activeLeases} live · {prop.payerCount} payer{prop.payerCount !== 1 ? 's' : ''}</>
                      : <>None yet</>}
                  </p>
                </div>
                <Link className="btn-secondary sm" href="/landlord/financials/new">
                  New payment plan
                </Link>
              </div>

              {!prop || prop.leases.length === 0 ? (
                <p className="muted card-prose">
                  No rent is being tracked against this property. Set up a payment plan
                  against a lease and its rent, splits, arrears and collection all appear
                  here and on every other money screen.
                </p>
              ) : (
                <div className="tbl-scroll">
                  <table className="tbl roomy">
                    <thead>
                      <tr>
                        <th>Tenancy</th>
                        <th>Term</th>
                        <th>Payers</th>
                        <th className="num">Rent</th>
                        <th className="num">Owed</th>
                        <th>State</th>
                        <th aria-label="Open" />
                      </tr>
                    </thead>
                    <tbody>
                      {prop.leases.map(l => (
                        <tr key={l.key}>
                          <td>
                            <Link className="cell-link" href={leaseHref(l.key)}>{l.label}</Link>
                          </td>
                          <td className="nowrap">
                            {l.termStart && l.termEnd
                              ? <>{fmtDate(l.termStart)} – {fmtDate(l.termEnd)}</>
                              : <span className="muted">—</span>}
                            {l.daysLeft !== null && l.daysLeft > 0 && l.daysLeft <= 90 && (
                              <span className="pill warn">{l.daysLeft}d left</span>
                            )}
                          </td>
                          <td>{l.activePayers}</td>
                          <td className="num">{fmtCurrency(l.monthly)}</td>
                          <td className="num">
                            {l.owed > 0
                              ? <span className="fig-late">{fmtCurrency(l.owed)}</span>
                              : <span className="muted">—</span>}
                          </td>
                          <td>
                            <StatusDot
                              tone={l.health === 'overdue' ? 'bad'
                                : l.health === 'due' ? 'warn'
                                : l.health === 'idle' ? 'idle' : 'good'}
                            >
                              {l.stageLabel}
                            </StatusDot>
                          </td>
                          <td className="xacts">
                            <Link className="lnk" href={leaseHref(l.key)}>open</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* ══ 5. WHERE THE MONEY WENT ══ */}
            <section className="card">
              <div className="card-hd top">
                <div>
                  <h2 className="card-title">What it costs</h2>
                  <p className="card-sub">
                    {windowSpend.count > 0
                      ? <>{fmtCurrency(windowSpend.all)} across {windowSpend.count} entr{windowSpend.count !== 1 ? 'ies' : 'y'} in {windowLabel(win).toLowerCase()}</>
                      : <>Nothing recorded in this window</>}
                    {spend.count > windowSpend.count && <> · {fmtCurrency(spend.all)} all time</>}
                  </p>
                </div>
                <div className="pickers">
                  {windowExpenses.length > 0 && (
                    <button
                      className="btn-quiet sm"
                      onClick={() => downloadCsv(
                        `costs-${(facts?.slug ?? propertyId)}-${win}.csv`,
                        expensesCsv(windowExpenses),
                      )}
                    >
                      Export CSV
                    </button>
                  )}
                  <Link
                    className="btn-secondary sm"
                    href={`/landlord/financials/expenses?property=${propertyId}`}
                  >
                    Open the ledger
                  </Link>
                </div>
              </div>

              {windowSpend.byCategory.length === 0 ? (
                <p className="muted card-prose">
                  Costs you record against this property land here, grouped so you can see
                  which part of the bill is debt, which is unavoidable, and which you could
                  actually change. It is also what makes the four figures at the top of this
                  page mean anything.
                </p>
              ) : (
                <div className="cats">
                  {GROUP_ORDER.filter(g => windowSpend.byGroup[g] > 0).map(g => (
                    <div key={g} className="cat-group">
                      <div className="cat-ghd">
                        <span className="cat-gname">{GROUP_META[g].label}</span>
                        <span className="cat-gamt num">{fmtCurrency(windowSpend.byGroup[g])}</span>
                      </div>
                      {windowSpend.byCategory.filter(c => c.group === g).map(c => (
                        <div key={c.category} className="cat-row static">
                          <span className="cat-name">{c.label}</span>
                          <span className="cat-bar" aria-hidden="true">
                            <span
                              className="cat-fill"
                              style={{
                                width: `${Math.max(2, c.share)}%`,
                                background: CATEGORY_META[c.category].color,
                              }}
                            />
                          </span>
                          <span className="cat-amt num">{fmtCurrency(c.amount)}</span>
                          <span className="cat-share">{c.share}%</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ══ 6. MONTH BY MONTH ══ */}
            <section className="card flush">
              <div className="card-hd top">
                <div>
                  <h2 className="card-title">Month by month</h2>
                  <p className="card-sub">
                    Both sides, by the month the money belongs to. Any month opens in the schedule.
                  </p>
                </div>
              </div>

              <div className="tbl-scroll">
                <table className="tbl roomy">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="num">Billed</th>
                      <th className="num">Collected</th>
                      <th className="num">Still due</th>
                      <th className="num">Cost</th>
                      <th className="num">Cash flow</th>
                      <th aria-label="Shape" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().map(m => (
                      <tr key={m.key} className={m.position === 'current' ? 'running' : ''}>
                        <td className="nowrap">
                          <Link className="cell-link" href={`/landlord/financials/schedule?month=${m.key}`}>
                            {monthLabel(m.key, true)}
                          </Link>
                          {m.position === 'current' && <span className="pill plain">in progress</span>}
                        </td>
                        <td className="num">{m.billed > 0 ? fmtCurrency(m.billed) : '—'}</td>
                        <td className="num">
                          {m.received > 0 ? <span className="fig-in">{fmtCurrency(m.received)}</span> : '—'}
                        </td>
                        <td className="num">
                          {m.stillDue > 0 ? <span className="fig-late">{fmtCurrency(m.stillDue)}</span> : '—'}
                        </td>
                        <td className="num">
                          {m.expenses.all > 0 ? fmtCurrency(m.expenses.all) : '—'}
                        </td>
                        <td className="num">
                          <span className={m.cashFlow < 0 ? 'fig-late' : ''}>
                            {fmtCurrency(m.cashFlow)}
                          </span>
                        </td>
                        <td>
                          <span className="rbar" aria-hidden="true">
                            <span className="rbar-in" style={{ width: `${(m.received / peak) * 100}%` }} />
                            <span className="rbar-out" style={{ width: `${(m.expenses.all / peak) * 100}%` }} />
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr className="tbl-total">
                      <td>{period.months} month{period.months !== 1 ? 's' : ''}</td>
                      <td className="num">{fmtCurrency(period.billed)}</td>
                      <td className="num">{fmtCurrency(period.received)}</td>
                      <td className="num">{fmtCurrency(period.stillDue)}</td>
                      <td className="num">{fmtCurrency(period.expenses.all)}</td>
                      <td className="num">{fmtCurrency(period.pnl.cashFlow)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="card-note">
                The table stops at the month in progress. What falls due <em>ahead</em> is the{' '}
                <Link className="lnk" href="/landlord/financials/schedule">Schedule</Link>, not
                this: a forward row here would show contracted rent against no cost yet
                incurred and read as a profit forecast. The running month is in every total
                above but kept out of the monthly average, because it is a part-month.
                Collected reads by the month the charge fell due, so October’s rent paid in
                November counts in October here; the{' '}
                <Link className="lnk" href="/landlord/financials/payments">Payments</Link>{' '}
                tab is the cash-dated view for reconciling against a bank statement.
              </p>
            </section>

            {/* ══ WHERE ELSE TO GO ══ */}
            <div className="dests">
              <Dest title="Owner statement"
                line="One month, on paper, for an accountant or a lender"
                href={`/landlord/financials/statement?property=${propertyId}`} />
              <Dest title="Trends"
                line="Collection and arrears for this property over any span"
                href={`/landlord/financials/trends?property=${propertyId}`} />
              <Dest title="Expenses"
                line="The full cost ledger and the tax-year summary"
                href={`/landlord/financials/expenses?property=${propertyId}`} />
              <Dest title="Maintenance"
                line="What needs doing, and what the last job cost"
                href="/landlord/maintenance" />
            </div>
          </>
        )}
      </div>

      {draft && (
        <ExpenseSheet
          draft={draft}
          properties={
            tree.properties.length > 0
              ? tree.properties.map(p => ({ id: p.propertyId, name: p.propertyName }))
              : [{ id: propertyId, name }]
          }
          leases={tree.leases
            .filter(l => l.leaseId)
            .map(l => ({ id: l.leaseId!, label: l.label, propertyId: l.propertyId }))}
          onClose={() => setDraft(null)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}

function Dest({ title, line, href }: { title: string; line: string; href: string }) {
  return (
    <Link className="dest" href={href}>
      <span className="dest-main">
        <span className="dest-title">{title}</span>
        <span className="dest-line">{line}</span>
      </span>
      <span className="row-chev" aria-hidden="true" />
    </Link>
  )
}

const CSS = `
  .fin .grid-2 {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px; margin-bottom: 18px;
  }

  .fin .note-bar {
    display: flex; align-items: center; gap: 14px; justify-content: space-between;
    background: var(--fee-bg); border: 1px solid var(--fee-line); border-radius: 14px;
    padding: 13px 16px; margin-bottom: 18px; font-size: 12.5px; line-height: 1.5;
    color: var(--ink);
  }

  /* ── Occupancy ──────────────────────────────────────────────────────────── */
  /* Rooms as pips rather than a percentage ring. A landlord with six bedrooms
     counts them; "67%" makes them do division to find out that two are empty. */
  .fin .occ-rooms { display: flex; gap: 5px; flex-wrap: wrap; margin: 4px 0 14px; }
  .fin .occ-room {
    width: 26px; height: 34px; border-radius: 6px;
    background: var(--surface-2); border: 1px solid var(--line);
  }
  .fin .occ-room.on { background: var(--in); border-color: var(--in); }

  .fin .occ-lines { display: grid; gap: 1px; }
  .fin .occ-line {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; padding: 7px 0; font-size: 12.5px; color: var(--ink-2);
    border-bottom: 1px solid var(--line-2);
  }
  .fin .occ-line:last-child { border-bottom: 0; }
  .fin .occ-line strong {
    font-size: 14px; font-weight: 600; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .fin .occ-line.big strong { font-size: 19px; letter-spacing: -0.02em; }
  .fin .occ-line .per { font-size: 11.5px; font-weight: 400; color: var(--ink-2); }

  /* ── Category breakdown ─────────────────────────────────────────────────── */
  .fin .cats { display: grid; gap: 18px; padding: 4px 0 2px; }
  .fin .cat-group { display: grid; gap: 2px; }
  .fin .cat-ghd {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid var(--line); padding-bottom: 5px; margin-bottom: 4px;
  }
  .fin .cat-gname { font-size: 12px; font-weight: 600; }
  .fin .cat-gamt { font-size: 13px; font-weight: 600; }
  .fin .cat-row {
    display: grid; grid-template-columns: minmax(84px, 1.1fr) minmax(40px, 1fr) auto 32px;
    align-items: center; gap: 10px; padding: 5px 0; font-size: 12px;
  }
  .fin .cat-name { color: var(--ink-2); }
  .fin .cat-bar { height: 7px; border-radius: 980px; background: var(--line-2); overflow: hidden; }
  .fin .cat-fill { display: block; height: 100%; border-radius: 980px; }
  .fin .cat-amt { font-size: 12.5px; font-weight: 500; }
  .fin .cat-share {
    font-size: 11px; color: var(--ink-3); text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* ── The month table ────────────────────────────────────────────────────── */
  /* The month in progress is a part-month, and the row should not read as a
     finished one sitting at the top of the table. */
  .fin .tbl tr.running td { background: var(--surface-2); }
  .fin .tbl tr.tbl-total td {
    border-top: 1px solid var(--line); font-weight: 600; background: var(--surface-2);
  }
  /* Two stacked rules rather than a sparkline: the question this column
     answers is "which way round were they", and that reads at a glance. */
  .fin .rbar { display: grid; gap: 3px; min-width: 70px; }
  .fin .rbar-in, .fin .rbar-out { height: 5px; border-radius: 980px; min-width: 1px; }
  .fin .rbar-in { background: var(--in); }
  .fin .rbar-out { background: var(--fee); }
  .fin .cell-link { color: inherit; text-decoration: none; font-weight: 500; }
  .fin .cell-link:hover { text-decoration: underline; }
  .fin .nowrap { white-space: nowrap; }
  .fin .xacts { text-align: right; color: var(--ink-3); }
  .fin .pickers { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  /* ── Destinations ───────────────────────────────────────────────────────── */
  .fin .dests {
    display: grid; gap: 12px; margin-bottom: 20px;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }
  .fin .dest {
    display: flex; align-items: flex-start; gap: 12px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 15px 16px; text-decoration: none; color: inherit; min-width: 0;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .dest:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  .fin .dest-main { flex: 1; min-width: 0; }
  .fin .dest-title { display: block; font-size: 13px; font-weight: 600; }
  .fin .dest-line {
    display: block; font-size: 11.5px; color: var(--ink-2); line-height: 1.45; margin-top: 4px;
  }
  .fin .dest .row-chev { margin-top: 5px; }

  @media (max-width: 1000px) {
    .fin .grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .fin .note-bar { flex-direction: column; align-items: flex-start; }
  }
`
