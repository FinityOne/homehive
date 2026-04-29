'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getLeadsForSlugs, updateLeadStatus } from '@/lib/leads'
import type { Lead } from '@/lib/leads'
import { usePostHog } from 'posthog-js/react'
import PhoneInput, { formatPhoneDisplay } from '@/components/ui/PhoneInput'

const UnlockModal = dynamic(() => import('@/components/leads/UnlockModal'), { ssr: false })

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_ORDER: Lead['status'][] = ['new', 'contacted', 'engaged', 'qualified', 'tour_scheduled', 'closed']

const STATUS_META: Record<Lead['status'], { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',           color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',   border: 'rgba(59,130,246,0.25)' },
  contacted:      { label: 'Contacted',     color: '#f97316', bg: 'rgba(249,115,22,0.08)',   border: 'rgba(249,115,22,0.25)' },
  engaged:        { label: 'Engaged',       color: '#eab308', bg: 'rgba(234,179,8,0.08)',    border: 'rgba(234,179,8,0.3)' },
  qualified:      { label: 'Qualified',     color: '#10b981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.25)' },
  tour_scheduled: { label: 'Tour Sched.',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',   border: 'rgba(139,92,246,0.25)' },
  closed:         { label: 'Closed',        color: '#6b7280', bg: 'rgba(107,114,128,0.08)',  border: 'rgba(107,114,128,0.25)' },
}

