'use client'

/**
 * The traffic half of the landlord overview.
 *
 * The overview used to open on revenue, occupancy and a lead count, which is a
 * fine summary of a portfolio that is already working and says nothing at all
 * to the landlord whose listing has been quiet for three weeks. That landlord's
 * real question is "is anyone even seeing this?", and until now the answer was
 * in a table only the admin screens read.
 *
 * Everything here is counted by /api/landlord/pulse and judged by
 * src/lib/listingPulse.ts. This file only draws it.
 *
 * The chart is deliberately one y-axis with two same-unit series: views and
 * the unique people behind them. The distance between the two lines is the
 * most interesting thing on the page — it is repeat interest — and a second
 * axis would make that gap an artefact of scaling instead of a fact.
 * Inquiries are an order of magnitude smaller, so they are drawn as markers on
 * the baseline rather than as a third scaled series, which is the honest way
 * to show an event count beside a volume count.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { PULSE_WINDOWS, DEFAULT_PULSE_WINDOW, MARKET_INQUIRY_RATE } from '@/lib/listingPulse'
import type { PulseWindow, PulseDay } from '@/lib/listingPulse'
import type { PulsePayload } from '@/lib/pulsePayload'
import type { Benchmark } from '@/lib/listingFunnel'
import { C, TONE, nf } from './pulse/theme'
import { usePulse } from './pulse/usePulse'
import FunnelStrip from './pulse/FunnelStrip'
import PaceCard from './pulse/PaceCard'
import BrowseClockPanel from './pulse/BrowseClockPanel'
import ListingBreakdown from './pulse/ListingBreakdown'


/** A delta chip. Arrow plus sign plus colour — never colour alone. */
function Delta({ pct, windowDays }: { pct: number | null; windowDays: number }) {
  if (pct == null) {
    return <span style={{ fontSize: 11, color: C.muted }}>no prior {windowDays}d to compare</span>
  }
  const rounded = Math.round(pct * 100)
  if (rounded === 0) {
    return <span style={{ fontSize: 11, color: C.muted }}>flat vs prior {windowDays}d</span>
  }
  const up = rounded > 0
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: up ? '#15803d' : '#b91c1c' }}>
      {up ? '▲' : '▼'} {Math.abs(rounded)}%{' '}
      <span style={{ fontWeight: 400, color: C.muted }}>vs prior {windowDays}d</span>
    </span>
  )
}

function Tile({
  label, value, sub, accent,
}: { label: string; value: string; sub: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        {accent && <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, flexShrink: 0 }} />}
        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.7 }}>
          {label}
        </span>
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 300, color: C.ink, letterSpacing: -1, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ marginTop: 5, lineHeight: 1.4 }}>{sub}</div>
    </div>
  )
}

// ── The chart ────────────────────────────────────────────────────────────────

