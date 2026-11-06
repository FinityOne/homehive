'use client'

/**
 * One payment plan's rent ledger — where money is actually edited.
 *
 * ── Why this is a route and not a panel ────────────────────────────────────
 *
 * The ledger used to open *inside* the Financials page at `?plan=<id>`, which
 * had two costs. It made the overview responsible for two completely different
 * screens, and it meant the deepest, most operational surface in the product
 * had no address of its own — no breadcrumb that made sense, no way to link a
 * tenant's charges to a colleague, and a browser Back button that behaved
 * differently from everywhere else in the area.
 *
 * So it is a page. The hierarchy above it is real now — portfolio → property →
 * lease → *this* — and the crumb trail says so.
 *
 * ── The division of labour ─────────────────────────────────────────────────
 *
 * Everything above this reports; this writes. The lease page answers "how is
 * this tenancy doing" across every plan on it; this answers "change this
 * charge": record a payment, raise a one-off, set the schedule, declare a
 * utility, chase someone. That is `PlanWorkspace`, which already does all of
 * it — this page's own job is only to put it in the right place in the
 * hierarchy and name what the landlord is looking at.
 */

import { use, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { useMoney } from '@/lib/useMoney'
import { buildTree, leaseHref } from '@/lib/financialsTree'
import MoneyHub from '@/components/finance/MoneyHub'
import { ProgressBar, VIZ_CSS } from '@/components/finance/Charts'
import { dayOrdinal } from '@/components/finance/ChargeSheet'
import { FINANCE_THEME } from '@/lib/financeTheme'

const PlanWorkspace = dynamic(() => import('@/components/payments/PlanWorkspace'), { ssr: false })

export default function PlanLedgerPage({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const { planId } = use(params)
  const { plans, waivers, bounced, loading } = useMoney()

  const tree = useMemo(() => buildTree(plans, waivers), [plans, waivers])
  const plan = useMemo(() => tree.plans.find(p => p.planId === planId) ?? null, [tree, planId])
  const lease = useMemo(
    () => tree.leases.find(l => l.plans.some(p => p.planId === planId)) ?? null,
    [tree, planId],
  )

  useEffect(() => {
    document.title = plan
      ? `${plan.name} — Rent ledger | HomeHive`
      : 'Rent ledger | HomeHive'
  }, [plan])

  return (
    <>
      <style>{FINANCE_THEME}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap">
        <MoneyHub
          tab="portfolio"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Portfolio', href: '/landlord/financials/portfolio' },
            ...(lease
              ? [
                  { label: lease.propertyName, href: `/landlord/financials/portfolio#p-${lease.propertyId}` },
                  { label: lease.label, href: leaseHref(lease.key) },
                ]
              : []),
            { label: 'Rent ledger' },
          ]}
          title={lease ? lease.propertyName : (plan?.name ?? 'Rent ledger')}
          sub={plan
            ? `${plan.name}${
                lease?.termStart && lease?.termEnd
                  ? ` · ${fmtDate(lease.termStart)} – ${fmtDate(lease.termEnd)}`
                  : ''}`
            : loading ? 'Loading…' : 'This plan is not in your portfolio.'}
          // The ledger's own primary action is the tenancy behind the money:
          // every other action here belongs to a row, not to the page.
          action={lease?.leaseId
            ? { label: 'The tenancy', href: `/landlord/leases/${lease.leaseId}` }
            : undefined}
          secondary={lease ? { label: 'Lease money', href: leaseHref(lease.key) } : undefined}
          alarmCount={bounced}
          meta={plan
            ? (
              <div className="lmeta">
                <span>rent due on the {dayOrdinal(plan.dueDay)}</span>
                <span>{plan.activePayers} payer{plan.activePayers !== 1 ? 's' : ''}</span>
                <span>{fmtCurrency(plan.monthly)}/mo</span>
                {plan.owed > 0 && <span className="pill bad">{fmtCurrency(plan.owed)} overdue</span>}
                {lease?.splitBilling && (
                  <span className="pill info" title="This tenancy is billed through more than one plan">
                    one of {lease.plans.length} plans on this lease
                  </span>
                )}
              </div>
            )
            : undefined}
        />

        {/* The plan's own figures above its month-by-month work. Without them
            the ledger can only ever answer "what about this month". */}
        {plan && (
          <section className="card vit">
            <div className="lvitals">
              <Fact
                label="Contract value"
                value={fmtCurrency(plan.summary.contractValue)}
                meta="rent over the full term"
              />
              <Fact
                label="Collected"
                value={fmtCurrency(plan.summary.contractCollected)}
                meta={`${plan.summary.contractValue > 0
                  ? Math.round((plan.summary.contractCollected / plan.summary.contractValue) * 100)
                  : 0}% of the plan`}
                tone="good"
              />
              <Fact
                label="Still to collect"
                value={fmtCurrency(Math.max(0, plan.summary.contractValue - plan.summary.contractCollected))}
                meta={plan.nextDue
                  ? `next ${fmtCurrency(plan.nextDue.amount)} on ${fmtDate(plan.nextDue.date)}`
                  : 'nothing scheduled'}
              />
              <Fact
                label="Overdue"
                value={plan.owed > 0 ? fmtCurrency(plan.owed) : 'None'}
                meta={plan.lateFees > 0
                  ? `incl. ${fmtCurrency(plan.lateFees)} of late fees`
                  : 'nothing past due'}
                tone={plan.owed > 0 ? 'bad' : 'good'}
              />
              <Fact
                label="Deposits held"
                value={fmtCurrency(plan.depositsHeld)}
                meta={plan.depositsHeld > 0 ? 'returnable at move-out' : 'none on file'}
              />
            </div>
            <ProgressBar
              pct={plan.summary.contractValue > 0
                ? Math.round((plan.summary.contractCollected / plan.summary.contractValue) * 100)
                : 0}
              markAt={plan.summary.termProgress}
            />
          </section>
        )}

        {lease?.splitBilling && (
          <p className="led-note">
            This tenancy is billed through <strong>{lease.plans.length} payment plans</strong>.
            This ledger holds one of them — {fmtCurrency(plan?.monthly ?? 0)}/mo of the lease&rsquo;s{' '}
            {fmtCurrency(lease.monthly)}/mo.{' '}
            <Link href={leaseHref(lease.key)} className="lnk">
              See the whole lease
            </Link>{' '}
            to read them together.
          </p>
        )}

        {lease?.leaseId && !lease.splitBilling && (
          <p className="led-note">
            Rent, deposits and one-off charges live here. The{' '}
            <Link href={`/landlord/leases/${lease.leaseId}`} className="lnk">tenancy</Link> holds
            the people, the documents and the move-out.
          </p>
        )}

        <PlanWorkspace planId={planId} embedded />
      </div>
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

  .fin .lmeta {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    margin-top: 10px; font-size: 12.5px; color: var(--ink-2); letter-spacing: -0.01em;
  }
  .fin .card.vit { padding-bottom: 10px; }
  .fin .lvitals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; }
  .fin .lfact { padding: 0 14px; border-left: 1px solid var(--line-2); min-width: 0; }
  .fin .lfact:first-child { border-left: none; padding-left: 0; }
  .fin .lfact-label { font-size: 11px; color: var(--ink-3); }
  .fin .lfact-value {
    font-size: 18px; font-weight: 600; letter-spacing: -0.02em; margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .fin .lfact-value.good { color: var(--in); }
  .fin .lfact-value.bad  { color: var(--late); }
  .fin .lfact-meta { font-size: 11px; color: var(--ink-3); margin-top: 2px; line-height: 1.45; }
  .fin .led-note {
    font-size: 13px; color: var(--ink-2); line-height: 1.65; margin: 16px 0;
    letter-spacing: -0.01em; max-width: 86ch;
  }
  .fin .led-note strong { color: var(--ink); }

  @media (max-width: 860px) {
    .fin .lvitals { grid-template-columns: repeat(2, 1fr); gap: 16px 0; }
    .fin .lfact:nth-child(odd) { border-left: none; padding-left: 0; }
  }
`
