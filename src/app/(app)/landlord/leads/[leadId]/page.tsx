'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_ORDER: Lead['status'][] = ['new', 'contacted', 'engaged', 'qualified', 'tour_scheduled', 'closed']

const STATUS_META: Record<Lead['status'], { label: string; color: string; bg: string; border: string; desc: string; icon: string }> = {
  new:            { label: 'New',           color: '#3b82f6', bg: '#eff6ff',   border: '#bfdbfe', desc: 'Just submitted — needs outreach',          icon: '📩' },
  contacted:      { label: 'Contacted',     color: '#f97316', bg: '#fff7ed',   border: '#fed7aa', desc: 'You\'ve reached out, awaiting response',    icon: '📞' },
  engaged:        { label: 'Engaged',       color: '#d97706', bg: '#fffbeb',   border: '#fde68a', desc: 'In active conversation',                    icon: '💬' },
  qualified:      { label: 'Qualified',     color: '#10b981', bg: '#f0fdf4',   border: '#bbf7d0', desc: 'Pre-screen complete, strong candidate',      icon: '✅' },
  tour_scheduled: { label: 'Tour Scheduled',color: '#8b5cf6', bg: '#f5f3ff',   border: '#ddd6fe', desc: 'Tour booked — prepare the property',         icon: '📅' },
  closed:         { label: 'Closed',        color: '#6b7280', bg: '#f9fafb',   border: '#e5e7eb', desc: 'Lead closed out',                           icon: '🏁' },
}

type Prescreen = {
  id: string; lead_id: string; created_at: string
  is_student: boolean | null; university: string | null
  birthdate: string | null; gender: string | null
  move_in_date: string | null; group_size: number | null
  about: string | null; monthly_budget: number | null
  lease_length: string | null; lifestyle: string | null; notes: string | null
}

type EmailLog = {
  id: string; lead_id: string; type: string
  subject: string; recipient: string; sent_at: string; metadata: Record<string, unknown>
}

const EMAIL_TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  lead_welcome:                { label: 'Welcome email sent to lead',            icon: '👋', color: '#3b82f6' },
  prescreen_reminder:          { label: 'Pre-screen reminder sent to lead',      icon: '⏰', color: '#f97316' },
  lead_qualified_landlord:     { label: 'Pre-screen completion sent to you',     icon: '✅', color: '#10b981' },
  new_lead_landlord:           { label: 'New lead notification sent to you',     icon: '🔔', color: '#8b5cf6' },
  tour_invitation:             { label: 'Tour invitation sent to lead',           icon: '🎉', color: '#8C1D40' },
  tour_confirmation_tenant:    { label: 'Tour confirmation sent to lead',         icon: '📅', color: '#0ea5e9' },
  tour_confirmation_landlord:  { label: 'Tour confirmation sent to you',          icon: '📅', color: '#0ea5e9' },
  tour_reminder:               { label: 'Tour reminder sent to lead',             icon: '⏰', color: '#d97706' },
  tour_cancellation_tenant:    { label: 'Tour cancellation sent to lead',         icon: '✕', color: '#ef4444' },
  tour_cancellation_landlord:  { label: 'Tour cancellation sent to you',          icon: '✕', color: '#ef4444' },
  reservation_sent:            { label: 'Reservation offer sent to lead',         icon: '🔒', color: '#8C1D40' },
}

