'use client'

import Link from 'next/link'
import Icon from '@/components/NavIcons'
import {
  groupByDay, metaFor, toneFor, isUnread, relativeTime, subtitleFor,
  emailOutcome, OUTCOME_LABEL, needsAttention,
  type ActivityEvent,
} from '@/lib/landlordActivity'

/**
 * The row, and the day-grouped list of rows.
 *
 * One component, four homes: the bell panel, the full Activity page, and the
 * compact feeds embedded on a property and on a lease. They differ by `dense`
 * and by what they pass in — never by how an event is drawn, because an event
 * that looks like two different things in two places is an event a landlord
 * has to decode twice.
 *
 * Built for scanning rather than reading. Each row is a fixed three-part
 * shape — tone dot, title, time — so the eye can run down one column at a
 * time, which is the whole reason a feed beats the same facts spread across
 * five pages.
 */

/**
 * State colours, taken from the money design system wherever there is one.
 *
 * This feed appears under two different chromes: the portal shell, which has
 * no finance tokens, and the tenant record and financials pages, which are
 * wrapped in `.fin` and define the whole palette. Reading the tokens with a
 * literal fallback makes one component native in both — rather than a feed
 * that is subtly the wrong green on exactly the page where it sits beside the
 * rent figures it is describing.
 *
 * These are STATES. The accent is never used for one: in this product a filled
 * pill or an underlined link means "pressable", and a row that wears an
 * action's colour while being a fact teaches the landlord that colour means
 * nothing.
 */
const TONE: Record<string, { bg: string; fg: string }> = {
  good:    { bg: 'var(--in-bg, #ecfdf5)',     fg: 'var(--in, #047857)' },
  bad:     { bg: 'var(--late-bg, #fef2f2)',   fg: 'var(--late, #b91c1c)' },
  warn:    { bg: 'var(--fee-bg, #fffbeb)',    fg: 'var(--fee, #b45309)' },
  info:    { bg: 'var(--flight-bg, #f0f9ff)', fg: 'var(--flight, #0369a1)' },
  neutral: { bg: 'var(--idle-bg, #f1f5f9)',   fg: 'var(--ink-2, #64748b)' },
}

export const ACTIVITY_CSS = `
  .act-day { margin-bottom: 2px; }
  .act-day-hd {
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: baseline; gap: 8px;
    padding: 10px 2px 7px; background: var(--surface, #fff);
    font-size: 11px; font-weight: 700; color: var(--ink-3, #94a3b8);
    text-transform: uppercase; letter-spacing: 0.6px;
  }
  .act-day-hd .act-day-n {
    font-weight: 600; letter-spacing: 0; text-transform: none;
    color: var(--ink-3, #cbd5e1); opacity: 0.75;
  }

  .act-row {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 11px 12px; border-radius: 10px;
    text-decoration: none; color: inherit;
    border: 1px solid transparent; background: transparent;
  }
  a.act-row:hover { background: var(--surface-2, #f8fafc); border-color: var(--line, #e2e8f0); }
  /* Unread is ONE quiet signal — a tinted ground and a dot, never a badge on
     every row. A list where everything new shouts has no hierarchy left. */
  .act-row.unread { background: var(--surface-2, #fcfdff); }

  .act-mark {
    flex-shrink: 0; width: 30px; height: 30px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
  }
  .act-main { flex: 1; min-width: 0; }
  .act-title {
    font-size: 13.5px; font-weight: 600; color: var(--ink, #0f172a); line-height: 1.35;
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  }
  .act-sub {
    font-size: 12px; color: var(--ink-2, #64748b); margin-top: 2px; line-height: 1.45;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .act-row.dense .act-sub { font-size: 11.5px; }
  .act-chip {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.5px; padding: 2px 6px; border-radius: 5px;
  }
  .act-when {
    flex-shrink: 0; display: flex; align-items: center; gap: 7px;
    font-size: 11px; color: var(--ink-3, #94a3b8); font-variant-numeric: tabular-nums;
    padding-top: 2px; white-space: nowrap;
  }
  .act-unread-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent, #2563eb); flex-shrink: 0;
  }

  .act-empty {
    padding: 30px 20px; text-align: center;
    border: 1px dashed var(--line, #e2e8f0); border-radius: 12px;
    background: var(--surface-2, #fcfdfe);
  }
  .act-empty-t { font-size: 13.5px; font-weight: 600; color: var(--ink-2, #475569); }
  .act-empty-s { font-size: 12px; color: var(--ink-3, #94a3b8); margin-top: 4px; line-height: 1.5; }
`

