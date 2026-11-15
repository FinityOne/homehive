'use client'

/**
 * One series over time — as bars or as a smooth curve — with a dark hover card.
 *
 * ── Two shapes, and when each one is honest ────────────────────────────────
 *
 * `shape="bars"` draws one column per point. `shape="area"` draws a smooth
 * curve. The choice is not taste — it is whether interpolating between two
 * points means anything.
 *
 * Enquiries arrive one at a time, so a 30-day window is a series of 0s, 1s and
 * 2s. Drawn as a curve that is a comb: a smooth climb from Tuesday's 0 to
 * Wednesday's 1 and back down, which draws half an enquiry at midday on a day
 * nothing happened, repeated thirty times. Nobody can read a trend off it, and
 * the shape it does show is an artefact of the interpolation. Daily counts get
 * bars, where a 0 is an absence and a 1 is one thing.
 *
 * Aggregate a window into weeks and the opposite is true: a weekly total is a
 * sample of a rate that really was continuous, the values are large enough to
 * have a shape, and the curve between two weeks is a fair claim about the days
 * inside them. Thirteen weeks get the area.
 *
 * ── Why it is drawn at measured pixel size ─────────────────────────────────
 *
 * It takes its width and height from the box it is given (see `useSize`) and
 * draws into a viewBox of exactly those pixels, rather than scaling a fixed
 * one to fit. On the deck a pane is handed whatever height is left over, so a
 * chart whose height followed its width would either overflow the pane or
 * leave a band of dead space under it — and a stretched viewBox turns the
 * hover dot into an ellipse and the axis labels into mush.
 *
 * ── Why the curve is clamped ───────────────────────────────────────────────
 *
 * The smoothing is a Catmull-Rom spline with the control points clamped so the
 * curve cannot overshoot its own data. An unclamped spline through a zero day
 * dips *below* zero on the way in and out, which draws a negative number of
 * enquiries — the chart would be lying in exactly the place a landlord is most
 * anxious. The clamp costs a little elegance on sharp spikes and buys the
 * guarantee that nothing drawn is outside the range of what happened.
 */

import { useId, useState } from 'react'
import { useSize } from './useSize'

export type TrendPoint = {
  /** Axis label — short, and not drawn for every point. */
  label: string
  /** The hover card's heading. */
  longLabel: string
  value: number
}