function TrafficChart({ days, windowDays }: { days: PulseDay[]; windowDays: PulseWindow }) {
  const [hover, setHover] = useState<number | null>(null)

  const n = days.length
  const W = 760, H = 220
  const padL = 30, padR = 14, padT = 14, padB = 40
  const innerW = W - padL - padR, innerH = H - padT - padB

  const peak = Math.max(1, ...days.map(d => d.views))
  const niceMax = peak <= 5 ? peak : Math.ceil(peak / 5) * 5
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH
  const band = innerW / n
  // Two bars per day with a 2px surface gap between them, inside 72% of the
  // band — and capped, because at 7 days an uncapped bar is a 36px slab that
  // reads as a block of colour rather than a measurement.
  const barW = Math.min(22, Math.max(2, (band * 0.72 - 2) / 2))
  const slotX = (i: number) => padL + band * i + (band - (barW * 2 + 2)) / 2
  const r = Math.min(4, barW / 2)

  /**
   * A bar rounded at the data end only. `rx` on a `<rect>` rounds all four
   * corners, which lifts the bar off its own baseline and makes short bars
   * read as floating — the value a bar encodes is the distance from the
   * baseline, so that end has to stay square against it.
   */
  const bar = (x: number, value: number) => {
    const top = y(value)
    const h = Math.max(1, y(0) - top)
    const rr = Math.min(r, h)
    return `M ${x} ${y(0)} L ${x} ${top + rr} Q ${x} ${top} ${x + rr} ${top} ` +
           `L ${x + barW - rr} ${top} Q ${x + barW} ${top} ${x + barW} ${top + rr} ` +
           `L ${x + barW} ${y(0)} Z`
  }

  const ticks = [0, niceMax / 2, niceMax]
  const labelEvery = n <= 10 ? 1 : Math.ceil(n / 8)
  const hovered = hover != null ? days[hover] : null

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Daily listing views and unique visitors over the last ${windowDays} days`}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={C.faint} strokeWidth="1" />
            <text x={padL - 7} y={y(v) + 3} textAnchor="end" fontSize="9" fill={C.muted}>{Math.round(v)}</text>
          </g>
        ))}
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke={C.line} strokeWidth="1" />

        {days.map((d, i) => {
          const x0 = slotX(i)
          const on = hover === i
          return (
            <g key={d.date}>
              {on && (
                <rect x={padL + band * i} y={padT} width={band} height={innerH} fill="#f8fafc" />
              )}
              {/* Views */}
              {d.views > 0 && (
                <path d={bar(x0, d.views)} fill={C.views} opacity={hover == null || on ? 1 : 0.45} />
              )}
              {/* Unique visitors — same axis, same unit, always ≤ views */}
              {d.visitors > 0 && (
                <path d={bar(x0 + barW + 2, d.visitors)} fill={C.visitors} opacity={hover == null || on ? 1 : 0.45} />
              )}
              {/* Inquiries: an event marker on the baseline, not a scaled series */}
              {d.inquiries > 0 && (
                <g>
                  <polygon
                    points={`${padL + band * i + band / 2},${y(0) + 5} ${padL + band * i + band / 2 - 5},${y(0) + 14} ${padL + band * i + band / 2 + 5},${y(0) + 14}`}
                    fill={C.inquiries}
                  />
                  {/* Beside the marker, not under it: under it is where the
                      day label lives, and the two collide. */}
                  {d.inquiries > 1 && (
                    <text x={padL + band * i + band / 2 + 7} y={y(0) + 14} fontSize="8" fontWeight="700" fill={C.inquiries}>
                      {d.inquiries}
                    </text>
                  )}
                </g>
              )}
              {i % labelEvery === 0 && (
                <text x={padL + band * i + band / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={C.muted}>
                  {d.label}
                </text>
              )}
              {/* Hit target spans the whole band, wider than the marks */}
              <rect
                x={padL + band * i} y={padT} width={band} height={innerH + padB - 10}
                fill="transparent" onMouseEnter={() => setHover(i)}
              />
            </g>
          )
        })}
      </svg>

      {hovered && (
        <div style={{
          position: 'absolute', top: 0,
          left: `${((padL + band * hover! + band / 2) / W) * 100}%`,
          transform: 'translateX(-50%)',
          background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10,
          boxShadow: '0 8px 24px rgba(15,23,42,0.10)', padding: '9px 11px',
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 5 }}>{hovered.full}</div>
          {[
            { c: C.views, l: 'Views', v: hovered.views },
            { c: C.visitors, l: 'Unique visitors', v: hovered.visitors },
            { c: C.inquiries, l: 'Inquiries', v: hovered.inquiries },
          ].map(row => (
            <div key={row.l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.ink2 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: row.c }} />
              {row.l}: <strong style={{ color: C.ink }}>{row.v}</strong>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, paddingLeft: 4 }}>
        {[
          { c: C.views, l: 'Views', shape: 'bar' as const },
          { c: C.visitors, l: 'Unique visitors', shape: 'bar' as const },
          { c: C.inquiries, l: 'Inquiry', shape: 'tri' as const },
        ].map(s => (
          <span key={s.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.ink2 }}>
            {s.shape === 'bar'
              ? <span style={{ width: 9, height: 9, borderRadius: 2, background: s.c }} />
              : <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: `8px solid ${s.c}` }} />
            }
            {s.l}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────

/**
 * One comparison against the market.
 *
 * A bare number is unreadable — "12 views" is either healthy or a disaster
 * and a landlord cannot tell which — so every figure here arrives next to
 * what comparable listings are doing in the same week. The verdict carries an
 * arrow and a word as well as a colour, and when the pool is too small to be
 * a market the chip says that instead of inventing a comparison.
 */
function BenchmarkChip({ b }: { b: Benchmark }) {
  const look =
    b.verdict === 'ahead'   ? { fg: '#15803d', mark: '▲', word: 'Ahead' }
    : b.verdict === 'behind' ? { fg: '#b45309', mark: '▼', word: 'Behind' }
    : b.verdict === 'typical' ? { fg: C.ink2,   mark: '=', word: 'Typical' }
    :                           { fg: C.muted,  mark: '·', word: 'No read yet' }

  const fmt = (n: number | null) => (n == null ? '—' : b.unit === '%' ? `${n}%` : `${n}`)

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {b.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, color: C.ink, letterSpacing: -0.8 }}>
          {fmt(b.you)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: look.fg }}>
          {look.mark} {look.word}
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{b.note}</div>
    </div>
  )
}

export default function ListingPulse({ slug }: { slug: string | null }) {
  const [windowDays, setWindowDays] = useState<PulseWindow>(DEFAULT_PULSE_WINDOW)
  // Keep the last good pulse on screen while a toggle reloads: blanking the
  // whole section to swap one number is how a dashboard feels broken.
  const { data, error, loading } = usePulse(slug, windowDays)
  const [showTable, setShowTable] = useState(false)

  const p = data?.pulse ?? null
  const market = Math.round(MARKET_INQUIRY_RATE * 1000) / 10

  const headline = p?.insights[0] ?? null
  const rest = useMemo(() => p?.insights.slice(1) ?? [], [p])
  const ranked = useMemo(
    () => (p?.listings ?? []).filter(l => l.views > 0 || l.isLive).slice(0, 6),
    [p]
  )

  const asOfLabel = data?.asOf
    ? new Date(`${data.asOf}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : null

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
        <div>
          <div className="db-section-title" style={{ margin: 0 }}>👀 Listing pulse</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Who opened your listing {windowDays === 7 ? 'this week' : 'this month'}
            {asOfLabel ? ` · last ${windowDays} days through ${asOfLabel}` : ''}
          </div>
        </div>
        <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
          {PULSE_WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setWindowDays(w)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                background: windowDays === w ? '#8C1D40' : '#fff',
                color: windowDays === w ? '#fff' : '#64748b',
              }}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="panel"><div className="panel-body" style={{ fontSize: 13, color: '#b91c1c' }}>{error}</div></div>
      )}

      {!error && !data && (
        <div className="panel"><div className="panel-body" style={{ fontSize: 13, color: C.muted }}>
          {loading ? 'Counting your traffic…' : 'No traffic data yet.'}
        </div></div>
      )}

      {!error && data && (() => {
        const p = data.pulse
        return (
        <>
          {/* One payload, destructured once: narrowing on `data` is what keeps
              the funnel, pace and clock reads below type-safe. */}
          {/* Will the rooms be full in time? Above every count, because it is
              the only question here with a date attached. */}
          {data.pace.verdict !== 'no_vacancy' && <PaceCard pace={data.pace} />}

          {/* The one thing to do about it, before any number */}
          {headline && (
            <div style={{
              background: TONE[headline.tone].bg,
              border: `1px solid ${TONE[headline.tone].border}`,
              borderLeft: `4px solid ${TONE[headline.tone].fg}`,
              borderRadius: 12, padding: '14px 16px', marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: 999, marginTop: 1,
                  background: TONE[headline.tone].fg, color: '#fff',
                  fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center',
                }} aria-hidden="true">{TONE[headline.tone].icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: TONE[headline.tone].fg, marginBottom: 3 }}>
                    {headline.title}
                  </div>
                  <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>{headline.detail}</div>
                  {headline.href && (
                    <Link href={headline.href} style={{ display: 'inline-block', marginTop: 8, fontSize: 13, fontWeight: 600, color: TONE[headline.tone].fg, textDecoration: 'none', borderBottom: `1px solid ${TONE[headline.tone].border}` }}>
                      {headline.cta ?? 'Open'} →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── The four numbers ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }} className="pulse-tiles">
            <Tile
              label="Listing views"
              accent={C.views}
              value={nf(p.views.value)}
              sub={<Delta pct={p.views.deltaPct} windowDays={windowDays} />}
            />
            <Tile
              label="Unique visitors"
              accent={C.visitors}
              value={nf(p.visitors.value)}
              sub={
                <div>
                  <Delta pct={p.visitors.deltaPct} windowDays={windowDays} />
                  {p.returningVisitors > 0 && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {p.returningVisitors} came back
                      {p.viewsPerVisitor ? ` · ${p.viewsPerVisitor} views each` : ''}
                    </div>
                  )}
                </div>
              }
            />
            <Tile
              label="Inquiries"
              accent={C.inquiries}
              value={nf(p.inquiries.value)}
              sub={
                <div>
                  <Delta pct={p.inquiries.deltaPct} windowDays={windowDays} />
                  {p.tours.value > 0 && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {p.tours.value} tour{p.tours.value !== 1 ? 's' : ''} booked
                    </div>
                  )}
                </div>
              }
            />
            <Tile
              label="Visitor → inquiry"
              value={p.conversionPct != null ? `${p.conversionPct}%` : '—'}
              sub={
                p.conversionPct != null
                  ? <span style={{ fontSize: 11, color: p.conversionPct >= market ? '#15803d' : '#b45309', fontWeight: 600 }}>
                      {p.conversionPct >= market ? '▲' : '▼'} {market}% is typical here
                    </span>
                  : <span style={{ fontSize: 11, color: C.muted }}>
                      needs {p.visitors.value ? `${Math.max(0, 25 - p.visitors.value)} more visitors` : 'more visitors'} to mean anything
                    </span>
              }
            />
          </div>

          {/* ── The chart ── */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-hd">
              <span className="panel-title">Views &amp; visitors — last {windowDays} days</span>
              {p.busiestDay && (
                <span style={{ fontSize: 12, color: C.ink2 }}>
                  Busiest: <strong style={{ color: C.ink }}>{p.busiestDay.label}</strong> ({p.busiestDay.views} views)
                </span>
              )}
            </div>
            <div className="panel-body">
              <TrafficChart days={p.days} windowDays={windowDays} />
              <button
                onClick={() => setShowTable(v => !v)}
                style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#8C1D40', fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                {showTable ? 'Hide the numbers' : 'Show the numbers'}
              </button>
              {showTable && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Day', 'Views', 'Unique visitors', 'Inquiries'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Day' ? 'left' : 'right', padding: '5px 8px', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.days.map(d => (
                        <tr key={d.date}>
                          <td style={{ padding: '5px 8px', color: C.ink2, borderBottom: `1px solid ${C.faint}`, whiteSpace: 'nowrap' }}>{d.full}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: C.ink, borderBottom: `1px solid ${C.faint}` }}>{d.views}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: C.ink, borderBottom: `1px solid ${C.faint}` }}>{d.visitors}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: C.ink, borderBottom: `1px solid ${C.faint}` }}>{d.inquiries}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Where the leases are being lost ──
              Deliberately below the volume chart and above the per-listing
              list: the chart says how much traffic there is, this says what
              happens to it, and only then is it useful to know which home. */}
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-hd">
              <span className="panel-title">From search to signed — last {windowDays} days</span>
              {data.funnel.ctrPct != null && (
                <span style={{ fontSize: 12, color: C.ink2 }}>
                  Click-through <strong style={{ color: C.ink }}>{data.funnel.ctrPct}%</strong>
                </span>
              )}
            </div>
            <div className="panel-body">
              <FunnelStrip funnel={data.funnel} windowDays={windowDays} />
            </div>
          </div>

          {/* ── How this compares to everyone else right now ── */}
          {data.benchmarks.some(b => b.verdict !== 'unknown') && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-hd">
                <span className="panel-title">Against comparable listings</span>
                <span style={{ fontSize: 11, color: C.muted }}>live on HomeHive right now</span>
              </div>
              <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }} >
                {data.benchmarks.map(b => <BenchmarkChip key={b.key} b={b} />)}
              </div>
            </div>
          )}

          {/* ── Per-listing, and where the traffic came from ── */}
          <div className="db-row">
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">Traffic by listing</span>
                <Link href="/landlord/performance" className="panel-link">Full performance →</Link>
              </div>
              <div className="panel-body">
                <ListingBreakdown rows={ranked} detail={data.detail} windowDays={windowDays} />
              </div>
            </div>

            <div className="panel">
              <div className="panel-hd"><span className="panel-title">Where they came from</span></div>
              <div className="panel-body">
                {p.sources.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.muted }}>
                    No visits in the last {windowDays} days, so there is nothing to attribute yet.
                  </div>
                ) : (
                  <>
                    {p.sources.map((s, i) => (
                      <div key={s.source} className={`row-item${i === 0 ? ' row-item-first' : ''}`} style={{ display: 'block' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                          <span style={{ fontSize: 13, color: C.ink, fontWeight: 500 }}>{s.source}</span>
                          <span style={{ fontSize: 12, color: C.ink2, whiteSpace: 'nowrap' }}>
                            {s.visitors} {s.visitors === 1 ? 'person' : 'people'} · {s.pct}%
                          </span>
                        </div>
                        <div className="prog-bar" style={{ marginTop: 6 }}>
                          <div className="prog-fill" style={{ width: `${s.pct}%`, background: C.visitors }} />
                        </div>
                      </div>
                    ))}
                    {p.devices.length > 0 && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.faint}`, fontSize: 12, color: C.ink2 }}>
                        {p.devices.map(d => `${d.pct}% on ${d.device.toLowerCase()}`).join(' · ')}
                        {(p.devices[0]?.device === 'Phone' && p.devices[0].pct >= 60) && (
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                            Most of your visitors are on a phone — the cover photo and the first line are
                            almost all they see before deciding.
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── When students are actually looking ── */}
          <div className="db-row-full">
            <div className="panel">
              <div className="panel-hd">
                <span className="panel-title">When students look at your listings</span>
                {data.clock.readable && data.clock.peakLabel && (
                  <span style={{ fontSize: 12, color: C.ink2 }}>
                    Peak <strong style={{ color: C.ink }}>{data.clock.peakLabel}</strong>
                  </span>
                )}
              </div>
              <div className="panel-body">
                <BrowseClockPanel clock={data.clock} windowDays={windowDays} />
              </div>
            </div>
          </div>

          {/* ── What else the numbers say ── */}
          {rest.length > 0 && (
            <div className="db-row" style={{ gridTemplateColumns: rest.length > 1 ? '1fr 1fr' : '1fr' }}>
              {rest.map(ins => (
                <div key={ins.key} className="panel" style={{ borderColor: TONE[ins.tone].border }}>
                  <div className="panel-body">
                    <div style={{ fontSize: 13, fontWeight: 700, color: TONE[ins.tone].fg, marginBottom: 4 }}>
                      {ins.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>{ins.detail}</div>
                    {ins.href && (
                      <Link href={ins.href} className="panel-link" style={{ display: 'inline-block', marginTop: 7 }}>
                        {ins.cta ?? 'Open'} →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
        )
      })()}

      <style>{`
        @media (max-width: 760px) { .pulse-tiles { grid-template-columns: repeat(2, 1fr) !important; } }
      `}</style>
    </div>
  )
}
