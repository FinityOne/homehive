'use client'

/**
 * The charts the money area draws, and nothing else.
 *
 * ── Why these are hand-built ───────────────────────────────────────────────
 *
 * No charting library. Three bar charts and a line do not justify 90KB on
 * every load of a page a landlord opens from their phone while standing
 * outside a building — the same reason `LeadsTrendChart` and the listing
 * sparkline are hand-rolled.
 *
 * ── The rules these obey ───────────────────────────────────────────────────
 *
 * The palette is the money area's own (`src/lib/financeTheme.ts`), because a
 * green bar and a green badge on the same screen must be the same green.
 * Within that:
 *
 *   • **One axis, ever.** Billed-against-collected is money, so it is bars.
 *     The collection *rate* is a percentage, so it is a second chart underneath
 *     sharing the same months — never a second y-scale on the first one. Two
 *     scales on one frame is the single most misread chart there is: it lets
 *     the author choose where the lines cross.
 *   • **Status colour keeps its meaning.** Green is money received, the late
 *     ramp is money overdue. Neither is ever "series two".
 *   • **Age is magnitude, so it is one hue stepped light→dark** — not four
 *     unrelated colours. The ramp is validated for monotone lightness and for
 *     clearing the surface at its light end.
 *   • **Identity is never colour alone.** Every series is in the legend, every
 *     bar carries its own label, and the method mix is a labelled list rather
 *     than a stacked bar precisely because four payment routes cannot be told
 *     apart by colour at the width this renders at.
 *   • **Hover is part of the chart, not a nicety.** A bar a landlord cannot
 *     interrogate is a bar they have to take on trust.
 */

import { useId, useState } from 'react'
import { fmtCurrency } from '@/lib/payments'
import { METHOD_META, type MethodSlice } from '@/lib/financialsRollup'
import type { TrendPoint, AgingBucket } from '@/lib/financialsDashboard'
import type { ForecastWeek } from '@/lib/financialsForecast'
import type { UpcomingMonth } from '@/lib/financialsMonth'

/**
 * The narrowest a bar column is allowed to get, in pixels.
 *
 * Below roughly this, two things break at once: the bar itself becomes a
 * hairline that cannot be compared by eye, and the month or date under it
 * overlaps its neighbours. Twelve months in a phone-width card works out at
 * 26px a column, which is well past both. So the plots keep this floor and
 * scroll sideways when the card cannot afford it — a gesture is a much smaller
 * cost than an unreadable chart.
 */
const MIN_COL = 44

/** Money, short, for an axis or a bar cap. `$12.4k`, `$940`. */
export function shortMoney(n: number): string {
  if (n === 0) return '$0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  return `$${Math.round(n)}`
}

// ─── TOOLTIP ─────────────────────────────────────────────────────────────────

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string }[] } | null

/** The hover card every chart here shares, so a bar reads the same everywhere. */
function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return (
    <div className="viz-tip" style={{ left: `${tip.x}%`, top: tip.y }} aria-hidden="true">
      <div className="viz-tip-t">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="viz-tip-r">
          <span>{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  )
}

// ─── COLLECTED AGAINST BILLED ────────────────────────────────────────────────

/**
 * A year of rent: what was asked for, and what arrived.
 *
 * Two marks per month, overlapping rather than side by side — the billed amount
 * is the track and the collected amount fills it. A landlord reading this is
 * asking "did that month fill up", and a pair of adjacent bars makes that a
 * comparison instead of a glance. The surface ring between them is what keeps
 * the overlap legible when a month is nearly full.
 *
 * Future months are drawn as outlines: nothing can have arrived yet, and a
 * month showing an empty bar would read as a collection failure.
 */
