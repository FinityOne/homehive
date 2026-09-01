'use client'
import { getSiteUrl } from '@/lib/siteUrl'

import { useState, useEffect, use } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/leads'
import { getNextBestPlan, actionKindTag, type LeadActionContext, type ReservationState, type RecommendedAction } from '@/lib/leadActions'
import PhoneInput, { formatPhoneDisplay } from '@/components/ui/PhoneInput'

// tour_scheduled is a legacy status — treated as qualified in the pipeline display
const STATUS_ORDER: Lead['status'][] = ['new', 'contacted', 'follow_up', 'engaged', 'qualified', 'matching', 'cold', 'closed']

const STATUS_META: Record<Lead['status'], { label: string; color: string; bg: string; border: string; desc: string; icon: string }> = {
  new:            { label: 'New',            color: '#3b82f6', bg: '#eff6ff',   border: '#bfdbfe', desc: 'Just submitted — needs outreach',          icon: '📩' },
  contacted:      { label: 'Contacted',      color: '#f97316', bg: '#fff7ed',   border: '#fed7aa', desc: 'You\'ve reached out, awaiting response',    icon: '📞' },
  follow_up:      { label: 'Follow Up',      color: '#c2410c', bg: '#fff7ed',   border: '#fed7aa', desc: 'Needs a follow-up touch',                  icon: '🔄' },
  engaged:        { label: 'Engaged',        color: '#d97706', bg: '#fffbeb',   border: '#fde68a', desc: 'In active conversation',                    icon: '💬' },
  qualified:      { label: 'Qualified',      color: '#10b981', bg: '#f0fdf4',   border: '#bbf7d0', desc: 'Pre-screen complete, strong candidate',      icon: '✅' },
  matching:       { label: 'Roommate Match', color: '#8b5cf6', bg: '#f5f3ff',   border: '#ddd6fe', desc: 'Pairing with roommates',                    icon: '🤝' },
  cold:           { label: 'Cold',           color: '#64748b', bg: '#f8fafc',   border: '#e2e8f0', desc: 'No response — may need reactivation',       icon: '❄️' },
  tour_scheduled: { label: 'Qualified',      color: '#10b981', bg: '#f0fdf4',   border: '#bbf7d0', desc: 'Pre-screen complete, strong candidate',      icon: '✅' },
  closed:         { label: 'Closed',         color: '#6b7280', bg: '#f9fafb',   border: '#e5e7eb', desc: 'Lead closed out',                           icon: '🏁' },
}

