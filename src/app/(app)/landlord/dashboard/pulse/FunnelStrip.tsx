'use client'

/**
 * The six stages between a student seeing the card and standing in the room.
 *
 * Drawn as horizontal bars rather than the classic tapering funnel shape: a
 * trapezoid encodes its value in an area the eye cannot compare, and the whole
 * point of this panel is comparing one step to the next. Bars share a baseline
 * and a scale, so "half the people fell out here" is visible rather than
 * inferred.
 *
 * The step percentages live BETWEEN the bars, because the loss belongs to the
 * transition, not to either stage. The one step that is materially worse than
 * the market gets the status treatment — a colour, an icon and a label, never
 * colour alone — and nothing else does, so there is exactly one thing to read.
 */

import Link from 'next/link'
import type { Funnel } from '@/lib/listingFunnel'
import { C, FUNNEL_RAMP, TONE, nf } from './theme'

export default function FunnelStrip({ funnel, windowDays, compact = false }: {
  funnel: Funnel
  windowDays: number
  compact?: boolean
}) {
  const { stages, bottleneck } = funnel
  const top = Math.max(1, ...stages.map(s => s.people))

  return (
    <div>
      {!funnel.hasSearchData && !compact && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Search impressions start recording from today, so this funnel begins at the page view.
          The two stages above it fill in over the coming week.
        </div>
      )}

      {stages.map((s, i) => {
        const isBreak = bottleneck?.key === s.key
        const w = Math.max(2, (s.people / top) * 100)
        const prev = i === 0 ? null : stages[i - 1]
        return (
          <div key={s.key}>
            {/* The transition from the stage above */}
            {prev && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '3px 0 3px 2px', fontSize: 11,
                color: isBreak ? TONE.warn.fg : C.muted,
                fontWeight: isBreak ? 700 : 400,
              }}>
                <span style={{ width: 10, textAlign: 'center', opacity: 0.6 }}>↓</span>
                {s.stepPct != null
                  ? <span>{s.stepPct}% of them{isBreak ? ' — this is the step losing you leases' : ''}</span>
                  : <span style={{ opacity: 0.55 }}>—</span>}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  height: compact ? 22 : 28, width: `${w}%`,
                  background: FUNNEL_RAMP[Math.min(i, FUNNEL_RAMP.length - 1)],
                  borderRadius: '0 6px 6px 0',
                  display: 'flex', alignItems: 'center', paddingLeft: 10,
                  minWidth: 46, transition: 'width .4s',
                  outline: isBreak ? `2px solid ${TONE.warn.fg}` : 'none',
                  outlineOffset: 1,
                }}>
                  <span style={{
                    fontSize: compact ? 12 : 13, fontWeight: 700,
                    color: i >= 3 ? '#fff' : C.ink,
                  }}>
                    {nf(s.people)}
                  </span>
                </div>
              </div>
              <div style={{ width: compact ? 118 : 150, flexShrink: 0 }}>
                <div style={{ fontSize: compact ? 11.5 : 12.5, fontWeight: 600, color: C.ink }}>
                  {s.label}
                  {isBreak && (
                    <span style={{
                      marginLeft: 5, fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                      color: TONE.warn.fg, background: TONE.warn.bg,
                      border: `1px solid ${TONE.warn.border}`, borderRadius: 4, padding: '1px 4px',
                      whiteSpace: 'nowrap', display: 'inline-block',
                    }}>
                      ! WEAK
                    </span>
                  )}
                </div>
                {!compact && s.count > s.people && (
                  <div style={{ fontSize: 10.5, color: C.muted }}>{nf(s.count)} times in total</div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {bottleneck && (
        <div style={{
          marginTop: 14, padding: '12px 14px',
          background: TONE.warn.bg, border: `1px solid ${TONE.warn.border}`,
          borderLeft: `4px solid ${TONE.warn.fg}`, borderRadius: 10,
        }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TONE.warn.fg, marginBottom: 4 }}>
            {bottleneck.title}
          </div>
          <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.6 }}>{bottleneck.why}</div>
          <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.6, marginTop: 6 }}>
            <strong>What usually fixes it:</strong> {bottleneck.fix}
          </div>
          <Link href={bottleneck.href} style={{
            display: 'inline-block', marginTop: 8, fontSize: 12.5, fontWeight: 600,
            color: TONE.warn.fg, textDecoration: 'none', borderBottom: `1px solid ${TONE.warn.border}`,
          }}>
            Go fix it →
          </Link>
        </div>
      )}

      {!bottleneck && !compact && funnel.stages.some(s => s.stepPct != null) && (
        <div style={{
          marginTop: 12, fontSize: 12.5, color: TONE.good.fg,
          background: TONE.good.bg, border: `1px solid ${TONE.good.border}`,
          borderRadius: 10, padding: '10px 12px', lineHeight: 1.6,
        }}>
          <strong>✓ No weak step.</strong> Every stage is converting in line with comparable
          listings, which means more leases come from more traffic rather than more edits.
        </div>
      )}

      {!compact && funnel.stages.some((s, i) => i > 0 && s.stepPct == null) && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted }}>
          A step shown as “—” has too few people through it to put a percentage on yet.
        </div>
      )}

      {!compact && funnel.medianPosition != null && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted }}>
          Typically shown at position <strong style={{ color: C.ink2 }}>#{funnel.medianPosition}</strong> in
          search results over the last {windowDays} days.
        </div>
      )}
    </div>
  )
}
