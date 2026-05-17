'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type SMSTemplate = {
  id: string
  name: string
  category: string
  body: string
  position: number
}

const VARIABLES = [
  { token: '{{first_name}}', desc: "Lead's first name" },
  { token: '{{your_name}}', desc: 'Your first name' },
  { token: '{{property_name}}', desc: 'Property name' },
  { token: '{{listing_link}}', desc: 'Full URL to the listing' },
  { token: '{{tour_date}}', desc: 'Relative tour date (e.g. "yesterday", "last Tuesday")' },
]

const CATEGORY_ORDER = ['First Touch', 'Follow-Up', 'Tour', 'Check-In']

export default function CustomizationsPage() {
  const [templates, setTemplates] = useState<SMSTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editBody, setEditBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [activeSection, setActiveSection] = useState<'sms'>('sms')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { document.title = 'Customizations — Landlord | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/sms-templates', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const { templates: data } = await res.json()
        setTemplates(data || [])
      }
      setLoading(false)
    }
    load()
  }, [])

  const startEdit = (t: SMSTemplate) => {
    setEditingId(t.id)
    setEditName(t.name)
    setEditBody(t.body)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditBody('')
  }

  const saveTemplate = async (id: string) => {
    if (!editBody.trim()) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/sms-templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ name: editName, body: editBody }),
    })
    if (res.ok) {
      setTemplates(prev => prev.map(t => t.id === id ? { ...t, name: editName, body: editBody } : t))
      cancelEdit()
      showToast('Template saved')
    } else {
      showToast('Failed to save template', 'error')
    }
    setSaving(false)
  }

  const grouped = CATEGORY_ORDER.reduce<Record<string, SMSTemplate[]>>((acc, cat) => {
    acc[cat] = templates.filter(t => t.category === cat).sort((a, b) => a.position - b.position)
    return acc
  }, {})

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .cust-page { min-height: 100vh; background: #f5f4f0; font-family: 'DM Sans', sans-serif; }
        .cust-layout { display: flex; max-width: 1100px; margin: 0 auto; gap: 0; }

        /* Left sidebar */
        .cust-sidebar { width: 220px; flex-shrink: 0; padding: 32px 0 32px 0; }
        .cust-sidebar-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.7px; padding: 0 20px 10px; }
        .cust-nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 20px; font-size: 13px; font-weight: 500; color: #6b6b6b; cursor: pointer; border-radius: 8px; margin: 0 8px; transition: all 0.12s; }
        .cust-nav-item:hover { background: #ede9e2; color: #1a1a1a; }
        .cust-nav-item.active { background: rgba(140,29,64,0.08); color: #8C1D40; font-weight: 600; }
        .cust-nav-icon { font-size: 14px; width: 20px; text-align: center; }

        /* Main content */
        .cust-main { flex: 1; padding: 32px 28px; min-width: 0; }
        .cust-header { margin-bottom: 24px; }
        .cust-title { font-size: 22px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.3px; }
        .cust-subtitle { font-size: 13px; color: #9b9b9b; margin-top: 4px; line-height: 1.5; }

        /* Variable guide */
        .var-guide { background: #fff; border: 1.5px solid #e8e5de; border-radius: 12px; padding: 16px 18px; margin-bottom: 22px; }
        .var-guide-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; }
        .var-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .var-chip { display: flex; align-items: center; gap: 6px; background: #faf9f6; border: 1px solid #e8e5de; border-radius: 7px; padding: 4px 10px; }
        .var-token { font-size: 11px; font-family: monospace; color: #8C1D40; font-weight: 700; }
        .var-desc { font-size: 11px; color: #9b9b9b; }

        /* Category sections */
        .cust-category { margin-bottom: 28px; }
        .cust-cat-label { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 10px; padding-left: 2px; }

        /* Template card */
        .tmpl-card { background: #fff; border: 1.5px solid #e8e5de; border-radius: 12px; padding: 16px 18px; margin-bottom: 10px; transition: border-color 0.15s; }
        .tmpl-card:hover { border-color: #d0ccc5; }
        .tmpl-card.editing { border-color: #8C1D40; }
        .tmpl-name { font-size: 13px; font-weight: 700; color: #1a1a1a; margin-bottom: 6px; }
        .tmpl-body { font-size: 13px; color: #4a4a4a; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
        .tmpl-actions { display: flex; gap: 8px; margin-top: 12px; }
        .tmpl-edit-btn { font-size: 12px; font-weight: 600; color: #8C1D40; background: none; border: 1px solid rgba(140,29,64,0.25); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.12s; }
        .tmpl-edit-btn:hover { background: rgba(140,29,64,0.06); }

        /* Edit form */
        .tmpl-edit-name { width: 100%; padding: 7px 10px; border: 1.5px solid #e8e5de; border-radius: 7px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; outline: none; margin-bottom: 8px; }
        .tmpl-edit-name:focus { border-color: #8C1D40; }
        .tmpl-edit-body { width: 100%; padding: 10px 12px; border: 1.5px solid #e8e5de; border-radius: 7px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; resize: vertical; outline: none; line-height: 1.65; min-height: 100px; }
        .tmpl-edit-body:focus { border-color: #8C1D40; }
        .tmpl-edit-actions { display: flex; gap: 8px; margin-top: 10px; }
        .btn-save { font-size: 13px; font-weight: 700; background: #8C1D40; color: #fff; border: none; border-radius: 7px; padding: 8px 18px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.55; cursor: not-allowed; }
        .btn-cancel { font-size: 13px; font-weight: 600; background: none; color: #6b6b6b; border: 1.5px solid #e8e5de; border-radius: 7px; padding: 8px 14px; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        /* Toast */
        .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1a1a1a; color: #fff; padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.2); white-space: nowrap; }
        .toast.error { background: #ef4444; }
      `}</style>

      <div className="cust-page">
        <div className="cust-layout">

          {/* Left sidebar */}
          <div className="cust-sidebar">
            <div className="cust-sidebar-title">Customizations</div>
            <div
              className={`cust-nav-item${activeSection === 'sms' ? ' active' : ''}`}
              onClick={() => setActiveSection('sms')}
            >
              <span className="cust-nav-icon">💬</span>
              SMS Templates
            </div>
          </div>

          {/* Main */}
          <div className="cust-main">
            {activeSection === 'sms' && (
              <>
                <div className="cust-header">
                  <div className="cust-title">SMS Templates</div>
                  <div className="cust-subtitle">
                    Personalized text messages you can copy from any lead's detail page.
                    Use variables below to auto-fill lead and property info.
                  </div>
                </div>

                {/* Variable guide */}
                <div className="var-guide">
                  <div className="var-guide-title">Available Variables</div>
                  <div className="var-list">
                    {VARIABLES.map(v => (
                      <div key={v.token} className="var-chip">
                        <span className="var-token">{v.token}</span>
                        <span className="var-desc">— {v.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {loading ? (
                  <div style={{ color: '#9b9b9b', fontSize: '13px', padding: '20px 0' }}>Loading templates…</div>
                ) : (
                  CATEGORY_ORDER.map(cat => {
                    const catTemplates = grouped[cat] || []
                    if (catTemplates.length === 0) return null
                    return (
                      <div key={cat} className="cust-category">
                        <div className="cust-cat-label">{cat}</div>
                        {catTemplates.map(t => (
                          <div key={t.id} className={`tmpl-card${editingId === t.id ? ' editing' : ''}`}>
                            {editingId === t.id ? (
                              <>
                                <input
                                  className="tmpl-edit-name"
                                  value={editName}
                                  onChange={e => setEditName(e.target.value)}
                                  placeholder="Template name"
                                />
                                <textarea
                                  className="tmpl-edit-body"
                                  value={editBody}
                                  onChange={e => setEditBody(e.target.value)}
                                  placeholder="Template body…"
                                />
                                <div className="tmpl-edit-actions">
                                  <button className="btn-save" disabled={saving || !editBody.trim()} onClick={() => saveTemplate(t.id)}>
                                    {saving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button className="btn-cancel" onClick={cancelEdit}>Cancel</button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="tmpl-name">{t.name}</div>
                                <div className="tmpl-body">{t.body}</div>
                                <div className="tmpl-actions">
                                  <button className="tmpl-edit-btn" onClick={() => startEdit(t)}>✎ Edit</button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={`toast${toast.type === 'error' ? ' error' : ''}`}>{toast.msg}</div>
      )}
    </>
  )
}
