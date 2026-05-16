'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

type Room = { id: string; name: string; price: number; is_available: boolean; position: number }
type Member = {
  id: string; room_id: string | null; added_at: string
  first_name: string | null; last_name: string | null
  has_prescreen: boolean; about: string | null; lifestyle: string | null
  occupation: string | null; university: string | null; gender: string | null
}
type GroupData = {
  group: { id: string; name: string; description: string | null; emoji: string; gender_preference: string; property_slug: string | null }
  property: { id: string; name: string; address: string; description: string | null; price: number; beds: number; baths: number; sqft: string | null; hero_image: string | null } | null
  rooms: Room[]
  members: Member[]
}

const LIFESTYLE_LABELS: Record<string, string> = {
  'Early riser / quiet': '☀️ Early riser',
  'Night owl / social': '🌙 Night owl',
  'Balanced': '⚖️ Balanced',
  'Work from home': '💻 Work from home',
  'Family-oriented': '🏡 Family routines',
}

function genderBadgeColor(pref: string) {
  if (pref === 'girls_only') return { bg: 'rgba(236,72,153,0.1)', border: 'rgba(236,72,153,0.3)', color: '#db2777' }
  if (pref === 'boys_only') return { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', color: '#2563eb' }
  return { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', color: '#059669' }
}

function genderLabel(pref: string) {
  if (pref === 'girls_only') return '♀ Girls Only'
  if (pref === 'boys_only') return '♂ Boys Only'
  return '⚤ Open to All'
}

function heroText(group: GroupData['group'], property: GroupData['property'], memberCount: number) {
  const name = property?.name ?? 'this home'
  if (group.gender_preference === 'girls_only') {
    return {
      eyebrow: 'Girls-only group forming now',
      headline: `Looking for the right girls to share ${name}`,
      sub: `${memberCount} ${memberCount === 1 ? 'girl has' : 'girls have'} already joined. This is an all-female group — a safe, like-minded household where you'll actually enjoy coming home. Spots are limited. Join for free and secure your place.`,
    }
  }
  if (group.gender_preference === 'boys_only') {
    return {
      eyebrow: 'Guys-only group forming now',
      headline: `Looking for solid guys to share ${name}`,
      sub: `${memberCount} ${memberCount === 1 ? 'guy has' : 'guys have'} already joined. All-male household, laid-back vibe, easy setup. Join for free — no commitment, just express interest and we'll take it from there.`,
    }
  }
  return {
    eyebrow: 'Roommate group forming now',
    headline: `Join the group forming for ${name}`,
    sub: `${memberCount} ${memberCount === 1 ? 'person has' : 'people have'} already expressed interest. Express yours for free — no commitment required. We'll reach out to coordinate.`,
  }
}

export default function PublicGroupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const [data, setData] = useState<GroupData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null)

  useEffect(() => {
    fetch(`/api/groups/share/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); else setNotFound(true) })
      .finally(() => setLoading(false))

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUser({ id: user.id, email: user.email! })
    })
  }, [token])

  const handleJoin = async () => {
    if (!currentUser) {
      router.push(`/login?next=/groups/${token}`)
      return
    }
    setJoining(true)
    setJoinError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/groups/share/${token}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    const body = await res.json()
    if (res.ok || body.already_member) {
      setJoined(true)
    } else {
      setJoinError(body.error || 'Something went wrong')
    }
    setJoining(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 14, color: '#9b9b9b', fontFamily: 'DM Sans, sans-serif' }}>Loading group…</div>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif', flexDirection: 'column', gap: 12, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 40 }}>🔍</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>Group not found</div>
        <div style={{ fontSize: 14, color: '#9b9b9b' }}>This link may have expired or been removed.</div>
        <a href="/" style={{ fontSize: 14, color: '#8C1D40', fontWeight: 600, marginTop: 8 }}>Browse available homes →</a>
      </div>
    )
  }

  const { group, property, rooms, members } = data
  const copy = heroText(group, property, members.length)
  const gBadge = genderBadgeColor(group.gender_preference)
  const pricedRooms = rooms.filter(r => r.price > 0)
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]))
  const shareUrl = `${SITE_URL}/groups/${token}`

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; }

        .gp-wrap { max-width: 780px; margin: 0 auto; padding: 40px 20px 100px; }

        /* NAV */
        .gp-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 40px; flex-wrap: wrap; gap: 12px; }
        .gp-nav-logo { font-size: 18px; font-weight: 700; color: #8C1D40; text-decoration: none; letter-spacing: -0.5px; }
        .gp-nav-link { font-size: 13px; color: #9b9b9b; text-decoration: none; font-weight: 500; }
        .gp-nav-link:hover { color: #1a1a1a; }

        /* HERO */
        .gp-hero { background: #1a1a1a; border-radius: 20px; padding: 36px 32px 32px; margin-bottom: 24px; position: relative; overflow: hidden; }
        .gp-hero-bg { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(140,29,64,0.3) 0%, rgba(26,26,26,0) 60%); pointer-events: none; }
        .gp-hero-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; position: relative; }
        .gp-hero-eyebrow::before { content: ''; width: 20px; height: 1px; background: #d4a843; opacity: 0.6; }
        .gp-hero-title { font-family: 'DM Serif Display', serif; font-size: 32px; color: #fff; line-height: 1.15; margin-bottom: 14px; letter-spacing: -0.5px; position: relative; }
        .gp-hero-sub { font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.7; max-width: 520px; margin-bottom: 28px; position: relative; }
        .gp-hero-badges { display: flex; gap: 8px; flex-wrap: wrap; position: relative; }
        .gp-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid; }

        /* JOIN CTA */
        .gp-cta-section { margin-bottom: 28px; }
        .gp-join-btn { width: 100%; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; border: none; letter-spacing: -0.2px; transition: opacity 0.15s, transform 0.1s; }
        .gp-join-btn:active { transform: scale(0.98); }
        .gp-join-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .gp-free-note { text-align: center; font-size: 12px; color: #9b9b9b; margin-top: 10px; }

        /* JOINED STATE */
        .gp-joined-box { background: #dcfce7; border: 1.5px solid #86efac; border-radius: 12px; padding: 20px 24px; text-align: center; }
        .gp-joined-title { font-size: 16px; font-weight: 700; color: #15803d; margin-bottom: 4px; }
        .gp-joined-sub { font-size: 13px; color: #166534; }

        /* PROPERTY */
        .gp-card { background: #fff; border: 1px solid #e8e5de; border-radius: 16px; overflow: hidden; margin-bottom: 20px; }
        .gp-card-hero { width: 100%; height: 200px; object-fit: cover; display: block; }
        .gp-card-body { padding: 20px 24px; }
        .gp-section-label { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
        .gp-section-label::after { content: ''; flex: 1; height: 1px; background: #f0ede6; }
        .gp-prop-name { font-family: 'DM Serif Display', serif; font-size: 22px; color: #1a1a1a; margin-bottom: 4px; }
        .gp-prop-address { font-size: 13px; color: #9b9b9b; margin-bottom: 14px; }
        .gp-prop-stats { display: flex; gap: 16px; flex-wrap: wrap; }
        .gp-stat { font-size: 13px; color: #1a1a1a; font-weight: 600; display: flex; align-items: center; gap: 4px; }
        .gp-stat span { color: #9b9b9b; font-weight: 400; }

        /* ROOMS */
        .gp-rooms { display: flex; flex-direction: column; gap: 10px; }
        .gp-room-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 10px; border: 1px solid #e8e5de; background: #faf9f6; }
        .gp-room-name { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .gp-room-assigned { font-size: 11px; color: #8C1D40; font-weight: 600; margin-top: 2px; }
        .gp-room-price { font-size: 15px; font-weight: 700; color: #1a1a1a; }
        .gp-room-avail { font-size: 10px; color: #10b981; font-weight: 700; margin-top: 2px; text-align: right; }
        .gp-room-taken { font-size: 10px; color: #9b9b9b; font-weight: 600; margin-top: 2px; text-align: right; }

        /* MEMBERS */
        .gp-members { display: flex; flex-direction: column; gap: 12px; }
        .gp-member { background: #faf9f6; border: 1px solid #e8e5de; border-radius: 12px; padding: 16px 18px; }
        .gp-member-top { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
        .gp-avatar { width: 42px; height: 42px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gp-member-name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
        .gp-member-room { font-size: 11px; color: #8C1D40; font-weight: 600; margin-top: 2px; }
        .gp-member-bio { font-size: 13px; color: #4b4b4b; line-height: 1.65; margin-bottom: 8px; font-style: italic; }
        .gp-member-tags { display: flex; gap: 6px; flex-wrap: wrap; }
        .gp-tag { font-size: 11px; background: #f0ede6; border: 1px solid #e8e5de; color: #6b6b6b; padding: 3px 9px; border-radius: 20px; }

        /* NO MEMBERS PLACEHOLDER */
        .gp-no-members { text-align: center; padding: 32px 20px; color: #9b9b9b; font-size: 14px; }

        /* SHARE */
        .gp-share-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
        .gp-share-input { flex: 1; background: #f5f4f0; border: 1px solid #e8e5de; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #6b6b6b; outline: none; font-family: 'DM Sans', sans-serif; }
        .gp-share-btn { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: 'DM Sans', sans-serif; }

        @media (max-width: 600px) {
          .gp-hero { padding: 28px 20px 24px; }
          .gp-hero-title { font-size: 24px; }
          .gp-wrap { padding: 24px 16px 80px; }
        }
      `}</style>

      <div style={{ background: '#f5f4f0', minHeight: '100vh' }}>
        <div className="gp-wrap">

          {/* Nav */}
          <div className="gp-nav">
            <a href="/" className="gp-nav-logo">HomeHive</a>
            <a href="/homes" className="gp-nav-link">Browse all homes →</a>
          </div>

          {/* Hero */}
          <div className="gp-hero">
            <div className="gp-hero-bg" />
            <div className="gp-hero-eyebrow">{copy.eyebrow}</div>
            <div className="gp-hero-title">{group.emoji} {copy.headline}</div>
            <div className="gp-hero-sub">{copy.sub}</div>
            <div className="gp-hero-badges">
              <span className="gp-badge" style={{ background: gBadge.bg, borderColor: gBadge.border, color: gBadge.color }}>
                {genderLabel(group.gender_preference)}
              </span>
              <span className="gp-badge" style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
                {members.length} {members.length === 1 ? 'member' : 'members'} so far
              </span>
              <span className="gp-badge" style={{ background: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.3)', color: '#10b981' }}>
                Free to join
              </span>
            </div>
          </div>

          {/* Join CTA */}
          <div className="gp-cta-section">
            {joined ? (
              <div className="gp-joined-box">
                <div className="gp-joined-title">You're in! 🎉</div>
                <div className="gp-joined-sub">You've been added to this group. The landlord will reach out to coordinate next steps.</div>
              </div>
            ) : (
              <>
                <button
                  className="gp-join-btn"
                  disabled={joining}
                  onClick={handleJoin}
                  style={{
                    background: group.gender_preference === 'girls_only'
                      ? 'linear-gradient(135deg, #db2777, #9d174d)'
                      : group.gender_preference === 'boys_only'
                      ? 'linear-gradient(135deg, #2563eb, #1d4ed8)'
                      : 'linear-gradient(135deg, #8C1D40, #6b1530)',
                    color: '#fff',
                  }}
                >
                  {joining ? 'Joining…' : currentUser ? 'Join This Group →' : 'Sign In to Join →'}
                </button>
                {joinError && <div style={{ textAlign: 'center', fontSize: 12, color: '#ef4444', marginTop: 8 }}>{joinError}</div>}
                <div className="gp-free-note">
                  Free to join · No commitment · Just express interest
                </div>
              </>
            )}
          </div>

          {/* Property */}
          {property && (
            <div className="gp-card">
              {property.hero_image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={property.hero_image} alt={property.name} className="gp-card-hero" />
              )}
              <div className="gp-card-body">
                <div className="gp-section-label">The Home</div>
                <div className="gp-prop-name">{property.name}</div>
                <div className="gp-prop-address">📍 {property.address}</div>
                <div className="gp-prop-stats">
                  {property.beds > 0 && <div className="gp-stat">{property.beds} <span>bed{property.beds !== 1 ? 's' : ''}</span></div>}
                  {property.baths > 0 && <div className="gp-stat">{property.baths} <span>bath{property.baths !== 1 ? 's' : ''}</span></div>}
                  {property.sqft && <div className="gp-stat">{property.sqft} <span>sqft</span></div>}
                </div>
                {property.description && (
                  <div style={{ marginTop: 12, fontSize: 13, color: '#6b6b6b', lineHeight: 1.7 }}>{property.description}</div>
                )}
              </div>
            </div>
          )}

          {/* Rooms */}
          {pricedRooms.length > 0 && (
            <div className="gp-card" style={{ marginBottom: 20 }}>
              <div className="gp-card-body">
                <div className="gp-section-label">Available Rooms & Pricing</div>
                <div className="gp-rooms">
                  {pricedRooms.map(room => {
                    const assignedMember = members.find(m => m.room_id === room.id)
                    return (
                      <div className="gp-room-row" key={room.id} style={!room.is_available || assignedMember ? { opacity: 0.7 } : {}}>
                        <div>
                          <div className="gp-room-name">{room.name}</div>
                          {assignedMember && (
                            <div className="gp-room-assigned">
                              Reserved for {assignedMember.first_name ?? 'a member'}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="gp-room-price">${room.price.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#9b9b9b' }}>/mo</span></div>
                          {!assignedMember && room.is_available
                            ? <div className="gp-room-avail">Available</div>
                            : <div className="gp-room-taken">{assignedMember ? 'Reserved' : 'Taken'}</div>
                          }
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Members */}
          <div className="gp-card">
            <div className="gp-card-body">
              <div className="gp-section-label">
                Who&apos;s In the Group ({members.length})
              </div>
              {members.length === 0 ? (
                <div className="gp-no-members">
                  Be the first to join this group!
                </div>
              ) : (
                <div className="gp-members">
                  {members.map((m, i) => {
                    const initials = ((m.first_name?.[0] || '') + (m.last_name?.[0] || '')).toUpperCase() || `#${i + 1}`
                    const assignedRoom = m.room_id ? roomMap[m.room_id] : null
                    return (
                      <div className="gp-member" key={m.id}>
                        <div className="gp-member-top">
                          <div className="gp-avatar">{initials}</div>
                          <div>
                            <div className="gp-member-name">
                              {m.first_name ?? 'Member'} {m.last_name ?? ''}
                            </div>
                            {assignedRoom && (
                              <div className="gp-member-room">Assigned: {assignedRoom.name}</div>
                            )}
                          </div>
                          {m.has_prescreen && (
                            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                              ✓ Pre-screened
                            </span>
                          )}
                        </div>
                        {m.about && <div className="gp-member-bio">"{m.about}"</div>}
                        <div className="gp-member-tags">
                          {m.occupation && <span className="gp-tag">{m.occupation}</span>}
                          {m.university && <span className="gp-tag">🎓 {m.university}</span>}
                          {m.lifestyle && <span className="gp-tag">{LIFESTYLE_LABELS[m.lifestyle] ?? m.lifestyle}</span>}
                          {m.gender && m.gender !== 'Prefer not to say' && <span className="gp-tag">{m.gender}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Share this link */}
          <div className="gp-card">
            <div className="gp-card-body">
              <div className="gp-section-label">Share This Group</div>
              <div style={{ fontSize: 13, color: '#6b6b6b', marginBottom: 12 }}>
                Send this link to anyone you'd like to invite into the group.
              </div>
              <ShareRow url={shareUrl} />
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

function ShareRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="gp-share-row">
      <input className="gp-share-input" readOnly value={url} onFocus={e => e.target.select()} />
      <button
        className="gp-share-btn"
        onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      >
        {copied ? '✓ Copied!' : 'Copy Link'}
      </button>
    </div>
  )
}
