'use client'

/**
 * One tenancy's money.
 *
 * ── Why this page exists ───────────────────────────────────────────────────
 *
 * This is the page the product was missing. Money on a lease was only ever
 * reachable as a *payment plan*, so a tenancy billed through three plans had no
 * page at all — only three, each showing a third of the rent and all three
 * named after the same lease. A landlord asking the most ordinary question
 * there is, *how is this tenancy doing*, had to open three screens and add up.
 *
 * So the lease is the object. Its figures are the sum of its plans, its people
 * are the union of its plans' payers, and the plans appear as what they are:
 * the billing arrangements underneath. One lease, however many tenants,
 * however many plans.
 *
 * ── What is on it, in order ────────────────────────────────────────────────
 *
 *   1. **Vitals** — contract value, collected, still to collect, overdue,
 *      deposit, with the term's progress marked against the collection's. If
 *      the marker sits ahead of the fill, the tenancy is behind where it should
 *      be; that single comparison is the fastest read of a lease there is.
 *   2. **Who pays** — every tenant across every plan, with what they pay, what
 *      that figure is made of, and what they owe. This is the table that
 *      answers "which of them is short".
 *   3. **Utilities** — declared once per plan, and named, because the monthly
 *      figure silently includes them and a landlord otherwise cannot tell rent
 *      from the bills riding on it.
 *   4. **Every charge** — the full ledger for the tenancy, filterable, with
 *      each line opening the same detail sheet as everywhere else.
 *
 * Editing money is still the rent ledger's job, one click away per plan. This
 * page reports; the ledger writes.
 */

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree, findLease, planHref, type TreePayer } from '@/lib/financialsTree'
import { allCharges, type Charge } from '@/lib/financialsMonth'
import MoneyHub from '@/components/finance/MoneyHub'
import { ProgressBar, Meter, MethodMix, VIZ_CSS } from '@/components/finance/Charts'
import ChargeSheet, { StatePill, dayOrdinal, settledLabel } from '@/components/finance/ChargeSheet'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** What the charge list can be narrowed to. These are the questions actually
 *  asked of a tenancy's ledger, not a list of every state that exists. */
type ChargeFilter = 'all' | 'open' | 'overdue' | 'paid' | 'upcoming'

const CHARGE_FILTERS: { id: ChargeFilter; label: string; match: (c: Charge) => boolean }[] = [
  { id: 'all',      label: 'Every charge',   match: () => true },
  { id: 'open',     label: 'Still owed',     match: c => c.totalDue > 0 },
  { id: 'overdue',  label: 'Overdue only',   match: c => c.state === 'overdue' },
  { id: 'upcoming', label: 'Not due yet',    match: c => c.state === 'scheduled' },
  { id: 'paid',     label: 'Settled',        match: c => c.state === 'paid' },
]

