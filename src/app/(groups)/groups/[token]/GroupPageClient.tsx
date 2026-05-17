'use client'

import { useState, useEffect, use, useCallback, useRef } from 'react'
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

type ChatMessage = {
  id: string; sender_id: string | null; sender_name: string
  content: string; is_bot: boolean; created_at: string
}

function formatTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

const LIFESTYLE_LABELS: Record<string, string> = {
  'Early riser / quiet': '☀️ Early riser',
  'Night owl / social': '🌙 Night owl',
  'Balanced': '⚖️ Balanced',
  'Work from home': '💻 WFH',
  'Family-oriented': '🏡 Family',
}

function accentColor(pref: string) {
  if (pref === 'girls_only') return { main: '#db2777', light: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.2)', gradient: 'linear-gradient(135deg,#db2777,#9d174d)', soft: '#fdf2f8', hero: 'linear-gradient(160deg,#1a0a12 0%,#3b0a22 60%,#1a0a12 100%)' }
  if (pref === 'boys_only') return { main: '#2563eb', light: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', gradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)', soft: '#eff6ff', hero: 'linear-gradient(160deg,#06101f 0%,#0d2240 60%,#06101f 100%)' }
  return { main: '#8C1D40', light: 'rgba(140,29,64,0.07)', border: 'rgba(140,29,64,0.18)', gradient: 'linear-gradient(135deg,#8C1D40,#6b1530)', soft: '#fdf5f7', hero: 'linear-gradient(160deg,#0f172a 0%,#1e1224 60%,#0f172a 100%)' }
}

function genderLabel(pref: string) {
  if (pref === 'girls_only') return '♀ Girls Only'
  if (pref === 'boys_only') return '♂ Boys Only'
  return '⚤ Open to All'
}

function heroTagline(pref: string, propertyName: string) {
  if (pref === 'girls_only') return `All-girls group forming at ${propertyName}`
  if (pref === 'boys_only') return `All-guys group forming at ${propertyName}`
  return `Roommate group forming at ${propertyName}`
}

function persuasiveLine(pref: string, count: number) {
  const n = count === 0 ? 'No one yet' : count === 1 ? '1 person' : `${count} people`
  if (pref === 'girls_only') return `${n} in the group · All-female household · Safe, like-minded space`
  if (pref === 'boys_only') return `${n} in the group · All-male household · Low-key, easy setup`
  return `${n} in the group · Mixed household · Join free, no commitment`
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
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<GroupData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [joinResult, setJoinResult] = useState<{ lead_id: string; has_prescreen: boolean } | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null)
  const [copiedShare, setCopiedShare] = useState(false)
  // Join modal
  const [joinModalOpen, setJoinModalOpen] = useState(false)
  const [selectedRoomId, setSelectedRoomId] = useState<string | 'none' | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; roomName: string } | null>(null)
  // Chat
  const [hasChat, setHasChat] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatGroupId, setChatGroupId] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [memberJoinedAt, setMemberJoinedAt] = useState<string | null>(null)
  const [memberRoomName, setMemberRoomName] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatOpenRef = useRef(false)

  const openLightbox = useCallback((images: string[], index: number, roomName: string) => {
    setLightbox({ images, index, roomName })
  }, [])

  const closeLightbox = useCallback(() => setLightbox(null), [])

  const lightboxPrev = useCallback(() => setLightbox(lb => lb ? { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length } : lb), [])
  const lightboxNext = useCallback(() => setLightbox(lb => lb ? { ...lb, index: (lb.index + 1) % lb.images.length } : lb), [])

  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') lightboxPrev()
      else if (e.key === 'ArrowRight') lightboxNext()
      else if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, lightboxPrev, lightboxNext, closeLightbox])

  const checkChatAccess = useCallback(async (accessToken: string) => {
    const res = await fetch(`/api/groups/share/${token}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.ok) {
      const d = await res.json()
      setHasChat(true)
      setChatGroupId(d.group_id)
      setChatMessages(d.messages)
      setJoined(true)
      // Try to get member's joined_at and room from the user/groups endpoint
      try {
        const gr = await fetch('/api/user/groups', { headers: { Authorization: `Bearer ${accessToken}` } })
        if (gr.ok) {
          const gd = await gr.json()
          const myGroup = (gd.groups || []).find((g: { id: string }) => g.id === d.group_id)
          if (myGroup) {
            setMemberJoinedAt(myGroup.joined_at)
            setMemberRoomName(myGroup.room_name)
          }
        }
      } catch { /* ignore */ }
    }
  }, [token])

  const sendMessage = async () => {
    if (!chatInput.trim() || sending) return
    const content = chatInput.trim()
    setChatInput('')
    setSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/groups/share/${token}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ content }),
    })
    if (res.ok) {
      const d = await res.json()
      if (d.message) setChatMessages(prev => [...prev, d.message])
    }
    setSending(false)
  }

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    fetch(`/api/groups/share/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); else setNotFound(true) })
      .finally(() => setLoading(false))
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        setCurrentUser({ id: user.id, email: user.email! })
        const { data: { session } } = await supabase.auth.getSession()
        if (session) checkChatAccess(session.access_token)
      }
    })
  }, [token, checkChatAccess])

  // Real-time subscription for new messages
  useEffect(() => {
    if (!chatGroupId) return
    const channel = supabase
      .channel(`chat-${chatGroupId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'group_messages',
        filter: `group_id=eq.${chatGroupId}`,
      }, (payload) => {
        const msg = payload.new as ChatMessage
        setChatMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
        if (!chatOpenRef.current) setChatUnread(n => n + 1)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [chatGroupId])

  // Keep chatOpenRef in sync and auto-scroll
  useEffect(() => { chatOpenRef.current = chatOpen }, [chatOpen])
  useEffect(() => {
    if (chatOpen) setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
  }, [chatMessages, chatOpen])

  const openJoinModal = (preSelectRoomId?: string) => {
    if (joined) return
    setJoinModalOpen(true)
    setSelectedRoomId(preSelectRoomId ?? null)
    setJoinError(null)
  }

  const handleJoin = async () => {
    if (!currentUser) {
      router.push(`/login?next=/groups/${token}`)
      return
    }
    setJoining(true); setJoinError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const roomId = selectedRoomId === 'none' || selectedRoomId === null ? null : selectedRoomId
    const res = await fetch(`/api/groups/share/${token}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ room_id: roomId }),
    })
    const body = await res.json()
    if (res.ok || body.already_member) {
      setJoined(true)
      if (body.lead_id) setJoinResult({ lead_id: body.lead_id, has_prescreen: !!body.has_prescreen })
      if (session) checkChatAccess(session.access_token)
      setJoinModalOpen(false)
    } else {
      setJoinError(body.error || 'Something went wrong')
    }
    setJoining(false)
  }

  if (!mounted || loading) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans,sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 14, display: 'inline-block' }}>🐝</div>
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
  const openRooms = pricedRooms.filter(r => r.is_available && !members.find(m => m.room_id === r.id)).length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; -webkit-font-smoothing: antialiased; }
        :root { --ac-main: ${ac.main}; --ac-gradient: ${ac.gradient}; --ac-light: ${ac.light}; }
        @keyframes beeWiggle { 0%,100%{transform:rotate(-8deg)} 50%{transform:rotate(8deg)} }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }

        /* ── FOCUSED NAV ── */
        .gp-nav { background: rgba(255,255,255,0.97); backdrop-filter: blur(14px); border-bottom: 1px solid #e8e4db; padding: 0 20px; height: 54px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 30; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
        .gp-nav-logo { text-decoration: none; display: inline-flex; align-items: center; }
        .gp-nav-logo img { height: 22px; width: auto; display: block; }
        .gp-nav-right { display: flex; align-items: center; gap: 10px; }
        .gp-nav-homes { font-size: 12px; color: #6b6b6b; text-decoration: none; font-weight: 500; padding: 5px 10px; border-radius: 6px; transition: color 0.15s, background 0.15s; }
        .gp-nav-homes:hover { color: #1a1a1a; background: #f5f4f0; }
        .gp-nav-auth { font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: 7px; text-decoration: none; cursor: pointer; font-family: 'DM Sans',sans-serif; transition: opacity 0.15s; }
        .gp-nav-signup { background: #8C1D40; color: #fff; border: none; }
        .gp-nav-signup:hover { opacity: 0.88; }
        .gp-nav-login { background: transparent; color: #4b5563; border: 1px solid #e8e4db; }
        .gp-nav-login:hover { background: #f5f4f0; color: #1a1a1a; }
        .gp-nav-user { display: flex; align-items: center; gap: 7px; }
        .gp-nav-avatar { width: 28px; height: 28px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gp-nav-email { font-size: 11px; color: #6b6b6b; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        /* ── HERO CARD ── */
        .gp-hero-wrap { padding: 20px 16px 0; }
        .gp-hero-card { background: #fff; border: 1px solid #ede9e0; border-radius: 18px; box-shadow: 0 2px 16px rgba(0,0,0,0.06); overflow: hidden; animation: fadeUp 0.4s ease both; }
        .gp-hero-accent { height: 4px; }
        .gp-hero-inner { padding: 18px 20px 16px; }
        .gp-private-label { font-size: 9px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #b0a898; }
        .gp-gender-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; border: 1px solid; }
        .gp-hero-emoji { font-size: 26px; line-height: 1; }
        .gp-hero-name { font-size: 20px; font-weight: 700; color: #1a1a1a; line-height: 1.2; letter-spacing: -0.4px; }
        .gp-hero-tagline { font-size: 12px; color: #9b9b9b; }
        .gp-stat-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; display: inline-block; margin-right: 5px; box-shadow: 0 0 5px rgba(34,197,94,0.5); }
        .gp-stat-text { font-size: 12px; color: #6b6b6b; font-weight: 500; }
        .gp-hero-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .gp-hero-action-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans',sans-serif; text-decoration: none; transition: background 0.15s, box-shadow 0.15s; }
        .gp-hero-btn-outline { background: #fff; color: #4b5563; border: 1px solid #e8e4db; }
        .gp-hero-btn-outline:hover { background: #f5f4f0; color: #1a1a1a; }

        /* ── ROOM PHOTO CLICK ── */
        .gp-room-thumb { position: relative; flex-shrink: 0; cursor: pointer; border-radius: 8px; overflow: hidden; }
        .gp-room-thumb img { display: block; width: 72px; height: 56px; object-fit: cover; border: 1px solid #ede9e0; border-radius: 8px; transition: filter 0.15s; }
        .gp-room-thumb:hover img { filter: brightness(0.78); }
        .gp-room-thumb-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; pointer-events: none; }
        .gp-room-thumb-icon { font-size: 14px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
        .gp-room-thumb-count { font-size: 9px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.7); letter-spacing: 0.3px; }

        /* ── PAGE LAYOUT ── */
        .gp-page { max-width: 1080px; margin: 0 auto; }
        .gp-columns { padding: 28px 20px 80px; display: flex; flex-direction: column; gap: 20px; }

        /* ── CARDS ── */
        .gp-card { background: #fff; border: 1px solid #ede9e0; border-radius: 18px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
        .gp-card-body { padding: 22px; }
        .gp-section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 14px; }

        /* ── STATUS CARD (member) ── */
        .gp-status-card { background: linear-gradient(135deg,#fef3c7,#fef9e7); border: 1.5px solid #fde68a; border-radius: 16px; padding: 18px 20px; }
        .gp-status-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 4px; }
        .gp-status-sub { font-size: 13px; color: #b45309; }

        /* ── PRIMARY ACTION ── */
        .gp-primary-action { width: 100%; padding: 16px; border-radius: 14px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: 'DM Sans',sans-serif; border: none; letter-spacing: -0.2px; transition: opacity 0.15s, box-shadow 0.15s; }
        .gp-join-btn { background: var(--ac-gradient); color: #fff; }
        .gp-join-btn:hover { opacity: 0.9; }
        .gp-chat-btn { background: linear-gradient(135deg,#FFC627,#f5a623); color: #1a1a1a; display: flex; align-items: center; justify-content: center; gap: 12px; }
        .gp-chat-btn:hover { box-shadow: 0 6px 24px rgba(255,198,39,0.45); }
        .gp-action-note { text-align: center; font-size: 11px; color: #9b9b9b; margin-top: 7px; }

        /* ── MEMBER CARDS ── */
        .gp-member-card { background: #fff; border: 1px solid #ede9e0; border-radius: 16px; padding: 18px; transition: box-shadow 0.15s; }
        .gp-member-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); }
        .gp-member-avatar { width: 48px; height: 48px; border-radius: 50%; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gp-member-name { font-size: 16px; font-weight: 700; color: #1a1a1a; line-height: 1.2; }
        .gp-member-about { font-size: 13px; color: #4b5563; line-height: 1.6; margin-top: 10px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .gp-tag { font-size: 11px; color: #6b6b6b; background: #f5f4f0; border: 1px solid #ede9e0; padding: 3px 9px; border-radius: 20px; }

        /* ── ROOM ROWS ── */
        .gp-room { display: flex; align-items: center; padding: 13px 14px; border-radius: 12px; background: #faf9f7; border: 1.5px solid #ede9e0; margin-bottom: 8px; gap: 10px; transition: border-color 0.15s, box-shadow 0.15s; }
        .gp-room-available { cursor: pointer; }
        .gp-room-available:hover { border-color: var(--ac-main); box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
        .gp-room-reserved { opacity: 0.75; }
        .gp-room-reserve-btn { flex-shrink: 0; padding: 7px 13px; border-radius: 8px; font-size: 12px; font-weight: 700; border: none; cursor: pointer; font-family: 'DM Sans',sans-serif; transition: opacity 0.15s; white-space: nowrap; }
        .gp-room-assignee { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .gp-room-assignee-avatar { width: 24px; height: 24px; border-radius: 50%; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

        /* ── SHARE ── */
        .gp-share-input { flex: 1; background: #f5f4f0; border: 1px solid #ede9e0; border-radius: 8px; padding: 9px 12px; font-size: 12px; color: #6b6b6b; outline: none; font-family: 'DM Sans',sans-serif; min-width: 0; }
        .gp-share-btn { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 9px 14px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: 'DM Sans',sans-serif; }

        /* ── PROPERTY CARD ── */
        .gp-prop-img { width: 100%; height: 200px; object-fit: cover; display: block; }

        /* ── CHAT LOCKED ── */
        .gp-chat-locked { background: #fff; border: 1.5px solid #ede9e0; border-radius: 14px; overflow: hidden; }

        /* ── MOBILE STICKY FOOTER ── */
        .gp-sticky-footer { display: block; position: fixed; bottom: 0; left: 0; right: 0; z-index: 20; background: rgba(255,255,255,0.96); backdrop-filter: blur(12px); border-top: 1px solid #ede9e0; padding: 14px 20px 28px; }

        /* ── DESKTOP ── */
        @media (min-width: 768px) {
          .gp-hero-wrap { padding: 28px 40px 0; }
          .gp-hero-inner { padding: 22px 28px 20px; }
          .gp-hero-name { font-size: 22px; }
          .gp-columns { padding: 24px 40px 60px; flex-direction: row; align-items: flex-start; gap: 28px; }
          .gp-col-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
          .gp-col-right { width: 360px; flex-shrink: 0; position: sticky; top: 76px; display: flex; flex-direction: column; gap: 14px; }
          .gp-sticky-footer { display: none; }
          .gp-prop-img { height: 240px; }
          .gp-hero-emoji { font-size: 30px; }
        }
        @media (max-width: 767px) {
          .gp-col-right { display: none; }
          .gp-col-left { display: flex; flex-direction: column; gap: 16px; }
        }
      `}</style>

      {/* ── FOCUSED NAV ── */}
      <nav className="gp-nav">
        <a href="/" className="gp-nav-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hh-logo.png" alt="HomeHive" />
        </a>
        <div className="gp-nav-right">
          <a href="/homes" className="gp-nav-homes">Browse homes →</a>
          {currentUser ? (
            <div className="gp-nav-user">
              <div className="gp-nav-avatar">
                {currentUser.email?.[0]?.toUpperCase() ?? '?'}
              </div>
              <span className="gp-nav-email">{currentUser.email}</span>
            </div>
          ) : (
            <>
              <a href={`/login?next=/groups/${token}`} className="gp-nav-auth gp-nav-login">Log in</a>
              <a href={`/signup?next=/groups/${token}`} className="gp-nav-auth gp-nav-signup">Sign up free</a>
            </>
          )}
        </div>
      </nav>

      <div className="gp-page">

        {/* ═══════════════ HERO CARD ═══════════════ */}
        <div className="gp-hero-wrap">
          <div className="gp-hero-card">
            {/* Accent color bar */}
            <div className="gp-hero-accent" style={{ background: ac.gradient }} />
            <div className="gp-hero-inner">
              {/* Row 1: identity */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className="gp-hero-emoji">{group.emoji}</span>
                <span className="gp-hero-name">{group.name}</span>
                <span className="gp-gender-badge" style={{ background: ac.light, borderColor: ac.border, color: ac.main }}>
                  {genderLabel(group.gender_preference)}
                </span>
                <span className="gp-private-label">Private Group</span>
              </div>
              {/* Row 2: stats + tagline + actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <span className="gp-stat-text">
                  <span className="gp-stat-dot" />
                  {members.length} member{members.length !== 1 ? 's' : ''}{openRooms > 0 ? ` · ${openRooms} room${openRooms !== 1 ? 's' : ''} open` : ''}
                </span>
                <span className="gp-hero-tagline">{heroTagline(group.gender_preference, propertyName)}</span>
                <div className="gp-hero-actions" style={{ marginLeft: 'auto' }}>
                  {property && (
                    <a
                      href={`/homes/${property.slug ?? group.property_slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gp-hero-action-btn gp-hero-btn-outline"
                    >
                      View Listing ↗
                    </a>
                  )}
                  <button
                    className="gp-hero-action-btn gp-hero-btn-outline"
                    onClick={() => { navigator.clipboard.writeText(shareUrl); setCopiedShare(true); setTimeout(() => setCopiedShare(false), 2000) }}
                  >
                    🔗 {copiedShare ? 'Copied!' : 'Share'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════ COLUMNS ═══════════════ */}
        <div className="gp-columns">

          {/* ─── LEFT COLUMN ─── */}
          <div className="gp-col-left">

            {/* YOUR STATUS — member only */}
            {hasChat && (
              <div className="gp-status-card">
                <div className="gp-status-title">You&apos;re in 🎯</div>
                <div className="gp-status-sub">
                  {memberRoomName ? `🛏 ${memberRoomName}` : 'Room TBD by landlord'}
                  {memberJoinedAt ? ` · Joined ${daysAgo(memberJoinedAt)}` : ''}
                  {' · Including you, '}
                  {members.length} member{members.length !== 1 ? 's' : ''} total
                </div>
              </div>
            )}

            {/* WHO'S IN THE GROUP */}
            <div className="gp-card">
              <div className="gp-card-body">
                <div className="gp-section-label">
                  Your Future Roommates
                  {hasChat && members.length > 0 && (
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 12, color: '#9b9b9b', marginLeft: 8 }}>
                      · Including you!
                    </span>
                  )}
                </div>
                <MembersSection members={members} roomMap={roomMap} acMain={ac.main} onPhotoClick={openLightbox} />
              </div>
            </div>

            {/* THE HOME */}
            {property && (
              <div className="gp-card">
                {property.hero_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={property.hero_image} alt={property.name} className="gp-prop-img" />
                )}
                <div className="gp-card-body">
                  <div className="gp-section-label">The Home</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{property.name}</div>
                  <div style={{ fontSize: 12, color: '#9b9b9b', marginBottom: 12 }}>📍 {property.address}</div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: property.description ? 12 : 0 }}>
                    {property.beds > 0 && <span style={{ fontSize: 13, color: '#6b6b6b' }}><strong style={{ color: '#1a1a1a' }}>{property.beds}</strong> bed{property.beds !== 1 ? 's' : ''}</span>}
                    {property.baths > 0 && <span style={{ fontSize: 13, color: '#6b6b6b' }}><strong style={{ color: '#1a1a1a' }}>{property.baths}</strong> bath{property.baths !== 1 ? 's' : ''}</span>}
                    {property.sqft && <span style={{ fontSize: 13, color: '#6b6b6b' }}>{property.sqft} sqft</span>}
                  </div>
                  {property.description && (
                    <div style={{ fontSize: 13, color: '#6b6b6b', lineHeight: 1.65, marginBottom: 14 }}>{property.description}</div>
                  )}
                  <a
                    href={`/homes/${property.slug ?? group.property_slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: ac.main, textDecoration: 'none' }}
                  >
                    View full listing ↗
                  </a>
                </div>
              </div>
            )}

            {/* ROOMS & PRICING */}
            {pricedRooms.length > 0 && (
              <div className="gp-card">
                <div className="gp-card-body">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div className="gp-section-label" style={{ marginBottom: 0 }}>Rooms &amp; Pricing</div>
                    <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>
                      {openRooms > 0 ? `${openRooms} open` : 'All reserved'}
                    </span>
                  </div>
                  {pricedRooms.map((room, idx) => {
                    const assignedMember = members.find(m => m.room_id === room.id)
                    const available = room.is_available && !assignedMember
                    const thumbUrl = room.images?.[0] ?? null
                    const pal = avatarColors(idx)
                    return (
                      <div
                        key={room.id}
                        className={`gp-room ${available && !joined && !hasChat ? 'gp-room-available' : ''} ${!available ? 'gp-room-reserved' : ''}`}
                        onClick={() => available && !joined && !hasChat ? openJoinModal(room.id) : undefined}
                      >
                        {thumbUrl ? (
                          <div
                            className="gp-room-thumb"
                            onClick={e => { e.stopPropagation(); openLightbox(room.images, 0, room.name) }}
                            title={`View ${room.images.length} photo${room.images.length !== 1 ? 's' : ''}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl} alt={room.name} />
                            <div className="gp-room-thumb-overlay">
                              <span className="gp-room-thumb-icon">🔍</span>
                              {room.images.length > 1 && (
                                <span className="gp-room-thumb-count">{room.images.length} photos</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f5f4f0', border: '1px solid #ede9e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🛏</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{room.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginTop: 1 }}>
                            ${room.price.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#9b9b9b' }}>/mo</span>
                          </div>
                        </div>
                        {available && !joined && !hasChat ? (
                          <button
                            className="gp-room-reserve-btn"
                            style={{ background: ac.gradient, color: '#fff' }}
                            onClick={e => { e.stopPropagation(); openJoinModal(room.id) }}
                          >
                            Reserve →
                          </button>
                        ) : assignedMember ? (
                          <div className="gp-room-assignee">
                            <div className="gp-room-assignee-avatar" style={{ background: pal.bg, color: pal.fg }}>
                              {(assignedMember.first_name?.[0] ?? '?').toUpperCase()}
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: ac.main }}>{assignedMember.first_name ?? 'Member'}</div>
                              <div style={{ fontSize: 10, color: '#9b9b9b', fontWeight: 600 }}>Reserved</div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, fontWeight: 700, color: available ? '#10b981' : '#9b9b9b', flexShrink: 0 }}>
                            {available ? 'Available' : 'Taken'}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* GROUP CHAT — secondary access (member) or locked (non-member) */}
            <div className="gp-card">
              <div className="gp-card-body">
                <div className="gp-section-label">Group Chat</div>
                {hasChat ? (
                  <button
                    onClick={() => { setChatOpen(true); setChatUnread(0) }}
                    className="gp-primary-action gp-chat-btn"
                  >
                    <span style={{ fontSize: 28, animation: 'beeWiggle 1.8s ease-in-out infinite', display: 'inline-block' }}>🐝</span>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>
                        Open Group Chat
                        {chatUnread > 0 && (
                          <span style={{ marginLeft: 8, background: '#ef4444', color: '#fff', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>{chatUnread} new</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 1, fontWeight: 400 }}>
                        Chat with your {members.length > 0 ? `${members.length} roommate${members.length !== 1 ? 's' : ''}` : 'future roommates'}
                      </div>
                    </div>
                    <span style={{ fontSize: 18, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto' }}>→</span>
                  </button>
                ) : (
                  <div className="gp-chat-locked">
                    {/* Blurred preview */}
                    <div style={{ padding: '16px 18px 14px', filter: 'blur(3px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.5 }}>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#FFC627', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🐝</div>
                        <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '4px 14px 14px 14px', padding: '10px 14px', fontSize: 12, color: '#1a1a1a', maxWidth: 240, lineHeight: 1.5 }}>
                          Hey! Welcome to the group chat 🎉 Introduce yourself to your future roommates!
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: 4 }}>
                        <div style={{ background: ac.light, border: `1px solid ${ac.border}`, borderRadius: '14px 4px 14px 14px', padding: '8px 14px', fontSize: 12, color: '#1a1a1a', maxWidth: 180 }}>
                          Hey everyone! Can&apos;t wait to move in 🙌
                        </div>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1d4ed8', flexShrink: 0 }} />
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid #ede9e0', background: '#faf9f7', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ fontSize: 24, flexShrink: 0 }}>🔒</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>Join the group to chat</div>
                        <div style={{ fontSize: 12, color: '#9b9b9b' }}>
                          {!currentUser ? 'Sign in and request to join.' : 'Request to join to unlock the chat.'}
                        </div>
                      </div>
                      <button
                        onClick={() => openJoinModal()}
                        style={{ background: ac.gradient, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans,sans-serif', whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        {currentUser ? 'Join →' : 'Sign In →'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SHARE */}
            <div className="gp-card">
              <div className="gp-card-body">
                <div className="gp-section-label">Share This Group</div>
                <div style={{ fontSize: 13, color: '#6b6b6b', marginBottom: 10 }}>Invite others by sending them this link.</div>
                <div style={{ display: 'flex', gap: 8 }}>
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

          {/* ─── RIGHT COLUMN (desktop sticky) ─── */}
          <div className="gp-col-right">

            {/* JOIN WIDGET or STATUS */}
            <div className="gp-card">
              <div className="gp-card-body">
                {hasChat ? (
                  <>
                    <div className="gp-status-card" style={{ marginBottom: 14 }}>
                      <div className="gp-status-title">You&apos;re in 🎯</div>
                      <div className="gp-status-sub">
                        {memberRoomName ? `🛏 ${memberRoomName}` : 'Room TBD by landlord'}
                        {memberJoinedAt ? ` · Joined ${daysAgo(memberJoinedAt)}` : ''}
                      </div>
                    </div>
                    {joinResult && !joinResult.has_prescreen && (
                      <a
                        href={`/pre-screen/${joinResult.lead_id}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 700, color: '#15803d', background: '#dcfce7', border: '1.5px solid #86efac', textDecoration: 'none', marginBottom: 8 }}
                      >
                        ✏️ Tell your roommates about yourself →
                      </a>
                    )}
                    <button
                      onClick={() => { setChatOpen(true); setChatUnread(0) }}
                      className="gp-primary-action gp-chat-btn"
                    >
                      <span style={{ fontSize: 26, animation: 'beeWiggle 1.8s ease-in-out infinite', display: 'inline-block' }}>🐝</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                          Open Group Chat
                          {chatUnread > 0 && (
                            <span style={{ marginLeft: 8, background: '#ef4444', color: '#fff', borderRadius: 20, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>{chatUnread}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 1, fontWeight: 400 }}>
                          {members.length} roommate{members.length !== 1 ? 's' : ''} inside
                        </div>
                      </div>
                      <span style={{ fontSize: 16, color: 'rgba(0,0,0,0.3)', marginLeft: 'auto' }}>→</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 3 }}>
                      {members.length} {members.length === 1 ? 'person' : 'people'} in this group
                    </div>
                    <div style={{ fontSize: 12, color: '#9b9b9b', marginBottom: 16 }}>{persuasiveLine(group.gender_preference, members.length)}</div>
                    <button
                      onClick={() => openJoinModal()}
                      className="gp-primary-action"
                      style={{ background: ac.gradient, color: '#fff', marginBottom: 8 }}
                    >
                      {currentUser ? 'Request to Join This Group →' : 'Sign In to Join →'}
                    </button>
                    <div className="gp-action-note">Free · No commitment · Just express interest</div>
                  </>
                )}
              </div>
            </div>

            {/* MINI ROOMS — desktop sidebar */}
            {pricedRooms.length > 0 && (
              <div className="gp-card">
                <div className="gp-card-body">
                  <div className="gp-section-label">Rooms</div>
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
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── MOBILE STICKY FOOTER ── */}
      <div className="gp-sticky-footer">
        {hasChat ? (
          <button
            onClick={() => { setChatOpen(true); setChatUnread(0) }}
            className="gp-primary-action gp-chat-btn"
          >
            <span style={{ fontSize: 24, animation: 'beeWiggle 1.8s ease-in-out infinite', display: 'inline-block' }}>🐝</span>
            <span>Open Group Chat {chatUnread > 0 ? `(${chatUnread} new)` : ''}</span>
            <span style={{ marginLeft: 'auto' }}>→</span>
          </button>
        ) : joined ? (
          <div style={{ background: '#dcfce7', border: '1.5px solid #86efac', borderRadius: 12, padding: '14px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d', marginBottom: 2 }}>You&apos;re in the group 🎉</div>
            <div style={{ fontSize: 11, color: '#166534' }}>The landlord will reach out to coordinate.</div>
          </div>
        ) : (
          <>
            <button
              onClick={() => openJoinModal()}
              className="gp-primary-action"
              style={{ background: ac.gradient, color: '#fff' }}
            >
              {currentUser ? 'Request to Join This Group →' : 'Sign In to Join →'}
            </button>
            <div className="gp-action-note" style={{ marginTop: 6 }}>Free · No commitment · Just express interest</div>
          </>
        )}
      </div>

      {/* ── CHAT OVERLAY ── */}
      {chatOpen && hasChat && (
        <>
          <style>{`
            .chat-overlay { position: fixed; inset: 0; z-index: 8500; background: #f5f4f0; display: flex; flex-direction: column; font-family: 'DM Sans',sans-serif; }
            .chat-messages { flex: 1; overflow-y: auto; padding: 16px 16px 8px; }
            .chat-messages::-webkit-scrollbar { width: 4px; }
            .chat-messages::-webkit-scrollbar-thumb { background: #d4c9b0; border-radius: 10px; }
            @media (min-width: 768px) {
              .chat-overlay { left: auto; right: 0; width: 420px; border-left: 1px solid #ede9e0; box-shadow: -8px 0 40px rgba(0,0,0,0.12); }
            }
          `}</style>
          <div className="chat-overlay">
            {/* Header */}
            <div style={{ background: 'linear-gradient(135deg,#FFC627,#f5a623)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <button
                onClick={() => setChatOpen(false)}
                style={{ background: 'rgba(0,0,0,0.1)', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#1a1a1a', flexShrink: 0 }}
              >←</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {data?.group.emoji} {data?.group.name}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)', marginTop: 1 }}>
                  {data?.members.length ?? 0} member{(data?.members.length ?? 0) !== 1 ? 's' : ''} · 🐝 Honeybee is here to help
                </div>
              </div>
              <span style={{ fontSize: 20, animation: 'beeWiggle 1.8s ease-in-out infinite', display: 'inline-block' }}>🐝</span>
            </div>

            {/* Messages */}
            <div className="chat-messages">
              {chatMessages.map((msg) => {
                const isOwn = !msg.is_bot && msg.sender_id === currentUser?.id
                if (msg.is_bot) {
                  return (
                    <div key={msg.id} style={{ marginBottom: 18, maxWidth: 320 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#FFC627', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, boxShadow: '0 2px 8px rgba(255,198,39,0.4)' }}>🐝</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Honeybee</span>
                        <span style={{ fontSize: 11, color: '#b0a898' }}>{formatTime(msg.created_at)}</span>
                      </div>
                      <div style={{ background: '#FFF8E1', border: '1px solid #FFE082', borderRadius: '4px 16px 16px 16px', padding: '12px 16px', fontSize: 13, color: '#1a1a1a', lineHeight: 1.65 }}>
                        {msg.content}
                      </div>
                    </div>
                  )
                }
                if (isOwn) {
                  return (
                    <div key={msg.id} style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
                      <div>
                        <div style={{ textAlign: 'right', fontSize: 11, color: '#b0a898', marginBottom: 4 }}>You · {formatTime(msg.created_at)}</div>
                        <div style={{ background: ac.gradient, color: '#fff', borderRadius: '16px 4px 16px 16px', padding: '10px 14px', fontSize: 13, lineHeight: 1.65, maxWidth: 260, wordBreak: 'break-word' }}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  )
                }
                const colorIdx = (msg.sender_id || msg.sender_name).charCodeAt(0) % 6
                const pal = avatarColors(colorIdx)
                const initials = msg.sender_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={msg.id} style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: pal.bg, color: pal.fg, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
                    <div style={{ maxWidth: 260 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6b6b', marginBottom: 4 }}>{msg.sender_name} · {formatTime(msg.created_at)}</div>
                      <div style={{ background: '#fff', border: '1px solid #ede9e0', borderRadius: '4px 16px 16px 16px', padding: '10px 14px', fontSize: 13, color: '#1a1a1a', lineHeight: 1.65, wordBreak: 'break-word' }}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div style={{ background: '#fff', padding: '12px 16px 28px', display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid #ede9e0', flexShrink: 0 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="Say something to the group…"
                style={{ flex: 1, border: '1.5px solid #e8e5de', borderRadius: 22, padding: '11px 16px', fontSize: 14, outline: 'none', fontFamily: 'DM Sans,sans-serif', background: '#faf9f6', color: '#1a1a1a' }}
              />
              <button
                onClick={sendMessage}
                disabled={!chatInput.trim() || sending}
                style={{ background: 'linear-gradient(135deg,#FFC627,#f5a623)', border: 'none', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: chatInput.trim() && !sending ? 'pointer' : 'default', flexShrink: 0, opacity: chatInput.trim() && !sending ? 1 : 0.4, fontSize: 19, color: '#1a1a1a', fontWeight: 700, boxShadow: chatInput.trim() ? '0 2px 10px rgba(255,198,39,0.4)' : 'none', transition: 'opacity 0.15s, box-shadow 0.15s' }}
              >
                {sending ? '…' : '→'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── JOIN MODAL ── */}
      {joinModalOpen && !joined && (
        <div
          onClick={() => setJoinModalOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: 'DM Sans,sans-serif' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', padding: '0 0 32px' }}
          >
            {/* Handle bar */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e0dbd3' }} />
            </div>

            <div style={{ padding: '8px 22px 0' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px', marginBottom: 4 }}>
                {group.emoji} Join {group.name}
              </div>
              <div style={{ fontSize: 13, color: '#6b6b6b', marginBottom: 20 }}>Free · No commitment · The landlord will follow up</div>

              {/* Room selection */}
              {pricedRooms.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#9b9b9b', marginBottom: 12 }}>
                    Which room are you interested in?
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                    {pricedRooms.map(room => {
                      const assignedMember = members.find(m => m.room_id === room.id)
                      const available = room.is_available && !assignedMember
                      const isSelected = selectedRoomId === room.id
                      return (
                        <div
                          key={room.id}
                          onClick={() => available && setSelectedRoomId(room.id)}
                          style={{
                            border: `2px solid ${isSelected ? ac.main : '#ede9e0'}`,
                            borderRadius: 12,
                            background: isSelected ? ac.light : '#faf9f7',
                            cursor: available ? 'pointer' : 'default',
                            opacity: available ? 1 : 0.5,
                            transition: 'border-color 0.15s, background 0.15s',
                            overflow: 'hidden',
                          }}
                        >
                          {/* Room photo strip */}
                          {room.images.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, padding: '8px 8px 0', overflowX: 'auto' }}>
                              {room.images.map((url, pi) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={pi}
                                  src={url}
                                  alt={`${room.name} photo ${pi + 1}`}
                                  onClick={e => { e.stopPropagation(); openLightbox(room.images, pi, room.name) }}
                                  style={{ height: 80, width: 'auto', minWidth: 100, borderRadius: 7, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)', flexShrink: 0, cursor: 'zoom-in' }}
                                />
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{room.name}</div>
                              {assignedMember
                                ? <div style={{ fontSize: 11, color: ac.main, fontWeight: 600, marginTop: 2 }}>Reserved for {assignedMember.first_name ?? 'a member'}</div>
                                : <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600, marginTop: 2 }}>Available</div>
                              }
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>${room.price.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, color: '#9b9b9b' }}>/mo</span></div>
                              {isSelected && <div style={{ fontSize: 10, fontWeight: 700, color: ac.main, marginTop: 2 }}>✓ Selected</div>}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* No preference option */}
                    <div
                      onClick={() => setSelectedRoomId('none')}
                      style={{
                        border: `2px solid ${selectedRoomId === 'none' ? ac.main : '#ede9e0'}`,
                        borderRadius: 12,
                        background: selectedRoomId === 'none' ? ac.light : '#faf9f7',
                        cursor: 'pointer',
                        padding: '12px 14px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#6b6b6b' }}>No specific preference</div>
                      {selectedRoomId === 'none' && <span style={{ fontSize: 12, fontWeight: 700, color: ac.main }}>✓</span>}
                    </div>
                  </div>
                </>
              )}

              {joinError && (
                <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                  {joinError}
                </div>
              )}

              {/* CTA */}
              <div style={{ marginTop: 16 }}>
                {currentUser ? (
                  <button
                    disabled={joining || (pricedRooms.length > 0 && selectedRoomId === null)}
                    onClick={handleJoin}
                    style={{
                      width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 700,
                      cursor: joining || (pricedRooms.length > 0 && selectedRoomId === null) ? 'not-allowed' : 'pointer',
                      fontFamily: 'DM Sans,sans-serif', border: 'none', background: ac.gradient, color: '#fff',
                      opacity: joining || (pricedRooms.length > 0 && selectedRoomId === null) ? 0.5 : 1,
                      transition: 'opacity 0.15s', letterSpacing: '-0.2px',
                    }}
                  >
                    {joining ? 'Joining…' : pricedRooms.length > 0 && selectedRoomId === null ? 'Pick a room above to continue' : 'Confirm & Join →'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => router.push(`/login?next=/groups/${token}`)}
                      style={{
                        width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'DM Sans,sans-serif', border: 'none', background: ac.gradient, color: '#fff', letterSpacing: '-0.2px',
                      }}
                    >
                      Sign In to Join →
                    </button>
                    <div style={{ textAlign: 'center', fontSize: 11, color: '#9b9b9b', marginTop: 8 }}>
                      {"Don't have an account? "}
                      <a href={`/signup?next=/groups/${token}`} style={{ color: ac.main, fontWeight: 600, textDecoration: 'none' }}>Sign up free</a>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LIGHTBOX ── */}
      {lightbox && (
        <div
          onClick={closeLightbox}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.images[lightbox.index]}
              alt={`${lightbox.roomName} photo ${lightbox.index + 1}`}
              style={{ maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 10, userSelect: 'none', display: 'block' }}
              draggable={false}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', opacity: 0.9 }}>{lightbox.roomName}</span>
              {lightbox.images.length > 1 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{lightbox.index + 1} / {lightbox.images.length}</span>
              )}
            </div>
            {lightbox.images.length > 1 && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); lightboxPrev() }}
                  style={{ position: 'absolute', left: -60, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#fff', backdropFilter: 'blur(4px)' }}
                  aria-label="Previous photo"
                >‹</button>
                <button
                  onClick={e => { e.stopPropagation(); lightboxNext() }}
                  style={{ position: 'absolute', right: -60, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#fff', backdropFilter: 'blur(4px)' }}
                  aria-label="Next photo"
                >›</button>
              </>
            )}
            {lightbox.images.length > 1 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {lightbox.images.map((_, di) => (
                  <button
                    key={di}
                    onClick={e => { e.stopPropagation(); setLightbox(lb => lb ? { ...lb, index: di } : lb) }}
                    style={{ width: di === lightbox.index ? 20 : 8, height: 8, borderRadius: 4, background: di === lightbox.index ? '#fff' : 'rgba(255,255,255,0.3)', border: 'none', cursor: 'pointer', padding: 0, transition: 'all 0.2s' }}
                  />
                ))}
              </div>
            )}
          </div>

          <button
            onClick={closeLightbox}
            style={{ position: 'fixed', top: 18, right: 18, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#fff', backdropFilter: 'blur(4px)' }}
            aria-label="Close"
          >×</button>

          <style>{`@media (min-width: 768px) { .gp-lb-tap { display: none !important; } }`}</style>
          {lightbox.images.length > 1 && (
            <>
              <div className="gp-lb-tap" onClick={e => { e.stopPropagation(); lightboxPrev() }} style={{ position: 'fixed', left: 0, top: 60, bottom: 60, width: '38%', cursor: 'pointer', zIndex: 1 }} />
              <div className="gp-lb-tap" onClick={e => { e.stopPropagation(); lightboxNext() }} style={{ position: 'fixed', right: 0, top: 60, bottom: 60, width: '38%', cursor: 'pointer', zIndex: 1 }} />
            </>
          )}
        </div>
      )}
    </>
  )
}

function MembersSection({ members, roomMap, acMain, onPhotoClick }: {
  members: Member[]
  roomMap: Record<string, Room>
  acMain: string
  onPhotoClick: (images: string[], index: number, roomName: string) => void
}) {
  const ac = { main: acMain }
  return (
    <div>
      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 20px', background: '#faf9f6', border: '1px dashed #ddd9d1', borderRadius: 14 }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>👀</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>No one yet — be the first!</div>
          <div style={{ fontSize: 12, color: '#9b9b9b' }}>Your name will show up here after you join.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              <div key={m.id} className="gp-member-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  {/* Large avatar */}
                  <div
                    className="gp-member-avatar"
                    style={{ background: pal.bg, color: pal.fg }}
                  >
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div className="gp-member-name">{m.first_name ?? 'Member'} {m.last_name ?? ''}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: m.has_prescreen ? '#10b981' : '#9b9b9b', background: m.has_prescreen ? 'rgba(16,185,129,0.09)' : '#f5f4f0', border: `1px solid ${m.has_prescreen ? 'rgba(16,185,129,0.22)' : '#ede9e0'}`, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {m.has_prescreen ? '✓ Screened' : 'New'}
                      </span>
                    </div>
                    {assignedRoom && (
                      <div style={{ fontSize: 12, color: ac.main, fontWeight: 600, marginTop: 3 }}>
                        🛏 {assignedRoom.name}{assignedRoom.price ? ` · $${assignedRoom.price}/mo` : ''}
                      </div>
                    )}
                  </div>
                </div>
                {m.about && (
                  <div className="gp-member-about">
                    {m.about}
                  </div>
                )}
                {tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {tags.map(t => (
                      <span key={t} className="gp-tag">{t}</span>
                    ))}
                  </div>
                )}
                {assignedRoom && roomPhotos.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                      {roomPhotos.map((url, pi) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={pi}
                          src={url}
                          alt={`${assignedRoom.name} photo ${pi + 1}`}
                          onClick={() => onPhotoClick(roomPhotos, pi, assignedRoom.name)}
                          style={{ height: 100, width: 'auto', minWidth: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid #ede9e0', flexShrink: 0, cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.03)'; (e.currentTarget as HTMLImageElement).style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLImageElement).style.transform = ''; (e.currentTarget as HTMLImageElement).style.boxShadow = '' }}
                        />
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: '#b0a898', marginTop: 4 }}>Tap a photo to view room</div>
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
