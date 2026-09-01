'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getLeadsForSlugs, updateLeadStatus } from '@/lib/leads'
import type { Lead } from '@/lib/leads'
import { usePostHog } from 'posthog-js/react'
import PhoneInput, { formatPhoneDisplay } from '@/components/ui/PhoneInput'

const UnlockModal = dynamic(() => import('@/components/leads/UnlockModal'), { ssr: false })

// Main pipeline flow — cold is a side bucket before closed
export const PIPELINE_ORDER: Lead['status'][] = ['new', 'contacted', 'follow_up', 'engaged', 'qualified', 'matching', 'cold', 'closed']

// tour_scheduled kept for backward compat but not in the selectable pipeline
const STATUS_SELECT_ORDER: Lead['status'][] = ['new', 'contacted', 'follow_up', 'engaged', 'qualified', 'matching', 'cold', 'closed']

export const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',        color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)' },
  contacted:      { label: 'Contacted',  color: '#f97316', bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.25)' },
  follow_up:      { label: 'Follow Up',  color: '#c2410c', bg: 'rgba(194,65,12,0.08)',   border: 'rgba(194,65,12,0.25)' },
  engaged:        { label: 'Engaged',    color: '#eab308', bg: 'rgba(234,179,8,0.08)',   border: 'rgba(234,179,8,0.3)'  },
  qualified:      { label: 'Qualified',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)'},
  matching:       { label: 'Roommate Match', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.25)'},
  cold:           { label: 'Cold',       color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.25)'},
  closed:         { label: 'Closed',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.25)'},
  tour_scheduled: { label: 'Qualified',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)'},
}

function getHeat(createdAt: string | null) {
  if (!createdAt) return { icon: '', color: '#94a3b8', label: '—' }
  const h = (Date.now() - new Date(createdAt).getTime()) / 3600000
  if (h < 24)  return { icon: '🔥', color: '#ef4444', label: '< 24h' }
  if (h < 72)  return { icon: '🌡', color: '#f97316', label: '< 3d'  }
  if (h < 168) return { icon: '·',  color: '#eab308', label: '< 7d'  }
  return { icon: '·', color: '#cbd5e1', label: '7d+' }
}

function timeAgo(d: string | null): string {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(first: string | null, last: string | null): string {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?'
}

type Property = { slug: string; name: string; address: string; price: number | null }

type Prescreen = {
  lead_id: string
  occupation: string | null; is_student: boolean | null
  monthly_budget: number | null; move_in_date: string | null
  lease_length: string | null; group_size: number | null
}

// Today as YYYY-MM-DD, in local time (for native <input type="date"> min)
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Closest upcoming 1st of the month, as YYYY-MM-DD (for native <input type="date">)
function nextFirstOfMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function computeScore(lead: Lead, prescreen: Prescreen | null, price: number | null): number {
  const statusBase: Record<string, number> = {
    new: 5, contacted: 15, follow_up: 20, engaged: 35,
    qualified: 55, matching: 65, tour_scheduled: 60, cold: 5, closed: 0,
  }
  let score = statusBase[lead.status] ?? 5
  if (lead.toured || lead.status === 'tour_scheduled') score += 15
  if (!prescreen) return Math.min(99, score)
  score += 18 // completed prescreen
  if (prescreen.group_size === 1) score += 3
  if (prescreen.lease_length?.toLowerCase().includes('year') || prescreen.lease_length?.includes('12')) score += 7
  if (price && prescreen.monthly_budget) {
    const r = prescreen.monthly_budget / price
    if (r >= 1.2) score += 20
    else if (r >= 1.0) score += 12
    else if (r >= 0.85) score += 5
    else score -= 5
  }
  if (prescreen.move_in_date) {
    const parsed = new Date(prescreen.move_in_date)
    if (!isNaN(parsed.getTime())) {
      const months = (parsed.getTime() - Date.now()) / (30 * 86400000)
      if (months >= 0 && months <= 2) score += 15
      else if (months >= 0 && months <= 5) score += 10
      else score += 3
    }
  }
  return Math.min(99, Math.max(0, score))
}

function scoreColor(s: number): { color: string; bg: string } {
  if (s >= 75) return { color: '#10b981', bg: 'rgba(16,185,129,0.1)' }
  if (s >= 55) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }
  if (s >= 30) return { color: '#f97316', bg: 'rgba(249,115,22,0.1)' }
  return { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }
}

function computeFreeLeadIds(leads: Lead[]): Set<string> {
  const oldestBySlug: Record<string, Lead> = {}
  for (const lead of leads) {
    if (!lead.property) continue
    const prev = oldestBySlug[lead.property]
    if (!prev || new Date(lead.created_at ?? 0) < new Date(prev.created_at ?? 0)) {
      oldestBySlug[lead.property] = lead
    }
  }
  return new Set(Object.values(oldestBySlug).map(l => l.id))
}

function urgencyOf(lead: Lead): 'urgent' | 'hot' | 'warm' | 'normal' {
  const d = Math.floor((Date.now() - new Date(lead.created_at || 0).getTime()) / 86400000)
  if (['qualified', 'matching'].includes(lead.status)) return 'hot'
  if ((lead.status === 'new' && d >= 3) || (['follow_up', 'contacted'].includes(lead.status) && d >= 14)) return 'urgent'
  if ((lead.status === 'new' && d >= 1) || (lead.status === 'contacted' && d >= 5)) return 'warm'
  return 'normal'
}

