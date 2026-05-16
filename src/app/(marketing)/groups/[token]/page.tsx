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
  'Work from home': '💻 WFH',
  'Family-oriented': '🏡 Family',
}

function accentColor(pref: string) {
  if (pref === 'girls_only') return { main: '#db2777', light: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.2)', gradient: 'linear-gradient(135deg,#db2777,#9d174d)' }
  if (pref === 'boys_only') return { main: '#2563eb', light: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', gradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }
  return { main: '#8C1D40', light: 'rgba(140,29,64,0.07)', border: 'rgba(140,29,64,0.18)', gradient: 'linear-gradient(135deg,#8C1D40,#6b1530)' }
}

function genderLabel(pref: string) {
  if (pref === 'girls_only') return '♀ Girls Only'
  if (pref === 'boys_only') return '♂ Boys Only'
  return '⚤ Open to All'
}

function headlineText(pref: string, propertyName: string) {
  if (pref === 'girls_only') return `All-girls group forming for ${propertyName}`
  if (pref === 'boys_only') return `All-guys group forming for ${propertyName}`
  return `Roommate group forming for ${propertyName}`
}

function avatarColors(i: number) {
  const palettes = [
    { bg: '#8C1D40', fg: '#FFC627' },
    { bg: '#1d4ed8', fg: '#bfdbfe' },
    { bg: '#0f766e', fg: '#99f6e4' },
    { bg: '#7c3aed', fg: '#ddd6fe' },
    { bg: '#b45309', fg: '#fde68a' },
    { bg: '#0369a1', fg: '#bae6fd' },
  ]
  return palettes[i % palettes.length]
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
  const [copiedShare, setCopiedShare] = useState(false)

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
    if (!currentUser) { router.push(`/login?next=/groups/${token}`); return }
    setJoining(true)
    setJoinError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/groups/share/${token}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    const body = await res.json()
    if (res.ok || body.already_member) { setJoined(true) }
    else { setJoinError(body.error || 'Something went wrong') }
    setJoining(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>👥</div>
        <div style={{ fontSize: 14, color: '#9b9b9b' }}>Loading group…</div>
      </div>
    </div>
  )

  if (notFound || !data) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif', flexDirection: 'column', gap: 10, textAlign: 'center', padding: 24 }}>
      <div style={{ fontSize: 36 }}>🔍</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>Group not found</div>
      <div style={{ fontSize: 13, color: '#9b9b9b' }}>This link may have expired or been removed.</div>
      <a href="/" style={{ fontSize: 13, color: '#8C1D40', fontWeight: 600, marginTop: 6 }}>Browse available homes →</a>
    </div>
  )

  const { group, property, rooms, members } = data
  const ac = accentColor(group.gender_preference)
  const pricedRooms = rooms.filter(r => r.price > 0)
  const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]))
  const shareUrl = `${SITE_URL}/groups/${token}`
  const propertyName = property?.name ?? 'this home'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; -webkit-font-smoothing: antialiased; }

        .gp-root { max-width: 520px; margin: 0 auto; padding: 0 0 120px; min-height: 100vh; }

        /* TOP BAR */
        .gp-topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid #ede9e0; background: #fff; position: sticky; top: 0; z-index: 10; }
        .gp-logo { font-size: 16px; font-weight: 700; color: #8C1D40; text-decoration: none; letter-spacing: -0.4px; }
        .gp-browse { font-size: 12px; color: #9b9b9b; text-decoration: none; font-weight: 500; }

        /* HERO — tight, badge-first layout */
        .gp-hero { padding: 20px 20px 0; }
        .gp-hero-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid; margin-bottom: 10px; }
        .gp-hero-title { font-size: 20px; font-weight: 700; color: #1a1a1a; line-height: 1.25; letter-spacing: -0.4px; margin-bottom: 6px; }
        .gp-hero-meta { font-size: 13px; color: #6b6b6b; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .gp-hero-dot { width: 3px; height: 3px; border-radius: 50%; background: #c5c1b8; flex-shrink: 0; }

        /* DIVIDER */
        .gp-divider { height: 1px; background: #ede9e0; margin: 16px 20px 0; }

        /* SECTION */
        .gp-section { padding: 18px 20px 0; }
        .gp-section-title { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 14px; }

        /* MEMBER CARDS */
        .gp-member { background: #fff; border: 1px solid #ede9e0; border-radius: 14px; padding: 14px 16px; margin-bottom: 10px; }
        .gp-member-row { display: flex; align-items: flex-start; gap: 12px; }
        .gp-avatar { width: 46px; height: 46px; border-radius: 50%; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; letter-spacing: -0.5px; }
        .gp-member-info { flex: 1; min-width: 0; }
        .gp-member-name { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 1px; }
        .gp-member-sub { font-size: 11px; color: #9b9b9b; margin-bottom: 6px; }
        .gp-member-bio { font-size: 13px; color: #4b5563; line-height: 1.6; margin: 8px 0 10px; padding-left: 10px; border-left: 2px solid #ede9e0; }
        .gp-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .gp-tag { font-size: 11px; color: #6b6b6b; background: #f5f4f0; border: 1px solid #ede9e0; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .gp-screened-badge { font-size: 10px; font-weight: 700; color: #10b981; background: rgba(16,185,129,0.09); border: 1px solid rgba(16,185,129,0.22); border-radius: 20px; padding: 2px 8px; white-space: nowrap; flex-shrink: 0; }

        /* EMPTY MEMBERS */
        .gp-empty { text-align: center; padding: 32px 20px; background: #fff; border: 1px dashed #ddd9d1; border-radius: 14px; margin-bottom: 10px; }
        .gp-empty-icon { font-size: 28px; margin-bottom: 8px; }
        .gp-empty-text { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }
        .gp-empty-sub { font-size: 12px; color: #9b9b9b; }

        /* PROPERTY CARD */
        .gp-prop-card { background: #fff; border: 1px solid #ede9e0; border-radius: 14px; overflow: hidden; margin-bottom: 10px; }
        .gp-prop-img { width: 100%; height: 170px; object-fit: cover; display: block; }
        .gp-prop-body { padding: 14px 16px; }
        .gp-prop-name { font-size: 16px; font-weight: 700; color: #1a1a1a; margin-bottom: 3px; }
        .gp-prop-addr { font-size: 12px; color: #9b9b9b; margin-bottom: 10px; }
        .gp-prop-stats { display: flex; gap: 14px; }
        .gp-prop-stat { font-size: 12px; color: #6b6b6b; }
        .gp-prop-stat strong { color: #1a1a1a; font-size: 14px; }

        /* ROOM ROWS */
        .gp-room { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 10px; background: #faf9f7; border: 1px solid #ede9e0; margin-bottom: 8px; }
        .gp-room-name { font-size: 14px; font-weight: 600; color: #1a1a1a; }
        .gp-room-reserved { font-size: 11px; color: #8C1D40; font-weight: 600; margin-top: 2px; }
        .gp-room-price { font-size: 15px; font-weight: 700; color: #1a1a1a; text-align: right; }
        .gp-room-status { font-size: 10px; font-weight: 700; text-align: right; margin-top: 2px; }

        /* SHARE */
        .gp-share-card { background: #fff; border: 1px solid #ede9e0; border-radius: 14px; padding: 14px 16px; }
        .gp-share-row { display: flex; gap: 8px; margin-top: 10px; }
        .gp-share-input { flex: 1; background: #f5f4f0; border: 1px solid #ede9e0; border-radius: 8px; padding: 9px 12px; font-size: 12px; color: #6b6b6b; outline: none; font-family: 'DM Sans', sans-serif; min-width: 0; }
        .gp-share-btn { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 9px 14px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: 'DM Sans', sans-serif; }

        /* STICKY JOIN FOOTER */
        .gp-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 20px 28px; background: #fff; border-top: 1px solid #ede9e0; z-index: 20; max-width: 520px; margin: 0 auto; }
        .gp-join-btn { width: 100%; padding: 15px; border-radius: 12px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; border: none; letter-spacing: -0.2px; transition: opacity 0.15s, transform 0.1s; }
        .gp-join-btn:active { transform: scale(0.98); }
        .gp-join-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .gp-footer-note { text-align: center; font-size: 11px; color: #9b9b9b; margin-top: 6px; }
        .gp-joined-pill { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; background: #dcfce7; border: 1.5px solid #86efac; border-radius: 12px; }
        .gp-joined-text { font-size: 15px; font-weight: 700; color: #15803d; }
        .gp-joined-sub { font-size: 12px; color: #166534; }

        @media (min-width: 521px) {
          .gp-root { border-left: 1px solid #ede9e0; border-right: 1px solid #ede9e0; }
          .gp-footer { left: 50%; transform: translateX(-50%); width: 100%; max-width: 520px; border-left: 1px solid #ede9e0; border-right: 1px solid #ede9e0; }
        }
      `}</style>

      <div className="gp-root">

        {/* Top bar */}
        <div className="gp-topbar">
          <a href="/" className="gp-logo">HomeHive</a>
          <a href="/homes" className="gp-browse">Browse homes →</a>
        </div>

        {/* Hero — compact */}
        <div className="gp-hero">
          <div className="gp-hero-badge" style={{ background: ac.light, borderColor: ac.border, color: ac.main }}>
            {genderLabel(group.gender_preference)}
          </div>
          <div className="gp-hero-title">
            {group.emoji} {headlineText(group.gender_preference, propertyName)}
          </div>
          {group.description && (
            <div style={{ fontSize: 13, color: '#6b6b6b', lineHeight: 1.6, marginTop: 6 }}>{group.description}</div>
          )}
          <div className="gp-hero-meta" style={{ marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{members.length} {members.length === 1 ? 'person' : 'people'} in the group</span>
            <span className="gp-hero-dot" />
            <span style={{ color: '#10b981', fontWeight: 600 }}>Free to join</span>
          </div>
        </div>

        <div className="gp-divider" />

        {/* MEMBERS — first! */}
        <div className="gp-section">
          <div className="gp-section-title">Who&apos;s in the group</div>

          {members.length === 0 ? (
            <div className="gp-empty">
              <div className="gp-empty-icon">👀</div>
              <div className="gp-empty-text">No one yet — be the first!</div>
              <div className="gp-empty-sub">Hit join below and your name will show up here.</div>
            </div>
          ) : (
            members.map((m, i) => {
              const initials = ((m.first_name?.[0] || '') + (m.last_name?.[0] || '')).toUpperCase() || `${i + 1}`
              const pal = avatarColors(i)
              const assignedRoom = m.room_id ? roomMap[m.room_id] : null
              const tags = [
                m.occupation,
                m.university ? `🎓 ${m.university}` : null,
                m.lifestyle ? (LIFESTYLE_LABELS[m.lifestyle] ?? m.lifestyle) : null,
                m.gender && m.gender !== 'Prefer not to say' ? m.gender : null,
              ].filter(Boolean) as string[]
              return (
                <div className="gp-member" key={m.id}>
                  <div className="gp-member-row">
                    <div className="gp-avatar" style={{ background: pal.bg, color: pal.fg }}>{initials}</div>
                    <div className="gp-member-info">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div className="gp-member-name">{m.first_name ?? 'Member'} {m.last_name ?? ''}</div>
                        {m.has_prescreen && <span className="gp-screened-badge">✓ Screened</span>}
                      </div>
                      {assignedRoom && (
                        <div className="gp-member-sub" style={{ color: ac.main, fontWeight: 600 }}>
                          {assignedRoom.name}{assignedRoom.price ? ` · $${assignedRoom.price}/mo` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  {m.about && <div className="gp-member-bio">{m.about}</div>}
                  {tags.length > 0 && (
                    <div className="gp-tags">
                      {tags.map(t => <span className="gp-tag" key={t}>{t}</span>)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="gp-divider" style={{ marginTop: 18 }} />

        {/* Property */}
        {property && (
          <div className="gp-section">
            <div className="gp-section-title">The home</div>
            <div className="gp-prop-card">
              {property.hero_image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={property.hero_image} alt={property.name} className="gp-prop-img" />
              )}
              <div className="gp-prop-body">
                <div className="gp-prop-name">{property.name}</div>
                <div className="gp-prop-addr">📍 {property.address}</div>
                <div className="gp-prop-stats">
                  {property.beds > 0 && <div className="gp-prop-stat"><strong>{property.beds}</strong> bed{property.beds !== 1 ? 's' : ''}</div>}
                  {property.baths > 0 && <div className="gp-prop-stat"><strong>{property.baths}</strong> bath{property.baths !== 1 ? 's' : ''}</div>}
                  {property.sqft && <div className="gp-prop-stat"><strong>{property.sqft}</strong> sqft</div>}
                </div>
                {property.description && (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#6b6b6b', lineHeight: 1.65 }}>{property.description}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Rooms */}
        {pricedRooms.length > 0 && (
          <div className="gp-section" style={{ marginTop: property ? 0 : 0 }}>
            <div className="gp-section-title" style={{ marginTop: property ? 18 : 0 }}>Rooms &amp; pricing</div>
            {pricedRooms.map(room => {
              const assignedMember = members.find(m => m.room_id === room.id)
              const available = room.is_available && !assignedMember
              return (
                <div className="gp-room" key={room.id} style={!available ? { opacity: 0.72 } : {}}>
                  <div>
                    <div className="gp-room-name">{room.name}</div>
                    {assignedMember && (
                      <div className="gp-room-reserved">Reserved for {assignedMember.first_name ?? 'a member'}</div>
                    )}
                  </div>
                  <div>
                    <div className="gp-room-price">${room.price.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#9b9b9b' }}>/mo</span></div>
                    <div className="gp-room-status" style={{ color: available ? '#10b981' : '#9b9b9b' }}>
                      {available ? 'Available' : assignedMember ? 'Reserved' : 'Taken'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Share */}
        <div className="gp-section" style={{ paddingTop: 18 }}>
          <div className="gp-section-title">Share this group</div>
          <div className="gp-share-card">
            <div style={{ fontSize: 13, color: '#6b6b6b' }}>Invite others by sending them this link.</div>
            <div className="gp-share-row">
              <input className="gp-share-input" readOnly value={shareUrl} onFocus={e => e.target.select()} />
              <button
                className="gp-share-btn"
                onClick={() => { navigator.clipboard.writeText(shareUrl); setCopiedShare(true); setTimeout(() => setCopiedShare(false), 2000) }}
              >
                {copiedShare ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Sticky join footer */}
      <div className="gp-footer" style={{ left: '50%', transform: 'translateX(-50%)', width: '100%' }}>
        {joined ? (
          <div className="gp-joined-pill">
            <div>
              <div className="gp-joined-text">You&apos;re in the group 🎉</div>
              <div className="gp-joined-sub">The landlord will reach out to coordinate next steps.</div>
            </div>
          </div>
        ) : (
          <>
            <button
              className="gp-join-btn"
              disabled={joining}
              onClick={handleJoin}
              style={{ background: ac.gradient, color: '#fff' }}
            >
              {joining ? 'Joining…' : currentUser ? 'Join This Group →' : 'Sign In to Join →'}
            </button>
            {joinError
              ? <div style={{ textAlign: 'center', fontSize: 11, color: '#ef4444', marginTop: 5 }}>{joinError}</div>
              : <div className="gp-footer-note">Free · No commitment · Just express interest</div>
            }
          </>
        )}
      </div>
    </>
  )
}
