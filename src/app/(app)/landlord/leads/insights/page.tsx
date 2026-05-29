'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getLeadsForSlugs, updateLeadStatus } from '@/lib/leads'
import type { Lead } from '@/lib/leads'
import { usePostHog } from 'posthog-js/react'

const UnlockModal = dynamic(() => import('@/components/leads/UnlockModal'), { ssr: false })

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',           color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',   border: 'rgba(59,130,246,0.25)' },
  contacted:      { label: 'Contacted',     color: '#f97316', bg: 'rgba(249,115,22,0.08)',   border: 'rgba(249,115,22,0.25)' },
  follow_up:      { label: 'Follow Up',     color: '#c2410c', bg: 'rgba(194,65,12,0.08)',    border: 'rgba(194,65,12,0.25)' },
  engaged:        { label: 'Engaged',       color: '#eab308', bg: 'rgba(234,179,8,0.08)',    border: 'rgba(234,179,8,0.3)' },
  qualified:      { label: 'Qualified',     color: '#10b981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.25)' },
  matching:       { label: 'Matching',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',   border: 'rgba(139,92,246,0.25)' },
  cold:           { label: 'Cold',          color: '#64748b', bg: 'rgba(100,116,139,0.08)',  border: 'rgba(100,116,139,0.25)' },
  tour_scheduled: { label: 'Qualified',     color: '#10b981', bg: 'rgba(16,185,129,0.08)',   border: 'rgba(16,185,129,0.25)' },
  closed:         { label: 'Closed',        color: '#6b7280', bg: 'rgba(107,114,128,0.08)',  border: 'rgba(107,114,128,0.25)' },
}

function insightNextStatus(current: Lead['status']): Lead['status'] | null {
  const map: Partial<Record<Lead['status'], Lead['status']>> = {
    new: 'contacted', contacted: 'follow_up', follow_up: 'cold', engaged: 'follow_up', cold: 'follow_up',
  }
  return map[current] ?? null
}

