'use client'

import { useState, useEffect, use } from 'react'

// ── Question definitions ──────────────────────────────────────────────────────

type PillQuestion = {
  id: string
  label: string
  type: 'pills'
  options: string[]
  detailTriggers?: string[]   // show freetext if answer matches one of these
  detailPrompt?: string
}
type YesNoQuestion = {
  id: string
  label: string
  type: 'yesno'
  detailTrigger?: 'yes' | 'no'
  detailPrompt?: string
}
type TextQuestion = {
  id: string
  label: string
  type: 'text'
  placeholder?: string
  optional?: boolean
}
type Question = PillQuestion | YesNoQuestion | TextQuestion

const QUESTIONS: Question[] = [
  {
    id: 'confirmed',
    label: 'Did this person reside at your property?',
    type: 'yesno',
    detailTrigger: 'yes',
    detailPrompt: 'Approximately how long? (e.g. 1 year, 18 months)',
  },
  {
    id: 'rent_payment',
    label: 'How would you describe their rent payment history?',
    type: 'pills',
    options: ['Always on time', 'Mostly on time', 'Sometimes late', 'Frequently late'],
  },
  {
    id: 'conduct',
    label: 'Were there any noise complaints, lease violations, or property damage during their stay?',
    type: 'pills',
    options: ['None at all', 'Minor issues', 'Significant issues'],
    detailTriggers: ['Minor issues', 'Significant issues'],
    detailPrompt: 'Briefly describe what happened',
  },
  {
    id: 'condition',
    label: 'Did they leave the unit in good condition upon move-out?',
    type: 'yesno',
    detailTrigger: 'no',
    detailPrompt: 'What issues were there? (optional)',
  },
  {
    id: 'deposit',
    label: 'Was the security deposit returned in full?',
    type: 'pills',
    options: ['Yes, in full', 'Partially returned', 'Not returned'],
    detailTriggers: ['Partially returned', 'Not returned'],
    detailPrompt: 'Briefly explain why (optional)',
  },
  {
    id: 'rent_again',
    label: 'Would you rent to this person again?',
    type: 'pills',
    options: ['Definitely yes', 'Probably yes', 'Probably not', 'Definitely not'],
  },
]

type AnswerState = {
  value: string
  detail: string
}

type RefData = {
  id: string
  type: 'employer' | 'residence'
  name: string | null
  address: string | null
  status: string
  responses: { question: string; answer: string; detail?: string }[] | null
}

// ── Pill component ─────────────────────────────────────────────────────────────

