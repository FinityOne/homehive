'use client'

/**
 * The traffic answer, compressed to one panel.
 *
 * The full pulse — chart, funnel, benchmarks, per-listing table, browse clock —
 * is seven bands tall and belongs on its own page, which is where it now
 * lives. What stays on the overview is the part a landlord needs without
 * asking: how many people looked, how many wrote, whether that is better or
 * worse than last week, and the single named problem if there is one.
 *
 * The sparkline is deliberately unlabelled. At this size an axis is noise; its
 * job is to say "steady", "falling off" or "one big day", and the page that
 * can be read for real is one click away.
 */

import Link from 'next/link'
import { C, TONE } from './pulse/theme'
import { usePulse } from './pulse/usePulse'
import type { PulseDay } from '@/lib/listingPulse'

function Spark({ days }: { days: PulseDay[] }) {
  if (days.length < 2) return null
  const W = 300, H = 40
  const peak = Math.max(1, ...days.map(d => d.views))
  const step = W / (days.length - 1)
  const y = (v: number) => H - (v / peak) * (H - 4) - 2
  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${y(d.views).toFixed(1)}`).join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, display: 'block', marginTop: 10 }} aria-hidden="true">
      <path d={area} fill={`${C.views}14`} />
      <path d={line} fill="none" stroke={C.views} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Figure({ label, value, delta, accent }: { label: string; value: string; delta: React.ReactNode; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        {accent && <span style={{ width: 7, height: 7, borderRadius: 2, background: accent, flexShrink: 0 }} />}
        <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 23, fontWeight: 300, color: C.ink, letterSpacing: -0.8, lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 3, fontSize: 10.5 }}>{delta}</div>
    </div>
  )
}

function delta(pct: number | null) {
  if (pct == null) return <span style={{ color: C.muted }}>no prior week</span>
  const r = Math.round(pct * 100)
  if (r === 0) return <span style={{ color: C.muted }}>flat vs last week</span>
  return (
    <span style={{ fontWeight: 600, color: r > 0 ? '#15803d' : '#b91c1c' }}>
      {r > 0 ? '▲' : '▼'} {Math.abs(r)}% <span style={{ fontWeight: 400, color: C.muted }}>wk</span>
    </span>
  )
}

export default function PulseSummary({ slug, href }: { slug: string | null; href: string }) {
  const { data, error, loading } = usePulse(slug, 7)

  return (
    <div className="panel">
      <div className="panel-hd">
        <span className="panel-title">Listing traffic · last 7 days</span>
        <Link href={href} className="panel-link">Traffic report →</Link>
      </div>

      {error ? (
        <div className="panel-body" style={{ fontSize: 13, color: '#b91c1c' }}>{error}</div>
      ) : !data ? (
        <div className="panel-body" style={{ fontSize: 13, color: C.muted }}>
          {loading ? 'Counting your traffic…' : 'No traffic data yet.'}
        </div>
      ) : (() => {
        const p = data.pulse
        // The one thing to do about it. The funnel's named bottleneck beats a
        // generic insight, because it says which step is losing the lease.
        const note = data.funnel.bottleneck
          ? { tone: 'warn' as const, title: data.funnel.bottleneck.title, href: data.funnel.bottleneck.href, cta: 'How to fix it' }
          : p.insights[0]
            ? { tone: p.insights[0].tone, title: p.insights[0].title, href: p.insights[0].href, cta: p.insights[0].cta ?? 'Open' }
            : null

        return (
          <>
            <div className="panel-body" style={{ paddingBottom: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <Figure label="Views"     accent={C.views}     value={p.views.value.toLocaleString()}    delta={delta(p.views.deltaPct)} />
                <Figure label="Visitors"  accent={C.visitors}  value={p.visitors.value.toLocaleString()} delta={delta(p.visitors.deltaPct)} />
                <Figure label="Inquiries" accent={C.inquiries} value={p.inquiries.value.toLocaleString()} delta={delta(p.inquiries.deltaPct)} />
                <Figure
                  label="→ Inquiry"
                  value={p.conversionPct != null ? `${p.conversionPct}%` : '—'}
                  delta={p.conversionPct != null
                    ? <span style={{ color: C.muted }}>of visitors wrote</span>
                    : <span style={{ color: C.muted }}>too few visitors</span>}
                />
              </div>
              <Spark days={p.days} />
            </div>

            {note && (
              <div className="panel-foot" style={{ background: TONE[note.tone].bg, borderTop: `1px solid ${TONE[note.tone].border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    flexShrink: 0, width: 15, height: 15, borderRadius: 999,
                    background: TONE[note.tone].fg, color: '#fff',
                    fontSize: 9.5, fontWeight: 700, display: 'grid', placeItems: 'center',
                  }} aria-hidden="true">{TONE[note.tone].icon}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: TONE[note.tone].fg, minWidth: 0 }}>{note.title}</span>
                  {note.href && (
                    <Link href={note.href} style={{ fontSize: 12, fontWeight: 600, color: TONE[note.tone].fg, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      {note.cta} →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}
