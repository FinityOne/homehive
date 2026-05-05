'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'
import PhoneInput, { formatPhoneDisplay } from '@/components/ui/PhoneInput'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_ORDER: Lead['status'][] = ['new', 'contacted', 'follow_up', 'engaged', 'cold', 'qualified', 'tour_scheduled', 'closed']

const STATUS_META: Record<Lead['status'], { label: string; color: string; bg: string; border: string; desc: string; icon: string }> = {
  new:            { label: 'New',           color: '#3b82f6', bg: '#eff6ff',   border: '#bfdbfe', desc: 'Just submitted — needs outreach',          icon: '📩' },
  contacted:      { label: 'Contacted',     color: '#f97316', bg: '#fff7ed',   border: '#fed7aa', desc: 'You\'ve reached out, awaiting response',    icon: '📞' },
  follow_up:      { label: 'Follow Up',     color: '#c2410c', bg: '#fff7ed',   border: '#fed7aa', desc: 'Needs a follow-up touch',                  icon: '🔄' },
  engaged:        { label: 'Engaged',       color: '#d97706', bg: '#fffbeb',   border: '#fde68a', desc: 'In active conversation',                    icon: '💬' },
  cold:           { label: 'Cold',          color: '#64748b', bg: '#f8fafc',   border: '#e2e8f0', desc: 'No response — may need reactivation',       icon: '❄️' },
  qualified:      { label: 'Qualified',     color: '#10b981', bg: '#f0fdf4',   border: '#bbf7d0', desc: 'Pre-screen complete, strong candidate',      icon: '✅' },
  tour_scheduled: { label: 'Tour Scheduled',color: '#8b5cf6', bg: '#f5f3ff',   border: '#ddd6fe', desc: 'Tour booked — prepare the property',         icon: '📅' },
  closed:         { label: 'Closed',        color: '#6b7280', bg: '#f9fafb',   border: '#e5e7eb', desc: 'Lead closed out',                           icon: '🏁' },
}

