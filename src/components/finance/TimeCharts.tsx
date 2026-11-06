'use client'

/**
 * The health-over-time charts, as one linked instrument.
 *
 * ── Why these are one component and not three ──────────────────────────────
 *
 * Three charts of the same months, each with its own tooltip, is three
 * separate acts of reading. A landlord looking at a bad month in the
 * composition chart then has to find that same month by eye in the arrears
 * chart below it, and hold two numbers in their head to connect them.
 *
 * So the charts share a cursor. Hovering — or tab-focusing — any column in any
 * of them highlights that month everywhere and fills one readout above them
 * all. That turns "here are some charts" into an instrument you can actually
 * interrogate: *October was the bad month → and here is exactly where arrears
 * started climbing → and here is the moment the cumulative lines separated.*
 *
 * It is the single biggest difference between a dashboard that looks
 * analytical and one that is.
 *
 * ── The chart choices, and what each one refuses to do ────────────────────
 *
 *   • **Composition** is a stacked bar because its three parts genuinely
 *     partition what was billed — on time, late, never arrived — and that
 *     identity is enforced in the model. It offers an amounts/share toggle
 *     rather than a legend that hides series, because hiding one part of an
 *     exact partition makes the remaining stack a lie about what it is part of.
 *   • **Arrears** is one line on one axis. It is the only chart here that
 *     describes a *balance* rather than a flow, so it never shares a frame
 *     with money-in — mixing a stock and a flow on one axis is how dashboards
 *     end up implying things their data cannot support.
 *   • **Cumulative** is two lines of the same unit, so one axis is honest. The
 *     gap between them is shaded, because the gap is the entire point.
 *
 * No chart here carries a second y-scale. Ever.
 */

import { useState } from 'react'
import { fmtCurrency } from '@/lib/payments'
import { shortMoney } from '@/components/finance/Charts'
import Glyph from '@/components/finance/Glyph'
import {
  HISTORY_RANGES, rangeLabel,
  type History, type HistoryMonth, type RangeId,
} from '@/lib/financialsHistory'

/** The narrowest a column may get before the chart scrolls instead. */
const MIN_COL = 40

// ─── RANGE PICKER ────────────────────────────────────────────────────────────

