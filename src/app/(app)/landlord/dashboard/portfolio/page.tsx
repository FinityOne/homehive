'use client'

/**
 * Every property, with its own figures.
 *
 * The overview's properties panel is a list of names: status, rent, vacancy
 * and the one red number. That is the right amount for a glance, and far too
 * little to act on — so this is the same portfolio as cards, each carrying the
 * rooms, the leases in it, the leads asking about it, what it is owed and the
 * doors into its own pages.
 *
 * It reuses the overview's derivation, scoped to one property at a time, so a
 * figure here can never disagree with the figure that sent the landlord
 * looking for it.
 */

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import DashStyles from '../styles'
import ScopePills, { useScope } from '../ScopePills'
import {
  usePortfolio, derive, overdueForProperty,
  fmtFull, fmtCurrency, daysUntil,
} from '../overview'
import { formatLeaseDate } from '@/lib/leases'

function PortfolioBreakdown() {
  const { loading, properties, leads, leases, plans } = usePortfolio()
  const scope = useScope(properties)

  useEffect(() => { document.title = 'Portfolio — Landlord | HomeHive' }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    )
  }

  const all = derive({ properties, leads, leases, plans })
  const shown = scope === 'all' ? properties : properties.filter(p => p.slug === scope)

  return (
    <>
      <DashStyles />
      <style>{`
        .pf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; }
        .pf-figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
        .pf-fig-n { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 300; color: #0f172a; line-height: 1; }
        .pf-fig-l { font-size: 9.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin-top: 4px; }
        @media (max-width: 520px) { .pf-grid { grid-template-columns: 1fr; } }
      `}</style>

      <div className="db">
        <div className="db-hd">
          <div>
            <Link href="/landlord/dashboard" className="panel-link" style={{ fontSize: 12.5 }}>← Overview</Link>
            <div className="db-greeting" style={{ marginTop: 4 }}>Portfolio</div>
            <div className="db-sub">
              {properties.length} propert{properties.length !== 1 ? 'ies' : 'y'} · {all.liveProps} live ·
              {' '}{all.occupiedRooms} of {all.totalRooms} rooms filled · {fmtFull(all.monthlyRevenue)}/mo contracted
            </div>
          </div>
          <div className="db-hd-right">
            <ScopePills properties={properties} scope={scope} />
            <Link className="db-jump" href="/landlord/listings/new">+ New listing</Link>
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="panel">
            <div className="panel-body" style={{ textAlign: 'center', padding: '32px 20px' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>No listings yet</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>It takes about 5 minutes to go live.</div>
              <Link href="/landlord/listings/new" style={{ background: '#0f172a', color: '#34d399', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                Create your first listing →
              </Link>
            </div>
          </div>
        ) : (
          <div className="pf-grid">
            {shown.map(p => {
              const propLeads   = leads.filter(l => l.property === p.slug)
              const propLeases  = all.currentLeases.filter(l => l.property?.slug === p.slug)
              const propOverdue = overdueForProperty(plans, p.slug, all.today)
              const rooms       = p.total_rooms || 0
              const open        = p.available || 0
              const filled      = Math.max(0, rooms - open)
              const pct         = rooms > 0 ? Math.round((filled / rooms) * 100) : 0
              const rent        = propLeases.reduce((s, l) => s + (l.rent_amount || 0), 0)
              const soonest     = propLeases
                .map(l => ({ l, d: daysUntil(l.end_date) }))
                .sort((a, b) => a.d - b.d)[0]

              return (
                <div key={p.id} className="panel">
                  <div style={{ display: 'flex', gap: 13, padding: '14px 16px' }}>
                    {p.images?.[0]
                      ? <img src={p.images[0]} alt={p.name} style={{ width: 84, height: 66, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />
                      : <div style={{ width: 84, height: 66, borderRadius: 9, background: '#1e293b', display: 'grid', placeItems: 'center', fontSize: 24, flexShrink: 0 }}>🏠</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
                        <Link href={`/landlord/listings/${p.slug}`} style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', textDecoration: 'none' }}>{p.name}</Link>
                        {p.admin_status === 'active' && p.owner_plan_active !== false && <span className="pill" style={{ color: '#065f46', background: '#d1fae5', borderColor: '#a7f3d0' }}>Live</span>}
                        {p.owner_plan_active === false && <span className="pill" style={{ color: '#92400e', background: '#fef3c7', borderColor: '#fde68a' }}>Not published</span>}
                        {p.admin_status === 'inactive' && <span className="pill" style={{ color: '#6b7280', background: '#f9fafb', borderColor: '#e5e7eb' }}>Inactive</span>}
                        {(p.listing_status ?? 'active') === 'rented' && <span className="pill" style={{ color: '#1d4ed8', background: '#eff6ff', borderColor: '#bfdbfe' }}>Rented</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        ${p.price?.toLocaleString()}/mo asking
                        {rent > 0 ? ` · ${fmtFull(rent)}/mo contracted` : ''}
                      </div>
                      <div className="prog-bar" style={{ marginTop: 8 }}>
                        <div className="prog-fill" style={{ width: `${pct}%`, background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                        {filled} of {rooms} rooms filled{open > 0 ? ` · ${open} still open` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '0 16px 4px' }}>
                    <div className="pf-figs">
                      <div>
                        <div className="pf-fig-n">{propLeases.length}</div>
                        <div className="pf-fig-l">Leases</div>
                      </div>
                      <div>
                        <div className="pf-fig-n">{propLeads.length}</div>
                        <div className="pf-fig-l">Leads</div>
                      </div>
                      <div>
                        <div className="pf-fig-n" style={{ color: propOverdue > 0 ? '#dc2626' : '#0f172a' }}>
                          {propOverdue > 0 ? fmtCurrency(propOverdue) : '$0'}
                        </div>
                        <div className="pf-fig-l">Overdue</div>
                      </div>
                      <div>
                        <div className="pf-fig-n" style={{ fontSize: soonest ? 20 : 20, color: soonest && soonest.d <= 60 ? '#c2410c' : '#0f172a' }}>
                          {soonest ? `${soonest.d}d` : '—'}
                        </div>
                        <div className="pf-fig-l">Next end</div>
                      </div>
                    </div>
                    {soonest && (
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 8 }}>
                        Soonest lease ends {formatLeaseDate(soonest.l.end_date)}
                        {soonest.d <= 60 && <> · <Link href="/landlord/renewals" className="panel-link">send a renewal</Link></>}
                      </div>
                    )}
                  </div>

                  <div className="panel-foot" style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <Link href={`/landlord/listings/${p.slug}`} className="panel-link">Manage listing →</Link>
                    <Link href={`/landlord/dashboard/pulse?property=${encodeURIComponent(p.slug)}`} className="panel-link">Traffic →</Link>
                    <Link href="/landlord/leads" className="panel-link">Leads →</Link>
                    <Link href="/landlord/financials" className="panel-link">Rent →</Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8' }}>
        Loading...
      </div>
    }>
      <PortfolioBreakdown />
    </Suspense>
  )
}