function PillGroup({ options, value, onChange, disabled }: {
  options: string[]
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
      {options.map(opt => {
        const selected = value === opt
        return (
          <button
            key={opt}
            disabled={disabled}
            onClick={() => onChange(selected ? '' : opt)}
            style={{
              padding: '10px 18px',
              borderRadius: '100px',
              fontSize: '13px',
              fontWeight: selected ? 700 : 500,
              fontFamily: "'DM Sans', sans-serif",
              border: `2px solid ${selected ? '#1a1a1a' : '#e0ddd6'}`,
              background: selected ? '#1a1a1a' : '#fff',
              color: selected ? '#fff' : '#4a4a4a',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.14s',
              letterSpacing: selected ? '-0.1px' : '0',
              opacity: disabled ? 0.65 : 1,
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function YesNoGroup({ value, onChange, disabled }: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
      {[
        { v: 'yes', label: 'Yes' },
        { v: 'no',  label: 'No'  },
      ].map(({ v, label }) => {
        const selected = value === v
        const color = v === 'yes' ? '#059669' : '#dc2626'
        return (
          <button
            key={v}
            disabled={disabled}
            onClick={() => onChange(selected ? '' : v)}
            style={{
              flex: 1,
              padding: '13px',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 700,
              fontFamily: "'DM Sans', sans-serif",
              border: `2px solid ${selected ? color : '#e0ddd6'}`,
              background: selected ? color : '#fff',
              color: selected ? '#fff' : '#9b9b9b',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.14s',
              opacity: disabled ? 0.65 : 1,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RefFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [ref, setRef] = useState<RefData | null>(null)
  const [leadName, setLeadName] = useState('')
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(
    Object.fromEntries(QUESTIONS.map(q => [q.id, { value: '', detail: '' }]))
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/ref/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setNotFound(true); setLoading(false); return }
        setRef(data.ref)
        setLeadName(data.leadName)
        if (data.ref.responses?.length) setSubmitted(true)
        setLoading(false)
      })
  }, [token])

  const setAnswer = (id: string, value: string) =>
    setAnswers(prev => ({ ...prev, [id]: { ...prev[id], value } }))

  const setDetail = (id: string, detail: string) =>
    setAnswers(prev => ({ ...prev, [id]: { ...prev[id], detail } }))

  const answeredCount = Object.values(answers).filter(a => a.value).length
  const progress = Math.round((answeredCount / QUESTIONS.length) * 100)

  const handleSubmit = async () => {
    if (answeredCount === 0) {
      setError('Please answer at least one question before submitting.')
      return
    }
    setSubmitting(true)
    setError('')
    const responses = [
      ...QUESTIONS.map(q => ({
        question: q.label,
        answer: answers[q.id].value || '—',
        ...(answers[q.id].detail ? { detail: answers[q.id].detail } : {}),
      })),
      ...(answers['_notes']?.value?.trim()
        ? [{ question: 'Additional notes', answer: answers['_notes'].value.trim() }]
        : []),
    ]
    const res = await fetch(`/api/ref/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses }),
    })
    if (res.ok) {
      setSubmitted(true)
    } else {
      setError('Something went wrong. Please try again.')
    }
    setSubmitting(false)
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{ fontSize: '14px', color: '#9b9b9b' }}>Loading…</div>
    </div>
  )

  // ── Not found ─────────────────────────────────────────────────────────────
  if (notFound || !ref) return (
    <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", padding: '24px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={{ fontSize: '36px', marginBottom: '14px' }}>🔍</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', marginBottom: '8px' }}>Link not found</div>
        <div style={{ fontSize: '14px', color: '#9b9b9b', lineHeight: 1.6 }}>This reference link is invalid or has expired. Please contact the property management team if you believe this is a mistake.</div>
      </div>
    </div>
  )

  const alreadySubmitted = submitted || ref.status === 'verified'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #f5f4f0; }

        .ref-page { min-height: 100vh; background: #f5f4f0; font-family: 'DM Sans', sans-serif; padding: 28px 16px 72px; }
        .ref-wrap { max-width: 560px; margin: 0 auto; }

        .hive-logo { display: inline-flex; align-items: center; margin-bottom: 24px; }
        .hive-logo img { height: 26px; width: auto; display: block; }

        .context-card { background: #1a1a1a; border-radius: 16px; padding: 22px 22px 18px; margin-bottom: 12px; }
        .context-eyebrow { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; }
        .context-name { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.2; margin-bottom: 8px; }
        .context-sub { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.65; }
        .context-addr { display: inline-flex; align-items: center; gap: 5px; margin-top: 12px; font-size: 11px; font-weight: 600; color: #FFC627; background: rgba(255,198,39,0.1); border-radius: 20px; padding: 4px 10px; }

        .intro-card { background: #fff; border: 1px solid #ebe8e2; border-radius: 14px; padding: 16px 20px; margin-bottom: 20px; }
        .intro-text { font-size: 13px; color: #5a5a5a; line-height: 1.75; }

        .progress-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
        .progress-track { flex: 1; height: 4px; background: #e0ddd6; border-radius: 2px; overflow: hidden; }
        .progress-fill { height: 100%; background: #1a1a1a; border-radius: 2px; transition: width 0.3s; }
        .progress-label { font-size: 11px; font-weight: 600; color: #9b9b9b; white-space: nowrap; }

        .q-card { background: #fff; border: 1.5px solid #ebe8e2; border-radius: 14px; padding: 20px 20px 16px; margin-bottom: 10px; transition: border-color 0.15s; }
        .q-card.answered { border-color: #1a1a1a; }
        .q-number { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #f5f4f0; font-size: 10px; font-weight: 700; color: #9b9b9b; margin-bottom: 8px; }
        .q-card.answered .q-number { background: #1a1a1a; color: #fff; }
        .q-text { font-size: 15px; font-weight: 600; color: #1a1a1a; line-height: 1.45; }

        .detail-reveal { margin-top: 12px; overflow: hidden; }
        .detail-input { width: 100%; border: 1.5px solid #e0ddd6; border-radius: 10px; padding: 10px 13px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; resize: vertical; min-height: 64px; outline: none; background: #faf9f6; line-height: 1.6; transition: border-color 0.15s; }
        .detail-input:focus { border-color: #1a1a1a; background: #fff; }
        .detail-label { font-size: 11px; font-weight: 600; color: #9b9b9b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

        .submit-btn { width: 100%; background: #8C1D40; color: #fff; border: none; border-radius: 13px; padding: 15px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; margin-top: 8px; }
        .submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .submit-btn:hover:not(:disabled) { opacity: 0.88; }

        .error-msg { background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 11px 14px; font-size: 13px; color: #dc2626; margin-bottom: 10px; }

        .success-wrap { background: #fff; border: 1px solid #ebe8e2; border-radius: 16px; padding: 40px 24px; text-align: center; }

        .footer-note { text-align: center; font-size: 11px; color: #b8b2a8; margin-top: 28px; line-height: 1.7; }

        @media (max-width: 480px) {
          .ref-page { padding: 20px 12px 56px; }
          .q-text { font-size: 14px; }
        }
      `}</style>

      <div className="ref-page">
        <div className="ref-wrap">

          {/* Logo */}
          <div className="hive-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hh-logo.png" alt="HomeHive" />
          </div>

          {/* Context header */}
          <div className="context-card">
            <div className="context-eyebrow">Rental Reference Request</div>
            <div className="context-name">{leadName}</div>
            <div className="context-sub">
              {leadName} has applied to rent a property managed by our team
              {ref.name ? ` and has listed you — ${ref.name} — as their previous landlord` : ' and has listed you as their previous landlord'}.
            </div>
            {ref.address && (
              <div className="context-addr">📍 {ref.address}</div>
            )}
          </div>

          {/* Intro */}
          <div className="intro-card">
            <p className="intro-text">
              Your answers are completely confidential and used only for this application review. There are no right or wrong answers — honest feedback is what helps us most. It takes about 2 minutes.
            </p>
          </div>

          {alreadySubmitted ? (
            <div className="success-wrap">
              <div style={{ fontSize: '44px', marginBottom: '16px' }}>✅</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', marginBottom: '10px' }}>
                {submitted ? 'Thank you!' : 'Already submitted'}
              </div>
              <div style={{ fontSize: '14px', color: '#6b6b6b', lineHeight: 1.7 }}>
                {submitted
                  ? <>Your reference for <strong>{leadName}</strong> has been submitted. We genuinely appreciate you taking the time.</>
                  : <>A reference for <strong>{leadName}</strong> has already been received. Thank you for your time.</>
                }
              </div>
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="progress-row">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="progress-label">{answeredCount} / {QUESTIONS.length}</span>
              </div>

              {/* Questions */}
              {QUESTIONS.map(q => {
                const ans = answers[q.id]
                const isAnswered = !!ans.value

                const showDetail = (() => {
                  if (q.type === 'yesno') return q.detailTrigger && ans.value === q.detailTrigger
                  if (q.type === 'pills') return q.detailTriggers?.includes(ans.value)
                  return false
                })()

                return (
                  <div key={q.id} className={`q-card${isAnswered ? ' answered' : ''}`}>
                    <div className="q-number">{QUESTIONS.indexOf(q) + 1}</div>
                    <div className="q-text">{q.label}</div>

                    {q.type === 'yesno' && (
                      <YesNoGroup value={ans.value} onChange={v => setAnswer(q.id, v)} disabled={submitting} />
                    )}

                    {q.type === 'pills' && (
                      <PillGroup options={q.options} value={ans.value} onChange={v => setAnswer(q.id, v)} disabled={submitting} />
                    )}

                    {q.type === 'text' && (
                      <div style={{ marginTop: '10px' }}>
                        <textarea
                          className="detail-input"
                          placeholder={q.placeholder || 'Your answer…'}
                          value={ans.value}
                          onChange={e => setAnswer(q.id, e.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    )}

                    {showDetail && 'detailPrompt' in q && q.detailPrompt && (
                      <div className="detail-reveal">
                        <div className="detail-label">{q.detailPrompt}</div>
                        <textarea
                          className="detail-input"
                          placeholder="Add a brief note…"
                          value={ans.detail}
                          onChange={e => setDetail(q.id, e.target.value)}
                          disabled={submitting}
                          rows={2}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Additional notes */}
              <div className={`q-card${answers['_notes']?.value ? ' answered' : ''}`} style={{ marginTop: '2px' }}>
                <div className="q-number" style={{ background: answers['_notes']?.value ? '#1a1a1a' : undefined, color: answers['_notes']?.value ? '#fff' : undefined }}>✎</div>
                <div className="q-text">Anything else you'd like to add?</div>
                <div style={{ marginTop: '10px' }}>
                  <textarea
                    className="detail-input"
                    placeholder="Additional notes, context, or anything else that might be helpful…"
                    value={answers['_notes']?.value || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, _notes: { value: e.target.value, detail: '' } }))}
                    disabled={submitting}
                    rows={4}
                    style={{ minHeight: '96px' }}
                  />
                </div>
              </div>

              {error && <div className="error-msg">{error}</div>}

              <button
                className="submit-btn"
                disabled={submitting || answeredCount === 0}
                onClick={handleSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit Reference'}
              </button>
            </>
          )}

          <div className="footer-note">
            Sent securely via HomeHive · Your response is confidential
          </div>

        </div>
      </div>
    </>
  )
}
