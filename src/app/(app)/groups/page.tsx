'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

function genderBadge(pref: string) {
  if (pref === 'girls_only') return { label: '♀ Girls Only', bg: 'rgba(236,72,153,0.1)', color: '#db2777', border: 'rgba(236,72,153,0.25)' }
  if (pref === 'boys_only') return { label: '♂ Boys Only', bg: 'rgba(59,130,246,0.1)', color: '#2563eb', border: 'rgba(59,130,246,0.25)' }
  return { label: '⚤ Open to All', bg: 'rgba(140,29,64,0.07)', color: '#8C1D40', border: 'rgba(140,29,64,0.18)' }
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
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function getGreeting(name: string) {
  const h = new Date().getHours()
  const first = name.split(' ')[0]
  if (h < 12) return `Good morning, ${first}`
  if (h < 17) return `Good afternoon, ${first}`
  return `Good evening, ${first}`
}

export default function MyGroupsPage() {
  const [groups, setGroups] = useState<GroupCard[]>([])
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')

  useEffect(() => { document.title = 'My Groups — My Portal | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'there'
      setUserName(name)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      try {
        const res = await fetch('/api/user/groups', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const d = await res.json()
          setGroups(d.groups || [])
        }
      } catch { /* ignore */ }

      setLoading(false)
    }
    load()
  }, [])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        .mg-page { max-width: 860px; margin: 0 auto; padding: 32px 24px 60px; font-family: 'DM Sans', sans-serif; }
        .mg-greeting { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.4px; margin-bottom: 4px; }
        .mg-sub { font-size: 14px; color: #9b9b9b; margin-bottom: 32px; }
        .mg-section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 16px; }
        .mg-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 640px) { .mg-grid { grid-template-columns: 1fr 1fr; } }
        .mg-card {
          background: #fff; border: 1px solid #ede9e0; border-radius: 18px;
          padding: 22px; display: flex; flex-direction: column; gap: 14px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
          transition: box-shadow 0.2s, transform 0.2s;
          cursor: default;
        }
        .mg-card:hover { box-shadow: 0 6px 28px rgba(0,0,0,0.09); transform: translateY(-2px); }
        .mg-card-header { display: flex; align-items: flex-start; gap: 12px; }
        .mg-emoji { font-size: 34px; line-height: 1; flex-shrink: 0; }
        .mg-title { font-size: 17px; font-weight: 700; color: #1a1a1a; line-height: 1.25; letter-spacing: -0.3px; margin-bottom: 3px; }
        .mg-prop-link { font-size: 12px; color: #8C1D40; font-weight: 600; text-decoration: none; }
        .mg-prop-link:hover { text-decoration: underline; }
        .mg-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid; }
        .mg-meta-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .mg-meta-pill { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #6b6b6b; }
        .mg-room-pill { font-size: 11px; font-weight: 600; color: #8C1D40; background: rgba(140,29,64,0.07); border: 1px solid rgba(140,29,64,0.18); border-radius: 20px; padding: 3px 10px; }
        .mg-last-msg { background: #faf9f6; border: 1px solid #ede9e0; border-radius: 10px; padding: 10px 13px; }
        .mg-last-msg-header { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #b0a898; margin-bottom: 5px; }
        .mg-last-msg-text { font-size: 13px; color: #4b5563; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mg-last-msg-meta { font-size: 11px; color: #9b9b9b; margin-top: 3px; }
        .mg-open-btn {
          width: 100%; padding: 12px; border-radius: 12px;
          font-size: 14px; font-weight: 700; font-family: 'DM Sans', sans-serif;
          cursor: pointer; border: none;
          background: linear-gradient(135deg, #FFC627, #f5a623);
          color: #1a1a1a; letter-spacing: -0.2px;
          transition: opacity 0.15s, box-shadow 0.15s;
        }
        .mg-open-btn:hover { opacity: 0.9; box-shadow: 0 4px 14px rgba(255,198,39,0.45); }
        .mg-empty { text-align: center; padding: 60px 20px; }
        .mg-empty-icon { font-size: 52px; margin-bottom: 16px; }
        .mg-empty-title { font-size: 20px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; letter-spacing: -0.3px; }
        .mg-empty-sub { font-size: 14px; color: #9b9b9b; margin-bottom: 24px; line-height: 1.6; max-width: 340px; margin-left: auto; margin-right: auto; }
        .mg-browse-btn { display: inline-flex; align-items: center; gap: 6px; padding: 13px 24px; background: #1a1a1a; color: #fff; border-radius: 12px; font-size: 14px; font-weight: 700; text-decoration: none; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .mg-browse-btn:hover { opacity: 0.85; }
        .mg-skeleton { background: linear-gradient(90deg, #f5f4f0 25%, #ede9e0 50%, #f5f4f0 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 10px; }
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
      `}</style>

      <div className="mg-page">
        <div className="mg-greeting">{loading ? 'Your Roommate Groups' : getGreeting(userName)}</div>
        <div className="mg-sub">
          {loading ? 'Loading your groups…' : groups.length > 0 ? `You're in ${groups.length} roommate group${groups.length !== 1 ? 's' : ''}` : 'Manage your roommate groups here'}
        </div>

        {loading ? (
          <div className="mg-grid">
            {[0, 1].map(i => (
              <div key={i} className="mg-card" style={{ gap: 12 }}>
                <div className="mg-skeleton" style={{ height: 24, width: '60%' }} />
                <div className="mg-skeleton" style={{ height: 16, width: '40%' }} />
                <div className="mg-skeleton" style={{ height: 60, width: '100%' }} />
                <div className="mg-skeleton" style={{ height: 44, width: '100%' }} />
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="mg-empty">
            <div className="mg-empty-icon">🐝</div>
            <div className="mg-empty-title">No groups yet</div>
            <div className="mg-empty-sub">
              Browse available homes and join a roommate group to find your perfect hive.
            </div>
            <a href="/homes" className="mg-browse-btn">Browse Homes →</a>
          </div>
        ) : (
          <>
            <div className="mg-section-label">Your Groups</div>
            <div className="mg-grid">
              {groups.map(g => {
                const badge = genderBadge(g.gender_preference)
                return (
                  <div key={g.id} className="mg-card">
                    {/* Header */}
                    <div className="mg-card-header">
                      <div className="mg-emoji">{g.emoji}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mg-title">{g.name}</div>
                        {g.property_name && g.property_slug ? (
                          <a
                            href={`/homes/${g.property_slug}`}
                            className="mg-prop-link"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            🏠 {g.property_name} ↗
                          </a>
                        ) : g.property_name ? (
                          <span style={{ fontSize: 12, color: '#9b9b9b' }}>🏠 {g.property_name}</span>
                        ) : null}
                      </div>
                    </div>

                    {/* Meta row */}
                    <div className="mg-meta-row">
                      <span className="mg-badge" style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}>
                        {badge.label}
                      </span>
                      <span className="mg-meta-pill">
                        👥 {g.member_count} member{g.member_count !== 1 ? 's' : ''}
                      </span>
                      {g.joined_at && (
                        <span className="mg-meta-pill">
                          · Joined {daysAgo(g.joined_at)}
                        </span>
                      )}
                    </div>

                    {/* Room assignment */}
                    {g.room_name ? (
                      <div>
                        <span className="mg-room-pill">🛏 {g.room_name}</span>
                      </div>
                    ) : (
                      <div>
                        <span style={{ fontSize: 11, color: '#9b9b9b', fontStyle: 'italic' }}>Room TBD by landlord</span>
                      </div>
                    )}

                    {/* Last message */}
                    {g.last_message ? (
                      <div className="mg-last-msg">
                        <div className="mg-last-msg-header">Last message</div>
                        <div className="mg-last-msg-text">
                          {g.last_message.is_bot ? '🐝 ' : ''}{g.last_message.content}
                        </div>
                        <div className="mg-last-msg-meta">
                          {g.last_message.is_bot ? 'Honeybee' : g.last_message.sender_name} · {timeAgo(g.last_message.created_at)}
                        </div>
                      </div>
                    ) : (
                      <div className="mg-last-msg" style={{ opacity: 0.5 }}>
                        <div className="mg-last-msg-header">Group Chat</div>
                        <div className="mg-last-msg-text" style={{ color: '#9b9b9b' }}>No messages yet — say hello!</div>
                      </div>
                    )}

                    {/* CTA */}
                    <button
                      className="mg-open-btn"
                      onClick={() => window.open(`/groups/${g.share_token}`, '_blank')}
                    >
                      Open Group 🐝 →
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}
