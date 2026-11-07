'use client'

/**
 * The traffic report.
 *
 * All of this used to sit in the middle of the overview, seven bands deep: the
 * pace card, the views chart, the search-to-signed funnel, the benchmarks, the
 * per-listing table and the browse clock. Each one earns its place — but none
 * of them is a glance, and together they were the reason the overview could
 * not be read without scrolling past the things that needed doing.
 *
 * It is the same component, on its own route, at full width, and it keeps the
 * scope it was opened with.
 */

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import DashStyles from '../styles'
import ScopePills, { useScope } from '../ScopePills'
import ListingPulse from '../ListingPulse'
import { usePortfolio } from '../overview'

function TrafficReport() {
  const { loading, properties } = usePortfolio()
  const scope = useScope(properties)

  useEffect(() => { document.title = 'Traffic report — Landlord | HomeHive' }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    )
  }

  const scoped = scope === 'all' ? null : properties.find(p => p.slug === scope) ?? null

  return (
    <>
      <DashStyles />
      <div className="db">
        <div className="db-hd">
          <div>
            <Link href="/landlord/dashboard" className="panel-link" style={{ fontSize: 12.5 }}>← Overview</Link>
            <div className="db-greeting" style={{ marginTop: 4 }}>Traffic report</div>
            <div className="db-sub">
              {scoped
                ? `Who is looking at ${scoped.name}, and what happens to them.`
                : 'Who is looking at your listings, where they came from, and where you lose them.'}
            </div>
          </div>
          <div className="db-hd-right">
            <ScopePills properties={properties} scope={scope} />
            <Link className="db-jump" href="/landlord/performance">Per-listing performance →</Link>
          </div>
        </div>

        {properties.length === 0 ? (
          <div className="panel">
            <div className="panel-body" style={{ fontSize: 13, color: '#94a3b8', padding: '28px 20px', textAlign: 'center' }}>
              Nothing to measure yet. <Link href="/landlord/listings/new" className="panel-link">Add a listing</Link> and
              this page fills in as students find it.
            </div>
          </div>
        ) : (
          <ListingPulse slug={scope === 'all' ? null : scope} />
        )}
      </div>
    </>
  )
}

export default function TrafficReportPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    }>
      <TrafficReport />
    </Suspense>
  )
}
