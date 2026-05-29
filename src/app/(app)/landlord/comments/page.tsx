'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Comment = {
  id: string
  property_slug: string
  author_name: string
  content: string
  is_hidden: boolean
  created_at: string
  prop_name?: string
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CommentsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [properties, setProperties] = useState<{ slug: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [propertyFilter, setPropertyFilter] = useState<string>('all')
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all')
  const [toast, setToast] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => { document.title = 'Comment Moderation — HomeHive' }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
    })
  }, [router])

  const loadData = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    const { data: props } = await supabase
      .from('properties')
      .select('slug, name')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })

    const propList = (props || []) as { slug: string; name: string }[]
    setProperties(propList)

    if (propList.length === 0) { setComments([]); setLoading(false); return }

    const slugs = propList.map(p => p.slug)
    // Use the anon client with RLS — the landlord_read_all_comments policy returns all (including hidden)
    const { data: raw } = await supabase
      .from('listing_comments')
      .select('id, property_slug, author_name, content, is_hidden, created_at')
      .in('property_slug', slugs)
      .order('created_at', { ascending: false })

    const propMap = Object.fromEntries(propList.map(p => [p.slug, p.name]))
    setComments((raw || []).map((c: Comment) => ({ ...c, prop_name: propMap[c.property_slug] || c.property_slug })))
    setLoading(false)
  }, [userId])

  useEffect(() => { loadData() }, [loadData])

  const toggleVisibility = async (comment: Comment) => {
    setTogglingId(comment.id)
    const res = await fetch(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_hidden: !comment.is_hidden }),
    })
    if (res.ok) {
      setComments(prev => prev.map(c => c.id === comment.id ? { ...c, is_hidden: !c.is_hidden } : c))
      showToast(comment.is_hidden ? 'Comment is now visible' : 'Comment hidden from public')
    } else {
      showToast('Failed to update comment')
    }
    setTogglingId(null)
  }

  const deleteComment = async (id: string) => {
    setDeletingId(id)
    setConfirmDelete(null)
    const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setComments(prev => prev.filter(c => c.id !== id))
      showToast('Comment deleted')
    } else {
      showToast('Failed to delete comment')
    }
    setDeletingId(null)
  }

  const filtered = comments.filter(c => {
    if (propertyFilter !== 'all' && c.property_slug !== propertyFilter) return false
    if (visibilityFilter === 'visible' && c.is_hidden) return false
    if (visibilityFilter === 'hidden' && !c.is_hidden) return false
    return true
  })

  const visibleCount = comments.filter(c => !c.is_hidden).length
  const hiddenCount = comments.filter(c => c.is_hidden).length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .cm-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }
        .cm-header { background: #1a1a1a; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .cm-filters { background: #fff; border-bottom: 1px solid #e8e5de; padding: 10px 24px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .cm-filter-btn { padding: 6px 14px; border-radius: 20px; border: 1.5px solid #e8e5de; background: #fff; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s; color: #6b6b6b; white-space: nowrap; }
        .cm-filter-btn.active { border-color: #8C1D40; color: #8C1D40; font-weight: 700; background: #fdf2f5; }
        .cm-filter-select { padding: 7px 12px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; background: #fff; color: #1a1a1a; cursor: pointer; }
        .cm-body { padding: 20px 24px; max-width: 900px; }
        .cm-card { background: #fff; border: 1px solid #e8e5de; border-radius: 12px; padding: 16px 18px; margin-bottom: 10px; transition: box-shadow 0.12s; }
        .cm-card:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
        .cm-card.hidden-card { opacity: 0.6; background: #fafaf9; }
        .cm-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
        .cm-avatar { width: 30px; height: 30px; border-radius: 50%; background: #e8e5de; color: #6b6b6b; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .cm-author { font-size: 13px; font-weight: 700; color: #1a1a1a; }
        .cm-time { font-size: 11px; color: #b0a898; }
        .cm-prop-badge { font-size: 10px; font-weight: 700; color: #8C1D40; background: rgba(140,29,64,0.08); border: 1px solid rgba(140,29,64,0.2); border-radius: 20px; padding: 2px 8px; white-space: nowrap; }
        .cm-hidden-badge { font-size: 10px; font-weight: 700; color: #94a3b8; background: rgba(148,163,184,0.12); border: 1px solid rgba(148,163,184,0.25); border-radius: 20px; padding: 2px 8px; white-space: nowrap; }
        .cm-content { font-size: 14px; color: #374151; line-height: 1.65; white-space: pre-wrap; margin-bottom: 12px; }
        .cm-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .cm-btn { padding: 5px 12px; border-radius: 7px; border: 1.5px solid; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s; white-space: nowrap; }
        .cm-btn-show { color: #10b981; border-color: #a7f3d0; background: #f0fdf4; }
        .cm-btn-show:hover { background: #d1fae5; }
        .cm-btn-hide { color: #64748b; border-color: #cbd5e1; background: #f8fafc; }
        .cm-btn-hide:hover { background: #e2e8f0; }
        .cm-btn-delete { color: #dc2626; border-color: #fecaca; background: #fef2f2; }
        .cm-btn-delete:hover { background: #fee2e2; }
        .cm-btn-confirm { color: #fff; border-color: #dc2626; background: #dc2626; }
        .cm-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>

      {toast && <div className="cm-toast">✓ {toast}</div>}

      <div className="cm-page">
        <div className="cm-header">
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>Comment Moderation</div>
            <div style={{ fontSize: 12, color: '#9b9b9b', marginTop: 2 }}>
              {comments.length} total · {visibleCount} visible · {hiddenCount} hidden
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="cm-filters">
          {/* Property filter */}
          {properties.length > 1 && (
            <select
              className="cm-filter-select"
              value={propertyFilter}
              onChange={e => setPropertyFilter(e.target.value)}
            >
              <option value="all">All Properties</option>
              {properties.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          )}

          {/* Visibility filter */}
          {(['all', 'visible', 'hidden'] as const).map(v => (
            <button
              key={v}
              className={`cm-filter-btn${visibilityFilter === v ? ' active' : ''}`}
              onClick={() => setVisibilityFilter(v)}
            >
              {v === 'all' ? `All (${comments.length})` : v === 'visible' ? `Visible (${visibleCount})` : `Hidden (${hiddenCount})`}
            </button>
          ))}
        </div>

        <div className="cm-body">
          {loading ? (
            [1, 2, 3].map(i => (
              <div key={i} style={{ height: 100, borderRadius: 12, marginBottom: 10, background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
            ))
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                {comments.length === 0 ? 'No comments yet' : 'No comments match this filter'}
              </div>
              <div style={{ fontSize: 13 }}>
                {comments.length === 0
                  ? 'Comments from your listings will appear here once tenants post them.'
                  : 'Try changing your filter above.'}
              </div>
            </div>
          ) : (
            filtered.map(comment => (
              <div key={comment.id} className={`cm-card${comment.is_hidden ? ' hidden-card' : ''}`}>
                <div className="cm-meta">
                  <div className="cm-avatar">{comment.author_name[0]?.toUpperCase()}</div>
                  <span className="cm-author">{comment.author_name}</span>
                  <span className="cm-time">{timeAgo(comment.created_at)}</span>
                  <span className="cm-prop-badge">{comment.prop_name}</span>
                  {comment.is_hidden && <span className="cm-hidden-badge">Hidden</span>}
                </div>

                <p className="cm-content">{comment.content}</p>

                <div className="cm-actions">
                  {/* Toggle visibility */}
                  <button
                    className={`cm-btn ${comment.is_hidden ? 'cm-btn-show' : 'cm-btn-hide'}`}
                    disabled={togglingId === comment.id}
                    onClick={() => toggleVisibility(comment)}
                  >
                    {togglingId === comment.id
                      ? '…'
                      : comment.is_hidden
                        ? '👁 Show publicly'
                        : '🚫 Hide'}
                  </button>

                  {/* Delete */}
                  {confirmDelete === comment.id ? (
                    <>
                      <button className="cm-btn cm-btn-confirm" onClick={() => deleteComment(comment.id)} disabled={deletingId === comment.id}>
                        {deletingId === comment.id ? '…' : 'Confirm delete'}
                      </button>
                      <button className="cm-btn cm-btn-hide" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="cm-btn cm-btn-delete"
                      onClick={() => setConfirmDelete(comment.id)}
                    >
                      🗑 Delete
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </>
  )
}
