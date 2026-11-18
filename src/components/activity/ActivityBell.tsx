'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon from '@/components/NavIcons'
import ActivityFeed, { ACTIVITY_CSS } from './ActivityFeed'
import {
  badgeLabel, filterEvents, laneCounts, activityHref,
  type ActivityFilter,
} from '@/lib/landlordActivity'
import {
  useLandlordActivity, markActivityRead, refreshActivity,
} from '@/lib/useLandlordActivity'

/**
 * The bell: one inbox for everything that happened.
 *
 * It replaced a dropdown that showed three kinds of notification — lead in,
 * pre-screen filled, tour booked — while rent, failed cards, bounced email and
 * portal sign-ins were only findable by going and looking for them. That split
 * is the failure every notification-centre write-up leads with: two inboxes,
 * so the badge stops being a reliable answer to "is anything waiting for me",
 * and once it is unreliable it gets cleared without being read.
 *
 * The shape is the conventional one, for the good reason that every landlord
 * already knows it from Buildium, DoorLoop, GitHub and their bank: bell with
 * an honest count, a panel of recent rows with one quiet unread signal, tabs
 * that narrow without reloading, an explicit "mark all read", and a footer
 * into the full history. Nothing here is novel, and that is the point — a
 * notification centre is the last place to teach someone a new idiom.
 *
 * Two decisions worth keeping:
 *
 *   • Opening the panel does NOT mark anything read. Marking on open is a
 *     common convention and it is wrong for a feed with three months of
 *     history behind it: a landlord who glances at the bell between tasks
 *     would lose their own place, permanently, with no way back.
 *   • "Mark all read" marks up to the newest row the panel actually rendered,
 *     not to `now`. Anything that synced in while the panel was open is still
 *     waiting afterwards, because clearing something nobody was shown is how
 *     an inbox loses a bounced rent reminder for good.
 */

type Tab = 'all' | 'unread' | 'attention'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all',       label: 'All' },
  { id: 'unread',    label: 'Unread' },
  { id: 'attention', label: 'Needs attention' },
]

/** The panel is a peek, not the archive — the footer link is the archive. */
const PANEL_ROWS = 12

const CSS = `
  .act-bell { position: relative; flex-shrink: 0; margin-right: 8px; }
  .act-bell-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 8px;
    background: none; border: none; cursor: pointer; position: relative;
    color: var(--nav-color); transition: background 0.15s, color 0.15s;
  }
  .act-bell-btn:hover, .act-bell-btn.open { background: var(--nav-hover-bg); color: var(--nav-hover-color); }
  .act-bell-badge {
    position: absolute; top: 3px; right: 2px;
    background: #ef4444; color: #fff;
    font-size: 9px; font-weight: 700; line-height: 1;
    min-width: 16px; height: 16px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    padding: 0 4px; font-family: 'DM Sans', sans-serif;
    border: 2px solid var(--tb-bg);
  }

  .act-panel {
    position: absolute; top: calc(100% + 8px); right: 0;
    width: 400px; max-width: calc(100vw - 24px);
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px;
    box-shadow: 0 18px 44px rgba(15,23,42,0.16); z-index: 400;
    font-family: 'DM Sans', sans-serif; overflow: hidden;
  }
  .act-panel-hd {
    display: flex; align-items: center; gap: 10px;
    padding: 13px 14px 11px; border-bottom: 1px solid #f1f5f9;
  }
  .act-panel-ttl { font-size: 13.5px; font-weight: 700; color: #0f172a; }
  .act-panel-n {
    font-size: 10.5px; font-weight: 700; color: #b91c1c;
    background: #fef2f2; border-radius: 20px; padding: 2px 8px;
  }
  .act-panel-mark {
    margin-left: auto; background: none; border: none; cursor: pointer;
    font-family: inherit; font-size: 11.5px; font-weight: 700; color: #2563eb;
    padding: 4px 2px;
  }
  .act-panel-mark:hover { text-decoration: underline; }
  .act-panel-mark:disabled { color: #cbd5e1; cursor: default; text-decoration: none; }

  .act-tabs { display: flex; gap: 2px; padding: 9px 10px; border-bottom: 1px solid #f1f5f9; }
  .act-tab {
    background: none; border: none; cursor: pointer; font-family: inherit;
    font-size: 12px; font-weight: 600; color: #64748b;
    padding: 5px 10px; border-radius: 7px;
  }
  .act-tab:hover { background: #f1f5f9; color: #0f172a; }
  .act-tab.on { background: #0f172a; color: #fff; }
  .act-tab-n { opacity: 0.7; margin-left: 4px; font-variant-numeric: tabular-nums; }

  .act-panel-list { max-height: min(60vh, 440px); overflow-y: auto; padding: 4px 8px 8px; }
  .act-panel-ft {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 14px; border-top: 1px solid #f1f5f9; background: #fcfdfe;
  }
  .act-panel-ft a {
    font-size: 12.5px; font-weight: 700; color: #0f172a; text-decoration: none;
  }
  .act-panel-ft a:hover { text-decoration: underline; }
  .act-panel-ft .act-panel-hint { font-size: 11px; color: #94a3b8; }
  .act-panel-loading { padding: 30px 16px; text-align: center; font-size: 12.5px; color: #94a3b8; }

  @media (max-width: 520px) {
    .act-panel { position: fixed; top: 58px; right: 12px; left: 12px; width: auto; }
  }
`

