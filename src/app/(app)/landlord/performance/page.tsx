'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  COMP_BAND_LABEL, WINDOW_DAYS,
  type ListingReport, type PortfolioSummary, type Severity,
} from '@/lib/listingPerformance'
import { LISTING_STATUS_META } from '@/lib/listingStatus'

/**
 * Listing performance — why a listing is or isn't leasing.
 *
 * The portal already told a landlord everything about the leads they got. It
 * said nothing at all about the students who looked and left, which is the
 * larger number by a factor of twenty and the only one that explains a listing
 * sitting empty. Those views were being recorded the whole time; they were
 * just never shown to the person paying for the vacancy.
 *
 * The page is built around one question per listing — "what is wrong with this
 * one?" — answered before any chart. A landlord does not want a dashboard;
 * they want to be told that four hundred people opened the page and none of
 * them wrote to them, and that the two homes a block away are $90 cheaper per
 * room. The numbers underneath are there to make the sentence believable, in
 * that order and not the reverse.
 *
 * Worst listing first, always. See `sortReports`.
 */

type Payload = {
  reports: ListingReport[]
  summary: PortfolioSummary
  marketInquiryRate: number | null
  windowDays: number
  marketSize: number
}

const SEV: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: '#991b1b', bg: '#fef2f2', border: '#dc2626', label: 'Needs attention' },
  warn:     { color: '#92400e', bg: '#fffbeb', border: '#f59e0b', label: 'Losing interest' },
  info:     { color: '#475569', bg: '#f8fafc', border: '#94a3b8', label: 'For information' },
  ok:       { color: '#065f46', bg: '#ecfdf5', border: '#10b981', label: 'Working' },
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct = (n: number | null) => (n == null ? '—' : `${n}%`)

/**
 * A 30-day view sparkline, hand-rolled in SVG.
 *
 * No chart library, same as `LeadsTrendChart`: a dependency for one polyline
 * is weight the landlord pays for on every page load.
 */
function Spark({ daily }: { daily: Array<{ date: string; views: number }> }) {
  const W = 320, H = 46
  const max = Math.max(1, ...daily.map(d => d.views))
  const step = daily.length > 1 ? W / (daily.length - 1) : W
  const pts = daily.map((d, i) => `${(i * step).toFixed(1)},${(H - (d.views / max) * (H - 6) - 3).toFixed(1)}`)
  const area = `0,${H} ${pts.join(' ')} ${W},${H}`

  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label={`Views per day over the last ${daily.length} days, peaking at ${max}`}>
        <polygon points={area} fill="rgba(16,185,129,0.12)" />
        <polyline points={pts.join(' ')} fill="none" stroke="#10b981" strokeWidth="1.6"
                  strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-ax">
        <span>{daily[0]?.date.slice(5)}</span>
        <span>peak {max}/day</span>
        <span>today</span>
      </div>
    </div>
  )
}

