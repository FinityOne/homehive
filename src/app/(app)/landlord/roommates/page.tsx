'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { formatPhoneDisplay } from '@/components/ui/PhoneInput'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Property = { slug: string; name: string; address: string }

type RoommateGroup = {
  id: string
  name: string
  description: string | null
  property_slug: string | null
  emoji: string
  gender_preference: 'any' | 'girls_only' | 'boys_only'
  share_token: string
  created_at: string
  member_count: number
}

type PropertyRoom = { id: string; name: string; price: number; is_available: boolean }

type GroupMember = {
  id: string
  lead_id: string
  notes: string | null
  added_at: string
  room_id: string | null
  has_prescreen: boolean
  leads: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string
    phone: string | null
    status: string
    property: string | null
    created_at: string | null
    move_in_date: string | null
  } | null
}

type GroupDetail = { group: RoommateGroup; members: GroupMember[] }

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

const GENDER_PREF_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  any:        { label: 'Open to All', color: '#059669', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)' },
  girls_only: { label: 'Girls Only',  color: '#db2777', bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.25)' },
  boys_only:  { label: 'Boys Only',   color: '#2563eb', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)' },
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:            { label: 'New',           color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',   border: 'rgba(59,130,246,0.25)' },
  contacted:      { label: 'Contacted',     color: '#f97316', bg: 'rgba(249,115,22,0.08)',   border: 'rgba(249,115,22,0.25)' },
  follow_up:      { label: 'Follow Up',     color: '#c2410c', bg: 'rgba(194,65,12,0.08)',    border: 'rgba(194,65,12,0.25)' },
  engaged:        { label: 'Engaged',       color: '#eab308', bg: 'rgba(234,179,8,0.08)',    border: 'rgba(234,179,8,0.3)' },
  cold:           { label: 'Cold',          color: '#64748b', bg: 'rgba(100,116,139,0.08)',  border: 'rgba(100,116,139,0.25)' },
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

const GROUP_EMOJIS = ['🏠', '🏡', '🏢', '🛋️', '🗝️', '🌟', '👥', '🎓', '🎯', '🏆']

export default function RoommatesPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [roommateGroups, setRoommateGroups] = useState<RoommateGroup[]>([])
  const [roommateLoading, setRoommateLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<GroupDetail | null>(null)
  const [groupDetailLoading, setGroupDetailLoading] = useState(false)
  const [createGroupModal, setCreateGroupModal] = useState(false)
  const [createGroupForm, setCreateGroupForm] = useState({ name: '', description: '', property_slug: '', emoji: '🏠', gender_preference: 'any' })
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null)
  const [deletingGroup, setDeletingGroup] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [copiedShareToken, setCopiedShareToken] = useState<string | null>(null)
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null)
  const [propertyRooms, setPropertyRooms] = useState<PropertyRoom[]>([])
  const [assigningRoom, setAssigningRoom] = useState<string | null>(null)
  const [editGroupModal, setEditGroupModal] = useState(false)
  const [editGroupForm, setEditGroupForm] = useState({ name: '', description: '', gender_preference: 'any' })
  const [savingGroup, setSavingGroup] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  const loadRoommateGroups = useCallback(async () => {
    if (!userId) return
    setRoommateLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/roommate-groups', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (res.ok) {
      const { groups } = await res.json()
      setRoommateGroups(groups || [])
    }
    setRoommateLoading(false)
  }, [userId])

  const loadGroupDetail = async (groupId: string) => {
    setGroupDetailLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/roommate-groups/${groupId}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (res.ok) {
      const detail = await res.json()
      setSelectedGroup(detail)
      // Load rooms for the linked property
      if (detail.group?.property_slug) {
        const prop = properties.find((p: Property) => p.slug === detail.group.property_slug)
        if (prop) {
          const { data: rooms } = await supabase
            .from('property_rooms')
            .select('id, name, price, is_available')
            .eq('property_id', (await supabase.from('properties').select('id').eq('slug', prop.slug).single()).data?.id)
            .order('position', { ascending: true })
          setPropertyRooms((rooms || []) as PropertyRoom[])
        }
      } else {
        setPropertyRooms([])
      }
    }
    setGroupDetailLoading(false)
  }

  const handleAssignRoom = async (groupId: string, leadId: string, roomId: string | null) => {
    setAssigningRoom(leadId)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/roommate-groups/${groupId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ lead_id: leadId, room_id: roomId }),
    })
    if (res.ok) {
      setSelectedGroup(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.lead_id === leadId ? { ...m, room_id: roomId } : m),
      } : prev)
      showToast(roomId ? 'Room assigned' : 'Room cleared')
    }
    setAssigningRoom(null)
  }

  const copyShareLink = (shareToken: string) => {
    const url = `${SITE_URL}/groups/${shareToken}`
    navigator.clipboard.writeText(url)
    setCopiedShareToken(shareToken)
    setTimeout(() => setCopiedShareToken(null), 2500)
  }

  const copyPhone = (phone: string) => {
    navigator.clipboard.writeText(phone)
    setCopiedPhone(phone)
    setTimeout(() => setCopiedPhone(null), 2000)
  }

  const openEditModal = () => {
    if (!selectedGroup) return
    setEditGroupForm({
      name: selectedGroup.group.name,
      description: selectedGroup.group.description ?? '',
      gender_preference: selectedGroup.group.gender_preference ?? 'any',
    })
    setEditGroupModal(true)
  }

  const handleSaveGroup = async () => {
    if (!selectedGroup || !editGroupForm.name.trim()) return
    setSavingGroup(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/roommate-groups/${selectedGroup.group.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        name: editGroupForm.name.trim(),
        description: editGroupForm.description || null,
        gender_preference: editGroupForm.gender_preference,
      }),
    })
    if (res.ok) {
      setSelectedGroup(prev => prev ? {
        ...prev,
        group: {
          ...prev.group,
          name: editGroupForm.name.trim(),
          description: editGroupForm.description || null,
          gender_preference: editGroupForm.gender_preference as 'any' | 'girls_only' | 'boys_only',
        },
      } : prev)
      setRoommateGroups(prev => prev.map(g => g.id === selectedGroup.group.id
        ? { ...g, name: editGroupForm.name.trim(), description: editGroupForm.description || null, gender_preference: editGroupForm.gender_preference as 'any' | 'girls_only' | 'boys_only' }
        : g
      ))
      setEditGroupModal(false)
      showToast('Group updated')
    } else {
      showToast('Failed to save')
    }
    setSavingGroup(false)
  }

  const handleCreateGroup = async () => {
    if (!createGroupForm.name.trim()) return
    setCreatingGroup(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/roommate-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(createGroupForm),
    })
    if (res.ok) {
      setCreateGroupModal(false)
      setCreateGroupForm({ name: '', description: '', property_slug: '', emoji: '🏠', gender_preference: 'any' })
      await loadRoommateGroups()
      showToast('Roommate group created!')
    } else {
      showToast('Failed to create group')
    }
    setCreatingGroup(false)
  }

  const handleRemoveMember = async (groupId: string, leadId: string) => {
    setRemovingMemberId(leadId)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/roommate-groups/${groupId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ lead_id: leadId }),
    })
    if (res.ok) {
      setSelectedGroup(prev => prev ? { ...prev, members: prev.members.filter(m => m.lead_id !== leadId) } : prev)
      setRoommateGroups(prev => prev.map(g => g.id === groupId ? { ...g, member_count: Math.max(0, g.member_count - 1) } : g))
      showToast('Removed from group')
    }
    setRemovingMemberId(null)
  }

  const handleDeleteGroup = async (groupId: string) => {
    setDeletingGroup(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/roommate-groups/${groupId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (res.ok) {
      setDeleteGroupId(null)
      setSelectedGroup(null)
      await loadRoommateGroups()
      showToast('Group deleted')
    }
    setDeletingGroup(false)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      supabase
        .from('properties')
        .select('slug, name, address')
        .eq('owner_id', user.id)
        .then(({ data }) => setProperties((data || []) as Property[]))
    })
  }, [router])

  useEffect(() => {
    if (userId) loadRoommateGroups()
  }, [userId, loadRoommateGroups])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .rm-page { font-family: 'DM Sans', sans-serif; min-height: 100vh; }

        .rm-header {
          background: #fff; border-bottom: 1px solid #e8e5de;
          padding: 20px 28px; display: flex; align-items: center;
          justify-content: space-between; gap: 16px; flex-wrap: wrap;
        }
        .rm-title { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; }
        .rm-subtitle { font-size: 13px; color: #9b9b9b; margin-top: 2px; }

        .btn-primary { background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; white-space: nowrap; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-ghost { background: transparent; color: #9b9b9b; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-ghost:hover { border-color: #8C1D40; color: #8C1D40; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(2px); }
        .modal-card { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto; }
        .modal-title { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .modal-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 22px; }
        .field-label { font-size: 12px; font-weight: 700; color: #1a1a1a; margin-bottom: 5px; display: block; }
        .field-input { width: 100%; padding: 10px 13px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
        .field-input:focus { border-color: #8C1D40; }
        .field-col { display: flex; flex-direction: column; margin-bottom: 14px; }

        .rm-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      <div className="rm-page">
        {toast && <div className="rm-toast">✓ {toast}</div>}

        <div className="rm-header">
          <div>
            <div className="rm-title">Roommate Matching</div>
            <div className="rm-subtitle">
              {roommateGroups.length > 0
                ? `${roommateGroups.length} group${roommateGroups.length !== 1 ? 's' : ''} · organize compatible leads to fill shared units faster`
                : 'Organize compatible leads into groups to fill shared units faster'}
            </div>
          </div>
          {!selectedGroup && (
            <button
              className="btn-primary"
              onClick={() => setCreateGroupModal(true)}
            >
              + New Group
            </button>
          )}
        </div>

        <div style={{ padding: '20px 24px', maxWidth: 1080, margin: '0 auto' }}>

          {/* ─── Group detail view ─── */}
          {selectedGroup ? (
            <div>
              {groupDetailLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#9b9b9b' }}>Loading…</div>
              ) : (
                <>
                  {/* Back + header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <button
                      onClick={() => setSelectedGroup(null)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9b9b9b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0 }}
                    >
                      ← All Groups
                    </button>
                    <div style={{ fontSize: 20, lineHeight: 1 }}>{selectedGroup.group.emoji}</div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>{selectedGroup.group.name}</div>
                      {selectedGroup.group.description && (
                        <div style={{ fontSize: 12, color: '#9b9b9b', marginTop: 2 }}>{selectedGroup.group.description}</div>
                      )}
                    </div>
                    {selectedGroup.group.property_slug && (() => {
                      const prop = properties.find(p => p.slug === selectedGroup.group.property_slug)
                      return prop ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#8C1D40', background: 'rgba(140,29,64,0.07)', border: '1px solid rgba(140,29,64,0.2)', borderRadius: 20, padding: '3px 10px' }}>
                          {prop.name}
                        </span>
                      ) : null
                    })()}
                    {(() => {
                      const gm = GENDER_PREF_META[selectedGroup.group.gender_preference || 'any']
                      return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: gm.color, background: gm.bg, border: `1px solid ${gm.border}`, borderRadius: 20, padding: '3px 10px' }}>
                          {gm.label}
                        </span>
                      )
                    })()}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => copyShareLink(selectedGroup.group.share_token)}
                        style={{ fontSize: 12, fontWeight: 600, color: copiedShareToken === selectedGroup.group.share_token ? '#10b981' : '#1a1a1a', background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        {copiedShareToken === selectedGroup.group.share_token ? '✓ Link Copied!' : '🔗 Copy Share Link'}
                      </button>
                      <button
                        onClick={() => window.open(`${SITE_URL}/groups/${selectedGroup.group.share_token}`, '_blank')}
                        style={{ fontSize: 12, fontWeight: 600, color: '#6b6b6b', background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        Preview →
                      </button>
                      <button
                        onClick={openEditModal}
                        style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                      >
                        ✏️ Edit Group
                      </button>
                      <button
                        onClick={() => setDeleteGroupId(selectedGroup.group.id)}
                        style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
                      >
                        🗑 Delete Group
                      </button>
                    </div>
                  </div>

                  {/* Summary bar */}
                  <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Members', value: selectedGroup.members.length, color: '#1a1a1a' },
                      { label: 'Pre-screened', value: selectedGroup.members.filter(m => m.has_prescreen).length, color: '#10b981' },
                      { label: 'Qualified+', value: selectedGroup.members.filter(m => m.leads && ['qualified', 'tour_scheduled'].includes(m.leads.status)).length, color: '#8b5cf6' },
                      { label: 'Tour Booked', value: selectedGroup.members.filter(m => m.leads?.status === 'tour_scheduled').length, color: '#f97316' },
                    ].map(stat => (
                      <div key={stat.label} style={{ background: '#fff', border: '1px solid #e8e5de', borderRadius: 10, padding: '10px 16px', minWidth: 100, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                        <div style={{ fontSize: 10, color: '#9b9b9b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Members list */}
                  {selectedGroup.members.length === 0 ? (
                    <div style={{ background: '#fff', border: '1px dashed #e8e5de', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>👥</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>No members yet</div>
                      <div style={{ fontSize: 13, color: '#9b9b9b', marginBottom: 16 }}>
                        Open any lead detail page and click "Roommate Groups" to add them here.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {selectedGroup.members.map(member => {
                        const lead = member.leads
                        if (!lead) return null
                        const meta = STATUS_META[lead.status] || STATUS_META['new']
                        const prop = properties.find(p => p.slug === lead.property)
                        const heat = getHeat(lead.created_at)
                        const ins = ((lead.first_name?.[0] || '') + (lead.last_name?.[0] || '')).toUpperCase() || '?'
                        return (
                          <div
                            key={member.id}
                            style={{ background: '#fff', border: '1px solid #e8e5de', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
                          >
                            {/* Avatar */}
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {ins}
                            </div>

                            {/* Name + contact */}
                            <div style={{ flex: 1, minWidth: 160 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {lead.first_name || '—'}{lead.last_name ? ` ${lead.last_name}` : ''}
                                {heat.icon && <span title={heat.label} style={{ fontSize: 12 }}>{heat.icon}</span>}
                              </div>
                              <a href={`mailto:${lead.email}`} style={{ fontSize: 12, color: '#6b9af0', textDecoration: 'none' }}>{lead.email}</a>
                              {lead.phone && (
                                <button
                                  onClick={() => copyPhone(lead.phone!)}
                                  title="Click to copy"
                                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: copiedPhone === lead.phone ? '#10b981' : '#9b9b9b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}
                                >
                                  {copiedPhone === lead.phone ? '✓ Copied' : `📞 ${formatPhoneDisplay(lead.phone)}`}
                                </button>
                              )}
                            </div>

                            {/* Property */}
                            <div style={{ minWidth: 140 }}>
                              {prop ? (
                                <>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{prop.name}</div>
                                  {prop.address && <div style={{ fontSize: 11, color: '#9b9b9b' }}>{prop.address}</div>}
                                </>
                              ) : (
                                <div style={{ fontSize: 12, color: '#b0a898' }}>No property</div>
                              )}
                              {lead.move_in_date && (
                                <div style={{ fontSize: 10, color: '#b0a898', marginTop: 2 }}>Move-in: {lead.move_in_date}</div>
                              )}
                            </div>

                            {/* Status + prescreen */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, border: '1px solid', color: meta.color, background: meta.bg, borderColor: meta.border, whiteSpace: 'nowrap' }}>
                                {meta.label}
                              </span>
                              {member.has_prescreen ? (
                                <span style={{ fontSize: 10, fontWeight: 600, color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                                  ✓ Pre-screen done
                                </span>
                              ) : (
                                <span style={{ fontSize: 10, fontWeight: 600, color: '#f97316', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                                  ⚠ No pre-screen
                                </span>
                              )}
                            </div>

                            {/* Room assignment */}
                            {propertyRooms.length > 0 && (
                              <select
                                value={member.room_id ?? ''}
                                disabled={assigningRoom === lead.id}
                                onChange={e => handleAssignRoom(selectedGroup.group.id, lead.id, e.target.value || null)}
                                style={{ fontSize: 11, padding: '6px 10px', border: '1.5px solid #e8e5de', borderRadius: 7, background: '#fff', color: '#1a1a1a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", minWidth: 130 }}
                              >
                                <option value="">Assign room…</option>
                                {propertyRooms.map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}{r.price ? ` — $${r.price}/mo` : ''}
                                  </option>
                                ))}
                              </select>
                            )}

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button
                                onClick={() => window.open(`/landlord/leads/${lead.id}`, '_blank')}
                                style={{ fontSize: 11, fontWeight: 600, color: '#1a1a1a', background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
                              >
                                View Lead →
                              </button>
                              <button
                                disabled={removingMemberId === lead.id}
                                onClick={() => handleRemoveMember(selectedGroup.group.id, lead.id)}
                                style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                              >
                                {removingMemberId === lead.id ? '…' : '✕'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div style={{ marginTop: 14, fontSize: 11, color: '#b0a898', textAlign: 'right' }}>
                    Group created {timeAgo(selectedGroup.group.created_at)}
                  </div>
                </>
              )}
            </div>

          ) : (
            /* ─── Group grid view ─── */
            <>
              {roommateLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} style={{ height: 120, borderRadius: 12, background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
                  ))}
                </div>
              ) : roommateGroups.length === 0 ? (
                <div style={{ background: '#fff', border: '1.5px dashed #e8e5de', borderRadius: 16, padding: '60px 40px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
                  <div style={{ fontSize: 40, marginBottom: 14 }}>👥</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>No roommate groups yet</div>
                  <div style={{ fontSize: 13, color: '#9b9b9b', lineHeight: 1.7, marginBottom: 22 }}>
                    Create a group to start matching compatible leads. Add leads from their detail pages, then compare them side-by-side here.
                  </div>
                  <button
                    onClick={() => setCreateGroupModal(true)}
                    className="btn-primary"
                    style={{ padding: '12px 24px', fontSize: 14 }}
                  >
                    Create First Group
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                  {roommateGroups.map(group => {
                    const prop = properties.find(p => p.slug === group.property_slug)
                    return (
                      <div
                        key={group.id}
                        onClick={() => loadGroupDetail(group.id)}
                        style={{ background: '#fff', border: '1px solid #e8e5de', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.09)'; (e.currentTarget as HTMLDivElement).style.borderColor = '#c5c1b8' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.borderColor = '#e8e5de' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontSize: 28, lineHeight: 1 }}>{group.emoji}</div>
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>{group.name}</div>
                              {group.description && (
                                <div style={{ fontSize: 11, color: '#9b9b9b', marginTop: 2, lineHeight: 1.4 }}>{group.description}</div>
                              )}
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: '#9b9b9b', whiteSpace: 'nowrap', flexShrink: 0 }}>{timeAgo(group.created_at)}</div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f5f4f0', borderRadius: 7, padding: '5px 10px' }}>
                            <span style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{group.member_count}</span>
                            <span style={{ fontSize: 10, color: '#9b9b9b', fontWeight: 600 }}>MEMBER{group.member_count !== 1 ? 'S' : ''}</span>
                          </div>
                          {prop ? (
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#8C1D40', background: 'rgba(140,29,64,0.06)', border: '1px solid rgba(140,29,64,0.15)', borderRadius: 20, padding: '3px 9px' }}>
                              {prop.name}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#b0a898' }}>Any property</span>
                          )}
                          {(() => {
                            const gm = GENDER_PREF_META[group.gender_preference || 'any']
                            return (
                              <span style={{ fontSize: 10, fontWeight: 700, color: gm.color, background: gm.bg, border: `1px solid ${gm.border}`, borderRadius: 20, padding: '2px 8px' }}>
                                {gm.label}
                              </span>
                            )
                          })()}
                        </div>

                        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontSize: 11, color: '#8C1D40', fontWeight: 600 }}>Open group →</div>
                          <button
                            onClick={e => { e.stopPropagation(); copyShareLink(group.share_token) }}
                            style={{ fontSize: 10, fontWeight: 600, color: copiedShareToken === group.share_token ? '#10b981' : '#9b9b9b', background: 'transparent', border: '1px solid #e8e5de', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                          >
                            {copiedShareToken === group.share_token ? '✓ Copied' : '🔗 Share'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* How-to hint */}
              {roommateGroups.length > 0 && (
                <div style={{ marginTop: 20, background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#6b6b6b', lineHeight: 1.6 }}>
                  <span style={{ fontWeight: 700, color: '#8b5cf6' }}>💡 Tip:</span>{' '}
                  Open any lead detail page and use the{' '}
                  <strong style={{ color: '#1a1a1a' }}>Roommate Groups</strong>{' '}
                  button in the action bar to add that lead to one of your groups.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── CREATE GROUP MODAL ── */}
      {createGroupModal && (
        <div className="modal-overlay" onClick={() => setCreateGroupModal(false)}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div className="modal-title">New Roommate Group</div>
                <div className="modal-sub">Give it a name and optional property filter.</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9b9b9b' }} onClick={() => setCreateGroupModal(false)}>✕</button>
            </div>

            {/* Emoji picker */}
            <div style={{ marginBottom: 16 }}>
              <label className="field-label">Icon</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {GROUP_EMOJIS.map(e => (
                  <button
                    key={e}
                    onClick={() => setCreateGroupForm(f => ({ ...f, emoji: e }))}
                    style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${createGroupForm.emoji === e ? '#8C1D40' : '#e8e5de'}`, background: createGroupForm.emoji === e ? '#fdf2f5' : '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-col">
              <label className="field-label">Group Name *</label>
              <input
                className="field-input"
                placeholder="e.g. Unit 3A Candidates, Fall 2026 Group…"
                value={createGroupForm.name}
                onChange={e => setCreateGroupForm(f => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="field-col">
              <label className="field-label">Description (optional)</label>
              <input
                className="field-input"
                placeholder="e.g. 3 friends looking for a 3-bed"
                value={createGroupForm.description}
                onChange={e => setCreateGroupForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            {properties.length > 0 && (
              <div className="field-col">
                <label className="field-label">Property (optional)</label>
                <select
                  className="field-input"
                  value={createGroupForm.property_slug}
                  onChange={e => setCreateGroupForm(f => ({ ...f, property_slug: e.target.value }))}
                >
                  <option value="">Any property</option>
                  {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
              </div>
            )}

            <div className="field-col">
              <label className="field-label">Gender Preference</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { value: 'any', label: '⚤ Open to All' },
                  { value: 'girls_only', label: '♀ Girls Only' },
                  { value: 'boys_only', label: '♂ Boys Only' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCreateGroupForm(f => ({ ...f, gender_preference: opt.value }))}
                    style={{
                      flex: 1, padding: '8px 6px', border: `2px solid ${createGroupForm.gender_preference === opt.value ? '#8C1D40' : '#e8e5de'}`,
                      borderRadius: 8, background: createGroupForm.gender_preference === opt.value ? '#fdf2f5' : '#fff',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                      color: createGroupForm.gender_preference === opt.value ? '#8C1D40' : '#6b6b6b',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setCreateGroupModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                disabled={!createGroupForm.name.trim() || creatingGroup}
                onClick={handleCreateGroup}
              >
                {creatingGroup ? 'Creating…' : 'Create Group →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT GROUP MODAL ── */}
      {editGroupModal && selectedGroup && (
        <div className="modal-overlay" onClick={() => setEditGroupModal(false)}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div className="modal-title">Edit Group</div>
                <div className="modal-sub">Update name, description, or gender preference.</div>
              </div>
              <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9b9b9b' }} onClick={() => setEditGroupModal(false)}>✕</button>
            </div>

            <div className="field-col">
              <label className="field-label">Group Name *</label>
              <input
                className="field-input"
                value={editGroupForm.name}
                onChange={e => setEditGroupForm(f => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="field-col">
              <label className="field-label">Description (optional)</label>
              <input
                className="field-input"
                placeholder="e.g. 3 friends looking for a 3-bed"
                value={editGroupForm.description}
                onChange={e => setEditGroupForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="field-col">
              <label className="field-label">Gender Preference</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { value: 'any', label: '⚤ Open to All' },
                  { value: 'girls_only', label: '♀ Girls Only' },
                  { value: 'boys_only', label: '♂ Boys Only' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEditGroupForm(f => ({ ...f, gender_preference: opt.value }))}
                    style={{
                      flex: 1, padding: '8px 6px', border: `2px solid ${editGroupForm.gender_preference === opt.value ? '#8C1D40' : '#e8e5de'}`,
                      borderRadius: 8, background: editGroupForm.gender_preference === opt.value ? '#fdf2f5' : '#fff',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                      color: editGroupForm.gender_preference === opt.value ? '#8C1D40' : '#6b6b6b',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setEditGroupModal(false)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                disabled={!editGroupForm.name.trim() || savingGroup}
                onClick={handleSaveGroup}
              >
                {savingGroup ? 'Saving…' : 'Save Changes →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE GROUP CONFIRM ── */}
      {deleteGroupId && (
        <div className="modal-overlay" onClick={() => setDeleteGroupId(null)}>
          <div className="modal-card" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ marginBottom: 8 }}>Delete this group?</div>
            <div style={{ fontSize: 13, color: '#9b9b9b', marginBottom: 24, lineHeight: 1.6 }}>
              This will remove the group and all its member assignments. The leads themselves won't be affected.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setDeleteGroupId(null)}>Cancel</button>
              <button
                style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                disabled={deletingGroup}
                onClick={() => handleDeleteGroup(deleteGroupId)}
              >
                {deletingGroup ? 'Deleting…' : 'Delete Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