/**
 * A smooth path through the points that never leaves their own range.
 *
 * Each control point is pulled toward the segment it belongs to by a sixth of
 * the neighbouring slope, then clamped to the two y-values it sits between.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`

  const clamp = (v: number, a: number, b: number) =>
    Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b))

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6, p1.y, p2.y)
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6, p1.y, p2.y)
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

export default function TrendArea({
  points, unit, shape = 'area', format = (n: number) => String(n),
}: {
  points: TrendPoint[]
  /** Singular noun for the hover card — "lead", "view". */
  unit: string
  /** See the note at the top: counts get bars, rates get the curve. */
  shape?: 'area' | 'bars'
  format?: (n: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Gradients are referenced by id, and two of these on one page would share
  // the first one's fill. The id has to be per-instance.
  const gid = useId().replace(/:/g, '')
  const [box, { w: W, h: H }] = useSize<HTMLDivElement>()

  const n = points.length

  const padL = 34, padR = 14, padT = 16, padB = 26
  const innerW = W - padL - padR, innerH = H - padT - padB
  // Below this there is no plot left to draw into, only axis furniture.
  const drawable = n > 0 && innerW > 40 && innerH > 40

  const peak = drawable ? Math.max(...points.map(p => p.value)) : 0
  // A friendly ceiling, so the axis reads 0 / 10 / 20 rather than 0 / 7 / 14.
  //
  // The floor of 2 is not cosmetic. Enquiries arrive one at a time, so a quiet
  // month is a series of 0s and 1s, and a ceiling of 1 draws every single
  // enquiry as a spike from the floor to the top of the panel — a chart that
  // looks identical whether one lead came in or fifty. Two is the smallest
  // ceiling that leaves a 1 reading as a small number.
  const ceiling = Math.max(2, peak <= 4 ? peak : Math.ceil(peak / 4) * 4)

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / ceiling) * innerH

  const pts = drawable ? points.map((p, i) => ({ x: x(i), y: y(p.value) })) : []
  const line = smoothPath(pts)
  const area = drawable
    ? `${line} L ${x(n - 1).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`
    : ''

  // Deduped: an odd ceiling rounds its midpoint onto one of the ends, and two
  // gridlines at the same height is a double-drawn line and a duplicate key.
  const ticks = [...new Set([0, 0.5, 1].map(t => Math.round(ceiling * t)))]
  // Labels are spaced by the room actually available, not by the point count:
  // the same thirty days needs one label in six on a phone and one in four on
  // a monitor.
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 90))))
  const hovered = hover !== null ? points[hover] : null
  const band = n > 1 ? innerW / (n - 1) : innerW
  // Bars sit in their own evenly divided slots rather than on the line's
  // points, so the first and last are fully inside the plot instead of half
  // outside it. Capped, because six bars across a wide pane are slabs.
  const slot = innerW / Math.max(1, n)
  const barW = Math.min(26, Math.max(2, slot - Math.min(6, slot * 0.3)))
  const barX = (i: number) => padL + slot * i + (slot - barW) / 2
  const radius = Math.min(4, barW / 2)

  // Nudged inward at the ends so the card cannot hang off the side of the
  // pane — at the first and last point especially, where a centred card would
  // be half outside the frame.
  const tipAt = hover === null ? 0 : shape === 'bars' ? barX(hover) + barW / 2 : x(hover)
  const tipX = hover === null ? 0 : Math.min(Math.max(tipAt, 90), Math.max(90, W - 90))

  return (
    <div className="ta" ref={box}>
      {drawable && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="ta-svg"
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`${points.reduce((s, p) => s + p.value, 0)} ${unit}s over ${n} periods`}
        >
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#0f7a43" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#0f7a43" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map(v => (
            <g key={v}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f0f0f2" strokeWidth="1" />
              <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="#8e8e93">{v}</text>
            </g>
          ))}

          {shape === 'area' ? (
            <>
              <path d={area} fill={`url(#fill-${gid})`} />
              <path d={line} fill="none" stroke="#0f7a43" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && (
                <g>
                  <line
                    x1={x(hover)} y1={padT} x2={x(hover)} y2={y(0)}
                    stroke="#0f7a43" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
                  />
                  <circle cx={x(hover)} cy={y(points[hover].value)} r="5" fill="#0f7a43" stroke="#fff" strokeWidth="2.5" />
                </g>
              )}
            </>
          ) : (
            points.map((p, i) => {
              if (p.value <= 0) return null
              const top = y(p.value)
              const h = Math.max(2, y(0) - top)
              const r = Math.min(radius, h)
              // Rounded at the data end only: `rx` rounds all four corners,
              // which lifts a bar off its own baseline, and the value a bar
              // encodes is its distance from that baseline.
              const d = `M ${barX(i)} ${y(0)} L ${barX(i)} ${top + r} ` +
                `Q ${barX(i)} ${top} ${barX(i) + r} ${top} ` +
                `L ${barX(i) + barW - r} ${top} Q ${barX(i) + barW} ${top} ${barX(i) + barW} ${top + r} ` +
                `L ${barX(i) + barW} ${y(0)} Z`
              return (
                <path key={`b-${i}`} d={d}
                  fill={hover === i ? '#0f7a43' : 'rgba(15,122,67,0.55)'} />
              )
            })
          )}

          {/* One invisible band per point, so the whole column is a hover
              target rather than a 5px mark the mouse has to find. */}
          {points.map((p, i) => (
            <rect
              key={i}
              x={shape === 'bars' ? padL + slot * i : x(i) - band / 2}
              y={padT}
              width={shape === 'bars' ? slot : band}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {points.map((p, i) => (
            // The last point always gets a label — it is the one a landlord
            // looks for — but only when it is not about to land on top of the
            // previous one. "Nov 7 Nov 8" overprinted is worse than no Nov 8.
            i % labelEvery === 0 || (i === n - 1 && (n - 1) % labelEvery >= labelEvery / 2)
              ? <text
                  key={`l-${i}`}
                  x={shape === 'bars' ? barX(i) + barW / 2 : x(i)}
                  y={H - 7} textAnchor="middle" fontSize="10.5" fill="#8e8e93"
                >{p.label}</text>
              : null
          ))}
        </svg>
      )}

      {hovered && (
        <span className="ta-tip" style={{ left: tipX }} role="status">
          <b>{hovered.longLabel}</b>
          <span className="ta-tip-row">
            <span>{hovered.value === 1 ? unit : `${unit}s`}</span>
            <em>{format(hovered.value)}</em>
          </span>
        </span>
      )}
    </div>
  )
}

export const TREND_AREA_CSS = `
  /* Fills whatever the pane gives it; the SVG inside is drawn at exactly that
     many pixels, so nothing is ever scaled. min-height 0 is what lets it
     shrink inside a grid row rather than forcing the row open. */
  /* Fills what the pane gives it, up to a point: a series of 0s and 1s
     stretched over 600px is 500px of white and a row of hairlines. Past the
     cap the pane spends the height on the reading strip underneath instead. */
  .fin .ta { position: relative; flex: 1; min-height: 0; max-height: 360px; width: 100%; }
  .fin .ta-svg { display: block; }
  .fin .ta-tip {
    position: absolute; top: 4px; transform: translateX(-50%);
    background: #16191c; color: #fff; border-radius: 11px; padding: 9px 13px;
    min-width: 150px; pointer-events: none; z-index: 4;
    box-shadow: 0 10px 26px rgba(0,0,0,0.22); text-align: left;
  }
  .fin .ta-tip b { display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; }
  .fin .ta-tip-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    font-size: 11.5px; color: rgba(255,255,255,0.72); line-height: 1.6;
  }
  .fin .ta-tip-row em {
    font-style: normal; color: #fff; font-weight: 600; font-variant-numeric: tabular-nums;
  }
`