type Prescreen = {
  id: string; lead_id: string; created_at: string
  occupation: string | null; is_student: boolean | null; university: string | null
  birthdate: string | null; gender: string | null
  move_in_date: string | null; group_size: number | null
  about: string | null; monthly_budget: number | null
  lease_length: string | null; lifestyle: string | null; pets: string | null; notes: string | null
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
  const [landlordName, setLandlordName] = useState('')

  // SMS Templates
  type SMSTemplate = { id: string; name: string; category: string; body: string; position: number }
  const [smsTemplates, setSmsTemplates] = useState<SMSTemplate[]>([])
  const [templatesCopied, setTemplatesCopied] = useState<string | null>(null)
  const [contactCopied, setContactCopied] = useState<'email' | 'phone' | null>(null)
  const [smsPanelOpen, setSmsPanelOpen] = useState(true)

  const [statusModal, setStatusModal] = useState(false)
  const [closedReason, setClosedReason] = useState<Lead['closed_reason']>(null)
  const [closeNotes, setCloseNotes] = useState('')
  const [pendingStatus, setPendingStatus] = useState<Lead['status'] | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  type LeadNote = { id: string; lead_id: string; content: string; created_at: string; updated_at: string }
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [noteInput, setNoteInput] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteContent, setEditingNoteContent] = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)

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
  type RoomDiscount = { discount_type: '' | 'dollars' | 'percent'; discount_amount: string }
  const [reserveModal, setReserveModal] = useState(false)
  const [reserveRooms, setReserveRooms] = useState<RoomOption[]>([])
  const [reserveForm, setReserveForm] = useState({
    mode: 'whole' as 'whole' | 'rooms',  // whole property or specific rooms
    selectedRoomIds: [] as string[],      // up to 2 room IDs
    discount_mode: 'bundle' as 'bundle' | 'per_room',
    // Bundle / whole-property discount
    discount_type: '' as '' | 'dollars' | 'percent',
    discount_amount: '',
    // Per-room discounts keyed by room_id
    roomDiscounts: {} as Record<string, RoomDiscount>,
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
  const [properties, setProperties] = useState<{ slug: string; name: string; address: string }[]>([])

  // Change property modal
  const [changePropertyModal, setChangePropertyModal] = useState(false)
  const [changePropertySlug, setChangePropertySlug] = useState('')
  const [changePropertyConfirm, setChangePropertyConfirm] = useState(false)
  const [changingProperty, setChangingProperty] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    if (lead) {
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead'
      document.title = `${name} — HomeHive`
    }
  }, [lead])

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser()
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
      const { data: props } = await supabase.from('properties').select('slug, name, address').eq('owner_id', user.id)
      if (props) setProperties(props as { slug: string; name: string; address: string }[])

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

      const notesRes = await fetch(`/api/leads/${leadId}/notes`)
      if (notesRes.ok) {
        const { notes: nl } = await notesRes.json()
        setNotes(nl || [])
      }
      setNotesLoading(false)

      // Landlord profile + SMS templates
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const [profileRes, tmplRes] = await Promise.all([
          supabase.from('profiles').select('first_name').eq('id', user.id).single(),
          fetch('/api/sms-templates', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        ])
        if (profileRes.data?.first_name) setLandlordName(profileRes.data.first_name)
        if (tmplRes.ok) { const { templates } = await tmplRes.json(); setSmsTemplates(templates || []) }
      }

      setLoading(false)
    }
    load()
  }, [leadId, router])

  // Substitute template variables with lead-specific data
  const fillTemplate = (body: string): string => {
    const siteUrl = getSiteUrl()
    let tourDateStr = ''
    if (tourData?.scheduled_date) {
      const tour = new Date(tourData.scheduled_date)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const diff = Math.round((today.getTime() - tour.getTime()) / 86400000)
      if (diff === 0) tourDateStr = 'today'
      else if (diff === 1) tourDateStr = 'yesterday'
      else if (diff > 1 && diff <= 6) tourDateStr = `${diff} days ago`
      else if (diff < 0 && diff >= -1) tourDateStr = 'tomorrow'
      else tourDateStr = `on ${tour.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
    }
    return body
      .replace(/\{\{first_name\}\}/g, lead?.first_name || 'there')
      .replace(/\{\{your_name\}\}/g, landlordName || '')
      .replace(/\{\{property_name\}\}/g, property?.name || lead?.property || 'the property')
      .replace(/\{\{listing_link\}\}/g, lead?.property ? `${siteUrl}/homes/${lead.property}` : siteUrl)
      .replace(/\{\{tour_date\}\}/g, tourDateStr || 'recently')
  }

  const handleStatusUpdate = async (status: Lead['status'], cr?: Lead['closed_reason']) => {
    if (!lead) return
    setUpdatingStatus(true)
    const notes = closeNotes.trim() || undefined
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, closed_reason: cr, closed_notes: notes }),
      })
      if (res.ok) {
        setLead(prev => prev ? { ...prev, status, closed_reason: cr || prev.closed_reason, closed_notes: notes ?? prev.closed_notes } : prev)
        setStatusModal(false)
        setPendingStatus(null)
        setClosedReason(null)
        setCloseNotes('')
        showToast(`Status updated to ${STATUS_META[status].label}`)
      }
    } catch { showToast('Failed to update status', 'error') }
    setUpdatingStatus(false)
  }

  const handleAddNote = async () => {
    if (!noteInput.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteInput.trim() }),
      })
      if (res.ok) {
        const { note } = await res.json()
        setNotes(prev => [note, ...prev])
        setNoteInput('')
        showToast('Note saved')
      } else {
        showToast('Failed to save note', 'error')
      }
    } catch { showToast('Failed to save note', 'error') }
    setSavingNote(false)
  }

  const handleUpdateNote = async (noteId: string) => {
    if (!editingNoteContent.trim()) return
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, content: editingNoteContent.trim() }),
      })
      if (res.ok) {
        const { note } = await res.json()
        setNotes(prev => prev.map(n => n.id === noteId ? note : n))
        setEditingNoteId(null)
        setEditingNoteContent('')
        showToast('Note updated')
      } else {
        showToast('Failed to update note', 'error')
      }
    } catch { showToast('Failed to update note', 'error') }
  }

  const handleDeleteNote = async (noteId: string) => {
    setDeletingNoteId(noteId)
    try {
      const res = await fetch(`/api/leads/${leadId}/notes?noteId=${noteId}`, { method: 'DELETE' })
      if (res.ok) {
        setNotes(prev => prev.filter(n => n.id !== noteId))
        showToast('Note deleted')
      } else {
        showToast('Failed to delete note', 'error')
      }
    } catch { showToast('Failed to delete note', 'error') }
    setDeletingNoteId(null)
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

  const handleChangeProperty = async () => {
    if (!lead || !changePropertySlug || changePropertySlug === lead.property) return
    setChangingProperty(true)
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property: changePropertySlug }),
      })
      if (res.ok) {
        setLead(prev => prev ? { ...prev, property: changePropertySlug } : prev)
        const { data: prop } = await supabase
          .from('properties')
          .select('name, address, price, property_images(url, position), rental_mode, property_rooms(id, name, price, is_available, position)')
          .eq('slug', changePropertySlug)
          .single()
        if (prop) {
          const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
          setProperty({ name: prop.name, address: prop.address, price: prop.price, heroImage: imgs.sort((a, b) => a.position - b.position)[0]?.url || '' })
          if ((prop as { rental_mode?: string }).rental_mode === 'by_room' && (prop as { property_rooms?: unknown[] }).property_rooms?.length) {
            const rooms = (prop.property_rooms as { id: string; name: string; price: number; is_available: boolean; position: number }[])
              .filter(r => r.is_available)
              .sort((a, b) => a.position - b.position)
              .map(r => ({ id: r.id, name: r.name || `Room ${r.position + 1}`, price: r.price }))
            setReserveRooms(rooms)
          } else {
            setReserveRooms([])
          }
        }
        setEditForm(f => ({ ...f, property: changePropertySlug }))
        setChangePropertyModal(false)
        setChangePropertyConfirm(false)
        setChangePropertySlug('')
        showToast('Property updated')
      } else {
        showToast('Failed to update property', 'error')
      }
    } catch { showToast('Failed to update property', 'error') }
    setChangingProperty(false)
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

      const payload: Record<string, unknown> = { expires_at: expiresAt.toISOString(), send_email: false }

      if (reserveForm.mode === 'rooms' && reserveForm.selectedRoomIds.length > 0) {
        // Multi-room offer
        if (reserveForm.discount_mode === 'per_room') {
          payload.rooms = reserveForm.selectedRoomIds.map(rid => {
            const rd = reserveForm.roomDiscounts[rid]
            return {
              room_id: rid,
              discount_type: rd?.discount_type || null,
              discount_amount: rd?.discount_type && rd?.discount_amount ? parseInt(rd.discount_amount, 10) : null,
            }
          })
        } else {
          // Bundle discount across selected rooms
          payload.rooms = reserveForm.selectedRoomIds.map(rid => ({ room_id: rid, discount_amount: null, discount_type: null }))
          if (reserveForm.discount_type && reserveForm.discount_amount) {
            payload.discount_type = reserveForm.discount_type
            payload.discount_amount = parseInt(reserveForm.discount_amount, 10)
          }
        }
      } else {
        // Whole property
        payload.room_id = null
        if (reserveForm.discount_type && reserveForm.discount_amount) {
          payload.discount_type = reserveForm.discount_type
          payload.discount_amount = parseInt(reserveForm.discount_amount, 10)
        }
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
  const siteUrl = getSiteUrl()
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
    if (lead.toured || lead.status === 'tour_scheduled') {
      chips.push({ label: '✓ Toured', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' })
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
      closed: lead.closed_reason === 'leased'
        ? 'Leased — great outcome! Archive and track for referrals.'
        : lead.closed_reason === 'found_another_place'
          ? 'Found another place — ask for a referral before they move on.'
          : lead.closed_reason === 'unresponsive'
            ? 'Went dark — consider a final reactivation touch in 30 days.'
            : lead.closed_reason === 'budget_mismatch'
              ? 'Budget mismatch — revisit if pricing changes or a new unit opens.'
              : 'Closed — no further action needed.',
    }
    if (statusRec[lead.status]) lines.push(statusRec[lead.status])
    return { paragraph: lines.slice(0, 4).join(' '), chips: chips.slice(0, 7) }
  })()

  // ── Computed values for new design ──────────────────────────────────────────
  const daysInStage = lead.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000))
    : 0

  const matchScore = (() => {
    if (!prescreen) return null
    let score = 45
    const rent = property?.price ?? 0
    const budget = prescreen.monthly_budget ?? 0
    if (budget > 0 && rent > 0) {
      const r = budget / rent
      if (r >= 1.2) score += 28
      else if (r >= 1.0) score += 18
      else if (r >= 0.85) score += 8
      else score -= 5
    }
    if (prescreen.move_in_date) {
      const parsed = new Date(prescreen.move_in_date)
      if (!isNaN(parsed.getTime())) {
        const months = (parsed.getTime() - Date.now()) / (30 * 86400000)
        if (months >= 0 && months <= 2) score += 15
        else if (months >= 0 && months <= 5) score += 10
        else score += 3
      } else {
        score += 5
      }
    }
    if (prescreen.lease_length?.includes('12')) score += 7
    if (prescreen.group_size === 1) score += 5
    return Math.min(99, Math.max(0, score))
  })()

  const matchVerdict = !matchScore ? null
    : matchScore >= 80 ? { label: 'Strong fit', color: '#16a34a' }
    : matchScore >= 65 ? { label: 'Good fit', color: '#2563eb' }
    : matchScore >= 50 ? { label: 'Possible fit', color: '#d97706' }
    : { label: 'Low fit', color: '#dc2626' }

  const copyQuickReply = (category: string) => {
    const tmpl = smsTemplates.find(t => t.category === category || t.name.toLowerCase().includes(category.toLowerCase()))
    if (tmpl) { navigator.clipboard.writeText(fillTemplate(tmpl.body)); showToast('Template copied!') }
    else showToast('Template not found', 'error')
  }

  const fmtTourTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const tourDateObj = tourData ? new Date(tourData.scheduled_date + 'T12:00:00') : null
  const tourDiffMs = tourDateObj ? tourDateObj.getTime() - Date.now() : null
  const tourDiffDays = tourDiffMs !== null ? Math.ceil(tourDiffMs / 86400000) : null
  const tourCountdown = tourDiffDays === null ? ''
    : tourDiffDays === 0 ? 'Today'
    : tourDiffDays === 1 ? 'Tomorrow · in ~24 hours'
    : tourDiffDays > 1 ? `In ${tourDiffDays} days`
    : `${Math.abs(tourDiffDays)} days ago`

  const budgetVsRent = prescreen?.monthly_budget && property?.price
    ? `$${prescreen.monthly_budget.toLocaleString()} / $${property.price.toLocaleString()} · ${prescreen.monthly_budget >= property.price ? '+' : ''}${Math.round(((prescreen.monthly_budget - property.price) / property.price) * 100)}%`
    : null

  // ── Next Best Action engine ──────────────────────────────────────────────
  const reservationState: ReservationState =
    !activeReservation ? 'none'
    : isActiveResAcc ? 'accepted'
    : isActiveResExp ? 'expired'
    : 'pending'

  const moveInMonths = (() => {
    if (!prescreen?.move_in_date) return null
    const d = new Date(prescreen.move_in_date)
    if (isNaN(d.getTime())) return null
    return (d.getTime() - Date.now()) / (30 * 86400000)
  })()

  const nbaCtx: LeadActionContext = {
    status: lead.status,
    closedReason: lead.closed_reason ?? null,
    firstName: lead.first_name || '',
    hoursSinceCreated: lead.created_at ? (Date.now() - new Date(lead.created_at).getTime()) / 3600000 : null,
    hasPrescreen,
    toured: !!(lead.toured || (tourDiffDays !== null && tourDiffDays < 0)),
    hasUpcomingTour: !!tourData && tourDiffDays !== null && tourDiffDays >= 0,
    tourDaysUntil: tourDiffDays,
    tourReminderSent: !!(tourData?.reminder_sent || tourInviteSent),
    reservation: reservationState,
    budgetRatio: prescreen?.monthly_budget && property?.price ? prescreen.monthly_budget / property.price : null,
    moveInMonths,
    groupSize: prescreen?.group_size ?? null,
    matchScore,
    hasPhone: !!lead.phone,
  }
  const nbaPlan = getNextBestPlan(nbaCtx)
  const primaryBusy =
    (['send_prescreen', 'reactivate'].includes(nbaPlan.primary.id) && reminding) ||
    (nbaPlan.primary.id === 'invite_tour' && inviting) ||
    (nbaPlan.primary.id === 'send_tour_reminder' && sendingTourReminder)

  const urgencyStyle: Record<string, { label: string; color: string; bg: string }> = {
    now:   { label: 'Do it now',  color: '#fecaca', bg: 'rgba(239,68,68,0.18)' },
    today: { label: 'Today',      color: '#fed7aa', bg: 'rgba(249,115,22,0.18)' },
    soon:  { label: 'This week',  color: '#bfdbfe', bg: 'rgba(59,130,246,0.18)' },
    low:   { label: 'No rush',    color: '#cbd5e1', bg: 'rgba(148,163,184,0.18)' },
  }

  // Ready-to-send scripts for copy/call actions, personalized to this lead.
  const fn = lead.first_name || 'there'
  const propName = property?.name || lead.property || 'the place'
  const listingLink = lead.property ? `${siteUrl}/homes/${lead.property}` : siteUrl
  const meName = landlordName || 'the landlord'
  const scriptFor = (id: RecommendedAction['id']): string => {
    switch (id) {
      case 'call_now':
        return `Hi ${fn}, this is ${meName} about ${propName}. I saw you were interested — I'd love to answer any questions and help you find a time to come see it. Is now a good moment to chat?`
      case 'discuss_pricing':
        return `Hi ${fn}! I know ${propName} is a bit above the budget you mentioned. I have some flexibility on terms and move-in timing and may be able to make it work — want to talk through a couple of options?`
      case 'ask_referral':
        return `Hi ${fn}! It was great connecting. If any of your friends are still looking for a place near campus, I'd love an intro — I'll take great care of them. ${listingLink}`
      default:
        return `Hi ${fn}! Thanks for your interest in ${propName}. Happy to answer any questions — want to set up a time to come see it? ${listingLink}`
    }
  }

  const runAction = (a: RecommendedAction) => {
    switch (a.id) {
      case 'call_now':
        navigator.clipboard.writeText(scriptFor('call_now')).catch(() => {})
        if (lead.phone) { window.location.href = `tel:${lead.phone}` ; showToast('Call script copied — dialing…') }
        else showToast('No phone on file — call script copied')
        break
      case 'text_followup':
        navigator.clipboard.writeText(scriptFor('text_followup')); showToast('Message copied — paste & send')
        break
      case 'discuss_pricing':
        navigator.clipboard.writeText(scriptFor('discuss_pricing')); showToast('Pricing message copied')
        break
      case 'ask_referral':
        navigator.clipboard.writeText(scriptFor('ask_referral')); showToast('Referral message copied')
        break
      case 'copy_prescreen_link':
        navigator.clipboard.writeText(prescreenUrl); showToast('Pre-screen link copied')
        break
      case 'send_prescreen':
      case 'reactivate':
        sendReminder()
        break
      case 'invite_tour':
        handleInviteToTour()
        break
      case 'book_tour_manual':
      case 'reschedule_tour':
        setManualTourModal(true)
        break
      case 'send_tour_reminder':
        handleSendTourReminder()
        break
      case 'build_offer':
      case 'new_offer':
        setReserveModal(true)
        break
      case 'view_offer':
        if (activeReservation) window.open(`/landlord/leads/${leadId}/offer/${activeReservation.id}`, '_blank')
        else setReserveModal(true)
        break
      case 'start_lease':
        router.push('/landlord/leases/new')
        break
      case 'mark_contacted':
        handleStatusUpdate('contacted')
        break
      case 'mark_engaged':
        handleStatusUpdate('engaged')
        break
      case 'close_leased':
        handleStatusUpdate('closed', 'leased')
        break
      case 'reopen_lead':
        handleStatusUpdate('contacted')
        break
      case 'prep_unit':
      case 'collect_deposit':
      case 'confirm_occupants':
        showToast(a.detail)
        break
      default:
        break
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── PAGE ── */
        .ld2-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }
        .ld2-wrap { max-width: 1360px; margin: 0 auto; padding: 20px 24px 60px; }

        /* ── BREADCRUMB ── */
        .ld2-bc { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9b9b9b; margin-bottom: 14px; }
        .ld2-bc a { color: #9b9b9b; text-decoration: none; font-weight: 500; }
        .ld2-bc a:hover { color: #1a1a1a; }
        .ld2-bc-sep { color: #d0ccc5; }
        .ld2-bc-cur { color: #1a1a1a; font-weight: 600; }

        /* ── HEADER CARD ── */
        .ld2-header { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; padding: 22px 24px 18px; margin-bottom: 10px; display: flex; gap: 16px; align-items: flex-start; }
        .ld2-avatar { width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, #8C1D40, #a02050); color: #FFC627; font-size: 20px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ld2-hd-main { flex: 1; min-width: 0; }
        .ld2-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
        .ld2-name { font-size: 22px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.4px; }
        .ld2-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; border: 1.5px solid; }
        .ld2-badge-status { background: #f0f0ff; border-color: #c7c7f9; color: #4f46e5; }
        .ld2-badge-heat-hot { background: #fff4ec; border-color: #f97316; color: #c2410c; }
        .ld2-badge-heat-warm { background: #fff4ec; border-color: #fb923c; color: #ea580c; }
        .ld2-badge-heat-cool { background: #fffbeb; border-color: #fcd34d; color: #b45309; }
        .ld2-badge-heat-cold { background: #f8fafc; border-color: #cbd5e1; color: #64748b; }
        .ld2-contacts { display: flex; align-items: center; gap: 0; flex-wrap: wrap; font-size: 13px; color: #6b6b6b; }
        .ld2-contact-item { display: flex; align-items: center; gap: 5px; margin-right: 16px; }
        .ld2-contact-item a { color: #6b6b6b; text-decoration: none; }
        .ld2-contact-item a:hover { color: #1a1a1a; }
        .ld2-copy-icon { background: none; border: none; cursor: pointer; color: #b0a898; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; padding: 0; transition: all 0.12s; flex-shrink: 0; }
        .ld2-copy-icon:hover { color: #8C1D40; background: rgba(140,29,64,0.08); }
        .ld2-copy-icon.ok { color: #10b981; background: rgba(16,185,129,0.08); }
        .ld2-listing { border-left: 1px solid #f0ede6; padding-left: 24px; min-width: 220px; flex-shrink: 0; }
        .ld2-listing-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
        .ld2-listing-name { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 3px; line-height: 1.3; }
        .ld2-listing-addr { font-size: 12px; color: #9b9b9b; margin-bottom: 5px; display: flex; align-items: center; gap: 4px; }
        .ld2-listing-price { font-size: 20px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.3px; }
        .ld2-listing-price span { font-size: 13px; font-weight: 400; color: #9b9b9b; }

        /* ── ACTION BAR ── */
        .ld2-actions { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #fff; border: 1px solid #e8e5de; border-radius: 12px; margin-bottom: 10px; flex-wrap: wrap; }
        .ld2-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1.5px solid; font-family: 'DM Sans', sans-serif; transition: all 0.12s; white-space: nowrap; }
        .ld2-btn-primary { background: #8C1D40; border-color: #8C1D40; color: #fff; box-shadow: 0 2px 8px rgba(140,29,64,0.25); }
        .ld2-btn-primary:hover { background: #7a1836; }
        .ld2-btn-green { background: #16a34a; border-color: #16a34a; color: #fff; box-shadow: 0 2px 8px rgba(22,163,74,0.2); }
        .ld2-btn-green:hover { background: #15803d; }
        .ld2-btn-ghost { background: #fff; border-color: #e8e5de; color: #3a3a3a; }
        .ld2-btn-ghost:hover { border-color: #d0ccc5; background: #faf9f6; }
        .ld2-btn-danger { background: #fff; border-color: #fca5a5; color: #dc2626; }
        .ld2-btn-danger:hover { background: #fef2f2; }
        .ld2-btn-cs { background: #f8f7f5; border-color: #e8e5de; color: #b0a898; cursor: not-allowed; position: relative; }
        .ld2-btn-cs:hover::after { content: 'Coming soon'; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; font-size: 11px; padding: 4px 9px; border-radius: 6px; white-space: nowrap; pointer-events: none; z-index: 10; }
        .ld2-sep { width: 1px; height: 24px; background: #e8e5de; flex-shrink: 0; }
        .ld2-more-btn { background: #fff; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 8px 10px; color: #6b6b6b; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
        .ld2-more-btn:hover { background: #faf9f6; }

        /* ── PIPELINE ── */
        .ld2-pipeline { background: #fff; border: 1px solid #e8e5de; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 0; overflow-x: auto; }
        .ld2-stage { display: flex; flex-direction: column; align-items: center; min-width: 90px; cursor: pointer; position: relative; flex: 1; }
        .ld2-stage + .ld2-stage::before { content: '▶'; position: absolute; left: -8px; top: 6px; font-size: 8px; color: #d0ccc5; }
        .ld2-stage-dot-wrap { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; margin-bottom: 5px; }
        .ld2-stage-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .ld2-stage.past .ld2-stage-dot { background: #22c55e; }
        .ld2-stage.active .ld2-stage-dot { background: #8C1D40; width: 13px; height: 13px; box-shadow: 0 0 0 3px rgba(140,29,64,0.2); }
        .ld2-stage.future .ld2-stage-dot { background: #e2e8f0; }
        .ld2-stage-name { font-size: 11px; font-weight: 600; color: #9b9b9b; text-align: center; }
        .ld2-stage.active .ld2-stage-name { color: #8C1D40; font-weight: 700; }
        .ld2-stage.past .ld2-stage-name { color: #4a4a4a; }
        .ld2-stage-days { font-size: 10px; color: #b0a898; text-align: center; margin-top: 2px; }
        .ld2-stage.active .ld2-stage-days { color: #8C1D40; font-weight: 600; }

        /* ── AI CARD ── */
        .ld2-ai { background: #111; border-radius: 14px; padding: 22px 24px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 18px; }
        .ld2-ai-top { display: flex; gap: 24px; align-items: flex-start; }
        .ld2-ai-left { flex: 1; min-width: 0; }
        .ld2-ai-label { font-size: 11px; font-weight: 700; color: #4ade80; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ld2-ai-stage { font-size: 10px; font-weight: 700; letter-spacing: 0.3px; color: #e2e8f0; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); padding: 2px 9px; border-radius: 20px; text-transform: none; }
        .ld2-ai-urg { font-size: 9px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; padding: 3px 9px; border-radius: 20px; }
        .ld2-ai-heading { font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 8px; line-height: 1.35; letter-spacing: -0.3px; }
        .ld2-ai-body { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.7; margin-bottom: 14px; }
        .ld2-ai-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .ld2-ai-chip { font-size: 11px; font-weight: 500; padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.06); }
        .ld2-ai-primary { flex-shrink: 0; width: 290px; display: flex; flex-direction: column; gap: 8px; }
        .ld2-ai-cta { background: #4ade80; color: #111; border: none; border-radius: 10px; padding: 14px 18px; font-size: 14.5px; font-weight: 800; cursor: pointer; font-family: 'DM Sans', sans-serif; display: flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap; width: 100%; transition: background 0.13s; letter-spacing: -0.2px; }
        .ld2-ai-cta:hover:not(:disabled) { background: #22c55e; }
        .ld2-ai-cta:disabled { opacity: 0.6; cursor: default; }
        .ld2-ai-cta-detail { font-size: 11.5px; color: rgba(255,255,255,0.5); line-height: 1.5; text-align: center; }
        .ld2-ai-secondary { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px; }
        .ld2-ai-sec-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: rgba(255,255,255,0.4); margin-bottom: 10px; }
        .ld2-ai-acts { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 8px; }
        .ld2-ai-act { display: flex; align-items: flex-start; gap: 10px; text-align: left; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 11px 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background 0.13s, border-color 0.13s; }
        .ld2-ai-act:hover { background: rgba(255,255,255,0.1); border-color: rgba(74,222,128,0.5); }
        .ld2-ai-act-ic { font-size: 16px; flex-shrink: 0; line-height: 1.4; }
        .ld2-ai-act-main { flex: 1; min-width: 0; }
        .ld2-ai-act-label { display: block; font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 2px; }
        .ld2-ai-act-detail { display: block; font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.45; }
        .ld2-ai-act-tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #4ade80; background: rgba(74,222,128,0.12); border-radius: 5px; padding: 3px 6px; flex-shrink: 0; white-space: nowrap; }
        @media (max-width: 760px) { .ld2-ai-top { flex-direction: column; } .ld2-ai-primary { width: 100%; } }

        /* ── 3-COL GRID ── */
        .ld2-grid { display: grid; grid-template-columns: 300px 1fr 300px; gap: 14px; align-items: start; }
        @media (max-width: 1100px) { .ld2-grid { grid-template-columns: 280px 1fr; } .ld2-col-right { display: none; } }
        @media (max-width: 760px) { .ld2-grid { grid-template-columns: 1fr; } }

        /* ── CARD ── */
        .ld2-card { background: #fff; border: 1px solid #e8e5de; border-radius: 14px; overflow: hidden; margin-bottom: 12px; }
        .ld2-card-hd { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid #f0ede6; }
        .ld2-card-title { font-size: 11px; font-weight: 700; color: #1a1a1a; text-transform: uppercase; letter-spacing: 0.6px; display: flex; align-items: center; gap: 7px; }
        .ld2-card-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .ld2-card-action { font-size: 12px; font-weight: 600; color: #8C1D40; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .ld2-card-action:hover { text-decoration: underline; }
        .ld2-card-body { padding: 16px; }

        /* ── MATCH SCORE ── */
        .ld2-score-ring { width: 80px; height: 80px; position: relative; margin: 0 auto 12px; }
        .ld2-score-svg { width: 80px; height: 80px; transform: rotate(-90deg); }
        .ld2-score-num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; color: #1a1a1a; }
        .ld2-score-denom { font-size: 11px; font-weight: 400; color: #9b9b9b; }
        .ld2-score-verdict { font-size: 16px; font-weight: 700; text-align: center; margin-bottom: 3px; }
        .ld2-score-desc { font-size: 12px; color: #6b6b6b; text-align: center; line-height: 1.5; margin-bottom: 14px; }
        .ld2-metric { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
        .ld2-metric-row { display: flex; justify-content: space-between; align-items: center; }
        .ld2-metric-label { font-size: 11px; color: #6b6b6b; }
        .ld2-metric-val { font-size: 11px; font-weight: 600; color: #1a1a1a; }
        .ld2-bar { height: 4px; background: #f0ede6; border-radius: 2px; overflow: hidden; }
        .ld2-bar-fill { height: 100%; border-radius: 2px; background: #22c55e; }
        .ld2-no-score { text-align: center; padding: 20px 0; color: #9b9b9b; font-size: 13px; }

        /* ── PRE-SCREEN ── */
        .ld2-quote { border-left: 3px solid #8C1D40; padding: 10px 14px; margin-bottom: 16px; background: #faf9f6; border-radius: 0 8px 8px 0; }
        .ld2-quote-text { font-size: 12px; color: #3a3a3a; line-height: 1.7; font-style: italic; }
        .ld2-quote-attr { font-size: 11px; color: #9b9b9b; margin-top: 6px; }
        .ld2-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .ld2-field { }
        .ld2-field-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
        .ld2-field-val { font-size: 12px; font-weight: 600; color: #1a1a1a; }
        .ld2-field-val.budget { color: #8C1D40; }
        .ld2-pet-tag { background: #fff9e6; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; font-size: 12px; color: #78350f; display: flex; align-items: flex-start; gap: 6px; }
        .ld2-no-prescreen { text-align: center; padding: 24px 0; color: #9b9b9b; font-size: 13px; }
        .ld2-ns-btn { margin-top: 10px; font-size: 12px; font-weight: 600; color: #8C1D40; background: none; border: 1px solid rgba(140,29,64,0.25); border-radius: 7px; padding: 6px 14px; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        /* ── TOUR ── */
        .ld2-tour-card { background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 1.5px solid #c4b5fd; border-radius: 12px; padding: 16px; display: flex; gap: 14px; align-items: flex-start; }
        .ld2-tour-date-box { background: #fff; border-radius: 10px; padding: 8px 12px; text-align: center; min-width: 52px; border: 1px solid #ddd6fe; flex-shrink: 0; }
        .ld2-tour-month { font-size: 10px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.5px; }
        .ld2-tour-day { font-size: 26px; font-weight: 800; color: #1a1a1a; line-height: 1; margin: 2px 0; }
        .ld2-tour-dow { font-size: 10px; color: #9b9b9b; }
        .ld2-tour-info { flex: 1; min-width: 0; }
        .ld2-tour-tag { font-size: 10px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px; }
        .ld2-tour-time { font-size: 17px; font-weight: 800; color: #1a1a1a; margin-bottom: 3px; }
        .ld2-tour-meta { font-size: 11px; color: #6b6b6b; line-height: 1.5; margin-bottom: 8px; }
        .ld2-tour-countdown { display: inline-flex; align-items: center; gap: 5px; background: #fff; border: 1px solid #ddd6fe; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; color: #7c3aed; }
        .ld2-tour-actions { display: flex; flex-direction: column; gap: 7px; flex-shrink: 0; }
        .ld2-tour-btn { font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; display: flex; align-items: center; gap: 6px; border: 1.5px solid; }
        .ld2-tour-btn-ghost { background: #fff; border-color: #ddd6fe; color: #4a4a4a; }
        .ld2-tour-btn-ghost:hover { border-color: #c4b5fd; background: #faf9f6; }
        .ld2-tour-btn-danger { background: #fff; border-color: #fca5a5; color: #dc2626; }
        .ld2-tour-btn-danger:hover { background: #fef2f2; }
        .ld2-no-tour { text-align: center; padding: 20px 0; }
        .ld2-no-tour p { font-size: 13px; color: #9b9b9b; margin-bottom: 12px; }
        .ld2-tour-invite-row { display: flex; gap: 8px; justify-content: center; }

        /* ── RESERVATION OFFER ── */
        .ld2-offer-desc { font-size: 12px; color: #6b6b6b; line-height: 1.65; margin-bottom: 14px; }
        .ld2-offer-tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .ld2-tier { border: 1.5px solid #e8e5de; border-radius: 12px; padding: 14px; position: relative; cursor: default; }
        .ld2-tier.recommended { border-color: #8C1D40; }
        .ld2-tier-badge { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); background: #8C1D40; color: #fff; font-size: 9px; font-weight: 700; padding: 2px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
        .ld2-tier-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .ld2-tier-price { font-size: 22px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.3px; }
        .ld2-tier-price span { font-size: 13px; font-weight: 400; color: #9b9b9b; }
        .ld2-tier-details { font-size: 11px; color: #6b6b6b; margin-top: 6px; line-height: 1.6; }
        .ld2-tier-stat { font-size: 11px; color: #16a34a; font-weight: 600; margin-top: 6px; display: flex; align-items: center; gap: 4px; }
        .ld2-tier-cs { opacity: 0.5; cursor: not-allowed; }
        .ld2-incentive-row { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1.5px dashed #e8e5de; border-radius: 10px; font-size: 12px; color: #6b6b6b; margin-bottom: 14px; }
        .ld2-offer-actions { display: flex; gap: 8px; }
        .ld2-offer-cta { flex: 1; background: #8C1D40; color: #fff; border: none; border-radius: 9px; padding: 11px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .ld2-offer-cta:hover { background: #7a1836; }
        .ld2-offer-draft { background: #fff; color: #4a4a4a; border: 1.5px solid #e8e5de; border-radius: 9px; padding: 11px 16px; font-size: 13px; font-weight: 600; cursor: not-allowed; font-family: 'DM Sans', sans-serif; opacity: 0.6; position: relative; }
        .ld2-offer-draft:hover::after { content: 'Coming soon'; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; font-size: 11px; padding: 4px 9px; border-radius: 6px; white-space: nowrap; pointer-events: none; }

        /* ── QUICK REPLY ── */
        .ld2-qr-meta { font-size: 11px; color: #9b9b9b; margin-bottom: 10px; }
        .ld2-qr-chips { display: flex; flex-wrap: wrap; gap: 7px; }
        .ld2-qr-chip { display: inline-flex; align-items: center; gap: 5px; padding: 7px 13px; border: 1.5px solid #e8e5de; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; background: #fff; color: #3a3a3a; transition: all 0.12s; }
        .ld2-qr-chip:hover { border-color: #8C1D40; color: #8C1D40; background: rgba(140,29,64,0.04); }
        .ld2-qr-chip.primary { background: #8C1D40; border-color: #8C1D40; color: #fff; }
        .ld2-qr-chip.primary:hover { background: #7a1836; }
        .ld2-qr-chip.cs { opacity: 0.5; cursor: not-allowed; position: relative; }
        .ld2-qr-chip.cs:hover { border-color: #e8e5de; color: #3a3a3a; background: #fff; }
        .ld2-qr-chip.cs:hover::after { content: 'Coming soon'; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; font-size: 11px; padding: 4px 9px; border-radius: 6px; white-space: nowrap; pointer-events: none; z-index: 10; }

        /* ── SMS TEMPLATES ── */
        .ld2-sms-cat { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; padding: 8px 16px 4px; }
        .ld2-sms-tmpl { padding: 10px 16px; border-bottom: 1px solid #f5f4f0; display: flex; align-items: flex-start; gap: 10px; }
        .ld2-sms-tmpl:last-child { border-bottom: none; }
        .ld2-sms-name { font-size: 11px; font-weight: 700; color: #6b6b6b; margin-bottom: 3px; }
        .ld2-sms-body { font-size: 12px; color: #1a1a1a; line-height: 1.6; }
        .ld2-sms-copy { flex-shrink: 0; padding: 5px 10px; border: 1.5px solid #e8e5de; border-radius: 7px; background: #fff; font-size: 11px; font-weight: 700; color: #6b6b6b; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s; }
        .ld2-sms-copy:hover { border-color: #8C1D40; color: #8C1D40; }
        .ld2-sms-copy.ok { border-color: #10b981; color: #10b981; }
        .ld2-sms-footer { padding: 10px 16px; background: #faf9f6; border-top: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }

        /* ── NOTES ── */
        .ld2-note-compose { background: #fff; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 10px 12px; transition: border-color 0.15s; margin-bottom: 12px; }
        .ld2-note-compose:focus-within { border-color: #8C1D40; }
        .ld2-note-textarea { width: 100%; border: none; background: transparent; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; resize: none; outline: none; line-height: 1.5; min-height: 72px; }
        .ld2-note-textarea::placeholder { color: #b0a898; }
        .ld2-note-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
        .ld2-note-add { background: #8C1D40; color: #fff; border: none; border-radius: 7px; padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .ld2-note-add:disabled { opacity: 0.5; cursor: not-allowed; }
        .ld2-note-save-hint { font-size: 11px; color: #b0a898; }
        .ld2-note-item { padding: 10px 12px; border-radius: 8px; border: 1px solid #f0ede6; background: #faf9f6; margin-bottom: 8px; }
        .ld2-note-author { font-size: 11px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
        .ld2-note-date { font-size: 10px; color: #9b9b9b; font-weight: 400; }
        .ld2-note-content { font-size: 12px; color: #3a3a3a; line-height: 1.6; white-space: pre-wrap; }
        .ld2-note-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
        .ld2-note-tag { font-size: 10px; color: #8C1D40; background: rgba(140,29,64,0.08); border-radius: 4px; padding: 1px 5px; }
        .ld2-note-del { background: none; border: none; font-size: 11px; color: #dc2626; cursor: pointer; opacity: 0; font-family: 'DM Sans', sans-serif; }
        .ld2-note-item:hover .ld2-note-del { opacity: 1; }

        /* ── TIMELINE ── */
        .ld2-tl-filters { display: flex; gap: 6px; margin-bottom: 12px; }
        .ld2-tl-filter { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; cursor: pointer; border: 1.5px solid #e8e5de; background: #fff; color: #6b6b6b; font-family: 'DM Sans', sans-serif; }
        .ld2-tl-filter.active { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }
        .ld2-tl-item { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f5f4f0; align-items: flex-start; }
        .ld2-tl-item:last-child { border-bottom: none; }
        .ld2-tl-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
        .ld2-tl-content { flex: 1; min-width: 0; }
        .ld2-tl-title { font-size: 12px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
        .ld2-tl-body { font-size: 11px; color: #6b6b6b; line-height: 1.5; }
        .ld2-tl-time { font-size: 10px; color: #b0a898; flex-shrink: 0; white-space: nowrap; margin-top: 2px; }

        /* ── SHARED / MODALS ── */
        .edit-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; display: flex; align-items: flex-end; justify-content: center; }
        .edit-sheet { background: #fff; border-radius: 20px 20px 0 0; width: 100%; max-width: 580px; padding: 0 0 32px; max-height: 92vh; overflow-y: auto; }
        .edit-sheet-handle { width: 36px; height: 4px; background: #e8e5de; border-radius: 2px; margin: 12px auto 0; }
        .edit-sheet-header { padding: 16px 22px 14px; border-bottom: 1px solid #f0ede6; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .edit-sheet-title { font-size: 17px; font-weight: 700; color: #1a1a1a; }
        .edit-sheet-body { padding: 16px 22px; display: flex; flex-direction: column; gap: 16px; }
        .edit-sheet-footer { padding: 0 22px; display: flex; gap: 10px; }
        .edit-field { display: flex; flex-direction: column; gap: 6px; }
        .edit-field-label { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; }
        .edit-input { padding: 10px 12px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; outline: none; width: 100%; }
        .edit-input:focus { border-color: #8C1D40; }
        .btn-ghost { padding: 10px 16px; border: 1.5px solid #e8e5de; border-radius: 8px; background: #fff; color: #4a4a4a; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-ghost:hover { background: #faf9f6; }
        .btn-gold { padding: 10px 16px; border: none; border-radius: 8px; background: #FFC627; color: #1a1a1a; font-size: 14px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .reserve-mode-opt { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1.5px solid #e8e5de; border-radius: 10px; background: #fff; cursor: pointer; text-align: left; font-family: 'DM Sans', sans-serif; transition: all 0.12s; }
        .reserve-mode-opt.selected { border-color: #8C1D40; background: rgba(140,29,64,0.03); }
        .reserve-mode-opt:disabled { opacity: 0.45; cursor: not-allowed; }
        .reserve-discount-toggle { display: flex; gap: 6px; }
        .reserve-discount-opt { flex: 1; padding: 8px; border: 1.5px solid #e8e5de; border-radius: 7px; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #3a3a3a; transition: all 0.15s; }
        .reserve-discount-opt.selected { border-color: #8C1D40; background: rgba(140,29,64,0.06); color: #8C1D40; }
        .status-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .status-modal { background: #fff; border-radius: 18px; width: 100%; max-width: 420px; padding: 24px; max-height: 90vh; overflow-y: auto; }
        .status-card { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1.5px solid #e8e5de; border-radius: 10px; margin-bottom: 7px; cursor: pointer; transition: all 0.12s; }
        .status-card.selected { border-color: #8C1D40 !important; background: #fdf2f5 !important; }
        .close-reason-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        .close-reason-card { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 2px solid #e8e5de; border-radius: 9px; cursor: pointer; transition: all 0.15s; background: #fff; text-align: left; font-family: 'DM Sans', sans-serif; }
        .close-reason-card:hover { border-color: #ccc; background: #faf9f6; }
        .close-reason-card.selected { border-color: #8C1D40; background: #fdf2f5; }
        .close-reason-icon { font-size: 18px; flex-shrink: 0; }
        .ld2-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.2); white-space: nowrap; }
        .ld2-toast.error { background: #ef4444; }
      `}</style>

      <div className="ld2-page">
        <div className="ld2-wrap">

          {/* ── BREADCRUMB ── */}
          <div className="ld2-bc">
            <a href="/landlord/leads">Leads</a>
            <span className="ld2-bc-sep">/</span>
            <span className="ld2-bc-cur">
              {lead.first_name}{lead.last_name ? ` ${lead.last_name}` : ''}{property ? ` · ${property.name}` : ''}
            </span>
          </div>

          {/* ── HEADER CARD ── */}
          <div className="ld2-header">
            <div className="ld2-avatar">{initials}</div>
            <div className="ld2-hd-main">
              <div className="ld2-name-row">
                <span className="ld2-name">{lead.first_name}{lead.last_name ? ` ${lead.last_name}` : ''}</span>
                <span className="ld2-badge ld2-badge-status">
                  <span style={{ fontSize: '10px' }}>▣</span>
                  {meta.label}
                </span>
                <span className={`ld2-badge ${heat.icon === '🔥' ? 'ld2-badge-heat-hot' : heat.icon === '🌡' ? 'ld2-badge-heat-warm' : heat.icon === '·' && heat.label.includes('Cool') ? 'ld2-badge-heat-cool' : 'ld2-badge-heat-cold'}`}>
                  {heat.icon} {heat.label.split(' — ')[0]}
                </span>
                {(lead.toured || lead.status === 'tour_scheduled') && (
                  <span className="ld2-badge" style={{ background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.3)', color: '#7c3aed' }}>
                    ✓ Toured
                  </span>
                )}
              </div>
              <div className="ld2-contacts">
                <div className="ld2-contact-item">
                  <span style={{ fontSize: '13px' }}>✉</span>
                  <a href={`mailto:${lead.email}`}>{lead.email}</a>
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    {contactCopied === 'email' && (
                      <span style={{ position: 'absolute', bottom: 'calc(100% + 5px)', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '5px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20 }}>
                        Copied!
                      </span>
                    )}
                    <button className={`ld2-copy-icon${contactCopied === 'email' ? ' ok' : ''}`} title="Copy email"
                      onClick={() => { navigator.clipboard.writeText(lead.email); setContactCopied('email'); setTimeout(() => setContactCopied(null), 2000) }}>
                      {contactCopied === 'email'
                        ? <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      }
                    </button>
                  </span>
                </div>
                {lead.phone && (
                  <div className="ld2-contact-item">
                    <span style={{ fontSize: '13px' }}>☏</span>
                    <a href={`tel:${lead.phone}`}>+1 {formatPhoneDisplay(lead.phone)}</a>
                    <span style={{ position: 'relative', display: 'inline-flex' }}>
                      {contactCopied === 'phone' && (
                        <span style={{ position: 'absolute', bottom: 'calc(100% + 5px)', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '5px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20 }}>
                          Copied!
                        </span>
                      )}
                      <button className={`ld2-copy-icon${contactCopied === 'phone' ? ' ok' : ''}`} title="Copy phone"
                        onClick={() => { navigator.clipboard.writeText(`+1${lead.phone}`); setContactCopied('phone'); setTimeout(() => setContactCopied(null), 2000) }}>
                        {contactCopied === 'phone'
                          ? <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          : <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        }
                      </button>
                    </span>
                  </div>
                )}
                <div className="ld2-contact-item" style={{ color: '#9b9b9b' }}>
                  <span style={{ fontSize: '13px' }}>⏱</span>
                  Submitted {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} · {lead.created_at ? timeAgo(lead.created_at) : ''}
                </div>
              </div>
            </div>
            {property && (
              <div className="ld2-listing">
                <div className="ld2-listing-label">Listing</div>
                <div className="ld2-listing-name">{property.name}</div>
                <div className="ld2-listing-addr">
                  <span style={{ fontSize: '11px' }}>◎</span>
                  {property.address}
                </div>
                <div className="ld2-listing-price">
                  ${property.price.toLocaleString()}<span>/mo</span>
                </div>
              </div>
            )}
          </div>

          {/* ── ACTION BAR ── */}
          <div className="ld2-actions">
            {activeReservation ? (
              <button className="ld2-btn ld2-btn-primary" onClick={() => window.open(`/landlord/leads/${leadId}/offer/${activeReservation.id}`, '_blank')}>
                <span>🔍</span>
                {isActiveResAcc ? 'View Accepted Offer' : isActiveResExp ? 'View Expired Offer' : 'View / Send Offer'}
              </button>
            ) : (
              <button className="ld2-btn ld2-btn-primary" onClick={() => setReserveModal(true)}>
                <span>⊕</span> Build Offer
              </button>
            )}
            {activeReservation && (
              <button className="ld2-btn ld2-btn-ghost" onClick={() => setReserveModal(true)}>+ New Offer</button>
            )}
            <a href={`mailto:${lead.email}?subject=Regarding your interest at ${property?.name || 'our property'}`} className="ld2-btn ld2-btn-green" style={{ textDecoration: 'none' }}>
              <span>✉</span> Email {lead.first_name || ''}
            </a>
            {lead.phone ? (
              <a href={`tel:${lead.phone}`} className="ld2-btn ld2-btn-ghost" style={{ textDecoration: 'none' }}>
                <span>☏</span> Call
              </a>
            ) : (
              <button className="ld2-btn ld2-btn-ghost" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>☏ Call</button>
            )}
            <button className="ld2-btn ld2-btn-cs">
              <span>💬</span> SMS
            </button>
            <div className="ld2-sep" />
            {tourData ? (
              <button className="ld2-btn ld2-btn-ghost" onClick={() => setCancelTourModal(true)}>
                <span>📅</span> Manage Tour
              </button>
            ) : (
              <button className="ld2-btn ld2-btn-ghost" disabled={inviting} onClick={handleInviteToTour}>
                <span>📅</span> {inviting ? '…' : tourInviteSent ? 'Resend Invite' : 'Invite to Tour'}
              </button>
            )}
            <button className="ld2-btn ld2-btn-ghost" onClick={openGroupsModal}>
              <span>👥</span> Roommate Groups
            </button>
            <button className="ld2-btn ld2-btn-ghost" onClick={() => setEditModal(true)}>
              <span>✎</span> Edit details
            </button>
            {properties.length > 1 && (
              <button className="ld2-btn ld2-btn-ghost" onClick={() => { setChangePropertySlug(lead.property || ''); setChangePropertyConfirm(false); setChangePropertyModal(true) }}>
                <span>⇄</span> Move Lead
              </button>
            )}
            <button className="ld2-more-btn" title="More options">···</button>
            <div style={{ marginLeft: 'auto' }} />
            {lead.status !== 'closed' && (
              <button className="ld2-btn ld2-btn-danger" onClick={() => { setPendingStatus('closed'); setStatusModal(true) }}>
                <span>✕</span> Close Lead
              </button>
            )}
          </div>

          {/* ── PIPELINE ── */}
          <div className="ld2-pipeline">
            {STATUS_ORDER.map((s, i) => {
              // tour_scheduled maps to qualified in the pipeline
              const effectiveStatus = lead.status === 'tour_scheduled' ? 'qualified' : lead.status
              const currentIdx = STATUS_ORDER.indexOf(effectiveStatus)
              const isPast = i < currentIdx
              const isActive = effectiveStatus === s
              return (
                <div key={s} className={`ld2-stage ${isActive ? 'active' : isPast ? 'past' : 'future'}`}
                  onClick={() => { if (!isActive) { setPendingStatus(s); setStatusModal(true) } }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '6px' }}>
                    <div className="ld2-stage-dot" />
                  </div>
                  <div className="ld2-stage-name">{STATUS_META[s].label}</div>
                  <div className="ld2-stage-days">
                    {isActive ? `${daysInStage}d in stage` : isPast ? '—' : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── CLOSED SUMMARY ── */}
          {lead.status === 'closed' && (
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderLeft: '4px solid #6b7280', borderRadius: '10px', padding: '14px 18px', marginBottom: '14px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '22px', lineHeight: 1 }}>
                {lead.closed_reason === 'leased' ? '🏠' : lead.closed_reason === 'found_another_place' ? '🔑' : lead.closed_reason === 'unresponsive' ? '👻' : lead.closed_reason === 'budget_mismatch' ? '💸' : lead.closed_reason === 'not_qualified' ? '🚫' : '📝'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '2px' }}>
                  {({
                    leased: 'Leased Here',
                    found_another_place: 'Found Another Place',
                    unresponsive: 'Went Dark / Unresponsive',
                    budget_mismatch: 'Budget Mismatch',
                    not_qualified: "Didn't Qualify",
                    other: 'Other',
                  } as Record<string, string>)[lead.closed_reason ?? ''] ?? 'Closed'}
                </div>
                {lead.closed_notes ? (
                  <div style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.5, marginTop: '4px' }}>{lead.closed_notes}</div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>No notes added.</div>
                )}
              </div>
              <button
                onClick={() => { setPendingStatus('closed'); setClosedReason(lead.closed_reason); setCloseNotes(lead.closed_notes || ''); setStatusModal(true) }}
                style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Edit
              </button>
            </div>
          )}

          {/* ── AI NEXT BEST ACTION ── */}
          <div className="ld2-ai">
            <div className="ld2-ai-top">
              <div className="ld2-ai-left">
                <div className="ld2-ai-label">
                  ✦ AI · Next Best Action
                  <span className="ld2-ai-stage">{nbaPlan.stageLabel}</span>
                  <span className="ld2-ai-urg" style={{ color: urgencyStyle[nbaPlan.urgency].color, background: urgencyStyle[nbaPlan.urgency].bg }}>
                    {urgencyStyle[nbaPlan.urgency].label}
                  </span>
                </div>
                <div className="ld2-ai-heading">{nbaPlan.headline}</div>
                <div className="ld2-ai-body">{nbaPlan.reasoning}</div>
                <div className="ld2-ai-chips">
                  {insight.chips.map((c, i) => <span key={i} className="ld2-ai-chip">{c.label}</span>)}
                </div>
              </div>
              <div className="ld2-ai-primary">
                <button className="ld2-ai-cta" disabled={primaryBusy} onClick={() => runAction(nbaPlan.primary)}>
                  {primaryBusy ? 'Working…' : `${nbaPlan.primary.icon} ${nbaPlan.primary.label}`}
                </button>
                <div className="ld2-ai-cta-detail">{nbaPlan.primary.detail}</div>
              </div>
            </div>

            {nbaPlan.secondary.length > 0 && (
              <div className="ld2-ai-secondary">
                <div className="ld2-ai-sec-label">Then, in order of impact</div>
                <div className="ld2-ai-acts">
                  {nbaPlan.secondary.map(a => (
                    <button key={a.id} className="ld2-ai-act" onClick={() => runAction(a)}>
                      <span className="ld2-ai-act-ic">{a.icon}</span>
                      <span className="ld2-ai-act-main">
                        <span className="ld2-ai-act-label">{a.label}</span>
                        <span className="ld2-ai-act-detail">{a.detail}</span>
                      </span>
                      <span className="ld2-ai-act-tag">{actionKindTag(a.kind)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── 3-COL GRID ── */}
          <div className="ld2-grid">

            {/* ── LEFT COL ── */}
            <div>

              {/* Match Score */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: matchScore && matchScore >= 65 ? '#22c55e' : matchScore ? '#f59e0b' : '#e2e8f0' }} />
                    Match Score
                  </div>
                  <button className="ld2-card-action" style={{ fontSize: '11px', color: '#9b9b9b' }}>How is this calculated? ⓘ</button>
                </div>
                <div className="ld2-card-body">
                  {matchScore && matchVerdict ? (
                    <>
                      <div className="ld2-score-ring">
                        <svg className="ld2-score-svg" viewBox="0 0 80 80">
                          <circle cx="40" cy="40" r="34" fill="none" stroke="#f0ede6" strokeWidth="7" />
                          <circle cx="40" cy="40" r="34" fill="none" stroke={matchVerdict.color} strokeWidth="7"
                            strokeDasharray={`${(matchScore / 100) * 213.6} 213.6`} strokeLinecap="round" />
                        </svg>
                        <div className="ld2-score-num">{matchScore}<span className="ld2-score-denom">/100</span></div>
                      </div>
                      <div className="ld2-score-verdict" style={{ color: matchVerdict.color }}>{matchVerdict.label}</div>
                      <div className="ld2-score-desc">
                        {prescreen?.monthly_budget && property
                          ? `Budget ${prescreen.monthly_budget >= property.price ? 'covers' : 'is below'} asking rent.${prescreen.notes ? ' ' + prescreen.notes.slice(0, 60) : ''}`
                          : 'Pre-screen complete — score based on available data.'}
                      </div>
                      {budgetVsRent && (
                        <div className="ld2-metric">
                          <div className="ld2-metric-row">
                            <span className="ld2-metric-label">Budget vs. rent</span>
                            <span className="ld2-metric-val">{budgetVsRent}</span>
                          </div>
                          <div className="ld2-bar">
                            <div className="ld2-bar-fill" style={{ width: `${Math.min(100, ((prescreen?.monthly_budget ?? 0) / (property?.price ?? 1)) * 80)}%`, background: (prescreen?.monthly_budget ?? 0) >= (property?.price ?? 0) ? '#22c55e' : '#f59e0b' }} />
                          </div>
                        </div>
                      )}
                      {prescreen?.move_in_date && (
                        <div className="ld2-metric">
                          <div className="ld2-metric-row">
                            <span className="ld2-metric-label">Move-in alignment</span>
                            <span className="ld2-metric-val">{prescreen.move_in_date}</span>
                          </div>
                          <div className="ld2-bar">
                            <div className="ld2-bar-fill" style={{ width: '80%' }} />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="ld2-no-score">
                      <div style={{ fontSize: '28px', marginBottom: '8px' }}>⊙</div>
                      <div>No pre-screen yet</div>
                      <div style={{ fontSize: '11px', marginTop: '4px', color: '#b0a898' }}>Score calculated after pre-screen</div>
                      {needsRemind && (
                        <button className="ld2-ns-btn" onClick={sendReminder} disabled={reminding}>
                          {reminding ? 'Sending…' : '📧 Send reminder'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Pre-screen Profile */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: prescreen ? '#22c55e' : '#f59e0b' }} />
                    Pre-screen Profile
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: prescreen ? '#16a34a' : '#f59e0b' }}>
                    {prescreen ? '✓ Complete' : '⚠ Pending'}
                  </span>
                </div>
                <div className="ld2-card-body">
                  {prescreen ? (
                    <>
                      {prescreen.about && (
                        <div className="ld2-quote">
                          <div className="ld2-quote-text">"{prescreen.about}"</div>
                          <div className="ld2-quote-attr">— Submitted {lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</div>
                        </div>
                      )}
                      <div className="ld2-fields">
                        <div className="ld2-field">
                          <div className="ld2-field-label">Occupation</div>
                          <div className="ld2-field-val">{prescreen.is_student ? `Student${prescreen.university ? ` · ${prescreen.university}` : ''}` : (prescreen.occupation || '—')}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Gender</div>
                          <div className="ld2-field-val">{prescreen.gender || '—'}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Age</div>
                          <div className="ld2-field-val">
                            {prescreen.birthdate
                              ? `${Math.floor((Date.now() - new Date(prescreen.birthdate).getTime()) / (365.25 * 86400000))} · ${prescreen.birthdate}`
                              : '—'}
                          </div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Move-in</div>
                          <div className="ld2-field-val">{prescreen.move_in_date || '—'}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Group</div>
                          <div className="ld2-field-val">{prescreen.group_size === 1 ? 'Solo' : prescreen.group_size ? `${prescreen.group_size} people` : '—'}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Lease</div>
                          <div className="ld2-field-val">{prescreen.lease_length || '—'}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Budget</div>
                          <div className="ld2-field-val budget">{prescreen.monthly_budget ? `$${prescreen.monthly_budget.toLocaleString()}/mo` : '—'}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Lifestyle</div>
                          <div className="ld2-field-val" style={{ textTransform: 'capitalize' }}>{prescreen.lifestyle || '—'}</div>
                        </div>
                        <div className="ld2-field">
                          <div className="ld2-field-label">Pets</div>
                          <div className="ld2-field-val" style={{ textTransform: 'capitalize' }}>{prescreen.pets && prescreen.pets !== 'none' ? `🐾 ${prescreen.pets}` : 'None'}</div>
                        </div>
                      </div>
                      {prescreen.notes && (
                        <div className="ld2-pet-tag">
                          <span>📝</span>
                          <span>{prescreen.notes}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="ld2-no-prescreen">
                      <div style={{ fontSize: '28px', marginBottom: '8px' }}>📋</div>
                      <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Pre-screen not submitted yet</div>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '10px' }}>
                        <button className="ld2-ns-btn" onClick={sendReminder} disabled={reminding}>
                          {reminding ? '…' : '📧 Send reminder'}
                        </button>
                        <button className="ld2-ns-btn" onClick={() => { navigator.clipboard.writeText(prescreenUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
                          {copied ? '✓ Copied!' : '🔗 Copy link'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── MID COL ── */}
            <div>

              {/* Tour Management */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: tourData ? '#8b5cf6' : '#e2e8f0' }} />
                    Tour Management
                  </div>
                  {tourData && <span style={{ fontSize: '11px', fontWeight: 700, color: '#16a34a' }}>✓ Confirmed</span>}
                </div>
                <div className="ld2-card-body">
                  {tourData ? (() => {
                    const td = new Date(tourData.scheduled_date + 'T12:00:00')
                    return (
                      <div className="ld2-tour-card">
                        <div className="ld2-tour-date-box">
                          <div className="ld2-tour-month">{td.toLocaleString('en-US', { month: 'short' })}</div>
                          <div className="ld2-tour-day">{td.getDate()}</div>
                          <div className="ld2-tour-dow">{td.toLocaleString('en-US', { weekday: 'short' })}</div>
                        </div>
                        <div className="ld2-tour-info">
                          <div className="ld2-tour-tag">Confirmed Tour</div>
                          <div className="ld2-tour-time">{fmtTourTime(tourData.time_slot)} · You hosting</div>
                          <div className="ld2-tour-meta">
                            {property?.name}{property?.address ? ` · ${property.address.split(',')[0]}` : ''}
                          </div>
                          {tourCountdown && (
                            <div className="ld2-tour-countdown">
                              <span>⏱</span> {tourCountdown}
                            </div>
                          )}
                        </div>
                        <div className="ld2-tour-actions">
                          <button className="ld2-tour-btn ld2-tour-btn-ghost" disabled={sendingTourReminder} onClick={async () => {
                            setSendingTourReminder(true)
                            try {
                              const { data: { session } } = await supabase.auth.getSession()
                              await fetch(`/api/tours/${tourData.id}/reminder`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } })
                              showToast('Reminder sent!')
                            } catch { showToast('Failed', 'error') }
                            setSendingTourReminder(false)
                          }}>
                            <span>🔔</span> Resend reminder
                          </button>
                          <button className="ld2-tour-btn ld2-tour-btn-ghost" onClick={() => setManualTourModal(true)}>
                            <span>↻</span> Reschedule
                          </button>
                          <button className="ld2-tour-btn ld2-tour-btn-danger" onClick={() => { setCancelForm({ reason: '', notes: '' }); setCancelTourModal(true) }}>
                            <span>✕</span> Cancel
                          </button>
                        </div>
                      </div>
                    )
                  })() : (
                    <div className="ld2-no-tour">
                      <p>No tour scheduled yet.</p>
                      <div className="ld2-tour-invite-row">
                        <button className="ld2-btn ld2-btn-ghost" disabled={inviting} onClick={handleInviteToTour}>
                          {inviting ? '…' : tourInviteSent ? '🔄 Resend Invite' : '🎉 Invite to Tour'}
                        </button>
                        <button className="ld2-btn ld2-btn-ghost" onClick={() => setManualTourModal(true)}>📅 Book Manually</button>
                      </div>
                    </div>
                  )}

                  {/* Tour checklist */}
                  {tourData && (
                    <div style={{ marginTop: '14px', borderTop: '1px solid #f0ede6', paddingTop: '14px' }}>
                      {[
                        { label: 'Send tour reminder', done: tourInviteSent, dueLabel: tourCountdown ? `Due ${tourCountdown}` : '' },
                        { label: 'Unit show-ready (clean + lights)', done: false, dueLabel: 'Coming soon', cs: true },
                        { label: 'Prepare lease packet', done: false, dueLabel: 'Coming soon', cs: true },
                        { label: 'Build reservation offer after tour', done: !!activeReservation, dueLabel: 'Within 24h', cs: false, action: () => setReserveModal(true) },
                      ].map((item, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: i < 3 ? '1px solid #f5f4f0' : 'none', opacity: item.cs ? 0.55 : 1 }}>
                          <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${item.done ? '#22c55e' : '#d0ccc5'}`, background: item.done ? '#22c55e' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {item.done && <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>}
                          </div>
                          <span style={{ flex: 1, fontSize: '13px', color: '#1a1a1a' }}>{item.label}</span>
                          {item.action && !item.done ? (
                            <button onClick={item.action} style={{ fontSize: '11px', color: '#8C1D40', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>→</button>
                          ) : (
                            <span style={{ fontSize: '11px', color: item.cs ? '#b0a898' : '#9b9b9b' }}>{item.dueLabel}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Spot Reservation Offer */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: activeReservation && !isActiveResExp ? '#22c55e' : '#f59e0b' }} />
                    Spot Reservation Offer
                  </div>
                  <button className="ld2-card-action" onClick={() => activeReservation ? window.open(`/landlord/leads/${leadId}/offer/${activeReservation.id}`, '_blank') : setReserveModal(true)}>
                    {activeReservation ? 'View offer →' : 'Preview email →'}
                  </button>
                </div>
                <div className="ld2-card-body">
                  <div className="ld2-offer-desc">
                    {activeReservation
                      ? `Active offer — ${isActiveResAcc ? 'accepted by lead.' : isActiveResExp ? 'expired. Renew to re-engage.' : 'pending acceptance.'} Tap to view or resend.`
                      : `Custom offer locks ${lead.first_name || 'the lead'} in. Preview before sending — no email goes out until you confirm.`}
                  </div>
                  <div className="ld2-offer-tiers">
                    <div className="ld2-tier recommended">
                      <div className="ld2-tier-badge">Recommended</div>
                      <div className="ld2-tier-label">Standard</div>
                      <div className="ld2-tier-price">${property?.price?.toLocaleString() ?? '—'}<span>/mo</span></div>
                      <div className="ld2-tier-details">Listed rate · 12 mo lease · standard deposit</div>
                      <div className="ld2-tier-stat">↗ Most common for this listing</div>
                    </div>
                    <div className="ld2-tier ld2-tier-cs" title="Coming soon">
                      <div className="ld2-tier-label">Early-Move Discount</div>
                      <div className="ld2-tier-price" style={{ opacity: 0.5 }}>
                        {property?.price ? `$${Math.round(property.price * 0.955).toLocaleString()}` : '—'}<span>/mo</span>
                      </div>
                      <div className="ld2-tier-details">~5% off · move-in by next month</div>
                      <div className="ld2-tier-stat" style={{ color: '#9b9b9b' }}>Coming soon</div>
                    </div>
                  </div>
                  <div className="ld2-incentive-row" style={{ opacity: 0.5 }} title="Coming soon">
                    <span>✦</span>
                    <span>Add incentive: Free move-in cleaning · 1 mo free parking · Pet deposit waiver</span>
                    <span style={{ marginLeft: 'auto', color: '#9b9b9b', fontSize: '12px' }}>Coming soon</span>
                  </div>
                  <div className="ld2-offer-actions">
                    <button className="ld2-offer-cta" onClick={() => setReserveModal(true)}>
                      ⊕ Build &amp; preview reservation offer
                    </button>
                    <button className="ld2-offer-draft">Save draft</button>
                  </div>
                </div>
              </div>

              {/* Quick Reply */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: '#3b82f6' }} />
                    Quick Reply
                  </div>
                  <span className="ld2-qr-meta">Copies template · paste to your phone</span>
                </div>
                <div className="ld2-card-body">
                  <div className="ld2-qr-chips">
                    <button className="ld2-qr-chip primary" onClick={() => copyQuickReply('Follow-Up')}>
                      ✦ Reactivate cold lead
                    </button>
                    <button className="ld2-qr-chip" onClick={() => copyQuickReply('Tour')}>
                      🔔 Tour reminder
                    </button>
                    <button className="ld2-qr-chip" onClick={() => { navigator.clipboard.writeText(prescreenUrl); showToast('Pre-screen link copied!') }}>
                      📋 Copy pre-screen link
                    </button>
                    <button className="ld2-qr-chip" onClick={() => { setReserveModal(true) }}>
                      👋 Send offer
                    </button>
                    <button className="ld2-qr-chip" onClick={() => {
                      const tmpl = smsTemplates.find(t => t.name.toLowerCase().includes('thank'))
                      if (tmpl) { navigator.clipboard.writeText(fillTemplate(tmpl.body)); showToast('Post-tour template copied!') }
                      else copyQuickReply('Tour')
                    }}>
                      🤝 Post-tour thank you
                    </button>
                    <button className="ld2-qr-chip cs">Blank</button>
                  </div>
                </div>
              </div>

              {/* SMS Templates */}
              {smsTemplates.length > 0 && (
                <div className="ld2-card">
                  <div className="ld2-card-hd" style={{ cursor: 'pointer' }} onClick={() => setSmsPanelOpen(o => !o)}>
                    <div className="ld2-card-title">
                      <div className="ld2-card-dot" style={{ background: '#6366f1' }} />
                      Text Message Templates
                      <span style={{ fontSize: '10px', fontWeight: 400, color: '#9b9b9b' }}>— personalized for {lead.first_name || 'this lead'}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#9b9b9b' }}>{smsPanelOpen ? '▲' : '▼'}</span>
                  </div>
                  {smsPanelOpen && (() => {
                    const CAT_ORDER = ['First Touch', 'Follow-Up', 'Tour', 'Check-In']
                    const grouped = CAT_ORDER.reduce<Record<string, typeof smsTemplates>>((acc, c) => {
                      acc[c] = smsTemplates.filter(t => t.category === c).sort((a, b) => a.position - b.position)
                      return acc
                    }, {})
                    return (
                      <>
                        {CAT_ORDER.map(cat => {
                          const catT = grouped[cat] || []
                          if (!catT.length) return null
                          return (
                            <div key={cat}>
                              <div className="ld2-sms-cat">{cat}</div>
                              {catT.map(t => {
                                const filled = fillTemplate(t.body)
                                const ok = templatesCopied === t.id
                                return (
                                  <div key={t.id} className="ld2-sms-tmpl">
                                    <div style={{ flex: 1 }}>
                                      <div className="ld2-sms-name">{t.name}</div>
                                      <div className="ld2-sms-body">{filled}</div>
                                    </div>
                                    <button className={`ld2-sms-copy${ok ? ' ok' : ''}`}
                                      onClick={() => { navigator.clipboard.writeText(filled); setTemplatesCopied(t.id); setTimeout(() => setTemplatesCopied(null), 2000) }}>
                                      {ok ? '✓ Copied' : '⎘ Copy'}
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                        <div className="ld2-sms-footer">
                          <span style={{ fontSize: '11px', color: '#b0a898' }}>Variables filled · {property?.name}</span>
                          <a href="/landlord/customizations" style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>Edit templates →</a>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* ── RIGHT COL ── */}
            <div>

              {/* Notes */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: '#3b82f6' }} />
                    Notes · <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>always visible</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#9b9b9b' }}>{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
                </div>
                <div className="ld2-card-body">
                  <div className="ld2-note-compose">
                    <textarea
                      className="ld2-note-textarea"
                      placeholder={`Jot a note — call outcome, objection, next step…`}
                      value={noteInput}
                      onChange={e => setNoteInput(e.target.value)}
                      onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (noteInput.trim()) { setSavingNote(true); fetch(`/api/leads/${leadId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: noteInput.trim() }) }).then(r => r.ok ? r.json() : null).then(d => { if (d?.note) { setNotes(prev => [d.note, ...prev]); setNoteInput('') } }).finally(() => setSavingNote(false)) } } }}
                    />
                    <div className="ld2-note-actions">
                      <span className="ld2-note-save-hint" style={{ fontSize: '11px', color: '#b0a898' }}>⌘ + ↵ to save</span>
                      <button className="ld2-note-add" disabled={savingNote || !noteInput.trim()}
                        onClick={async () => {
                          if (!noteInput.trim()) return
                          setSavingNote(true)
                          const r = await fetch(`/api/leads/${leadId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: noteInput.trim() }) })
                          if (r.ok) { const d = await r.json(); if (d.note) { setNotes(prev => [d.note, ...prev]); setNoteInput('') } }
                          setSavingNote(false)
                        }}>
                        + Add note
                      </button>
                    </div>
                  </div>
                  {notesLoading ? (
                    <div style={{ fontSize: '12px', color: '#9b9b9b', textAlign: 'center', padding: '12px 0' }}>Loading…</div>
                  ) : notes.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#b0a898', textAlign: 'center', padding: '12px 0' }}>No notes yet</div>
                  ) : notes.map(n => (
                    <div key={n.id} className="ld2-note-item">
                      <div className="ld2-note-author">
                        <span>You</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span className="ld2-note-date">{new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          <button className="ld2-note-del" onClick={async () => {
                            setDeletingNoteId(n.id)
                            await fetch(`/api/leads/${leadId}/notes/${n.id}`, { method: 'DELETE' })
                            setNotes(prev => prev.filter(x => x.id !== n.id))
                            setDeletingNoteId(null)
                          }} disabled={deletingNoteId === n.id}>✕</button>
                        </div>
                      </div>
                      {editingNoteId === n.id ? (
                        <div>
                          <textarea style={{ width: '100%', border: '1.5px solid #8C1D40', borderRadius: '7px', padding: '8px', fontSize: '12px', fontFamily: "'DM Sans',sans-serif", resize: 'vertical', outline: 'none', minHeight: '60px' }}
                            value={editingNoteContent} onChange={e => setEditingNoteContent(e.target.value)} />
                          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                            <button style={{ fontSize: '11px', fontWeight: 700, background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
                              onClick={async () => {
                                await fetch(`/api/leads/${leadId}/notes/${n.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editingNoteContent.trim() }) })
                                setNotes(prev => prev.map(x => x.id === n.id ? { ...x, content: editingNoteContent.trim() } : x))
                                setEditingNoteId(null)
                              }}>Save</button>
                            <button style={{ fontSize: '11px', background: 'none', border: '1px solid #e8e5de', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", color: '#6b6b6b' }} onClick={() => setEditingNoteId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="ld2-note-content" onClick={() => { setEditingNoteId(n.id); setEditingNoteContent(n.content) }} style={{ cursor: 'text' }}>{n.content}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Activity Timeline */}
              <div className="ld2-card">
                <div className="ld2-card-hd">
                  <div className="ld2-card-title">
                    <div className="ld2-card-dot" style={{ background: '#3b82f6' }} />
                    Activity Timeline
                  </div>
                  <button className="ld2-card-action">View all →</button>
                </div>
                <div className="ld2-card-body">
                  {(() => {
                    const EMAIL_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
                      lead_welcome:               { icon: '✉', color: '#3b82f6', bg: '#eff6ff' },
                      prescreen_reminder:         { icon: '⏰', color: '#f97316', bg: '#fff7ed' },
                      lead_qualified_landlord:    { icon: '✓', color: '#10b981', bg: '#f0fdf4' },
                      new_lead_landlord:          { icon: '🔔', color: '#8b5cf6', bg: '#f5f3ff' },
                      tour_invitation:            { icon: '🎉', color: '#8C1D40', bg: '#fdf2f5' },
                      tour_confirmation_tenant:   { icon: '📅', color: '#0ea5e9', bg: '#f0f9ff' },
                      tour_confirmation_landlord: { icon: '📅', color: '#0ea5e9', bg: '#f0f9ff' },
                      tour_reminder:              { icon: '⏰', color: '#d97706', bg: '#fffbeb' },
                      tour_cancellation_tenant:   { icon: '✕', color: '#ef4444', bg: '#fef2f2' },
                      tour_cancellation_landlord: { icon: '✕', color: '#ef4444', bg: '#fef2f2' },
                      reservation_sent:           { icon: '🔒', color: '#8C1D40', bg: '#fdf2f5' },
                    }
                    const timelineItems = [
                      ...emails.map(e => ({ id: e.id, type: 'email', emailType: e.type, title: EMAIL_TYPE_META[e.type]?.label || e.type, body: e.subject, time: e.sent_at })),
                      { id: 'sub', type: 'submit', emailType: '', title: 'New lead submitted', body: `${lead.first_name || ''} → ${property?.name || lead.property || ''}`, time: lead.created_at || '' },
                    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 12)

                    return timelineItems.length === 0
                      ? <div style={{ fontSize: '12px', color: '#9b9b9b', textAlign: 'center', padding: '16px 0' }}>No activity yet</div>
                      : timelineItems.map((item, i) => {
                        const meta = item.type === 'email' ? (EMAIL_ICONS[item.emailType] || { icon: '✉', color: '#3b82f6', bg: '#eff6ff' }) : { icon: '◉', color: '#6b7280', bg: '#f9fafb' }
                        return (
                          <div key={i} className="ld2-tl-item">
                            <div className="ld2-tl-icon" style={{ background: meta.bg, color: meta.color }}>{meta.icon}</div>
                            <div className="ld2-tl-content">
                              <div className="ld2-tl-title">{item.title}</div>
                              <div className="ld2-tl-body">{item.body}</div>
                            </div>
                            <div className="ld2-tl-time">
                              {item.time ? new Date(item.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                              <br />
                              {item.time ? new Date(item.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                            </div>
                          </div>
                        )
                      })
                  })()}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {toast && <div className={`ld2-toast${toast.type === 'error' ? ' error' : ''}`}>{toast.msg}</div>}

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

              {/* Room selector (only if by_room property) */}
              {reserveRooms.length > 0 && (
                <div className="edit-field">
                  <label className="edit-field-label">Reserve Which Spot?</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

                    {/* Entire Property option */}
                    <button
                      className={`reserve-mode-opt${reserveForm.mode === 'whole' ? ' selected' : ''}`}
                      onClick={() => setReserveForm(f => ({ ...f, mode: 'whole', selectedRoomIds: [] }))}
                    >
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: reserveForm.mode === 'whole' ? 'rgba(140,29,64,0.1)' : '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>🏠</div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Entire Property</div>
                        <div style={{ fontSize: '12px', color: '#9b9b9b' }}>
                          ${reserveRooms.reduce((s, r) => s + r.price, 0).toLocaleString()}/mo
                          <span style={{ color: '#b0a898' }}> (all {reserveRooms.length} rooms)</span>
                        </div>
                      </div>
                    </button>

                    {/* Specific rooms — checkboxes, max 2 */}
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '2px', marginBottom: '2px' }}>
                      Or select up to 2 specific rooms
                    </div>
                    {reserveRooms.map(room => {
                      const checked = reserveForm.selectedRoomIds.includes(room.id)
                      const atMax = !checked && reserveForm.selectedRoomIds.length >= 2
                      return (
                        <button
                          key={room.id}
                          className={`reserve-mode-opt${checked ? ' selected' : ''}`}
                          disabled={atMax}
                          style={{ opacity: atMax ? 0.45 : 1 }}
                          onClick={() => setReserveForm(f => {
                            const newIds = checked
                              ? f.selectedRoomIds.filter(id => id !== room.id)
                              : [...f.selectedRoomIds, room.id]
                            const newDiscounts = { ...f.roomDiscounts }
                            if (checked) delete newDiscounts[room.id]
                            return { ...f, mode: 'rooms', selectedRoomIds: newIds, roomDiscounts: newDiscounts }
                          })}
                        >
                          <div style={{ width: '22px', height: '22px', borderRadius: '5px', border: `2px solid ${checked ? '#8C1D40' : '#d0ccc5'}`, background: checked ? '#8C1D40' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#fff', flexShrink: 0 }}>
                            {checked ? '✓' : ''}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{room.name}</div>
                            <div style={{ fontSize: '12px', color: '#9b9b9b' }}>${room.price.toLocaleString()}/mo</div>
                          </div>
                        </button>
                      )
                    })}

                    {/* Selected rooms summary */}
                    {reserveForm.mode === 'rooms' && reserveForm.selectedRoomIds.length > 0 && (
                      <div style={{ fontSize: '12px', color: '#8C1D40', fontWeight: 600, padding: '6px 10px', background: 'rgba(140,29,64,0.05)', borderRadius: '7px' }}>
                        {reserveForm.selectedRoomIds.length === 1 ? '1 room selected' : `${reserveForm.selectedRoomIds.length} rooms selected`}
                        {' · '}${reserveForm.selectedRoomIds.reduce((s, id) => s + (reserveRooms.find(r => r.id === id)?.price ?? 0), 0).toLocaleString()}/mo total
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Discount section */}
              <div className="edit-field">
                <label className="edit-field-label">Offer a Discount? (optional)</label>

                {/* Multi-room: show bundle vs per-room toggle */}
                {reserveForm.mode === 'rooms' && reserveForm.selectedRoomIds.length > 0 && (
                  <div className="reserve-discount-toggle" style={{ marginBottom: '12px' }}>
                    <button
                      className={`reserve-discount-opt${reserveForm.discount_mode === 'bundle' ? ' selected' : ''}`}
                      onClick={() => setReserveForm(f => ({ ...f, discount_mode: 'bundle' }))}
                    >
                      Bundle Discount
                    </button>
                    <button
                      className={`reserve-discount-opt${reserveForm.discount_mode === 'per_room' ? ' selected' : ''}`}
                      onClick={() => setReserveForm(f => ({ ...f, discount_mode: 'per_room' }))}
                    >
                      Per Room
                    </button>
                  </div>
                )}

                {/* Bundle discount or whole-property discount */}
                {(reserveForm.mode === 'whole' || reserveForm.discount_mode === 'bundle') && (
                  <>
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
                      const basePrice = reserveForm.mode === 'rooms'
                        ? reserveForm.selectedRoomIds.reduce((s, id) => s + (reserveRooms.find(r => r.id === id)?.price ?? 0), 0)
                        : reserveRooms.length > 0
                          ? reserveRooms.reduce((s, r) => s + r.price, 0)
                          : (property?.price ?? 0)
                      const disc = parseInt(reserveForm.discount_amount, 10)
                      const final = reserveForm.discount_type === 'dollars'
                        ? Math.max(0, basePrice - disc)
                        : Math.round(basePrice * (1 - disc / 100))
                      return (
                        <div style={{ marginTop: '6px', fontSize: '12px', color: '#8C1D40', fontWeight: 600 }}>
                          {reserveForm.discount_mode === 'bundle' ? 'Bundle' : 'Offer'}: ${basePrice.toLocaleString()} → <strong>${final.toLocaleString()}/mo</strong>
                        </div>
                      )
                    })()}
                  </>
                )}

                {/* Per-room discounts */}
                {reserveForm.mode === 'rooms' && reserveForm.discount_mode === 'per_room' && reserveForm.selectedRoomIds.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {reserveForm.selectedRoomIds.map(rid => {
                      const room = reserveRooms.find(r => r.id === rid)
                      if (!room) return null
                      const rd = reserveForm.roomDiscounts[rid] ?? { discount_type: '' as const, discount_amount: '' }
                      const setRd = (patch: Partial<RoomDiscount>) =>
                        setReserveForm(f => ({ ...f, roomDiscounts: { ...f.roomDiscounts, [rid]: { ...rd, ...patch } } }))
                      return (
                        <div key={rid} style={{ background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '12px 14px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>
                            🛏 {room.name} <span style={{ color: '#9b9b9b', fontWeight: 400 }}>${room.price.toLocaleString()}/mo</span>
                          </div>
                          <div className="reserve-discount-toggle" style={{ marginBottom: '6px' }}>
                            <button className={`reserve-discount-opt${rd.discount_type === '' ? ' selected' : ''}`} onClick={() => setRd({ discount_type: '', discount_amount: '' })}>No discount</button>
                            <button className={`reserve-discount-opt${rd.discount_type === 'dollars' ? ' selected' : ''}`} onClick={() => setRd({ discount_type: 'dollars' })}>$ Off</button>
                            <button className={`reserve-discount-opt${rd.discount_type === 'percent' ? ' selected' : ''}`} onClick={() => setRd({ discount_type: 'percent' })}>% Off</button>
                          </div>
                          {rd.discount_type && (
                            <input
                              className="edit-input"
                              type="number"
                              min="1"
                              max={rd.discount_type === 'percent' ? '100' : undefined}
                              placeholder={rd.discount_type === 'dollars' ? 'e.g. 50' : 'e.g. 5'}
                              value={rd.discount_amount}
                              onChange={e => setRd({ discount_amount: e.target.value })}
                              style={{ marginTop: '4px' }}
                            />
                          )}
                          {rd.discount_type && rd.discount_amount && (() => {
                            const disc = parseInt(rd.discount_amount, 10)
                            const final = rd.discount_type === 'dollars'
                              ? Math.max(0, room.price - disc)
                              : Math.round(room.price * (1 - disc / 100))
                            return <div style={{ marginTop: '5px', fontSize: '12px', color: '#8C1D40', fontWeight: 600 }}>${room.price.toLocaleString()} → <strong>${final.toLocaleString()}/mo</strong></div>
                          })()}
                        </div>
                      )
                    })}
                  </div>
                )}
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
                disabled={reserveSending || (reserveForm.expires_mode === 'custom' && !reserveForm.custom_expires) || (reserveForm.mode === 'rooms' && reserveForm.selectedRoomIds.length === 0)}
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

      {/* ── CHANGE PROPERTY MODAL ── */}
      {changePropertyModal && (
        <div className="edit-overlay" onClick={() => { setChangePropertyModal(false); setChangePropertyConfirm(false) }}>
          <div className="edit-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="edit-sheet-handle" />
            <div className="edit-sheet-header">
              <div>
                <div className="edit-sheet-title">⇄ Move Lead to Another Property</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>
                  {changePropertyConfirm ? 'Confirm the property change below.' : 'Select the property this lead should be moved to.'}
                </div>
              </div>
              <button onClick={() => { setChangePropertyModal(false); setChangePropertyConfirm(false) }} style={{ background: '#f0ede6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '14px', color: '#6b6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>

            <div className="edit-sheet-body">
              {!changePropertyConfirm ? (
                <>
                  {/* Current property */}
                  <div className="edit-field">
                    <label className="edit-field-label">Currently Assigned To</label>
                    <div style={{ background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>
                        {properties.find(p => p.slug === lead.property)?.name || lead.property || '—'}
                      </div>
                      {properties.find(p => p.slug === lead.property)?.address && (
                        <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>
                          📍 {properties.find(p => p.slug === lead.property)?.address}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* New property selector */}
                  <div className="edit-field">
                    <label className="edit-field-label">Move To</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {properties.filter(p => p.slug !== lead.property).map(p => (
                        <button
                          key={p.slug}
                          onClick={() => setChangePropertySlug(p.slug)}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 14px',
                            border: `1.5px solid ${changePropertySlug === p.slug ? '#8C1D40' : '#e8e5de'}`,
                            borderRadius: '10px',
                            background: changePropertySlug === p.slug ? 'rgba(140,29,64,0.04)' : '#fff',
                            cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif",
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${changePropertySlug === p.slug ? '#8C1D40' : '#d0ccc5'}`, background: changePropertySlug === p.slug ? '#8C1D40' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                            {changePropertySlug === p.slug && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />}
                          </div>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{p.name}</div>
                            {p.address && <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '2px' }}>📍 {p.address}</div>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                /* Confirmation step */
                <div>
                  <div style={{ background: '#fff8e6', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '16px 18px', marginBottom: '20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Confirm Move</div>
                    <div style={{ fontSize: '13px', color: '#4a3800', lineHeight: 1.65 }}>
                      This will reassign <strong>{lead.first_name || lead.email}</strong>&apos;s lead to a different property. Any existing offer or tour may no longer apply.
                    </div>
                  </div>

                  {/* From → To card */}
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: '10px', marginBottom: '6px' }}>
                    <div style={{ flex: 1, background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px' }}>From</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{properties.find(p => p.slug === lead.property)?.name || lead.property || '—'}</div>
                      {properties.find(p => p.slug === lead.property)?.address && (
                        <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '3px' }}>📍 {properties.find(p => p.slug === lead.property)?.address}</div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '20px', color: '#8C1D40', fontWeight: 700, flexShrink: 0 }}>→</div>

                    <div style={{ flex: 1, background: 'rgba(140,29,64,0.04)', border: '1.5px solid rgba(140,29,64,0.25)', borderRadius: '10px', padding: '12px 14px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#8C1D40', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px' }}>To</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{properties.find(p => p.slug === changePropertySlug)?.name || changePropertySlug}</div>
                      {properties.find(p => p.slug === changePropertySlug)?.address && (
                        <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '3px' }}>📍 {properties.find(p => p.slug === changePropertySlug)?.address}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="edit-sheet-footer">
              {!changePropertyConfirm ? (
                <>
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={() => { setChangePropertyModal(false); setChangePropertyConfirm(false) }}>Cancel</button>
                  <button
                    disabled={!changePropertySlug || changePropertySlug === lead.property}
                    onClick={() => setChangePropertyConfirm(true)}
                    style={{
                      flex: 2, background: (!changePropertySlug || changePropertySlug === lead.property) ? '#d0ccc5' : 'linear-gradient(135deg, #8C1D40, #a02050)',
                      color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px',
                      fontSize: '14px', fontWeight: 700, cursor: (!changePropertySlug || changePropertySlug === lead.property) ? 'not-allowed' : 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    Next: Confirm →
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setChangePropertyConfirm(false)}>← Back</button>
                  <button
                    disabled={changingProperty}
                    onClick={handleChangeProperty}
                    style={{
                      flex: 2, background: changingProperty ? '#9b9b9b' : 'linear-gradient(135deg, #8C1D40, #a02050)',
                      color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px',
                      fontSize: '14px', fontWeight: 700, cursor: changingProperty ? 'not-allowed' : 'pointer',
                      fontFamily: "'DM Sans', sans-serif",
                      boxShadow: changingProperty ? 'none' : '0 4px 16px rgba(140,29,64,0.3)',
                    }}
                  >
                    {changingProperty ? 'Moving…' : '⇄ Confirm Move'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STATUS CHANGE MODAL ── */}
      {statusModal && (
        <div className="status-modal-overlay" onClick={() => { setStatusModal(false); setPendingStatus(null); setClosedReason(null); setCloseNotes('') }}>
          <div className="status-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a' }}>Change Status</div>
                <div style={{ fontSize: '13px', color: '#9b9b9b', marginTop: '2px' }}>Current: {meta.label}</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9b9b9b' }} onClick={() => { setStatusModal(false); setPendingStatus(null); setClosedReason(null); setCloseNotes('') }}>✕</button>
            </div>

            {STATUS_ORDER.filter(s => s !== 'closed').map(s => {
              const sm = STATUS_META[s]
              const effectiveLeadStatus = lead.status === 'tour_scheduled' ? 'qualified' : lead.status
              const isCurrent = effectiveLeadStatus === s
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
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Why is this lead closing?</div>
                <div className="close-reason-grid">
                  {([
                    { value: 'leased',              icon: '🏠', label: 'Leased Here' },
                    { value: 'found_another_place', icon: '🔑', label: 'Found Another Place' },
                    { value: 'unresponsive',        icon: '👻', label: 'Went Dark / Unresponsive' },
                    { value: 'budget_mismatch',     icon: '💸', label: 'Budget Mismatch' },
                    { value: 'not_qualified',       icon: '🚫', label: 'Didn\'t Qualify' },
                    { value: 'other',               icon: '📝', label: 'Other' },
                  ] as { value: Lead['closed_reason']; icon: string; label: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      className={`close-reason-card${closedReason === opt.value ? ' selected' : ''}`}
                      onClick={() => setClosedReason(opt.value)}
                    >
                      <span className="close-reason-icon">{opt.icon}</span>
                      <span className="close-reason-label">{opt.label}</span>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '12px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                    Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </label>
                  <textarea
                    placeholder="Any context about why this lead closed — visible only to you."
                    value={closeNotes}
                    onChange={e => setCloseNotes(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e8e5de', borderRadius: '8px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", outline: 'none', resize: 'vertical', boxSizing: 'border-box', color: '#1a1a1a', background: '#fff', lineHeight: 1.5 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#8C1D40' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e8e5de' }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => { setStatusModal(false); setPendingStatus(null); setClosedReason(null); setCloseNotes('') }}>Cancel</button>
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
