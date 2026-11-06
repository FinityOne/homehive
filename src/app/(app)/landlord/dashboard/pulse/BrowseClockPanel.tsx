'use client'

/**
 * When students are actually looking at this home.
 *
 * A heatmap rather than a line, because the question is not "how much" but
 * "when", and the answer has two dimensions — day of week and time of day —
 * that a time series flattens into noise. Sequential single hue, light to
 * dark, because the cells encode one measure at different magnitudes.
 *
 * It earns its place by being directly actionable in a way most analytics
 * are not: a landlord who knows their traffic peaks on Sunday evening knows
 * when to be at their phone, and a student who gets an answer that same
 * evening is a student who has not already signed somewhere else.
 */

import type { BrowseClock } from '@/lib/listingFunnel'
import { C, HEAT_RAMP, rampStep } from './theme'

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BLOCKS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p']
const BLOCK_FULL = ['midnight–3am', '3–6am', '6–9am', '9am–noon', 'noon–3pm', '3–6pm', '6–9pm', '9pm–midnight']

export default function BrowseClockPanel({ clock, windowDays }: { clock: BrowseClock; windowDays: number }) {
  if (!clock.readable) {
    return (
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
        {clock.total === 0
          ? `No visits in the last ${windowDays} days, so there is no pattern to read yet.`
          : `Only ${clock.total} visits in the last ${windowDays} days — too few to tell a Sunday evening from a Tuesday morning. Check back once you are past 40.`}
      </div>
    )
  }

  const byCell = new Map(clock.cells.map(c => [`${c.dow}:${Math.floor(c.hour / 3)}`, c.views]))
  const peak = Math.max(...clock.cells.map(c => c.views))

  return (
    <div>
      <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.6, marginBottom: 12 }}>
        Busiest: <strong style={{ color: C.ink }}>{clock.peakLabel}</strong>.{' '}
        {clock.eveningPct >= 45
          ? `${clock.eveningPct}% of your visits come after 6pm — a reply that same evening reaches people while they are still comparing.`
          : `${clock.eveningPct}% of visits are after 6pm, ${clock.weekendPct}% at the weekend.`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(8, 1fr)', gap: 3, alignItems: 'center' }}>
        <div />
        {BLOCKS.map(b => (
          <div key={b} style={{ fontSize: 9, color: C.muted, textAlign: 'center' }}>{b}</div>
        ))}
        {DOW_SHORT.map((label, dow) => (
          <Row key={label} label={label} dow={dow} byCell={byCell} peak={peak} />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10.5, color: C.muted }}>
        <span>Quiet</span>
        {HEAT_RAMP.map(c => (
          <span key={c} style={{ width: 16, height: 9, background: c, borderRadius: 2, display: 'inline-block' }} />
        ))}
        <span>Busy</span>
        <span style={{ marginLeft: 'auto' }}>Phoenix time · {clock.total} visits</span>
      </div>
    </div>
  )
}

function Row({ label, dow, byCell, peak }: {
  label: string; dow: number; byCell: Map<string, number>; peak: number
}) {
  return (
    <>
      <div style={{ fontSize: 10, color: C.muted, paddingRight: 4, textAlign: 'right' }}>{label}</div>
      {BLOCKS.map((_, block) => {
        const v = byCell.get(`${dow}:${block}`) ?? 0
        return (
          <div
            key={block}
            title={`${label} ${BLOCK_FULL[block]} — ${v} visit${v === 1 ? '' : 's'}`}
            style={{
              height: 17, borderRadius: 3,
              background: rampStep(HEAT_RAMP, peak > 0 ? v / peak : 0),
              border: v > 0 ? 'none' : `1px solid ${C.faint}`,
            }}
          />
        )
      })}
    </>
  )
}
