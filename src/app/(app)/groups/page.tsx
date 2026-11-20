'use client'

/**
 * My groups — the roommate groups this renter has joined.
 *
 * Restyled onto the portal's own design system, and four things about it
 * changed beyond colour:
 *
 *   • **Opening a group no longer opens a tab.** It was `window.open(…,
 *     '_blank')`, so moving between a group and the portal spawned a tab each
 *     time and the back button never came home. It is a link now, which also
 *     means middle-click and cmd-click do what the person expects.
 *   • **It stops greeting them.** The dashboard greets by name; a second
 *     "Good evening, Sam" one level in reads as though they have arrived
 *     somewhere new. This page says what it is and how many groups are on it.
 *   • **Decorative emoji are gone**, replaced by the portal's icon family. The
 *     group's own emoji stays — that one is the group's chosen face, chosen by
 *     a member, and it is content rather than furniture.
 *   • **One action per card, in the portal's primary colour.** Every card used
 *     to carry a gold gradient button, so a list of four groups had four
 *     competing calls to action in the one colour reserved for "the thing we
 *     want pressed".
 */

import { useEffect, useState } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import Link from 'next/link'
import Icon from '@/components/NavIcons'
import { TenantStyles, PageHead, Empty } from '@/components/tenant/TenantFrame'

type LastMessage = {
  content: string
  sender_name: string
  created_at: string
  is_bot: boolean
}

type GroupCard = {
  id: string
  name: string
  emoji: string
  description: string | null
  gender_preference: string
  share_token: string
  property_slug: string | null
  property_name: string | null
  member_count: number
  joined_at: string | null
  room_id: string | null
  room_name: string | null
  last_message: LastMessage | null
}

/**
 * The group's own rule about who may join, as a badge.
 *
 * Kept on the portal's state tones rather than pink/blue: a group restricted
 * to women is not a *warning* and a mixed group is not a *success*, so the
 * three read as three neutral facts, distinguished by their words.
 */
