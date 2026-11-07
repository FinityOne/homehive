'use client'

/**
 * Portfolio analytics.
 *
 * Four charts that were the fourth, fifth, sixth and seventh band of the
 * overview: where leads come from over time, what stage they are stuck in, how
 * full each property is, and whether rent arrives in the month it is due.
 *
 * None of them is urgent, and that is exactly why they moved. A trend is a
 * thing you go and read; a landlord opening the portal on a Tuesday morning
 * needs the overdue figure first.
 */

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import DashStyles from '../styles'
import ScopePills, { useScope } from '../ScopePills'
import { LeadsTrendPanel, LeadStatusDonut, OccupancyByProperty, CollectionsBars } from '../charts'
import { usePortfolio, derive, fmtFull } from '../overview'

function Analytics() {
  const { loading, properties, leads, leases, plans } = usePortfolio()
  const scope = useScope(properties)

  useEffect(() => { document.title = 'Analytics — Landlord | HomeHive' }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    )
  }

  const scopedProperties = scope === 'all' ? properties : properties.filter(p => p.slug === scope)
  const scopedLeads      = scope === 'all' ? leads      : leads.filter(l => l.property === scope)
  const scopedLeases     = scope === 'all' ? leases     : leases.filter(l => l.property?.slug === scope)
  const scopedPlans      = scope === 'all' ? plans      : plans.filter(p => p.property?.slug === scope)
  const scopedSPs        = scopedPlans.flatMap(p => p.scheduled_payments || [])

  const m = derive({ properties: scopedProperties, leads: scopedLeads, leases: scopedLeases, plans: scopedPlans })
  const scopedName = scope === 'all' ? null : (properties.find(p => p.slug === scope)?.name ?? null)

  return (
    <>
      <DashStyles />
      <style>{`
        .an-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        @media (max-width: 1100px) { .an-row3 { grid-template-columns: 1fr; } }
      `}</style>
      <div className="db">
        <div className="db-hd">
          <div>
            <Link href="/landlord/dashboard" className="panel-link" style={{ fontSize: 12.5 }}>← Overview</Link>
            <div className="db-greeting" style={{ marginTop: 4 }}>
              {scopedName ? `Analytics · ${scopedName}` : 'Portfolio analytics'}
            </div>
            <div className="db-sub">
              {m.currentLeases.length} active lease{m.currentLeases.length !== 1 ? 's' : ''} ·
              {' '}{fmtFull(m.monthlyRevenue)}/mo contracted · {m.occupancyPct}% of {m.totalRooms} rooms filled
            </div>
          </div>
          <div className="db-hd-right">
            <ScopePills properties={properties} scope={scope} />
            <Link className="db-jump" href="/landlord/financials">Financials →</Link>
          </div>
        </div>

        <div className="db-row-full">
          <LeadsTrendPanel dates={scopedLeads.map(l => l.created_at)} />
        </div>

        <div className="an-row3">
          <LeadStatusDonut leads={scopedLeads} />
          <OccupancyByProperty properties={scopedProperties} />
          <div className="panel">
            <div className="panel-hd">
              <span className="panel-title">Arrears right now</span>
              <Link href="/landlord/financials" className="panel-link">Chase →</Link>
            </div>
            <div className="panel-body">
              {m.overdueList.length === 0 ? (
                <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>✓</span> Nothing past due
                </div>
              ) : (
                <>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 300, color: '#dc2626', letterSpacing: -1, lineHeight: 1 }}>
                    {fmtFull(m.overdueTotal)}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8', margin: '5px 0 10px' }}>
                    {m.overdueSPs.length} payment{m.overdueSPs.length !== 1 ? 's' : ''} across {m.overdueList.length} lease{m.overdueList.length !== 1 ? 's' : ''}
                  </div>
                  {m.overdueList.map(item => (
                    <div key={item.planId} className="row-item">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.propertyName}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.count} payment{item.count !== 1 ? 's' : ''} past due</div>
                      </div>
                      <Link href={`/landlord/financials?plan=${item.planId}`} style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textDecoration: 'none', flexShrink: 0 }}>
                        {fmtFull(item.owed)}
                      </Link>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="db-row-full">
          <CollectionsBars payments={scopedSPs} />
        </div>
      </div>
    </>
  )
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    }>
      <Analytics />
    </Suspense>
  )
}