export function RangePicker({
  value, onChange,
}: {
  value: RangeId
  onChange: (r: RangeId) => void
}) {
  return (
    <div className="seg" role="tablist" aria-label="How far back">
      {HISTORY_RANGES.map(r => (
        <button
          key={r.id}
          role="tab"
          aria-selected={value === r.id}
          title={r.hint}
          className={`seg-btn${value === r.id ? ' on' : ''}`}
          onClick={() => onChange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

// ─── THE READOUT ─────────────────────────────────────────────────────────────

/**
 * The hovered month, spelled out.
 *
 * This is where the interactivity pays off. A tooltip can hold three numbers
 * before it becomes a wall; a readout pinned above the charts can hold the
 * whole month and stay readable, and it does not cover the data it describes.
 * With nothing hovered it shows the window's totals, so the space is never
 * empty and the default state is still useful.
 */
function Readout({ h, month }: { h: History; month: HistoryMonth | null }) {
  const m = month
  return (
    <div className={`ro${m ? ' on' : ''}`} aria-live="polite">
      <div className="ro-when">
        <span className="ro-label">{m ? m.longLabel : 'Whole window'}</span>
        <span className="ro-sub">
          {m
            ? m.position === 'future'
              ? 'not due yet'
              : `${m.count} charge${m.count !== 1 ? 's' : ''}${
                  m.monthsOutstanding !== null
                    ? ` · carrying ${m.monthsOutstanding}× a month in arrears`
                    : ''}`
            : rangeLabel(h)}
        </span>
      </div>

      <div className="ro-figs">
        <Fig label="Billed" value={fmtCurrency(m ? m.billed : h.billed)} />
        <Fig label="Collected" value={fmtCurrency(m ? m.collected : h.collected)} tone="good" />
        <Fig
          label="On time"
          value={(m ? m.onTimeShare : h.onTimeShare) !== null
            ? `${m ? m.onTimeShare : h.onTimeShare}%`
            : '—'}
        />
        <Fig
          label="Arrived late"
          value={fmtCurrency(m ? m.late : h.settledMonths.reduce((n, x) => n + x.late, 0))}
          tone="warn"
        />
        <Fig
          label="Never arrived"
          value={fmtCurrency(m ? m.unpaid : h.settledMonths.reduce((n, x) => n + x.unpaid, 0))}
          tone={(m ? m.unpaid : 1) > 0 ? 'bad' : undefined}
        />
        <Fig
          label={m ? 'Arrears at month end' : 'Arrears now'}
          value={(m ? m.arrearsAtEnd : h.arrearsNow) !== null
            ? fmtCurrency((m ? m.arrearsAtEnd : h.arrearsNow)!)
            : '—'}
          tone={((m ? m.arrearsAtEnd : h.arrearsNow) ?? 0) > 0 ? 'bad' : 'good'}
        />
      </div>
    </div>
  )
}

function Fig({
  label, value, tone,
}: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="ro-fig">
      <span className="ro-fig-l">{label}</span>
      <span className={`ro-fig-v${tone ? ' ' + tone : ''}`}>{value}</span>
    </div>
  )
}

// ─── Y AXIS ──────────────────────────────────────────────────────────────────

/** Three gridlines with money on them, so a column can be read without a hover. */
function Axis({ peak }: { peak: number }) {
  const steps = [1, 0.5, 0]
  return (
    <div className="axis" aria-hidden="true">
      {steps.map(s => (
        <span key={s} className="axis-row" style={{ bottom: `${s * 100}%` }}>
          <em>{shortMoney(peak * s)}</em>
          <i />
        </span>
      ))}
    </div>
  )
}

// ─── THE INSTRUMENT ──────────────────────────────────────────────────────────

export default function TrendExplorer({
  h, onSelectMonth,
}: {
  h: History
  /** Drilling into a month — the schedule, for that month. */
  onSelectMonth: (key: string) => void
}) {
  /** The month every chart is pointed at. One cursor, three charts. */
  const [focus, setFocus] = useState<string | null>(null)
  const [mode, setMode] = useState<'amount' | 'share'>('amount')

  const months = h.months
  if (months.length === 0) return null
  const focused = months.find(m => m.key === focus) ?? null
  const minWidth = months.length * MIN_COL

  const peakBilled = Math.max(1, ...months.map(m => m.billed))
  const peakArrears = Math.max(1, ...months.map(m => m.arrearsAtEnd ?? 0))
  const peakCum = Math.max(1, ...months.map(m => Math.max(m.cumBilled, m.cumCollected)))

  /** Shared props for every column button, so hover/focus/click behave alike
   *  in all three charts and the keyboard works the same as the mouse. */
  const col = (m: HistoryMonth, extra: string) => ({
    className: `tc-col${focus === m.key ? ' on' : ''}${
      m.position === 'future' ? ' ahead' : ''} ${extra}`,
    onMouseEnter: () => setFocus(m.key),
    onFocus: () => setFocus(m.key),
    onClick: () => onSelectMonth(m.key),
    type: 'button' as const,
  })

  return (
    <div className="tc" onMouseLeave={() => setFocus(null)}>
      <Readout h={h} month={focused} />

      {/* ══ 1. WHERE THE MONEY WENT ══ */}
      <div className="tc-block">
        <div className="tc-hd">
          <div>
            <h3 className="tc-title">What happened to each month&rsquo;s rent</h3>
            <p className="tc-note">
              Of everything billed: what arrived on time, what arrived late, and what never came.
              The three add up to the month exactly.
            </p>
          </div>
          <div className="seg sm" role="tablist" aria-label="Scale">
            <button
              role="tab" aria-selected={mode === 'amount'}
              className={`seg-btn${mode === 'amount' ? ' on' : ''}`}
              onClick={() => setMode('amount')}
            >Amounts</button>
            <button
              role="tab" aria-selected={mode === 'share'}
              className={`seg-btn${mode === 'share' ? ' on' : ''}`}
              onClick={() => setMode('share')}
              title="Every month the same height, so a small month and a big one can be compared"
            >Share</button>
          </div>
        </div>

        <div className="tc-legend">
          <span className="viz-key"><i className="viz-sw ontime" />On time</span>
          <span className="viz-key"><i className="viz-sw slip" />Arrived late</span>
          <span className="viz-key"><i className="viz-sw risk" />Never arrived</span>
          <span className="viz-note">
            {mode === 'share'
              ? 'each column is one month at 100%'
              : `tallest month ${shortMoney(peakBilled)}`}
          </span>
        </div>

        <div className="viz-scroll">
          <div className="tc-plot" style={{ minWidth }}>
            {mode === 'amount' && <Axis peak={peakBilled} />}
            <div className="tc-cols">
              {months.map(m => {
                // In share mode the denominator is the month itself, so every
                // column is full height and a quiet month is comparable with a
                // busy one. In amount mode it is the tallest month in view.
                const denom = mode === 'share' ? (m.billed || 1) : peakBilled
                const pc = (v: number) => (v / denom) * 100
                return (
                  <button
                    key={m.key}
                    {...col(m, 'stack')}
                    aria-label={`${m.longLabel}: ${fmtCurrency(m.onTime)} on time, ${
                      fmtCurrency(m.late)} late, ${fmtCurrency(m.unpaid)} never arrived`}
                  >
                    <span className="tc-bar-wrap">
                      <span className="tc-seg risk"
                            style={{ height: `${pc(m.unpaid)}%` }} />
                      <span className="tc-seg slip"
                            style={{ height: `${pc(m.late)}%` }} />
                      <span className="tc-seg ontime"
                            style={{ height: `${pc(m.onTime)}%` }} />
                    </span>
                    <span className="tc-x">
                      {m.label}
                      {(m.key.endsWith('-01') || m === months[0]) && (
                        <em>{String(m.year).slice(2)}</em>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ══ 2. THE BALANCE — the chart that was missing ══ */}
      <div className="tc-block">
        <div className="tc-hd">
          <div>
            <h3 className="tc-title">Arrears carried, month by month</h3>
            <p className="tc-note">
              Everything outstanding at each month&rsquo;s end, rebuilt from the charges and the
              dates they settled on. A flat line is a portfolio holding its ground; a rising one is
              losing it, however healthy any single month looked.
            </p>
          </div>
          {h.arrearsChange !== null && (
            <span className={`tc-delta ${h.arrearsChange > 0 ? 'bad' : 'good'}`}>
              <Glyph name={h.arrearsChange > 0 ? 'trend-up' : 'trend-down'} size={13} />
              {h.arrearsChange > 0 ? '+' : '−'}{fmtCurrency(Math.abs(h.arrearsChange))}
              <em>over the window</em>
            </span>
          )}
        </div>

        <div className="viz-scroll">
          <div className="tc-plot tall" style={{ minWidth }}>
            <Axis peak={peakArrears} />
            {/* The area sits behind the columns; the columns are the hit
                targets and the markers, which keeps every dot circular
                regardless of how wide the card is. */}
            <svg className="tc-area" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon
                fill="var(--late)" opacity="0.1"
                points={`0,100 ${months.map((m, i) => {
                  const x = months.length === 1 ? 0 : (i / (months.length - 1)) * 100
                  const y = 100 - ((m.arrearsAtEnd ?? 0) / peakArrears) * 100
                  return `${x.toFixed(2)},${y.toFixed(2)}`
                }).join(' ')} 100,100`}
              />
              <polyline
                fill="none" stroke="var(--late)" strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
                points={months
                  .filter(m => m.arrearsAtEnd !== null)
                  .map((m) => {
                    const i = months.indexOf(m)
                    const x = months.length === 1 ? 0 : (i / (months.length - 1)) * 100
                    const y = 100 - (m.arrearsAtEnd! / peakArrears) * 100
                    return `${x.toFixed(2)},${y.toFixed(2)}`
                  }).join(' ')}
              />
            </svg>

            <div className="tc-cols overlay">
              {months.map(m => (
                <button
                  key={m.key}
                  {...col(m, 'point')}
                  aria-label={m.arrearsAtEnd !== null
                    ? `${m.longLabel}: ${fmtCurrency(m.arrearsAtEnd)} outstanding at month end`
                    : `${m.longLabel}: not finished`}
                >
                  {m.arrearsAtEnd !== null && (
                    <span
                      className="tc-dot late"
                      style={{ bottom: `${(m.arrearsAtEnd / peakArrears) * 100}%` }}
                    />
                  )}
                  <span className="tc-x">{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {h.arrearsPeak !== null && h.arrearsNow !== null && (
          <p className="tc-foot">
            Worst point in this window was <b>{fmtCurrency(h.arrearsPeak)}</b>; you are carrying{' '}
            <b>{fmtCurrency(h.arrearsNow)}</b> now.
            {h.arrearsThen !== null && (
              <> That is {h.arrearsChange! > 0 ? 'up' : h.arrearsChange! < 0 ? 'down' : 'level'}
                {h.arrearsChange !== 0 && <> {fmtCurrency(Math.abs(h.arrearsChange!))}</>} against{' '}
                {fmtCurrency(h.arrearsThen)} at the start of it.</>
            )}
          </p>
        )}
      </div>

      {/* ══ 3. THE CUMULATIVE GAP ══ */}
      <div className="tc-block">
        <div className="tc-hd">
          <div>
            <h3 className="tc-title">Billed against collected, running total</h3>
            <p className="tc-note">
              Both lines are money, so they share one axis honestly. The shaded gap between them is
              everything that has not been collected over the window — if it widens, the portfolio
              is falling behind.
            </p>
          </div>
        </div>

        <div className="tc-legend">
          <span className="viz-key"><i className="viz-sw billed-line" />Billed to date</span>
          <span className="viz-key"><i className="viz-sw collected-line" />Collected to date</span>
          <span className="viz-note">
            gap {fmtCurrency(Math.max(0,
              (months[months.length - 1]?.cumBilled ?? 0) - (months[months.length - 1]?.cumCollected ?? 0)))}
          </span>
        </div>

        <div className="viz-scroll">
          <div className="tc-plot" style={{ minWidth }}>
            <Axis peak={peakCum} />
            <svg className="tc-area" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {(() => {
                const xs = (i: number) => months.length === 1 ? 0 : (i / (months.length - 1)) * 100
                const yb = (v: number) => 100 - (v / peakCum) * 100
                const billedPts = months.map((m, i) => `${xs(i).toFixed(2)},${yb(m.cumBilled).toFixed(2)}`)
                const collPts = months.map((m, i) => `${xs(i).toFixed(2)},${yb(m.cumCollected).toFixed(2)}`)
                return (
                  <>
                    {/* The gap, shaded: billed line down, collected line back. */}
                    <polygon
                      fill="var(--fee)" opacity="0.12"
                      points={`${billedPts.join(' ')} ${collPts.slice().reverse().join(' ')}`}
                    />
                    <polyline
                      fill="none" stroke="var(--ink-3)" strokeWidth="1.8" strokeDasharray="5 3"
                      vectorEffect="non-scaling-stroke" points={billedPts.join(' ')}
                    />
                    <polyline
                      fill="none" stroke="var(--in)" strokeWidth="2.2"
                      strokeLinejoin="round" strokeLinecap="round"
                      vectorEffect="non-scaling-stroke" points={collPts.join(' ')}
                    />
                  </>
                )
              })()}
            </svg>

            <div className="tc-cols overlay">
              {months.map(m => (
                <button
                  key={m.key}
                  {...col(m, 'point')}
                  aria-label={`${m.longLabel}: ${fmtCurrency(m.cumCollected)} collected of ${
                    fmtCurrency(m.cumBilled)} billed to date`}
                >
                  <span className="tc-dot dim" style={{ bottom: `${(m.cumBilled / peakCum) * 100}%` }} />
                  <span className="tc-dot in" style={{ bottom: `${(m.cumCollected / peakCum) * 100}%` }} />
                  <span className="tc-x">{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="tc-how">
        Hover or tab through any column to read that month across all three charts at once; click
        one to open it in the schedule. Month-end arrears are reconstructed from each charge&rsquo;s
        due date and the date it settled — a partial payment is counted on its recorded settlement
        date, which is the only date the records keep.
      </p>
    </div>
  )
}

/** Styles for the instrument. Injected after the shared chart sheet. */
export const TIME_CSS = `
  .fin .tc { position: relative; }

  /* ── The shared readout ───────────────────────────────────────────────────
     Pinned above the charts rather than floating over them: it holds the whole
     month without covering the data it describes, and it has something useful
     to say before anything is hovered. */
  .fin .ro {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 20px; flex-wrap: wrap; padding: 15px 17px; margin-bottom: 18px;
    background: var(--surface-2); border: 1px solid var(--line); border-radius: 14px;
    transition: border-color 0.15s, background 0.15s;
  }
  .fin .ro.on { border-color: var(--accent); background: var(--accent-bg); }
  .fin .ro-when { min-width: 150px; }
  .fin .ro-label {
    display: block; font-size: 15px; font-weight: 600; letter-spacing: -0.016em;
    font-variant-numeric: tabular-nums;
  }
  .fin .ro-sub { display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 3px; line-height: 1.5; }
  .fin .ro-figs {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(94px, 1fr));
    gap: 14px 18px; flex: 1 1 420px;
  }
  .fin .ro-fig { min-width: 0; }
  .fin .ro-fig-l {
    display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  .fin .ro-fig-v {
    display: block; font-size: 15px; font-weight: 600; letter-spacing: -0.016em;
    margin-top: 3px; font-variant-numeric: tabular-nums;
  }
  .fin .ro-fig-v.good { color: var(--in); }
  .fin .ro-fig-v.bad  { color: var(--late); }
  .fin .ro-fig-v.warn { color: var(--fee); }

  /* ── Blocks ───────────────────────────────────────────────────────────── */
  .fin .tc-block { padding: 20px 0 4px; border-top: 1px solid var(--line-2); }
  .fin .tc-block:first-of-type { border-top: none; padding-top: 0; }
  .fin .tc-hd {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin-bottom: 12px;
  }
  .fin .tc-title { font-size: 14.5px; font-weight: 600; letter-spacing: -0.014em; }
  .fin .tc-note {
    font-size: 12px; color: var(--ink-2); line-height: 1.6; margin-top: 4px;
    max-width: 74ch; letter-spacing: -0.005em;
  }
  .fin .tc-foot, .fin .tc-how {
    font-size: 11.5px; color: var(--ink-3); line-height: 1.65; margin-top: 12px; max-width: 86ch;
  }
  .fin .tc-foot b { color: var(--ink-2); font-weight: 600; }
  .fin .tc-how { padding-top: 14px; border-top: 1px solid var(--line-2); margin-top: 20px; }
  .fin .tc-legend {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    font-size: 11.5px; color: var(--ink-3); margin-bottom: 10px;
  }
  .fin .viz-sw.billed-line { background: var(--ink-3); }
  .fin .viz-sw.collected-line { background: var(--in); }
  .fin .tc-delta {
    display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
    font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
    padding: 4px 11px; border-radius: 980px;
  }
  .fin .tc-delta.bad  { background: var(--late-bg); color: var(--late); }
  .fin .tc-delta.good { background: var(--in-bg);   color: var(--in); }
  .fin .tc-delta em { font-style: normal; font-weight: 400; opacity: 0.75; font-size: 11px; }

  /* ── The plot ─────────────────────────────────────────────────────────── */
  .fin .tc-plot { position: relative; height: 180px; padding-left: 38px; }
  .fin .tc-plot.tall { height: 210px; }
  .fin .tc-cols {
    position: relative; display: flex; align-items: flex-end; gap: 3px;
    height: 100%; padding-bottom: 20px;
  }
  .fin .tc-cols.overlay { position: absolute; inset: 0 0 0 38px; }
  .fin .tc-col {
    position: relative; flex: 1 1 0; min-width: 0; height: 100%;
    display: flex; flex-direction: column; justify-content: flex-end;
    background: none; border: none; padding: 0; cursor: pointer; border-radius: 5px 5px 0 0;
  }
  .fin .tc-col.on { background: rgba(0,113,227,0.07); }
  .fin .tc-col:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .fin .tc-col.ahead { opacity: 0.45; }

  /* Stacked composition. The 2px surface ring keeps two adjacent segments
     legible without breaking the stack's arithmetic. */
  .fin .tc-bar-wrap {
    display: flex; flex-direction: column; justify-content: flex-end;
    height: calc(100% - 20px); border-radius: 4px 4px 0 0; overflow: hidden;
  }
  .fin .tc-seg { display: block; width: 100%; transition: height 0.3s var(--ease); }
  .fin .tc-seg.ontime { background: var(--in); }
  .fin .tc-seg.slip   { background: var(--fee);  box-shadow: 0 -2px 0 var(--surface); }
  .fin .tc-seg.risk   { background: var(--late); box-shadow: 0 -2px 0 var(--surface); }
  .fin .tc-col.on .tc-seg { filter: saturate(1.2); }

  /* A point on a line chart. An element, not an SVG circle: the paths above
     are drawn in a stretched viewBox and a circle inside one renders as an
     ellipse. */
  .fin .tc-dot {
    position: absolute; left: 50%; width: 8px; height: 8px; border-radius: 50%;
    transform: translate(-50%, 50%); box-shadow: 0 0 0 2px var(--surface);
    margin-bottom: 20px; transition: transform 0.12s;
  }
  .fin .tc-dot.late { background: var(--late); }
  .fin .tc-dot.in   { background: var(--in); }
  .fin .tc-dot.dim  { background: var(--ink-3); width: 6px; height: 6px; }
  .fin .tc-col.on .tc-dot { transform: translate(-50%, 50%) scale(1.35); }

  .fin .tc-area {
    position: absolute; left: 38px; right: 0; top: 0; bottom: 20px;
    width: calc(100% - 38px); height: calc(100% - 20px);
  }

  .fin .tc-x {
    position: absolute; bottom: 0; left: 0; right: 0; text-align: center;
    font-size: 10.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden;
  }
  .fin .tc-col.on .tc-x { color: var(--ink); font-weight: 600; }
  .fin .tc-x em { display: block; font-style: normal; font-size: 9px; opacity: 0.7; }

  /* ── Axis ─────────────────────────────────────────────────────────────── */
  .fin .axis { position: absolute; left: 0; right: 0; top: 0; bottom: 20px; pointer-events: none; }
  .fin .axis-row { position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px; }
  .fin .axis-row em {
    font-style: normal; font-size: 9.5px; color: var(--ink-3); width: 32px;
    text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums;
  }
  .fin .axis-row i { flex: 1; height: 1px; background: var(--line-2); }

  @media (max-width: 700px) {
    .fin .ro { padding: 13px 14px; }
    .fin .ro-figs { grid-template-columns: repeat(2, 1fr); gap: 12px 14px; }
    .fin .tc-plot { height: 160px; padding-left: 32px; }
    .fin .tc-plot.tall { height: 180px; }
    .fin .tc-cols.overlay, .fin .tc-area { left: 32px; }
    .fin .tc-area { width: calc(100% - 32px); }
  }

  @media print {
    .fin .ro { background: #fff !important; border-color: #ddd !important; }
    .fin .tc-how, .fin .seg { display: none !important; }
    .fin .tc-block { break-inside: avoid; }
  }
`
