'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

type Room = { id: string; name: string; price: number; is_available: boolean; position: number; images: string[] }
type Member = {
  id: string; room_id: string | null; added_at: string
  first_name: string | null; last_name: string | null
  has_prescreen: boolean; about: string | null; lifestyle: string | null
  occupation: string | null; university: string | null; gender: string | null
}
type GroupData = {
  group: { id: string; name: string; description: string | null; emoji: string; gender_preference: string; property_slug: string | null }
  property: { id: string; slug: string; name: string; address: string; description: string | null; price: number; beds: number; baths: number; sqft: string | null; hero_image: string | null } | null
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
  if (pref === 'girls_only') return { main: '#db2777', light: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.2)', gradient: 'linear-gradient(135deg,#db2777,#9d174d)', soft: '#fdf2f8' }
  if (pref === 'boys_only') return { main: '#2563eb', light: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', gradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)', soft: '#eff6ff' }
  return { main: '#8C1D40', light: 'rgba(140,29,64,0.07)', border: 'rgba(140,29,64,0.18)', gradient: 'linear-gradient(135deg,#8C1D40,#6b1530)', soft: '#fdf5f7' }
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

function persuasiveLine(pref: string, count: number) {
  const n = count === 0 ? 'No one yet' : count === 1 ? '1 person' : `${count} people`
  if (pref === 'girls_only') return `${n} in the group · All-female household · Safe, like-minded space`
  if (pref === 'boys_only') return `${n} in the group · All-male household · Low-key, easy setup`
  return `${n} in the group · Mixed household · Join for free, no commitment`
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
    setJoining(true); setJoinError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/groups/share/${token}/join`, {
      method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    const body = await res.json()
    if (res.ok || body.already_member) setJoined(true)
    else setJoinError(body.error || 'Something went wrong')
    setJoining(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans,sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
        <div style={{ fontSize: 14, color: '#9b9b9b' }}>Loading group…</div>
      </div>
    </div>
  )

  if (notFound || !data) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans,sans-serif', flexDirection: 'column', gap: 10, textAlign: 'center', padding: 24 }}>
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

  const MembersPanel = () => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#9b9b9b', marginBottom: 14 }}>
        Who&apos;s in the group
      </div>
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 20px', background: '#fff', border: '1px dashed #ddd9d1', borderRadius: 14 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>👀</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>No one yet — be the first!</div>
          <div style={{ fontSize: 12, color: '#9b9b9b' }}>Your name will show up here after you join.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {members.map((m, i) => {
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
              <div key={m.id} style={{ background: '#fff', border: '1px solid #ede9e0', borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: pal.bg, color: pal.fg, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{m.first_name ?? 'Member'} {m.last_name ?? ''}</div>
                      {m.has_prescreen && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.09)', border: '1px solid rgba(16,185,129,0.22)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          ✓ Screened
                        </span>
                      )}
                    </div>
                    {assignedRoom && (
                      <div style={{ fontSize: 11, color: ac.main, fontWeight: 600, marginTop: 2 }}>
                        {assignedRoom.name}{assignedRoom.price ? ` · $${assignedRoom.price}/mo` : ''}
                      </div>
                    )}
                  </div>
                </div>
                {m.about && (
                  <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 12, borderLeft: '2px solid #ede9e0' }}>
                    {m.about}
                  </div>
                )}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {tags.map(t => (
                      <span key={t} style={{ fontSize: 11, color: '#6b6b6b', background: '#f5f4f0', border: '1px solid #ede9e0', padding: '3px 9px', borderRadius: 20 }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const JoinWidget = ({ sticky }: { sticky?: boolean }) => (
    <div style={{
      background: '#fff', border: '1px solid #ede9e0', borderRadius: sticky ? 0 : 16,
      padding: sticky ? '14px 20px 28px' : '20px',
      ...(sticky ? { borderLeft: 'none', borderRight: 'none', borderBottom: 'none' } : {}),
    }}>
      {joined ? (
        <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: 12, padding: '16px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#15803d', marginBottom: 3 }}>You&apos;re in the group 🎉</div>
          <div style={{ fontSize: 12, color: '#166534' }}>The landlord will reach out to coordinate next steps.</div>
        </div>
      ) : (
        <>
          <button
            disabled={joining}
            onClick={handleJoin}
            style={{
              width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 700,
              cursor: joining ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans,sans-serif',
              border: 'none', background: ac.gradient, color: '#fff',
              opacity: joining ? 0.6 : 1, transition: 'opacity 0.15s',
              letterSpacing: '-0.2px',
            }}
          >
            {joining ? 'Joining…' : currentUser ? 'Join This Group →' : 'Sign In to Join →'}
          </button>
          {joinError
            ? <div style={{ textAlign: 'center', fontSize: 11, color: '#ef4444', marginTop: 6 }}>{joinError}</div>
            : <div style={{ textAlign: 'center', fontSize: 11, color: '#9b9b9b', marginTop: 7 }}>Free · No commitment · Just express interest</div>
          }
        </>
      )}
    </div>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; -webkit-font-smoothing: antialiased; }

        /* NAV */
        .gp-nav { background: #fff; border-bottom: 1px solid #ede9e0; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 30; }
        .gp-logo { font-size: 16px; font-weight: 700; color: #8C1D40; text-decoration: none; letter-spacing: -0.4px; }
        .gp-nav-link { font-size: 12px; color: #9b9b9b; text-decoration: none; font-weight: 500; }
        .gp-nav-link:hover { color: #1a1a1a; }

        /* ── MOBILE layout (default) ── */
        .gp-page { max-width: 520px; margin: 0 auto; padding-bottom: 110px; }

        .gp-hero { padding: 20px 20px 0; }
        .gp-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid; margin-bottom: 10px; }
        .gp-headline { font-size: 20px; font-weight: 700; color: #1a1a1a; line-height: 1.25; letter-spacing: -0.4px; margin-bottom: 6px; }
        .gp-persuade { font-size: 13px; color: #6b6b6b; margin-top: 4px; }

        .gp-hr { height: 1px; background: #ede9e0; margin: 16px 20px 0; }

        .gp-section { padding: 18px 20px 0; }
        .gp-section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 14px; }

        /* room rows */
        .gp-room { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 10px; background: #faf9f7; border: 1px solid #ede9e0; margin-bottom: 8px; }

        /* sticky mobile join footer */
        .gp-sticky-footer { display: block; position: fixed; bottom: 0; left: 0; right: 0; z-index: 20; background: #fff; border-top: 1px solid #ede9e0; }
        .gp-sticky-inner { max-width: 520px; margin: 0 auto; padding: 12px 20px 28px; }

        /* property card */
        .gp-prop-card { background: #fff; border: 1px solid #ede9e0; border-radius: 14px; overflow: hidden; margin-bottom: 10px; }
        .gp-prop-img { width: 100%; height: 170px; object-fit: cover; display: block; }
        .gp-prop-body { padding: 14px 16px; }

        /* share card */
        .gp-share-card { background: #fff; border: 1px solid #ede9e0; border-radius: 14px; padding: 16px; }
        .gp-share-row { display: flex; gap: 8px; margin-top: 10px; }
        .gp-share-input { flex: 1; background: #f5f4f0; border: 1px solid #ede9e0; border-radius: 8px; padding: 9px 12px; font-size: 12px; color: #6b6b6b; outline: none; font-family: 'DM Sans', sans-serif; min-width: 0; }
        .gp-share-btn { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 9px 14px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: 'DM Sans', sans-serif; }

        /* ── DESKTOP layout ── */
        @media (min-width: 768px) {
          .gp-page {
            max-width: 1080px;
            margin: 0 auto;
            padding: 36px 32px 60px;
            display: grid;
            grid-template-columns: 1fr 380px;
            grid-template-rows: auto;
            gap: 0 28px;
            align-items: start;
          }

          /* hero spans full width above the columns */
          .gp-dt-hero { grid-column: 1 / -1; margin-bottom: 28px; }
          .gp-dt-left { grid-column: 1; }
          .gp-dt-right { grid-column: 2; position: sticky; top: 80px; }

          /* on desktop we don't use the mobile hr/section padding */
          .gp-hr { display: none; }
          .gp-section { padding: 0; margin-bottom: 20px; }
          .gp-hero { display: none; } /* hidden — desktop uses gp-dt-hero instead */
          .gp-sticky-footer { display: none; } /* join widget is in right column */

          .gp-prop-img { height: 220px; }
        }
      `}</style>

      {/* Nav */}
      <div className="gp-nav">
        <a href="/" className="gp-logo">HomeHive</a>
        <a href="/homes" className="gp-nav-link">Browse all homes →</a>
      </div>

      {/* ─── MOBILE: single-column page ─── */}
      <div className="gp-page">

        {/* Mobile hero */}
        <div className="gp-hero">
          <div className="gp-badge" style={{ background: ac.light, borderColor: ac.border, color: ac.main }}>
            {genderLabel(group.gender_preference)}
          </div>
          <div className="gp-headline">{group.emoji} {headlineText(group.gender_preference, propertyName)}</div>
          {group.description && <div style={{ fontSize: 13, color: '#6b6b6b', lineHeight: 1.6, marginTop: 6 }}>{group.description}</div>}
          <div className="gp-persuade">{persuasiveLine(group.gender_preference, members.length)}</div>
        </div>

        {/* ─── DESKTOP hero (above columns) ─── */}
        <div className="gp-dt-hero" style={{ display: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #ede9e0', borderRadius: 18, padding: '28px 32px', display: 'flex', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="gp-badge" style={{ background: ac.light, borderColor: ac.border, color: ac.main, marginBottom: 12 }}>
                {genderLabel(group.gender_preference)}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2, letterSpacing: '-0.5px', marginBottom: 8 }}>
                {group.emoji} {headlineText(group.gender_preference, propertyName)}
              </div>
              {group.description && (
                <div style={{ fontSize: 14, color: '#6b6b6b', lineHeight: 1.65, marginBottom: 10 }}>{group.description}</div>
              )}
              <div style={{ fontSize: 13, color: '#6b6b6b' }}>{persuasiveLine(group.gender_preference, members.length)}</div>
            </div>
            {property && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: ac.soft, border: `1px solid ${ac.border}`, borderRadius: 12, padding: '14px 18px', minWidth: 220 }}>
                <div style={{ fontSize: 28 }}>🏠</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{property.name}</div>
                  <div style={{ fontSize: 12, color: '#9b9b9b', marginTop: 2 }}>📍 {property.address}</div>
                  <div style={{ fontSize: 12, color: '#6b6b6b', marginTop: 4, display: 'flex', gap: 10 }}>
                    {property.beds > 0 && <span><strong>{property.beds}</strong> bed{property.beds !== 1 ? 's' : ''}</span>}
                    {property.baths > 0 && <span><strong>{property.baths}</strong> bath{property.baths !== 1 ? 's' : ''}</span>}
                    {property.sqft && <span>{property.sqft} sqft</span>}
                  </div>
                  <a
                    href={`/homes/${property.slug ?? group.property_slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 600, color: ac.main, textDecoration: 'none' }}
                  >
                    View listing ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── LEFT COLUMN (desktop) / sections (mobile) ─── */}
        <div className="gp-dt-left">

          {/* Members — first on mobile, left col on desktop */}
          <div className="gp-hr" />
          <div className="gp-section">
            <MembersSection members={members} roomMap={roomMap} acMain={ac.main} />
          </div>

          {/* Property — below members on mobile, left col desktop */}
          {property && (
            <>
              <div className="gp-hr" style={{ marginTop: 18 }} />
              <div className="gp-section" style={{ paddingTop: 18 }}>
                <div className="gp-section-label">The home</div>
                <div className="gp-prop-card">
                  {property.hero_image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={property.hero_image} alt={property.name} className="gp-prop-img" />
                  )}
                  <div className="gp-prop-body">
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', marginBottom: 3 }}>{property.name}</div>
                    <div style={{ fontSize: 12, color: '#9b9b9b', marginBottom: 10 }}>📍 {property.address}</div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      {property.beds > 0 && <span style={{ fontSize: 13, color: '#6b6b6b' }}><strong style={{ color: '#1a1a1a' }}>{property.beds}</strong> bed{property.beds !== 1 ? 's' : ''}</span>}
                      {property.baths > 0 && <span style={{ fontSize: 13, color: '#6b6b6b' }}><strong style={{ color: '#1a1a1a' }}>{property.baths}</strong> bath{property.baths !== 1 ? 's' : ''}</span>}
                      {property.sqft && <span style={{ fontSize: 13, color: '#6b6b6b' }}>{property.sqft} sqft</span>}
                    </div>
                    {property.description && (
                      <div style={{ marginTop: 10, fontSize: 13, color: '#6b6b6b', lineHeight: 1.65 }}>{property.description}</div>
                    )}
                    <a
                      href={`/homes/${property.slug ?? group.property_slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 14, fontSize: 13, fontWeight: 600, color: ac.main, textDecoration: 'none' }}
                    >
                      View full listing ↗
                    </a>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Rooms */}
          {pricedRooms.length > 0 && (
            <>
              <div className="gp-hr" style={{ marginTop: property ? 0 : 18 }} />
              <div className="gp-section" style={{ paddingTop: 18 }}>
                <div className="gp-section-label">Rooms &amp; pricing</div>
                {pricedRooms.map(room => {
                  const assignedMember = members.find(m => m.room_id === room.id)
                  const available = room.is_available && !assignedMember
                  const thumbUrl = room.images?.[0] ?? null
                  return (
                    <div className="gp-room" key={room.id} style={!available ? { opacity: 0.7 } : {}}>
                      {thumbUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrl}
                          alt={room.name}
                          style={{ width: 52, height: 40, objectFit: 'cover', borderRadius: 7, border: '1px solid #ede9e0', flexShrink: 0, marginRight: 10 }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{room.name}</div>
                        {assignedMember && (
                          <div style={{ fontSize: 11, color: ac.main, fontWeight: 600, marginTop: 2 }}>
                            Reserved for {assignedMember.first_name ?? 'a member'}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>
                          ${room.price.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#9b9b9b' }}>/mo</span>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, marginTop: 2, color: available ? '#10b981' : '#9b9b9b' }}>
                          {available ? 'Available' : assignedMember ? 'Reserved' : 'Taken'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Share */}
          <div className="gp-hr" style={{ marginTop: 18 }} />
          <div className="gp-section" style={{ paddingTop: 18, paddingBottom: 4 }}>
            <div className="gp-section-label">Share this group</div>
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

        {/* ─── RIGHT COLUMN (desktop only) — join widget ─── */}
        <div className="gp-dt-right" style={{ display: 'none' }}>
          <div style={{ background: '#fff', border: '1px solid #ede9e0', borderRadius: 16, padding: '22px 22px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
              {members.length} {members.length === 1 ? 'person' : 'people'} in this group
            </div>
            <div style={{ fontSize: 12, color: '#9b9b9b', marginBottom: 18 }}>Free to join · No commitment</div>
            {joined ? (
              <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: 12, padding: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>🎉</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#15803d', marginBottom: 3 }}>You&apos;re in!</div>
                <div style={{ fontSize: 12, color: '#166534' }}>The landlord will be in touch to coordinate.</div>
              </div>
            ) : (
              <>
                <button
                  disabled={joining}
                  onClick={handleJoin}
                  style={{
                    width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 700,
                    cursor: joining ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans,sans-serif',
                    border: 'none', background: ac.gradient, color: '#fff',
                    opacity: joining ? 0.6 : 1, transition: 'opacity 0.15s', letterSpacing: '-0.2px',
                    marginBottom: 8,
                  }}
                >
                  {joining ? 'Joining…' : currentUser ? 'Join This Group →' : 'Sign In to Join →'}
                </button>
                {joinError
                  ? <div style={{ textAlign: 'center', fontSize: 11, color: '#ef4444' }}>{joinError}</div>
                  : <div style={{ textAlign: 'center', fontSize: 11, color: '#9b9b9b' }}>Free · No commitment · Just express interest</div>
                }
              </>
            )}
          </div>

          {/* Mini rooms summary on desktop sidebar */}
          {pricedRooms.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #ede9e0', borderRadius: 16, padding: '18px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#9b9b9b', marginBottom: 12 }}>Rooms</div>
              {pricedRooms.map(room => {
                const assignedMember = members.find(m => m.room_id === room.id)
                const available = room.is_available && !assignedMember
                return (
                  <div key={room.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f5f4f0', opacity: available ? 1 : 0.65 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{room.name}</div>
                      {assignedMember && <div style={{ fontSize: 11, color: ac.main, fontWeight: 600 }}>→ {assignedMember.first_name}</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>${room.price.toLocaleString()}<span style={{ fontSize: 10, color: '#9b9b9b', fontWeight: 400 }}>/mo</span></div>
                      <div style={{ fontSize: 10, color: available ? '#10b981' : '#9b9b9b', fontWeight: 700 }}>
                        {available ? 'Open' : 'Reserved'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* Mobile sticky footer */}
      <div className="gp-sticky-footer">
        <div className="gp-sticky-inner">
          {joined ? (
            <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: 12, padding: '14px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d', marginBottom: 2 }}>You&apos;re in the group 🎉</div>
              <div style={{ fontSize: 11, color: '#166534' }}>The landlord will reach out to coordinate.</div>
            </div>
          ) : (
            <>
              <button
                disabled={joining}
                onClick={handleJoin}
                style={{
                  width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 700,
                  cursor: joining ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans,sans-serif',
                  border: 'none', background: ac.gradient, color: '#fff',
                  opacity: joining ? 0.6 : 1,
                }}
              >
                {joining ? 'Joining…' : currentUser ? 'Join This Group →' : 'Sign In to Join →'}
              </button>
              {joinError
                ? <div style={{ textAlign: 'center', fontSize: 11, color: '#ef4444', marginTop: 6 }}>{joinError}</div>
                : <div style={{ textAlign: 'center', fontSize: 11, color: '#9b9b9b', marginTop: 6 }}>Free · No commitment · Just express interest</div>
              }
            </>
          )}
        </div>
      </div>

      {/* Desktop show/hide script */}
      <style>{`
        @media (min-width: 768px) {
          .gp-dt-hero { display: block !important; }
          .gp-dt-right { display: block !important; }
          .gp-page { padding-bottom: 60px; }
          .gp-hr { display: none !important; }
          .gp-section { padding-top: 0 !important; margin-bottom: 20px; }
        }
      `}</style>
    </>
  )
}

function MembersSection({ members, roomMap, acMain }: { members: Member[]; roomMap: Record<string, Room>; acMain: string }) {
  const ac = { main: acMain }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#9b9b9b', marginBottom: 14 }}>
        Who&apos;s in the group
      </div>
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 20px', background: '#fff', border: '1px dashed #ddd9d1', borderRadius: 14 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>👀</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>No one yet — be the first!</div>
          <div style={{ fontSize: 12, color: '#9b9b9b' }}>Your name will show up here after you join.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {members.map((m, i) => {
            const initials = ((m.first_name?.[0] || '') + (m.last_name?.[0] || '')).toUpperCase() || `${i + 1}`
            const pal = avatarColors(i)
            const assignedRoom = m.room_id ? roomMap[m.room_id] : null
            const tags = [
              m.occupation,
              m.university ? `🎓 ${m.university}` : null,
              m.lifestyle ? (LIFESTYLE_LABELS[m.lifestyle] ?? m.lifestyle) : null,
              m.gender && m.gender !== 'Prefer not to say' ? m.gender : null,
            ].filter(Boolean) as string[]
            const roomPhotos = assignedRoom?.images ?? []
            return (
              <div key={m.id} style={{ background: '#fff', border: '1px solid #ede9e0', borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: pal.bg, color: pal.fg, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{m.first_name ?? 'Member'} {m.last_name ?? ''}</div>
                      {m.has_prescreen && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.09)', border: '1px solid rgba(16,185,129,0.22)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          ✓ Screened
                        </span>
                      )}
                    </div>
                    {assignedRoom && (
                      <div style={{ fontSize: 11, color: ac.main, fontWeight: 600, marginTop: 2 }}>
                        {assignedRoom.name}{assignedRoom.price ? ` · $${assignedRoom.price}/mo` : ''}
                      </div>
                    )}
                  </div>
                </div>
                {m.about && (
                  <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 12, borderLeft: '2px solid #ede9e0' }}>
                    {m.about}
                  </div>
                )}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {tags.map(t => (
                      <span key={t} style={{ fontSize: 11, color: '#6b6b6b', background: '#f5f4f0', border: '1px solid #ede9e0', padding: '3px 9px', borderRadius: 20 }}>{t}</span>
                    ))}
                  </div>
                )}
                {/* Room photo strip — shown when member is assigned a room that has photos */}
                {assignedRoom && roomPhotos.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                    {roomPhotos.map((url, pi) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={pi}
                        src={url}
                        alt={`${assignedRoom.name} photo ${pi + 1}`}
                        style={{ height: 100, width: 'auto', minWidth: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid #ede9e0', flexShrink: 0 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
