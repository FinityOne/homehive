'use client'

/**
 * Owner statement — one property, one month, built to leave the building.
 *
 * ── Why a page that is mostly for printing ─────────────────────────────────
 *
 * Everything else in the money area is for a landlord *working*. This is for
 * the several times a year they have to hand a month's figures to somebody
 * else: an accountant at tax time, a lender underwriting a refinance, a
 * co-owner asking where their share went, a lawyer who needs arrears
 * documented. None of those people want a dashboard, and screenshotting one is
 * what landlords were doing instead.
 *
 * So the layout is a document. One column, a stated production date, the
 * arithmetic shown in the order an accountant reads it, and a print stylesheet
 * that drops every control so what comes out of the printer is the statement
 * and nothing else.
 *
 * ── It has to balance ──────────────────────────────────────────────────────
 *
 *     opening arrears + billed − collected − recovered = closing arrears
 *
 * That identity is the entire value of the document: it is what makes it
 * checkable by someone who was not there. The model computes both sides, and
 * when they disagree this page says so in place of the total rather than
 * printing a number an accountant would trust. A statement that silently does
 * not add up is worse than no statement at all.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree } from '@/lib/financialsTree'
import { monthKeyOf, monthLabel, type MonthKey } from '@/lib/financialsMonth'
import { statement, statementCsv, statementMonths } from '@/lib/financialsStatement'
import MoneyHub from '@/components/finance/MoneyHub'
import Glyph, { GLYPH_CSS } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { Meter, VIZ_CSS } from '@/components/finance/Charts'
import { FINANCE_THEME } from '@/lib/financeTheme'

export default function StatementPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; month?: string }>
}) {
  const sp = use(searchParams)
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  usePaletteShortcut(useCallback(() => setFind(true), []))

  const tree = useMemo(() => buildTree(plans, waivers), [plans, waivers])

  /** Only what the landlord has explicitly chosen. The default below is
   *  derived rather than written into state: a state-setting effect would make
   *  the page render once empty and once correct, and on a one-property
   *  portfolio there is nothing to choose anyway. */
  const [chosen, setChosen] = useState(sp.property ?? '')
  const [month, setMonth] = useState<MonthKey>(
    /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as MonthKey) : monthKeyOf(new Date()),
  )

  // The chosen property if it is still in the portfolio, otherwise the one the
  // tree ranks first — which is whatever most needs looking at.
  const propertyId = useMemo(() => {
    if (chosen && tree.properties.some(p => p.propertyId === chosen)) return chosen
    return tree.properties[0]?.propertyId ?? ''
  }, [chosen, tree])
  const setPropertyId = setChosen

  const months = useMemo(
    () => (propertyId ? statementMonths(plans, propertyId) : []),
    [plans, propertyId],
  )

  const s = useMemo(
    () => (propertyId ? statement(plans, propertyId, month) : null),
    [plans, propertyId, month],
  )

  useEffect(() => {
    document.title = s
      ? `${s.propertyName} — ${s.monthLabel} statement | HomeHive`
      : 'Statement — Financials | HomeHive'
  }, [s])

  useEffect(() => {
    const q = new URLSearchParams()
    if (propertyId) q.set('property', propertyId)
    q.set('month', month)
    window.history.replaceState(null, '', `/landlord/financials/statement?${q.toString()}`)
  }, [propertyId, month])

  const download = () => {
    if (!s) return
    const blob = new Blob([statementCsv(s)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `statement-${s.propertyName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${s.month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap narrow">
        <MoneyHub
          tab="overview"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Statement' },
          ]}
          title="Owner statement"
          sub="One property, one month, with the arithmetic shown — built to be printed or sent on."
          action={s && !s.empty ? { label: 'Print', onClick: () => window.print() } : undefined}
          secondary={s && !s.empty ? { label: 'Export CSV', onClick: download } : undefined}
          onFind={() => setFind(true)}
          alarmCount={bounced}
          filters={
            <div className="filters">
              <select
                className="fsel"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                aria-label="Which property"
              >
                {tree.properties.map(p => (
                  <option key={p.propertyId} value={p.propertyId}>{p.propertyName}</option>
                ))}
              </select>
              <select
                className="fsel"
                value={month}
                onChange={e => setMonth(e.target.value as MonthKey)}
                aria-label="Which month"
              >
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
          }
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : tree.properties.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Nothing to report on yet</div>
            <p className="empty-sub">
              A statement is built from the charges on a payment plan. Create one and this page can
              produce a month-by-month statement for any property.
            </p>
            <Link href="/landlord/financials/new" className="btn-primary">Create a payment plan</Link>
          </div>
        ) : !s ? null : (
          <article className="stmt">
            {/* ── The document's own header. On paper this is all the reader
                   gets, so it has to carry the property, the period and the
                   date it was produced. ── */}
            <header className="stmt-hd">
              <div>
                <div className="stmt-kicker">Owner statement</div>
                <h2 className="stmt-prop">{s.propertyName}</h2>
                <div className="stmt-period">
                  {s.monthLabel} · {fmtDate(s.from)} to {fmtDate(s.to)}
                </div>
              </div>
              <div className="stmt-meta">
                <div>Produced {fmtDate(s.producedOn)}</div>
                <div>HomeHive</div>
              </div>
            </header>

            {s.empty ? (
              <p className="muted stmt-pad">
                Nothing was billed against {s.propertyName} in {s.monthLabel}, and nothing was owed
                coming into it. Pick another month above.
              </p>
            ) : (
              <>
                {/* ── The arithmetic, in reading order ── */}
                <section className="stmt-sec">
                  <h3 className="stmt-h">Rent and charges</h3>
                  <div className="stmt-rows">
                    <Row
                      label="Arrears brought forward"
                      hint="owed on this property before the month began"
                      value={s.openingArrears}
                    />
                    <Row
                      label="Billed in the month"
                      hint="rent, utilities and one-off charges that fell due"
                      value={s.billed}
                      sign="+"
                    />
                    <Row
                      label="Collected against the month"
                      hint="rent and charges received for charges due in this month"
                      value={s.collected}
                      sign="−"
                      tone="good"
                    />
                    <Row
                      label="Recovered from earlier months"
                      hint="arrears paid off during the month"
                      value={s.recovered}
                      sign="−"
                      tone="good"
                    />
                    <div className="stmt-row total">
                      <span className="stmt-lbl">
                        Arrears carried forward
                        <em>what is owed at the close of {s.monthLabel}</em>
                      </span>
                      <span className={`stmt-val${s.closingArrears > 0 ? ' owed' : ''}`}>
                        {s.balances
                          ? fmtCurrency(s.closingArrears)
                          : 'does not balance'}
                      </span>
                    </div>
                  </div>

                  {/* The one case where this page refuses to print a figure. */}
                  {!s.balances && (
                    <p className="stmt-warn">
                      <Glyph name="alert" size={15} />
                      <span>
                        <strong>This month does not tie.</strong> Opening arrears plus what was
                        billed, less what was collected, does not match the outstanding charges on
                        record — usually a charge voided or re-dated after money moved against it.
                        The closing figure is withheld rather than shown, because a statement that
                        does not add up will still be forwarded to someone who trusts it. The{' '}
                        <Link className="lnk" href="/landlord/financials/collections">collections</Link>{' '}
                        page shows the live arrears.
                      </span>
                    </p>
                  )}

                  {s.rate !== null && (
                    <div className="stmt-rate">
                      <div className="stmt-rate-top">
                        <span>Collection rate for the month</span>
                        <b>{s.rate}%</b>
                      </div>
                      <Meter pct={s.rate} />
                      <div className="muted sm">
                        {fmtCurrency(s.collected)} of {fmtCurrency(s.billed)} billed. Rent against
                        rent — late fees are not counted in this figure.
                      </div>
                    </div>
                  )}
                </section>

                {/* ── Deliberately outside the arithmetic above ── */}
                <section className="stmt-sec">
                  <h3 className="stmt-h">Held and assessed separately</h3>
                  <div className="stmt-rows">
                    <Row
                      label="Late fees assessed"
                      hint="what the rule produced on this month's charges"
                      value={s.feesAssessed}
                    />
                    <Row
                      label="Late fees received"
                      hint="fee money that genuinely changed hands"
                      value={s.feesCollected}
                      tone="good"
                    />
                    <Row
                      label="Deposits received in the month"
                      hint="not income — the tenant's money, held"
                      value={s.depositsReceived}
                    />
                    <Row
                      label="Deposits held in total"
                      hint="a liability, returnable at move-out"
                      value={s.depositsHeld}
                    />
                  </div>
                  <p className="stmt-note">
                    Late fees sit outside the rent arithmetic so the collection rate above stays
                    rent against rent. Deposits sit outside it because a deposit is not income —
                    it is somebody else&rsquo;s money you are holding, and counting it as rent
                    collected is the most common error in small-landlord bookkeeping.
                    Card and bank surcharges appear nowhere on this statement: the tenant pays
                    those to the processor, and they are never your money.
                  </p>
                </section>

                {/* ── Per tenant ── */}
                {s.payers.length > 0 && (
                  <section className="stmt-sec">
                    <h3 className="stmt-h">By tenant</h3>
                    <div className="tbl-scroll">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Tenant</th>
                            <th>Lease</th>
                            <th className="num">Brought forward</th>
                            <th className="num">Billed</th>
                            <th className="num">Collected</th>
                            <th className="num">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.payers.map(p => (
                            <tr key={`${p.name}-${p.leaseName}`}>
                              <td>{p.name}</td>
                              <td className="muted sm">{p.leaseName}</td>
                              <td className="num">{p.opening > 0 ? fmtCurrency(p.opening) : '—'}</td>
                              <td className="num">{fmtCurrency(p.billed)}</td>
                              <td className="num">{fmtCurrency(p.collected)}</td>
                              <td className={`num${p.outstanding > 0 ? ' owed' : ''}`}>
                                {p.outstanding > 0 ? fmtCurrency(p.outstanding) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <th colSpan={2}>Total</th>
                            <th className="num">{fmtCurrency(s.openingArrears)}</th>
                            <th className="num">{fmtCurrency(s.billed)}</th>
                            <th className="num">{fmtCurrency(s.collected)}</th>
                            <th className="num">
                              {fmtCurrency(s.payers.reduce((n, p) => n + p.outstanding, 0))}
                            </th>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                )}

                {/* ── Every line ── */}
                <section className="stmt-sec">
                  <h3 className="stmt-h">Every charge in the month</h3>
                  <div className="tbl-scroll">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Due</th>
                          <th>Charge</th>
                          <th>Tenant</th>
                          <th className="num">Billed</th>
                          <th className="num">Collected</th>
                          <th className="num">Outstanding</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.lines.map((l, i) => (
                          <tr key={i}>
                            <td>{fmtDate(l.date)}</td>
                            <td className="cell-main">
                              <b>{l.label}</b>
                              <em>
                                {l.kind === 'deposit' ? 'security deposit' : l.kind}
                                {l.daysLate !== null && l.daysLate > 0 && <> · paid {l.daysLate}d late</>}
                              </em>
                            </td>
                            <td>{l.who ?? <span className="muted sm">the lease</span>}</td>
                            <td className="num">{fmtCurrency(l.billed)}</td>
                            <td className="num">{l.collected > 0 ? fmtCurrency(l.collected) : '—'}</td>
                            <td className={`num${l.outstanding > 0 ? ' owed' : ''}`}>
                              {l.outstanding > 0 ? fmtCurrency(l.outstanding) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <footer className="stmt-ft">
                  <p>
                    Produced by HomeHive on {fmtDate(s.producedOn)} from the charges recorded
                    against {s.propertyName}. Figures reflect the state of the ledger at that
                    moment; later payments, voids or waivers will change them.
                  </p>
                </footer>
              </>
            )}
          </article>
        )}
      </div>

      <CommandPalette tree={tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

/** One line of the statement's arithmetic. */
function Row({
  label, hint, value, sign, tone,
}: {
  label: string
  hint: string
  value: number
  sign?: '+' | '−'
  tone?: 'good'
}) {
  return (
    <div className="stmt-row">
      <span className="stmt-lbl">
        {label}
        <em>{hint}</em>
      </span>
      <span className={`stmt-val${tone === 'good' && value > 0 ? ' good' : ''}`}>
        {sign && value > 0 && <span className="stmt-sign">{sign}</span>}
        {fmtCurrency(value)}
      </span>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .stmt {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 34px 38px 28px;
  }
  .fin .stmt-pad { padding: 10px 0 20px; }
  .fin .stmt-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
    flex-wrap: wrap; padding-bottom: 22px; border-bottom: 2px solid var(--ink);
  }
  .fin .stmt-kicker {
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--ink-3);
  }
  .fin .stmt-prop { font-size: 24px; font-weight: 600; letter-spacing: -0.024em; margin-top: 6px; }
  .fin .stmt-period { font-size: 13.5px; color: var(--ink-2); margin-top: 4px; }
  .fin .stmt-meta {
    text-align: right; font-size: 11.5px; color: var(--ink-3); line-height: 1.7; flex-shrink: 0;
  }

  .fin .stmt-sec { padding: 24px 0; border-bottom: 1px solid var(--line-2); }
  .fin .stmt-sec:last-of-type { border-bottom: none; }
  .fin .stmt-h {
    font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--ink-3); margin-bottom: 14px;
  }

  .fin .stmt-rows { display: flex; flex-direction: column; }
  .fin .stmt-row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 20px;
    padding: 9px 0; border-bottom: 1px solid var(--line-2);
  }
  .fin .stmt-row:last-child { border-bottom: none; }
  .fin .stmt-row.total {
    border-top: 2px solid var(--ink); border-bottom: none; margin-top: 6px; padding-top: 13px;
  }
  .fin .stmt-lbl { font-size: 14px; letter-spacing: -0.01em; min-width: 0; }
  .fin .stmt-lbl em {
    font-style: normal; display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 2px;
  }
  .fin .stmt-row.total .stmt-lbl { font-size: 15px; font-weight: 600; }
  .fin .stmt-val {
    font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0;
  }
  .fin .stmt-row.total .stmt-val { font-size: 19px; font-weight: 600; }
  .fin .stmt-val.good { color: var(--in); }
  .fin .stmt-val.owed { color: var(--late); }
  .fin .stmt-sign { color: var(--ink-3); margin-right: 3px; }

  .fin .stmt-warn {
    display: flex; align-items: flex-start; gap: 11px; margin-top: 16px;
    background: var(--late-bg); border: 1px solid var(--late-line); border-radius: 12px;
    padding: 13px 15px; font-size: 12.5px; color: #8c2f26; line-height: 1.6;
  }
  .fin .stmt-warn strong { color: #7a2820; }

  .fin .stmt-rate {
    margin-top: 20px; padding: 14px 16px; background: var(--surface-2);
    border: 1px solid var(--line-2); border-radius: 12px;
  }
  .fin .stmt-rate-top {
    display: flex; align-items: baseline; justify-content: space-between;
    font-size: 13px; color: var(--ink-2);
  }
  .fin .stmt-rate-top b { font-size: 17px; font-weight: 600; color: var(--ink); }
  .fin .stmt-rate .muted { margin-top: 8px; }

  .fin .stmt-note {
    font-size: 11.5px; color: var(--ink-3); line-height: 1.7; margin-top: 16px; max-width: 80ch;
  }
  .fin .stmt .tbl tfoot th {
    border-top: 2px solid var(--ink); font-size: 12.5px; font-weight: 600;
    text-transform: none; letter-spacing: -0.01em; color: var(--ink); padding-top: 11px;
  }
  .fin .stmt .tbl td.owed, .fin .stmt .tbl th.owed { color: var(--late); font-weight: 600; }
  .fin .stmt-ft {
    padding-top: 20px; border-top: 1px solid var(--line-2); margin-top: 8px;
    font-size: 11px; color: var(--ink-3); line-height: 1.65;
  }

  /* On paper: no card, no rounding, nothing but the document. */
  @media print {
    .fin .hub { margin-bottom: 0; }
    .fin .hub-crumbs, .fin .hub .title, .fin .hub .sub { display: none !important; }
    .fin .stmt {
      border: none !important; border-radius: 0; padding: 0; break-inside: auto;
    }
    .fin .stmt-sec { break-inside: avoid; padding: 16pt 0; }
    .fin .stmt-prop { font-size: 18pt; }
    .fin .stmt-row.total .stmt-val { font-size: 14pt; }
    .fin .stmt-rate { background: #fff !important; }
    .fin .tbl-scroll { overflow: visible; }
  }

  @media (max-width: 700px) {
    .fin .stmt { padding: 20px 17px; }
    .fin .stmt-meta { text-align: left; }
  }
`