type TourRecord = {
  id: string
  lead_id: string
  property_slug: string
  scheduled_date: string
  time_slot: string
  custom_note: string | null
  booked_by: 'tenant' | 'landlord'
  status: 'confirmed' | 'cancelled' | 'completed'
  reminder_sent: boolean
  created_at: string
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getHeat(createdAt: string | null) {
  if (!createdAt) return { icon: '', label: '—', color: '#9b9b9b' }
  const h = (Date.now() - new Date(createdAt).getTime()) / 3600000
  if (h < 24)  return { icon: '🔥', label: 'Hot — < 24h',   color: '#ef4444' }
  if (h < 72)  return { icon: '🌡', label: 'Warm — < 3 days', color: '#f97316' }
  if (h < 168) return { icon: '·',  label: 'Cool — < 7 days', color: '#eab308' }
  return { icon: '·', label: 'Cold — 7+ days', color: '#9b9b9b' }
}

export default function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = use(params)
  const router = useRouter()

  const [lead, setLead] = useState<Lead | null>(null)
  const [prescreen, setPrescreen] = useState<Prescreen | null>(null)
  const [emails, setEmails] = useState<EmailLog[]>([])
  const [property, setProperty] = useState<{ name: string; address: string; heroImage: string; price: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [statusModal, setStatusModal] = useState(false)
  const [closedReason, setClosedReason] = useState<'leased' | 'lost' | null>(null)
  const [pendingStatus, setPendingStatus] = useState<Lead['status'] | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const [reminding, setReminding] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Tour state
  const [tourData, setTourData] = useState<TourRecord | null>(null)
  const [tourInviteSent, setTourInviteSent] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [tourLinkCopied, setTourLinkCopied] = useState(false)
  const [manualTourModal, setManualTourModal] = useState(false)
  const [manualTourForm, setManualTourForm] = useState({ date: '', time_slot: '10:00', custom_note: '' })
  const [manualTourSaving, setManualTourSaving] = useState(false)
  const [sendingTourReminder, setSendingTourReminder] = useState(false)
  const [cancelTourModal, setCancelTourModal] = useState(false)
  const [cancelForm, setCancelForm] = useState({ reason: '', notes: '' })
  const [cancelSaving, setCancelSaving] = useState(false)

  // Reservation state
  type RoomOption = { id: string; name: string; price: number }
  const [reserveModal, setReserveModal] = useState(false)
  const [reserveRooms, setReserveRooms] = useState<RoomOption[]>([])
  const [reserveForm, setReserveForm] = useState({
    room_id: '',         // '' = entire property
    discount_type: '' as '' | 'dollars' | 'percent',
    discount_amount: '',
    expires_mode: '24h' as '24h' | '48h' | '72h' | 'custom',
    custom_expires: '',
  })
  const [reserveSending, setReserveSending] = useState(false)
  const [reserveSent, setReserveSent] = useState(false)
  const [activeReservation, setActiveReservation] = useState<{ accept_token: string; expires_at?: string } | null>(null)
  const [reserveLinkCopied, setReserveLinkCopied] = useState(false)

  const [copied, setCopied] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', phone: '', move_in_date: '', property: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [properties, setProperties] = useState<{ slug: string; name: string }[]>([])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    const load = async () => {
      // Verify auth
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Fetch lead
      const { data: leadData, error } = await supabase.from('leads').select('*').eq('id', leadId).single()
      if (error || !leadData) { setNotFound(true); setLoading(false); return }
      const ld = leadData as Lead
      setLead(ld)
      setEditForm({
        first_name: ld.first_name || '',
        last_name: ld.last_name || '',
        email: ld.email || '',
        phone: ld.phone || '',
        move_in_date: ld.move_in_date || '',
        property: ld.property || '',
      })
      // Fetch landlord's properties for dropdown
      const { data: props } = await supabase.from('properties').select('slug, name').eq('owner_id', user.id)
      if (props) setProperties(props)

      // Fetch prescreen + email logs via activity route (uses service role)
      const activityRes = await fetch(`/api/leads/${leadId}/activity`)
      if (activityRes.ok) {
        const { prescreen: ps, emails: el } = await activityRes.json()
        setPrescreen(ps)
        setEmails(el || [])
      }

      // Fetch tour data
      const { data: tourRes } = await supabase
        .from('tours').select('*').eq('lead_id', leadId).eq('status', 'confirmed').maybeSingle()
      if (tourRes) setTourData(tourRes as TourRecord)
      if ((leadData as Lead & { tour_invite_sent_at?: string }).tour_invite_sent_at) setTourInviteSent(true)

      // Fetch property + rooms for reservation
      if (leadData.property) {
        const { data: prop } = await supabase
          .from('properties')
          .select('id, name, address, price, rental_mode, property_images(url, position), property_rooms(id, name, price, is_available, position)')
          .eq('slug', leadData.property)
          .single()
        if (prop) {
          const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
          setProperty({ name: prop.name, address: prop.address, price: prop.price, heroImage: imgs.sort((a, b) => a.position - b.position)[0]?.url || '' })
          if (prop.rental_mode === 'by_room' && prop.property_rooms?.length) {
            const rooms = (prop.property_rooms as { id: string; name: string; price: number; is_available: boolean; position: number }[])
              .filter(r => r.is_available)
              .sort((a, b) => a.position - b.position)
              .map(r => ({ id: r.id, name: r.name || `Room ${r.position + 1}`, price: r.price }))
            setReserveRooms(rooms)
          }
          // Check for existing pending reservation
          const { data: existingRes } = await supabase
            .from('lead_reservations')
            .select('accept_token, expires_at, status')
            .eq('lead_id', leadId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (existingRes) setActiveReservation({ accept_token: existingRes.accept_token, expires_at: existingRes.expires_at })
        }
      }

      setLoading(false)
    }
    load()
  }, [leadId, router])

  const handleStatusUpdate = async (status: Lead['status'], cr?: 'leased' | 'lost') => {
    if (!lead) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, closed_reason: cr }),
      })
      if (res.ok) {
        setLead(prev => prev ? { ...prev, status, closed_reason: cr || prev.closed_reason } : prev)
        setStatusModal(false)
        setPendingStatus(null)
        setClosedReason(null)
        showToast(`Status updated to ${STATUS_META[status].label}`)
      }
    } catch { showToast('Failed to update status', 'error') }
    setUpdatingStatus(false)
  }

  const handleEditSave = async () => {
    if (!lead) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (res.ok) {
        setLead(prev => prev ? { ...prev, ...editForm } : prev)
        // If property changed, refresh property details
        if (editForm.property !== lead.property) {
          const { data: prop } = await supabase.from('properties').select('name, address, price, property_images(url, position)').eq('slug', editForm.property).single()
          if (prop) {
            const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
            setProperty({ name: prop.name, address: prop.address, price: prop.price, heroImage: imgs.sort((a, b) => a.position - b.position)[0]?.url || '' })
          }
        }
        setEditModal(false)
        showToast('Lead updated')
      } else {
        showToast('Failed to save changes', 'error')
      }
    } catch { showToast('Failed to save changes', 'error') }
    setEditSaving(false)
  }

  const sendReminder = async () => {
    setReminding(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/send-reminder`, { method: 'POST' })
      if (res.ok) {
        showToast(`Reminder sent to ${lead?.first_name || lead?.email}`)
        // Refresh email logs
        const activityRes = await fetch(`/api/leads/${leadId}/activity`)
        if (activityRes.ok) { const { emails: el } = await activityRes.json(); setEmails(el || []) }
      } else {
        showToast('Failed to send reminder', 'error')
      }
    } catch { showToast('Failed to send reminder', 'error') }
    setReminding(false)
  }

  const handleInviteToTour = async () => {
    setInviting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/leads/${leadId}/invite-to-tour`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
      })
      const body = await res.json()
      if (res.ok) {
        setTourInviteSent(true)
        showToast('Tour invitation sent! 🎉')
      } else {
        showToast(body.error || 'Failed to send invitation', 'error')
      }
    } catch { showToast('Failed to send invitation', 'error') }
    setInviting(false)
  }

  const handleManualTourSave = async () => {
    if (!manualTourForm.date || !manualTourForm.time_slot) {
      showToast('Please select a date and time', 'error'); return
    }
    setManualTourSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/leads/${leadId}/manual-tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify(manualTourForm),
      })
      const body = await res.json()
      if (res.ok) {
        setTourData(body.tour as TourRecord)
        setLead(prev => prev ? { ...prev, status: 'tour_scheduled' } : prev)
        setManualTourModal(false)
        showToast(`Tour booked for ${body.readableDate}`)
        // Refresh emails
        const activityRes = await fetch(`/api/leads/${leadId}/activity`)
        if (activityRes.ok) { const { emails: el } = await activityRes.json(); setEmails(el || []) }
      } else {
        showToast(body.error || 'Failed to book tour', 'error')
      }
    } catch { showToast('Failed to book tour', 'error') }
    setManualTourSaving(false)
  }

  const handleSendTourReminder = async () => {
    if (!tourData) return
    setSendingTourReminder(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/tours/${tourData.id}/reminder`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
      })
      if (res.ok) {
        setTourData(prev => prev ? { ...prev, reminder_sent: true } : prev)
        showToast('Tour reminder sent!')
        const activityRes = await fetch(`/api/leads/${leadId}/activity`)
        if (activityRes.ok) { const { emails: el } = await activityRes.json(); setEmails(el || []) }
      } else {
        const body = await res.json()
        showToast(body.error || 'Failed to send reminder', 'error')
      }
    } catch { showToast('Failed to send reminder', 'error') }
    setSendingTourReminder(false)
  }

  const handleCancelTour = async () => {
    if (!tourData || !cancelForm.reason) return
    setCancelSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/tours/${tourData.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ reason: cancelForm.reason, notes: cancelForm.notes || undefined }),
      })
      const body = await res.json()
      if (res.ok) {
        setTourData(null)
        setLead(prev => prev ? { ...prev, status: body.revertStatus } : prev)
        setCancelTourModal(false)
        setCancelForm({ reason: '', notes: '' })
        showToast('Tour cancelled — confirmation emails sent')
        const activityRes = await fetch(`/api/leads/${leadId}/activity`)
        if (activityRes.ok) { const { emails: el } = await activityRes.json(); setEmails(el || []) }
      } else {
        showToast(body.error || 'Failed to cancel tour', 'error')
      }
    } catch { showToast('Failed to cancel tour', 'error') }
    setCancelSaving(false)
  }

  const handleSendReservation = async () => {
    setReserveSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()

      // Calculate expires_at
      let expiresAt: Date
      if (reserveForm.expires_mode === 'custom' && reserveForm.custom_expires) {
        expiresAt = new Date(reserveForm.custom_expires)
      } else {
        const hours = reserveForm.expires_mode === '24h' ? 24 : reserveForm.expires_mode === '48h' ? 48 : 72
        expiresAt = new Date(Date.now() + hours * 3600 * 1000)
      }

      const payload: Record<string, unknown> = {
        room_id: reserveForm.room_id || null,
        expires_at: expiresAt.toISOString(),
      }
      if (reserveForm.discount_type && reserveForm.discount_amount) {
        payload.discount_type = reserveForm.discount_type
        payload.discount_amount = parseInt(reserveForm.discount_amount, 10)
      }

      const res = await fetch(`/api/leads/${leadId}/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (res.ok) {
        setActiveReservation({ accept_token: body.accept_token, expires_at: expiresAt.toISOString() })
        setReserveSent(true)
        setReserveModal(false)
        showToast('Reservation email sent! 🔒')
        // Refresh emails
        const activityRes = await fetch(`/api/leads/${leadId}/activity`)
        if (activityRes.ok) { const { emails: el } = await activityRes.json(); setEmails(el || []) }
      } else {
        showToast(body.error || 'Failed to send reservation', 'error')
      }
    } catch { showToast('Failed to send reservation', 'error') }
    setReserveSending(false)
  }

  // 30-min time slots from 7am–9pm for manual booking
  const MANUAL_TIME_SLOTS: string[] = []
  for (let h = 7; h < 21; h++) {
    MANUAL_TIME_SLOTS.push(`${String(h).padStart(2,'0')}:00`)
    MANUAL_TIME_SLOTS.push(`${String(h).padStart(2,'0')}:30`)
  }
  function fmtTime(slot: string): string {
    const [h, m] = slot.split(':').map(Number)
    const s = h >= 12 ? 'pm' : 'am'
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h
    return `${hr}:${String(m).padStart(2,'0')} ${s}`
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap'); @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {[1,2,3].map(i => <div key={i} style={{ height: '80px', borderRadius: '10px', marginBottom: '12px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />)}
      </div>
    )
  }

  if (notFound || !lead) {
    return (
      <div style={{ padding: '60px 32px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>Lead not found</div>
        <button onClick={() => router.push('/landlord/leads')} style={{ color: '#8C1D40', background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>← Back to Leads</button>
      </div>
    )
  }

  const heat = getHeat(lead.created_at)
  const meta = STATUS_META[lead.status]
  const hasPrescreen = !!prescreen
  const needsRemind = ['new', 'contacted', 'engaged'].includes(lead.status)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ld-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        /* Top bar */
        .ld-topbar { background: #fff; border-bottom: 1px solid #e8e5de; padding: 14px 28px; display: flex; align-items: center; gap: 16px; justify-content: space-between; flex-wrap: wrap; }
        .ld-back { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #9b9b9b; text-decoration: none; transition: color 0.15s; cursor: pointer; background: none; border: none; font-family: 'DM Sans', sans-serif; }
        .ld-back:hover { color: #1a1a1a; }
        .ld-topbar-actions { display: flex; align-items: center; gap: 8px; }

        /* Hero */
        .ld-hero { background: #1a1a1a; padding: 24px 28px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .ld-avatar-lg { width: 56px; height: 56px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 2px solid rgba(255,198,39,0.3); }
        .ld-lead-name { font-size: 22px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
        .ld-lead-sub { font-size: 13px; color: #9b9b9b; margin-top: 3px; }
        .ld-status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; border: 1px solid; }

        /* Content grid */
        .ld-grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; padding: 20px 28px; align-items: start; }

        /* Cards */
        .ld-card { background: #fff; border-radius: 14px; border: 1px solid #e8e5de; overflow: hidden; margin-bottom: 16px; }
        .ld-card-header { padding: 14px 20px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }
        .ld-card-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.8px; }
        .ld-card-body { padding: 18px 20px; }

        /* Info rows */
        .info-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #f5f4f0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-size: 12px; color: #9b9b9b; flex-shrink: 0; width: 110px; }
        .info-value { font-size: 13px; color: #1a1a1a; font-weight: 500; text-align: right; flex: 1; }

        /* Pre-screen highlight */
        .ps-about { background: #fdf2f5; border-left: 3px solid #8C1D40; border-radius: 0 8px 8px 0; padding: 12px 16px; margin-bottom: 12px; font-size: 14px; color: #3a3a3a; line-height: 1.65; font-style: italic; }
        .ps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .ps-item { background: #faf9f6; border-radius: 8px; padding: 10px 12px; border: 1px solid #f0ede6; }
        .ps-item-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .ps-item-value { font-size: 13px; color: #1a1a1a; font-weight: 500; }

        /* Email log */
        .email-entry { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f0ede6; }
        .email-entry:last-child { border-bottom: none; }
        .email-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
        .email-type { font-size: 12px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
        .email-meta { font-size: 11px; color: #9b9b9b; }

        /* Status modal */
        .status-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(3px); }
        .status-modal { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 480px; box-shadow: 0 24px 80px rgba(0,0,0,0.25); }
        .status-card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 2px solid #e8e5de; border-radius: 10px; cursor: pointer; transition: all 0.15s; margin-bottom: 8px; }
        .status-card:hover { border-color: #8C1D40; background: #fdf2f5; }
        .status-card.selected { border-color: #8C1D40; background: #fdf2f5; }
        .status-card.current { border-color: currentColor; cursor: default; opacity: 0.6; }

        /* Edit sheet */
        .edit-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 600; display: flex; align-items: flex-end; justify-content: center; backdrop-filter: blur(4px); }
        @media (min-width: 600px) { .edit-overlay { align-items: center; } }
        .edit-sheet { background: #fff; width: 100%; max-width: 520px; border-radius: 20px 20px 0 0; padding: 0 0 env(safe-area-inset-bottom); animation: sheetUp 0.28s cubic-bezier(0.32,0.72,0,1); max-height: 92vh; overflow-y: auto; }
        @media (min-width: 600px) { .edit-sheet { border-radius: 20px; max-height: 88vh; } }
        @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .edit-sheet-handle { width: 36px; height: 4px; background: #e0ddd7; border-radius: 2px; margin: 10px auto 0; }
        @media (min-width: 600px) { .edit-sheet-handle { display: none; } }
        .edit-sheet-header { padding: 20px 24px 0; display: flex; align-items: center; justify-content: space-between; }
        .edit-sheet-title { font-size: 18px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.3px; }
        .edit-sheet-body { padding: 20px 24px; }
        .edit-field { margin-bottom: 16px; }
        .edit-field-label { display: block; font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .edit-input { width: 100%; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 11px 14px; font-size: 15px; color: #1a1a1a; font-family: 'DM Sans', sans-serif; background: #faf9f6; outline: none; transition: border-color 0.15s, background 0.15s; }
        .edit-input:focus { border-color: #8C1D40; background: #fff; }
        .edit-input::placeholder { color: #b0a898; }
        .edit-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .edit-sheet-footer { padding: 4px 24px 24px; display: flex; gap: 10px; }

        /* Buttons */
        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-gold { background: #FFC627; color: #1a1a1a; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-gold:hover { opacity: 0.9; }
        .btn-ghost { background: transparent; color: #3a3a3a; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #1a1a1a; }

        /* Toast */
        .ld-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        /* Reservation */
        .reserve-mode-opt { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1.5px solid #e8e5de; border-radius: 10px; cursor: pointer; transition: all 0.15s; background: #fff; width: 100%; font-family: 'DM Sans', sans-serif; text-align: left; }
        .reserve-mode-opt.selected { border-color: #8C1D40; background: #fdf2f5; }
        .reserve-mode-opt:hover:not(.selected) { border-color: #ccc; }
        .reserve-discount-toggle { display: flex; gap: 8px; }
        .reserve-discount-opt { flex: 1; padding: 9px; border: 1.5px solid #e8e5de; border-radius: 8px; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #3a3a3a; transition: all 0.15s; }
        .reserve-discount-opt.selected { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }

        @media (max-width: 860px) {
          .ld-grid { grid-template-columns: 1fr; }
          .ld-hero { padding: 20px 16px; }
          .ld-topbar { padding: 12px 16px; }
        }
      `}</style>

      <div className="ld-page">

        {/* Toast */}
        {toast && (
          <div className="ld-toast" style={{ background: toast.type === 'success' ? '#1a1a1a' : '#8C1D40', color: '#fff' }}>
            {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
          </div>
        )}

        {/* Top bar */}
        <div className="ld-topbar">
          <button className="ld-back" onClick={() => router.push('/landlord/leads')}>
            ← Back to Leads
          </button>
          <div className="ld-topbar-actions">
            {needsRemind && (
              <button className="btn-primary" disabled={reminding} onClick={sendReminder}>
                {reminding ? '…' : '📧 Send Pre-screen Reminder'}
              </button>
            )}
            <button className="btn-gold" onClick={() => setStatusModal(true)}>
              Change Status
            </button>
          </div>
        </div>

        {/* Hero */}
        <div className="ld-hero">
          {property?.heroImage && (
            <div style={{ width: '56px', height: '56px', borderRadius: '10px', overflow: 'hidden', flexShrink: 0 }}>
              <img src={property.heroImage} alt={property.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <div className="ld-avatar-lg">
            {((lead.first_name?.[0] || '') + (lead.last_name?.[0] || '')).toUpperCase() || '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div className="ld-lead-name">
                {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
              </div>
              <span className="ld-status-badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                {meta.icon} {meta.label}
                {lead.status === 'closed' && lead.closed_reason && ` · ${lead.closed_reason}`}
              </span>
              {heat.icon && <span title={heat.label} style={{ fontSize: '16px' }}>{heat.icon}</span>}
            </div>
            <div className="ld-lead-sub">
              {lead.email}{lead.phone ? ` · ${lead.phone}` : ''} · Submitted {lead.created_at ? timeAgo(lead.created_at) : '—'}
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            {property && (
              <>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{property.name}</div>
                <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>📍 {property.address}</div>
                <div style={{ fontSize: '13px', color: '#FFC627', fontWeight: 600, marginTop: '4px' }}>${property.price?.toLocaleString()}/mo</div>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="ld-grid">

          {/* LEFT COLUMN */}
          <div>

            {/* Lead info */}
            <div className="ld-card">
              <div className="ld-card-header">
                <span className="ld-card-title">Lead Information</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <a href={`mailto:${lead.email}`} style={{ fontSize: '12px', color: '#8C1D40', textDecoration: 'none', fontWeight: 500 }}>✉ Email →</a>
                  <button
                    onClick={() => setEditModal(true)}
                    style={{ background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#8C1D40'; (e.currentTarget as HTMLButtonElement).style.color = '#8C1D40' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e8e5de'; (e.currentTarget as HTMLButtonElement).style.color = '#3a3a3a' }}
                  >
                    ✎ Edit
                  </button>
                </div>
              </div>
              <div className="ld-card-body">
                <div className="info-row"><span className="info-label">Full Name</span><span className="info-value">{lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}</span></div>
                <div className="info-row"><span className="info-label">Email</span><span className="info-value"><a href={`mailto:${lead.email}`} style={{ color: '#8C1D40', textDecoration: 'none' }}>{lead.email}</a></span></div>
                <div className="info-row"><span className="info-label">Phone</span><span className="info-value">{lead.phone || '—'}</span></div>
                <div className="info-row"><span className="info-label">Property</span><span className="info-value">{property?.name || lead.property || '—'}</span></div>
                <div className="info-row"><span className="info-label">Move-in</span><span className="info-value">{lead.move_in_date ? new Date(lead.move_in_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</span></div>
                <div className="info-row"><span className="info-label">Submitted</span><span className="info-value">{lead.created_at ? new Date(lead.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span></div>
                <div className="info-row"><span className="info-label">Lead Age</span><span className="info-value" style={{ color: heat.color, fontWeight: 600 }}>{heat.icon} {heat.label}</span></div>
              </div>
            </div>

            {/* Pre-screen */}
            <div className="ld-card">
              <div className="ld-card-header">
                <span className="ld-card-title">Pre-Screen Application</span>
                {hasPrescreen
                  ? <span style={{ fontSize: '11px', fontWeight: 600, color: '#10b981', background: 'rgba(16,185,129,0.08)', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(16,185,129,0.2)' }}>✓ Complete</span>
                  : <span style={{ fontSize: '11px', fontWeight: 600, color: '#f97316', background: 'rgba(249,115,22,0.08)', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(249,115,22,0.2)' }}>Not submitted</span>
                }
              </div>
              <div className="ld-card-body">
                {!hasPrescreen ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>📋</div>
                    <div style={{ fontSize: '14px', color: '#6b6b6b', marginBottom: '14px', lineHeight: 1.5 }}>
                      This lead hasn&apos;t completed their pre-screen yet.
                    </div>
                    {needsRemind && (
                      <button className="btn-primary" disabled={reminding} onClick={sendReminder}>
                        {reminding ? 'Sending…' : '📧 Send Reminder'}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {prescreen.about && (
                      <div className="ps-about">"{prescreen.about}"</div>
                    )}
                    <div className="ps-grid">
                      {prescreen.is_student !== null && (
                        <div className="ps-item">
                          <div className="ps-item-label">Student</div>
                          <div className="ps-item-value">{prescreen.is_student ? `Yes — ${prescreen.university || 'Unknown uni'}` : 'No'}</div>
                        </div>
                      )}
                      {prescreen.gender && (
                        <div className="ps-item">
                          <div className="ps-item-label">Gender</div>
                          <div className="ps-item-value">{prescreen.gender}</div>
                        </div>
                      )}
                      {prescreen.birthdate && (
                        <div className="ps-item">
                          <div className="ps-item-label">Date of Birth</div>
                          <div className="ps-item-value">{new Date(prescreen.birthdate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                      )}
                      {prescreen.move_in_date && (
                        <div className="ps-item">
                          <div className="ps-item-label">Move-in</div>
                          <div className="ps-item-value">{prescreen.move_in_date}</div>
                        </div>
                      )}
                      {prescreen.group_size !== null && (
                        <div className="ps-item">
                          <div className="ps-item-label">Group</div>
                          <div className="ps-item-value">{prescreen.group_size === 1 ? 'Solo' : `${prescreen.group_size} people`}</div>
                        </div>
                      )}
                      {prescreen.monthly_budget && (
                        <div className="ps-item">
                          <div className="ps-item-label">Budget</div>
                          <div className="ps-item-value" style={{ color: '#8C1D40', fontWeight: 700 }}>${prescreen.monthly_budget.toLocaleString()}/mo</div>
                        </div>
                      )}
                      {prescreen.lease_length && (
                        <div className="ps-item">
                          <div className="ps-item-label">Lease</div>
                          <div className="ps-item-value">{prescreen.lease_length}</div>
                        </div>
                      )}
                      {prescreen.lifestyle && (
                        <div className="ps-item">
                          <div className="ps-item-label">Lifestyle</div>
                          <div className="ps-item-value">{prescreen.lifestyle}</div>
                        </div>
                      )}
                    </div>
                    {prescreen.notes && (
                      <div style={{ marginTop: '12px', background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#4a4a4a', lineHeight: 1.6 }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Additional Notes</div>
                        {prescreen.notes}
                      </div>
                    )}
                    {prescreen.created_at && (
                      <div style={{ marginTop: '10px', fontSize: '11px', color: '#b0a898', textAlign: 'right' }}>
                        Submitted {timeAgo(prescreen.created_at)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div>

            {/* ── TOUR SCHEDULING CARD ── */}
            <div className="ld-card">
              <div className="ld-card-header">
                <span className="ld-card-title">Tour Scheduling</span>
                {tourData && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#8b5cf6', background: 'rgba(139,92,246,0.08)', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(139,92,246,0.25)' }}>📅 Booked</span>
                )}
              </div>
              <div className="ld-card-body">
                {tourData ? (
                  /* Tour is booked */
                  <>
                    <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '10px', padding: '14px 16px', marginBottom: '14px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Confirmed Tour</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '3px' }}>
                        {new Date(tourData.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b6b6b' }}>
                        {fmtTime(tourData.time_slot)} · 30 min · {tourData.booked_by === 'tenant' ? 'Tenant chose this time' : 'You booked this'}
                      </div>
                      {tourData.custom_note && (
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#4a4a4a', fontStyle: 'italic', borderTop: '1px solid #ede9fe', paddingTop: '8px' }}>
                          Note: {tourData.custom_note}
                        </div>
                      )}
                    </div>
                    {/* Reminder */}
                    <button
                      onClick={handleSendTourReminder}
                      disabled={sendingTourReminder}
                      style={{
                        width: '100%', padding: '10px', marginBottom: '8px',
                        background: '#fff',
                        color: '#1a1a1a',
                        border: '1.5px solid #e8e5de',
                        borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {sendingTourReminder ? 'Sending…' : '⏰ Send Tour Reminder'}
                    </button>
                    {/* Reschedule / Cancel row */}
                    <div style={{ display: 'flex', gap: '7px' }}>
                      <button
                        onClick={() => setManualTourModal(true)}
                        style={{ flex: 1, padding: '8px', background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '8px', fontSize: '12px', fontWeight: 500, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        ↺ Reschedule
                      </button>
                      <button
                        onClick={() => { setCancelForm({ reason: '', notes: '' }); setCancelTourModal(true) }}
                        style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.05)', border: '1.5px solid rgba(239,68,68,0.25)', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: '#dc2626', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        ✕ Cancel Tour
                      </button>
                    </div>
                  </>
                ) : (
                  /* No tour yet */
                  <>
                    {/* Invite to Tour */}
                    <div style={{ marginBottom: '12px' }}>
                      <button
                        onClick={handleInviteToTour}
                        disabled={inviting}
                        style={{
                          width: '100%', padding: '13px', marginBottom: '8px',
                          background: '#1a1a1a', color: '#FFC627',
                          border: 'none', borderRadius: '10px',
                          fontSize: '14px', fontWeight: 700, cursor: inviting ? 'not-allowed' : 'pointer',
                          fontFamily: "'DM Sans', sans-serif", opacity: inviting ? 0.6 : 1,
                        }}
                      >
                        {inviting ? 'Sending…' : tourInviteSent ? '🔄 Resend Tour Invitation' : '🎉 Invite to Tour'}
                      </button>
                      {tourInviteSent && (
                        <div style={{ fontSize: '12px', color: '#10b981', textAlign: 'center', marginBottom: '8px' }}>
                          ✓ Invitation sent — tenant selects their time
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: '#9b9b9b', textAlign: 'center', lineHeight: 1.5 }}>
                        Requires availability set in{' '}
                        <a href={`/landlord/listings/${lead.property}/calendar`} style={{ color: '#8C1D40', textDecoration: 'none', fontWeight: 600 }}>
                          Calendar tab →
                        </a>
                      </div>
                    </div>

                    {/* Tour link copy */}
                    {tourInviteSent && (
                      <div style={{ background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: '10px', padding: '12px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Booking Link</div>
                        <div style={{ fontSize: '11px', color: '#4a4a4a', wordBreak: 'break-all', fontFamily: 'monospace', background: '#fff', border: '1px solid #e8e5de', borderRadius: '6px', padding: '7px 10px', marginBottom: '8px' }}>
                          {(process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')}/book-tour/{leadId}
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'}/book-tour/${leadId}`)
                            setTourLinkCopied(true)
                            setTimeout(() => setTourLinkCopied(false), 2000)
                          }}
                          style={{ width: '100%', padding: '7px', background: tourLinkCopied ? 'rgba(16,185,129,0.08)' : '#fff', border: `1.5px solid ${tourLinkCopied ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: tourLinkCopied ? '#10b981' : '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                        >
                          {tourLinkCopied ? '✓ Copied!' : '⎘ Copy Link'}
                        </button>
                      </div>
                    )}

                    {/* Divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0' }}>
                      <div style={{ flex: 1, height: '1px', background: '#f0ede6' }} />
                      <span style={{ fontSize: '11px', color: '#9b9b9b', fontWeight: 500 }}>or book manually</span>
                      <div style={{ flex: 1, height: '1px', background: '#f0ede6' }} />
                    </div>

                    {/* Manual booking */}
                    <button
                      onClick={() => setManualTourModal(true)}
                      style={{ width: '100%', padding: '10px', background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '9px', fontSize: '13px', fontWeight: 600, color: '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif' " }}
                    >
                      📋 Book Tour Manually
                    </button>
                    <div style={{ fontSize: '11px', color: '#9b9b9b', textAlign: 'center', marginTop: '6px' }}>
                      You pick the time — sends confirmation email
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── RESERVATION CARD ── */}
            <div className="ld-card">
              <div className="ld-card-header">
                <span className="ld-card-title">Send Reservation</span>
                {(activeReservation || reserveSent) && (
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#8C1D40', background: 'rgba(140,29,64,0.08)', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(140,29,64,0.25)' }}>🔒 Sent</span>
                )}
              </div>
              <div className="ld-card-body">
                {activeReservation ? (
                  <>
                    <div style={{ background: 'rgba(140,29,64,0.05)', border: '1.5px solid rgba(140,29,64,0.2)', borderRadius: '10px', padding: '14px 16px', marginBottom: '14px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#8C1D40', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Active Reservation</div>
                      <div style={{ fontSize: '13px', color: '#3a3a3a', marginBottom: '4px' }}>Reservation sent — waiting for lead to accept.</div>
                      {activeReservation.expires_at && (
                        <div style={{ fontSize: '12px', color: '#9b9b9b' }}>
                          Expires {new Date(activeReservation.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    {/* Copy accept link */}
                    <div style={{ background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: '10px', padding: '12px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Accept Link</div>
                      <div style={{ fontSize: '11px', color: '#4a4a4a', wordBreak: 'break-all', fontFamily: 'monospace', background: '#fff', border: '1px solid #e8e5de', borderRadius: '6px', padding: '7px 10px', marginBottom: '8px' }}>
                        {(process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')}/reserve/{activeReservation.accept_token}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'}/reserve/${activeReservation.accept_token}`)
                          setReserveLinkCopied(true)
                          setTimeout(() => setReserveLinkCopied(false), 2000)
                        }}
                        style={{ width: '100%', padding: '7px', background: reserveLinkCopied ? 'rgba(16,185,129,0.08)' : '#fff', border: `1.5px solid ${reserveLinkCopied ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: reserveLinkCopied ? '#10b981' : '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        {reserveLinkCopied ? '✓ Copied!' : '⎘ Copy Accept Link'}
                      </button>
                    </div>
                    <button
                      onClick={() => setReserveModal(true)}
                      style={{ width: '100%', padding: '9px', background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                    >
                      🔄 Send New Reservation
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: '14px', fontSize: '13px', color: '#6b6b6b', lineHeight: 1.6 }}>
                      Hold a spot for this lead with a time-limited reservation. Creates urgency and accelerates conversion.
                    </div>
                    <button
                      onClick={() => setReserveModal(true)}
                      style={{
                        width: '100%', padding: '13px',
                        background: 'linear-gradient(135deg, #8C1D40, #a02050)',
                        color: '#fff', border: 'none', borderRadius: '10px',
                        fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                        fontFamily: "'DM Sans', sans-serif",
                        boxShadow: '0 4px 18px rgba(140,29,64,0.3)',
                      }}
                    >
                      🔒 Reserve a Spot for This Lead
                    </button>
                    <div style={{ fontSize: '11px', color: '#9b9b9b', textAlign: 'center', marginTop: '7px', lineHeight: 1.5 }}>
                      Sends a personalized email with a 24-hour hold
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="ld-card">
              <div className="ld-card-header"><span className="ld-card-title">Quick Actions</span></div>
              <div className="ld-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  className="btn-gold"
                  style={{ width: '100%' }}
                  onClick={() => setStatusModal(true)}
                >
                  🔄 Change Status
                </button>
                {needsRemind && (
                  <button className="btn-primary" style={{ width: '100%' }} disabled={reminding} onClick={sendReminder}>
                    {reminding ? 'Sending…' : '📧 Send Pre-screen Reminder'}
                  </button>
                )}
                {/* Pre-screen link */}
                {(() => {
                  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
                  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`
                  return (
                    <div style={{ background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>
                        Pre-Screen Link
                      </div>
                      <div style={{ fontSize: '12px', color: '#4a4a4a', wordBreak: 'break-all', lineHeight: 1.5, marginBottom: '10px', fontFamily: 'monospace', background: '#fff', border: '1px solid #e8e5de', borderRadius: '7px', padding: '8px 10px' }}>
                        {prescreenUrl}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(prescreenUrl)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 2000)
                        }}
                        style={{ width: '100%', padding: '8px', background: copied ? 'rgba(16,185,129,0.08)' : '#fff', border: `1.5px solid ${copied ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '7px', fontSize: '13px', fontWeight: 600, color: copied ? '#10b981' : '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.2s' }}
                      >
                        {copied ? '✓ Copied!' : '⎘ Copy Link'}
                      </button>
                    </div>
                  )
                })()}

                <a
                  href={`mailto:${lead.email}?subject=Regarding your interest at ${property?.name || lead.property || 'our property'}`}
                  className="btn-ghost"
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none', color: '#3a3a3a', padding: '9px 14px', fontSize: '13px' }}
                >
                  ✉ Email Lead Directly
                </a>
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    className="btn-ghost"
                    style={{ display: 'block', textAlign: 'center', textDecoration: 'none', color: '#3a3a3a', padding: '9px 14px', fontSize: '13px' }}
                  >
                    📞 Call {lead.phone}
                  </a>
                )}
                {!['tour_scheduled', 'closed'].includes(lead.status) && (
                  <button
                    className="btn-ghost"
                    style={{ width: '100%' }}
                    onClick={() => handleStatusUpdate('tour_scheduled')}
                  >
                    📅 Mark Tour Scheduled
                  </button>
                )}
                {lead.status !== 'closed' && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    <button
                      style={{ flex: 1, padding: '8px', background: 'rgba(16,185,129,0.08)', color: '#10b981', border: '1.5px solid rgba(16,185,129,0.3)', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      onClick={() => handleStatusUpdate('closed', 'leased')}
                    >
                      ✓ Leased
                    </button>
                    <button
                      style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.06)', color: '#ef4444', border: '1.5px solid rgba(239,68,68,0.25)', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      onClick={() => handleStatusUpdate('closed', 'lost')}
                    >
                      ✕ Not a Fit
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Email Activity */}
            <div className="ld-card">
              <div className="ld-card-header">
                <span className="ld-card-title">Email Activity</span>
                <span style={{ fontSize: '12px', color: '#9b9b9b' }}>{emails.length} sent</span>
              </div>
              <div className="ld-card-body">
                {emails.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#9b9b9b', fontSize: '13px' }}>
                    No emails logged yet
                  </div>
                ) : (
                  emails.map(email => {
                    const typeMeta = EMAIL_TYPE_META[email.type] || { label: email.type, icon: '📧', color: '#6b7280' }
                    return (
                      <div key={email.id} className="email-entry">
                        <div className="email-dot" style={{ background: typeMeta.color }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="email-type">{typeMeta.icon} {typeMeta.label}</div>
                          <div className="email-meta" title={email.subject}>{email.subject?.length > 50 ? email.subject.slice(0, 50) + '…' : email.subject}</div>
                          <div className="email-meta" style={{ marginTop: '2px' }}>
                            To: {email.recipient} · {timeAgo(email.sent_at)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── MANUAL TOUR MODAL ── */}
      {manualTourModal && (
        <div className="edit-overlay" onClick={() => setManualTourModal(false)}>
          <div className="edit-sheet" onClick={e => e.stopPropagation()}>
            <div className="edit-sheet-handle" />
            <div className="edit-sheet-header">
              <div>
                <div className="edit-sheet-title">Book Tour Manually</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>
                  You pick the time — a calendar confirmation is sent automatically.
                </div>
              </div>
              <button onClick={() => setManualTourModal(false)} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div className="edit-sheet-body">
              <div className="edit-field">
                <label className="edit-field-label">Date</label>
                <input
                  className="edit-input"
                  type="date"
                  value={manualTourForm.date}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setManualTourForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="edit-field">
                <label className="edit-field-label">Time (MST)</label>
                <select
                  className="edit-input"
                  value={manualTourForm.time_slot}
                  onChange={e => setManualTourForm(f => ({ ...f, time_slot: e.target.value }))}
                >
                  {MANUAL_TIME_SLOTS.map(t => (
                    <option key={t} value={t}>{fmtTime(t)}</option>
                  ))}
                </select>
              </div>
              <div className="edit-field">
                <label className="edit-field-label">Custom Note (optional)</label>
                <textarea
                  className="edit-input"
                  rows={3}
                  placeholder="e.g. Meet at the front gate. Parking is in the lot behind the building."
                  value={manualTourForm.custom_note}
                  onChange={e => setManualTourForm(f => ({ ...f, custom_note: e.target.value }))}
                  style={{ resize: 'vertical', minHeight: '72px' }}
                />
                <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '4px' }}>
                  This note will appear in the tenant's confirmation email.
                </div>
              </div>
              <div style={{ background: '#fff8e6', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', color: '#4a3800', lineHeight: 1.5, marginBottom: '4px' }}>
                📧 Confirmation emails with .ics calendar files will be sent to <strong>{lead?.email}</strong> and you.
              </div>
            </div>
            <div className="edit-sheet-footer">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setManualTourModal(false)}>Cancel</button>
              <button
                className="btn-gold"
                style={{ flex: 2 }}
                disabled={manualTourSaving || !manualTourForm.date}
                onClick={handleManualTourSave}
              >
                {manualTourSaving ? 'Booking…' : '📅 Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CANCEL TOUR MODAL ── */}
      {cancelTourModal && (
        <div className="edit-overlay" onClick={() => setCancelTourModal(false)}>
          <div className="edit-sheet" onClick={e => e.stopPropagation()}>
            <div className="edit-sheet-handle" />
            <div className="edit-sheet-header">
              <div>
                <div className="edit-sheet-title">Cancel Tour</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>
                  Cancellation emails with calendar removal will be sent to both parties.
                </div>
              </div>
              <button onClick={() => setCancelTourModal(false)} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div className="edit-sheet-body">
              {/* Tour summary */}
              {tourData && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 14px', marginBottom: '18px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626', marginBottom: '4px' }}>
                    {new Date(tourData.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b6b6b' }}>
                    {fmtTime(tourData.time_slot)} · {property?.name || lead?.property}
                  </div>
                </div>
              )}
              {/* Reason */}
              <div className="edit-field">
                <label className="edit-field-label">Reason for cancellation <span style={{ color: '#dc2626' }}>*</span></label>
                <select
                  className="edit-input"
                  value={cancelForm.reason}
                  onChange={e => setCancelForm(f => ({ ...f, reason: e.target.value }))}
                >
                  <option value="">Select a reason…</option>
                  <option value="Scheduling conflict">Scheduling conflict</option>
                  <option value="Property no longer available">Property no longer available</option>
                  <option value="Tenant withdrew interest">Tenant withdrew interest</option>
                  <option value="Maintenance / property issue">Maintenance / property issue</option>
                  <option value="Already leased to someone else">Already leased to someone else</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {/* Notes */}
              <div className="edit-field">
                <label className="edit-field-label">Additional message to tenant (optional)</label>
                <textarea
                  className="edit-input"
                  rows={3}
                  placeholder="e.g. We hope to reschedule soon — we'll reach out once the property is ready again."
                  value={cancelForm.notes}
                  onChange={e => setCancelForm(f => ({ ...f, notes: e.target.value }))}
                  style={{ resize: 'vertical', minHeight: '72px' }}
                />
              </div>
              <div style={{ background: '#fff8e6', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 14px', fontSize: '12px', color: '#4a3800', lineHeight: 1.5 }}>
                📅 A calendar cancellation (.ics) will be attached to both emails so the event is automatically removed from their calendar.
              </div>
            </div>
            <div className="edit-sheet-footer">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setCancelTourModal(false)}>Back</button>
              <button
                disabled={cancelSaving || !cancelForm.reason}
                onClick={handleCancelTour}
                style={{ flex: 2, background: cancelSaving || !cancelForm.reason ? '#9b9b9b' : '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', fontWeight: 700, cursor: cancelSaving || !cancelForm.reason ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                {cancelSaving ? 'Cancelling…' : '✕ Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT LEAD MODAL ── */}
      {editModal && (
        <div className="edit-overlay" onClick={() => setEditModal(false)}>
          <div className="edit-sheet" onClick={e => e.stopPropagation()}>
            <div className="edit-sheet-handle" />
            <div className="edit-sheet-header">
              <div>
                <div className="edit-sheet-title">Edit Lead</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>Only filled fields will be updated.</div>
              </div>
              <button onClick={() => setEditModal(false)} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            <div className="edit-sheet-body">
              <div className="edit-field-row">
                <div className="edit-field">
                  <label className="edit-field-label">First Name</label>
                  <input className="edit-input" value={editForm.first_name} onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" />
                </div>
                <div className="edit-field">
                  <label className="edit-field-label">Last Name</label>
                  <input className="edit-input" value={editForm.last_name} onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
                </div>
              </div>

              <div className="edit-field">
                <label className="edit-field-label">Email</label>
                <input className="edit-input" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
              </div>

              <div className="edit-field">
                <label className="edit-field-label">Phone</label>
                <input className="edit-input" type="tel" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 (555) 000-0000" />
              </div>

              <div className="edit-field">
                <label className="edit-field-label">Move-in Date</label>
                <input className="edit-input" type="date" value={editForm.move_in_date ?? ''} onChange={e => setEditForm(f => ({ ...f, move_in_date: e.target.value }))} />
              </div>

              <div className="edit-field">
                <label className="edit-field-label">Property</label>
                {properties.length > 0 ? (
                  <select className="edit-input" value={editForm.property} onChange={e => setEditForm(f => ({ ...f, property: e.target.value }))}>
                    <option value="">— No property —</option>
                    {properties.map(p => (
                      <option key={p.slug} value={p.slug}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <input className="edit-input" value={editForm.property} onChange={e => setEditForm(f => ({ ...f, property: e.target.value }))} placeholder="property-slug" />
                )}
              </div>
            </div>

            <div className="edit-sheet-footer">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setEditModal(false)}>Cancel</button>
              <button className="btn-gold" style={{ flex: 2 }} disabled={editSaving} onClick={handleEditSave}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RESERVATION MODAL ── */}
      {reserveModal && (
        <div className="edit-overlay" onClick={() => setReserveModal(false)}>
          <div className="edit-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="edit-sheet-handle" />
            <div className="edit-sheet-header">
              <div>
                <div className="edit-sheet-title">🔒 Send Reservation</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>
                  Hold a spot for {lead?.first_name || 'this lead'} — creates urgency, accelerates close.
                </div>
              </div>
              <button onClick={() => setReserveModal(false)} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            <div className="edit-sheet-body">

              {/* Room selector (only if by_room) */}
              {reserveRooms.length > 0 && (
                <div className="edit-field">
                  <label className="edit-field-label">Reserve Which Spot?</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      className={`reserve-mode-opt${reserveForm.room_id === '' ? ' selected' : ''}`}
                      onClick={() => setReserveForm(f => ({ ...f, room_id: '' }))}
                    >
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: reserveForm.room_id === '' ? 'rgba(140,29,64,0.1)' : '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>🏠</div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Entire Property</div>
                        <div style={{ fontSize: '12px', color: '#9b9b9b' }}>${property?.price?.toLocaleString()}/mo</div>
                      </div>
                    </button>
                    {reserveRooms.map(room => (
                      <button
                        key={room.id}
                        className={`reserve-mode-opt${reserveForm.room_id === room.id ? ' selected' : ''}`}
                        onClick={() => setReserveForm(f => ({ ...f, room_id: room.id }))}
                      >
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: reserveForm.room_id === room.id ? 'rgba(140,29,64,0.1)' : '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>🛏</div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{room.name}</div>
                          <div style={{ fontSize: '12px', color: '#9b9b9b' }}>${room.price.toLocaleString()}/mo</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Discount */}
              <div className="edit-field">
                <label className="edit-field-label">Offer a Discount? (optional)</label>
                <div className="reserve-discount-toggle" style={{ marginBottom: '8px' }}>
                  <button
                    className={`reserve-discount-opt${reserveForm.discount_type === '' ? ' selected' : ''}`}
                    onClick={() => setReserveForm(f => ({ ...f, discount_type: '', discount_amount: '' }))}
                  >
                    No discount
                  </button>
                  <button
                    className={`reserve-discount-opt${reserveForm.discount_type === 'dollars' ? ' selected' : ''}`}
                    onClick={() => setReserveForm(f => ({ ...f, discount_type: 'dollars' }))}
                  >
                    $ Off
                  </button>
                  <button
                    className={`reserve-discount-opt${reserveForm.discount_type === 'percent' ? ' selected' : ''}`}
                    onClick={() => setReserveForm(f => ({ ...f, discount_type: 'percent' }))}
                  >
                    % Off
                  </button>
                </div>
                {reserveForm.discount_type && (
                  <input
                    className="edit-input"
                    type="number"
                    min="1"
                    max={reserveForm.discount_type === 'percent' ? '100' : undefined}
                    placeholder={reserveForm.discount_type === 'dollars' ? 'e.g. 100' : 'e.g. 10'}
                    value={reserveForm.discount_amount}
                    onChange={e => setReserveForm(f => ({ ...f, discount_amount: e.target.value }))}
                  />
                )}
                {reserveForm.discount_type && reserveForm.discount_amount && (() => {
                  const basePrice = reserveRooms.find(r => r.id === reserveForm.room_id)?.price ?? property?.price ?? 0
                  const disc = parseInt(reserveForm.discount_amount, 10)
                  const final = reserveForm.discount_type === 'dollars'
                    ? Math.max(0, basePrice - disc)
                    : Math.round(basePrice * (1 - disc / 100))
                  return (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#8C1D40', fontWeight: 600 }}>
                      Offer: ${basePrice.toLocaleString()} → <strong>${final.toLocaleString()}/mo</strong>
                    </div>
                  )
                })()}
              </div>

              {/* Expiration */}
              <div className="edit-field">
                <label className="edit-field-label">Reservation Window</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  {(['24h', '48h', '72h', 'custom'] as const).map(opt => (
                    <button
                      key={opt}
                      className={`reserve-discount-opt${reserveForm.expires_mode === opt ? ' selected' : ''}`}
                      onClick={() => setReserveForm(f => ({ ...f, expires_mode: opt }))}
                    >
                      {opt === '24h' ? '24 hours' : opt === '48h' ? '48 hours' : opt === '72h' ? '72 hours' : '📅 Custom'}
                    </button>
                  ))}
                </div>
                {reserveForm.expires_mode === 'custom' && (
                  <input
                    className="edit-input"
                    type="datetime-local"
                    value={reserveForm.custom_expires}
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={e => setReserveForm(f => ({ ...f, custom_expires: e.target.value }))}
                  />
                )}
              </div>

              {/* Preview */}
              <div style={{ background: 'rgba(140,29,64,0.04)', border: '1.5px solid rgba(140,29,64,0.15)', borderRadius: '10px', padding: '14px 16px', fontSize: '12px', color: '#4a4a4a', lineHeight: 1.65 }}>
                📧 A personalized reservation email will be sent to <strong>{lead?.email}</strong> with an exclusive accept link. No changes are made to the listing.
              </div>
            </div>

            <div className="edit-sheet-footer">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setReserveModal(false)}>Cancel</button>
              <button
                disabled={reserveSending || (reserveForm.expires_mode === 'custom' && !reserveForm.custom_expires)}
                onClick={handleSendReservation}
                style={{
                  flex: 2, background: reserveSending ? '#9b9b9b' : 'linear-gradient(135deg, #8C1D40, #a02050)',
                  color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px',
                  fontSize: '14px', fontWeight: 700, cursor: reserveSending ? 'not-allowed' : 'pointer',
                  fontFamily: "'DM Sans', sans-serif",
                  boxShadow: reserveSending ? 'none' : '0 4px 16px rgba(140,29,64,0.3)',
                }}
              >
                {reserveSending ? 'Sending…' : '🔒 Send Reservation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STATUS CHANGE MODAL ── */}
      {statusModal && (
        <div className="status-modal-overlay" onClick={() => { setStatusModal(false); setPendingStatus(null); setClosedReason(null) }}>
          <div className="status-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>Change Status</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>Current: {meta.label}</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9b9b9b' }} onClick={() => { setStatusModal(false); setPendingStatus(null); setClosedReason(null) }}>✕</button>
            </div>

            {STATUS_ORDER.filter(s => s !== 'closed').map(s => {
              const sm = STATUS_META[s]
              const isCurrent = lead.status === s
              const isSelected = pendingStatus === s
              return (
                <div
                  key={s}
                  className={`status-card${isSelected ? ' selected' : ''}${isCurrent ? ' current' : ''}`}
                  style={{ borderColor: isSelected ? '#8C1D40' : isCurrent ? sm.color : '#e8e5de', background: isSelected ? '#fdf2f5' : isCurrent ? sm.bg : '#fff', opacity: isCurrent ? 0.6 : 1 }}
                  onClick={() => !isCurrent && setPendingStatus(s)}
                >
                  <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: sm.bg, border: `1px solid ${sm.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{sm.icon}</div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{sm.label}</div>
                    <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>{sm.desc}</div>
                  </div>
                  {(isSelected || isCurrent) && (
                    <div style={{ marginLeft: 'auto', width: '20px', height: '20px', borderRadius: '50%', background: isCurrent ? sm.color : '#8C1D40', color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</div>
                  )}
                </div>
              )
            })}

            {/* Closed option */}
            <div
              className={`status-card${pendingStatus === 'closed' ? ' selected' : ''}${lead.status === 'closed' ? ' current' : ''}`}
              style={{ borderColor: pendingStatus === 'closed' ? '#8C1D40' : lead.status === 'closed' ? '#6b7280' : '#e8e5de', background: pendingStatus === 'closed' ? '#fdf2f5' : lead.status === 'closed' ? '#f9fafb' : '#fff', opacity: lead.status === 'closed' ? 0.6 : 1 }}
              onClick={() => lead.status !== 'closed' && setPendingStatus('closed')}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: '#f9fafb', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🏁</div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>Closed</div>
                <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>Leased or not a fit</div>
              </div>
            </div>

            {/* Closed reason picker */}
            {pendingStatus === 'closed' && (
              <div style={{ marginTop: '12px', padding: '14px', background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Reason for closing</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setClosedReason('leased')}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `2px solid ${closedReason === 'leased' ? '#10b981' : '#e8e5de'}`, background: closedReason === 'leased' ? 'rgba(16,185,129,0.08)' : '#fff', color: closedReason === 'leased' ? '#10b981' : '#3a3a3a', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s' }}
                  >
                    ✓ Leased
                  </button>
                  <button
                    onClick={() => setClosedReason('lost')}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `2px solid ${closedReason === 'lost' ? '#ef4444' : '#e8e5de'}`, background: closedReason === 'lost' ? 'rgba(239,68,68,0.06)' : '#fff', color: closedReason === 'lost' ? '#ef4444' : '#3a3a3a', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s' }}
                  >
                    ✕ Not a Fit
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => { setStatusModal(false); setPendingStatus(null); setClosedReason(null) }}>Cancel</button>
              <button
                className="btn-gold"
                style={{ flex: 2 }}
                disabled={!pendingStatus || (pendingStatus === 'closed' && !closedReason) || updatingStatus}
                onClick={() => pendingStatus && handleStatusUpdate(pendingStatus, closedReason || undefined)}
              >
                {updatingStatus ? 'Saving…' : `Update to ${pendingStatus ? STATUS_META[pendingStatus].label : '…'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