/** Where your per-bedroom price sits in the comp band. */
function PriceBar({ r }: { r: ListingReport }) {
  const c = r.comps
  if (c.median == null || c.yourPerBed == null) return null
  const lo = Math.min(c.p25 ?? c.median, c.yourPerBed)
  const hi = Math.max(c.p75 ?? c.median, c.yourPerBed)
  const span = Math.max(1, hi - lo)
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`

  return (
    <div className="pbar-wrap">
      <div className="pbar">
        <div className="pbar-band" style={{ left: at(c.p25 ?? c.median), right: `${100 - parseFloat(at(c.p75 ?? c.median))}%` }} />
        <div className="pbar-med" style={{ left: at(c.median) }} title={`Median ${money(c.median)}`} />
        <div className="pbar-you" style={{ left: at(c.yourPerBed) }} title={`You ${money(c.yourPerBed)}`} />
      </div>
      <div className="pbar-legend">
        <span><i className="dot you" /> You {money(c.yourPerBed)}/bed</span>
        <span><i className="dot med" /> Median {money(c.median)}</span>
        <span className="muted">middle half {money(c.p25 ?? c.median)}–{money(c.p75 ?? c.median)}</span>
      </div>
    </div>
  )
}

function Funnel({ r }: { r: ListingReport }) {
  const f = r.funnel
  const steps = [
    { k: 'Views', v: f.views, sub: `${f.viewsPerDay}/day` },
    { k: 'Viewers', v: f.viewers, sub: 'unique sessions' },
    { k: 'Inquiries', v: f.inquiries, sub: f.inquiryRate != null ? `${f.inquiryRate}% of viewers` : 'too few to rate' },
    { k: 'Tours', v: f.tours, sub: f.tourRate != null ? `${f.tourRate}% of inquiries` : '—' },
  ]
  return (
    <div className="funnel">
      {steps.map((s, i) => (
        <div key={s.k} className="fstep">
          {i > 0 && <span className="farrow">→</span>}
          <div>
            <div className="fnum">{s.v.toLocaleString()}</div>
            <div className="fk">{s.k}</div>
            <div className="fsub">{s.sub}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ListingCard({ r, marketRate }: { r: ListingReport; marketRate: number | null }) {
  const [open, setOpen] = useState(r.diagnosis.severity === 'critical')
  const sev = SEV[r.diagnosis.severity]
  const status = LISTING_STATUS_META[r.listing.listing_status]
  const a = r.activity
  const c = r.comps

  return (
    <div className="lcard" style={{ borderLeftColor: sev.border }}>
      <div className="lhead">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="lpills">
            <span className="pill" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
            <span className="pill" style={{ background: status.bg, color: status.color }}>
              {status.icon} {status.label}
            </span>
            <span className="pill ghost">{r.daysListed}d on market</span>
            {a.questions > 0 && <span className="pill ghost">{a.questions} question{a.questions === 1 ? '' : 's'}</span>}
          </div>
          <Link href={`/landlord/listings/${r.listing.slug}`} className="lname">{r.listing.name}</Link>
          <div className="ldiag" style={{ color: sev.color }}>{r.diagnosis.headline}</div>
          <p className="ldetail">{r.diagnosis.detail}</p>
          {r.diagnosis.actions.length > 0 && (
            <div className="lacts">
              {r.diagnosis.actions.map(act => act.href ? (
                <Link key={act.label} href={act.href} className="act">{act.label}</Link>
              ) : (
                <span key={act.label} className="act flat">{act.label}</span>
              ))}
            </div>
          )}
        </div>
        <button className="toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Hide numbers' : 'Show numbers'}
        </button>
      </div>

      {open && (
        <div className="lbody">
          <Funnel r={r} />

          <div className="lgrid">
            <div className="lbox">
              <div className="lbox-t">Views, last {WINDOW_DAYS} days</div>
              <Spark daily={a.daily} />
              <div className="lbox-f">
                {a.viewsPrev > 0 && r.funnel.trendPct != null ? (
                  <span className={r.funnel.trendPct >= 0 ? 'up' : 'down'}>
                    {r.funnel.trendPct >= 0 ? '▲' : '▼'} {Math.abs(r.funnel.trendPct)}% vs the {WINDOW_DAYS} days before
                  </span>
                ) : (
                  <span className="muted">No earlier window to compare against</span>
                )}
                {a.lastViewAt && <span className="muted"> · last view {new Date(a.lastViewAt).toLocaleDateString()}</span>}
              </div>
            </div>

            <div className="lbox">
              <div className="lbox-t">Where they came from</div>
              {a.sources.length === 0 ? (
                <div className="empty">No views in this window.</div>
              ) : (
                <div className="bars">
                  {a.sources.map(s => (
                    <div key={s.source} className="bar">
                      <span className="bar-k" title={s.source}>{s.source}</span>
                      <span className="bar-t">
                        <i style={{ width: `${Math.max(3, (s.views / a.sources[0].views) * 100)}%` }} />
                      </span>
                      <span className="bar-v">{s.views}</span>
                    </div>
                  ))}
                </div>
              )}
              {a.devices.length > 0 && (
                <div className="lbox-f">
                  {a.devices.map(d => `${d.device} ${Math.round((d.views / a.views) * 100)}%`).join(' · ')}
                </div>
              )}
            </div>
          </div>

          <div className="lbox">
            <div className="lbox-t">
              Price against the market
              <span className="band">{COMP_BAND_LABEL[c.band]} · {c.count} comp{c.count === 1 ? '' : 's'}</span>
            </div>

            {c.thin ? (
              <div className="empty">
                Not enough comparable live listings yet to price this one against. The figures above still stand on their own.
              </div>
            ) : (
              <>
                <PriceBar r={r} />
                <div className="verdict">
                  {c.deltaPct === 0
                    ? 'Priced at the median.'
                    : `${Math.abs(c.deltaPct ?? 0)}% ${(c.deltaPct ?? 0) > 0 ? 'above' : 'below'} the median — ${c.percentile}th percentile of ${c.count} comparable listings.`}
                </div>

                {r.advice && (
                  <div className={`advice ${r.advice.direction}`}>
                    <div className="advice-h">{r.advice.headline}</div>
                    <p>{r.advice.reasoning}</p>
                  </div>
                )}

                {c.comps.length > 0 && (
                  <details className="comps">
                    <summary>See the comparable listings</summary>
                    <table>
                      <thead>
                        <tr><th>Listing</th><th>Beds</th><th>To ASU</th><th>Per bed</th></tr>
                      </thead>
                      <tbody>
                        {c.comps.slice(0, 12).map(x => (
                          <tr key={x.slug} className={x.isOwn ? 'own' : undefined}>
                            <td>{x.name}{x.isOwn && <span className="mine">yours</span>}</td>
                            <td>{x.beds || '—'}</td>
                            <td>{x.distance == null ? '—' : `${x.distance} mi`}</td>
                            <td className="num">{money(x.perBed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="lbox-f muted">
                      Your own listings are shown for context but never counted in the median.
                    </div>
                  </details>
                )}
              </>
            )}
          </div>

          <div className="lfoot">
            <span>{a.viewsTotal.toLocaleString()} views and {a.inquiriesTotal} inquir{a.inquiriesTotal === 1 ? 'y' : 'ies'} all time</span>
            {marketRate != null && r.funnel.inquiryRate != null && (
              <span>
                {r.funnel.inquiryRate}% inquiry rate vs {marketRate}% across HomeHive
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function PerformancePage() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'attention' | 'all'>('attention')

  useEffect(() => { document.title = 'Listing Performance — Landlord | HomeHive' }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login?next=/landlord/performance'); return }
      const res = await fetch('/api/landlord/listing-performance', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) { setError(json.error || 'Could not load performance.'); return }
      setData(json as Payload)
    })()
    return () => { cancelled = true }
  }, [router])

  const shown = useMemo(() => {
    if (!data) return []
    if (filter === 'all') return data.reports
    const flagged = data.reports.filter(r => r.diagnosis.severity === 'critical' || r.diagnosis.severity === 'warn')
    return flagged.length ? flagged : data.reports
  }, [data, filter])

  if (error) {
    return (
      <div className="pf-wrap">
        <style>{CSS}</style>
        <div className="pf-title">Listing performance</div>
        <div className="empty big">{error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="pf-wrap">
        <style>{CSS}</style>
        <div className="pf-title">Listing performance</div>
        <div className="empty big">Counting views, inquiries and comparable rents…</div>
      </div>
    )
  }

  const s = data.summary
  const attention = data.reports.filter(r => r.diagnosis.severity === 'critical' || r.diagnosis.severity === 'warn').length

  return (
    <div className="pf-wrap">
      <style>{CSS}</style>

      <div className="pf-head">
        <div>
          <div className="pf-title">Listing performance</div>
          <p className="pf-sub">
            Who looked at your listings, who wrote to you, and whether your rent is why they
            didn&apos;t. Last {data.windowDays} days, worst listing first.
          </p>
        </div>
      </div>

      {s.listings === 0 ? (
        <div className="empty big">
          No listings yet. <Link href="/landlord/listings/new">Add your first one</Link> and this page fills
          itself from the moment students start opening it.
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Viewers</div>
              <div className="kpi-val">{s.viewers.toLocaleString()}</div>
              <div className="kpi-sub">{s.views.toLocaleString()} views across {s.listings} listing{s.listings === 1 ? '' : 's'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Inquiries</div>
              <div className="kpi-val">{s.inquiries.toLocaleString()}</div>
              <div className="kpi-sub">
                {s.inquiryRate != null ? `${pct(s.inquiryRate)} of viewers` : 'too few viewers to rate'}
                {s.inquiryRate != null && data.marketInquiryRate != null && (
                  <span className={s.inquiryRate >= data.marketInquiryRate ? ' up' : ' down'}>
                    {' '}· market {pct(data.marketInquiryRate)}
                  </span>
                )}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Needs attention</div>
              <div className={`kpi-val ${attention > 0 ? 'bad' : ''}`}>{attention}</div>
              <div className="kpi-sub">{attention === 0 ? 'nothing flagged' : `of ${s.listings} listing${s.listings === 1 ? '' : 's'}`}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Empty rooms</div>
              <div className={`kpi-val ${s.openRooms > 0 ? 'warn' : ''}`}>{s.openRooms}</div>
              <div className="kpi-sub">{s.vacantRent > 0 ? `${money(s.vacantRent)}/mo unearned` : 'all filled'}</div>
            </div>
          </div>

          <div className="filters">
            <div className="seg">
              <button className={`seg-btn ${filter === 'attention' ? 'on' : ''}`} onClick={() => setFilter('attention')}>
                Needs attention{attention > 0 ? ` (${attention})` : ''}
              </button>
              <button className={`seg-btn ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
                All {s.listings}
              </button>
            </div>
            {data.marketSize > 0 && (
              <span className="note">Comps drawn from {data.marketSize} live listings near ASU.</span>
            )}
          </div>

          {shown.map(r => (
            <ListingCard key={r.listing.slug} r={r} marketRate={data.marketInquiryRate} />
          ))}
        </>
      )}
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .pf-wrap { max-width: 1040px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .pf-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .pf-title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .pf-sub { font-size: 13px; color: #64748b; margin-top: 4px; max-width: 580px; line-height: 1.55; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .kpi { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 5px; }
  .kpi-val { font-size: 20px; font-weight: 700; color: #0f172a; }
  .kpi-val.bad { color: #dc2626; }
  .kpi-val.warn { color: #b45309; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; line-height: 1.45; }

  .filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .seg { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
  .seg-btn { background: none; border: none; border-radius: 7px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; font-family: inherit; }
  .seg-btn.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
  .note { font-size: 11.5px; color: #94a3b8; }

  .lcard { background: #fff; border: 1.5px solid #e2e8f0; border-left-width: 4px; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
  .lhead { display: flex; gap: 16px; align-items: flex-start; padding: 16px 18px; }
  .lpills { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 7px; }
  .pill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 3px 9px; border-radius: 20px; }
  .pill.ghost { background: #f1f5f9; color: #64748b; }
  .lname { display: inline-block; font-size: 16px; font-weight: 700; color: #0f172a; text-decoration: none; letter-spacing: -0.2px; }
  .lname:hover { text-decoration: underline; }
  .ldiag { font-size: 14px; font-weight: 600; margin-top: 7px; line-height: 1.4; }
  .ldetail { font-size: 12.5px; color: #64748b; margin-top: 5px; line-height: 1.6; max-width: 660px; }
  .lacts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 11px; }
  .act { font-size: 12px; font-weight: 600; color: #0f172a; text-decoration: none; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 6px 12px; }
  .act:hover { border-color: #cbd5e1; background: #fff; }
  .act.flat { color: #94a3b8; border-style: dashed; }
  .toggle { flex-shrink: 0; background: none; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 6px 12px; font-family: inherit; font-size: 12px; font-weight: 600; color: #64748b; cursor: pointer; }
  .toggle:hover { border-color: #cbd5e1; color: #0f172a; }

  .lbody { border-top: 1px solid #f1f5f9; padding: 16px 18px; background: #fcfdfe; }

  .funnel { display: flex; align-items: flex-start; gap: 4px; flex-wrap: wrap; margin-bottom: 16px; }
  .fstep { display: flex; align-items: center; gap: 4px; }
  .farrow { color: #cbd5e1; font-size: 15px; margin: 0 10px; }
  .fnum { font-size: 19px; font-weight: 700; color: #0f172a; line-height: 1.1; }
  .fk { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-top: 3px; }
  .fsub { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }

  .lgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .lbox { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 13px 15px; margin-bottom: 12px; }
  .lgrid .lbox { margin-bottom: 0; }
  .lbox-t { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 10px; display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .band { text-transform: none; letter-spacing: 0; font-weight: 500; color: #94a3b8; }
  .lbox-f { font-size: 11px; color: #64748b; margin-top: 8px; line-height: 1.5; }
  .muted { color: #94a3b8; }
  .up { color: #059669; font-weight: 600; }
  .down { color: #b45309; font-weight: 600; }

  .spark svg { width: 100%; height: 46px; display: block; }
  .spark-ax { display: flex; justify-content: space-between; font-size: 10px; color: #cbd5e1; margin-top: 3px; }

  .bars { display: flex; flex-direction: column; gap: 6px; }
  .bar { display: flex; align-items: center; gap: 8px; }
  .bar-k { font-size: 11.5px; color: #475569; width: 92px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-t { flex: 1; height: 7px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .bar-t i { display: block; height: 100%; background: #10b981; border-radius: 4px; }
  .bar-v { font-size: 11.5px; font-weight: 700; color: #0f172a; width: 32px; text-align: right; }

  .pbar-wrap { margin-bottom: 10px; }
  .pbar { position: relative; height: 10px; background: #f1f5f9; border-radius: 5px; }
  .pbar-band { position: absolute; top: 0; bottom: 0; background: #dbeafe; border-radius: 5px; }
  .pbar-med { position: absolute; top: -3px; width: 2px; height: 16px; background: #1d4ed8; transform: translateX(-1px); }
  .pbar-you { position: absolute; top: -5px; width: 12px; height: 20px; border-radius: 3px; background: #0f172a; transform: translateX(-6px); }
  .pbar-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: #475569; margin-top: 10px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  .dot.you { background: #0f172a; }
  .dot.med { background: #1d4ed8; }

  .verdict { font-size: 12.5px; color: #0f172a; font-weight: 600; margin-bottom: 10px; line-height: 1.5; }

  .advice { border-radius: 9px; padding: 12px 14px; margin-bottom: 10px; border: 1.5px solid; }
  .advice.lower { background: #fff1f2; border-color: #fecdd3; }
  .advice.raise { background: #ecfdf5; border-color: #a7f3d0; }
  .advice.hold  { background: #f8fafc; border-color: #e2e8f0; }
  .advice-h { font-size: 13.5px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
  .advice p { font-size: 12px; color: #475569; line-height: 1.6; }

  .comps { margin-top: 4px; }
  .comps summary { font-size: 12px; font-weight: 600; color: #1d4ed8; cursor: pointer; padding: 4px 0; }
  .comps table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .comps th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; text-align: left; padding: 5px 6px; border-bottom: 1px solid #f1f5f9; }
  .comps td { font-size: 12px; color: #334155; padding: 6px; border-bottom: 1px solid #f8fafc; }
  .comps td.num { font-weight: 700; color: #0f172a; text-align: right; }
  .comps tr.own td { background: #fffbeb; }
  .mine { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #92400e; background: #fef3c7; border-radius: 4px; padding: 1px 5px; margin-left: 6px; }

  .lfoot { display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; color: #94a3b8; padding-top: 4px; }

  .empty { font-size: 12.5px; color: #94a3b8; line-height: 1.6; }
  .empty.big { background: #fff; border: 1.5px dashed #e2e8f0; border-radius: 12px; padding: 36px 24px; text-align: center; font-size: 13.5px; }
  .empty a { color: #10b981; font-weight: 600; }

  @media (max-width: 760px) {
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .lgrid { grid-template-columns: 1fr; }
    .lhead { flex-direction: column; }
  }
`
