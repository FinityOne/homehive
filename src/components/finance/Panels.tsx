'use client'

/**
 * The admin-dashboard furniture: stat cards, mini cards, status dots, a data
 * table and a gradient bar chart.
 *
 * ── Why these exist as their own kit ───────────────────────────────────────
 *
 * The money area's own components were built for *density* — panels of nested
 * rows, tuned to get a lot of ledger onto a screen. That is right for
 * Collections and the Schedule, where a landlord is working. It is wrong for
 * the landing screen, which is read at a glance from a few feet away and
 * should look like the summary of a business rather than the top of a
 * spreadsheet.
 *
 * So this is the glance vocabulary, and it is deliberately a small, fixed set:
 *
 *   • **StatCard** — an icon tile, a name, a one-line subtitle, one large
 *     figure, an optional change pill, and a footer that is a way in. Exactly
 *     one card per screen is `primary` and filled; the rest are white. One
 *     filled card is a focal point, three is a traffic light.
 *   • **MiniCard** — the same idea at a quarter of the size, for a grid of
 *     peers (properties, accounts) where the comparison between them is the
 *     content.
 *   • **DataTable** styling — the familiar admin row: an avatar or icon, a
 *     name, a few columns, and a status dot with a word beside it.
 *   • **GradientBars** — one month per column, a soft vertical fade, and the
 *     selected column solid. The fade is not decoration: it keeps twelve bars
 *     from reading as twelve competing blocks, so the one that matters can be
 *     the only solid thing on the chart.
 *
 * ── What is deliberately not here ──────────────────────────────────────────
 *
 * No sparkline-in-a-tile, no donut, no gauge. The glance layer gets one chart,
 * and the analysis charts stay on the pages built for them.
 */

import { useState } from 'react'
import Link from 'next/link'
import { fmtCurrency } from '@/lib/payments'
import Glyph, { type GlyphName } from '@/components/finance/Glyph'
import { shortMoney } from '@/components/finance/Charts'

// ─── CHANGE PILL ─────────────────────────────────────────────────────────────

/**
 * A change, with its direction and a basis it must name.
 *
 * The constraint from the rest of the area survives the restyle: this cannot
 * render a comparison without being told what the comparison is *against*,
 * and callers pass `null` when no honest basis exists rather than reaching for
 * a plausible-looking number.
 */
export function TrendPill({
  pct, basis, goodWhen = 'up', onDark,
}: {
  pct: number | null
  /** What the change is measured against. Shown on hover. */
  basis: string
  goodWhen?: 'up' | 'down'
  /** Inverted styling, for the filled primary card. */
  onDark?: boolean
}) {
  if (pct === null || pct === 0) return null
  const up = pct > 0
  const good = goodWhen === 'up' ? up : !up
  return (
    <span
      className={`tpill${onDark ? ' on-dark' : good ? ' good' : ' bad'}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(pct)}% against ${basis}`}
    >
      {Math.abs(pct)}%
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
    </span>
  )
}

// ─── STAT CARD ───────────────────────────────────────────────────────────────

export function StatCard({
  icon, title, sub, value, pill, foot, href, footLabel, primary, tone,
}: {
  icon: GlyphName
  title: string
  /** One line under the title. Says what the figure is *of*. */
  sub: string
  value: string
  pill?: React.ReactNode
  /** A line between the figure and the footer, when there is more to say. */
  foot?: React.ReactNode
  href: string
  footLabel: string
  /** The one filled card on the screen. */
  primary?: boolean
  tone?: 'bad' | 'warn'
}) {
  return (
    <div className={`statc${primary ? ' primary' : ''}${tone ? ' ' + tone : ''}`}>
      <div className="statc-top">
        <span className="statc-icon"><Glyph name={icon} size={18} /></span>
        <div className="statc-id">
          <div className="statc-title">{title}</div>
          <div className="statc-sub">{sub}</div>
        </div>
      </div>

      <div className="statc-figure">
        <span className="statc-value">{value}</span>
        {pill}
      </div>
      {foot && <div className="statc-foot">{foot}</div>}

      <Link className="statc-link" href={href}>
        {footLabel}
        <Glyph name="arrow-right" size={16} />
      </Link>
    </div>
  )
}

