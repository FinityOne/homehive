'use client'

/**
 * Activity — everything that happened, in one list.
 *
 * This is the archive behind the bell. The bell answers "is anything waiting
 * for me"; this page answers the questions that follow, which are always some
 * version of *when*: when did they last pay, when did we last write to them,
 * when did they last sign in, has this address been bouncing all term.
 *
 * It is one list with narrowing applied, never several lists. The lane chips,
 * the tabs and the search box all filter the same fetched page in the client,
 * so moving between them costs nothing — and the embedded feeds elsewhere in
 * the portal link *into* here with a scope already applied, which is what
 * makes them a doorway rather than a dead end.
 *
 * Deliberately not here: anything the landlord did themselves. A feed that
 * reports your own clicks back at you doubles in size and halves in value.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ActivityFeed, { ACTIVITY_CSS } from '@/components/activity/ActivityFeed'
import {
  ACTIVITY_LANES, LANE_LABEL, filterEvents, laneCounts,
  type ActivityLane, type ActivityFilter,
} from '@/lib/landlordActivity'
import {
  useLandlordActivity, useScopedActivity, markActivityRead,
  loadMoreActivity, refreshActivity,
} from '@/lib/useLandlordActivity'

type Tab = 'all' | 'unread' | 'attention'

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'all',       label: 'All',             hint: 'Everything in the last three months' },
  { id: 'unread',    label: 'Unread',          hint: 'Since you last marked the feed read' },
  { id: 'attention', label: 'Needs attention', hint: 'Failed payments, bounced email, leads waiting' },
]

export default function ActivityPage() {
  const params = useSearchParams()
  const propertyId = params.get('property')
  const planId = params.get('plan')
  const email = params.get('email')
  const laneParam = params.get('lane') as ActivityLane | null
  const scoped = !!(propertyId || planId || email)

  const [tab, setTab] = useState<Tab>('all')
  const [lane, setLane] = useState<ActivityLane | null>(
    laneParam && ACTIVITY_LANES.includes(laneParam) ? laneParam : null,
  )
  const [query, setQuery] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  // One clock for the page, ticking a minute at a time. Every row's "4m ago"
  // is derived from it, so they cannot disagree with each other.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // The whole feed, shared with the bell — so landing here from the bell is
  // instant and the count in the sidebar is the one this page is working from.
  const all = useLandlordActivity(true)
  // A scope is its own query, because the shared list is only the most recent
  // page: a property whose last event was in September would otherwise read as
  // "nothing yet".
  const slice = useScopedActivity({ propertyId, planId, email }, 200)

  useEffect(() => { void refreshActivity() }, [])

  const events = scoped ? slice.events : all.events
  const lastReadAt = scoped ? slice.lastReadAt : all.lastReadAt
  const loaded = scoped ? slice.loaded : all.loaded

  const counts = useMemo(() => laneCounts(events, lastReadAt), [events, lastReadAt])

  const shown = useMemo(() => {
    const filter: ActivityFilter = {
      lane,
      unreadOnly: tab === 'unread',
      attentionOnly: tab === 'attention',
      query,
    }
    return filterEvents(events, filter, lastReadAt)
  }, [events, lastReadAt, lane, tab, query])

  const scopeLabel = email ? email : propertyId ? 'this property' : 'this lease'

  return (
    <>
      <style>{CSS}{ACTIVITY_CSS}</style>
      <div className="ac-wrap">
        <div className="ac-head">
          <div>
            <h1 className="ac-title">Activity</h1>
            <p className="ac-sub">
              Rent and charges as they settle, every email the platform sent and what
              became of it, residents signing in to their portal, and new leads and
              tours — newest first. We keep the last three months.
            </p>
          </div>
          <button
            className="ac-mark"
            disabled={all.unreadCount === 0}
            onClick={() => void markActivityRead(all.events[0]?.occurred_at)}
          >
            {all.unreadCount > 0 ? `Mark all read (${all.unreadCount})` : 'All read'}
          </button>
        </div>

        {scoped && (
          <div className="ac-scope">
            <span>
              Showing activity for <strong>{scopeLabel}</strong> only.
            </span>
            <Link href="/landlord/activity">View everything →</Link>
          </div>
        )}

        <div className="ac-tabs">
          {TABS.map(t => {
            const n = t.id === 'all' ? counts.all
              : t.id === 'unread' ? counts.unread
              : counts.attention
            return (
              <button
                key={t.id}
                className={`ac-tab${tab === t.id ? ' on' : ''}`}
                onClick={() => setTab(t.id)}
                title={t.hint}
              >
                {t.label}
                <span className="ac-tab-n">{n}</span>
              </button>
            )
          })}
        </div>

        <div className="ac-filters">
          <div className="ac-lanes">
            <button
              className={`ac-chip${lane === null ? ' on' : ''}`}
              onClick={() => setLane(null)}
            >
              Everything
            </button>
            {ACTIVITY_LANES.map(l => (
              <button
                key={l}
                className={`ac-chip${lane === l ? ' on' : ''}`}
                onClick={() => setLane(lane === l ? null : l)}
                // Disabled rather than hidden: a chip that vanishes when its
                // lane is empty makes the filter row jump around between
                // visits, and "no email this month" is itself an answer.
                disabled={counts[l] === 0}
              >
                {LANE_LABEL[l]} <span className="ac-chip-n">{counts[l]}</span>
              </button>
            ))}
          </div>
          <input
            className="ac-search"
            placeholder="Search a name, address or subject…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {!loaded ? (
          <div className="ac-loading">Loading…</div>
        ) : (
          <>
            <ActivityFeed
              events={shown}
              lastReadAt={lastReadAt}
              now={now}
              empty={
                query
                  ? { title: 'Nothing matches that', sub: 'Try a tenant’s name, an email address or part of a subject line.' }
                  : tab === 'unread'
                  ? { title: 'You are all caught up', sub: 'Nothing has happened since you last marked the feed read.' }
                  : tab === 'attention'
                  ? { title: 'Nothing needs you', sub: 'No failed payments, no bounced email, no leads waiting on a reply.' }
                  : {
                      title: 'No activity yet',
                      sub: 'As soon as a resident pays, signs in, or the platform emails them, it will appear here.',
                    }
              }
            />

            {/* Only the unscoped feed paginates — a scope fetches its whole
                history in one go, because a per-property feed is short. */}
            {!scoped && all.hasMore && (
              <button
                className="ac-more"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true)
                  await loadMoreActivity()
                  setLoadingMore(false)
                }}
              >
                {loadingMore ? 'Loading…' : 'Load older activity'}
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; }

  .ac-wrap { max-width: 860px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .ac-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .ac-title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .ac-sub { font-size: 13px; color: #64748b; margin-top: 4px; max-width: 560px; line-height: 1.55; }

  .ac-mark {
    background: #0f172a; color: #fff; border: none; border-radius: 9px;
    padding: 9px 15px; font-size: 12.5px; font-weight: 700; cursor: pointer;
    font-family: inherit; flex-shrink: 0;
  }
  .ac-mark:hover { background: #1e293b; }
  .ac-mark:disabled { background: #f1f5f9; color: #94a3b8; cursor: default; }

  .ac-scope {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    flex-wrap: wrap; margin-bottom: 14px; padding: 10px 14px;
    background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 10px;
    font-size: 12.5px; color: #0c4a6e;
  }
  .ac-scope a { font-weight: 700; color: #0369a1; text-decoration: none; white-space: nowrap; }
  .ac-scope a:hover { text-decoration: underline; }

  .ac-tabs { display: flex; gap: 3px; border-bottom: 1.5px solid #e2e8f0; margin-bottom: 14px; }
  .ac-tab {
    background: none; border: none; cursor: pointer; font-family: inherit;
    font-size: 13px; font-weight: 600; color: #64748b;
    padding: 9px 13px; border-bottom: 2.5px solid transparent; margin-bottom: -1.5px;
  }
  .ac-tab:hover { color: #0f172a; }
  .ac-tab.on { color: #0f172a; border-bottom-color: #0f172a; }
  .ac-tab-n { margin-left: 5px; font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; }

  .ac-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .ac-lanes { display: flex; gap: 6px; flex-wrap: wrap; }
  .ac-chip {
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 20px;
    padding: 5px 12px; font-size: 12px; font-weight: 600; color: #475569;
    cursor: pointer; font-family: inherit;
  }
  .ac-chip:hover:not(:disabled) { border-color: #cbd5e1; color: #0f172a; }
  .ac-chip.on { background: #0f172a; border-color: #0f172a; color: #fff; }
  .ac-chip:disabled { color: #cbd5e1; cursor: default; }
  .ac-chip-n { opacity: 0.65; font-variant-numeric: tabular-nums; }

  .ac-search {
    flex: 1; min-width: 190px; border: 1.5px solid #e2e8f0; border-radius: 9px;
    padding: 8px 12px; font-size: 13px; color: #0f172a; font-family: inherit;
    background: #fff; outline: none;
  }
  .ac-search:focus { border-color: #94a3b8; }

  .ac-loading { padding: 50px 20px; text-align: center; font-size: 13.5px; color: #94a3b8; }
  .ac-more {
    display: block; width: 100%; margin-top: 14px;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
    padding: 11px; font-size: 12.5px; font-weight: 700; color: #475569;
    cursor: pointer; font-family: inherit;
  }
  .ac-more:hover { border-color: #cbd5e1; color: #0f172a; }

  @media (max-width: 560px) {
    .ac-wrap { padding: 20px 14px 90px; }
    .ac-tabs { overflow-x: auto; }
  }
`
