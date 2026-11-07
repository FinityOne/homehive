'use client'

/**
 * The landlord overview.
 *
 * It used to be a 960px column holding every chart the portal owns, stacked:
 * six stat cards, the whole traffic pulse (seven bands of it), four portfolio
 * charts, then payments, leases, leads and properties. On a laptop that was
 * about six screens of scrolling, two thirds of the display spent on margin,
 * and the thing a landlord actually came for — *what needs me today* — was
 * somewhere in the middle of it.
 *
 * So it is now one screen, full width, and the depth moved out to pages you
 * choose to open:
 *
 *   • `/landlord/dashboard/pulse`     — the traffic report (chart, funnel,
 *     benchmarks, per-listing, browse clock).
 *   • `/landlord/dashboard/analytics` — the portfolio charts.
 *   • `/landlord/dashboard/portfolio` — every property, with its own figures.
 *
 * Three rules hold this shape together:
 *
 *   1. Nothing on this page is a chart you have to study. Every panel is a
 *      count, a bar or a short list, and every panel has a door.
 *   2. Lists never grow the page. A panel in a band scrolls inside itself, so
 *      a landlord with forty leases sees the same layout as one with two.
 *   3. The first band is ordered by what it costs to ignore: what needs doing,
 *      then whether anyone is looking, then whether the money arrived.
 */

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import DashStyles from './styles'
import ScopePills, { useScope, withScope } from './ScopePills'
import PulseSummary from './PulseSummary'
import {
  usePortfolio, derive, overdueForProperty,
  fmtCurrency, fmtFull, daysUntil, getGreeting,
  STAGE_COLOR, STAGE_LABEL,
} from './overview'
import { formatLeaseDate } from '@/lib/leases'

// ── Small pieces ─────────────────────────────────────────────────────────────

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-num" style={color ? { color } : undefined}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}

/** One line of the attention list: a dot, what it is, what it is worth, a door. */
function Todo({ tone, title, detail, href, value }: {
  tone: 'bad' | 'warn' | 'info' | 'good'
  title: string
  detail: string
  href: string
  value?: string
}) {
  const fg = { bad: '#b91c1c', warn: '#b45309', info: '#1d4ed8', good: '#15803d' }[tone]
  return (
    <Link href={href} className="row-item" style={{ textDecoration: 'none', alignItems: 'flex-start' }}>
      <span className="badge-dot" style={{ background: fg, marginTop: 6 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.45 }}>{detail}</div>
      </div>
      {value && (
        <span style={{ fontSize: 13, fontWeight: 700, color: fg, flexShrink: 0, whiteSpace: 'nowrap' }}>{value}</span>
      )}
    </Link>
  )
}

// ── The page ─────────────────────────────────────────────────────────────────