function getHeat(createdAt: string | null) {
  if (!createdAt) return { icon: '', color: '#94a3b8', label: '—' }
  const h = (Date.now() - new Date(createdAt).getTime()) / 3600000
  if (h < 24)  return { icon: '🔥', color: '#ef4444', label: '< 24h' }
  if (h < 72)  return { icon: '🌡', color: '#f97316', label: '< 3d' }
  if (h < 168) return { icon: '·',  color: '#eab308', label: '< 7d' }
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

type Property = { slug: string; name: string; address: string }

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

export default function LandlordLeadsPage() {
  const router = useRouter()
  const ph = usePostHog()
  const [userId, setUserId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'list' | 'pipeline'>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Lead['status'] | 'all'>('all')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [toast, setToast] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'leads'>('overview')
  const [emailPreview, setEmailPreview] = useState<{ lead: Lead; subject: string; html: string } | null>(null)

  // Add lead modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ first_name: '', last_name: '', email: '', phone: '', property: '', move_in_date: '' })
  const [addingLead, setAddingLead] = useState(false)

  // Copy to clipboard — key format: `${leadId}:email` or `${leadId}:phone`
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const handleCopy = (e: React.MouseEvent, key: string, value: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    })
  }

  // Reminder sending
  const [remindingId, setRemindingId] = useState<string | null>(null)

  // Inline status change
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [closeModal, setCloseModal] = useState<{ leadId: string } | null>(null)

  // Unlock state
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set())
  const [freeLeadIds, setFreeLeadIds] = useState<Set<string>>(new Set())
  const [unlockModalLeadId, setUnlockModalLeadId] = useState<string | null>(null)
  const [autoUnlockingId, setAutoUnlockingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const isLeadVisible = (lead: Lead) =>
    freeLeadIds.has(lead.id) || unlockedIds.has(lead.id)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
    })
  }, [router])

  const loadLeads = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    // Round 1: fetch properties, unlocks, and plan in parallel — no duplicate fetches
    const [
      { data: propertiesData },
      { data: unlocks },
      { data: plan },
    ] = await Promise.all([
      supabase.from('properties').select('slug, name, address').eq('owner_id', userId),
      supabase.from('lead_unlocks').select('lead_id').eq('landlord_id', userId),
      supabase.from('landlord_plans').select('plan_type, status').eq('landlord_id', userId).eq('status', 'active').maybeSingle(),
    ])

    const props = (propertiesData || []) as Property[]
    setProperties(props)
    const slugs = props.map(p => p.slug).filter(Boolean) as string[]

    if (slugs.length === 0) {
      setLeads([])
      setLoading(false)
      return
    }

    // Round 2: fetch leads using slugs already retrieved
    const leadsData = await getLeadsForSlugs(slugs)
    leadsData.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    setLeads(leadsData)
    setFreeLeadIds(computeFreeLeadIds(leadsData))

    const hasPlan = plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)
    if (hasPlan) {
      setUnlockedIds(new Set(leadsData.map(l => l.id)))
    } else {
      setUnlockedIds(new Set((unlocks || []).map((u: any) => u.lead_id)))
    }

    setLoading(false)
  }, [userId])

  useEffect(() => { loadLeads() }, [loadLeads])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, statusFilter, propertyFilter])

  // Auto-record free unlocks silently
  useEffect(() => {
    if (!userId || freeLeadIds.size === 0) return
    const toAutoUnlock = [...freeLeadIds].filter(id => !unlockedIds.has(id))
    for (const leadId of toAutoUnlock) {
      fetch(`/api/leads/${leadId}/unlock`, { method: 'POST' }).catch(() => {})
    }
  }, [userId, freeLeadIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inline status change ─────────────────────────────────────────────────
  const handleStatusChange = async (lead: Lead, newStatus: Lead['status']) => {
    if (newStatus === lead.status) return
    if (newStatus === 'closed') {
      setCloseModal({ leadId: lead.id })
      return
    }
    setUpdatingStatusId(lead.id)
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: newStatus } : l))
    const { error } = await updateLeadStatus(lead.id, newStatus)
    if (error) {
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: lead.status } : l))
      showToast('Failed to update status')
    } else {
      showToast(`Status → ${STATUS_META[newStatus].label}`)
      ph?.capture('lead_status_changed', { lead_id: lead.id, from: lead.status, to: newStatus })
    }
    setUpdatingStatusId(null)
  }

  const handleCloseWithReason = async (reason: 'leased' | 'lost') => {
    if (!closeModal) return
    const leadId = closeModal.leadId
    setCloseModal(null)
    setUpdatingStatusId(leadId)
    const lead = leads.find(l => l.id === leadId)
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'closed', closed_reason: reason } : l))
    const { error } = await updateLeadStatus(leadId, 'closed', reason)
    if (error) {
      if (lead) setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: lead.status, closed_reason: lead.closed_reason } : l))
      showToast('Failed to update status')
    } else {
      showToast(`Closed · ${reason === 'leased' ? 'Leased ✓' : 'Lost'}`)
    }
    setUpdatingStatusId(null)
  }

  // ── Unlock ────────────────────────────────────────────────────────────────
  const handleUnlockClick = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation()
    if (freeLeadIds.has(lead.id)) {
      setAutoUnlockingId(lead.id)
      try {
        const res = await fetch(`/api/leads/${lead.id}/unlock`, { method: 'POST' })
        const data = await res.json()
        if (data.isUnlocked) {
          setUnlockedIds(prev => new Set([...prev, lead.id]))
          showToast('Lead unlocked!')
        }
      } catch { showToast('Failed to unlock lead') }
      setAutoUnlockingId(null)
      return
    }
    setUnlockModalLeadId(lead.id)
  }

  const handleUnlockSuccess = (unlockType: string) => {
    if (unlockType === 'subscription') {
      setUnlockedIds(new Set(leads.map(l => l.id)))
      showToast('Plan activated! All leads now unlocked.')
    } else if (unlockModalLeadId) {
      setUnlockedIds(prev => new Set([...prev, unlockModalLeadId]))
      showToast('Lead unlocked!')
    }
    setUnlockModalLeadId(null)
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const sortedLeads = [...leads].sort((a, b) => {
    const rank = (l: Lead) => isLeadVisible(l) ? 0 : freeLeadIds.has(l.id) ? 1 : 2
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  })

  const filteredLeads = sortedLeads.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false
    if (propertyFilter !== 'all' && l.property !== propertyFilter) return false
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

  const leadsByStatus = STATUS_ORDER.reduce<Record<string, Lead[]>>((acc, s) => {
    acc[s] = filteredLeads.filter(l => l.status === s)
    return acc
  }, {})

  const counts = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length
    return acc
  }, {})
  const needsPrescreen = leads.filter(l => ['new', 'contacted', 'engaged'].includes(l.status)).length
  const lockedCount = leads.filter(l => !isLeadVisible(l)).length

  const PAGE_SIZE = 10
  const visibleFiltered = filteredLeads.filter(l => isLeadVisible(l))
  const lockedFiltered = filteredLeads.filter(l => !isLeadVisible(l))
  const totalPages = Math.max(1, Math.ceil(visibleFiltered.length / PAGE_SIZE))
  const pagedVisible = visibleFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const sendReminder = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation()
    setRemindingId(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/send-reminder`, { method: 'POST' })
      if (res.ok) {
        showToast(`Reminder sent to ${lead.first_name || lead.email}`)
        ph?.capture('lead_reminder_sent', { lead_id: lead.id, property: lead.property, lead_status: lead.status })
      } else showToast('Failed to send reminder')
    } catch { showToast('Failed to send reminder') }
    setRemindingId(null)
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
        ph?.capture('lead_added_manually', { property: addForm.property })
        setShowAddModal(false)
        setAddForm({ first_name: '', last_name: '', email: '', phone: '', property: '', move_in_date: '' })
        await loadLeads()
        showToast('Lead added + pre-screen email sent!')
      } else {
        showToast('Failed to add lead')
      }
    } catch { showToast('Failed to add lead') }
    setAddingLead(false)
  }

  // ─── Lead scoring ──────────────────────────────────────────────────────────
  function leadScore(lead: Lead): number {
    const statusRank: Record<string, number> = {
      new: 10, contacted: 25, engaged: 45, qualified: 75, tour_scheduled: 90, closed: 0
    }
    const daysOld = (Date.now() - new Date(lead.created_at || 0).getTime()) / 86400000
    const decayFactor = Math.max(0, 1 - daysOld / 30)
    const recencyBoost = daysOld < 2 ? 20 : daysOld < 5 ? 10 : 0
    return Math.min(100, Math.round((statusRank[lead.status] || 0) * decayFactor + recencyBoost))
  }

  // ─── Stale days (using created_at as proxy for last activity) ───────────────
  function staleDays(lead: Lead): number {
    return Math.floor((Date.now() - new Date(lead.created_at || 0).getTime()) / 86400000)
  }

  // ─── Per-property analytics ─────────────────────────────────────────────────
  const propertyAnalytics = properties.map(prop => {
    const propLeads = leads.filter(l => l.property === prop.slug)
    const active = propLeads.filter(l => l.status !== 'closed')
    const byStatus = STATUS_ORDER.reduce((acc, s) => { acc[s] = propLeads.filter(l => l.status === s).length; return acc }, {} as Record<string, number>)
    const qualified = (byStatus.qualified || 0) + (byStatus.tour_scheduled || 0)
    const conversionRate = propLeads.length > 0 ? Math.round((qualified / propLeads.length) * 100) : 0
    const hotLeads = active.filter(l => leadScore(l) >= 50)
    return { slug: prop.slug, name: prop.name, totalLeads: propLeads.length, activeLeads: active.length, byStatus, conversionRate, hotLeadCount: hotLeads.length }
  })

  // ─── Top leads by score ─────────────────────────────────────────────────────
  const topLeads = [...leads]
    .filter(l => l.status !== 'closed' && isLeadVisible(l))
    .map(l => ({ lead: l, score: leadScore(l), days: staleDays(l) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)

  // ─── Suggestion engine ──────────────────────────────────────────────────────
  type Suggestion = {
    id: string
    priority: 'urgent' | 'medium' | 'low'
    emoji: string
    headline: string
    body: string
    lead: Lead
    cta: 'remind' | 'view'
    propName: string
  }

  const suggestions: Suggestion[] = []
  const visibleActiveLeads = leads.filter(l => l.status !== 'closed' && isLeadVisible(l))

  for (const lead of visibleActiveLeads) {
    const days = staleDays(lead)
    const prop = properties.find(p => p.slug === lead.property)
    const propName = prop?.name || lead.property || 'your property'
    const firstName = lead.first_name || 'This lead'

    if (lead.status === 'new' && days >= 1 && days < 3) {
      suggestions.push({ id: lead.id + '_new_warm', priority: 'medium', emoji: '📬', headline: `${firstName} just came in — reach out now`, body: `New leads contacted within the first hour are 7× more likely to respond. ${firstName} signed up ${days === 1 ? 'yesterday' : `${days} days ago`} for ${propName}.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'new' && days >= 3 && days < 7) {
      suggestions.push({ id: lead.id + '_new_stale', priority: 'urgent', emoji: '🔥', headline: `${firstName} has been waiting ${days} days — send pre-screen now`, body: `Leads that go 3+ days without contact drop off 60% of the time. One nudge can recover them. They're interested in ${propName}.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'new' && days >= 7) {
      suggestions.push({ id: lead.id + '_new_lost', priority: 'urgent', emoji: '⚠️', headline: `${firstName} may be going cold — final follow-up`, body: `It's been ${days} days since ${firstName} showed interest in ${propName}. Send one last outreach or close as lost.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'contacted' && days >= 2 && days < 5) {
      suggestions.push({ id: lead.id + '_contacted_follow', priority: 'medium', emoji: '📞', headline: `Follow up with ${firstName} — ${days}d since first contact`, body: `You reached out to ${firstName} about ${propName}. A second touch-point increases reply rates by 3×.`, lead, cta: 'view', propName })
    } else if (lead.status === 'contacted' && days >= 5 && days < 14) {
      suggestions.push({ id: lead.id + '_contacted_urgent', priority: 'urgent', emoji: '⏰', headline: `${firstName} hasn't responded in ${days} days`, body: `${firstName} is interested in ${propName} but hasn't moved forward. Try a different channel (phone, text) before this one slips away.`, lead, cta: 'view', propName })
    } else if (lead.status === 'contacted' && days >= 14) {
      suggestions.push({ id: lead.id + '_contacted_final', priority: 'urgent', emoji: '🚨', headline: `At risk: ${firstName} has been stale for ${days} days`, body: `This lead is nearly cold. One final personal message can turn it around — or mark it lost and keep your pipeline clean.`, lead, cta: 'view', propName })
    } else if (lead.status === 'engaged' && days >= 4 && days < 10) {
      suggestions.push({ id: lead.id + '_engaged_push', priority: 'medium', emoji: '💬', headline: `Push ${firstName} to complete their pre-screen`, body: `${firstName} engaged with your listing ${days} days ago. The pre-screen separates serious applicants — nudge them to finish it.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'engaged' && days >= 10) {
      suggestions.push({ id: lead.id + '_engaged_reactivate', priority: 'urgent', emoji: '🔔', headline: `Re-activate ${firstName} — ${days}d stalled at Engaged`, body: `${firstName} showed real interest in ${propName} but stopped. Ask if they're still looking — a short reply reopens the conversation.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'qualified' && days >= 2 && days < 7) {
      suggestions.push({ id: lead.id + '_qual_tour', priority: 'medium', emoji: '🏠', headline: `Invite ${firstName} to tour ${propName}`, body: `${firstName} completed their pre-screen ${days} days ago — they're your most serious candidate. Strike while they're warm.`, lead, cta: 'view', propName })
    } else if (lead.status === 'qualified' && days >= 7) {
      suggestions.push({ id: lead.id + '_qual_urgent', priority: 'urgent', emoji: '⚡', headline: `${firstName} qualified ${days}d ago — close the deal`, body: `This lead is your best chance at filling ${propName}. They pre-screened, they're interested. Don't let another landlord swoop in — book the tour today.`, lead, cta: 'view', propName })
    }
  }

  // Sort: urgent first, then by staleDays desc
  suggestions.sort((a, b) => {
    const p = { urgent: 0, medium: 1, low: 2 }
    if (p[a.priority] !== p[b.priority]) return p[a.priority] - p[b.priority]
    return staleDays(b.lead) - staleDays(a.lead)
  })

  const urgentCount = suggestions.filter(s => s.priority === 'urgent').length

  // ── Guards ────────────────────────────────────────────────────────────────
  // ── Email preview builder (mirrors send-reminder route, no images needed for preview) ──
  function buildPreviewEmail(lead: Lead, propName: string): { subject: string; html: string } {
    const prescreenDone = ['qualified', 'tour_scheduled', 'closed'].includes(lead.status)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
    const prescreenUrl = `${siteUrl}/pre-screen/${lead.id}`
    const firstName = lead.first_name || 'there'

    const header = `<div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;"><div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div><div style="font-size:12px;color:#9b9b9b;margin-top:4px;">Student Housing Near ASU</div></div>`
    const footer = `<div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></div>`

    if (prescreenDone) {
      const subject = `${firstName}, you're already in — we'll be in touch soon! 🎉`
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:32px 16px;">${header}<div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;"><div style="text-align:center;margin-bottom:20px;"><div style="width:64px;height:64px;border-radius:50%;background:#FFC627;display:inline-flex;align-items:center;justify-content:center;font-size:26px;">🎉</div></div><p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;text-align:center;">You're all set, ${firstName}!</p><p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;text-align:center;">Thanks for completing your pre-screen for <strong>${propName}</strong>. Our team is reviewing your profile and we'll be in touch soon!</p><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;"><div style="font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">What happens next</div>${['A HomeHive rep reviews your full profile', "We'll reach out within 24 hours", 'Schedule a tour and get the keys 🗝️'].map((s, i) => `<div style="display:flex;align-items:center;gap:10px;font-size:13px;color:#166534;margin-bottom:${i < 2 ? '8px' : '0'};"><div style="width:20px;height:20px;border-radius:50%;background:#10b981;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</div>${s}</div>`).join('')}</div></div>${footer}</div></body></html>`
      return { subject, html }
    }

    const subject = `${firstName}, your spot at ${propName} is still waiting`
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:32px 16px;">${header}<div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;"><div style="display:inline-flex;align-items:center;gap:6px;background:#fef3c7;border:1px solid #fde68a;border-radius:20px;padding:4px 12px;margin-bottom:16px;"><span style="font-size:11px;color:#92400e;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">⏰ Gentle reminder</span></div><p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">Hey ${firstName}!</p><p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;">Your spot at <strong>${propName}</strong> is still available, but rooms are filling up fast. You're just a 2-minute pre-screen away from locking it in. 🏠</p><div style="background:#fdf2f5;border-left:4px solid #8C1D40;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;"><div style="font-size:14px;font-weight:700;color:#8C1D40;margin-bottom:4px;">Don't lose your spot</div><p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65;">Pre-screened applicants are reviewed first. It takes under 2 minutes and dramatically increases your chances.</p></div><div style="text-align:center;margin:24px 0;"><a href="${prescreenUrl}" style="display:inline-block;background:#FFC627;color:#1a1a1a;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:10px;">Complete My Pre-Screen →</a></div><p style="margin:0;font-size:12px;color:#b0a898;text-align:center;">This link is personal to you · Takes 2 minutes · No commitment</p></div>${footer}</div></body></html>`
    return { subject, html }
  }

  if (!loading && properties.length === 0) {
    return (
      <div style={{ maxWidth: '560px', margin: '80px auto', padding: '0 20px', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>📭</div>
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>No listings yet</div>
        <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '28px', lineHeight: 1.6 }}>
          Leads appear here once you have an active listing. Create your first listing to start receiving inquiries from students.
        </div>
        <a href="/landlord/listings/new" style={{ display: 'inline-block', background: '#0f172a', color: '#34d399', padding: '12px 28px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
          Create a listing →
        </a>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'); @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        {[1,2,3,4,5].map(i => (
          <div key={i} style={{ height: '64px', borderRadius: '10px', marginBottom: '8px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        ))}
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ll-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        .ll-header { background: #1a1a1a; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .ll-title { font-size: 20px; font-weight: 700; color: #fff; }
        .ll-subtitle { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .ll-header-right { display: flex; align-items: center; gap: 10px; }

        .ll-stats { background: #fff; border-bottom: 1px solid #e8e5de; padding: 10px 28px; display: flex; gap: 24px; overflow-x: auto; }
        .ll-stat { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .ll-stat-num { font-size: 16px; font-weight: 700; color: #1a1a1a; }
        .ll-stat-label { font-size: 11px; color: #9b9b9b; }
        .ll-stat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

        .ll-filters { background: #fff; border-bottom: 1px solid #e8e5de; padding: 10px 28px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .ll-search { padding: 8px 12px 8px 34px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; width: 220px; background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239b9b9b' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") no-repeat 10px center; transition: border-color 0.15s; }
        .ll-search:focus { border-color: #8C1D40; }
        .ll-status-pills { display: flex; gap: 4px; flex-wrap: wrap; }
        .ll-pill { padding: 5px 12px; border-radius: 20px; border: 1.5px solid #e8e5de; background: #fff; font-size: 12px; font-weight: 500; color: #6b6b6b; cursor: pointer; transition: all 0.15s; white-space: nowrap; font-family: 'DM Sans', sans-serif; }
        .ll-pill.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; font-weight: 600; }
        .ll-select { padding: 7px 12px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; background: #fff; color: #1a1a1a; cursor: pointer; }
        .ll-view-toggle { display: flex; background: #f5f4f0; border-radius: 7px; padding: 3px; gap: 2px; }
        .ll-view-btn { padding: 5px 12px; border: none; border-radius: 5px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .ll-view-btn.active { background: #fff; color: #1a1a1a; font-weight: 600; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        .ll-view-btn:not(.active) { background: transparent; color: #9b9b9b; }

        .ll-table-wrap { background: #fff; border: 1px solid #e8e5de; border-radius: 10px; overflow: hidden; margin: 12px 24px 0; }
        .ll-table { width: 100%; border-collapse: collapse; }
        .ll-table thead th { background: #faf9f6; padding: 7px 12px; text-align: left; font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid #e8e5de; white-space: nowrap; }
        .ll-table thead th:first-child { width: 44px; padding-left: 14px; }
        .ll-table thead th:last-child { text-align: right; padding-right: 14px; }
        .ll-table tbody tr { border-bottom: 1px solid #f5f4f0; transition: background 0.1s; }
        .ll-table tbody tr:last-child { border-bottom: none; }
        .ll-table tbody tr.ll-tr-link { cursor: pointer; }
        .ll-table tbody tr.ll-tr-link:hover { background: #faf9f6; }
        .ll-table td { padding: 9px 12px; vertical-align: middle; }
        .ll-table td:first-child { padding-left: 14px; }
        .ll-table td:last-child { padding-right: 14px; }

        .ll-pagination { display: flex; align-items: center; justify-content: space-between; padding: 10px 24px 0; }
        .ll-page-btn { padding: 5px 12px; border: 1.5px solid #e8e5de; border-radius: 6px; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; color: #4a4a4a; transition: all 0.15s; }
        .ll-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .ll-page-btn:not(:disabled):hover { border-color: #8C1D40; color: #8C1D40; }

        .ll-avatar { width: 32px; height: 32px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; letter-spacing: 0.5px; }

        /* Copy button */
        .ll-copy-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: none; cursor: pointer; padding: 1px 3px; border-radius: 3px; opacity: 0; transition: opacity 0.12s, background 0.12s; vertical-align: middle; margin-left: 3px; }
        .ll-copy-btn:hover { background: #e8e5de; opacity: 1 !important; }
        .ll-copy-btn.copied { opacity: 1 !important; }
        tr:hover .ll-copy-btn { opacity: 0.45; }
        .ll-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }
        .ll-action-btn { padding: 5px 10px; border-radius: 6px; border: 1.5px solid; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; }

        /* Inline status select styled as a badge */
        .ll-status-select { padding: 3px 22px 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid; cursor: pointer; font-family: 'DM Sans', sans-serif; outline: none; transition: opacity 0.15s; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 6px center; }
        .ll-status-select:disabled { opacity: 0.55; cursor: not-allowed; }

        .ll-pipeline { padding: 16px 28px; display: flex; gap: 12px; overflow-x: auto; }
        .ll-pcol { flex-shrink: 0; width: 210px; background: #fff; border-radius: 12px; border-top: 3px solid; overflow: hidden; }
        .ll-pcol-header { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0ede6; }
        .ll-pcol-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
        .ll-pcol-count { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .ll-pcard { margin: 8px 8px 0; padding: 12px; border: 1px solid #f0ede6; border-radius: 8px; cursor: pointer; transition: box-shadow 0.15s; }
        .ll-pcard:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .ll-pcard.locked { background: #fafaf9; cursor: default; }
        .ll-pcard:last-child { margin-bottom: 8px; }

        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; white-space: nowrap; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-gold { background: #FFC627; color: #1a1a1a; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; white-space: nowrap; }
        .btn-gold:hover { opacity: 0.9; }
        .btn-ghost { background: transparent; color: #9b9b9b; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #8C1D40; color: #8C1D40; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(2px); }
        .modal-card { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto; }
        .modal-title { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .modal-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 22px; }
        .field-label { font-size: 12px; font-weight: 700; color: #1a1a1a; margin-bottom: 5px; display: block; }
        .field-input { width: 100%; padding: 10px 13px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
        .field-input:focus { border-color: #8C1D40; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .field-col { display: flex; flex-direction: column; margin-bottom: 14px; }

        .ll-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        .ll-empty { padding: 60px 28px; display: flex; justify-content: center; }
        .ll-empty-card { background: #fff; border: 1px dashed #e8e5de; border-radius: 16px; padding: 48px 40px; max-width: 440px; width: 100%; text-align: center; }

        .blur-line { background: #e0ddd7; border-radius: 3px; }

        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @media (max-width: 640px) {
          .ll-header { padding: 16px; }
          .ll-filters { padding: 10px 16px; }
          .field-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="ll-page">

        {toast && <div className="ll-toast">✓ {toast}</div>}

        {/* Header */}
        <div className="ll-header">
          <div>
            <div className="ll-title">Leads CRM</div>
            <div className="ll-subtitle">{leads.length} total · sorted by most recent</div>
          </div>
          <div className="ll-header-right">
            {lockedCount > 0 && (
              <span style={{ fontSize: '12px', color: '#FFC627', fontWeight: 600, background: 'rgba(255,198,39,0.12)', border: '1px solid rgba(255,198,39,0.3)', borderRadius: '20px', padding: '4px 12px' }}>
                🔒 {lockedCount} lead{lockedCount !== 1 ? 's' : ''} locked
              </span>
            )}
            <a href="/landlord/leads/pipeline" style={{ fontSize: '12px', color: '#9b9b9b', textDecoration: 'none', fontWeight: 500 }}>Pipeline guide →</a>
            <button className="btn-gold" onClick={() => setShowAddModal(true)}>+ Add Lead</button>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e5de', padding: '0 28px', display: 'flex', gap: 0 }}>
          {([
            { id: 'overview', label: 'Overview' },
            { id: 'insights', label: `Insights${urgentCount > 0 ? ` (${urgentCount})` : ''}` },
            { id: 'leads', label: `Leads (${leads.length})` },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '12px 18px',
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 700 : 400,
                color: activeTab === tab.id ? '#8C1D40' : (tab.id === 'insights' && urgentCount > 0 ? '#dc2626' : '#6b6b6b'),
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid #8C1D40' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div style={{ padding: '20px 24px' }}>
            {/* Summary row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Total Leads',     value: leads.length,                                      sub: `${leads.filter(l => l.status !== 'closed').length} active` },
                { label: 'Qualified+',      value: leads.filter(l => ['qualified','tour_scheduled'].includes(l.status)).length, sub: 'ready for tour or lease', accent: '#10b981' },
                { label: 'Avg. Conversion', value: leads.length > 0 ? `${Math.round((leads.filter(l => ['qualified','tour_scheduled'].includes(l.status)).length / leads.length) * 100)}%` : '—', sub: 'new → qualified' },
                { label: 'Action Needed',   value: urgentCount,                                       sub: `${suggestions.length} total suggestions`, accent: urgentCount > 0 ? '#dc2626' : '#94a3b8' },
              ].map(card => (
                <div key={card.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{card.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: card.accent || '#0f172a', lineHeight: 1, marginBottom: 4 }}>{card.value}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Property breakdown */}
            {propertyAnalytics.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>By Property</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {propertyAnalytics.map(pa => (
                    <div key={pa.slug} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{pa.name}</span>
                          <span style={{ marginLeft: 10, fontSize: 11, color: '#94a3b8' }}>{pa.totalLeads} lead{pa.totalLeads !== 1 ? 's' : ''} · {pa.activeLeads} active</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {pa.hotLeadCount > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 20, padding: '2px 10px' }}>
                              🔥 {pa.hotLeadCount} hot
                            </span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 700, color: pa.conversionRate >= 30 ? '#16a34a' : pa.conversionRate >= 15 ? '#d97706' : '#dc2626' }}>
                            {pa.conversionRate}% conv.
                          </span>
                        </div>
                      </div>
                      {/* Funnel bar */}
                      <div style={{ display: 'flex', gap: 4, marginBottom: 8, height: 8 }}>
                        {STATUS_ORDER.filter(s => s !== 'closed').map(s => {
                          const count = pa.byStatus[s] || 0
                          const pct = pa.totalLeads > 0 ? (count / pa.totalLeads) * 100 : 0
                          const colors: Record<string, string> = { new: '#3b82f6', contacted: '#f97316', engaged: '#eab308', qualified: '#10b981', tour_scheduled: '#8b5cf6' }
                          return pct > 0 ? (
                            <div key={s} style={{ width: `${pct}%`, background: colors[s], borderRadius: 4, minWidth: 6 }} title={`${STATUS_META[s].label}: ${count}`} />
                          ) : null
                        })}
                      </div>
                      {/* Funnel labels */}
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {STATUS_ORDER.filter(s => s !== 'closed').map(s => {
                          const count = pa.byStatus[s] || 0
                          if (count === 0) return null
                          const colors: Record<string, string> = { new: '#3b82f6', contacted: '#f97316', engaged: '#eab308', qualified: '#10b981', tour_scheduled: '#8b5cf6' }
                          return (
                            <span key={s} style={{ fontSize: 11, color: colors[s], fontWeight: 600 }}>
                              {count} {STATUS_META[s].label}
                            </span>
                          )
                        })}
                        {pa.byStatus.closed > 0 && (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{pa.byStatus.closed} closed</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hottest leads */}
            {topLeads.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>
                  Hottest Leads — ranked by status + recency
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                  {topLeads.map(({ lead, score, days }, i) => {
                    const meta = STATUS_META[lead.status]
                    const prop = properties.find(p => p.slug === lead.property)
                    const scoreColor = score >= 70 ? '#dc2626' : score >= 50 ? '#d97706' : score >= 30 ? '#10b981' : '#94a3b8'
                    return (
                      <div key={lead.id} onClick={() => router.push(`/landlord/leads/${lead.id}`)} style={{ background: '#fff', border: `1px solid ${i === 0 ? '#fecaca' : '#e2e8f0'}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {initials(lead.first_name, lead.last_name)}
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                                {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                                {i === 0 && <span style={{ marginLeft: 4 }}>🔥</span>}
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{prop?.name || '—'}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: scoreColor }}>{score}</div>
                            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>score</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 20, padding: '2px 8px' }}>
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{days}d old</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {leads.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>No leads yet</div>
                <div style={{ fontSize: 13 }}>They'll appear here once tenants inquire about your properties.</div>
              </div>
            )}
          </div>
        )}

        {/* ── INSIGHTS TAB ── */}
        {activeTab === 'insights' && (
          <div style={{ padding: '20px 24px' }}>
            {suggestions.length === 0 ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '32px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#166534', marginBottom: 6 }}>You're all caught up!</div>
                <div style={{ fontSize: 13, color: '#16a34a' }}>No follow-ups needed right now. Check back as new leads come in.</div>
              </div>
            ) : (
              <>
                {/* Priority summary */}
                {urgentCount > 0 && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>🚨</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626' }}>{urgentCount} urgent action{urgentCount !== 1 ? 's' : ''} needed</div>
                      <div style={{ fontSize: 12, color: '#b91c1c' }}>These leads are at risk of going cold. Act today.</div>
                    </div>
                  </div>
                )}

                {/* Suggestion cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
                  {suggestions.map(s => {
                    const borderColors = { urgent: '#fecaca', medium: '#fed7aa', low: '#bbf7d0' }
                    const accentColors = { urgent: '#dc2626', medium: '#d97706', low: '#16a34a' }
                    const bgColors     = { urgent: '#fef2f2', medium: '#fffbeb', low: '#f0fdf4' }
                    const propMeta = STATUS_META[s.lead.status]
                    return (
                      <div key={s.id} style={{ background: '#fff', border: `1px solid ${borderColors[s.priority]}`, borderLeft: `4px solid ${accentColors[s.priority]}`, borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <div style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>{s.emoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>{s.headline}</div>
                              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 10 }}>{s.body}</div>
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: accentColors[s.priority], background: bgColors[s.priority], border: `1px solid ${borderColors[s.priority]}`, borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {s.priority === 'urgent' ? '🔴 Urgent' : s.priority === 'medium' ? '🟡 Soon' : '🟢 Low'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: propMeta.color, background: propMeta.bg, border: `1px solid ${propMeta.border}`, borderRadius: 20, padding: '2px 8px' }}>
                              {propMeta.label}
                            </span>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>{s.propName}</span>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                              {s.cta === 'remind' && (
                                <>
                                  <button
                                    style={{ fontSize: 12, fontWeight: 600, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                                    onClick={() => { const { subject, html } = buildPreviewEmail(s.lead, s.propName); setEmailPreview({ lead: s.lead, subject, html }) }}
                                    title="Preview email"
                                  >
                                    👁 Preview
                                  </button>
                                  <button
                                    style={{ fontSize: 12, fontWeight: 600, color: '#8C1D40', background: '#fdf2f5', border: '1px solid #f4c9d5', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                                    disabled={remindingId === s.lead.id}
                                    onClick={async (e) => { e.stopPropagation(); await sendReminder(s.lead, e) }}
                                  >
                                    {remindingId === s.lead.id ? 'Sending…' : '📧 Send'}
                                  </button>
                                </>
                              )}
                              <button
                                style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                                onClick={() => router.push(`/landlord/leads/${s.lead.id}`)}
                              >
                                View →
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Follow-up templates */}
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                      Message Templates — copy & personalize
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      {
                        label: 'Pre-screen nudge (1-3 days)',
                        subject: 'Still interested in [Property]?',
                        body: 'Hey [Name], just wanted to follow up on your inquiry about [Property]. Completing your 2-min pre-screen moves you to the top of our list — most students who fill it out hear back within 24 hours. Here\'s your link: [pre-screen link]',
                      },
                      {
                        label: 'Re-engagement (7+ days stale)',
                        subject: 'Is [Property] still on your radar?',
                        body: 'Hi [Name], we haven\'t heard back and wanted to check in. [Property] still has availability for your move-in window. If you\'re still interested, a quick reply is all it takes to get the process moving. No pressure either way!',
                      },
                      {
                        label: 'Tour invite (qualified lead)',
                        subject: 'Ready to see [Property] in person?',
                        body: 'Hi [Name]! Your pre-screen looks great — you\'re exactly who we\'re looking for. I\'d love to show you [Property] in person. Are you available [Day/Time Option 1] or [Day/Time Option 2]? Let me know what works!',
                      },
                      {
                        label: 'Final breakup (21+ days no response)',
                        subject: 'Closing your inquiry for [Property]',
                        body: 'Hi [Name], I\'ve tried reaching out a few times about [Property] with no response. I\'m going to go ahead and close this inquiry to keep my list clean. If you\'re still interested, just reply to this email and we\'ll pick back up right away. No hard feelings!',
                      },
                    ].map((tmpl, i) => (
                      <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{tmpl.label}</div>
                        <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}><strong>Subject:</strong> {tmpl.subject}</div>
                        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 10 }}>{tmpl.body}</div>
                        <button
                          onClick={() => { navigator.clipboard.writeText(`Subject: ${tmpl.subject}\n\n${tmpl.body}`); showToast('Template copied!') }}
                          style={{ fontSize: 11, fontWeight: 600, color: '#8C1D40', background: 'none', border: '1px solid #f4c9d5', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                        >
                          Copy template
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── LEADS TAB ── */}
        {activeTab === 'leads' && (
          <>
            {/* Stats bar */}
            <div className="ll-stats">
              {STATUS_ORDER.map(s => (
                <div key={s} className="ll-stat" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter(s === statusFilter ? 'all' : s)}>
                  <div className="ll-stat-dot" style={{ background: STATUS_META[s].color }} />
                  <div className="ll-stat-num" style={{ color: STATUS_META[s].color }}>{counts[s]}</div>
                  <div className="ll-stat-label">{STATUS_META[s].label}</div>
                </div>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <div className="ll-stat-dot" style={{ background: '#FFC627' }} />
                <div className="ll-stat-num" style={{ color: '#c9973a' }}>{needsPrescreen}</div>
                <div className="ll-stat-label">Need pre-screen</div>
              </div>
            </div>

            {/* Filters */}
            <div className="ll-filters">
              <input
                className="ll-search"
                placeholder="Search name, email, property…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="ll-status-pills">
                <div className={`ll-pill${statusFilter === 'all' ? ' active' : ''}`} onClick={() => setStatusFilter('all')}>All</div>
                {STATUS_ORDER.map(s => (
                  <div
                    key={s}
                    className={`ll-pill${statusFilter === s ? ' active' : ''}`}
                    onClick={() => setStatusFilter(s)}
                    style={statusFilter === s ? {} : { borderColor: STATUS_META[s].border, color: STATUS_META[s].color }}
                  >
                    {STATUS_META[s].label}
                  </div>
                ))}
              </div>
              {properties.length > 1 && (
                <select className="ll-select" value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}>
                  <option value="all">All Properties</option>
                  {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <div className="ll-view-toggle">
                  <button className={`ll-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => { setViewMode('list'); ph?.capture('leads_view_mode_changed', { view_mode: 'list' }) }}>≡ List</button>
                  <button className={`ll-view-btn${viewMode === 'pipeline' ? ' active' : ''}`} onClick={() => { setViewMode('pipeline'); ph?.capture('leads_view_mode_changed', { view_mode: 'pipeline' }) }}>⊞ Pipeline</button>
                </div>
              </div>
            </div>

            {/* Empty state */}
            {filteredLeads.length === 0 && (
              <div className="ll-empty">
                <div className="ll-empty-card">
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>
                    {search || statusFilter !== 'all' || propertyFilter !== 'all' ? 'No matching leads' : 'No leads yet'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '20px', lineHeight: 1.6 }}>
                    {search || statusFilter !== 'all' ? 'Try adjusting your filters.' : 'Add a lead manually or wait for tenants to submit interest forms.'}
                  </div>
                  <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add First Lead</button>
                </div>
              </div>
            )}

            {/* ── LIST VIEW ── */}
            {viewMode === 'list' && filteredLeads.length > 0 && (
              <>
                <div className="ll-table-wrap">
                  <table className="ll-table">
                    <thead>
                      <tr>
                        <th />
                        <th>Lead</th>
                        <th>Listing</th>
                        <th>Status</th>
                        <th>Age</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>

                    {/* ── Visible rows ── */}
                    {pagedVisible.length > 0 && (
                      <tbody>
                        {pagedVisible.map(lead => {
                          const heat = getHeat(lead.created_at)
                          const meta = STATUS_META[lead.status]
                          const hasPrescreen = ['qualified', 'tour_scheduled', 'closed'].includes(lead.status)
                          const needsRemind = ['new', 'contacted', 'engaged'].includes(lead.status)
                          const prop = properties.find(p => p.slug === lead.property)
                          const phone = formatPhoneDisplay(lead.phone)
                          return (
                            <tr
                              key={lead.id}
                              className="ll-tr-link"
                              onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                            >
                              <td>
                                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.5px' }}>
                                  {initials(lead.first_name, lead.last_name)}
                                </div>
                              </td>
                              <td>
                                <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a1a1a', lineHeight: 1.3 }}>
                                  {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                                  {heat.icon && <span style={{ marginLeft: '4px', fontSize: '12px' }} title={heat.label}>{heat.icon}</span>}
                                </div>
                                <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '1px', display: 'flex', alignItems: 'center' }}>
                                  <span>{lead.email}</span>
                                  <button
                                    className={`ll-copy-btn${copiedKey === `${lead.id}:email` ? ' copied' : ''}`}
                                    onClick={e => handleCopy(e, `${lead.id}:email`, lead.email)}
                                    title="Copy email"
                                  >
                                    {copiedKey === `${lead.id}:email`
                                      ? <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700 }}>✓</span>
                                      : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9b9b9b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    }
                                  </button>
                                </div>
                                {phone && (
                                  <div style={{ fontSize: '11px', color: '#6b9af0', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} style={{ color: '#6b9af0', textDecoration: 'none' }}>
                                      🇺🇸 +1 {phone}
                                    </a>
                                    <button
                                      className={`ll-copy-btn${copiedKey === `${lead.id}:phone` ? ' copied' : ''}`}
                                      onClick={e => handleCopy(e, `${lead.id}:phone`, phone)}
                                      title="Copy phone"
                                    >
                                      {copiedKey === `${lead.id}:phone`
                                        ? <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700 }}>✓</span>
                                        : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b9af0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                      }
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td>
                                <div style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: 600 }}>{prop?.name || '—'}</div>
                                {prop?.address && <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '1px' }}>{prop.address}</div>}
                                {lead.move_in_date && <div style={{ fontSize: '10px', color: '#b0a898', marginTop: '1px' }}>Move-in: {lead.move_in_date}</div>}
                              </td>
                              <td onClick={e => e.stopPropagation()}>
                                <select
                                  className="ll-status-select"
                                  value={lead.status}
                                  disabled={updatingStatusId === lead.id}
                                  onChange={e => handleStatusChange(lead, e.target.value as Lead['status'])}
                                  style={{
                                    color: meta.color,
                                    background: meta.bg,
                                    borderColor: meta.border,
                                  }}
                                >
                                  {STATUS_ORDER.map(s => (
                                    <option key={s} value={s}>{STATUS_META[s].label}</option>
                                  ))}
                                </select>
                                <div style={{ marginTop: '3px', fontSize: '10px', color: hasPrescreen ? '#10b981' : '#c5c1b8', fontWeight: hasPrescreen ? 600 : 400 }}>
                                  {hasPrescreen ? '✓ Pre-screened' : 'Needs pre-screen'}
                                </div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap', fontSize: '11px', color: '#b0a898' }}>
                                {timeAgo(lead.created_at)}
                              </td>
                              <td onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                                  {needsRemind && (
                                    <button
                                      className="ll-action-btn"
                                      style={{ color: '#8C1D40', borderColor: '#f4c9d5', background: '#fdf2f5' }}
                                      disabled={remindingId === lead.id}
                                      onClick={e => sendReminder(lead, e)}
                                    >
                                      {remindingId === lead.id ? '…' : '📧'}
                                    </button>
                                  )}
                                  <button
                                    className="ll-action-btn"
                                    style={{ color: '#3a3a3a', borderColor: '#e8e5de', background: '#fff' }}
                                    onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                                  >
                                    View →
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    )}

                    {/* ── Locked section ── */}
                    {lockedFiltered.length > 0 && (
                      <tbody>
                        <tr>
                          <td colSpan={6} style={{ padding: 0 }}>
                            <div style={{
                              background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1118 100%)',
                              padding: '14px 18px',
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: '16px', flexWrap: 'wrap',
                              borderTop: pagedVisible.length > 0 ? '2px solid #e8e5de' : 'none',
                            }}>
                              <div>
                                <div style={{ color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                                  🔒 {lockedFiltered.length} lead{lockedFiltered.length !== 1 ? 's' : ''} locked
                                </div>
                                <div style={{ color: '#9b9b9b', fontSize: '11px', lineHeight: 1.7 }}>
                                  Unlock to see name, email & phone&nbsp;·&nbsp;
                                  <span style={{ color: '#FFC627', fontWeight: 600 }}>$29.99/mo</span> 1 listing&nbsp;·&nbsp;
                                  <span style={{ color: '#FFC627', fontWeight: 600 }}>$49.99/mo</span> unlimited listings&nbsp;·&nbsp;
                                  <span style={{ color: '#FFC627', fontWeight: 600 }}>$299</span> lifetime deal&nbsp;·&nbsp;
                                  <span style={{ color: '#FFC627', fontWeight: 600 }}>$1.99</span> per lead
                                </div>
                              </div>
                              <button
                                onClick={() => setUnlockModalLeadId(lockedFiltered[0].id)}
                                style={{
                                  background: '#FFC627', color: '#1a1a1a', border: 'none',
                                  borderRadius: '7px', padding: '9px 18px', fontSize: '13px',
                                  fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                                  fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
                                }}
                              >
                                Unlock Leads →
                              </button>
                            </div>
                          </td>
                        </tr>

                        {lockedFiltered.slice(0, 3).map(lead => {
                          const meta = STATUS_META[lead.status]
                          const prop = properties.find(p => p.slug === lead.property)
                          return (
                            <tr key={lead.id} style={{ background: '#fafaf8' }}>
                              <td>
                                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#d4d0c8', filter: 'blur(3px)' }} />
                              </td>
                              <td>
                                <div style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
                                  <div className="blur-line" style={{ width: '90px', height: '12px', marginBottom: '4px' }} />
                                  <div className="blur-line" style={{ width: '120px', height: '10px' }} />
                                </div>
                              </td>
                              <td>
                                <div style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: 600 }}>{prop?.name || '—'}</div>
                                {prop?.address && <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '1px' }}>{prop.address}</div>}
                                {lead.move_in_date && <div style={{ fontSize: '10px', color: '#b0a898', marginTop: '1px' }}>Move-in: {lead.move_in_date}</div>}
                              </td>
                              <td>
                                <span className="ll-badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                                  {meta.label}
                                </span>
                              </td>
                              <td style={{ fontSize: '11px', color: '#b0a898', whiteSpace: 'nowrap' }}>
                                {timeAgo(lead.created_at)}
                              </td>
                              <td />
                            </tr>
                          )
                        })}

                        {lockedFiltered.length > 3 && (
                          <tr>
                            <td colSpan={6} style={{ padding: '10px 18px', background: '#f7f6f3', textAlign: 'center', borderTop: '1px dashed #e0ddd7' }}>
                              <span style={{ fontSize: '12px', color: '#9b9b9b' }}>
                                +{lockedFiltered.length - 3} more lead{lockedFiltered.length - 3 !== 1 ? 's' : ''} across{' '}
                                {Math.ceil(lockedFiltered.length / PAGE_SIZE)} more page{Math.ceil(lockedFiltered.length / PAGE_SIZE) !== 1 ? 's' : ''} —{' '}
                              </span>
                              <button
                                onClick={() => setUnlockModalLeadId(lockedFiltered[0].id)}
                                style={{ background: 'none', border: 'none', color: '#8C1D40', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0 }}
                              >
                                unlock all →
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    )}
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="ll-pagination">
                    <span style={{ fontSize: '12px', color: '#9b9b9b' }}>
                      {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, visibleFiltered.length)} of {visibleFiltered.length} leads
                    </span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button className="ll-page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                      <span style={{ fontSize: '12px', color: '#6b6b6b', fontWeight: 600, minWidth: '80px', textAlign: 'center' }}>
                        Page {page} of {totalPages}
                      </span>
                      <button className="ll-page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── PIPELINE VIEW ── */}
            {viewMode === 'pipeline' && filteredLeads.length > 0 && (
              <div className="ll-pipeline">
                {STATUS_ORDER.map(status => {
                  const meta = STATUS_META[status]
                  const colLeads = leadsByStatus[status] || []
                  return (
                    <div key={status} className="ll-pcol" style={{ borderTopColor: meta.color }}>
                      <div className="ll-pcol-header">
                        <span className="ll-pcol-label" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="ll-pcol-count" style={{ background: meta.color }}>{colLeads.length}</span>
                      </div>
                      {colLeads.length === 0 && (
                        <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: '12px', color: '#c5c1b8' }}>No leads</div>
                      )}
                      {colLeads.map(lead => {
                        const visible = isLeadVisible(lead)
                        const heat = getHeat(lead.created_at)
                        const prop = properties.find(p => p.slug === lead.property)

                        if (!visible) {
                          return (
                            <div key={lead.id} className="ll-pcard locked">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#d4d0c8', flexShrink: 0, filter: 'blur(3px)' }} />
                                <div style={{ filter: 'blur(4px)', userSelect: 'none', flex: 1 }}>
                                  <div className="blur-line" style={{ width: '70px', height: '11px', marginBottom: '4px' }} />
                                  <div className="blur-line" style={{ width: '90px', height: '10px' }} />
                                </div>
                              </div>
                              {prop && <div style={{ fontSize: '11px', color: '#9b9b9b', fontWeight: 500 }}>{prop.name}</div>}
                            </div>
                          )
                        }

                        return (
                          <div
                            key={lead.id}
                            className="ll-pcard"
                            onClick={() => router.push(`/landlord/leads/${lead.id}`)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {initials(lead.first_name, lead.last_name)}
                              </div>
                              <div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>
                                  {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name[0]}.` : ''}
                                  {heat.icon && <span style={{ marginLeft: '4px' }}>{heat.icon}</span>}
                                </div>
                                <div style={{ fontSize: '11px', color: '#9b9b9b' }}>{lead.email}</div>
                                {lead.phone && <div style={{ fontSize: '10px', color: '#6b9af0' }}>🇺🇸 {formatPhoneDisplay(lead.phone)}</div>}
                              </div>
                            </div>
                            {prop && (
                              <div style={{ marginBottom: '4px' }}>
                                <div style={{ fontSize: '11px', color: '#4a4a4a', fontWeight: 600 }}>{prop.name}</div>
                                {prop.address && <div style={{ fontSize: '10px', color: '#9b9b9b' }}>{prop.address}</div>}
                              </div>
                            )}
                            <div style={{ fontSize: '10px', color: '#b0a898' }}>{timeAgo(lead.created_at)}</div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

      </div>

      {/* ── EMAIL PREVIEW MODAL ── */}
      {emailPreview && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(2px)' }}
          onClick={() => setEmailPreview(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.25)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>Email Preview</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  To: <strong style={{ color: '#0f172a' }}>{emailPreview.lead.email}</strong>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Subject: <strong style={{ color: '#0f172a' }}>{emailPreview.subject}</strong>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  style={{ fontSize: 13, fontWeight: 600, color: '#8C1D40', background: '#fdf2f5', border: '1px solid #f4c9d5', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                  disabled={remindingId === emailPreview.lead.id}
                  onClick={async (e) => {
                    const lead = emailPreview.lead
                    setEmailPreview(null)
                    await sendReminder(lead, e)
                  }}
                >
                  {remindingId === emailPreview.lead.id ? 'Sending…' : '📧 Send now'}
                </button>
                <button
                  style={{ fontSize: 13, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                  onClick={() => setEmailPreview(null)}
                >
                  ✕
                </button>
              </div>
            </div>
            {/* Rendered email */}
            <div style={{ flex: 1, overflow: 'auto', background: '#f5f4f0' }}>
              <iframe
                srcDoc={emailPreview.html}
                style={{ width: '100%', border: 'none', display: 'block' }}
                height={560}
                title="Email preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── CLOSE REASON MODAL ── */}
      {closeModal && (
        <div className="modal-overlay" onClick={() => setCloseModal(null)}>
          <div className="modal-card" style={{ maxWidth: '360px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">Close this lead</div>
            <div className="modal-sub">How did this lead end?</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn-primary"
                style={{ flex: 1, background: '#10b981' }}
                onClick={() => handleCloseWithReason('leased')}
              >
                ✓ Leased
              </button>
              <button
                className="btn-ghost"
                style={{ flex: 1 }}
                onClick={() => handleCloseWithReason('lost')}
              >
                ✗ Lost
              </button>
            </div>
            <button style={{ marginTop: '12px', width: '100%', background: 'none', border: 'none', color: '#9b9b9b', fontSize: '12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }} onClick={() => setCloseModal(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── ADD LEAD MODAL ── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div className="modal-title">Add Lead Manually</div>
                <div className="modal-sub">A pre-screen invitation will be emailed automatically.</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9b9b9b', padding: '0 0 0 12px' }} onClick={() => setShowAddModal(false)}>✕</button>
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

            <div className="field-col" style={{ marginTop: '14px' }}>
              <label className="field-label">Email *</label>
              <input className="field-input" type="email" placeholder="tenant@email.com" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
            </div>

            <div className="field-row" style={{ marginTop: '14px' }}>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Phone</label>
                <PhoneInput
                  value={addForm.phone}
                  onChange={e164 => setAddForm(f => ({ ...f, phone: e164 }))}
                />
              </div>
              <div className="field-col" style={{ marginBottom: 0 }}>
                <label className="field-label">Property *</label>
                <select className="field-input" value={addForm.property} onChange={e => setAddForm(f => ({ ...f, property: e.target.value }))}>
                  <option value="">Select property</option>
                  {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="field-col" style={{ marginTop: '14px' }}>
              <label className="field-label">Desired Move-in</label>
              <input className="field-input" placeholder="e.g. August 2026" value={addForm.move_in_date} onChange={e => setAddForm(f => ({ ...f, move_in_date: e.target.value }))} />
            </div>

            <div style={{ background: '#fdf9ec', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginTop: '16px', marginBottom: '20px', fontSize: '12px', color: '#92400e' }}>
              📧 HomeHive will automatically email this lead a personalized pre-screen invitation.
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>Cancel</button>
              <button
                className="btn-gold"
                style={{ flex: 2 }}
                disabled={!addForm.first_name || !addForm.email || !addForm.property || addingLead}
                onClick={handleAddLead}
              >
                {addingLead ? 'Adding…' : 'Add Lead + Send Pre-screen →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── UNLOCK MODAL ── */}
      {unlockModalLeadId && (
        <UnlockModal
          leadId={unlockModalLeadId}
          onSuccess={handleUnlockSuccess}
          onClose={() => setUnlockModalLeadId(null)}
        />
      )}
    </>
  )
}