export default function ActivityBell() {
  const [tab, setTab] = useState<Tab>('all')
  const wrap = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  // Open is stored as *where* it was opened, not as a boolean, so navigating
  // closes the panel by derivation rather than by an effect that fires a
  // render after the new page has already painted with the panel still up.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = openedAt === pathname

  const [now, setNow] = useState(() => new Date())
  const toggle = () => {
    if (open) { setOpenedAt(null); return }
    setOpenedAt(pathname)
    // The clock is reset here rather than in an effect: opening is the event,
    // and "4m ago" must be true the instant the panel appears.
    setNow(new Date())
    void refreshActivity()
  }
  const close = () => setOpenedAt(null)

  const { events, lastReadAt, unreadCount, loaded } = useLandlordActivity(true)

  // One clock for the whole panel, ticking a minute at a time. Reading
  // `new Date()` inside each row would make every row's "4m ago" disagree
  // slightly, and would re-render the list on any unrelated state change.
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const counts = useMemo(() => laneCounts(events, lastReadAt), [events, lastReadAt])

  const shown = useMemo(() => {
    const filter: ActivityFilter = {
      unreadOnly: tab === 'unread',
      attentionOnly: tab === 'attention',
    }
    return filterEvents(events, filter, lastReadAt).slice(0, PANEL_ROWS)
  }, [events, lastReadAt, tab])

  // The newest row we have actually put on screen — see the note at the top
  // about why "mark all read" stops here rather than at `now`.
  const markCeiling = events[0]?.occurred_at

  const label = badgeLabel(unreadCount)

  return (
    <div className="act-bell" ref={wrap}>
      <style>{CSS}{ACTIVITY_CSS}</style>
      <button
        className={`act-bell-btn${open ? ' open' : ''}`}
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Activity — ${unreadCount} unread` : 'Activity'}
        aria-expanded={open}
      >
        <Icon name="bell" size={18} />
        {label && <span className="act-bell-badge">{label}</span>}
      </button>

      {open && (
        <div className="act-panel" role="dialog" aria-label="Activity">
          <div className="act-panel-hd">
            <span className="act-panel-ttl">Activity</span>
            {unreadCount > 0 && <span className="act-panel-n">{unreadCount} new</span>}
            <button
              className="act-panel-mark"
              disabled={unreadCount === 0}
              onClick={() => void markActivityRead(markCeiling)}
            >
              Mark all read
            </button>
          </div>

          <div className="act-tabs">
            {TABS.map(t => {
              const n = t.id === 'all' ? null
                : t.id === 'unread' ? counts.unread
                : counts.attention
              return (
                <button
                  key={t.id}
                  className={`act-tab${tab === t.id ? ' on' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {n != null && n > 0 && <span className="act-tab-n">{n}</span>}
                </button>
              )
            })}
          </div>

          <div className="act-panel-list">
            {!loaded ? (
              <div className="act-panel-loading">Loading…</div>
            ) : (
              <ActivityFeed
                events={shown}
                lastReadAt={lastReadAt}
                dense
                now={now}
                empty={
                  tab === 'unread'
                    ? { title: 'You are all caught up', sub: 'Nothing new since you last looked.' }
                    : tab === 'attention'
                    ? { title: 'Nothing needs you', sub: 'No failed payments, bounced email or waiting leads.' }
                    : {
                        title: 'No activity yet',
                        sub: 'Rent, email, sign-ins and new leads will show up here as they happen.',
                      }
                }
              />
            )}
          </div>

          <div className="act-panel-ft">
            <Link href={activityHref()} onClick={close}>
              View all activity →
            </Link>
            <span className="act-panel-hint">Last 3 months</span>
          </div>
        </div>
      )}
    </div>
  )
}