type Prescreen = {
  id: string; lead_id: string; created_at: string
  occupation: string | null; is_student: boolean | null; university: string | null
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
  const [groupedInquiries, setGroupedInquiries] = useState<{ id: string; created_at: string | null; first_name: string | null }[]>([])

  const [statusModal, setStatusModal] = useState(false)
  const [closedReason, setClosedReason] = useState<'leased' | 'lost' | null>(null)
  const [pendingStatus, setPendingStatus] = useState<Lead['status'] | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const [reminding, setReminding] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

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

  type RoomOption = { id: string; name: string; price: number }
  const [reserveModal, setReserveModal] = useState(false)
  const [reserveRooms, setReserveRooms] = useState<RoomOption[]>([])
  const [reserveForm, setReserveForm] = useState({
    room_id: '',
    discount_type: '' as '' | 'dollars' | 'percent',
    discount_amount: '',
    expires_mode: '24h' as '24h' | '48h' | '72h' | 'custom',
    custom_expires: '',
  })
  const [reserveSending, setReserveSending] = useState(false)
  const [reserveSent, setReserveSent] = useState(false)
  const [activeReservation, setActiveReservation] = useState<{ id: string; accept_token: string; expires_at?: string; status?: string } | null>(null)
  const [reserveLinkCopied, setReserveLinkCopied] = useState(false)

  // ─── Roommate Groups ─────────────────────────────────────────────────────────
  type RoommateGroup = { id: string; name: string; emoji: string; property_slug: string | null; member_count: number }
  const [groupsModal, setGroupsModal] = useState(false)
  const [roommateGroups, setRoommateGroups] = useState<RoommateGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [leadGroupIds, setLeadGroupIds] = useState<Set<string>>(new Set())
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [showNewGroupInput, setShowNewGroupInput] = useState(false)

  const openGroupsModal = async () => {
    setGroupsModal(true)
    setGroupsLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const [groupsRes, memberRes] = await Promise.all([
      fetch('/api/roommate-groups', { headers: { Authorization: `Bearer ${session?.access_token}` } }),
      fetch(`/api/roommate-groups?lead_id=${leadId}`, { headers: { Authorization: `Bearer ${session?.access_token}` } }),
    ])
    if (groupsRes.ok) {
      const { groups } = await groupsRes.json()
      const allGroups: RoommateGroup[] = groups || []
      setRoommateGroups(allGroups)
      // Check membership by fetching each group's detail in parallel
      const checks = await Promise.all(
        allGroups.map(g =>
          fetch(`/api/roommate-groups/${g.id}`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
            .then(r => r.ok ? r.json() : null)
        )
      )
      const memberOf = new Set<string>()
      checks.forEach((detail, i) => {
        if (detail?.members?.some((m: { lead_id: string }) => m.lead_id === leadId)) {
          memberOf.add(allGroups[i].id)
        }
      })
      setLeadGroupIds(memberOf)
    }
    setGroupsLoading(false)
  }

  const handleAddToGroup = async (groupId: string) => {
    setAddingToGroup(groupId)
    const { data: { session } } = await supabase.auth.getSession()
    const alreadyIn = leadGroupIds.has(groupId)
    const method = alreadyIn ? 'DELETE' : 'POST'
    const res = await fetch(`/api/roommate-groups/${groupId}/members`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ lead_id: leadId }),
    })
    if (res.ok) {
      setLeadGroupIds(prev => {
        const next = new Set(prev)
        if (alreadyIn) next.delete(groupId); else next.add(groupId)
        return next
      })
      setRoommateGroups(prev => prev.map(g => g.id === groupId
        ? { ...g, member_count: g.member_count + (alreadyIn ? -1 : 1) }
        : g
      ))
      showToast(alreadyIn ? 'Removed from group' : 'Added to group! 🏠')
    }
    setAddingToGroup(null)
  }

  const handleCreateAndAdd = async () => {
    if (!newGroupName.trim()) return
    setCreatingGroup(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/roommate-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ name: newGroupName.trim(), emoji: '🏠', property_slug: lead?.property || null }),
    })
    if (res.ok) {
      const { group } = await res.json()
      // Add this lead immediately
      await fetch(`/api/roommate-groups/${group.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ lead_id: leadId }),
      })
      setRoommateGroups(prev => [{ ...group, member_count: 1 }, ...prev])
      setLeadGroupIds(prev => new Set([...prev, group.id]))
      setNewGroupName('')
      setShowNewGroupInput(false)
      showToast('Group created and lead added! 🏠')
    } else {
      showToast('Failed to create group', 'error')
    }
    setCreatingGroup(false)
  }

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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

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
      const { data: props } = await supabase.from('properties').select('slug, name').eq('owner_id', user.id)
      if (props) setProperties(props)

      if (ld.lead_group_id && ld.property) {
        const { data: groupLeads } = await supabase
          .from('leads')
          .select('id, created_at, first_name')
          .eq('lead_group_id', ld.lead_group_id)
          .eq('property', ld.property)
          .order('created_at', { ascending: true })
        if (groupLeads && groupLeads.length > 1) {
          setGroupedInquiries(groupLeads as { id: string; created_at: string | null; first_name: string | null }[])
        }
      }

      const activityRes = await fetch(`/api/leads/${leadId}/activity`)
      if (activityRes.ok) {
        const { prescreen: ps, emails: el } = await activityRes.json()
        setPrescreen(ps)
        setEmails(el || [])
      }

      const { data: tourRes } = await supabase
        .from('tours').select('*').eq('lead_id', leadId).eq('status', 'confirmed').maybeSingle()
      if (tourRes) setTourData(tourRes as TourRecord)
      if ((leadData as Lead & { tour_invite_sent_at?: string }).tour_invite_sent_at) setTourInviteSent(true)

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
          const { data: existingRes } = await supabase
            .from('lead_reservations')
            .select('id, accept_token, expires_at, status')
            .eq('lead_id', leadId)
            .in('status', ['pending', 'accepted'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (existingRes) setActiveReservation({ id: existingRes.id, accept_token: existingRes.accept_token, expires_at: existingRes.expires_at, status: existingRes.status })
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
        send_email: false,
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
        setActiveReservation({ id: body.id, accept_token: body.accept_token, expires_at: expiresAt.toISOString(), status: 'pending' })
        setReserveSent(true)
        setReserveModal(false)
        showToast('Offer created — opening preview')
        window.open(`/landlord/leads/${leadId}/offer/${body.id}`, '_blank')
      } else {
        showToast(body.error || 'Failed to create offer', 'error')
      }
    } catch { showToast('Failed to send reservation', 'error') }
    setReserveSending(false)
  }

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
  const initials = ((lead.first_name?.[0] || '') + (lead.last_name?.[0] || '')).toUpperCase() || '?'
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`
  const isActiveResExp = activeReservation
    ? (activeReservation.status === 'expired' || (activeReservation.expires_at ? new Date(activeReservation.expires_at) < new Date() : false))
    : false
  const isActiveResAcc = activeReservation?.status === 'accepted'

  // ── AI Insight generator (template-based, no API) ──
  const insight = (() => {
    const chips: { label: string; color: string; bg: string }[] = []
    const lines: string[] = []
    const heatH = lead.created_at ? (Date.now() - new Date(lead.created_at).getTime()) / 3600000 : null
    if (heatH !== null) {
      if (heatH < 24)  { chips.push({ label: '🔥 Hot — < 24h',    color: '#ef4444', bg: 'rgba(239,68,68,0.15)'    }); lines.push(`Lead came in less than 24 hours ago — respond today to maximize conversion.`) }
      else if (heatH < 72)  { chips.push({ label: '🌡 Warm — < 3 days', color: '#f97316', bg: 'rgba(249,115,22,0.15)'  }); lines.push(`Lead is ${Math.floor(heatH/24)} days old and still warm — follow up soon.`) }
      else if (heatH < 168) { chips.push({ label: '· Cooling — < 7d',  color: '#eab308', bg: 'rgba(234,179,8,0.15)'   }); lines.push(`Lead is ${Math.floor(heatH/24)} days old and cooling — prioritize a follow-up today.`) }
      else                  { chips.push({ label: '❄ Cold — 7d+',       color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' }); lines.push(`Lead is over a week old — a personal reactivation message may re-engage them.`) }
    }
    if (prescreen) {
      chips.push({ label: '✓ Pre-screened', color: '#10b981', bg: 'rgba(16,185,129,0.15)' })
      if (prescreen.monthly_budget) {
        const price = property?.price ?? 0
        const ok = price === 0 || prescreen.monthly_budget >= price * 0.85
        lines.push(ok
          ? `Budget of $${prescreen.monthly_budget.toLocaleString()}/mo fits your listing — financially qualified.`
          : `Budget of $${prescreen.monthly_budget.toLocaleString()}/mo may be below asking — discuss pricing flexibility.`)
        chips.push({ label: `$${prescreen.monthly_budget.toLocaleString()}/mo budget`, color: '#FFC627', bg: 'rgba(255,198,39,0.15)' })
      }
      if (prescreen.group_size !== null) {
        chips.push({ label: prescreen.group_size === 1 ? 'Solo renter' : `${prescreen.group_size} people`, color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' })
        if (prescreen.group_size > 1) lines.push(`Group of ${prescreen.group_size} — confirm all occupants will be on the lease.`)
      }
      if (prescreen.move_in_date) chips.push({ label: `Move-in ${prescreen.move_in_date}`, color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' })
    } else {
      chips.push({ label: '⚠ No pre-screen yet', color: '#fb923c', bg: 'rgba(251,146,60,0.15)' })
      lines.push(`Pre-screen not yet submitted — send a reminder to qualify this lead faster.`)
    }
    if (tourData) {
      chips.push({ label: '📅 Tour booked', color: '#c084fc', bg: 'rgba(192,132,252,0.15)' })
      lines.push(`Tour on ${new Date(tourData.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — prepare the property and send a reminder the day before.`)
    }
    if (activeReservation) {
      if (isActiveResAcc) { chips.push({ label: '✓ Offer accepted', color: '#10b981', bg: 'rgba(16,185,129,0.15)' }); lines.push('Offer was accepted — close this lead as leased.') }
      else if (isActiveResExp) { chips.push({ label: '⛔ Offer expired', color: '#f87171', bg: 'rgba(248,113,113,0.15)' }); lines.push('Offer expired — create a fresh one to maintain urgency.') }
      else { chips.push({ label: '🔒 Offer pending', color: '#f9a8d4', bg: 'rgba(249,168,212,0.15)' }); lines.push("Active offer is pending — send the email to create urgency.") }
    }
    const statusRec: Record<string, string> = {
      new:            'New lead — outreach within the first hour dramatically increases conversion.',
      contacted:      'Awaiting reply — a 24h follow-up nudge boosts response rates significantly.',
      follow_up:      'Needs a follow-up — try switching channels (call if you emailed, text if you called).',
      engaged:        'Actively engaged — push toward a tour or offer while interest is high.',
      cold:           'No response lately — a brief personal message can restart the conversation.',
      qualified:      'Fully qualified — ideal time to schedule a tour or send a reservation offer.',
      tour_scheduled: 'Tour is set — send a reminder 24h before and have the unit show-ready.',
      closed:         lead.closed_reason === 'leased' ? 'Leased — great outcome! Archive and track for referrals.' : 'Closed as not a fit — no further action needed.',
    }
    if (statusRec[lead.status]) lines.push(statusRec[lead.status])
    return { paragraph: lines.slice(0, 4).join(' '), chips: chips.slice(0, 7) }
  })()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ld-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        /* ── Header ── */
        .ld-hdr { background: #fff; border-bottom: 1px solid #e8e5de; position: sticky; top: 0; z-index: 100; }
        .ld-hdr-top { padding: 10px 24px; display: flex; align-items: center; gap: 14px; }
        .ld-back { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #9b9b9b; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: color 0.15s; flex-shrink: 0; padding: 0; }
        .ld-back:hover { color: #1a1a1a; }
        .ld-av { width: 38px; height: 38px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ld-name-block { flex: 1; min-width: 0; }
        .ld-name { font-size: 16px; font-weight: 700; color: #1a1a1a; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; line-height: 1.2; }
        .ld-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid; }
        .ld-sub { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
        .ld-prop-block { text-align: right; flex-shrink: 0; }
        .ld-prop-name { font-size: 12px; font-weight: 600; color: #1a1a1a; }
        .ld-prop-addr { font-size: 10px; color: #9b9b9b; margin-top: 1px; }
        .ld-prop-price { font-size: 12px; font-weight: 700; color: #8C1D40; margin-top: 2px; }

        /* ── Pipeline strip ── */
        .ld-pipe { display: flex; align-items: stretch; border-top: 1px solid #f0ede6; overflow-x: auto; scrollbar-width: none; }
        .ld-pipe::-webkit-scrollbar { display: none; }
        .ld-pipe-btn { flex: 1; min-width: 72px; padding: 6px 4px 5px; background: none; border: none; border-bottom: 3px solid transparent; font-size: 10px; font-weight: 500; color: #b0a898; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; text-align: center; transition: all 0.15s; display: flex; flex-direction: column; align-items: center; gap: 1px; line-height: 1.2; }
        .ld-pipe-btn:hover { color: #1a1a1a; background: #faf9f6; }
        .ld-pipe-btn.past { color: #6b6b6b; }
        .ld-pipe-btn.active { font-weight: 700; }

        /* ── Action bar ── */
        .ld-act-bar { padding: 7px 24px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border-top: 1px solid #f0ede6; background: #faf9f6; }
        .ld-act-btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1.5px solid; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; text-decoration: none; }
        .ld-act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ld-act-btn-primary { background: #8C1D40; color: #fff !important; border-color: #8C1D40; }
        .ld-act-btn-primary:hover:not(:disabled) { opacity: 0.88; }
        .ld-act-btn-gold { background: #FFC627; color: #1a1a1a !important; border-color: #FFC627; }
        .ld-act-btn-gold:hover { opacity: 0.9; }
        .ld-act-btn-ghost { background: #fff; color: #3a3a3a !important; border-color: #e8e5de; }
        .ld-act-btn-ghost:hover:not(:disabled) { border-color: #aaa; color: #1a1a1a !important; }
        .ld-act-btn-danger { background: rgba(239,68,68,0.06); color: #dc2626 !important; border-color: rgba(239,68,68,0.3); }
        .ld-act-btn-danger:hover { background: rgba(239,68,68,0.12); }
        .ld-act-btn-success { background: rgba(16,185,129,0.08); color: #10b981 !important; border-color: rgba(16,185,129,0.3); }
        .ld-act-btn-success:hover { background: rgba(16,185,129,0.14); }
        .ld-act-sep { width: 1px; height: 18px; background: #e0ddd7; flex-shrink: 0; }

        /* ── AI Insight ── */
        .ld-insight-wrap { padding: 14px 24px 0; }
        .ld-insight { background: #1a1a1a; border-radius: 12px; padding: 16px 20px; }
        .ld-insight-hd { font-size: 9px; font-weight: 700; color: rgba(255,198,39,0.85); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 6px; }
        .ld-insight-para { font-size: 13px; color: #d4d0ca; line-height: 1.65; margin-bottom: 10px; }
        .ld-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .ld-chip { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 600; border: 1px solid; }

        /* ── Body & 3-col grid ── */
        .ld-body { padding: 14px 24px 32px; }
        .ld-grid3 { display: grid; grid-template-columns: 1fr 1fr 300px; gap: 14px; align-items: start; }
        @media (max-width: 1080px) { .ld-grid3 { grid-template-columns: 1fr 1fr; } .ld-grid3 > :nth-child(3) { grid-column: span 2; } }
        @media (max-width: 680px)  { .ld-grid3 { grid-template-columns: 1fr; } .ld-grid3 > :nth-child(3) { grid-column: span 1; } }

        /* ── Cards ── */
        .ld-card { background: #fff; border-radius: 11px; border: 1px solid #e8e5de; margin-bottom: 12px; overflow: hidden; }
        .ld-card-hd { padding: 10px 14px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }
        .ld-card-ttl { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.7px; }
        .ld-card-bd { padding: 12px 14px; }

        /* ── KV rows ── */
        .kv { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; border-bottom: 1px solid #f5f4f0; gap: 8px; }
        .kv:last-child { border-bottom: none; }
        .kv-l { font-size: 11px; color: #9b9b9b; flex-shrink: 0; min-width: 70px; }
        .kv-r { font-size: 12px; color: #1a1a1a; font-weight: 500; text-align: right; }

        /* ── Prescreen tiles ── */
        .ps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        .ps-tile { background: #faf9f6; border-radius: 7px; padding: 7px 9px; border: 1px solid #f0ede6; }
        .ps-tile-l { font-size: 9px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
        .ps-tile-v { font-size: 12px; color: #1a1a1a; font-weight: 500; }

        /* ── Email timeline ── */
        .tl-row { display: flex; gap: 9px; padding: 8px 0; border-bottom: 1px solid #f0ede6; }
        .tl-row:last-child { border-bottom: none; }
        .tl-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
        .tl-type { font-size: 11px; font-weight: 600; color: #1a1a1a; line-height: 1.3; }
        .tl-meta { font-size: 10px; color: #9b9b9b; margin-top: 1px; }

        /* ── Modals ── */
        .status-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(3px); }
        .status-modal { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 480px; box-shadow: 0 24px 80px rgba(0,0,0,0.25); }
        .status-card { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 2px solid #e8e5de; border-radius: 10px; cursor: pointer; transition: all 0.15s; margin-bottom: 7px; }
        .status-card:hover { border-color: #8C1D40; background: #fdf2f5; }
        .status-card.selected { border-color: #8C1D40; background: #fdf2f5; }
        .status-card.current { cursor: default; opacity: 0.6; }
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
        .edit-field { margin-bottom: 14px; }
        .edit-field-label { display: block; font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 5px; }
        .edit-input { width: 100%; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 10px 13px; font-size: 14px; color: #1a1a1a; font-family: 'DM Sans', sans-serif; background: #faf9f6; outline: none; transition: border-color 0.15s, background 0.15s; }
        .edit-input:focus { border-color: #8C1D40; background: #fff; }
        .edit-input::placeholder { color: #b0a898; }
        .edit-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .edit-sheet-footer { padding: 4px 24px 24px; display: flex; gap: 10px; }
        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-gold { background: #FFC627; color: #1a1a1a; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-gold:hover { opacity: 0.9; }
        .btn-gold:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost { background: transparent; color: #3a3a3a; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #1a1a1a; }
        .reserve-mode-opt { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1.5px solid #e8e5de; border-radius: 9px; cursor: pointer; transition: all 0.15s; background: #fff; width: 100%; font-family: 'DM Sans', sans-serif; text-align: left; margin-bottom: 6px; }
        .reserve-mode-opt.selected { border-color: #8C1D40; background: #fdf2f5; }
        .reserve-discount-toggle { display: flex; gap: 6px; }
        .reserve-discount-opt { flex: 1; padding: 8px; border: 1.5px solid #e8e5de; border-radius: 7px; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #3a3a3a; transition: all 0.15s; }
        .reserve-discount-opt.selected { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }

        /* ── Toast ── */
        .ld-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>

      <div className="ld-page">

        {/* Toast */}
        {toast && (
          <div className="ld-toast" style={{ background: toast.type === 'success' ? '#1a1a1a' : '#8C1D40', color: '#fff' }}>
            {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
          </div>
        )}

        {/* ── HEADER ── */}
        <div className="ld-hdr">
          <div className="ld-hdr-top">
            <button className="ld-back" onClick={() => router.push('/landlord/leads')}>← Leads</button>
            <div className="ld-av">{initials}</div>
            <div className="ld-name-block">
              <div className="ld-name">
                {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                <span className="ld-badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                  {meta.icon} {meta.label}{lead.status === 'closed' && lead.closed_reason ? ` · ${lead.closed_reason}` : ''}
                </span>
                {heat.icon && <span style={{ fontSize: '13px' }} title={heat.label}>{heat.icon}</span>}
              </div>
              <div className="ld-sub">
                <a href={`mailto:${lead.email}`} style={{ color: '#9b9b9b', textDecoration: 'none' }}>{lead.email}</a>
                {lead.phone ? <> · <a href={`tel:${lead.phone}`} style={{ color: '#9b9b9b', textDecoration: 'none' }}>+1 {formatPhoneDisplay(lead.phone)}</a></> : ''}
                {' '}· {lead.created_at ? timeAgo(lead.created_at) : '—'}
              </div>
            </div>
            {property && (
              <div className="ld-prop-block">
                <div className="ld-prop-name">{property.name}</div>
                <div className="ld-prop-addr">📍 {property.address}</div>
                <div className="ld-prop-price">${property.price?.toLocaleString()}/mo</div>
              </div>
            )}
          </div>

          {/* Pipeline strip */}
          <div className="ld-pipe">
            {STATUS_ORDER.map((s, i) => {
              const sm = STATUS_META[s]
              const currentIdx = STATUS_ORDER.indexOf(lead.status)
              const isPast = i < currentIdx
              const isActive = lead.status === s
              return (
                <button
                  key={s}
                  className={`ld-pipe-btn${isActive ? ' active' : isPast ? ' past' : ''}`}
                  style={isActive ? { color: meta.color, borderBottomColor: meta.color, background: meta.bg } : {}}
                  onClick={() => { setPendingStatus(s); setStatusModal(true) }}
                  title={sm.desc}
                >
                  <span>{sm.icon}</span>
                  <span>{sm.label}</span>
                </button>
              )
            })}
          </div>

          {/* Action bar */}
          <div className="ld-act-bar">
            <button className="ld-act-btn ld-act-btn-gold" onClick={() => setStatusModal(true)}>🔄 Status</button>
            <button className="ld-act-btn ld-act-btn-ghost" onClick={() => setEditModal(true)}>✎ Edit</button>
            <div className="ld-act-sep" />
            {needsRemind && (
              <button className="ld-act-btn ld-act-btn-primary" disabled={reminding} onClick={sendReminder}>
                {reminding ? '…' : '📧 Send Reminder'}
              </button>
            )}
            {activeReservation ? (
              <button className="ld-act-btn ld-act-btn-primary" onClick={() => window.open(`/landlord/leads/${leadId}/offer/${activeReservation.id}`, '_blank')}>
                🔍 {isActiveResAcc ? 'View Accepted Offer' : isActiveResExp ? 'View Expired Offer' : 'View / Send Offer'}
              </button>
            ) : (
              <button className="ld-act-btn ld-act-btn-primary" onClick={() => setReserveModal(true)}>🔒 Build Offer</button>
            )}
            {activeReservation && (
              <button className="ld-act-btn ld-act-btn-ghost" onClick={() => setReserveModal(true)}>+ New Offer</button>
            )}
            <div className="ld-act-sep" />
            {tourData ? (
              <button className="ld-act-btn ld-act-btn-ghost" onClick={() => { setCancelForm({ reason: '', notes: '' }); setCancelTourModal(true) }}>
                📅 Manage Tour
              </button>
            ) : (
              <button className="ld-act-btn ld-act-btn-ghost" disabled={inviting} onClick={handleInviteToTour}>
                {inviting ? '…' : tourInviteSent ? '🔄 Resend Invite' : '🎉 Invite to Tour'}
              </button>
            )}
            <div className="ld-act-sep" />
            <button className="ld-act-btn ld-act-btn-ghost" onClick={openGroupsModal}>
              👥 {leadGroupIds.size > 0 ? `Groups (${leadGroupIds.size})` : 'Roommate Groups'}
            </button>
            <div className="ld-act-sep" />
            <a href={`mailto:${lead.email}?subject=Regarding your interest at ${property?.name || lead.property || 'our property'}`} className="ld-act-btn ld-act-btn-ghost">✉ Email</a>
            {lead.phone && <a href={`tel:${lead.phone}`} className="ld-act-btn ld-act-btn-ghost">📞 Call</a>}
            {lead.status !== 'closed' && (
              <>
                <div className="ld-act-sep" />
                <button className="ld-act-btn ld-act-btn-success" onClick={() => handleStatusUpdate('closed', 'leased')}>✓ Leased</button>
                <button className="ld-act-btn ld-act-btn-danger" onClick={() => handleStatusUpdate('closed', 'lost')}>✕ Not a Fit</button>
              </>
            )}
          </div>
        </div>

        {/* ── AI INSIGHT CARD ── */}
        <div className="ld-insight-wrap">
          <div className="ld-insight">
            <div className="ld-insight-hd">AI Lead Summary</div>
            <div className="ld-insight-para">{insight.paragraph || 'No insights available yet.'}</div>
            <div className="ld-chips">
              {insight.chips.map((chip, i) => (
                <span key={i} className="ld-chip" style={{ color: chip.color, background: chip.bg, borderColor: chip.color + '55' }}>
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="ld-body">

          {/* Grouped inquiries banner */}
          {groupedInquiries.length > 1 && (
            <div style={{ background: 'rgba(139,92,246,0.06)', border: '1.5px solid rgba(139,92,246,0.22)', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
                <span style={{ fontSize: '13px' }}>🔁</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {groupedInquiries.length} Inquiries from This Contact
                </span>
                <span style={{ fontSize: '10px', color: '#9b9b9b', marginLeft: 'auto' }}>Status changes apply to all</span>
              </div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                {groupedInquiries.map((inq, i) => (
                  <div
                    key={inq.id}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: inq.id === leadId ? 'rgba(139,92,246,0.1)' : '#fff', border: `1px solid ${inq.id === leadId ? 'rgba(139,92,246,0.3)' : '#e8e5de'}`, borderRadius: '7px', padding: '5px 9px', cursor: inq.id !== leadId ? 'pointer' : 'default', fontSize: '11px' }}
                    onClick={() => inq.id !== leadId && window.open(`/landlord/leads/${inq.id}`, '_blank')}
                  >
                    <span style={{ fontWeight: 700, color: '#8b5cf6' }}>#{i + 1}</span>
                    <span style={{ color: '#3a3a3a' }}>
                      {inq.created_at ? new Date(inq.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </span>
                    {inq.id === leadId && <span style={{ fontWeight: 700, color: '#8b5cf6', fontSize: '10px' }}>← viewing</span>}
                    {inq.id !== leadId && <span style={{ color: '#b0a898' }}>→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 3-COL GRID ── */}
          <div className="ld-grid3">

            {/* COL 1: Lead info + Prescreen */}
            <div>
              <div className="ld-card">
                <div className="ld-card-hd">
                  <span className="ld-card-ttl">Lead Information</span>
                  <button onClick={() => setEditModal(true)} style={{ background: 'none', border: 'none', fontSize: '11px', color: '#8C1D40', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>✎ Edit</button>
                </div>
                <div className="ld-card-bd">
                  <div className="kv"><span className="kv-l">Name</span><span className="kv-r">{lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}</span></div>
                  <div className="kv"><span className="kv-l">Email</span><span className="kv-r"><a href={`mailto:${lead.email}`} style={{ color: '#8C1D40', textDecoration: 'none' }}>{lead.email}</a></span></div>
                  <div className="kv"><span className="kv-l">Phone</span><span className="kv-r">{lead.phone ? `+1 ${formatPhoneDisplay(lead.phone)}` : '—'}</span></div>
                  <div className="kv"><span className="kv-l">Property</span><span className="kv-r">{property?.name || lead.property || '—'}</span></div>
                  <div className="kv"><span className="kv-l">Move-in</span><span className="kv-r">{lead.move_in_date ? new Date(lead.move_in_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span></div>
                  <div className="kv"><span className="kv-l">Submitted</span><span className="kv-r">{lead.created_at ? timeAgo(lead.created_at) : '—'}</span></div>
                  <div className="kv"><span className="kv-l">Lead Age</span><span className="kv-r" style={{ color: heat.color, fontWeight: 600 }}>{heat.icon} {heat.label}</span></div>
                </div>
              </div>

              <div className="ld-card">
                <div className="ld-card-hd">
                  <span className="ld-card-ttl">Pre-Screen</span>
                  {hasPrescreen
                    ? <span style={{ fontSize: '10px', fontWeight: 600, color: '#10b981' }}>✓ Complete</span>
                    : <span style={{ fontSize: '10px', fontWeight: 600, color: '#f97316' }}>Not submitted</span>
                  }
                </div>
                <div className="ld-card-bd">
                  {!hasPrescreen ? (
                    <div style={{ textAlign: 'center', padding: '12px 0' }}>
                      <div style={{ fontSize: '22px', marginBottom: '5px' }}>📋</div>
                      <div style={{ fontSize: '12px', color: '#6b6b6b', marginBottom: '10px' }}>Pre-screen not yet submitted.</div>
                      {needsRemind && (
                        <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 14px' }} disabled={reminding} onClick={sendReminder}>
                          {reminding ? 'Sending…' : '📧 Send Reminder'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {prescreen.about && (
                        <div style={{ background: '#fdf2f5', borderLeft: '3px solid #8C1D40', borderRadius: '0 6px 6px 0', padding: '8px 10px', marginBottom: '9px', fontSize: '12px', color: '#3a3a3a', lineHeight: 1.6, fontStyle: 'italic' }}>
                          &ldquo;{prescreen.about}&rdquo;
                        </div>
                      )}
                      <div className="ps-grid">
                        {(prescreen.occupation || prescreen.is_student !== null) && (
                          <div className="ps-tile">
                            <div className="ps-tile-l">Occupation</div>
                            <div className="ps-tile-v">{prescreen.occupation || (prescreen.is_student ? 'Student' : 'Non-student')}{(prescreen.occupation === 'Student' || prescreen.is_student) && prescreen.university ? ` — ${prescreen.university}` : ''}</div>
                          </div>
                        )}
                        {prescreen.gender && <div className="ps-tile"><div className="ps-tile-l">Gender</div><div className="ps-tile-v">{prescreen.gender}</div></div>}
                        {prescreen.birthdate && <div className="ps-tile"><div className="ps-tile-l">Birthdate</div><div className="ps-tile-v">{new Date(prescreen.birthdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>}
                        {prescreen.move_in_date && <div className="ps-tile"><div className="ps-tile-l">Move-in</div><div className="ps-tile-v">{prescreen.move_in_date}</div></div>}
                        {prescreen.group_size !== null && <div className="ps-tile"><div className="ps-tile-l">Group</div><div className="ps-tile-v">{prescreen.group_size === 1 ? 'Solo' : `${prescreen.group_size} people`}</div></div>}
                        {prescreen.monthly_budget && <div className="ps-tile"><div className="ps-tile-l">Budget</div><div className="ps-tile-v" style={{ color: '#8C1D40', fontWeight: 700 }}>${prescreen.monthly_budget.toLocaleString()}/mo</div></div>}
                        {prescreen.lease_length && <div className="ps-tile"><div className="ps-tile-l">Lease</div><div className="ps-tile-v">{prescreen.lease_length}</div></div>}
                        {prescreen.lifestyle && <div className="ps-tile"><div className="ps-tile-l">Lifestyle</div><div className="ps-tile-v">{prescreen.lifestyle}</div></div>}
                      </div>
                      {prescreen.notes && (
                        <div style={{ marginTop: '9px', background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '6px', padding: '9px 11px', fontSize: '12px', color: '#4a4a4a', lineHeight: 1.6 }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>Notes</div>
                          {prescreen.notes}
                        </div>
                      )}
                      <div style={{ marginTop: '7px', fontSize: '10px', color: '#b0a898', textAlign: 'right' }}>
                        Submitted {prescreen.created_at ? timeAgo(prescreen.created_at) : '—'}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* COL 2: Reservation + Tour */}
            <div>

              {/* Reservation */}
              <div className="ld-card">
                <div className="ld-card-hd">
                  <span className="ld-card-ttl">Spot Reservation</span>
                  {activeReservation && (() => {
                    if (isActiveResAcc) return <span style={{ fontSize: '10px', fontWeight: 600, color: '#10b981' }}>✓ Accepted</span>
                    if (isActiveResExp) return <span style={{ fontSize: '10px', fontWeight: 600, color: '#ef4444' }}>⛔ Expired</span>
                    return <span style={{ fontSize: '10px', fontWeight: 600, color: '#8C1D40' }}>🔒 Active</span>
                  })()}
                </div>
                <div className="ld-card-bd">
                  {activeReservation ? (
                    <>
                      <div style={{ background: isActiveResAcc ? 'rgba(16,185,129,0.05)' : isActiveResExp ? 'rgba(239,68,68,0.05)' : 'rgba(140,29,64,0.04)', border: `1.5px solid ${isActiveResAcc ? 'rgba(16,185,129,0.2)' : isActiveResExp ? 'rgba(239,68,68,0.2)' : 'rgba(140,29,64,0.15)'}`, borderRadius: '8px', padding: '10px 12px', marginBottom: '9px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: isActiveResAcc ? '#10b981' : isActiveResExp ? '#ef4444' : '#8C1D40', marginBottom: '3px' }}>
                          {isActiveResAcc ? 'Offer Accepted' : isActiveResExp ? 'Offer Expired' : 'Active — Send When Ready'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b6b6b', lineHeight: 1.5 }}>
                          {isActiveResAcc ? 'Lead accepted your reservation offer.' : isActiveResExp ? 'This offer expired. Create a new one.' : "Offer built — send email when you're ready."}
                        </div>
                        {activeReservation.expires_at && (
                          <div style={{ fontSize: '11px', color: isActiveResExp ? '#ef4444' : '#9b9b9b', marginTop: '3px' }}>
                            {isActiveResExp ? 'Expired ' : isActiveResAcc ? '' : 'Expires '}{new Date(activeReservation.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => window.open(`/landlord/leads/${leadId}/offer/${activeReservation.id}`, '_blank')}
                        style={{ width: '100%', padding: '9px', background: 'linear-gradient(135deg,#8C1D40,#a02050)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px', boxShadow: '0 3px 10px rgba(140,29,64,0.22)' }}
                      >
                        🔍 View / Send Offer
                      </button>
                      <button
                        onClick={() => setReserveModal(true)}
                        style={{ width: '100%', padding: '7px', background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', fontSize: '12px', fontWeight: 600, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        + Create New Offer
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '12px', color: '#6b6b6b', lineHeight: 1.6, marginBottom: '10px' }}>
                        Build a custom pricing offer with optional discount — preview before sending.
                      </div>
                      <button
                        onClick={() => setReserveModal(true)}
                        style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg,#8C1D40,#a02050)', color: '#fff', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", boxShadow: '0 4px 14px rgba(140,29,64,0.26)' }}
                      >
                        🔒 Build Reservation Offer
                      </button>
                      <div style={{ fontSize: '11px', color: '#9b9b9b', textAlign: 'center', marginTop: '6px' }}>
                        Preview &amp; edit before sending — no email until you choose
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Tour */}
              <div className="ld-card">
                <div className="ld-card-hd">
                  <span className="ld-card-ttl">Tour Scheduling</span>
                  {tourData && <span style={{ fontSize: '10px', fontWeight: 600, color: '#8b5cf6' }}>📅 Booked</span>}
                </div>
                <div className="ld-card-bd">
                  {tourData ? (
                    <>
                      <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '10px 12px', marginBottom: '9px' }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Confirmed Tour</div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '2px' }}>
                          {new Date(tourData.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b6b6b' }}>
                          {fmtTime(tourData.time_slot)} · {tourData.booked_by === 'tenant' ? 'Tenant booked' : 'You booked'}
                        </div>
                        {tourData.custom_note && (
                          <div style={{ marginTop: '6px', fontSize: '11px', color: '#4a4a4a', fontStyle: 'italic', borderTop: '1px solid #ede9fe', paddingTop: '6px' }}>
                            {tourData.custom_note}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={handleSendTourReminder}
                        disabled={sendingTourReminder}
                        style={{ width: '100%', padding: '8px', background: '#fff', border: '1.5px solid #e8e5de', borderRadius: '7px', fontSize: '12px', fontWeight: 600, color: '#1a1a1a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: '6px' }}
                      >
                        {sendingTourReminder ? 'Sending…' : '⏰ Send Reminder'}
                      </button>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => setManualTourModal(true)} style={{ flex: 1, padding: '7px', background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', fontSize: '11px', fontWeight: 500, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                          ↺ Reschedule
                        </button>
                        <button onClick={() => { setCancelForm({ reason: '', notes: '' }); setCancelTourModal(true) }} style={{ flex: 1, padding: '7px', background: 'rgba(239,68,68,0.05)', border: '1.5px solid rgba(239,68,68,0.25)', borderRadius: '7px', fontSize: '11px', fontWeight: 600, color: '#dc2626', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                          ✕ Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleInviteToTour}
                        disabled={inviting}
                        style={{ width: '100%', padding: '11px', background: '#1a1a1a', color: '#FFC627', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: 700, cursor: inviting ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: inviting ? 0.6 : 1, marginBottom: '7px' }}
                      >
                        {inviting ? 'Sending…' : tourInviteSent ? '🔄 Resend Tour Invitation' : '🎉 Invite to Tour'}
                      </button>
                      {tourInviteSent && (
                        <>
                          <div style={{ fontSize: '11px', color: '#10b981', textAlign: 'center', marginBottom: '7px' }}>✓ Invitation sent — tenant selects time</div>
                          <div style={{ background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: '8px', padding: '9px 11px', marginBottom: '7px' }}>
                            <div style={{ fontSize: '9px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Booking Link</div>
                            <div style={{ fontSize: '10px', color: '#4a4a4a', wordBreak: 'break-all', fontFamily: 'monospace', background: '#fff', border: '1px solid #e8e5de', borderRadius: '5px', padding: '5px 7px', marginBottom: '5px' }}>
                              {(process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')}/book-tour/{leadId}
                            </div>
                            <button
                              onClick={() => { navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'}/book-tour/${leadId}`); setTourLinkCopied(true); setTimeout(() => setTourLinkCopied(false), 2000) }}
                              style={{ width: '100%', padding: '5px', background: tourLinkCopied ? 'rgba(16,185,129,0.08)' : '#fff', border: `1.5px solid ${tourLinkCopied ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '5px', fontSize: '11px', fontWeight: 600, color: tourLinkCopied ? '#10b981' : '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                            >
                              {tourLinkCopied ? '✓ Copied!' : '⎘ Copy Link'}
                            </button>
                          </div>
                        </>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
                        <div style={{ flex: 1, height: '1px', background: '#f0ede6' }} />
                        <span style={{ fontSize: '10px', color: '#9b9b9b' }}>or book manually</span>
                        <div style={{ flex: 1, height: '1px', background: '#f0ede6' }} />
                      </div>
                      <button
                        onClick={() => setManualTourModal(true)}
                        style={{ width: '100%', padding: '9px', background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        📋 Book Manually
                      </button>
                      <div style={{ fontSize: '10px', color: '#9b9b9b', textAlign: 'center', marginTop: '5px' }}>
                        Requires availability in{' '}
                        <a href={`/landlord/listings/${lead.property}/calendar`} style={{ color: '#8C1D40', textDecoration: 'none', fontWeight: 600 }}>Calendar →</a>
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>

            {/* COL 3: Quick links + Email activity */}
            <div>

              {/* Pre-screen link */}
              <div className="ld-card">
                <div className="ld-card-hd"><span className="ld-card-ttl">Pre-Screen Link</span></div>
                <div className="ld-card-bd">
                  <div style={{ fontSize: '10px', color: '#4a4a4a', wordBreak: 'break-all', fontFamily: 'monospace', background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: '6px', padding: '7px 9px', marginBottom: '7px' }}>
                    {prescreenUrl}
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(prescreenUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                    style={{ width: '100%', padding: '7px', background: copied ? 'rgba(16,185,129,0.08)' : '#fff', border: `1.5px solid ${copied ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: copied ? '#10b981' : '#3a3a3a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s' }}
                  >
                    {copied ? '✓ Copied!' : '⎘ Copy Link'}
                  </button>
                </div>
              </div>

              {/* Email Activity */}
              <div className="ld-card">
                <div className="ld-card-hd">
                  <span className="ld-card-ttl">Email Activity</span>
                  <span style={{ fontSize: '11px', color: '#9b9b9b' }}>{emails.length} sent</span>
                </div>
                <div className="ld-card-bd">
                  {emails.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '14px 0', color: '#9b9b9b', fontSize: '12px' }}>No emails logged yet</div>
                  ) : (
                    emails.map(email => {
                      const tm = EMAIL_TYPE_META[email.type] || { label: email.type, icon: '📧', color: '#6b7280' }
                      return (
                        <div key={email.id} className="tl-row">
                          <div className="tl-dot" style={{ background: tm.color }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="tl-type">{tm.icon} {tm.label}</div>
                            <div className="tl-meta">{email.subject?.length > 44 ? email.subject.slice(0, 44) + '…' : email.subject}</div>
                            <div className="tl-meta" style={{ marginTop: '1px' }}>{timeAgo(email.sent_at)}</div>
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
                  This note will appear in the tenant&apos;s confirmation email.
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
                <PhoneInput
                  value={editForm.phone}
                  onChange={e164 => setEditForm(f => ({ ...f, phone: e164 }))}
                />
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
                <div className="edit-sheet-title">🔒 Build Reservation Offer</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>
                  Set pricing &amp; discount — you&apos;ll preview &amp; send from the next screen.
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
                        <div style={{ fontSize: '12px', color: '#9b9b9b' }}>
                          ${(reserveRooms.length > 0 ? reserveRooms.reduce((s, r) => s + r.price, 0) : property?.price ?? 0).toLocaleString()}/mo
                          {reserveRooms.length > 0 && <span style={{ color: '#b0a898' }}> (all {reserveRooms.length} rooms)</span>}
                        </div>
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
                  const basePrice = reserveForm.room_id
                    ? (reserveRooms.find(r => r.id === reserveForm.room_id)?.price ?? 0)
                    : reserveRooms.length > 0
                      ? reserveRooms.reduce((s, r) => s + r.price, 0)
                      : (property?.price ?? 0)
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
                🔍 A preview page will open in a new tab. You&apos;ll be able to see the full offer, edit it, and choose when to send the email to <strong>{lead?.email}</strong>.
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
                {reserveSending ? 'Creating…' : '🔍 Preview Offer →'}
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

      {/* ── ROOMMATE GROUPS MODAL ── */}
      {groupsModal && (
        <div
          className="status-modal-overlay"
          onClick={() => { setGroupsModal(false); setShowNewGroupInput(false); setNewGroupName('') }}
        >
          <div
            className="status-modal"
            style={{ maxWidth: 500 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
                  👥 Roommate Groups
                </div>
                <div style={{ fontSize: 12, color: '#9b9b9b', marginTop: 3 }}>
                  Add or remove {lead?.first_name || 'this lead'} from a group
                </div>
              </div>
              <button
                onClick={() => { setGroupsModal(false); setShowNewGroupInput(false); setNewGroupName('') }}
                style={{ background: 'none', border: 'none', fontSize: 18, color: '#9b9b9b', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {groupsLoading ? (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: '#9b9b9b' }}>Loading groups…</div>
            ) : (
              <>
                {roommateGroups.length === 0 && !showNewGroupInput ? (
                  <div style={{ background: '#f5f4f0', borderRadius: 10, padding: '20px 16px', textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🏠</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>No groups yet</div>
                    <div style={{ fontSize: 12, color: '#9b9b9b' }}>Create your first group to start organizing leads.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 280, overflowY: 'auto' }}>
                    {roommateGroups.map(group => {
                      const inGroup = leadGroupIds.has(group.id)
                      return (
                        <div
                          key={group.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: inGroup ? 'rgba(140,29,64,0.04)' : '#faf9f6', border: `1.5px solid ${inGroup ? 'rgba(140,29,64,0.25)' : '#e8e5de'}`, borderRadius: 10 }}
                        >
                          <span style={{ fontSize: 20 }}>{group.emoji}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{group.name}</div>
                            <div style={{ fontSize: 11, color: '#9b9b9b', marginTop: 1 }}>
                              {group.member_count} member{group.member_count !== 1 ? 's' : ''}
                            </div>
                          </div>
                          {inGroup && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                              ✓ In group
                            </span>
                          )}
                          <button
                            disabled={addingToGroup === group.id}
                            onClick={() => handleAddToGroup(group.id)}
                            style={{
                              fontSize: 12, fontWeight: 600, border: '1.5px solid', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0,
                              ...(inGroup
                                ? { color: '#ef4444', background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.25)' }
                                : { color: '#8C1D40', background: '#fdf2f5', borderColor: 'rgba(140,29,64,0.25)' }
                              )
                            }}
                          >
                            {addingToGroup === group.id ? '…' : inGroup ? 'Remove' : '+ Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Create new group inline */}
                {showNewGroupInput ? (
                  <div style={{ background: '#f5f4f0', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>New Group Name</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        autoFocus
                        className="edit-input"
                        placeholder="e.g. Fall 2026 Unit 4A"
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAdd(); if (e.key === 'Escape') { setShowNewGroupInput(false); setNewGroupName('') } }}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn-primary"
                        disabled={!newGroupName.trim() || creatingGroup}
                        onClick={handleCreateAndAdd}
                        style={{ flexShrink: 0, padding: '8px 14px', fontSize: 12 }}
                      >
                        {creatingGroup ? '…' : 'Create'}
                      </button>
                      <button
                        onClick={() => { setShowNewGroupInput(false); setNewGroupName('') }}
                        style={{ fontSize: 12, color: '#9b9b9b', background: 'none', border: '1.5px solid #e8e5de', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: '#9b9b9b', marginTop: 6 }}>
                      This lead will be added automatically when you create the group.
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewGroupInput(true)}
                    style={{ width: '100%', padding: '10px', background: '#fff', border: '1.5px dashed #e8e5de', borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#8C1D40', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginBottom: 14 }}
                  >
                    + Create New Group
                  </button>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    onClick={() => { setGroupsModal(false); router.push('/landlord/leads') }}
                    style={{ fontSize: 12, color: '#6b6b6b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 500, padding: 0 }}
                  >
                    Manage all groups →
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => { setGroupsModal(false); setShowNewGroupInput(false); setNewGroupName('') }}
                    style={{ fontSize: 12, padding: '7px 14px' }}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