function genderBadge(pref: string): { label: string; tone: string } {
  if (pref === 'girls_only') return { label: 'Women only', tone: 'accent' }
  if (pref === 'boys_only') return { label: 'Men only', tone: 'accent' }
  return { label: 'Open to all', tone: 'idle' }
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export default function MyGroupsPage() {
  const [groups, setGroups] = useState<GroupCard[]>([])
  const [loading, setLoading] = useState(true)
  /** A failed fetch is not the same fact as "you have no groups". */
  const [failed, setFailed] = useState(false)

  useEffect(() => { document.title = 'My groups — My Portal | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser()
      if (!user) { setLoading(false); return }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }

      try {
        const res = await fetch('/api/user/groups', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) throw new Error(String(res.status))
        const d = await res.json()
        setGroups(d.groups || [])
      } catch {
        setFailed(true)
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <>
      <TenantStyles css={CSS} />
      <div className="tp tp-wrap wide">
        <PageHead
          title="My groups"
          lede={
            loading ? 'Loading your roommate groups…'
              : failed ? 'We couldn’t load your groups just now.'
              : groups.length > 0
                ? `You're in ${groups.length} roommate group${groups.length !== 1 ? 's' : ''}.`
                : 'Join a group to plan a move with other renters.'
          }
        />

        {loading ? (
          <div className="mg-grid">
            {[0, 1].map(i => (
              <div key={i} className="tp-card" style={{ padding: 20 }}>
                <div className="tp-sk tp-sk-line" style={{ height: 22, width: '58%' }} />
                <div className="tp-sk tp-sk-line" style={{ width: '38%' }} />
                <div className="tp-sk tp-sk-line" style={{ height: 58, marginTop: 8 }} />
                <div className="tp-sk tp-sk-line" style={{ height: 40, marginTop: 10, marginBottom: 0 }} />
              </div>
            ))}
          </div>
        ) : failed ? (
          <div className="tp-note warn">
            <strong>We couldn&apos;t load your groups.</strong> Refresh the page to try again —
            nothing has changed about the groups you are in.
          </div>
        ) : groups.length === 0 ? (
          <Empty
            icon="users"
            title="No groups yet"
            action={<Link href="/homes" className="tp-btn tp-btn-primary">Browse homes near ASU</Link>}
          >
            A roommate group is how renters looking at the same home talk to each other, split the
            rent and tell the landlord who is taking which room. Join one from any listing.
          </Empty>
        ) : (
          <div className="mg-grid">
            {groups.map(g => {
              const badge = genderBadge(g.gender_preference)
              return (
                <div key={g.id} className="tp-card mg-card">
                  <div className="tp-card-bd">
                    <div className="mg-hd">
                      {/* The group's own emoji: content, picked by a member. */}
                      <span className="mg-emoji" aria-hidden="true">{g.emoji}</span>
                      <div style={{ minWidth: 0 }}>
                        <h2 className="mg-name">{g.name}</h2>
                        {g.property_name && (
                          g.property_slug ? (
                            <a href={`/homes/${g.property_slug}`} className="mg-prop">
                              <Icon name="home" size={13} />{g.property_name}
                            </a>
                          ) : (
                            <span className="mg-prop plain">
                              <Icon name="home" size={13} />{g.property_name}
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    <div className="mg-meta">
                      <span className={`tp-badge ${badge.tone}`}>{badge.label}</span>
                      <span className="mg-fact">
                        <Icon name="users" size={13} />
                        {g.member_count} member{g.member_count !== 1 ? 's' : ''}
                      </span>
                      {g.joined_at && (
                        <span className="mg-fact">You joined {daysAgo(g.joined_at)}</span>
                      )}
                    </div>

                    {/* Which room is theirs — the one fact in a group that
                        turns into money, so it is stated either way rather
                        than left out when it is unknown. */}
                    <div className="mg-room">
                      {g.room_name ? (
                        <>
                          <Icon name="home" size={14} />
                          <span><strong>{g.room_name}</strong> is yours in this group</span>
                        </>
                      ) : (
                        <>
                          <Icon name="clock" size={14} />
                          <span>Your room hasn&apos;t been assigned yet — the landlord does that</span>
                        </>
                      )}
                    </div>

                    <div className={`mg-msg${g.last_message ? '' : ' quiet'}`}>
                      <div className="mg-msg-k">
                        {g.last_message ? 'Last message' : 'Group chat'}
                      </div>
                      {g.last_message ? (
                        <>
                          <div className="mg-msg-t">{g.last_message.content}</div>
                          <div className="mg-msg-m">
                            {g.last_message.is_bot ? 'Honeybee' : g.last_message.sender_name}
                            {' · '}{timeAgo(g.last_message.created_at)}
                          </div>
                        </>
                      ) : (
                        <div className="mg-msg-t quiet">
                          Nothing yet — being the one who says hello first tends to decide who
                          gets organised.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="tp-card-ft">
                    <Link href={`/groups/${g.share_token}`} className="tp-btn tp-btn-primary full">
                      Open group
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

const CSS = `
  .mg-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
  @media (min-width: 680px) { .mg-grid { grid-template-columns: 1fr 1fr; } }

  .mg-card { display: flex; flex-direction: column; margin-bottom: 0; }
  .mg-card .tp-card-bd { flex: 1; }
  .mg-card:hover { border-color: var(--ink-4); }

  .mg-hd { display: flex; align-items: flex-start; gap: 13px; }
  .mg-emoji { font-size: 30px; line-height: 1.1; flex-shrink: 0; }
  .mg-name { font-family: var(--display); font-size: 19px; font-weight: 400; color: var(--ink);
    line-height: 1.2; letter-spacing: -0.3px; }
  .mg-prop { display: inline-flex; align-items: center; gap: 5px; font-size: 12px;
    font-weight: 600; color: var(--primary); text-decoration: none; margin-top: 4px; }
  .mg-prop:hover { text-decoration: underline; }
  .mg-prop.plain { color: var(--ink-4); font-weight: 500; }

  .mg-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .mg-fact { display: inline-flex; align-items: center; gap: 5px; font-size: 12px;
    color: var(--ink-3); }

  .mg-room { display: flex; align-items: center; gap: 8px; margin-top: 13px;
    font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
  .mg-room svg { color: var(--primary); flex-shrink: 0; }
  .mg-room strong { color: var(--ink); }

  .mg-msg { background: var(--surface-2); border: 1px solid var(--line-2);
    border-radius: var(--r-sm); padding: 11px 13px; margin-top: 14px; }
  .mg-msg-k { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .7px; color: var(--ink-4); margin-bottom: 5px; }
  .mg-msg-t { font-size: 13px; color: var(--ink-2); line-height: 1.5;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mg-msg-t.quiet { white-space: normal; color: var(--ink-4); }
  .mg-msg-m { font-size: 11px; color: var(--ink-4); margin-top: 4px; }
`
