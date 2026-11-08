'use client'

/**
 * One smooth series over time, with a crosshair and a dark hover card.
 *
 * ── Why a line and not bars ────────────────────────────────────────────────
 *
 * The overview already has a bar chart — collection, one column per month,
 * where each column is a discrete thing you can click into. Enquiries are not
 * that. They are a continuous arrival rate, and the only question a landlord
 * asks of them is about the *shape*: is it rising, did it fall off a cliff the
 * week the photos changed, is the quiet stretch three days or three weeks. A
 * line answers that at a glance; thirty bars make the reader integrate it.
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
 * Each control point is pulled toward the segment it belongs to by a third of
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
  points, unit, format = (n: number) => String(n),
}: {
  points: TrendPoint[]
  /** Singular noun for the hover card — "lead", "view". */
  unit: string
  format?: (n: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Gradients are referenced by id, and two of these on one page would share
  // the first one's fill. The id has to be per-instance.
  const gid = useId().replace(/:/g, '')

  const n = points.length
  if (n === 0) return null

  const W = 760, H = 220
  const padL = 34, padR = 14, padT = 16, padB = 28
  const innerW = W - padL - padR, innerH = H - padT - padB

  const peak = Math.max(...points.map(p => p.value))
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

  const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }))
  const line = smoothPath(pts)
  const area = `${line} L ${x(n - 1).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`

  // Deduped: an odd ceiling rounds its midpoint onto one of the ends, and two
  // gridlines at the same height is a double-drawn line and a duplicate key.
  const ticks = [...new Set([0, 0.5, 1].map(t => Math.round(ceiling * t)))]
  const labelEvery = Math.max(1, Math.ceil(n / 7))
  const hovered = hover !== null ? points[hover] : null

  // The card is 170px wide and is nudged inward at the ends so it cannot hang
  // off the side of the panel — at the first and last point especially, where
  // a centred card would be half outside the frame.
  const tipX = hover === null ? 0 : Math.min(Math.max(x(hover), padL + 86), W - padR - 86)

  return (
    <div className="ta">
      <svg
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
            <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#8e8e93">{v}</text>
          </g>
        ))}

        <path d={area} fill={`url(#fill-${gid})`} />
        <path d={line} fill="none" stroke="#0f7a43" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && (
          <g>
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={y(0)} stroke="#0f7a43" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="5" fill="#0f7a43" stroke="#fff" strokeWidth="2.5" />
          </g>
        )}

        {/* One invisible band per point, so the whole column is a hover target
            rather than a 5px dot the mouse has to find. */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={x(i) - innerW / Math.max(1, n - 1) / 2}
            y={padT}
            width={innerW / Math.max(1, n - 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {points.map((p, i) => (
          i % labelEvery === 0 || i === n - 1
            ? <text key={`l-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#8e8e93">{p.label}</text>
            : null
        ))}
      </svg>

      {hovered && (
        <span className="ta-tip" style={{ left: `${(tipX / W) * 100}%` }} role="status">
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
  .fin .ta { position: relative; width: 100%; }
  /* Scaled uniformly, like every other chart in the app: stretching the
     viewBox to a fixed height would squash the hover dot into an ellipse and
     the axis labels along with it. */
  .fin .ta-svg { width: 100%; height: auto; display: block; }
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