export function ActivityRow({
  event, lastReadAt, dense = false, now,
}: {
  event: ActivityEvent
  lastReadAt: string | null
  dense?: boolean
  /** Passed in so a long-lived list does not re-render on every tick. */
  now?: Date
}) {
  const meta = metaFor(event.kind)
  const tone = TONE[toneFor(event)] ?? TONE.neutral
  const unread = isUnread(event, lastReadAt)
  const outcome = emailOutcome(event)
  const attention = needsAttention(event)

  const inner = (
    <>
      <span className="act-mark" style={{ background: tone.bg, color: tone.fg }}>
        <Icon name={meta.icon} size={dense ? 15 : 16} strokeWidth={2} />
      </span>
      <span className="act-main">
        <span className="act-title">
          {event.title}
          {/* The outcome is the only thing that makes a send worth a second
              look, so it rides on the title rather than hiding in the
              subtitle. Only when it is not the boring answer. */}
          {outcome && outcome !== 'sent' && outcome !== 'delivered' && (
            <span className="act-chip" style={{ background: tone.bg, color: tone.fg }}>
              {OUTCOME_LABEL[outcome]}
            </span>
          )}
          {attention && !outcome && (
            <span className="act-chip" style={{ background: tone.bg, color: tone.fg }}>
              {meta.label}
            </span>
          )}
        </span>
        {subtitleFor(event) && <span className="act-sub">{subtitleFor(event)}</span>}
      </span>
      <span className="act-when">
        {relativeTime(event.occurred_at, now)}
        {unread && <span className="act-unread-dot" aria-label="unread" />}
      </span>
    </>
  )

  const className = `act-row${unread ? ' unread' : ''}${dense ? ' dense' : ''}`

  // A row with nowhere to go is not a link. Rendering it as one — the common
  // shortcut — gives a landlord a pointer cursor and a dead click, and after
  // two of those they stop trying the rows that do work.
  return event.href
    ? <Link href={event.href} className={className}>{inner}</Link>
    : <div className={className}>{inner}</div>
}

export default function ActivityFeed({
  events, lastReadAt, dense = false, now, showDays = true, empty,
}: {
  events: ActivityEvent[]
  lastReadAt: string | null
  dense?: boolean
  now?: Date
  /** Off for the short embedded feeds, where a day heading per row is noise. */
  showDays?: boolean
  empty?: { title: string; sub?: string }
}) {
  if (events.length === 0) {
    return (
      <div className="act-empty">
        <div className="act-empty-t">{empty?.title ?? 'Nothing here yet'}</div>
        {empty?.sub && <div className="act-empty-s">{empty.sub}</div>}
      </div>
    )
  }

  if (!showDays) {
    return (
      <div>
        {events.map(e => (
          <ActivityRow key={e.id} event={e} lastReadAt={lastReadAt} dense={dense} now={now} />
        ))}
      </div>
    )
  }

  return (
    <div>
      {groupByDay(events, now).map(day => (
        <div className="act-day" key={day.day}>
          <div className="act-day-hd">
            {day.label}
            <span className="act-day-n">
              {day.events.length} {day.events.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          {day.events.map(e => (
            <ActivityRow key={e.id} event={e} lastReadAt={lastReadAt} dense={dense} now={now} />
          ))}
        </div>
      ))}
    </div>
  )
}