export function TrendBars({
  points, selected, onSelect,
}: {
  points: TrendPoint[]
  selected?: string
  onSelect?: (key: string) => void
}) {
  const [tip, setTip] = useState<Tip>(null)
  const tableId = useId()
  const peak = Math.max(1, ...points.map(p => Math.max(p.billed, p.collected)))

  return (
    <div className="viz">
      <div className="viz-legend">
        <span className="viz-key"><i className="viz-sw billed" />Billed</span>
        <span className="viz-key"><i className="viz-sw collected" />Collected</span>
        <span className="viz-note">
          peak {shortMoney(peak)} · {points.length} months to {points[points.length - 1]?.label}
        </span>
      </div>

      {/* A floor on column width, and a scroll when the card is narrower than
          that floor needs. Twelve months in a phone-width card is 26px per
          column — the bars become hairlines and the month labels overlap into
          mush. Below the floor this scrolls sideways instead of compressing,
          which keeps every bar readable at the cost of a gesture. On a desktop
          card the columns are wider than the floor and nothing scrolls. */}
      <div className="viz-scroll">
      <div
        className="viz-plot bars"
        style={{ minWidth: points.length * MIN_COL }}
        onMouseLeave={() => setTip(null)}
      >
        {/* A recessive baseline and a midline: enough to judge a height
            against, not a grid to read values off. Values come from hover. */}
        <span className="viz-grid mid" aria-hidden="true" />
        <span className="viz-grid base" aria-hidden="true" />

        {points.map((p, i) => {
          const bh = Math.round((p.billed / peak) * 100)
          const ch = Math.round((p.collected / peak) * 100)
          const Cmp = onSelect ? 'button' : 'div'
          return (
            <Cmp
              key={p.key}
              className={`viz-col${p.position === 'future' ? ' ahead' : ''}${
                p.key === selected ? ' on' : ''}${p.position === 'current' ? ' now' : ''}`}
              {...(onSelect
                ? { onClick: () => onSelect(p.key), type: 'button' as const }
                : {})}
              aria-label={`${p.longLabel}: ${fmtCurrency(p.collected)} collected of ${fmtCurrency(p.billed)} billed${
                p.rate !== null ? `, ${p.rate}%` : ''}`}
              onMouseEnter={() => setTip({
                x: ((i + 0.5) / points.length) * 100,
                y: 6,
                title: p.longLabel,
                rows: [
                  { label: 'Billed', value: fmtCurrency(p.billed) },
                  { label: 'Collected', value: fmtCurrency(p.collected) },
                  ...(p.feesCollected > 0
                    ? [{ label: 'Late fees in', value: fmtCurrency(p.feesCollected) }] : []),
                  ...(p.stillDue > 0
                    ? [{ label: 'Still due', value: fmtCurrency(p.stillDue) }] : []),
                  ...(p.rate !== null ? [{ label: 'Rate', value: `${p.rate}%` }] : []),
                  ...(p.arrivedLate > 0
                    ? [{ label: 'Arrived late', value: `${p.arrivedLate} of ${p.onTime + p.arrivedLate}` }] : []),
                ],
              })}
            >
              <span className="viz-stack">
                <span className="viz-bar billed" style={{ height: `${bh}%` }} />
                {ch > 0 && <span className="viz-bar collected" style={{ height: `${ch}%` }} />}
              </span>
              <span className="viz-x">
                {p.label}
                {/* The year only where it turns over, so January is placed
                    without repeating 2026 twelve times. */}
                {(i === 0 || p.key.endsWith('-01')) && <em>{String(p.year).slice(2)}</em>}
              </span>
            </Cmp>
          )
        })}

        <Tooltip tip={tip} />
      </div>
      </div>

      {/* Colour is never the only way to read this. */}
      <table className="viz-table" id={tableId}>
        <caption>Rent billed and collected by month</caption>
        <thead><tr><th>Month</th><th>Billed</th><th>Collected</th><th>Rate</th></tr></thead>
        <tbody>
          {points.map(p => (
            <tr key={p.key}>
              <th scope="row">{p.longLabel}</th>
              <td>{fmtCurrency(p.billed)}</td>
              <td>{fmtCurrency(p.collected)}</td>
              <td>{p.rate !== null ? `${p.rate}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── COLLECTION RATE ─────────────────────────────────────────────────────────

/**
 * The same months as a percentage — its own chart, because its own unit.
 *
 * One series, so no legend: the heading names it. The dashed line at 100% is
 * the only reference that matters; a month below it left money uncollected.
 * Future months are dropped rather than drawn at 0%, which would read as a
 * catastrophe rather than as "not yet".
 */
export function RateLine({ points }: { points: TrendPoint[] }) {
  const [tip, setTip] = useState<Tip>(null)
  const live = points.filter(p => p.position !== 'future' && p.rate !== null)
  if (live.length < 2) return null

  const W = 600, H = 96, PAD = 10
  // Fixed 0–100 scale: a rate chart that rescales to its own worst month makes
  // a good year and a bad one look identical.
  const x = (i: number) => PAD + (i / (live.length - 1)) * (W - PAD * 2)
  const y = (r: number) => H - PAD - (Math.min(100, r) / 100) * (H - PAD * 2)
  const pts = live.map((p, i) => `${x(i).toFixed(1)},${y(p.rate!).toFixed(1)}`)
  const avg = Math.round(live.reduce((n, p) => n + (p.rate ?? 0), 0) / live.length)

  return (
    <div className="viz rate">
      <div className="viz-legend">
        <span className="viz-note">
          averaging <b>{avg}%</b> over {live.length} months · dashed line is full collection
        </span>
      </div>
      <div
        className="viz-plot line"
        role="img"
        aria-label={`Collection rate by month, averaging ${avg}%, from ${live[0].longLabel} to ${live[live.length - 1].longLabel}`}
        onMouseLeave={() => setTip(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1={0} x2={W} y1={y(100)} y2={y(100)}
                stroke="var(--line)" strokeWidth="1" strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke" />
          <polyline points={pts.join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth="2"
                    strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* The markers live in CSS, not in the SVG above.
            The plot is stretched to the card's width while its height is
            fixed, so the viewBox is scaled unevenly — and anything circular
            inside it comes out as an ellipse. Positioning them as elements
            keeps them round at any width, and gives each one a hit target
            bigger than the dot, which is what makes this usable with a
            thumb. */}
        <div className="viz-hits">
          {live.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className="viz-hit"
              // Anchored on the vertex the line actually passes through, not
              // on the middle of an evenly-divided slot — the first and last
              // points sit on the edges of the plot, so a flex row of equal
              // slots would put every dot half a segment adrift of its line.
              style={{
                left: `${(x(i) / W) * 100}%`,
                width: `${Math.max(100 / live.length, 8)}%`,
              }}
              aria-label={`${p.longLabel}: ${p.rate}% collected`}
              onMouseEnter={() => setTip({
                x: ((i + 0.5) / live.length) * 100,
                y: 2,
                title: p.longLabel,
                rows: [
                  { label: 'Collected', value: `${p.rate}%` },
                  { label: 'Of billed', value: fmtCurrency(p.billed) },
                  ...(p.stillDue > 0 ? [{ label: 'Still due', value: fmtCurrency(p.stillDue) }] : []),
                ],
              })}
            >
              <span
                // A month that fell short wears the late tone; a full month is
                // the green of money received.
                className={`viz-dot ${p.rate! >= 100 ? 'in' : 'late'}`}
                style={{ top: `${(y(p.rate!) / H) * 100}%` }}
              />
            </button>
          ))}
        </div>
        <Tooltip tip={tip} />
      </div>
      <div className="viz-xs">
        {live.map(p => <span key={p.key}>{p.label}</span>)}
      </div>
    </div>
  )
}

// ─── AGING ───────────────────────────────────────────────────────────────────

/**
 * Arrears by how old they are — one bar, then the buckets as rows.
 *
 * Age is magnitude, so the four steps are one hue stepped light→dark rather
 * than four colours competing for meaning. The rows underneath are the real
 * content: each one says what that age *means for what to do next*, which is
 * the only reason to split a debt by age in the first place.
 */
export function AgingChart({
  buckets, onSelect,
}: {
  buckets: AgingBucket[]
  onSelect?: (id: AgingBucket['id']) => void
}) {
  const live = buckets.filter(b => b.amount > 0)
  const total = buckets.reduce((n, b) => n + b.amount, 0)
  if (total <= 0) return null

  return (
    <div className="viz aging">
      <div className="viz-stackbar" role="img"
           aria-label={`${fmtCurrency(total)} overdue, split by age: ${
             live.map(b => `${b.label} ${fmtCurrency(b.amount)}`).join(', ')}`}>
        {live.map(b => (
          <span
            key={b.id}
            className={`viz-seg age-${b.id}`}
            style={{ flexGrow: b.amount }}
            title={`${b.label} — ${fmtCurrency(b.amount)}`}
          />
        ))}
      </div>

      <div className="age-rows">
        {buckets.map(b => {
          const pct = total > 0 ? Math.round((b.amount / total) * 100) : 0
          const Cmp = onSelect && b.amount > 0 ? 'button' : 'div'
          return (
            <Cmp
              key={b.id}
              className={`age-row${b.amount > 0 ? '' : ' nil'}`}
              {...(onSelect && b.amount > 0
                ? { type: 'button' as const, onClick: () => onSelect(b.id) }
                : {})}
            >
              <span className={`age-dot age-${b.id}`} aria-hidden="true" />
              <span className="age-lbl">
                {b.label}
                <em>{b.amount > 0 ? b.hint : 'nothing at this age'}</em>
              </span>
              <span className="age-fig">
                <b className="num">{b.amount > 0 ? fmtCurrency(b.amount) : '—'}</b>
                <em>
                  {b.amount > 0
                    ? `${pct}% · ${b.payerCount} ${b.payerCount === 1 ? 'person' : 'people'}`
                    : ''}
                </em>
              </span>
              {onSelect && b.amount > 0 && <span className="row-chev" aria-hidden="true" />}
            </Cmp>
          )
        })}
      </div>
    </div>
  )
}

// ─── HOW THE MONEY ARRIVES ───────────────────────────────────────────────────

/**
 * Payment routes as a labelled list, deliberately not a stacked bar.
 *
 * Four routes cannot be told apart by colour in a 300px-wide stack — the chips
 * this product already uses for card, ACH, Zelle and manual fail every
 * colour-blind separation test when they sit edge to edge. So identity comes
 * from the chip and the words, and magnitude from a bar of its own per row,
 * which has no adjacency problem at all.
 *
 * It matters beyond aesthetics: the share arriving by bank transfer is the
 * share that spends days in flight, which is why the clearing figure rides on
 * the row rather than in a footnote.
 */
export function MethodMix({ slices }: { slices: MethodSlice[] }) {
  const total = slices.reduce((n, s) => n + s.amount, 0)
  if (total <= 0) return null
  const peak = Math.max(...slices.map(s => s.amount))

  return (
    <div className="mix">
      {slices.map(s => {
        const meta = METHOD_META[s.method]
        const pct = Math.round((s.amount / total) * 100)
        return (
          <div key={s.method} className="mix-row">
            <span className="mix-chip" style={{ background: meta.bg, color: meta.color }}>
              {meta.label}
            </span>
            <span className="mix-track">
              <span
                className="mix-fill"
                style={{ width: `${Math.max(2, (s.amount / peak) * 100)}%`, background: meta.color }}
              />
            </span>
            <span className="mix-fig">
              <b className="num">{fmtCurrency(s.amount)}</b>
              <em>
                {pct}% · {s.count} payment{s.count !== 1 ? 's' : ''}
                {s.clearing > 0 && <> · {fmtCurrency(s.clearing)} clearing</>}
              </em>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── WHAT IS COMING ──────────────────────────────────────────────────────────

/**
 * The months ahead as a strip — click one to point the schedule at it.
 *
 * `expected` is not "billed": a tenant who pays December early makes December's
 * bar shorter, which is exactly the signal a landlord wants. The green foot is
 * what has already been paid into that month.
 */
export function AheadStrip({
  months, selected, thisMonth, onSelect,
}: {
  months: UpcomingMonth[]
  selected?: string
  thisMonth: string
  onSelect: (key: string) => void
}) {
  const [tip, setTip] = useState<Tip>(null)
  const peak = Math.max(1, ...months.map(m => Math.max(m.expected, m.paid)))

  return (
    <div className="viz">
      <div className="viz-legend">
        <span className="viz-key"><i className="viz-sw due" />Still expected</span>
        <span className="viz-key"><i className="viz-sw collected" />Already paid in</span>
      </div>
      <div className="viz-scroll">
      <div
        className="viz-plot bars ahead"
        // Wider than the bar floor: each column here carries a money cap above
        // the bar as well as a label under it.
        style={{ minWidth: months.length * 62 }}
        onMouseLeave={() => setTip(null)}
      >
        <span className="viz-grid base" aria-hidden="true" />
        {months.map((m, i) => (
          <button
            key={m.key}
            type="button"
            className={`viz-col${m.key === selected ? ' on' : ''}${m.key === thisMonth ? ' now' : ''}`}
            onClick={() => onSelect(m.key)}
            aria-label={`${m.label}: ${fmtCurrency(m.expected)} still expected of ${fmtCurrency(m.billed)} billed`}
            onMouseEnter={() => setTip({
              x: ((i + 0.5) / months.length) * 100,
              y: 6,
              title: m.label,
              rows: [
                { label: 'Billed', value: fmtCurrency(m.billed) },
                { label: 'Still expected', value: fmtCurrency(m.expected) },
                ...(m.paid > 0 ? [{ label: 'Paid in already', value: fmtCurrency(m.paid) }] : []),
                ...(m.feesDue > 0 ? [{ label: 'Of which fees', value: fmtCurrency(m.feesDue) }] : []),
                ...(m.overdueCount > 0 ? [{ label: 'Past due', value: `${m.overdueCount} charges` }] : []),
              ],
            })}
          >
            <span className="viz-cap num">{m.expected > 0 ? shortMoney(m.expected) : '—'}</span>
            <span className="viz-stack">
              <span className="viz-bar due" style={{ height: `${Math.round((m.expected / peak) * 100)}%` }} />
              {m.paid > 0 && (
                <span className="viz-bar collected" style={{ height: `${Math.round((m.paid / peak) * 100)}%` }} />
              )}
            </span>
            <span className="viz-x">
              {m.shortLabel.split(' ')[0]}
              {m.key === thisMonth && <em className="is-now">now</em>}
            </span>
            {m.overdueCount > 0 && <span className="viz-flag">{m.overdueCount} late</span>}
          </button>
        ))}
        <Tooltip tip={tip} />
      </div>
      </div>
    </div>
  )
}

// ─── METERS ──────────────────────────────────────────────────────────────────

/**
 * A single rate, as a figure with a bar under it.
 *
 * Not a donut and not a gauge: a part-of-whole with one part is a number, and
 * the bar is there only so a glance can tell 94% from 62% without reading.
 */
export function Meter({
  pct, tone = 'auto', target,
}: {
  pct: number | null
  /** `auto` greens anything at or above the target and reds the rest. */
  tone?: 'auto' | 'good' | 'bad' | 'neutral'
  target?: number
}) {
  if (pct === null) return <div className="meter nil" aria-hidden="true" />
  const t = target ?? 100
  const resolved = tone === 'auto' ? (pct >= t ? 'good' : pct >= t - 10 ? 'warn' : 'bad') : tone
  return (
    <div className="meter" role="img" aria-label={`${pct}%`}>
      <span className={`meter-fill ${resolved}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      {target !== undefined && target < 100 && (
        <span className="meter-mark" style={{ left: `${target}%` }} title={`target ${target}%`} />
      )}
    </div>
  )
}

/** A term or contract progress bar with a marker for where time has got to. */
export function ProgressBar({
  pct, markAt, label,
}: {
  pct: number
  /** Where the term has reached, if known — the comparison that matters. */
  markAt?: number | null
  label?: string
}) {
  return (
    <div className="pbar2" role="img" aria-label={label ?? `${pct}%`}>
      <span className="pbar2-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      {markAt != null && (
        <span className="pbar2-mark" style={{ left: `${Math.min(100, Math.max(0, markAt))}%` }}
              title={`${markAt}% through the term`} />
      )}
    </div>
  )
}

// ─── SPARKLINE ───────────────────────────────────────────────────────────────

/**
 * Twelve months of one measure, inside a KPI tile.
 *
 * A single big number says where you are and nothing about where you came
 * from, which is the difference between a figure and a fact. This is the
 * cheapest possible fix: no axes, no labels, no interaction — shape only. It
 * is never the sole carrier of anything, because the tile states the current
 * value in words right above it.
 */
export function Sparkline({
  values, tone = 'ink', height = 26,
}: {
  values: number[]
  tone?: 'ink' | 'good' | 'bad' | 'warn'
  height?: number
}) {
  const live = values.filter(v => Number.isFinite(v))
  if (live.length < 3) return null

  const W = 100, H = 30, PAD = 3
  const max = Math.max(...live)
  const min = Math.min(...live)
  const span = max - min || 1
  const x = (i: number) => (i / (live.length - 1)) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const pts = live.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  const tint =
    tone === 'good' ? 'var(--in)' : tone === 'bad' ? 'var(--late)'
    : tone === 'warn' ? 'var(--fee)' : 'var(--ink-3)'
  const last = live.length - 1

  return (
    <div
      className="spark2"
      style={{ height }}
      role="img"
      aria-label={`Trend over the last ${live.length} months`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill={tint} opacity="0.08" />
        <polyline
          points={pts.join(' ')} fill="none" stroke={tint} strokeWidth="1.6"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The latest point, so "now" is locatable on a 100px line.
          Positioned in CSS rather than drawn in the SVG: the plot is stretched
          to the tile's width, and anything circular inside a stretched viewBox
          comes out an ellipse. */}
      <span
        className="spark2-dot"
        style={{
          left: `${(x(last) / W) * 100}%`,
          top: `${(y(live[last]) / H) * 100}%`,
          background: tint,
        }}
      />
    </div>
  )
}

// ─── DELTA ───────────────────────────────────────────────────────────────────

/**
 * A change, with its direction — and only where one honestly exists.
 *
 * Deliberately narrow. Nothing in this product snapshots a portfolio, so there
 * is no truthful "arrears up 8% this week" to show, and the component is not
 * able to render one: it takes a signed number and a basis it must name. If a
 * caller has no basis, there is no chip, which is the correct outcome rather
 * than a missing feature.
 *
 * `goodWhen` exists because direction is not meaning. A rising collection rate
 * is good; a rising number of days late is not.
 */
export function Delta({
  value, unit = 'pts', basis, goodWhen = 'up',
}: {
  value: number | null
  unit?: 'pts' | '%' | 'd'
  /** What it is a change *from*. Shown on hover, so the chip can never be a
   *  comparison the reader cannot interrogate. */
  basis: string
  goodWhen?: 'up' | 'down'
}) {
  if (value === null || value === 0) return null
  const up = value > 0
  const good = goodWhen === 'up' ? up : !up
  return (
    <span
      className={`delta ${good ? 'good' : 'bad'}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(value)}${unit} ${basis}`}
    >
      <span className="delta-arrow" aria-hidden="true">{up ? '▲' : '▼'}</span>
      {Math.abs(value)}{unit}
    </span>
  )
}

// ─── CASH FORECAST ───────────────────────────────────────────────────────────

/**
 * When the money is projected to arrive, week by week.
 *
 * Four stacked bands, each a status colour used in its reserved meaning:
 * clearing (in flight, certain), on time, slipping (the payer is reliably
 * late), and at risk (the payer is already behind). Stacking is right here
 * because the parts genuinely sum to one quantity — the cash landing that week
 * — and the question is how much of it you can count on.
 *
 * The caveat is rendered, not implied: a projection built from a tenant's own
 * history is still a projection, and existing arrears are deliberately absent
 * because nobody knows when overdue money arrives.
 */
export function ForecastBars({
  weeks, overdueUnscheduled,
}: {
  weeks: ForecastWeek[]
  overdueUnscheduled: number
}) {
  const [tip, setTip] = useState<Tip>(null)
  const peak = Math.max(1, ...weeks.map(w => w.expected + w.atRisk))
  const total = weeks.reduce((n, w) => n + w.expected, 0)
  const risk = weeks.reduce((n, w) => n + w.atRisk, 0)

  return (
    <div className="viz">
      <div className="viz-legend">
        <span className="viz-key"><i className="viz-sw clearing" />Clearing</span>
        <span className="viz-key"><i className="viz-sw ontime" />On time</span>
        <span className="viz-key"><i className="viz-sw slip" />Slipping</span>
        <span className="viz-key"><i className="viz-sw risk" />At risk</span>
        <span className="viz-note">
          <b>{fmtCurrency(total)}</b> expected over {weeks.length} weeks
        </span>
      </div>

      <div className="viz-scroll">
      <div
        className="viz-plot bars fc"
        style={{ minWidth: weeks.length * MIN_COL }}
        onMouseLeave={() => setTip(null)}
      >
        <span className="viz-grid base" aria-hidden="true" />
        {weeks.map((w, i) => {
          // Percentages are kept unrounded and stacked cumulatively. Rounding
          // each band on its own lets the errors add up, which shows as a
          // hairline gap or a 1px overlap between two bands that are supposed
          // to sit exactly on top of one another.
          const pc = (v: number) => (v / peak) * 100
          const base = pc(w.clearing)
          const afterOnTime = base + pc(w.onTime)
          const afterSlip = afterOnTime + pc(w.slipping)
          return (
            <div
              key={w.start}
              className="viz-col"
              aria-label={`${w.longLabel}: ${fmtCurrency(w.expected)} expected${
                w.atRisk > 0 ? `, ${fmtCurrency(w.atRisk)} at risk` : ''}`}
              onMouseEnter={() => setTip({
                x: ((i + 0.5) / weeks.length) * 100,
                y: 6,
                title: w.longLabel,
                rows: [
                  ...(w.clearing > 0 ? [{ label: 'Clearing now', value: fmtCurrency(w.clearing) }] : []),
                  ...(w.onTime > 0 ? [{ label: 'Due, pays on time', value: fmtCurrency(w.onTime) }] : []),
                  ...(w.slipping > 0 ? [{ label: 'Projected late', value: fmtCurrency(w.slipping) }] : []),
                  ...(w.atRisk > 0 ? [{ label: 'At risk', value: fmtCurrency(w.atRisk) }] : []),
                  { label: 'Expected', value: fmtCurrency(w.expected) },
                ],
              })}
            >
              <span className="viz-stack">
                {/* Stacked from the baseline up, with a 2px surface gap between
                    bands so two adjacent colours never merge into one block. */}
                <span className="fc-band clearing" style={{ height: `${pc(w.clearing)}%`, bottom: 0 }} />
                <span className="fc-band ontime" style={{ height: `${pc(w.onTime)}%`, bottom: `${base}%` }} />
                <span className="fc-band slip" style={{ height: `${pc(w.slipping)}%`, bottom: `${afterOnTime}%` }} />
                <span className="fc-band risk" style={{ height: `${pc(w.atRisk)}%`, bottom: `${afterSlip}%` }} />
              </span>
              <span className="viz-x">
                {/* Every other label. Thirteen dates collide even at the
                    column floor, and a week is identifiable from its
                    neighbour. */}
                {i % 2 === 0 ? w.label : ''}
              </span>
            </div>
          )
        })}
        <Tooltip tip={tip} />
      </div>
      </div>

      <p className="fc-note">
        A projection from your own tenants&rsquo; settled history — each charge is shifted by how late
        that payer usually is.
        {risk > 0 && (
          <> <b>{fmtCurrency(risk)}</b> of it is owed by someone already behind, so it is at risk
          rather than expected.</>
        )}
        {overdueUnscheduled > 0 && (
          <> The <b>{fmtCurrency(overdueUnscheduled)}</b> already overdue is <b>not</b> in this chart:
          overdue money has no arrival date, and assuming one would be the most misleading figure on
          the page.</>
        )}
      </p>
    </div>
  )
}

/**
 * The stylesheet for everything above.
 *
 * Shipped from here rather than from the theme so a page that draws no chart
 * pays nothing for them, and so the marks and their tokens are read in one
 * place. Injected after `FINANCE_THEME`, whose tokens it uses.
 */
export const VIZ_CSS = `
  /* The aging ramp: one hue, stepped light→dark, monotone in lightness and
     clearing the surface at its light end. Validated, not eyeballed — four
     unrelated colours for four ages would say the ages are unrelated. */
  .fin { --age-1: #f0a093; --age-2: #e06a57; --age-3: #c6372c; --age-4: #8f281f; }

  .fin .viz { position: relative; }
  .fin .viz-legend {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    font-size: 11.5px; color: var(--ink-3); margin-bottom: 12px; letter-spacing: -0.005em;
  }
  .fin .viz-key { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); }
  .fin .viz-sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .fin .viz-sw.billed    { background: var(--line); }
  .fin .viz-sw.collected { background: var(--in); }
  .fin .viz-sw.due       { background: var(--fee); }
  .fin .viz-note { margin-left: auto; }
  .fin .viz-note b { color: var(--ink-2); font-weight: 600; }

  /* ── Bars ─────────────────────────────────────────────────────────────── */
  /* The scroll only engages when the plot's own min-width exceeds the card.
     Momentum scrolling keeps it feeling native on a phone, and the scrollbar
     is left visible on purpose — a chart that scrolls with no indication that
     it does is a chart whose right-hand half nobody ever sees. */
  .fin .viz-scroll {
    overflow-x: auto; overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    /* Room for the scrollbar so it never sits on top of the x labels. */
    padding-bottom: 2px;
    /* A soft edge on the right, so a cut-off bar reads as "more this way". */
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 18px), rgba(0,0,0,0.25) 100%);
  }
  .fin .viz-scroll:not(:hover) { scrollbar-color: var(--line) transparent; }
  .fin .viz-plot {
    position: relative; display: flex; align-items: flex-end; gap: 2px;
  }
  .fin .viz-plot.bars { height: 170px; padding-bottom: 22px; }
  .fin .viz-plot.ahead { height: 150px; padding-bottom: 34px; }
  .fin .viz-grid {
    position: absolute; left: 0; right: 0; height: 1px; background: var(--line-2);
  }
  .fin .viz-grid.base { bottom: 22px; background: var(--line); }
  .fin .viz-plot.ahead .viz-grid.base { bottom: 34px; }
  .fin .viz-grid.mid { bottom: calc(22px + (100% - 22px) / 2); }

  .fin .viz-col {
    position: relative; flex: 1 1 0; min-width: 0;
    display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch;
    gap: 6px; background: none; border: none; padding: 0 1px;
    font-family: inherit; cursor: default; border-radius: 6px 6px 0 0;
  }
  .fin button.viz-col { cursor: pointer; }
  .fin button.viz-col:hover .viz-bar.billed { background: #dcdce2; }
  .fin .viz-col.on { background: var(--accent-bg); }
  .fin .viz-col.now .viz-x { color: var(--ink); font-weight: 600; }

  .fin .viz-stack { position: relative; display: block; height: 100%; }
  .fin .viz-bar {
    position: absolute; left: 0; right: 0; bottom: 0; display: block;
    /* 4px rounded data-end, anchored to the baseline. */
    border-radius: 4px 4px 0 0; min-height: 2px;
    transition: height 0.35s cubic-bezier(0.4,0,0.2,1), background 0.15s;
  }
  .fin .viz-bar.billed    { background: var(--line); }
  .fin .viz-bar.due       { background: var(--fee-line); }
  /* A 2px surface ring keeps the overlapping marks apart when a month is
     nearly full — without it a 98% month looks like a 100% one. */
  .fin .viz-bar.collected {
    background: var(--in); box-shadow: 0 0 0 2px var(--surface);
  }
  /* Nothing can have arrived in a future month, so it is drawn as an outline
     rather than as an empty bar, which would read as a collection failure. */
  .fin .viz-col.ahead .viz-bar.billed {
    background: repeating-linear-gradient(
      135deg, var(--line-2) 0 4px, transparent 4px 8px
    );
    border: 1px solid var(--line);
  }

  .fin .viz-x {
    position: absolute; bottom: 0; left: 0; right: 0; text-align: center;
    font-size: 10.5px; color: var(--ink-3); letter-spacing: -0.005em;
    white-space: nowrap; overflow: hidden;
  }
  .fin .viz-x em { display: block; font-style: normal; font-size: 9px; opacity: 0.75; }
  .fin .viz-x em.is-now { color: var(--accent); opacity: 1; font-weight: 600; }
  .fin .viz-cap {
    font-size: 10.5px; color: var(--ink-2); text-align: center;
    font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden;
  }
  .fin .viz-flag {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    font-size: 9.5px; color: var(--late); white-space: nowrap;
  }

  /* ── Tooltip ──────────────────────────────────────────────────────────── */
  .fin .viz-tip {
    position: absolute; transform: translateX(-50%); z-index: 5;
    background: #1d1d1f; color: #fff; border-radius: 10px; padding: 9px 12px;
    font-size: 11.5px; line-height: 1.5; min-width: 142px; pointer-events: none;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); letter-spacing: -0.005em;
  }
  .fin .viz-tip-t { font-weight: 600; margin-bottom: 4px; }
  .fin .viz-tip-r { display: flex; justify-content: space-between; gap: 14px; opacity: 0.86; }
  .fin .viz-tip-r b { font-variant-numeric: tabular-nums; font-weight: 600; opacity: 1; }

  /* ── Rate line ────────────────────────────────────────────────────────── */
  .fin .viz-plot.line { display: block; height: 104px; padding: 0; }
  .fin .viz-plot.line svg { width: 100%; height: 104px; display: block; overflow: visible; }
  /* Each hit is anchored on its vertex and centred over it, rather than being
     one cell of an evenly divided row — see the note at the call site. */
  .fin .viz-hits { position: absolute; inset: 0; }
  .fin .viz-hit {
    position: absolute; top: 0; bottom: 0; transform: translateX(-50%);
    background: none; border: none; cursor: pointer; border-radius: 6px; padding: 0;
  }
  .fin .viz-hit:hover { background: rgba(0,0,0,0.035); }
  /* The marker. An element rather than an SVG circle, because the viewBox
     above is stretched to the card width and would turn it into an ellipse. */
  .fin .viz-dot {
    position: absolute; left: 50%; width: 9px; height: 9px; border-radius: 50%;
    transform: translate(-50%, -50%); box-shadow: 0 0 0 2px var(--surface);
  }
  .fin .viz-dot.in   { background: var(--in); }
  .fin .viz-dot.late { background: var(--late); }
  .fin .viz-hit:hover .viz-dot { transform: translate(-50%, -50%) scale(1.25); }
  .fin .viz-xs {
    display: flex; margin-top: 5px;
    font-size: 10.5px; color: var(--ink-3);
  }
  .fin .viz-xs span { flex: 1 1 0; text-align: center; }

  /* ── A table, so the chart is never the only way to read the data ─────── */
  .fin .viz-table {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap;
  }

  /* ── Aging ────────────────────────────────────────────────────────────── */
  .fin .viz-stackbar {
    display: flex; gap: 2px; height: 12px; border-radius: 999px;
    overflow: hidden; margin-bottom: 16px; background: var(--line-2);
  }
  .fin .viz-seg { display: block; min-width: 3px; }
  .fin .viz-seg:first-child { border-radius: 999px 0 0 999px; }
  .fin .viz-seg:last-child  { border-radius: 0 999px 999px 0; }
  .fin .viz-seg:only-child  { border-radius: 999px; }
  .fin .age-fresh     { background: var(--age-1); }
  .fin .age-month     { background: var(--age-2); }
  .fin .age-twoMonths { background: var(--age-3); }
  .fin .age-severe    { background: var(--age-4); }

  .fin .age-rows { display: flex; flex-direction: column; }
  .fin .age-row {
    display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
    padding: 10px 2px; border: none; border-top: 1px solid var(--line-2);
    background: none; font-family: inherit; color: inherit;
  }
  .fin button.age-row { cursor: pointer; }
  .fin button.age-row:hover { background: var(--surface-2); }
  .fin .age-row:first-child { border-top: none; }
  .fin .age-row.nil { opacity: 0.5; }
  .fin .age-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .fin .age-lbl { flex: 1; min-width: 0; font-size: 13.5px; letter-spacing: -0.01em; }
  .fin .age-lbl em {
    display: block; font-style: normal; font-size: 11.5px; color: var(--ink-3); margin-top: 1px;
  }
  .fin .age-fig { text-align: right; flex-shrink: 0; }
  .fin .age-fig b { font-size: 14px; font-weight: 600; display: block; }
  .fin .age-fig em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  /* ── Method mix ───────────────────────────────────────────────────────── */
  .fin .mix { display: flex; flex-direction: column; gap: 12px; }
  .fin .mix-row { display: grid; grid-template-columns: 112px 1fr auto; align-items: center; gap: 12px; }
  .fin .mix-chip {
    font-size: 11.5px; padding: 3px 9px; border-radius: 999px; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fin .mix-track { height: 8px; background: var(--line-2); border-radius: 999px; overflow: hidden; }
  .fin .mix-fill { display: block; height: 100%; border-radius: 999px; }
  .fin .mix-fig { text-align: right; }
  .fin .mix-fig b { font-size: 13.5px; font-weight: 600; display: block; }
  .fin .mix-fig em { font-style: normal; font-size: 11px; color: var(--ink-3); }

  /* ── Meters ───────────────────────────────────────────────────────────── */
  .fin .meter {
    position: relative; height: 5px; background: var(--line-2);
    border-radius: 999px; overflow: visible; margin-top: 9px;
  }
  .fin .meter.nil { background: var(--line-2); }
  .fin .meter-fill { display: block; height: 100%; border-radius: 999px; transition: width 0.4s; }
  .fin .meter-fill.good { background: var(--in); }
  .fin .meter-fill.warn { background: var(--fee); }
  .fin .meter-fill.bad  { background: var(--late); }
  .fin .meter-fill.neutral { background: var(--ink-3); }
  .fin .meter-mark { position: absolute; top: -2px; width: 2px; height: 9px; background: var(--ink-3); }

  .fin .pbar2 {
    position: relative; height: 6px; background: var(--line-2);
    border-radius: 999px; margin: 14px 0 8px;
  }
  .fin .pbar2-fill { display: block; height: 100%; background: var(--in); border-radius: 999px; transition: width 0.4s; }
  .fin .pbar2-mark { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--ink); border-radius: 2px; }

  /* ── Sparkline ────────────────────────────────────────────────────────── */
  .fin .spark2 { position: relative; display: block; width: 100%; margin-top: 8px; }
  .fin .spark2 svg { display: block; width: 100%; height: 100%; }
  .fin .spark2-dot {
    position: absolute; width: 5px; height: 5px; border-radius: 50%;
    transform: translate(-50%, -50%); box-shadow: 0 0 0 1.5px var(--surface);
  }

  /* ── Delta chip ───────────────────────────────────────────────────────── */
  .fin .delta {
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
    padding: 1px 7px; border-radius: 980px; letter-spacing: -0.005em;
    background: var(--idle-bg); color: var(--ink-2); white-space: nowrap;
  }
  .fin .delta.good { background: var(--in-bg);   color: var(--in); }
  .fin .delta.bad  { background: var(--late-bg); color: var(--late); }
  .fin .delta-arrow { font-size: 8px; line-height: 1; }

  /* ── Cash forecast ────────────────────────────────────────────────────── */
  .fin .viz-plot.bars.fc { height: 150px; }
  .fin .fc-band {
    position: absolute; left: 0; right: 0; display: block; min-height: 0;
    transition: height 0.35s cubic-bezier(0.4,0,0.2,1);
  }
  /* The gap is a surface-coloured ring rather than a margin, so the bands stay
     mathematically stacked while reading as separate. */
  .fin .fc-band.clearing { background: var(--flight); }
  .fin .fc-band.ontime   { background: var(--in);     box-shadow: 0 -2px 0 var(--surface); }
  .fin .fc-band.slip     { background: var(--fee);    box-shadow: 0 -2px 0 var(--surface); }
  .fin .fc-band.risk     { background: var(--late);   box-shadow: 0 -2px 0 var(--surface); }
  /* Rounded cap on whichever band happens to be on top of the stack. */
  .fin .viz-col:hover .fc-band { filter: saturate(1.15); }
  .fin .viz-sw.clearing { background: var(--flight); }
  .fin .viz-sw.ontime   { background: var(--in); }
  .fin .viz-sw.slip     { background: var(--fee); }
  .fin .viz-sw.risk     { background: var(--late); }
  .fin .fc-note {
    font-size: 11.5px; color: var(--ink-3); line-height: 1.6; margin-top: 14px;
    letter-spacing: -0.005em; max-width: 92ch;
  }
  .fin .fc-note b { color: var(--ink-2); font-weight: 600; }

  @media (prefers-reduced-motion: reduce) {
    .fin .viz-bar, .fin .fc-band, .fin .meter-fill, .fin .pbar2-fill { transition: none; }
  }

  @media (max-width: 700px) {
    .fin .viz-plot.bars { height: 150px; }
    /* The method rows stop competing for width and stack: a chip, then the
       bar and figure under it. Three columns inside a phone-width card left
       the meta line ("31% · 12 payments · $400 clearing") wrapping to three
       lines of four words. */
    .fin .mix-row { grid-template-columns: 1fr auto; gap: 6px 10px; }
    .fin .mix-chip { grid-column: 1 / -1; justify-self: start; padding: 2px 10px; }
    .fin .viz-note { margin-left: 0; width: 100%; }
    .fin .fc-note { font-size: 11px; }
  }
  /* A chart inside one of the two-up cards has about half the room, so the
     floor bites there first — which is exactly when the scroll should appear. */
  @media (max-width: 1040px) {
    .fin .viz-legend { gap: 10px; }
  }

  /* On paper the charts are ink on white: no hover, no tooltip, and the hidden
     data table becomes the chart. */
  @media print {
    .fin .viz-tip, .fin .viz-hits { display: none !important; }
    /* Nothing scrolls on paper, so the floor is dropped and the mask with it
       — otherwise the right-hand column prints faded. */
    .fin .viz-scroll { overflow: visible !important; mask-image: none !important; }
    .fin .viz-plot { min-width: 0 !important; }
    .fin .viz-table {
      position: static; width: 100%; height: auto; clip-path: none;
      white-space: normal; border-collapse: collapse; font-size: 10pt;
    }
    .fin .viz-table caption { text-align: left; font-weight: 600; padding: 6pt 0; }
    .fin .viz-table th, .fin .viz-table td {
      border-bottom: 1px solid #ddd; padding: 3pt 6pt; text-align: left;
    }
    .fin .viz-plot { break-inside: avoid; }
  }
`