function staleDays(lead: Lead): number {
  return Math.floor((Date.now() - new Date(lead.created_at || 0).getTime()) / 86400000)
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

type Property = { slug: string; name: string; address: string }

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

export default function InsightsPage() {
  const router = useRouter()
  const ph = usePostHog()
  const [userId, setUserId] = useState<string | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [emailPreview, setEmailPreview] = useState<{ lead: Lead; subject: string; html: string } | null>(null)
  const [remindingId, setRemindingId] = useState<string | null>(null)
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set())
  const [freeLeadIds, setFreeLeadIds] = useState<Set<string>>(new Set())
  const [unlockModalLeadId, setUnlockModalLeadId] = useState<string | null>(null)
  const [lastContactedAt, setLastContactedAt] = useState<Record<string, string>>({})
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [selectedInsightIds, setSelectedInsightIds] = useState<Set<string>>(new Set())
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }
  const isLeadVisible = (lead: Lead) => freeLeadIds.has(lead.id) || unlockedIds.has(lead.id)

  useEffect(() => { document.title = 'Insights — Leads | HomeHive' }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('hh_dismissed_insights')
      if (!raw) return
      const entries: { id: string; expires: number }[] = JSON.parse(raw)
      const now = Date.now()
      const valid = entries.filter(e => e.expires > now)
      setDismissedIds(new Set(valid.map(e => e.id)))
      if (valid.length !== entries.length) localStorage.setItem('hh_dismissed_insights', JSON.stringify(valid))
    } catch {}
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
    })
  }, [router])

  const loadLeads = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const [{ data: propertiesData }, { data: unlocks }, { data: plan }] = await Promise.all([
      supabase.from('properties').select('slug, name, address').eq('owner_id', userId),
      supabase.from('lead_unlocks').select('lead_id').eq('landlord_id', userId),
      supabase.from('landlord_plans').select('plan_type, status').eq('landlord_id', userId).eq('status', 'active').maybeSingle(),
    ])
    const props = (propertiesData || []) as Property[]
    setProperties(props)
    const slugs = props.map(p => p.slug).filter(Boolean) as string[]
    if (slugs.length === 0) { setLeads([]); setLoading(false); return }

    const leadsData = await getLeadsForSlugs(slugs)
    leadsData.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

    const contactsRes = await fetch('/api/leads/recent-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: leadsData.map(l => l.id) }),
    })

    setLeads(leadsData)
    setFreeLeadIds(computeFreeLeadIds(leadsData))

    const lastContactMap: Record<string, string> = contactsRes.ok ? await contactsRes.json() : {}
    setLastContactedAt(lastContactMap)

    const hasPlan = plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)
    if (hasPlan) {
      setUnlockedIds(new Set(leadsData.map(l => l.id)))
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setUnlockedIds(new Set((unlocks || []).map((u: any) => u.lead_id)))
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { loadLeads() }, [loadLeads])

  useEffect(() => {
    if (!userId || freeLeadIds.size === 0) return
    const toAutoUnlock = [...freeLeadIds].filter(id => !unlockedIds.has(id))
    for (const leadId of toAutoUnlock) {
      fetch(`/api/leads/${leadId}/unlock`, { method: 'POST' }).catch(() => {})
    }
  }, [userId, freeLeadIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissSuggestion = (id: string) => {
    setDismissedIds(prev => new Set([...prev, id]))
    try {
      const raw = localStorage.getItem('hh_dismissed_insights')
      const entries: { id: string; expires: number }[] = raw ? JSON.parse(raw) : []
      const expires = Date.now() + 7 * 24 * 60 * 60 * 1000
      const updated = entries.filter(e => e.id !== id && e.expires > Date.now())
      updated.push({ id, expires })
      localStorage.setItem('hh_dismissed_insights', JSON.stringify(updated))
    } catch {}
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

  const sendReminderCore = async (lead: Lead) => {
    const res = await fetch(`/api/leads/${lead.id}/send-reminder`, { method: 'POST' })
    if (res.ok) {
      setLastContactedAt(prev => ({ ...prev, [lead.id]: new Date().toISOString() }))
      const nextStatus = insightNextStatus(lead.status)
      if (nextStatus) {
        setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: nextStatus } : l))
        await updateLeadStatus(lead.id, nextStatus)
        ph?.capture('lead_insight_sent', { lead_id: lead.id, property: lead.property, from_status: lead.status, to_status: nextStatus })
      }
    }
    return res.ok
  }

  const sendInsightReminder = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation()
    setRemindingId(lead.id)
    try {
      const ok = await sendReminderCore(lead)
      if (ok) {
        const nextStatus = insightNextStatus(lead.status)
        showToast(nextStatus ? `Email sent · Moved to ${STATUS_META[nextStatus]?.label}` : `Email sent to ${lead.first_name || lead.email}`)
      } else showToast('Failed to send email')
    } catch { showToast('Failed to send email') }
    setRemindingId(null)
  }

  const bulkSendReminders = async (suggestions: Suggestion[]) => {
    const targets = suggestions.filter(s => s.cta === 'remind')
    if (targets.length === 0) return
    setBulkSending(true)
    setBulkProgress({ done: 0, total: targets.length })
    let sent = 0; let failed = 0
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ done: i, total: targets.length })
      try {
        const ok = await sendReminderCore(targets[i].lead)
        if (ok) sent++; else failed++
      } catch { failed++ }
    }
    setBulkProgress(null)
    setBulkSending(false)
    setSelectedInsightIds(new Set())
    showToast(failed === 0 ? `✓ ${sent} email${sent !== 1 ? 's' : ''} sent` : `${sent} sent · ${failed} failed`)
  }

  function buildPreviewEmail(lead: Lead, propName: string): { subject: string; html: string } {
    const prescreenDone = ['qualified', 'tour_scheduled', 'closed'].includes(lead.status)
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
    const prescreenUrl = `${siteUrl}/pre-screen/${lead.id}`
    const firstName = lead.first_name || 'there'
    const header = `<div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;"><div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div><div style="font-size:12px;color:#9b9b9b;margin-top:4px;">Student Housing Near ASU</div></div>`
    const footer = `<div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></div>`
    if (prescreenDone) {
      const subject = `${firstName}, you're already in — we'll be in touch soon! 🎉`
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:32px 16px;">${header}<div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;"><div style="text-align:center;margin-bottom:20px;"><div style="width:64px;height:64px;border-radius:50%;background:#FFC627;display:inline-flex;align-items:center;justify-content:center;font-size:26px;">🎉</div></div><p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;text-align:center;">You're all set, ${firstName}!</p><p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;text-align:center;">Thanks for completing your pre-screen for <strong>${propName}</strong>. Our team is reviewing your profile and we'll be in touch soon!</p></div>${footer}</div></body></html>`
      return { subject, html }
    }
    const subject = `${firstName}, your spot at ${propName} is still waiting`
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><div style="max-width:540px;margin:0 auto;padding:32px 16px;">${header}<div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;"><p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">Hey ${firstName}!</p><p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;">Your spot at <strong>${propName}</strong> is still available. You're just a 2-minute pre-screen away from locking it in. 🏠</p><div style="text-align:center;margin:24px 0;"><a href="${prescreenUrl}" style="display:inline-block;background:#FFC627;color:#1a1a1a;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:10px;">Complete My Pre-Screen →</a></div></div>${footer}</div></body></html>`
    return { subject, html }
  }

  // ── Suggestion engine ──
  const visibleActiveLeads = leads.filter(l => l.status !== 'closed' && isLeadVisible(l))
  const suggestions: Suggestion[] = []

  for (const lead of visibleActiveLeads) {
    const isHot = ['qualified', 'tour_scheduled'].includes(lead.status)
    if (!isHot && lastContactedAt[lead.id]) {
      const hoursAgo = (Date.now() - new Date(lastContactedAt[lead.id]).getTime()) / 3600000
      if (hoursAgo < 24) continue
    }
    const days = staleDays(lead)
    const prop = properties.find(p => p.slug === lead.property)
    const propName = prop?.name || lead.property || 'your property'
    const firstName = lead.first_name || 'This lead'

    if (lead.status === 'new' && days >= 1 && days < 3) {
      suggestions.push({ id: lead.id + '_new_warm', priority: 'medium', emoji: '📬', headline: `${firstName} just came in — send first outreach`, body: `New leads contacted within the first hour are 7× more likely to respond. ${firstName} signed up ${days === 1 ? 'yesterday' : `${days} days ago`} for ${propName}. Sending will move them to Contacted.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'new' && days >= 3 && days < 7) {
      suggestions.push({ id: lead.id + '_new_stale', priority: 'urgent', emoji: '🔥', headline: `${firstName} is waiting ${days} days — contact now`, body: `Leads without contact after 3 days drop off 60% of the time. Sending the pre-screen nudge will move them to Contacted.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'new' && days >= 7) {
      suggestions.push({ id: lead.id + '_new_lost', priority: 'urgent', emoji: '⚠️', headline: `${firstName} is going cold — final outreach`, body: `${days} days with no contact. One message now moves them to Contacted — or close as lost to keep your pipeline clean.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'contacted' && days >= 2 && days < 5) {
      suggestions.push({ id: lead.id + '_contacted_follow', priority: 'medium', emoji: '📞', headline: `Follow up with ${firstName} — ${days}d since first contact`, body: `A second touch-point increases reply rates by 3×. Sending will move them to Follow Up.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'contacted' && days >= 5 && days < 14) {
      suggestions.push({ id: lead.id + '_contacted_urgent', priority: 'urgent', emoji: '⏰', headline: `${firstName} hasn't responded in ${days} days`, body: `Try a different channel or send another email. Sending moves them to Follow Up.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'contacted' && days >= 14) {
      suggestions.push({ id: lead.id + '_contacted_final', priority: 'urgent', emoji: '🚨', headline: `${firstName} may be lost — final follow-up`, body: `${days} days of silence. One last send moves them to Follow Up. No response after that → mark Cold or close as lost.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'follow_up' && days < 14) {
      suggestions.push({ id: lead.id + '_followup_check', priority: 'medium', emoji: '🔄', headline: `${firstName} is in follow-up — send another nudge`, body: `You've already reached out. One more send keeps the conversation going.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'follow_up' && days >= 14) {
      suggestions.push({ id: lead.id + '_followup_cold', priority: 'urgent', emoji: '❄️', headline: `${firstName} is going cold — last attempt`, body: `${days} days in the follow-up queue with no response. Sending this final message moves them to Cold.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'engaged' && days >= 4 && days < 10) {
      suggestions.push({ id: lead.id + '_engaged_push', priority: 'medium', emoji: '💬', headline: `Push ${firstName} to complete their pre-screen`, body: `${firstName} engaged ${days} days ago. Nudge them to finish the pre-screen. Sending moves them to Follow Up.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'engaged' && days >= 10) {
      suggestions.push({ id: lead.id + '_engaged_reactivate', priority: 'urgent', emoji: '🔔', headline: `Re-activate ${firstName} — ${days}d stalled at Engaged`, body: `They showed real interest but stopped. One message reopens the conversation.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'cold' && days < 30) {
      suggestions.push({ id: lead.id + '_cold_reactivate', priority: 'low', emoji: '🌱', headline: `Try reactivating ${firstName}`, body: `${firstName} went cold ${days} days ago. A short "still looking?" note sometimes works. Sending moves them back to Follow Up.`, lead, cta: 'remind', propName })
    } else if (lead.status === 'qualified' && days >= 2 && days < 7) {
      suggestions.push({ id: lead.id + '_qual_tour', priority: 'medium', emoji: '🏠', headline: `Invite ${firstName} to tour ${propName}`, body: `${firstName} completed their pre-screen ${days} days ago — they're your most serious candidate. Strike while they're warm.`, lead, cta: 'view', propName })
    } else if (lead.status === 'qualified' && days >= 7) {
      suggestions.push({ id: lead.id + '_qual_urgent', priority: 'urgent', emoji: '⚡', headline: `${firstName} qualified ${days}d ago — close the deal`, body: `Pre-screened and interested. Don't let another landlord swoop in — book the tour today.`, lead, cta: 'view', propName })
    }
  }

  suggestions.sort((a, b) => {
    const p = { urgent: 0, medium: 1, low: 2 }
    if (p[a.priority] !== p[b.priority]) return p[a.priority] - p[b.priority]
    return staleDays(b.lead) - staleDays(a.lead)
  })

  const visibleSuggestions = suggestions.filter(s => !dismissedIds.has(s.id))
  const urgentCount = visibleSuggestions.filter(s => s.priority === 'urgent').length

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: 72, borderRadius: 10, marginBottom: 8, background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        ))}
        <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        .ins-subnav { background: #fff; border-bottom: 1px solid #e8e5de; padding: 0 24px; display: flex; align-items: center; }
        .ins-subnav-link { padding: 13px 16px; font-size: 13px; font-weight: 500; color: #6b6b6b; text-decoration: none; border-bottom: 2px solid transparent; white-space: nowrap; transition: color 0.12s; }
        .ins-subnav-link:hover { color: #1a1a1a; }
        .ins-subnav-link.active { color: #8C1D40; font-weight: 700; border-bottom-color: #8C1D40; }
        .ins-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>

      {toast && <div className="ins-toast">✓ {toast}</div>}

      {/* Sub-nav */}
      <div className="ins-subnav">
        <a href="/landlord/leads" className="ins-subnav-link">Overview</a>
        <a href="/landlord/leads/insights" className="ins-subnav-link active">
          Insights{urgentCount > 0 ? ` (${urgentCount})` : ''}
        </a>
        <a href="/landlord/leads/list" className="ins-subnav-link">All Leads</a>
      </div>

      <div style={{ padding: '16px 20px', fontFamily: "'DM Sans', sans-serif", maxWidth: 960, margin: '0 auto' }}>
        {visibleSuggestions.length === 0 ? (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '32px', textAlign: 'center', marginTop: 20 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#166534', marginBottom: 6 }}>You&apos;re all caught up!</div>
            <div style={{ fontSize: 13, color: '#16a34a' }}>No follow-ups needed right now. Check back as new leads come in.</div>
          </div>
        ) : (
          <>
            {/* Bulk action bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              {urgentCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#dc2626' }}>
                  🚨 {urgentCount} urgent
                </div>
              )}
              <button
                disabled={bulkSending}
                onClick={() => bulkSendReminders(visibleSuggestions.filter(s => s.priority === 'urgent'))}
                style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: urgentCount > 0 ? '#dc2626' : '#94a3b8', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: urgentCount > 0 && !bulkSending ? 'pointer' : 'default', fontFamily: "'DM Sans', sans-serif", opacity: bulkSending ? 0.6 : 1 }}
              >
                {bulkProgress ? `Sending ${bulkProgress.done + 1}/${bulkProgress.total}…` : `📧 Send All Urgent (${urgentCount})`}
              </button>
              {selectedInsightIds.size > 0 && (
                <button
                  disabled={bulkSending}
                  onClick={() => bulkSendReminders(visibleSuggestions.filter(s => selectedInsightIds.has(s.id)))}
                  style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#8C1D40', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  📧 Send Selected ({selectedInsightIds.size})
                </button>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer', marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={selectedInsightIds.size === visibleSuggestions.filter(s => s.cta === 'remind').length && visibleSuggestions.length > 0}
                  onChange={e => {
                    if (e.target.checked) setSelectedInsightIds(new Set(visibleSuggestions.filter(s => s.cta === 'remind').map(s => s.id)))
                    else setSelectedInsightIds(new Set())
                  }}
                />
                Select all
              </label>
            </div>

            {/* Suggestions table */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 28 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '32px 22px 1fr 90px 110px 50px 160px', gap: 0, padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px', alignItems: 'center' }}>
                <div /><div /><div>Lead</div><div>Status</div><div>Property</div><div>Days</div><div style={{ textAlign: 'right' }}>Actions</div>
              </div>
              {visibleSuggestions.map((s, idx) => {
                const accentColors = { urgent: '#dc2626', medium: '#d97706', low: '#16a34a' }
                const propMeta = STATUS_META[s.lead.status]
                const isSelected = selectedInsightIds.has(s.id)
                const isSending = remindingId === s.lead.id || bulkSending
                return (
                  <div
                    key={s.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '32px 22px 1fr 90px 110px 50px 160px', gap: 0,
                      padding: '9px 14px', alignItems: 'center',
                      borderBottom: idx < visibleSuggestions.length - 1 ? '1px solid #f1f5f9' : 'none',
                      background: isSelected ? '#fdf5f7' : '#fff',
                      borderLeft: `3px solid ${accentColors[s.priority]}`,
                      transition: 'background 0.1s',
                    }}
                  >
                    <div>
                      {s.cta === 'remind' && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => setSelectedInsightIds(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(s.id); else next.delete(s.id)
                            return next
                          })}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      {s.priority === 'urgent' ? '🔴' : s.priority === 'medium' ? '🟡' : '🟢'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.lead.first_name} {s.lead.last_name}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.headline}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: propMeta.color, background: propMeta.bg, border: `1px solid ${propMeta.border}`, borderRadius: 20, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                        {propMeta.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.propName}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: accentColors[s.priority] }}>{staleDays(s.lead)}d</div>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {s.cta === 'remind' && (
                        <>
                          <button
                            title="Preview email"
                            style={{ fontSize: 11, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                            onClick={() => { const { subject, html } = buildPreviewEmail(s.lead, s.propName); setEmailPreview({ lead: s.lead, subject, html }) }}
                          >
                            👁
                          </button>
                          <button
                            disabled={isSending}
                            style={{ fontSize: 11, fontWeight: 700, color: '#8C1D40', background: '#fdf2f5', border: '1px solid #f4c9d5', borderRadius: 6, padding: '4px 8px', cursor: isSending ? 'default' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: isSending ? 0.5 : 1 }}
                            onClick={async (e) => { e.stopPropagation(); await sendInsightReminder(s.lead, e) }}
                          >
                            {remindingId === s.lead.id ? '…' : '📧'}
                          </button>
                        </>
                      )}
                      <button
                        style={{ fontSize: 11, color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                        onClick={() => window.open(`/landlord/leads/${s.lead.id}`, '_blank')}
                      >
                        →
                      </button>
                      <button
                        title="Mark as done"
                        style={{ fontSize: 11, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                        onClick={() => { dismissSuggestion(s.id); showToast('Marked as done') }}
                      >
                        ✓
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Follow-up templates */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.7px' }}>
                  Message Templates — copy &amp; personalize
                </div>
              </div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: 'Pre-screen nudge (1-3 days)', subject: 'Still interested in [Property]?', body: 'Hey [Name], just wanted to follow up on your inquiry about [Property]. Completing your 2-min pre-screen moves you to the top of our list — most students who fill it out hear back within 24 hours. Here\'s your link: [pre-screen link]' },
                  { label: 'Re-engagement (7+ days stale)', subject: 'Is [Property] still on your radar?', body: 'Hi [Name], we haven\'t heard back and wanted to check in. [Property] still has availability for your move-in window. If you\'re still interested, a quick reply is all it takes to get the process moving. No pressure either way!' },
                  { label: 'Tour invite (qualified lead)', subject: 'Ready to see [Property] in person?', body: 'Hi [Name]! Your pre-screen looks great — you\'re exactly who we\'re looking for. I\'d love to show you [Property] in person. Are you available [Day/Time Option 1] or [Day/Time Option 2]? Let me know what works!' },
                  { label: 'Final breakup (21+ days no response)', subject: 'Closing your inquiry for [Property]', body: 'Hi [Name], I\'ve tried reaching out a few times about [Property] with no response. I\'m going to go ahead and close this inquiry to keep my list clean. If you\'re still interested, just reply to this email and we\'ll pick back up right away. No hard feelings!' },
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

      {/* Email preview modal */}
      {emailPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(2px)' }} onClick={() => setEmailPreview(null)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.25)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>Email Preview</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>To: <strong style={{ color: '#0f172a' }}>{emailPreview.lead.email}</strong></div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Subject: <strong style={{ color: '#0f172a' }}>{emailPreview.subject}</strong></div>
              </div>
              <button style={{ fontSize: 13, color: '#64748b', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }} onClick={() => setEmailPreview(null)}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: '#f5f4f0' }}>
              <iframe srcDoc={emailPreview.html} style={{ width: '100%', border: 'none', display: 'block' }} height={560} title="Email preview" sandbox="allow-same-origin" />
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