export default function LeadsListPage() {
  const router = useRouter()
  const ph = usePostHog()
  const [userId, setUserId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Lead['status'] | 'all'>('all')
  const [propertyFilter, setPropertyFilter] = useState<string | null>(null) // null = not yet initialized
  const [viewMode, setViewMode] = useState<'list' | 'pipeline'>('list')
  const [toast, setToast] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [remindingId, setRemindingId] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [closeModal, setCloseModal] = useState<{ leadId: string } | null>(null)
  const [closeReason, setCloseReason] = useState<Lead['closed_reason']>(null)
  const [closeNotes, setCloseNotes] = useState('')
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set())
  const [freeLeadIds, setFreeLeadIds] = useState<Set<string>>(new Set())
  const [hasPlan, setHasPlan] = useState(false)
  const [unlockModalLeadId, setUnlockModalLeadId] = useState<string | null>(null)
  const [prescreenMap, setPrescreenMap] = useState<Record<string, Prescreen>>({})
  const [page, setPage] = useState(1)
  const [collapsedProps, setCollapsedProps] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score')
  const [tourMap, setTourMap] = useState<Record<string, string>>({}) // lead_id -> scheduled_date
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', email: '', phone: '', property: '', move_in_date: nextFirstOfMonth() })
  const [addingLead, setAddingLead] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const isLeadVisible = (lead: Lead) => hasPlan || freeLeadIds.has(lead.id) || unlockedIds.has(lead.id)

  useEffect(() => { document.title = 'Leads — HomeHive' }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
    })
  }, [router])

  // One-time bootstrap: properties, unlocks, plan. Leads themselves are loaded
  // lazily per selected property (below) so we never pull every lead up front.
  const bootstrap = useCallback(async () => {
    if (!userId) return
    const [{ data: propsData }, { data: unlocks }, { data: plan }] = await Promise.all([
      supabase.from('properties').select('slug, name, address, price').eq('owner_id', userId).order('created_at', { ascending: true }),
      supabase.from('lead_unlocks').select('lead_id').eq('landlord_id', userId),
      supabase.from('landlord_plans').select('plan_type, status').eq('landlord_id', userId).eq('status', 'active').maybeSingle(),
    ])
    const props = (propsData || []) as Property[]
    setProperties(props)
    setHasPlan(!!(plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)))
    setUnlockedIds(new Set((unlocks || []).map((u: { lead_id: string }) => u.lead_id)))
    // Default to the first property — the most common view. 'All properties' is opt-in.
    setPropertyFilter(prev => prev ?? (props.length > 0 ? props[0].slug : 'all'))
    if (props.length === 0) { setLeads([]); setLoading(false) }
  }, [userId])

  useEffect(() => { bootstrap() }, [bootstrap])

  // Lazy lead loader — fetches only the leads for the active property filter, plus
  // their tour/prescreen overlays. Switching to another property (or "all") loads
  // that set on demand instead of everything at once.
  const loadLeadsFor = useCallback(async (key: string) => {
    const allSlugs = properties.map(p => p.slug).filter(Boolean) as string[]
    if (allSlugs.length === 0) return
    const slugs = key === 'all' ? allSlugs : [key]
    setLoading(true)

    const leadsData = await getLeadsForSlugs(slugs)
    leadsData.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    setLeads(leadsData)
    setFreeLeadIds(computeFreeLeadIds(leadsData))

    const leadIds = leadsData.map(l => l.id)
    if (leadIds.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      const { data: tours } = await supabase
        .from('tours')
        .select('lead_id, scheduled_date')
        .in('lead_id', leadIds)
        .eq('status', 'confirmed')
        .gte('scheduled_date', today)
      const tmap: Record<string, string> = {}
      for (const t of tours || []) tmap[t.lead_id] = t.scheduled_date
      setTourMap(tmap)

      const qualifiedIds = leadsData
        .filter(l => ['qualified', 'matching', 'cold', 'closed', 'tour_scheduled'].includes(l.status))
        .map(l => l.id)
      if (qualifiedIds.length > 0) {
        const { data: pscreens } = await supabase
          .from('pre_screens')
          .select('lead_id, occupation, is_student, monthly_budget, move_in_date, lease_length, group_size')
          .in('lead_id', qualifiedIds)
        const map: Record<string, Prescreen> = {}
        for (const p of pscreens || []) map[p.lead_id] = p as Prescreen
        setPrescreenMap(map)
      } else setPrescreenMap({})
    } else {
      setTourMap({})
      setPrescreenMap({})
    }
    setLoading(false)
  }, [properties])

  // Load (and reload) leads whenever the active property filter changes.
  useEffect(() => {
    if (propertyFilter !== null && properties.length > 0) loadLeadsFor(propertyFilter)
  }, [propertyFilter, properties.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1) }, [search, statusFilter, propertyFilter])

  const handleStatusChange = async (lead: Lead, newStatus: Lead['status']) => {
    if (newStatus === lead.status) return
    if (newStatus === 'closed') { setCloseReason(null); setCloseNotes(''); setCloseModal({ leadId: lead.id }); return }
    setUpdatingStatusId(lead.id)
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: newStatus } : l))
    const { error } = await updateLeadStatus(lead.id, newStatus)
    if (error) {
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: lead.status } : l))
      showToast('Failed to update status')
    } else {
      showToast(`→ ${STATUS_META[newStatus]?.label}`)
      ph?.capture('lead_status_changed', { lead_id: lead.id, from: lead.status, to: newStatus })
    }
    setUpdatingStatusId(null)
  }

  const handleCloseWithReason = async () => {
    if (!closeModal || !closeReason) return
    const leadId = closeModal.leadId
    const lead = leads.find(l => l.id === leadId)
    const notes = closeNotes.trim() || undefined
    setCloseModal(null)
    setUpdatingStatusId(leadId)
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'closed', closed_reason: closeReason, closed_notes: notes ?? null } : l))
    const { error } = await updateLeadStatus(leadId, 'closed', closeReason, notes)
    if (error) {
      if (lead) setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: lead.status, closed_reason: lead.closed_reason, closed_notes: lead.closed_notes } : l))
      showToast('Failed to close lead')
    } else {
      showToast(closeReason === 'leased' ? '🏠 Leased — congrats!' : 'Lead closed')
    }
    setUpdatingStatusId(null)
  }

  const sendReminder = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation()
    setRemindingId(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-reminder`, { method: 'POST' })
      if (res.ok) showToast(`Reminder sent to ${lead.first_name || lead.email}`)
      else showToast('Failed to send reminder')
    } catch { showToast('Failed to send reminder') }
    setRemindingId(null)
  }

  const handleUnlockSuccess = (unlockType: string) => {
    if (unlockType === 'subscription') {
      setHasPlan(true)
    } else if (unlockModalLeadId) {
      setUnlockedIds(prev => new Set([...prev, unlockModalLeadId]))
    }
    setUnlockModalLeadId(null)
    showToast('Lead unlocked!')
  }

  const handleCopy = (e: React.MouseEvent, key: string, value: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    })
  }

  const handleAddLead = async () => {
    if (!addForm.first_name || !addForm.email || !addForm.property) return
    setAddingLead(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      if (res.ok) {
        const targetProp = addForm.property
        setShowAddModal(false)
        setAddForm({ first_name: '', last_name: '', email: '', phone: '', property: '', move_in_date: nextFirstOfMonth() })
        // Jump to the new lead's property so it's visible; reload if already active.
        if (targetProp && targetProp !== propertyFilter) setPropertyFilter(targetProp)
        else await loadLeadsFor(propertyFilter ?? (properties[0]?.slug ?? 'all'))
        showToast('Lead added + pre-screen email sent!')
      } else showToast('Failed to add lead')
    } catch { showToast('Failed to add lead') }
    setAddingLead(false)
  }

  // Deduplicate grouped leads (roommate groups) then same-email duplicates
  const { displayLeads, groupCountById, dupCountById } = (() => {
    // Pass 1: collapse roommate groups (lead_group_id + property)
    const seenGroups = new Set<string>()
    const groupCounts: Record<string, number> = {}
    for (const l of leads) {
      if (l.lead_group_id && l.property) {
        const k = `${l.lead_group_id}:${l.property}`
        groupCounts[k] = (groupCounts[k] || 0) + 1
      }
    }
    const afterGroups: Lead[] = []
    const countById: Record<string, number> = {}
    // leads is sorted newest-first; reverse so oldest processes first, newest survives
    for (const l of [...leads].reverse()) {
      const k = l.lead_group_id && l.property ? `${l.lead_group_id}:${l.property}` : null
      if (k) { if (seenGroups.has(k)) continue; seenGroups.add(k) }
      afterGroups.push(l)
      countById[l.id] = k ? (groupCounts[k] || 1) : 1
    }
    // afterGroups is now oldest-first; reverse back to newest-first
    afterGroups.reverse()

    // Pass 2: collapse same email + property (repeat submissions)
    const emailPropCounts: Record<string, number> = {}
    for (const l of afterGroups) {
      const k = `${(l.email || '').toLowerCase()}:${l.property || ''}`
      emailPropCounts[k] = (emailPropCounts[k] || 0) + 1
    }
    const seenEmailProp = new Set<string>()
    const finalDisplay: Lead[] = []
    const dupCounts: Record<string, number> = {}
    for (const l of afterGroups) {
      const k = `${(l.email || '').toLowerCase()}:${l.property || ''}`
      if (seenEmailProp.has(k)) continue
      seenEmailProp.add(k)
      finalDisplay.push(l)
      dupCounts[l.id] = emailPropCounts[k] || 1
    }

    return { displayLeads: finalDisplay, groupCountById: countById, dupCountById: dupCounts }
  })()

  const getScore = (lead: Lead) => {
    const price = properties.find(p => p.slug === lead.property)?.price ?? null
    return computeScore(lead, prescreenMap[lead.id] ?? null, price)
  }

  const sortedLeads = [...displayLeads].sort((a, b) => {
    const rank = (l: Lead) => isLeadVisible(l) ? 0 : freeLeadIds.has(l.id) ? 1 : 2
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    const aClosed = a.status === 'closed', bClosed = b.status === 'closed'
    if (aClosed !== bClosed) return aClosed ? 1 : -1
    if (sortBy === 'date') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    return getScore(b) - getScore(a)
  })

  const filteredLeads = sortedLeads.filter(l => {
    if (statusFilter !== 'all') {
      const effectiveStatus = l.status === 'tour_scheduled' ? 'qualified' : l.status
      if (effectiveStatus !== statusFilter) return false
    }
    const activePropFilter = propertyFilter ?? (properties[0]?.slug ?? 'all')
    if (activePropFilter !== 'all' && l.property !== activePropFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (isLeadVisible(l)) {
        if (!((l.first_name || '').toLowerCase().includes(q) ||
              (l.last_name || '').toLowerCase().includes(q) ||
              (l.email || '').toLowerCase().includes(q) ||
              (l.property || '').toLowerCase().includes(q))) return false
      } else {
        if (!(l.property || '').toLowerCase().includes(q)) return false
      }
    }
    return true
  })

  const PAGE_SIZE = 25
  const visibleFiltered = filteredLeads.filter(l => isLeadVisible(l))
  const lockedFiltered = filteredLeads.filter(l => !isLeadVisible(l))
  const totalPages = Math.max(1, Math.ceil(visibleFiltered.length / PAGE_SIZE))
  const pagedVisible = visibleFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const counts = PIPELINE_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = displayLeads.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) === s).length
    return acc
  }, {})
  const lockedCount = displayLeads.filter(l => !isLeadVisible(l)).length

  const renderColHeader = (showPropCol: boolean) => (
    <div className="ll-col-hdr">
      <div className="ll-col-hdr-cell">Lead</div>
      <div className="ll-col-hdr-cell ll-hdr-contact">Contact</div>
      <div className="ll-col-hdr-cell ll-hdr-prop">{showPropCol ? 'Property' : 'Move-in'}</div>
      <div className="ll-col-hdr-cell ll-hdr-score ll-sort-hdr" style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setSortBy('score')}
        title="Sort by score">
        Score {sortBy === 'score' ? <span style={{ color: '#8C1D40' }}>↓</span> : <span style={{ opacity: 0.3 }}>↕</span>}
      </div>
      <div className="ll-col-hdr-cell ll-hdr-age ll-sort-hdr" style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setSortBy('date')}
        title="Sort by newest">
        Age {sortBy === 'date' ? <span style={{ color: '#8C1D40' }}>↓</span> : <span style={{ opacity: 0.3 }}>↕</span>}
      </div>
      <div className="ll-col-hdr-cell">Status</div>
      <div className="ll-col-hdr-cell" style={{ textAlign: 'right' }}>Actions</div>
    </div>
  )

  const renderLeadCard = (lead: Lead, hasBorder: boolean, showPropName: boolean) => {
    const heat = getHeat(lead.created_at)
    const effectiveStatus = lead.status === 'tour_scheduled' ? 'qualified' : lead.status
    const meta = STATUS_META[effectiveStatus] ?? STATUS_META.new
    const hasToured = lead.toured || lead.status === 'tour_scheduled'
    const hasPrescreen = ['qualified', 'matching', 'cold', 'closed', 'tour_scheduled'].includes(lead.status)
    const upcomingTourDate = tourMap[lead.id]
    const needsRemind = ['new', 'contacted', 'follow_up', 'engaged'].includes(lead.status)
    const isCold = effectiveStatus === 'cold'
    const prop = properties.find(p => p.slug === lead.property)
    const phone = formatPhoneDisplay(lead.phone)
    const urg = urgencyOf(lead)
    const accentColor = isCold ? '#94a3b8' : urg === 'urgent' ? '#ef4444' : urg === 'hot' ? '#10b981' : urg === 'warm' ? '#f97316' : meta.color
    const score = getScore(lead)
    const sc = scoreColor(score)
    const gc = groupCountById[lead.id] || 1
    const dc = dupCountById[lead.id] || 1

    return (
      <div
        key={lead.id}
        className="ll-lead-card"
        style={{
          borderLeft: `3px solid ${isCold ? '#e2e8f0' : accentColor}`,
          borderBottom: hasBorder ? '1px solid #f0ede6' : 'none',
          opacity: isCold ? 0.75 : 1,
        }}
        onClick={() => window.open(`/landlord/leads/${lead.id}`, '_blank')}
      >
        {/* COL 1: Avatar + Name + badges */}
        <div className="ll-lead-cell" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: isCold ? '#94a3b8' : '#8C1D40', color: isCold ? '#fff' : '#FFC627', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, letterSpacing: 0.5 }}>
            {initials(lead.first_name, lead.last_name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
              </span>
              {heat.icon && <span title={heat.label} style={{ fontSize: 11 }}>{heat.icon}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
              {gc > 1 && (
                <span style={{ fontSize: 9, fontWeight: 700, color: '#8b5cf6', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                  ×{gc} group
                </span>
              )}
              {dc > 1 && (
                <span title={`${dc} submissions from this email`} style={{ fontSize: 9, fontWeight: 700, color: '#f97316', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 8, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                  {dc}× submitted
                </span>
              )}
              {urg === 'urgent' && !isCold && (
                <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', background: '#fef2f2', borderRadius: 8, padding: '1px 5px', whiteSpace: 'nowrap' }}>⚠ Action</span>
              )}
            </div>
          </div>
        </div>

        {/* COL 2: Email + Phone */}
        <div className="ll-lead-cell ll-cell-contact">
          <div className="ll-contact-row">
            <span className="ll-contact-txt" style={{ fontSize: 12, color: '#3a3a3a' }}>{lead.email}</span>
            <span className="ll-copy-wrap">
              {copiedKey === `${lead.id}:email` && <span className="ll-copy-pop">Copied!</span>}
              <button className={`ll-copy-btn${copiedKey === `${lead.id}:email` ? ' copied' : ''}`}
                onClick={e => handleCopy(e, `${lead.id}:email`, lead.email)} title="Copy email">
                {copiedKey === `${lead.id}:email`
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9b9b9b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
              </button>
            </span>
          </div>
          <div className="ll-contact-row">
            {phone ? (
              <>
                <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="ll-contact-txt" style={{ fontSize: 12, color: '#6b9af0', textDecoration: 'none' }}>+1 {phone}</a>
                <span className="ll-copy-wrap">
                  {copiedKey === `${lead.id}:phone` && <span className="ll-copy-pop">Copied!</span>}
                  <button className={`ll-copy-btn${copiedKey === `${lead.id}:phone` ? ' copied' : ''}`}
                    onClick={e => handleCopy(e, `${lead.id}:phone`, phone)} title="Copy phone">
                    {copiedKey === `${lead.id}:phone`
                      ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b9af0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
                  </button>
                </span>
              </>
            ) : (
              <span className="ll-contact-txt" style={{ fontSize: 11, color: '#d1d5db' }}>No phone</span>
            )}
          </div>
        </div>

        {/* COL 3: Property (or move-in if grouped) */}
        <div className="ll-lead-cell ll-cell-prop">
          {showPropName && prop ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prop.name}</div>
              {lead.move_in_date && <div style={{ fontSize: 11, color: '#b0a898', marginTop: 1 }}>{lead.move_in_date}</div>}
            </>
          ) : (
            <div style={{ fontSize: 11, color: '#b0a898' }}>{lead.move_in_date || '—'}</div>
          )}
        </div>

        {/* COL 4: Score + signals */}
        <div className="ll-lead-cell ll-cell-score" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: isCold ? '#94a3b8' : sc.color, background: isCold ? 'rgba(148,163,184,0.1)' : sc.bg, borderRadius: 6, padding: '2px 6px', display: 'inline-block', lineHeight: 1.3 }}>
            {isCold ? '—' : score}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
            {hasPrescreen && <span style={{ fontSize: 9, fontWeight: 700, color: '#10b981' }} title="Pre-screened">✓S</span>}
            {hasToured && <span style={{ fontSize: 9, fontWeight: 700, color: '#8b5cf6' }} title="Toured">✓T</span>}
            {upcomingTourDate && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#0ea5e9' }} title={`Tour: ${upcomingTourDate}`}>
                📅{new Date(upcomingTourDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
            {!hasPrescreen && !hasToured && !upcomingTourDate && (
              <span style={{ fontSize: 9, color: '#d4d0c8' }}>—</span>
            )}
          </div>
        </div>

        {/* COL 6: Age */}
        <div className="ll-lead-cell ll-cell-age" style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 11, color: urg === 'urgent' && !isCold ? '#ef4444' : '#b0a898', fontWeight: urg === 'urgent' && !isCold ? 600 : 400 }}>
            {timeAgo(lead.created_at)}
          </span>
        </div>

        {/* COL 7: Status select */}
        <div className="ll-lead-cell" onClick={e => e.stopPropagation()}>
          <select
            className="ll-status-select"
            value={effectiveStatus}
            disabled={updatingStatusId === lead.id}
            onChange={e => handleStatusChange(lead, e.target.value as Lead['status'])}
            style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
          >
            {STATUS_SELECT_ORDER.map(s => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>
        </div>

        {/* COL 8: Actions */}
        <div className="ll-lead-cell" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          {needsRemind && (
            <button className="ll-action-btn" style={{ color: '#8C1D40', borderColor: '#f4c9d5', background: '#fdf2f5' }}
              disabled={remindingId === lead.id} onClick={e => sendReminder(lead, e)}>
              {remindingId === lead.id ? '…' : '📧'}
            </button>
          )}
          <button className="ll-action-btn" style={{ color: '#3a3a3a', borderColor: '#e8e5de', background: '#fff' }}
            onClick={() => window.open(`/landlord/leads/${lead.id}`, '_blank')}>
            View →
          </button>
        </div>
      </div>
    )
  }

  const renderLockedSection = (lockedLeads: Lead[]) => (
    <>
      <div style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1118 100%)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderTop: '2px solid #e8e5de' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 3 }}>🔒 {lockedLeads.length} lead{lockedLeads.length !== 1 ? 's' : ''} locked</div>
          <div style={{ color: '#9b9b9b', fontSize: 11 }}>
            <span style={{ color: '#FFC627', fontWeight: 600 }}>$29.99/mo</span> · <span style={{ color: '#FFC627', fontWeight: 600 }}>$1.99</span> per lead
          </div>
        </div>
        <button onClick={() => setUnlockModalLeadId(lockedLeads[0].id)}
          style={{ background: '#FFC627', color: '#1a1a1a', border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
          Unlock Leads →
        </button>
      </div>
      {lockedLeads.slice(0, 3).map(lead => (
        <div key={lead.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid #f0ede6', background: '#fafaf8', borderLeft: '3px solid #e0ddd7' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#d4d0c8', flexShrink: 0, filter: 'blur(3px)' }} />
          <div style={{ flex: 1, filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
            <div style={{ width: 90, height: 12, background: '#e0ddd7', borderRadius: 3, marginBottom: 4 }} />
            <div style={{ width: 140, height: 10, background: '#e0ddd7', borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 11, color: '#b0a898' }}>{timeAgo(lead.created_at)}</div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_META[lead.status]?.color || '#9b9b9b', background: STATUS_META[lead.status]?.bg, border: `1px solid ${STATUS_META[lead.status]?.border}`, borderRadius: 20, padding: '2px 9px' }}>
              {STATUS_META[lead.status]?.label || lead.status}
            </span>
          </div>
          <button className="ll-unlock-btn" onClick={() => setUnlockModalLeadId(lead.id)}>🔒 Unlock</button>
        </div>
      ))}
      {lockedLeads.length > 3 && (
        <div style={{ padding: '9px 16px', background: '#f7f6f3', textAlign: 'center', borderTop: '1px dashed #e0ddd7' }}>
          <span style={{ fontSize: 12, color: '#9b9b9b' }}>+{lockedLeads.length - 3} more — </span>
          <button onClick={() => setUnlockModalLeadId(lockedLeads[0].id)} style={{ background: 'none', border: 'none', color: '#8C1D40', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0 }}>
            unlock all →
          </button>
        </div>
      )}
    </>
  )

  if (!loading && properties.length === 0) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 20px', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📭</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>No listings yet</div>
        <a href="/landlord/listings/new" style={{ display: 'inline-block', background: '#8C1D40', color: '#fff', padding: '12px 28px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          Create a listing →
        </a>
      </div>
    )
  }

  return (
    <>
      <style suppressHydrationWarning>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .ll-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        /* Nav */
        .ll-subnav { background: #fff; border-bottom: 1px solid #e8e5de; padding: 0 24px; display: flex; align-items: center; gap: 0; }
        .ll-subnav-link { padding: 13px 16px; font-size: 13px; font-weight: 500; color: #6b6b6b; text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; transition: color 0.12s; }
        .ll-subnav-link:hover { color: #1a1a1a; }
        .ll-subnav-link.active { color: #8C1D40; font-weight: 700; border-bottom-color: #8C1D40; }
        .ll-subnav-right { margin-left: auto; display: flex; align-items: center; gap: 8px; padding: 8px 0; }

        /* Stats bar */
        .ll-stats { background: #fff; border-bottom: 1px solid #e8e5de; padding: 8px 24px; display: flex; gap: 4px; overflow-x: auto; align-items: center; }
        .ll-stat-pill { display: flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 20px; border: 1.5px solid #e8e5de; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.12s; white-space: nowrap; background: #fff; }
        .ll-stat-pill:hover { border-color: #d0ccc5; background: #faf9f6; }
        .ll-stat-pill.active { border-color: currentColor; font-weight: 700; }
        .ll-stat-num { font-size: 13px; font-weight: 800; }

        /* Cold separator */
        .ll-cold-sep { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; padding: 0 4px; }

        /* Filters */
        .ll-filters { background: #fff; border-bottom: 1px solid #e8e5de; padding: 8px 24px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .ll-search { padding: 8px 12px 8px 34px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; width: 220px; background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239b9b9b' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") no-repeat 10px center; transition: border-color 0.15s; }
        .ll-search:focus { border-color: #8C1D40; }
        .ll-select { padding: 7px 12px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; background: #fff; color: #1a1a1a; cursor: pointer; }
        .ll-view-toggle { display: flex; background: #f5f4f0; border-radius: 7px; padding: 3px; gap: 2px; margin-left: auto; }
        .ll-view-btn { padding: 5px 12px; border: none; border-radius: 5px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .ll-view-btn.active { background: #fff; color: #1a1a1a; font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .ll-view-btn:not(.active) { background: transparent; color: #9b9b9b; }

        /* Cards */
        .ll-group { margin: 12px 20px 0; }
        .ll-group-hdr { display: flex; align-items: center; gap: 10px; padding: 11px 20px; background: #1a1a1a; border-radius: 10px 10px 0 0; cursor: pointer; user-select: none; }
        .ll-group-hdr.collapsed { border-radius: 10px; }
        .ll-group-hdr:hover { background: #272727; }
        .ll-group-body { background: #fff; border: 1px solid #e8e5de; border-top: none; border-radius: 0 0 10px 10px; overflow: hidden; }
        .ll-flat { margin: 12px 20px 0; background: #fff; border: 1px solid #e8e5de; border-radius: 10px; overflow: hidden; }
        .ll-cold-section { margin: 8px 20px 0; }
        .ll-cold-header { display: flex; align-items: center; gap: 8px; padding: 7px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px 8px 0 0; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; }
        .ll-cold-body { background: #fff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; overflow: hidden; }

        /* Table-grid lead row */
        .ll-col-hdr { display: grid; grid-template-columns: 1.4fr 1.3fr 130px 82px 60px 170px 120px; align-items: center; gap: 0; padding: 7px 20px; background: #f8f7f4; border-bottom: 1px solid #ece9e2; }
        .ll-col-hdr-cell { font-size: 10px; font-weight: 700; color: #a8a49c; text-transform: uppercase; letter-spacing: 0.6px; white-space: nowrap; }
        .ll-sort-hdr:hover { color: #6b6b6b; }
        .ll-lead-card { display: grid; grid-template-columns: 1.4fr 1.3fr 130px 82px 60px 170px 120px; align-items: center; gap: 0; padding: 10px 20px; cursor: pointer; transition: background 0.1s; position: relative; border-bottom: 1px solid #f2f0ec; }
        .ll-lead-card:last-child { border-bottom: none; }
        .ll-lead-card:hover { background: #faf9f6; }
        .ll-lead-cell { padding: 0 14px 0 0; min-width: 0; overflow: hidden; }
        .ll-cell-contact { display: flex; flex-direction: column; gap: 2px; }
        .ll-contact-row { display: flex; align-items: center; width: 100%; }
        .ll-contact-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @media (max-width: 1200px) {
          .ll-col-hdr { grid-template-columns: 1.4fr 1.3fr 110px 82px 170px 110px; }
          .ll-col-hdr .ll-hdr-age { display: none; }
          .ll-lead-card { grid-template-columns: 1.4fr 1.3fr 110px 82px 170px 110px; }
          .ll-cell-age { display: none; }
        }
        @media (max-width: 960px) {
          .ll-col-hdr { grid-template-columns: 1.4fr 1.3fr 82px 170px 110px; }
          .ll-col-hdr .ll-hdr-prop, .ll-col-hdr .ll-hdr-age { display: none; }
          .ll-lead-card { grid-template-columns: 1.4fr 1.3fr 82px 170px 110px; }
          .ll-cell-prop, .ll-cell-age { display: none; }
        }
        @media (max-width: 720px) {
          .ll-col-hdr { grid-template-columns: 1fr 1fr auto auto; }
          .ll-col-hdr .ll-hdr-score, .ll-col-hdr .ll-hdr-prop, .ll-col-hdr .ll-hdr-age { display: none; }
          .ll-lead-card { grid-template-columns: 1fr 1fr auto auto; }
          .ll-cell-score, .ll-cell-prop, .ll-cell-age { display: none; }
        }
        @media (max-width: 520px) {
          .ll-col-hdr { display: none; }
          .ll-lead-card { grid-template-columns: 1fr auto auto; gap: 8px; }
          .ll-cell-contact, .ll-cell-score, .ll-cell-prop, .ll-cell-age { display: none; }
        }

        .ll-copy-wrap { position: relative; display: inline-flex; align-items: center; flex-shrink: 0; }
        .ll-copy-pop { position: absolute; bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 5px; white-space: nowrap; pointer-events: none; z-index: 20; animation: copyPopIn 0.15s ease; }
        .ll-copy-pop::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 4px solid transparent; border-top-color: #1a1a1a; }
        @keyframes copyPopIn { from { opacity: 0; transform: translateX(-50%) translateY(3px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        .ll-copy-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: none; cursor: pointer; padding: 2px 4px; border-radius: 4px; flex-shrink: 0; opacity: 0; transition: opacity 0.12s, background 0.12s; vertical-align: middle; }
        .ll-lead-card:hover .ll-copy-btn { opacity: 0.45; }
        .ll-copy-btn:hover { background: #e8e5de; opacity: 1 !important; }
        .ll-copy-btn.copied { opacity: 1 !important; }
        .ll-unlock-btn { padding: 5px 10px; border-radius: 6px; border: 1.5px solid #FFC627; font-size: 11px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; background: rgba(255,198,39,0.08); color: #b07a00; white-space: nowrap; transition: all 0.15s; }
        .ll-unlock-btn:hover { background: rgba(255,198,39,0.18); }
        .ll-action-btn { padding: 5px 10px; border-radius: 6px; border: 1.5px solid; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; }
        .ll-status-select { width: 100%; padding: 6px 26px 6px 10px; border-radius: 7px; font-size: 12px; font-weight: 600; border: 1.5px solid; cursor: pointer; font-family: 'DM Sans', sans-serif; outline: none; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 8px center; }
        .ll-status-select:disabled { opacity: 0.55; cursor: not-allowed; }
        .ll-prescreen-hint { font-size: 10px; margin-top: 3px; font-weight: 600; }

        /* Pipeline */
        .ll-pipeline { padding: 16px 24px; display: flex; gap: 10px; overflow-x: auto; }
        .ll-pcol { flex-shrink: 0; width: 200px; background: #fff; border-radius: 12px; border-top: 3px solid; overflow: hidden; }
        .ll-pcol-header { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0ede6; }
        .ll-pcol-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
        .ll-pcol-count { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .ll-pcard { margin: 8px 8px 0; padding: 10px 12px; border: 1px solid #f0ede6; border-radius: 8px; cursor: pointer; transition: box-shadow 0.15s; }
        .ll-pcard:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .ll-pcard:last-child { margin-bottom: 8px; }

        /* Pagination */
        .ll-pagination { display: flex; align-items: center; justify-content: space-between; padding: 10px 24px 0; }
        .ll-page-btn { padding: 5px 12px; border: 1.5px solid #e8e5de; border-radius: 6px; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #4a4a4a; transition: all 0.15s; }
        .ll-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .ll-page-btn:not(:disabled):hover { border-color: #8C1D40; color: #8C1D40; }

        /* Misc */
        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-gold { background: #FFC627; color: #1a1a1a; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .btn-gold:hover { opacity: 0.9; }
        .btn-ghost { background: transparent; color: #9b9b9b; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #8C1D40; color: #8C1D40; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(2px); }
        .modal-card { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto; }
        .field-label { font-size: 12px; font-weight: 700; color: #1a1a1a; margin-bottom: 5px; display: block; }
        .field-input { width: 100%; padding: 10px 13px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
        .field-input:focus { border-color: #8C1D40; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .field-col { display: flex; flex-direction: column; margin-bottom: 14px; }
        .ll-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      <div className="ll-page">
        {toast && <div className="ll-toast">✓ {toast}</div>}

        {/* Sub-nav */}
        <div className="ll-subnav">
          <a href="/landlord/leads" className="ll-subnav-link">Overview</a>
          <a href="/landlord/leads/insights" className="ll-subnav-link">Insights</a>
          <a href="/landlord/leads/list" className="ll-subnav-link active">All Leads</a>
          <div className="ll-subnav-right">
            {lockedCount > 0 && (
              <span style={{ fontSize: 11, color: '#FFC627', fontWeight: 600, background: 'rgba(255,198,39,0.12)', border: '1px solid rgba(255,198,39,0.3)', borderRadius: 20, padding: '3px 10px' }}>
                🔒 {lockedCount} locked
              </span>
            )}
            <button className="btn-gold" style={{ padding: '7px 14px', fontSize: 12 }} onClick={() => setShowAddModal(true)}>+ Add Lead</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 24 }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} style={{ height: 64, borderRadius: 10, marginBottom: 8, background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
            ))}
          </div>
        ) : (
          <>
            {/* Stats bar — pipeline pills */}
            <div className="ll-stats">
              <button
                className={`ll-stat-pill${statusFilter === 'all' ? ' active' : ''}`}
                style={{ color: statusFilter === 'all' ? '#1a1a1a' : '#6b6b6b' }}
                onClick={() => setStatusFilter('all')}
              >
                <span className="ll-stat-num">{displayLeads.filter(l => l.status !== 'closed').length}</span>
                <span>Active</span>
              </button>
              {['new', 'contacted', 'follow_up', 'engaged', 'qualified'].map(s => {
                const cnt = counts[s] || 0
                if (cnt === 0 && statusFilter !== s) return null
                const meta = STATUS_META[s]
                return (
                  <button
                    key={s}
                    className={`ll-stat-pill${statusFilter === s ? ' active' : ''}`}
                    style={{ color: meta.color, borderColor: statusFilter === s ? meta.color : '#e8e5de' }}
                    onClick={() => setStatusFilter(statusFilter === s ? 'all' : s as Lead['status'])}
                  >
                    <span className="ll-stat-num" style={{ color: meta.color }}>{cnt}</span>
                    <span style={{ color: '#6b6b6b' }}>{meta.label}</span>
                  </button>
                )
              })}
              {/* Roommate Matching — always visible */}
              <button
                className={`ll-stat-pill${statusFilter === 'matching' ? ' active' : ''}`}
                style={{ color: '#8b5cf6', borderColor: statusFilter === 'matching' ? '#8b5cf6' : '#e8e5de' }}
                onClick={() => setStatusFilter(statusFilter === 'matching' ? 'all' : 'matching')}
                title="Leads being paired with roommates"
              >
                <span className="ll-stat-num" style={{ color: '#8b5cf6' }}>{counts['matching'] || 0}</span>
                <span style={{ color: '#6b6b6b' }}>Roommate Match</span>
              </button>
              {/* Cold separator */}
              {(counts['cold'] || 0) > 0 && (
                <>
                  <span className="ll-cold-sep">·</span>
                  <button
                    className={`ll-stat-pill${statusFilter === 'cold' ? ' active' : ''}`}
                    style={{ color: '#64748b', borderColor: statusFilter === 'cold' ? '#64748b' : '#e8e5de', opacity: 0.8 }}
                    onClick={() => setStatusFilter(statusFilter === 'cold' ? 'all' : 'cold')}
                  >
                    <span className="ll-stat-num">{counts['cold']}</span>
                    <span style={{ color: '#94a3b8' }}>Cold</span>
                  </button>
                </>
              )}
              <button
                className={`ll-stat-pill${statusFilter === 'closed' ? ' active' : ''}`}
                style={{ color: '#6b7280', borderColor: statusFilter === 'closed' ? '#6b7280' : '#e8e5de', marginLeft: 4 }}
                onClick={() => setStatusFilter(statusFilter === 'closed' ? 'all' : 'closed')}
              >
                <span className="ll-stat-num">{counts['closed'] || 0}</span>
                <span style={{ color: '#94a3b8' }}>Closed</span>
              </button>
            </div>

            {/* Filters */}
            <div className="ll-filters">
              <input className="ll-search" placeholder="Search name, email, property…" value={search} onChange={e => setSearch(e.target.value)} />
              {statusFilter !== 'all' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: STATUS_META[statusFilter]?.bg, border: `1.5px solid ${STATUS_META[statusFilter]?.border}`, borderRadius: 20, padding: '4px 10px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_META[statusFilter]?.color }}>{STATUS_META[statusFilter]?.label}</span>
                  <button onClick={() => setStatusFilter('all')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: STATUS_META[statusFilter]?.color, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              )}
              {properties.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {properties.map(p => {
                    const isActive = (propertyFilter ?? properties[0]?.slug) === p.slug
                    const propLeadCount = displayLeads.filter(l => l.property === p.slug && l.status !== 'closed').length
                    return (
                      <button
                        key={p.slug}
                        onClick={() => setPropertyFilter(isActive && properties.length > 1 ? 'all' : p.slug)}
                        style={{
                          padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${isActive ? '#8C1D40' : '#e8e5de'}`,
                          background: isActive ? '#fdf2f5' : '#fff', color: isActive ? '#8C1D40' : '#6b6b6b',
                          fontSize: 12, fontWeight: isActive ? 700 : 500, cursor: 'pointer',
                          fontFamily: "'DM Sans', sans-serif", transition: 'all 0.12s', whiteSpace: 'nowrap',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        {propLeadCount > 0 && (
                          <span style={{ background: isActive ? '#8C1D40' : '#e8e5de', color: isActive ? '#fff' : '#6b6b6b', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                            {propLeadCount}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {properties.length > 1 && (propertyFilter ?? properties[0]?.slug) !== 'all' && (
                    <button
                      onClick={() => setPropertyFilter('all')}
                      style={{ padding: '5px 10px', borderRadius: 20, border: '1.5px solid #e8e5de', background: '#fff', color: '#9b9b9b', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                    >
                      All
                    </button>
                  )}
                </div>
              )}
              <div className="ll-view-toggle">
                <button className={`ll-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>≡ List</button>
                <button className={`ll-view-btn${viewMode === 'pipeline' ? ' active' : ''}`} onClick={() => setViewMode('pipeline')}>⊞ Pipeline</button>
              </div>
            </div>

            {/* Empty state */}
            {filteredLeads.length === 0 && (
              <div style={{ padding: '60px 28px', display: 'flex', justifyContent: 'center' }}>
                <div style={{ background: '#fff', border: '1px dashed #e8e5de', borderRadius: 16, padding: '48px 40px', maxWidth: 440, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>
                    {search || statusFilter !== 'all' ? 'No matching leads' : 'No leads yet'}
                  </div>
                  <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add First Lead</button>
                </div>
              </div>
            )}

            {/* LIST VIEW */}
            {viewMode === 'list' && filteredLeads.length > 0 && (
              <>
                {(propertyFilter === 'all' || propertyFilter === null) && properties.length > 1 ? (
                  <div style={{ paddingBottom: 20 }}>
                    {properties.map(prop => {
                      const propVisible = visibleFiltered.filter(l => l.property === prop.slug)
                      const propLocked = lockedFiltered.filter(l => l.property === prop.slug)
                      if (propVisible.length === 0 && propLocked.length === 0) return null
                      const urgencyRank = (l: Lead) => {
                        const u = urgencyOf(l)
                        return u === 'urgent' ? 0 : u === 'hot' ? 1 : u === 'warm' ? 2 : 3
                      }
                      // Cold leads go last within group
                      const coldLeads = propVisible.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) === 'cold')
                      const activeLeads = propVisible.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) !== 'cold')
                        .sort((a, b) => urgencyRank(a) - urgencyRank(b))
                      const urgentCnt = propVisible.filter(l => urgencyOf(l) === 'urgent').length
                      const hotCnt = propVisible.filter(l => urgencyOf(l) === 'hot').length
                      const newCnt = propVisible.filter(l => l.status === 'new').length
                      const isCollapsed = collapsedProps.has(prop.slug)
                      return (
                        <div key={prop.slug} className="ll-group">
                          <div className={`ll-group-hdr${isCollapsed ? ' collapsed' : ''}`}
                            onClick={() => setCollapsedProps(prev => {
                              const next = new Set(prev)
                              if (next.has(prop.slug)) next.delete(prop.slug); else next.add(prop.slug)
                              return next
                            })}>
                            <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prop.name}</span>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                              {urgentCnt > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.15)', borderRadius: 10, padding: '2px 8px' }}>{urgentCnt} urgent</span>}
                              {hotCnt > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.15)', borderRadius: 10, padding: '2px 8px' }}>{hotCnt} hot</span>}
                              {newCnt > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd', background: 'rgba(59,130,246,0.15)', borderRadius: 10, padding: '2px 8px' }}>{newCnt} new</span>}
                              {coldLeads.length > 0 && <span style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(100,116,139,0.1)', borderRadius: 10, padding: '2px 8px' }}>❄ {coldLeads.length}</span>}
                              {propLocked.length > 0 && <span style={{ fontSize: 11, color: '#9b9b9b' }}>🔒 {propLocked.length}</span>}
                              <span style={{ color: '#9b9b9b', fontSize: 16, lineHeight: 1, display: 'inline-block', transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>⌄</span>
                            </div>
                          </div>
                          {!isCollapsed && (
                            <div className="ll-group-body">
                              {renderColHeader(false)}
                              {activeLeads.map((lead, i) => renderLeadCard(lead, i < activeLeads.length - 1 || coldLeads.length > 0 || propLocked.length > 0, false))}
                              {coldLeads.length > 0 && (
                                <>
                                  <div style={{ padding: '6px 16px', background: '#f8fafc', borderTop: activeLeads.length > 0 ? '1px dashed #e2e8f0' : 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    ❄ Cold — no recent activity
                                  </div>
                                  {coldLeads.map((lead, i) => renderLeadCard(lead, i < coldLeads.length - 1 || propLocked.length > 0, false))}
                                </>
                              )}
                              {propLocked.length > 0 && renderLockedSection(propLocked)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <>
                    <div className="ll-flat">
                      {renderColHeader(properties.length > 1)}
                      {pagedVisible.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) !== 'cold').map((lead, i, arr) => renderLeadCard(lead, i < arr.length - 1, properties.length > 1))}
                      {pagedVisible.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) === 'cold').length > 0 && (
                        <>
                          <div style={{ padding: '6px 16px', background: '#f8fafc', borderTop: '1px dashed #e2e8f0', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            ❄ Cold — no recent activity
                          </div>
                          {pagedVisible.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) === 'cold').map((lead, i, arr) => renderLeadCard(lead, i < arr.length - 1, properties.length > 1))}
                        </>
                      )}
                      {lockedFiltered.length > 0 && renderLockedSection(lockedFiltered)}
                    </div>
                    {totalPages > 1 && (
                      <div className="ll-pagination">
                        <span style={{ fontSize: 12, color: '#9b9b9b' }}>{(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, visibleFiltered.length)} of {visibleFiltered.length}</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button className="ll-page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                          <span style={{ fontSize: 12, color: '#6b6b6b', fontWeight: 600 }}>Page {page} of {totalPages}</span>
                          <button className="ll-page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* PIPELINE VIEW */}
            {viewMode === 'pipeline' && filteredLeads.length > 0 && (
              <div className="ll-pipeline">
                {PIPELINE_ORDER.map(status => {
                  const meta = STATUS_META[status]
                  const colLeads = filteredLeads.filter(l => (l.status === 'tour_scheduled' ? 'qualified' : l.status) === status && isLeadVisible(l))
                  const isColdCol = status === 'cold'
                  return (
                    <div key={status} className="ll-pcol" style={{ borderTopColor: meta.color, opacity: isColdCol ? 0.75 : 1 }}>
                      <div className="ll-pcol-header">
                        <span className="ll-pcol-label" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="ll-pcol-count" style={{ background: meta.color }}>{colLeads.length}</span>
                      </div>
                      {colLeads.length === 0 && <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 12, color: '#c5c1b8' }}>—</div>}
                      {colLeads.map(lead => {
                        const heat = getHeat(lead.created_at)
                        const hasToured = lead.toured || lead.status === 'tour_scheduled'
                        const prop = properties.find(p => p.slug === lead.property)
                        return (
                          <div key={lead.id} className="ll-pcard" onClick={() => window.open(`/landlord/leads/${lead.id}`, '_blank')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {initials(lead.first_name, lead.last_name)}
                              </div>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>
                                  {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                                  {heat.icon && <span style={{ marginLeft: 3 }}>{heat.icon}</span>}
                                </div>
                                {hasToured && <div style={{ fontSize: 10, color: '#0ea5e9', fontWeight: 600 }}>📅 Toured</div>}
                              </div>
                            </div>
                            {prop && <div style={{ fontSize: 11, color: '#6b6b6b', fontWeight: 500, marginBottom: 3 }}>{prop.name}</div>}
                            <div style={{ fontSize: 10, color: '#b0a898' }}>{timeAgo(lead.created_at)}</div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}

            <div style={{ height: 32 }} />
          </>
        )}
      </div>

      {/* CLOSE REASON MODAL */}
      {closeModal && (
        <div className="modal-overlay" onClick={() => setCloseModal(null)}>
          <div className="modal-card" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>Close this lead</div>
            <div style={{ fontSize: 13, color: '#9b9b9b', marginBottom: 20 }}>What was the outcome?</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {([
                { value: 'leased',              icon: '🏠', label: 'Leased Here' },
                { value: 'found_another_place', icon: '🔑', label: 'Found Another Place' },
                { value: 'unresponsive',        icon: '👻', label: 'Went Dark' },
                { value: 'budget_mismatch',     icon: '💸', label: 'Budget Mismatch' },
                { value: 'not_qualified',       icon: '🚫', label: "Didn't Qualify" },
                { value: 'other',               icon: '📝', label: 'Other' },
              ] as { value: Lead['closed_reason']; icon: string; label: string }[]).map(opt => (
                <button key={opt.value} onClick={() => setCloseReason(opt.value)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', border: `1.5px solid ${closeReason === opt.value ? '#8C1D40' : '#e8e5de'}`, borderRadius: 9, background: closeReason === opt.value ? '#fdf2f5' : '#fff', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", textAlign: 'left', transition: 'all 0.12s' }}>
                  <span style={{ fontSize: 18 }}>{opt.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: closeReason === opt.value ? '#8C1D40' : '#1a1a1a', lineHeight: 1.3 }}>{opt.label}</span>
                </button>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
                Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea
                placeholder="Any context about why this lead closed — visible only to you."
                value={closeNotes}
                onChange={e => setCloseNotes(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e8e5de', borderRadius: 8, fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none', resize: 'vertical', boxSizing: 'border-box', color: '#1a1a1a', background: '#faf9f6', lineHeight: 1.5 }}
                onFocus={e => { e.currentTarget.style.borderColor = '#8C1D40'; e.currentTarget.style.background = '#fff' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e8e5de'; e.currentTarget.style.background = '#faf9f6' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setCloseModal(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 2 }} disabled={!closeReason} onClick={handleCloseWithReason}>
                Close Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD LEAD MODAL */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>Add Lead Manually</div>
                <div style={{ fontSize: 13, color: '#9b9b9b', marginTop: 4 }}>Pre-screen invite will be emailed automatically.</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9b9b9b' }} onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className="field-row">
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">First Name *</label>
                <input className="field-input" placeholder="Jordan" value={addForm.first_name} onChange={e => setAddForm(f => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Last Name</label>
                <input className="field-input" placeholder="Lee" value={addForm.last_name} onChange={e => setAddForm(f => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="field-col" style={{ marginTop: 14 }}>
              <label className="field-label">Email *</label>
              <input className="field-input" type="email" placeholder="tenant@email.com" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="field-row" style={{ marginTop: 14 }}>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Phone</label>
                <PhoneInput value={addForm.phone} onChange={e164 => setAddForm(f => ({ ...f, phone: e164 }))} />
              </div>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Property *</label>
                <select className="field-input" value={addForm.property} onChange={e => setAddForm(f => ({ ...f, property: e.target.value }))}>
                  <option value="">Select property</option>
                  {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field-col" style={{ marginTop: 14 }}>
              <label className="field-label">Move-in</label>
              <input className="field-input" type="date" min={todayISO()} value={addForm.move_in_date} onChange={e => setAddForm(f => ({ ...f, move_in_date: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn-gold" style={{ flex: 2 }} disabled={!addForm.first_name || !addForm.email || !addForm.property || addingLead} onClick={handleAddLead}>
                {addingLead ? 'Adding…' : 'Add Lead + Send Pre-screen →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {unlockModalLeadId && (
        <UnlockModal leadId={unlockModalLeadId} onSuccess={handleUnlockSuccess} onClose={() => setUnlockModalLeadId(null)} />
      )}
    </>
  )
}