export default function LeaseMoneyPage({
  params, searchParams,
}: {
  params: Promise<{ leaseKey: string }>
  searchParams: Promise<{ charges?: string; payer?: string }>
}) {
  const { leaseKey } = use(params)
  const sp = use(searchParams)
  const { plans, waivers, bounced, loading } = useMoney()

  const [filter, setFilter] = useState<ChargeFilter>(
    CHARGE_FILTERS.some(f => f.id === sp.charges) ? (sp.charges as ChargeFilter) : 'all',
  )
  const [payerFilter, setPayerFilter] = useState<string>(sp.payer ?? '')
  const [detail, setDetail] = useState<Charge | null>(null)
  const [openPayer, setOpenPayer] = useState<string | null>(null)

  // The whole portfolio is built so that this lease's figures are the same
  // arithmetic as the figures on every other money screen. It is one pass over
  // data already in memory — cheaper than a second definition would be to trust.
  const tree = useMemo(() => buildTree(plans, waivers), [plans, waivers])
  const lease = useMemo(() => findLease(tree, leaseKey), [tree, leaseKey])

  useEffect(() => {
    document.title = lease
      ? `${lease.propertyName} — Financials | HomeHive`
      : 'Lease — Financials | HomeHive'
  }, [lease])

  const planIds = useMemo(() => new Set(lease?.plans.map(p => p.planId) ?? []), [lease])
  const charges = useMemo(
    () => allCharges(plans.filter(p => planIds.has(p.id)))
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    [plans, planIds],
  )

  const shown = useMemo(() => {
    const f = CHARGE_FILTERS.find(x => x.id === filter)!
    return charges.filter(c => f.match(c) && (!payerFilter || c.payerId === payerFilter))
  }, [charges, filter, payerFilter])

  if (loading) {
    return (
      <>
        <style>{FINANCE_THEME}</style>
        <div className="fin fin-wrap"><div className="skeleton-hero" /></div>
      </>
    )
  }

  if (!lease) {
    return (
      <>
        <style>{FINANCE_THEME}{CSS}</style>
        <div className="fin fin-wrap">
          <MoneyHub
            tab="portfolio"
            crumbs={[{ label: 'Financials', href: '/landlord/financials' }, { label: 'Lease' }]}
            title="That lease is not here"
            sub="It may have been removed, or it belongs to another account."
            alarmCount={bounced}
          />
          <div className="empty">
            <div className="empty-title">Nothing to show</div>
            <p className="empty-sub">
              No tenancy in your portfolio matches this link. The portfolio view lists every
              property, lease and plan you have.
            </p>
            <Link href="/landlord/financials/portfolio" className="btn-primary">Open the portfolio</Link>
          </div>
        </div>
      </>
    )
  }

  const stillToCollect = Math.max(0, lease.contractValue - lease.contractCollected)

  return (
    <>
      <style>{FINANCE_THEME}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="portfolio"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Portfolio', href: '/landlord/financials/portfolio' },
            { label: lease.propertyName, href: `/landlord/financials/portfolio#p-${lease.propertyId}` },
            { label: lease.label },
          ]}
          title={lease.propertyName}
          sub={`${lease.label}${
            lease.termStart && lease.termEnd
              ? ` · ${fmtDate(lease.termStart)} – ${fmtDate(lease.termEnd)}`
              : ''}`}
          action={lease.leaseId
            ? { label: 'The tenancy', href: `/landlord/leases/${lease.leaseId}` }
            : undefined}
          secondary={lease.plans.length === 1
            ? { label: 'Rent ledger', href: planHref(lease.plans[0].planId) }
            : undefined}
          alarmCount={bounced}
          dueCount={lease.owed > 0 ? 1 : 0}
          meta={
            <div className="lmeta">
              <span className={`pill ${
                lease.stage === 'active' ? 'good'
                : lease.stage === 'ending' ? 'warn'
                : lease.stage === 'upcoming' ? 'info'
                : 'plain'}`}>
                {lease.stageLabel}
              </span>
              <span>{lease.activePayers} tenant{lease.activePayers !== 1 ? 's' : ''}</span>
              <span>{fmtCurrency(lease.monthly)}/mo</span>
              <span>rent due on the {lease.dueDays.map(dayOrdinal).join(' and ')}</span>
              {lease.splitBilling && (
                <span className="pill info">{lease.plans.length} payment plans</span>
              )}
              {lease.daysLeft !== null && lease.daysLeft >= 0 && lease.daysLeft <= 60 && (
                <span className="pill warn">{lease.daysLeft} days left on the term</span>
              )}
            </div>
          }
        />

        {/* ══ 1. VITALS ══ */}
        <section className="card">
          <div className="lvitals">
            <Fact label="Contract value" value={fmtCurrency(lease.contractValue)} meta="rent over the full term" />
            <Fact label="Collected" value={fmtCurrency(lease.contractCollected)} meta={`${lease.contractProgress ?? 0}% of the contract`} tone="good" />
            <Fact
              label="Still to collect"
              value={fmtCurrency(stillToCollect)}
              meta={lease.nextDue
                ? `next ${fmtCurrency(lease.nextDue.amount)} on ${fmtDate(lease.nextDue.date)}`
                : 'nothing scheduled'}
            />
            <Fact
              label="Overdue now"
              value={lease.owed > 0 ? fmtCurrency(lease.owed) : 'None'}
              meta={lease.lateFees > 0
                ? `incl. ${fmtCurrency(lease.lateFees)} of late fees`
                : 'nothing past due'}
              tone={lease.owed > 0 ? 'bad' : 'good'}
            />
            <Fact
              label="Deposits held"
              value={fmtCurrency(lease.depositsHeld)}
              meta={lease.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'}
            />
          </div>
          <ProgressBar
            pct={lease.contractProgress ?? 0}
            markAt={lease.termProgress}
            label={`${lease.contractProgress ?? 0}% of the contract collected, ${lease.termProgress ?? 0}% through the term`}
          />
          <div className="lvitals-key">
            <span>{lease.contractProgress ?? 0}% of contracted rent collected</span>
            {lease.termProgress !== null && (
              <span>
                marker = {lease.termProgress}% through the term
                {lease.termProgress > (lease.contractProgress ?? 0) + 3 && (
                  <b className="warn-ink"> · collection is behind the calendar</b>
                )}
              </span>
            )}
          </div>
        </section>

        {/* ══ 2. WHO PAYS ══
            Across every plan on the tenancy, which is the whole point. */}
        <section className="panel">
          <div className="panel-hd">
            <h2 className="panel-title">
              Who pays
              <span className="panel-n">{lease.payers.length}</span>
            </h2>
            <span className="panel-note">
              {lease.splitBilling
                ? `${lease.payers.length} tenants across ${lease.plans.length} payment plans`
                : `${lease.payers.length} tenant${lease.payers.length !== 1 ? 's' : ''} on one plan`}
            </span>
          </div>

          {lease.plans.map(pl => (
            <div key={pl.planId} className="pblock">
              {/* The plan header is only drawn when there is more than one —
                  on a normal lease it would be a label for a thing the
                  landlord does not need to think about. */}
              {lease.splitBilling && (
                <div className="pblock-hd">
                  <div>
                    <div className="pblock-name">{pl.name}</div>
                    <div className="pblock-sub">
                      rent due on the {dayOrdinal(pl.dueDay)} ·
                      {' '}{fmtCurrency(pl.monthly)}/mo ·
                      {' '}{pl.activePayers} payer{pl.activePayers !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="pblock-acts">
                    {pl.owed > 0 && <span className="pill bad">{fmtCurrency(pl.owed)} overdue</span>}
                    <Link className="btn-secondary sm" href={planHref(pl.planId)}>Ledger</Link>
                  </div>
                </div>
              )}

              <div className="tbl-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th className="num">Monthly</th>
                      <th className="num">Share</th>
                      <th className="num">Billed</th>
                      <th className="num">Collected</th>
                      <th className="num">Overdue</th>
                      <th>Last paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pl.payers.map(t => (
                      <PayerRow
                        key={t.id}
                        payer={t}
                        open={openPayer === t.id}
                        onToggle={() => setOpenPayer(openPayer === t.id ? null : t.id)}
                        onSeeCharges={() => {
                          setPayerFilter(t.id)
                          setFilter('all')
                          document.getElementById('charges')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {!lease.splitBilling && (
            <div className="panel-ft">
              <span>
                Rent on this tenancy is billed through one plan, <strong>{lease.plans[0].name}</strong>
                {lease.plans[0].feeRule && <> — late fee {lease.plans[0].feeRule}</>}
              </span>
              <Link className="btn-secondary sm" href={planHref(lease.plans[0].planId)}>
                Open the rent ledger
              </Link>
            </div>
          )}
        </section>

        <div className="cards two">
          {/* ══ 3. UTILITIES ══ */}
          <section className="card">
            <div className="card-hd">
              <div>
                <h2 className="card-title">Utilities and shared charges</h2>
                <p className="muted sm">
                  Declared on the lease, then billed through each payer&rsquo;s line items.
                </p>
              </div>
              {lease.utilitiesMonthly > 0 && (
                <span className="card-note">{fmtCurrency(lease.utilitiesMonthly)}/mo</span>
              )}
            </div>
            {lease.utilities.length === 0 ? (
              <p className="muted">
                No utilities are declared on this lease, so the monthly figure is rent alone.
                They are set up in the rent ledger.
              </p>
            ) : (
              <>
                <div className="utils">
                  {lease.utilities.map(u => (
                    <div key={u.id} className="util">
                      <span className="util-main">
                        <b>{u.label}</b>
                        <em>
                          {u.cadence === 'monthly' ? 'every month' : 'one time'} ·
                          {' '}{u.split === 'per_payer'
                            ? 'each payer pays this amount'
                            : 'one bill split evenly'}
                        </em>
                      </span>
                      <span className="util-fig">
                        <b>{fmtCurrency(u.amount)}</b>
                        <em>
                          {u.cadence === 'monthly'
                            ? `${fmtCurrency(u.houseMonthly)} across the house`
                            : 'one-off'}
                        </em>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="card-ft">
                  <span>
                    The {fmtCurrency(lease.monthly)}/mo above <strong>includes</strong> these —
                    base rent alone is {fmtCurrency(Math.max(0, lease.monthly - lease.utilitiesMonthly))}.
                  </span>
                </div>
              </>
            )}
          </section>

          {/* ══ HOW THIS TENANCY PAYS ══ */}
          <section className="card">
            <div className="card-hd">
              <div>
                <h2 className="card-title">How this tenancy pays</h2>
                <p className="muted sm">
                  Across the whole term — the pattern, not this month.
                </p>
              </div>
            </div>
            <div className="beh">
              <div>
                <div className="kpi-label">Collection rate</div>
                <div className="kpi-value sm">
                  {lease.totals.rate !== null ? `${lease.totals.rate}%` : '—'}
                </div>
                <Meter pct={lease.totals.rate} />
                <div className="kpi-meta">
                  {fmtCurrency(lease.totals.collected)} of {fmtCurrency(lease.totals.billed)} billed
                </div>
              </div>
              <div>
                <div className="kpi-label">Arrived late</div>
                <div className="kpi-value sm">
                  {lease.totals.collectedLateCount}
                  <small>/{lease.totals.settledCount}</small>
                </div>
                <div className="kpi-meta">
                  {lease.totals.collectedLateCount > 0
                    ? `${fmtCurrency(lease.totals.collectedLate)} paid after the due date · worst ${
                        lease.totals.maxDaysLate} days`
                    : 'every settled charge arrived on time'}
                </div>
              </div>
            </div>
            {lease.plans.some(p => p.summary.methods.length > 0) && (
              <>
                <div className="sec-hd tight">
                  <h3 className="sec-title sm">How the money arrives</h3>
                </div>
                <MethodMix slices={lease.plans.flatMap(p => p.summary.methods)} />
              </>
            )}
            {lease.plans.some(p => p.feeRisk) && (
              <div className="card-ft">
                <span className="warn-ink">
                  {lease.plans.find(p => p.feeRisk)!.feeRisk}
                </span>
              </div>
            )}
          </section>
        </div>

        {/* ══ 4. EVERY CHARGE ══ */}
        <section className="panel" id="charges">
          <div className="panel-hd">
            <h2 className="panel-title">Every charge</h2>
            <span className="panel-note">
              {shown.length} of {charges.length} ·
              {' '}{fmtCurrency(shown.reduce((n, c) => n + c.totalDue, 0))} still due
            </span>
          </div>

          <div className="chg-filters">
            <div className="seg" role="tablist" aria-label="Which charges">
              {CHARGE_FILTERS.map(f => {
                const n = charges.filter(x => f.match(x)).length
                if (n === 0 && f.id !== 'all') return null
                return (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={filter === f.id}
                    className={`seg-btn${filter === f.id ? ' on' : ''}${
                      f.id === 'overdue' && n > 0 ? ' hot' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="seg-badge">{n}</span>
                  </button>
                )
              })}
            </div>
            <select
              className={`fsel${payerFilter ? ' on' : ''}`}
              value={payerFilter}
              onChange={e => setPayerFilter(e.target.value)}
              aria-label="Which payer"
            >
              <option value="">Everyone on the lease</option>
              {lease.payers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Charge</th>
                  <th>Who</th>
                  <th>Due</th>
                  <th className="num">Amount</th>
                  <th className="num">Paid</th>
                  <th className="num">Still due</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={7} className="muted" style={{ padding: '22px 12px' }}>
                    Nothing matches that filter on this tenancy.
                  </td></tr>
                ) : shown.map(c => {
                  const when = c.settlement?.paidDate
                    ? settledLabel({ paidDate: c.settlement.paidDate, settledAt: c.settlement.settledAt })
                    : null
                  return (
                    <tr key={`${c.kind}-${c.id}`} className="click" onClick={() => setDetail(c)}>
                      <td className="cell-main">
                        <b>{c.label}</b>
                        <em>
                          {c.kind === 'charge' ? (c.categoryLabel ?? 'one-off') : 'rent'}
                          {when && <> · paid {when.date}</>}
                        </em>
                      </td>
                      <td>{c.who ?? <span className="muted sm">the lease</span>}</td>
                      <td>
                        {fmtDate(c.dueDate)}
                        {c.daysLate > 0 && <em className="cell-note">{c.daysLate}d late</em>}
                      </td>
                      <td className="num">{fmtCurrency(c.amount)}</td>
                      <td className="num">{c.paid > 0 ? fmtCurrency(c.paid) : '—'}</td>
                      <td className={`num${c.totalDue > 0 ? ' owed' : ''}`}>
                        {c.totalDue > 0 ? fmtCurrency(c.totalDue) : '—'}
                        {c.lateFee > 0 && <em className="cell-note">incl. {fmtCurrency(c.lateFee)} fee</em>}
                      </td>
                      <td><StatePill state={c.state} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="panel-ft">
            <span>
              Any row opens its full breakdown — what it was made of, the fee the rule assessed,
              and who has been chased about it.
            </span>
            <Link className="btn-quiet sm" href="/landlord/financials/payments">
              The payments log →
            </Link>
          </div>
        </section>
      </div>

      {detail && <ChargeSheet charge={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

/** One tenant on the tenancy, and — opened — what their figure is made of. */
function PayerRow({
  payer: t, open, onToggle, onSeeCharges,
}: {
  payer: TreePayer
  open: boolean
  onToggle: () => void
  onSeeCharges: () => void
}) {
  return (
    <>
      <tr className="click" onClick={onToggle} aria-expanded={open}>
        <td className="cell-main">
          <b>
            <span className={`twist${open ? ' open' : ''}`} aria-hidden="true" />
            {t.name}
            {t.status !== 'active' && (
              <span className="pill plain">{t.status === 'terminated' ? 'moved out' : 'finished'}</span>
            )}
          </b>
          <em>{t.email ?? 'no email on file'}</em>
        </td>
        <td className="num">{fmtCurrency(t.monthly)}</td>
        <td className="num">{t.share !== null ? `${t.share}%` : '—'}</td>
        <td className="num">{fmtCurrency(t.rent.billed)}</td>
        <td className="num">{fmtCurrency(t.rent.collected)}</td>
        <td className={`num${t.owed > 0 ? ' owed' : ''}`}>
          {t.owed > 0 ? fmtCurrency(t.owed) : '—'}
          {t.lateFees > 0 && <em className="cell-note">incl. {fmtCurrency(t.lateFees)} fees</em>}
        </td>
        <td>
          {t.lastPaid
            ? <>{fmtDate(t.lastPaid.date)}<em className="cell-note">{fmtCurrency(t.lastPaid.amount)}</em></>
            : <span className="muted sm">never</span>}
        </td>
      </tr>

      {open && (
        <tr className="payer-detail">
          <td colSpan={7}>
            <div className="pd">
              <div className="pd-half">
                <div className="pd-hd">What {t.name.split(' ')[0]} pays each month</div>
                {t.lines.length === 0 ? (
                  <p className="muted sm">
                    No line items — their monthly total of {fmtCurrency(t.monthly)} is held as one
                    figure, so there is nothing to break down.
                  </p>
                ) : (
                  <>
                    {t.lines.map(l => (
                      <div key={l.id} className="sline">
                        <span className="sline-lbl">
                          {l.label}
                          {l.isUtility && (
                            <span className="pill plain" title="From a lease utility — edit the utility, not the line">
                              utility
                            </span>
                          )}
                          {l.notes && <span className="sline-note">{l.notes}</span>}
                        </span>
                        <span className="sline-amt num">{fmtCurrency(l.amount)}</span>
                      </div>
                    ))}
                    <div className="sline sub">
                      <span className="sline-lbl">Monthly total</span>
                      <span className="sline-amt num">{fmtCurrency(t.monthly)}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="pd-half">
                <div className="pd-hd">Their record on this lease</div>
                <div className="sline">
                  <span className="sline-lbl">Charges settled</span>
                  <span className="sline-amt num">
                    {t.rent.settledCount} of {t.rent.count}
                  </span>
                </div>
                {t.rent.collectedLateCount > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">
                      Paid late
                      <span className="sline-note">worst {t.rent.maxDaysLate} days past due</span>
                    </span>
                    <span className="sline-amt num">{t.rent.collectedLateCount} times</span>
                  </div>
                )}
                {t.depositsHeld > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">Deposit held</span>
                    <span className="sline-amt num">{fmtCurrency(t.depositsHeld)}</span>
                  </div>
                )}
                <div className="sline total">
                  <span className="sline-lbl">
                    {t.owed > 0 ? 'Owed right now' : 'Up to date'}
                    {t.lateFees > 0 && (
                      <span className="sline-note">
                        {fmtCurrency(t.shortfall)} of rent + {fmtCurrency(t.lateFees)} of late fees
                      </span>
                    )}
                  </span>
                  <span className={`sline-amt num${t.owed > 0 ? ' owed' : ' good'}`}>
                    {t.owed > 0 ? fmtCurrency(t.owed) : fmtCurrency(0)}
                  </span>
                </div>
                <div className="pd-acts">
                  <button className="btn-secondary sm" onClick={onSeeCharges}>
                    Their charges below
                  </button>
                  <Link className="btn-secondary sm" href={planHref(t.planId)}>
                    Edit in the ledger
                  </Link>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Fact({
  label, value, meta, tone,
}: { label: string; value: string; meta: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="lfact">
      <div className="lfact-label">{label}</div>
      <div className={`lfact-value${tone ? ' ' + tone : ''}`}>{value}</div>
      <div className="lfact-meta">{meta}</div>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .kpi-value small { font-size: 0.5em; font-weight: 500; color: var(--ink-3); margin-left: 2px; }
  .fin .kpi-value.sm { font-size: 23px; }
  .fin .sec-title.sm { font-size: 13px; }
  .fin .sec-hd.tight { margin: 20px 0 10px; }
  .fin .warn-ink { color: var(--fee); font-weight: 600; }

  .fin .lmeta {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    margin-top: 10px; font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em;
  }

  .fin .lvitals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; }
  .fin .lfact { padding: 0 14px; border-left: 1px solid var(--line-2); min-width: 0; }
  .fin .lfact:first-child { border-left: none; padding-left: 0; }
  .fin .lfact-label { font-size: 11px; color: var(--ink-3); }
  .fin .lfact-value {
    font-size: 19px; font-weight: 600; letter-spacing: -0.02em; margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .fin .lfact-value.good { color: var(--in); }
  .fin .lfact-value.bad  { color: var(--late); }
  .fin .lfact-meta { font-size: 11px; color: var(--ink-3); margin-top: 2px; line-height: 1.45; }
  .fin .lvitals-key { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11px; color: var(--ink-3); }

  .fin .panel-n {
    display: inline-block; margin-left: 8px; background: var(--line-2); color: var(--ink-2);
    font-size: 11.5px; font-weight: 600; border-radius: 980px; padding: 1px 8px; vertical-align: 2px;
  }

  .fin .pblock { border-top: 1px solid var(--line-2); }
  .fin .pblock:first-of-type { border-top: none; }
  .fin .pblock-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    flex-wrap: wrap; padding: 12px 22px; background: var(--surface-2);
  }
  .fin .pblock-name { font-size: 13.5px; font-weight: 600; letter-spacing: -0.014em; }
  .fin .pblock-sub { font-size: 11.5px; color: var(--ink-2); margin-top: 2px; }
  .fin .pblock-acts { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }

  .fin .tbl .twist { margin-right: 4px; }
  .fin .cell-note {
    font-style: normal; display: block; font-size: 10.5px; color: var(--ink-3); margin-top: 1px;
  }

  .fin .payer-detail td { padding: 0; background: var(--surface-2); }
  .fin .pd { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; padding: 16px 22px 18px; }
  .fin .pd-half { min-width: 0; }
  .fin .pd-hd {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-3);
    font-weight: 500; margin-bottom: 7px;
  }
  .fin .pd-acts { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 14px; }

  .fin .beh { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

  .fin .utils { display: flex; flex-direction: column; }
  .fin .util {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 2px; border-top: 1px solid var(--line-2);
  }
  .fin .util:first-child { border-top: none; }
  .fin .util-main b { font-size: 13.5px; font-weight: 500; display: block; }
  .fin .util-main em { font-style: normal; font-size: 11.5px; color: var(--ink-3); display: block; margin-top: 1px; }
  .fin .util-fig { text-align: right; flex-shrink: 0; }
  .fin .util-fig b { font-size: 13.5px; font-weight: 600; display: block; font-variant-numeric: tabular-nums; }
  .fin .util-fig em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  .fin .chg-filters {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 22px 14px;
  }

  @media (max-width: 860px) {
    .fin .lvitals { grid-template-columns: repeat(2, 1fr); gap: 16px 0; }
    .fin .lfact:nth-child(odd) { border-left: none; padding-left: 0; }
    .fin .pd, .fin .beh { grid-template-columns: 1fr; gap: 20px; }
  }
`
