'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  PropertyFaq,
  FAQ_CATEGORIES,
  RECOMMENDED_FAQS,
  getFaqsByPropertyId,
  createFaq,
  updateFaq,
  deleteFaq,
  reorderFaqs,
} from '@/lib/faqs'

type Props = {
  propertyId: string
  slug: string
  isActive: boolean
}

// Order categories by the preset list first, then any custom ones alphabetically.
function sortCategories(cats: string[]): string[] {
  const preset = FAQ_CATEGORIES as readonly string[]
  return [...cats].sort((a, b) => {
    const ia = preset.indexOf(a)
    const ib = preset.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
}

export default function FaqManager({ propertyId, slug, isActive }: Props) {
  const [faqs, setFaqs] = useState<PropertyFaq[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingIds, setSavingIds] = useState<Record<string, 'saving' | 'saved'>>({})
  const [showRecommended, setShowRecommended] = useState(true)

  // New custom question form
  const [draft, setDraft] = useState({ question: '', answer: '', category: 'General' })
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let active = true
    getFaqsByPropertyId(propertyId).then(rows => {
      if (active) { setFaqs(rows); setLoading(false) }
    })
    return () => { active = false }
  }, [propertyId])

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 3000)
  }

  function markSaved(id: string) {
    setSavingIds(s => ({ ...s, [id]: 'saved' }))
    setTimeout(() => setSavingIds(s => { const n = { ...s }; if (n[id] === 'saved') delete n[id]; return n }), 1500)
  }

  // Insert a new FAQ at the end and return it (used by both quick-add and custom add).
  async function addFaq(question: string, answer: string, category: string) {
    const position = faqs.length
    const { data, error } = await createFaq(propertyId, { question, answer, category, position })
    if (error || !data) { flash(false, 'Could not add question. Try again.'); return null }
    setFaqs(prev => [...prev, data])
    return data
  }

  async function handleQuickAdd(rec: { category: string; question: string }) {
    const created = await addFaq(rec.question, '', rec.category)
    if (created) flash(true, 'Question added — now write your answer below.')
  }

  async function handleAddCustom() {
    if (!draft.question.trim()) { flash(false, 'Add a question first.'); return }
    setAdding(true)
    const created = await addFaq(draft.question.trim(), draft.answer.trim(), draft.category || 'General')
    setAdding(false)
    if (created) {
      setDraft({ question: '', answer: '', category: 'General' })
      flash(true, 'Question added!')
    }
  }

  // Update a field locally, and persist on blur.
  function patchLocal(id: string, field: keyof PropertyFaq, value: string) {
    setFaqs(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  async function commitField(id: string, field: 'question' | 'answer' | 'category', value: string) {
    setSavingIds(s => ({ ...s, [id]: 'saving' }))
    const { error } = await updateFaq(id, { [field]: field === 'category' ? (value || 'General') : value })
    if (error) { flash(false, 'Failed to save change.'); setSavingIds(s => { const n = { ...s }; delete n[id]; return n }); return }
    markSaved(id)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this question?')) return
    const prev = faqs
    setFaqs(f => f.filter(x => x.id !== id))
    const { error } = await deleteFaq(id)
    if (error) { setFaqs(prev); flash(false, 'Failed to delete.'); return }
    flash(true, 'Question deleted.')
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = faqs.findIndex(f => f.id === id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= faqs.length) return
    const next = [...faqs]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setFaqs(next)
    await reorderFaqs(next.map(f => f.id))
  }

  // Questions already added (normalized) so we can hide them from recommendations.
  const addedQuestions = useMemo(
    () => new Set(faqs.map(f => f.question.trim().toLowerCase())),
    [faqs]
  )
  const remainingRecommended = RECOMMENDED_FAQS.filter(r => !addedQuestions.has(r.question.trim().toLowerCase()))

  // Group FAQs by category for preview.
  const grouped = useMemo(() => {
    const map: Record<string, PropertyFaq[]> = {}
    for (const f of faqs) { (map[f.category || 'General'] ??= []).push(f) }
    return sortCategories(Object.keys(map)).map(cat => ({ cat, items: map[cat] }))
  }, [faqs])

  const answeredCount = faqs.filter(f => f.answer.trim()).length
  const liveUrl = `/homes/${slug}/faq`

  if (loading) {
    return <div style={{ padding: 24, fontSize: 14, color: '#9b9b9b' }}>Loading FAQs…</div>
  }

  return (
    <div className="faq-mgr">
      <style>{FAQ_CSS}</style>

      {/* Header / toggle */}
      <div className="faq-top">
        <div>
          <div className="faq-h1">Frequently Asked Questions</div>
          <div className="faq-sub">
            {faqs.length === 0
              ? 'Answer the questions students ask most — before they have to ask.'
              : `${faqs.length} question${faqs.length !== 1 ? 's' : ''} · ${answeredCount} answered`}
          </div>
        </div>
        <div className="faq-toggle">
          <button className={`faq-tog-btn${mode === 'edit' ? ' on' : ''}`} onClick={() => setMode('edit')}>Edit</button>
          <button className={`faq-tog-btn${mode === 'preview' ? ' on' : ''}`} onClick={() => setMode('preview')}>Preview</button>
        </div>
      </div>

      {msg && <div className={msg.ok ? 'alert-ok' : 'alert-err'}>{msg.text}</div>}

      {mode === 'preview' ? (
        /* ── PREVIEW MODE — how it looks to students ───────────────── */
        <div className="faq-preview-wrap">
          <div className="faq-preview-banner">
            👁 This is how your FAQ appears on the public listing page.
            {isActive
              ? <> <a href={liveUrl} target="_blank" rel="noopener noreferrer">Open live page ↗</a></>
              : <> Your listing isn’t live yet — this preview shows the real layout.</>}
          </div>
          {faqs.length === 0 ? (
            <div className="faq-empty">No questions yet. Switch to Edit to add some.</div>
          ) : (
            grouped.map(({ cat, items }) => (
              <div key={cat} className="faq-pv-group">
                <div className="faq-pv-cat">{cat}</div>
                {items.map(f => (
                  <details key={f.id} className="faq-pv-item">
                    <summary>{f.question}</summary>
                    <div className="faq-pv-answer">{f.answer.trim() || <em style={{ color: '#b0a898' }}>No answer yet.</em>}</div>
                  </details>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        /* ── EDIT MODE ─────────────────────────────────────────────── */
        <>
          {/* Recommended quick-add */}
          {remainingRecommended.length > 0 && (
            <div className="faq-rec">
              <div className="faq-rec-hdr" onClick={() => setShowRecommended(s => !s)}>
                <span className="faq-rec-title">✨ Recommended questions — one click to add</span>
                <span className="faq-rec-chevron">{showRecommended ? '▲' : '▼'}</span>
              </div>
              {showRecommended && (
                <div className="faq-rec-body">
                  {remainingRecommended.map((r, i) => (
                    <button key={i} className="faq-rec-pill" onClick={() => handleQuickAdd(r)} title={`Add to ${r.category}`}>
                      <span className="faq-rec-cat">{r.category}</span>
                      {r.question}
                      <span className="faq-rec-plus">+</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Existing FAQs — editable */}
          {faqs.length > 0 && (
            <div className="faq-list">
              {faqs.map((f, i) => {
                const status = savingIds[f.id]
                return (
                  <div key={f.id} className="faq-card">
                    <div className="faq-card-top">
                      <div className="faq-reorder">
                        <button className="faq-mv" disabled={i === 0} onClick={() => move(f.id, -1)} title="Move up">↑</button>
                        <button className="faq-mv" disabled={i === faqs.length - 1} onClick={() => move(f.id, 1)} title="Move down">↓</button>
                      </div>
                      <input
                        className="fi faq-cat-input"
                        list="faq-cat-list"
                        value={f.category}
                        onChange={e => patchLocal(f.id, 'category', e.target.value)}
                        onBlur={e => commitField(f.id, 'category', e.target.value)}
                        placeholder="Category"
                      />
                      <span className="faq-save-state">
                        {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : ''}
                      </span>
                      <button className="btn-rm" onClick={() => handleDelete(f.id)} title="Delete">×</button>
                    </div>
                    <input
                      className="fi faq-q-input"
                      value={f.question}
                      onChange={e => patchLocal(f.id, 'question', e.target.value)}
                      onBlur={e => commitField(f.id, 'question', e.target.value)}
                      placeholder="Question"
                    />
                    <textarea
                      className="ft"
                      value={f.answer}
                      onChange={e => patchLocal(f.id, 'answer', e.target.value)}
                      onBlur={e => commitField(f.id, 'answer', e.target.value)}
                      placeholder="Write your answer here…"
                      style={{ minHeight: 70, marginTop: 8 }}
                    />
                    {!f.answer.trim() && <div className="faq-needs-answer">Needs an answer</div>}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add custom question */}
          <div className="faq-add">
            <div className="faq-add-title">Add your own question</div>
            <div className="faq-add-row">
              <input
                className="fi"
                value={draft.question}
                onChange={e => setDraft(d => ({ ...d, question: e.target.value }))}
                placeholder="e.g. Is there a bike storage room?"
              />
              <input
                className="fi faq-cat-input"
                list="faq-cat-list"
                value={draft.category}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                placeholder="Category"
              />
            </div>
            <textarea
              className="ft"
              value={draft.answer}
              onChange={e => setDraft(d => ({ ...d, answer: e.target.value }))}
              placeholder="Answer (you can fill this in later too)"
              style={{ minHeight: 60, marginTop: 8 }}
            />
            <button className="btn-save" style={{ marginTop: 12 }} onClick={handleAddCustom} disabled={adding}>
              {adding ? 'Adding…' : '+ Add Question'}
            </button>
          </div>

          {isActive && faqs.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
              Live page: <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#10b981', fontWeight: 600 }}>{liveUrl} ↗</a>
            </div>
          )}

          <datalist id="faq-cat-list">
            {FAQ_CATEGORIES.map(c => <option key={c} value={c} />)}
          </datalist>
        </>
      )}
    </div>
  )
}

const FAQ_CSS = `
  .faq-mgr { font-family: 'DM Sans', sans-serif; }
  .faq-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .faq-h1 { font-size: 17px; font-weight: 700; color: #0f172a; }
  .faq-sub { font-size: 13px; color: #64748b; margin-top: 3px; }
  .faq-toggle { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
  .faq-tog-btn { border: none; background: none; font-family: inherit; font-size: 13px; font-weight: 600; color: #64748b; padding: 6px 16px; border-radius: 7px; cursor: pointer; transition: all 0.15s; }
  .faq-tog-btn.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

  /* Recommended */
  .faq-rec { border: 1.5px dashed #c7d2fe; background: #f5f7ff; border-radius: 12px; margin-bottom: 18px; overflow: hidden; }
  .faq-rec-hdr { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; }
  .faq-rec-title { font-size: 13px; font-weight: 700; color: #4338ca; }
  .faq-rec-chevron { font-size: 10px; color: #6366f1; }
  .faq-rec-body { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 16px; }
  .faq-rec-pill { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: 1.5px solid #e0e7ff; border-radius: 999px; padding: 7px 12px 7px 7px; font-family: inherit; font-size: 12.5px; color: #1e293b; cursor: pointer; transition: all 0.15s; text-align: left; }
  .faq-rec-pill:hover { border-color: #6366f1; box-shadow: 0 2px 8px rgba(99,102,241,0.15); }
  .faq-rec-cat { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #6366f1; background: #eef2ff; border-radius: 999px; padding: 3px 8px; }
  .faq-rec-plus { font-size: 16px; font-weight: 700; color: #6366f1; line-height: 1; }

  /* Editable list */
  .faq-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .faq-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; background: #fff; }
  .faq-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .faq-reorder { display: flex; flex-direction: column; gap: 2px; }
  .faq-mv { width: 26px; height: 18px; border: 1px solid #e2e8f0; background: #fff; border-radius: 5px; font-size: 10px; color: #64748b; cursor: pointer; line-height: 1; display: flex; align-items: center; justify-content: center; }
  .faq-mv:hover:not(:disabled) { border-color: #10b981; color: #10b981; }
  .faq-mv:disabled { opacity: 0.3; cursor: not-allowed; }
  .faq-cat-input { max-width: 190px; }
  .faq-q-input { font-weight: 600; }
  .faq-save-state { margin-left: auto; font-size: 11px; color: #10b981; font-weight: 600; min-width: 52px; text-align: right; }
  .faq-needs-answer { font-size: 11px; color: #b45309; background: #fef9c3; border: 1px solid #fde68a; border-radius: 6px; padding: 3px 8px; display: inline-block; margin-top: 8px; }

  /* Add custom */
  .faq-add { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #f8fafc; }
  .faq-add-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
  .faq-add-row { display: flex; gap: 10px; }
  .faq-add-row .fi:first-child { flex: 1; }

  /* Preview */
  .faq-preview-wrap { }
  .faq-preview-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 9px; padding: 10px 14px; font-size: 12.5px; color: #166534; margin-bottom: 16px; }
  .faq-preview-banner a { color: #059669; font-weight: 700; }
  .faq-pv-group { margin-bottom: 18px; }
  .faq-pv-cat { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #8C1D40; margin-bottom: 8px; }
  .faq-pv-item { border: 1px solid #e8e5de; border-radius: 10px; margin-bottom: 8px; overflow: hidden; background: #fff; }
  .faq-pv-item summary { list-style: none; cursor: pointer; padding: 13px 16px; font-size: 14px; font-weight: 600; color: #1a1a1a; display: flex; justify-content: space-between; align-items: center; }
  .faq-pv-item summary::-webkit-details-marker { display: none; }
  .faq-pv-item summary::after { content: '+'; font-size: 18px; color: #8C1D40; font-weight: 400; }
  .faq-pv-item[open] summary::after { content: '−'; }
  .faq-pv-answer { padding: 0 16px 14px; font-size: 13.5px; color: #4a4a4a; line-height: 1.6; white-space: pre-wrap; }
  .faq-empty { font-size: 13px; color: #94a3b8; padding: 16px 0; }

  @media (max-width: 560px) {
    .faq-add-row { flex-direction: column; }
    .faq-cat-input { max-width: 100%; }
  }
`