// ─── MINI CARD ───────────────────────────────────────────────────────────────

/** A status word with a dot. Never the dot alone — colour is not a label. */
export function StatusDot({
  tone, children,
}: {
  tone: 'good' | 'bad' | 'warn' | 'idle'
  children: React.ReactNode
}) {
  return (
    <span className={`sdot ${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

export function MiniCard({
  label, badge, value, caption, status, statusTone, href,
}: {
  label: string
  /** The small round mark — initials, usually. */
  badge: string
  value: string
  caption: string
  status: string
  statusTone: 'good' | 'bad' | 'warn' | 'idle'
  href: string
}) {
  return (
    <Link className="minic" href={href}>
      <div className="minic-top">
        <span className="minic-badge">{badge}</span>
        <span className="minic-label">{label}</span>
        <span className="minic-more" aria-hidden="true">⋮</span>
      </div>
      <div className="minic-value">{value}</div>
      <div className="minic-caption">{caption}</div>
      <StatusDot tone={statusTone}>{status}</StatusDot>
    </Link>
  )
}

// ─── SECTION BAND, PERIOD SELECT ─────────────────────────────────────────────

/**
 * The band that introduces a run of cards: a name, a line, and the controls
 * that say what window the figures below are read over.
 *
 * It exists because the page header answers "where am I" for the whole money
 * area — it carries the tabs — and a dashboard also needs to answer "what am I
 * looking at, over what period" right where the figures start. Putting the
 * window control up here rather than on each card is what keeps the three
 * cards free of chrome.
 */
export function SectionBand({
  title, sub, children,
}: {
  title: string
  sub?: string
  /** The controls, right-aligned. */
  children?: React.ReactNode
}) {
  return (
    <div className="band">
      <div className="band-id">
        <h2 className="band-title">{title}</h2>
        {sub && <p className="band-sub">{sub}</p>}
      </div>
      {children && <div className="band-tools">{children}</div>}
    </div>
  )
}

/**
 * A window chip — "This month", "Last 3 months", and so on.
 *
 * It is a styled `<select>` rather than a custom popover on purpose: the
 * native control is already keyboard-operable, already announces itself, and
 * on a phone opens the system picker instead of a list that has to be scrolled
 * inside a card. The chevron is drawn beside it; the select itself is
 * transparent and sits over the whole chip.
 */
export function PeriodSelect<T extends string>({
  value, options, onChange, label = 'Period',
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (id: T) => void
  label?: string
}) {
  const current = options.find(o => o.id === value)
  return (
    <span className="chipsel">
      <span className="chipsel-label">{current?.label ?? value}</span>
      <Glyph name="chevron-down" size={15} />
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </span>
  )
}

// ─── TABLE TOOLS ─────────────────────────────────────────────────────────────

/**
 * The search box and status filter above a data table.
 *
 * A seven-row table does not need searching; a landlord looking for "did
 * Aleeya's October rent ever land" does. So the search widens the table as
 * well as filtering it — see the page — and an empty box returns it to the
 * glance-sized list it was.
 */
export function TableTools<T extends string>({
  query, onQuery, placeholder = 'Search',
  filter, filters, onFilter,
}: {
  query: string
  onQuery: (q: string) => void
  placeholder?: string
  filter: T
  filters: { id: T; label: string }[]
  onFilter: (id: T) => void
}) {
  return (
    <div className="ptools">
      <label className="psearch">
        <Glyph name="search" size={15} />
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={e => onQuery(e.target.value)}
        />
      </label>
      <span className="chipsel">
        <Glyph name="filter" size={15} />
        <span className="chipsel-label">
          {filters.find(f => f.id === filter)?.label ?? 'Filter'}
        </span>
        <select
          aria-label="Filter payments"
          value={filter}
          onChange={e => onFilter(e.target.value as T)}
        >
          {filters.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </span>
    </div>
  )
}

// ─── GRADIENT BARS ───────────────────────────────────────────────────────────

export type BarPoint = {
  key: string
  label: string
  longLabel: string
  value: number
  /** Rows for the hover card. */
  rows: { label: string; value: string }[]
}

/**
 * One column per period, soft-faded, with the hovered one solid.
 *
 * The fade earns its place: twelve saturated bars read as twelve competing
 * blocks and the eye has nowhere to land. Fading them lets the selected
 * column be the only solid thing on the chart, which is what makes the
 * hover feel like a spotlight rather than a highlight.
 *
 * The y-axis is drawn because a glance-level chart should be legible without
 * interacting with it at all — the hover card is a bonus, not the only way to
 * read a value.
 */
export function GradientBars({
  points, onSelect, height = 230,
}: {
  points: BarPoint[]
  onSelect?: (key: string) => void
  height?: number
}) {
  const [hover, setHover] = useState<string | null>(null)
  if (points.length === 0) return null

  const peak = Math.max(1, ...points.map(p => p.value))
  // A friendly ceiling so the axis reads 0 / 25k / 50k rather than 0 / 23.7k.
  const step = Math.pow(10, Math.floor(Math.log10(peak)))
  const ceiling = Math.ceil(peak / (step / 2)) * (step / 2) || 1
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const active = hover ?? null

  return (
    <div className="gb" style={{ height }} onMouseLeave={() => setHover(null)}>
      <div className="gb-axis" aria-hidden="true">
        {ticks.slice().reverse().map(t => (
          <span key={t} className="gb-tick">
            <em>{t === 0 ? '0' : shortMoney(ceiling * t)}</em>
            <i />
          </span>
        ))}
      </div>

      <div className="gb-cols">
        {points.map(p => {
          const h = Math.max(1.5, (p.value / ceiling) * 100)
          const on = active === p.key
          const Cmp = onSelect ? 'button' : 'div'
          return (
            <Cmp
              key={p.key}
              className={`gb-col${on ? ' on' : ''}`}
              {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(p.key) } : {})}
              onMouseEnter={() => setHover(p.key)}
              onFocus={() => setHover(p.key)}
              aria-label={`${p.longLabel}: ${fmtCurrency(p.value)}`}
            >
              <span className="gb-bar" style={{ height: `${h}%` }}>
                {on && <span className="gb-knob" aria-hidden="true" />}
              </span>
              <span className="gb-x">{p.label}</span>

              {/* Pinned to the top of the plot rather than hung off the bar.
                  Anchoring it to the bar meant a tall month pushed it up out
                  of the chart and across the panel heading; anchoring it here
                  means it is always inside the frame, whatever the height.
                  It may cross a neighbouring bar, which is fine — it is a
                  transient overlay and the column it belongs to is lit. */}
              {on && (
                <span className="gb-tip" role="status">
                  <b>{p.longLabel}</b>
                  {p.rows.map((r, i) => (
                    <span key={i} className="gb-tip-row">
                      <span>{r.label}</span>
                      <em>{r.value}</em>
                    </span>
                  ))}
                </span>
              )}
            </Cmp>
          )
        })}
      </div>
    </div>
  )
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

export const PANEL_CSS = `
  /* ── Stat cards ───────────────────────────────────────────────────────────
     Icon tile, name, subtitle, one big figure, a change pill, and a footer
     that is a door. Exactly one card per screen is filled. */
  .fin .stats {
    display: grid; gap: 16px; margin-bottom: 18px;
    grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  }
  .fin .statc {
    position: relative; display: flex; flex-direction: column;
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 20px 20px 0; min-width: 0;
    transition: box-shadow 0.18s var(--ease), border-color 0.18s var(--ease);
  }
  .fin .statc:hover { box-shadow: var(--lift-1); }
  .fin .statc.primary {
    background: linear-gradient(152deg, #15854a 0%, #0f7a43 46%, #0c6a3a 100%);
    border-color: transparent; color: #fff;
  }
  .fin .statc.primary:hover { box-shadow: 0 10px 30px rgba(15,122,67,0.26); }

  .fin .statc-top { display: flex; align-items: flex-start; gap: 12px; }
  .fin .statc-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 42px; height: 42px; border-radius: 13px; flex-shrink: 0;
    background: var(--surface-2); color: var(--ink-2);
    border: 1px solid var(--line-2);
  }
  .fin .statc.primary .statc-icon {
    background: rgba(255,255,255,0.18); color: #fff; border-color: rgba(255,255,255,0.22);
  }
  .fin .statc.bad .statc-icon  { background: var(--late-bg); color: var(--late); border-color: var(--late-line); }
  .fin .statc.warn .statc-icon { background: var(--fee-bg);  color: var(--fee);  border-color: var(--fee-line); }
  .fin .statc-id { min-width: 0; padding-top: 1px; }
  .fin .statc-title { font-size: 15.5px; font-weight: 600; letter-spacing: -0.016em; }
  .fin .statc-sub {
    font-size: 12px; color: var(--ink-3); margin-top: 2px; line-height: 1.45;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .statc.primary .statc-sub { color: rgba(255,255,255,0.72); }

  .fin .statc-figure { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
  .fin .statc-value {
    font-size: 30px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .fin .statc.bad  .statc-value { color: var(--late); }
  .fin .statc.warn .statc-value { color: var(--fee); }
  .fin .statc.primary .statc-value { color: #fff; }
  .fin .statc-foot {
    font-size: 12px; color: var(--ink-3); margin-top: 8px; line-height: 1.5;
  }
  .fin .statc.primary .statc-foot { color: rgba(255,255,255,0.74); }

  .fin .statc-link {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: auto; padding: 14px 0; border-top: 1px solid var(--line-2);
    font-size: 13.5px; font-weight: 500; color: var(--ink-2); text-decoration: none;
    letter-spacing: -0.01em;
  }
  .fin .statc-link:hover { color: var(--accent); }
  .fin .statc.primary .statc-link {
    border-top-color: rgba(255,255,255,0.2); color: #fff;
  }
  .fin .statc.primary .statc-link:hover { color: #fff; opacity: 0.85; }
  .fin .statc-figure + .statc-link { margin-top: 18px; }

  /* ── Change pill ──────────────────────────────────────────────────────── */
  .fin .tpill {
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums;
    padding: 2px 8px; border-radius: 980px; white-space: nowrap;
    background: var(--idle-bg); color: var(--ink-2);
  }
  .fin .tpill.good { background: var(--in-bg);   color: var(--in); }
  .fin .tpill.bad  { background: var(--late-bg); color: var(--late); }
  .fin .tpill.on-dark { background: rgba(255,255,255,0.2); color: #fff; }

  /* ── Panels in the glance layer ───────────────────────────────────────── */
  .fin .gpanel {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 18px 20px 20px; min-width: 0;
  }
  .fin .gpanel-hd {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 14px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .fin .gpanel-title { font-size: 16px; font-weight: 600; letter-spacing: -0.018em; }
  .fin .gpanel-sub { font-size: 12px; color: var(--ink-3); margin-top: 3px; line-height: 1.5; }
  .fin .gpanel-big {
    font-size: 28px; font-weight: 600; letter-spacing: -0.028em;
    font-variant-numeric: tabular-nums; margin-top: 2px;
  }

  /* ── Mini cards ───────────────────────────────────────────────────────── */
  .fin .minis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .fin .minic {
    display: block; background: var(--surface-2); border: 1px solid var(--line-2);
    border-radius: 14px; padding: 13px 14px; text-decoration: none; color: inherit;
    min-width: 0; transition: border-color 0.15s, background 0.15s;
  }
  .fin .minic:hover { border-color: var(--line); background: var(--surface); }
  .fin .minic-top { display: flex; align-items: center; gap: 8px; }
  .fin .minic-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
  }
  .fin .minic-label {
    flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .minic-more { color: var(--ink-3); font-size: 14px; line-height: 1; flex-shrink: 0; }
  .fin .minic-value {
    font-size: 19px; font-weight: 600; letter-spacing: -0.022em; margin-top: 10px;
    font-variant-numeric: tabular-nums;
  }
  .fin .minic-caption { font-size: 11px; color: var(--ink-3); margin-top: 2px; }
  .fin .minic .sdot { margin-top: 8px; }

  /* ── Status dot ───────────────────────────────────────────────────────── */
  .fin .sdot {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11.5px; font-weight: 500; letter-spacing: -0.005em;
  }
  .fin .sdot i { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: currentColor; }
  .fin .sdot.good { color: var(--in); }
  .fin .sdot.bad  { color: var(--late); }
  .fin .sdot.warn { color: var(--fee); }
  .fin .sdot.idle { color: var(--ink-3); }

  /* ── Gradient bars ────────────────────────────────────────────────────── */
  /* The top padding is headroom for the hover card, which hangs off the top
     of its bar. Without it a tall month's card lands on the panel heading. */
  .fin .gb { position: relative; display: flex; padding-top: 10px; }
  .fin .gb-axis {
    display: flex; flex-direction: column; justify-content: space-between;
    width: 100%; position: absolute; inset: 10px 0 26px 0; pointer-events: none;
  }
  .fin .gb-tick { display: flex; align-items: center; gap: 8px; }
  .fin .gb-tick em {
    font-style: normal; font-size: 10.5px; color: var(--ink-3); width: 34px;
    text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums;
  }
  .fin .gb-tick i { flex: 1; height: 1px; background: var(--line-2); }
  .fin .gb-cols {
    position: relative; display: flex; align-items: flex-end; gap: 10px;
    flex: 1; margin-left: 42px; padding-bottom: 26px;
  }
  .fin .gb-col {
    position: relative; flex: 1 1 0; min-width: 0; height: 100%;
    display: flex; flex-direction: column; justify-content: flex-end;
    background: none; border: none; padding: 0; cursor: pointer;
  }
  .fin .gb-bar {
    position: relative; display: block; width: 100%; border-radius: 9px 9px 0 0;
    /* Faded by default so the selected column can be the only solid thing. */
    background: linear-gradient(180deg, rgba(15,122,67,0.42) 0%, rgba(15,122,67,0.06) 100%);
    transition: background 0.18s, height 0.35s var(--ease);
  }
  .fin .gb-col:hover .gb-bar, .fin .gb-col.on .gb-bar {
    background: linear-gradient(180deg, #178d4e 0%, #0f7a43 72%, #0d6f3c 100%);
  }
  .fin .gb-knob {
    position: absolute; top: -5px; left: 50%; transform: translateX(-50%);
    width: 11px; height: 11px; border-radius: 50%;
    background: #0f7a43; border: 2.5px solid var(--surface);
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
  }
  .fin .gb-x {
    position: absolute; bottom: 0; left: 0; right: 0; text-align: center;
    font-size: 11.5px; color: var(--ink-3); white-space: nowrap;
  }
  .fin .gb-col.on .gb-x { color: var(--ink); font-weight: 600; }

  /* The hover card. Dark, so it reads as an overlay rather than another
     panel, and anchored to the column it belongs to. */
  .fin .gb-tip {
    position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
    background: #16191c; color: #fff; border-radius: 11px; padding: 10px 13px;
    min-width: 168px; z-index: 6; pointer-events: none;
    box-shadow: 0 10px 26px rgba(0,0,0,0.22); text-align: left;
  }
  .fin .gb-tip b { display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 5px; }
  .fin .gb-tip-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    font-size: 11.5px; color: rgba(255,255,255,0.72); line-height: 1.7;
  }
  .fin .gb-tip-row em {
    font-style: normal; color: #fff; font-weight: 600; font-variant-numeric: tabular-nums;
  }

  /* ── Admin data table ─────────────────────────────────────────────────── */
  .fin .atable { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .fin .atable thead th {
    text-align: left; padding: 10px 14px; font-size: 11.5px; font-weight: 500;
    color: var(--ink-3); border-bottom: 1px solid var(--line);
    white-space: nowrap; letter-spacing: -0.005em;
  }
  .fin .atable tbody td {
    padding: 13px 14px; border-bottom: 1px solid var(--line-2); vertical-align: middle;
  }
  .fin .atable tbody tr:last-child td { border-bottom: none; }
  .fin .atable tbody tr { cursor: pointer; transition: background 0.12s; }
  .fin .atable tbody tr:hover { background: var(--surface-2); }
  .fin .atable td.num, .fin .atable th.num {
    text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .fin .at-who { display: flex; align-items: center; gap: 11px; min-width: 0; }
  /* The text column next to the avatar. Without this the name and the line
     under it are two inline spans and run together on one line. */
  .fin .at-who > span:last-child { min-width: 0; }
  .fin .at-avatar {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    font-size: 11px; font-weight: 700;
  }
  .fin .at-name {
    display: block; font-weight: 500; letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .at-sub {
    display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 1px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .at-more {
    color: var(--ink-3); font-size: 15px; line-height: 1; text-align: right;
  }

  /* ── Section band ─────────────────────────────────────────────────────────
     The line between the page header and the first figure: what this is, and
     over what window. */
  .fin .band {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin: 4px 0 16px;
  }
  .fin .band-id { min-width: 0; }
  .fin .band-title { font-size: 20px; font-weight: 600; letter-spacing: -0.022em; }
  .fin .band-sub { font-size: 13px; color: var(--ink-2); margin-top: 3px; line-height: 1.5; }
  .fin .band-tools { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }

  /* ── Select chip ──────────────────────────────────────────────────────────
     A native <select> wearing a pill. The select is laid over the whole chip
     at zero opacity, so the hit area is the chip and the picker is the
     platform's own. */
  .fin .chipsel {
    position: relative; display: inline-flex; align-items: center; gap: 7px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 980px;
    padding: 0 13px; min-height: 36px; color: var(--ink-2);
    font-size: 13.5px; font-weight: 500; letter-spacing: -0.01em; white-space: nowrap;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .chipsel:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  .fin .chipsel:focus-within { border-color: var(--accent); }
  .fin .chipsel-label { color: var(--ink); }
  .fin .chipsel select {
    position: absolute; inset: 0; width: 100%; height: 100%;
    opacity: 0; cursor: pointer; font-family: inherit; font-size: 16px;
  }

  /* ── Toolbar inside a panel header ────────────────────────────────────── */
  .fin .ptools { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .fin .psearch {
    display: flex; align-items: center; gap: 8px;
    border: 1px solid var(--line); border-radius: 980px; padding: 0 14px;
    min-height: 36px; background: var(--surface); color: var(--ink-3); min-width: 210px;
    transition: border-color 0.15s var(--ease);
  }
  .fin .psearch:focus-within { border-color: var(--accent); }
  .fin .psearch input {
    border: none; outline: none; background: none; font-family: inherit;
    font-size: 13.5px; color: var(--ink); width: 100%; min-width: 0;
  }
  .fin .psearch input::-webkit-search-cancel-button { cursor: pointer; }

  /* ── Segmented control, pill form ─────────────────────────────────────────
     The chart's window switch. The selected side is a filled green pill with a
     dot, rather than the white-on-grey tab used elsewhere: this control sits
     inside a panel header beside a large figure, where the quieter form
     disappears entirely. */
  .fin .seg.pill { background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 980px; }
  .fin .seg.pill .seg-btn { border-radius: 980px; padding: 6px 14px; min-height: 30px; }
  .fin .seg.pill .seg-btn.on {
    background: var(--accent); color: #fff; box-shadow: none; font-weight: 500;
  }
  .fin .seg.pill .seg-btn.on::before {
    content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff;
  }
  .fin .seg.pill .seg-btn:hover:not(.on) { color: var(--ink); }

  @media (max-width: 900px) {
    .fin .minis { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .fin .band { align-items: flex-start; }
    .fin .band-tools, .fin .ptools { width: 100%; }
    .fin .psearch { flex: 1; min-width: 0; }
    .fin .statc { padding: 16px 16px 0; }
    .fin .statc-value { font-size: 26px; }
    .fin .gb-cols { gap: 6px; margin-left: 36px; }
    .fin .gb-tip { min-width: 140px; }
  }
`