function Overview() {
  const { loading, userName, properties, leads, leases, plans } = usePortfolio()
  const scope = useScope(properties)

  useEffect(() => { document.title = 'Overview — Landlord | HomeHive' }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    )
  }

  const scoped = scope === 'all' ? properties : properties.filter(p => p.slug === scope)
  const scopedLeads  = scope === 'all' ? leads  : leads.filter(l => l.property === scope)
  const scopedLeases = scope === 'all' ? leases : leases.filter(l => l.property?.slug === scope)
  const scopedPlans  = scope === 'all' ? plans  : plans.filter(p => p.property?.slug === scope)

  // Two derivations, and the split is the point: the six figures at the top
  // are portfolio-wide ("am I owed money" is never a per-property question
  // when the answer is yes somewhere else), and everything below them answers
  // to the scope pills.
  const all = derive({ properties, leads, leases, plans })
  const {
    currentLeases, upcomingLeases, expiringSoon, vacantRooms,
    monthDue, monthPaid, monthPending, overdueSPs, overdueTotal, overdueList,
    stageCounts, newLeads, propNameBySlug, today,
  } = derive({ properties: scoped, leads: scopedLeads, leases: scopedLeases, plans: scopedPlans })

  // ── What needs doing, ordered by what it costs to ignore ──
  const todos: React.ReactNode[] = []
  if (overdueTotal > 0) todos.push(
    <Todo key="overdue" tone="bad" href="/landlord/financials/collections"
      title={`${overdueSPs.length} payment${overdueSPs.length !== 1 ? 's' : ''} past due`}
      detail={`Across ${overdueList.length} lease${overdueList.length !== 1 ? 's' : ''} — chase or record a payment`}
      value={fmtFull(overdueTotal)} />
  )
  // Unpublished listings are deliberately absent: the banner above the figures
  // already says it, louder, and the same sentence twice on one screen reads
  // as two problems.
  if (expiringSoon.length > 0) todos.push(
    <Todo key="expiring" tone="warn" href="/landlord/renewals"
      title={`${expiringSoon.length} lease${expiringSoon.length !== 1 ? 's' : ''} ending within 60 days`}
      detail={`Soonest in ${expiringSoon[0].days} day${expiringSoon[0].days !== 1 ? 's' : ''} — send a renewal before you have to re-let`}
      value="Renew" />
  )
  if (newLeads.length > 0) todos.push(
    <Todo key="newleads" tone="info" href="/landlord/leads"
      title={`${newLeads.length} new lead${newLeads.length !== 1 ? 's' : ''} waiting`}
      detail="Students who wrote to you and have not been answered"
      value="Reply" />
  )
  if (vacantRooms > 0) todos.push(
    <Todo key="vacant" tone="info" href={withScope('/landlord/dashboard/pulse', scope)}
      title={`${vacantRooms} room${vacantRooms !== 1 ? 's' : ''} still open`}
      detail="See whether the traffic you have can fill them in time"
      value="Check pace" />
  )
  if (upcomingLeases.length > 0) todos.push(
    <Todo key="movein" tone="good" href="/landlord/leases"
      title={`${upcomingLeases.length} move-in${upcomingLeases.length !== 1 ? 's' : ''} coming up`}
      detail={`Next on ${formatLeaseDate(upcomingLeases[0].start_date)}`}
      value="Prepare" />
  )
  if (properties.length === 0) todos.push(
    <Todo key="first" tone="info" href="/landlord/listings/new"
      title="Add your first property"
      detail="It takes about five minutes to go live"
      value="Start" />
  )

  return (
    <>
      <DashStyles />
      <style>{`
        /* The stat strip: one row on a laptop, because six figures are a
           glance, and two rows of three is two glances. */
        .ov-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 14px; }
        /* Band one: today's work, the traffic, the money. */
        .ov-band1 { display: grid; grid-template-columns: 1.05fr 1.25fr 1fr; gap: 14px; margin-bottom: 14px; align-items: stretch; }
        /* Band two: the portfolio itself, then tenancy and demand beside it. */
        .ov-band2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; align-items: stretch; }
        .ov-stack { display: grid; grid-template-rows: 1fr 1fr; gap: 14px; min-height: 0; }
        /* Fixed bands are what make the page one screen: a long list scrolls
           inside its own panel instead of pushing everything below the fold. */
        .ov-band1 > * { height: 268px; }
        .ov-band2, .ov-band2 > * { height: 310px; }

        @media (max-width: 1400px) { .ov-stats { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 1180px) {
          .ov-band1 { grid-template-columns: 1fr 1fr; }
          .ov-band1 > :first-child { grid-column: 1 / -1; }
        }
        @media (max-width: 980px) {
          .ov-band1, .ov-band2 { grid-template-columns: 1fr; }
          .ov-band1 > :first-child { grid-column: auto; }
          .ov-band1 > *, .ov-band2, .ov-band2 > * { height: auto; max-height: 420px; }
          .ov-stack { grid-template-rows: auto auto; height: auto; }
        }
        @media (max-width: 620px) { .ov-stats { grid-template-columns: repeat(2, 1fr); } }
      `}</style>

      <div className="db">

        {/* ── Header: who you are, how it is going, and where to go deeper ── */}
        <div className="db-hd">
          <div>
            <div className="db-greeting">{getGreeting(userName)}.</div>
            <div className="db-sub">
              {properties.length === 0
                ? 'Get started by listing your first property'
                : `${all.liveProps} live propert${all.liveProps !== 1 ? 'ies' : 'y'} · ${all.occupancyPct}% occupied · ${fmtFull(all.monthlyRevenue)}/mo revenue`}
            </div>
          </div>
          <div className="db-hd-right">
            <ScopePills properties={properties} scope={scope} />
            <Link className="db-jump" href={withScope('/landlord/dashboard/pulse', scope)}>👀 Traffic report</Link>
            <Link className="db-jump" href={withScope('/landlord/dashboard/analytics', scope)}>📊 Analytics</Link>
          </div>
        </div>

        {/* Nothing waits on a human any more — payment is the only gate left.
            A landlord with finished, invisible listings needs to be told that
            in the first thing they see, not left to wonder why it went quiet. */}
        {all.unpaidProps.length > 0 && (
          <div className="pending-banner">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>
                {all.unpaidProps.length === 1
                  ? 'Your listing is ready — add a plan to publish it'
                  : `${all.unpaidProps.length} listings are ready — add a plan to publish them`}
              </div>
              <div style={{ fontSize: 12.5, color: '#78350f', lineHeight: 1.5 }}>
                Students only see a listing while your plan is active. There is no review
                queue — {all.unpaidProps.length === 1 ? 'it goes' : 'they go'} live the moment you subscribe.
              </div>
            </div>
            <Link href="/landlord/subscribe" style={{ flexShrink: 0, background: '#92400e', color: '#fff', borderRadius: 8, padding: '8px 15px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              Publish {all.unpaidProps.length === 1 ? 'my listing' : 'my listings'} →
            </Link>
          </div>
        )}

        {/* ── THE SIX FIGURES ── */}
        <div className="ov-stats">
          <Stat
            label="Monthly Revenue"
            value={all.monthlyRevenue > 0 ? fmtCurrency(all.monthlyRevenue) : '—'}
            color={all.monthlyRevenue > 0 ? undefined : '#94a3b8'}
            sub={all.annualRevenue > 0
              ? `${fmtCurrency(all.annualRevenue)}/yr from ${all.currentLeases.length} lease${all.currentLeases.length !== 1 ? 's' : ''}`
              : 'no active leases'}
          />
          <Stat
            label="Occupancy"
            value={all.totalRooms > 0 ? `${all.occupancyPct}%` : '—'}
            color={all.occupancyPct >= 80 ? '#16a34a' : all.occupancyPct >= 50 ? '#d97706' : '#dc2626'}
            sub={`${all.occupiedRooms} of ${all.totalRooms} rooms filled · ${all.vacantRooms} vacant`}
          />
          <Stat
            label="Collected — This Month"
            value={all.monthDue > 0 ? fmtCurrency(all.monthPaid) : '—'}
            color={all.overdueTotal > 0 ? '#dc2626' : undefined}
            sub={all.monthDue > 0
              ? all.collectionRate === 100
                ? `100% collected · ${fmtFull(all.monthDue)} due`
                : `${all.collectionRate ?? 0}% of ${fmtFull(all.monthDue)} · ${fmtFull(all.monthPending)} pending`
              : 'no payments this month'}
          />
          <Stat
            label="Overdue Balance"
            value={all.overdueTotal > 0 ? fmtCurrency(all.overdueTotal) : '$0'}
            color={all.overdueTotal > 0 ? '#dc2626' : '#94a3b8'}
            sub={all.overdueTotal > 0 ? `${all.overdueSPs.length} payment${all.overdueSPs.length !== 1 ? 's' : ''} past due` : 'all payments current'}
          />
          <Stat
            label="Active Leases"
            value={String(all.currentLeases.length)}
            sub={all.upcomingLeases.length > 0
              ? `${all.upcomingLeases.length} upcoming · ${all.expiringSoon.length > 0 ? `${all.expiringSoon.length} ending soon` : 'none ending'}`
              : all.expiringSoon.length > 0
                ? `${all.expiringSoon.length} ending within 60 days`
                : `${leases.length} total leases on file`}
          />
          <Stat
            label="Lead Pipeline"
            value={String(all.activeLeads.length)}
            color={all.activeLeads.length > 0 ? undefined : '#94a3b8'}
            sub={all.qualifiedCount > 0
              ? `${all.qualifiedCount} qualified · ${all.newLeads.length} new`
              : all.newLeads.length > 0
                ? `${all.newLeads.length} new, awaiting pre-screen`
                : `${leads.length} total leads`}
          />
        </div>

        {/* ── BAND 1: today's work · traffic · money ── */}
        <div className="ov-band1">

          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Needs you today</span>
              {todos.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#8C1D40' }}>{todos.length}</span>
              )}
            </div>
            <div className="panel-scroll">
              <div className="panel-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
                {todos.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, padding: '14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>✓</span> Nothing needs you — rent is current and every lease is in hand.
                  </div>
                ) : todos}
              </div>
            </div>
          </div>

          <PulseSummary slug={scope === 'all' ? null : scope} href={withScope('/landlord/dashboard/pulse', scope)} />

          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Rent this month</span>
              <Link href="/landlord/financials/collections" className="panel-link">Collections →</Link>
            </div>
            <div className="panel-scroll">
              <div className="panel-body">
                {plans.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>
                    No payment plans yet. <Link href="/landlord/financials" className="panel-link">Set one up</Link> to collect rent online.
                  </div>
                ) : (
                  <>
                    {monthDue > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                          <span style={{ color: '#64748b', fontWeight: 600 }}>Collected</span>
                          <span style={{ color: monthPending > 0 ? '#d97706' : '#16a34a', fontWeight: 700 }}>
                            {fmtFull(monthPaid)} / {fmtFull(monthDue)}
                          </span>
                        </div>
                        <div className="prog-bar">
                          <div className="prog-fill" style={{
                            width: `${Math.min(100, Math.round((monthPaid / monthDue) * 100))}%`,
                            background: monthPending > 0 ? '#f59e0b' : '#10b981',
                          }} />
                        </div>
                        {monthPending > 0 && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{fmtFull(monthPending)} still pending</div>
                        )}
                      </div>
                    )}

                    {overdueList.length > 0 ? (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                          Overdue
                        </div>
                        {overdueList.map(item => (
                          <div key={item.planId} className="row-item">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.propertyName}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.count} payment{item.count !== 1 ? 's' : ''} past due</div>
                            </div>
                            <Link href={`/landlord/financials?plan=${item.planId}`} style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textDecoration: 'none', flexShrink: 0 }}>
                              {fmtFull(item.owed)}
                            </Link>
                          </div>
                        ))}
                      </>
                    ) : monthDue > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
                        <span style={{ fontSize: 16 }}>✓</span> All payments current
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: '#94a3b8' }}>No payments due this month</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── BAND 2: the portfolio, with tenancy and demand beside it ── */}
        <div className="ov-band2">

          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">
                {scope === 'all' ? 'Your properties' : 'This property'}
                {scoped.length > 1 ? ` · ${scoped.length}` : ''}
              </span>
              <Link href={withScope('/landlord/dashboard/portfolio', scope)} className="panel-link">Full breakdown →</Link>
            </div>
            {scoped.length === 0 ? (
              <div className="panel-body" style={{ textAlign: 'center', padding: '28px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 5 }}>No listings yet</div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 14 }}>It takes about 5 minutes to go live.</div>
                <Link href="/landlord/listings/new" style={{ background: '#0f172a', color: '#34d399', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  Create your first listing →
                </Link>
              </div>
            ) : (
              <div className="panel-scroll">
                {scoped.map((p, i) => {
                  const propLeads   = leads.filter(l => l.property === p.slug)
                  const propCurrent = currentLeases.filter(l => l.property?.slug === p.slug)
                  const propOverdue = overdueForProperty(plans, p.slug, today)
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < scoped.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      {p.images?.[0]
                        ? <img src={p.images[0]} alt={p.name} style={{ width: 46, height: 38, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 46, height: 38, borderRadius: 7, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>🏠</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                          {p.admin_status === 'active'   && p.owner_plan_active !== false && <span className="pill" style={{ color: '#065f46', background: '#d1fae5', borderColor: '#a7f3d0' }}>Live</span>}
                          {p.owner_plan_active === false && <span className="pill" style={{ color: '#92400e', background: '#fef3c7', borderColor: '#fde68a' }}>Not published</span>}
                          {p.admin_status === 'inactive' && <span className="pill" style={{ color: '#6b7280', background: '#f9fafb', borderColor: '#e5e7eb' }}>Inactive</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#94a3b8', flexWrap: 'wrap' }}>
                          <span>${p.price?.toLocaleString()}/mo</span>
                          <span>{p.available} of {p.total_rooms} vacant</span>
                          {propCurrent.length > 0 && <span style={{ color: '#16a34a' }}>{propCurrent.length} lease{propCurrent.length !== 1 ? 's' : ''}</span>}
                          {propLeads.length > 0 && <span>{propLeads.length} lead{propLeads.length !== 1 ? 's' : ''}</span>}
                          {propOverdue > 0 && <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠ {fmtFull(propOverdue)} overdue</span>}
                        </div>
                      </div>
                      <Link href={`/landlord/listings/${p.slug}`} style={{ fontSize: 12, fontWeight: 500, color: '#8C1D40', textDecoration: 'none', flexShrink: 0 }}>Manage →</Link>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="ov-stack">

            {/* Tenancy: who is in, who is leaving, who is arriving. */}
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Leases</span>
                <Link href="/landlord/leases" className="panel-link">All leases →</Link>
              </div>
              <div className="panel-scroll">
                <div className="panel-body" style={{ paddingTop: 8 }}>
                  {currentLeases.length === 0 && upcomingLeases.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>No active leases yet.</div>
                  ) : (
                    <>
                      {expiringSoon.length > 0 && (
                        <Link href="/landlord/renewals" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: '#fef3cd', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 11px', marginBottom: 10, fontSize: 12, color: '#92400e', fontWeight: 500, textDecoration: 'none' }}>
                          <span>⚠ {expiringSoon.length} ending within 60 days</span>
                          <span style={{ fontWeight: 700 }}>Send renewals →</span>
                        </Link>
                      )}
                      {[...expiringSoon.map(x => x.lease), ...currentLeases.filter(l => daysUntil(l.end_date) > 60)].map(lease => {
                        const days = daysUntil(lease.end_date)
                        const tenantNames = lease.tenants.map(t => t.name).filter(Boolean).join(', ') || 'No tenant'
                        return (
                          <div key={lease.id} className="row-item">
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tenantNames}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{lease.property?.name} · ends {formatLeaseDate(lease.end_date)}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              {days <= 60
                                ? <span className="pill" style={{ color: '#c2410c', background: '#fff7ed', borderColor: '#fed7aa' }}>{days}d left</span>
                                : <span style={{ fontSize: 11, color: '#94a3b8' }}>{days}d left</span>}
                              {lease.rent_amount ? (
                                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#10b981', marginTop: 2 }}>{fmtCurrency(lease.rent_amount)}/mo</div>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                      {upcomingLeases.map(lease => (
                        <div key={lease.id} className="row-item">
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {lease.tenants.map(t => t.name).filter(Boolean).join(', ') || 'No tenant'}
                            </div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{lease.property?.name}</div>
                          </div>
                          <span className="pill" style={{ color: '#1d4ed8', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                            starts in {daysUntil(lease.start_date)}d
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Demand: the funnel as five numbers, and who arrived last. */}
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Lead pipeline</span>
                <Link href="/landlord/leads" className="panel-link">Full pipeline →</Link>
              </div>
              <div className="panel-scroll">
                <div className="panel-body" style={{ paddingTop: 10 }}>
                  {leads.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>
                      No leads yet — they appear here the moment a student writes about one of your listings.
                    </div>
                  ) : (
                    <>
                      <div className="funnel" style={{ marginBottom: 10 }}>
                        {stageCounts.map(({ stage, count }) => (
                          <div key={stage} className="funnel-seg">
                            <div className="funnel-n" style={{ color: count > 0 ? '#0f172a' : '#cbd5e1' }}>{count}</div>
                            <div className="funnel-lbl">{STAGE_LABEL[stage]}</div>
                          </div>
                        ))}
                      </div>
                      {leads.slice(0, 4).map(lead => {
                        const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email
                        const cfg = STAGE_COLOR[lead.status] || STAGE_COLOR.closed
                        return (
                          <Link key={lead.id} href={`/landlord/leads/${lead.id}`} className="row-item" style={{ textDecoration: 'none' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                {lead.property ? (propNameBySlug[lead.property] || lead.property) : 'No property'}
                              </div>
                            </div>
                            <span className="pill" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border, flexShrink: 0 }}>
                              {STAGE_LABEL[lead.status] || lead.status}
                            </span>
                          </Link>
                        )
                      })}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scope narrows the two bands above; the figures do not, so say so
            once rather than leaving a landlord to wonder which is which. */}
        {scope !== 'all' && (
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 12 }}>
            Scoped to one property · the six figures at the top cover your whole portfolio.
          </div>
        )}
      </div>
    </>
  )
}

export default function LandlordDashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    }>
      <Overview />
    </Suspense>
  )
}
