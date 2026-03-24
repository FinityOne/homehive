'use client'

import { useState, useEffect, use } from 'react'

type Step = 1 | 2 | 3

type LeadInfo = {
  first_name: string | null
  property: string | null
  property_name: string | null
  property_address: string | null
  property_hero_image: string | null
  property_price: number | null
  status: string
  move_in_date: string | null
}

// Dynamic next 6 months
function getMoveInOptions(): string[] {
  return [
    ...Array.from({ length: 6 }, (_, i) => {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() + i)
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }),
    'Flexible',
  ]
}

const LIFESTYLE_OPTIONS = [
  { value: 'Early riser / quiet', label: '☀️ Early riser', sub: 'Up early, quiet evenings' },
  { value: 'Night owl / social', label: '🌙 Night owl', sub: 'Late nights, social vibe' },
  { value: 'Balanced', label: '⚖️ Balanced', sub: 'Mix of both' },
  { value: 'Remote / grad student', label: '💻 Remote/Grad', sub: 'Work from home' },
]

const GENDER_OPTIONS = ['Man', 'Woman', 'Non-binary', 'Prefer not to say']

export default function PreScreenPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = use(params)

  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<Step>(1)

  const [form, setForm] = useState({
    // Step 1 — About you
    is_student: '' as '' | 'yes' | 'no',
    university: 'Arizona State University',
    birthdate: '',
    gender: '',
    // Step 2 — Your move
    move_in_date: '',
    is_group: '' as '' | 'solo' | 'group',
    group_size: 2,
    about: '',
    // Step 3 — Budget & lifestyle
    monthly_budget: '',
    lease_length: '',
    lifestyle: '',
    notes: '',
  })

  useEffect(() => {
    fetch(`/api/leads/${leadId}/prescreen`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setNotFound(true); setLoading(false); return }
        setLeadInfo(data)
        if (data.move_in_date) {
          setForm(f => ({ ...f, move_in_date: data.move_in_date }))
        }
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [leadId])

  const set = (key: keyof typeof form, value: string | number) =>
    setForm(f => ({ ...f, [key]: value }))

  const step1Valid =
    form.is_student !== '' &&
    form.birthdate !== '' &&
    form.gender !== '' &&
    (form.is_student === 'no' || form.university.trim() !== '')

  const step2Valid =
    form.move_in_date !== '' &&
    form.is_group !== '' &&
    form.about.trim().length >= 10

  const step3Valid =
    form.monthly_budget !== '' &&
    Number(form.monthly_budget) > 0 &&
    form.lease_length !== '' &&
    form.lifestyle !== ''

  const handleSubmit = async () => {
    if (!step3Valid || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/prescreen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_student: form.is_student === 'yes',
          university: form.is_student === 'yes' ? form.university : '',
          birthdate: form.birthdate,
          gender: form.gender,
          move_in_date: form.move_in_date,
          group_size: form.is_group === 'solo' ? 1 : form.group_size,
          about: form.about,
          monthly_budget: form.monthly_budget ? parseInt(form.monthly_budget) : null,
          lease_length: form.lease_length,
          lifestyle: form.lifestyle,
          notes: form.notes,
        }),
      })
      if (res.ok) setSubmitted(true)
    } catch (e) {
      console.error(e)
    }
    setSubmitting(false)
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
        <div style={{ width: '36px', height: '36px', border: '3px solid #e8e4db', borderTopColor: '#8C1D40', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap');`}</style>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px 36px', maxWidth: '420px', width: '100%', textAlign: 'center', border: '1px solid #e8e5de' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#fdf2f5', color: '#8C1D40', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>✕</div>
          <h2 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 700, color: '#1a1a1a' }}>This link has expired</h2>
          <p style={{ margin: '0 0 20px', fontSize: '14px', color: '#6b6b6b', lineHeight: 1.65 }}>This pre-screen link is no longer valid. It may have already been used or expired after 7 days.</p>
          <a href="mailto:hello@homehive.live" style={{ fontSize: '13px', color: '#8C1D40', textDecoration: 'none' }}>Contact us → hello@homehive.live</a>
        </div>
      </div>
    )
  }

  // ── Submitted ─────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'DM Sans', sans-serif" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
        <div style={{ background: '#fff', borderRadius: '20px', padding: '48px 32px', maxWidth: '460px', width: '100%', textAlign: 'center', border: '1px solid #e8e5de', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
          <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#FFC627', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '30px', margin: '0 auto 24px', boxShadow: '0 4px 20px rgba(255,198,39,0.4)' }}>🎉</div>
          <h2 style={{ margin: '0 0 10px', fontFamily: "'DM Serif Display', serif", fontSize: '28px', fontWeight: 400, color: '#1a1a1a' }}>
            You&apos;re in the running!
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '15px', color: '#4a4a4a', lineHeight: 1.7 }}>
            {leadInfo?.first_name ? `Nice work, ${leadInfo.first_name}.` : 'Nice work!'} Your pre-screen is complete and you&apos;ve been moved to the top of the list.
          </p>
          <div style={{ background: '#fdf2f5', border: '1px solid #f4c9d5', borderRadius: '10px', padding: '16px 20px', marginBottom: '24px', textAlign: 'left' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#8C1D40', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>What happens next</div>
            {['A HomeHive rep will review your profile', 'We\'ll be in touch within 24 hours', 'Get ready for a tour!'].map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#3a3a3a', marginBottom: i < 2 ? '8px' : 0 }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#8C1D40', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
                {step}
              </div>
            ))}
          </div>
          {leadInfo?.property_name && (
            <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#9b9b9b' }}>
              Applied for: <strong style={{ color: '#1a1a1a' }}>{leadInfo.property_name}</strong>
            </p>
          )}
          <p style={{ margin: 0, fontSize: '13px', color: '#9b9b9b' }}>
            Questions? <a href="mailto:hello@homehive.live" style={{ color: '#8C1D40', textDecoration: 'none' }}>hello@homehive.live</a>
          </p>
        </div>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  const firstName = leadInfo?.first_name || ''
  const heroImage = leadInfo?.property_hero_image
  const propName = leadInfo?.property_name || leadInfo?.property || 'your property'
  const propAddress = leadInfo?.property_address

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #f5f4f0; font-family: 'DM Sans', sans-serif; }

        .ps-wrap { max-width: 520px; margin: 0 auto; padding: 0 0 60px; }

        /* Property header */
        .ps-prop-header { position: relative; width: 100%; height: 180px; overflow: hidden; background: #8C1D40; }
        .ps-prop-header img { width: 100%; height: 100%; object-fit: cover; }
        .ps-prop-header-overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(26,26,26,0.3) 0%, rgba(26,26,26,0.75) 100%); }
        .ps-prop-header-content { position: absolute; bottom: 0; left: 0; right: 0; padding: 16px 20px; }
        .ps-prop-logo { position: absolute; top: 14px; left: 20px; font-size: 16px; font-weight: 700; color: #fff; letter-spacing: -0.2px; }
        .ps-prop-logo span { color: #FFC627; font-style: italic; }

        /* Progress */
        .ps-progress { background: #fff; padding: 14px 20px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; gap: 14px; }
        .ps-steps { display: flex; align-items: center; gap: 6px; }
        .ps-step-dot { width: 28px; height: 28px; border-radius: 50%; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s; }
        .ps-step-line { width: 28px; height: 2px; border-radius: 1px; }
        .ps-step-label { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .ps-step-sub { font-size: 11px; color: #9b9b9b; margin-top: 1px; }

        /* Card */
        .ps-card { background: #fff; margin: 0 16px; border-radius: 16px; padding: 28px 24px; border: 1px solid #e8e5de; margin-top: 16px; box-shadow: 0 2px 16px rgba(0,0,0,0.05); }

        /* Fields */
        .ps-label { display: block; font-size: 12px; font-weight: 700; color: #1a1a1a; margin-bottom: 7px; letter-spacing: 0.2px; }
        .ps-hint { font-size: 11px; color: #9b9b9b; margin-top: 4px; }
        .ps-input {
          width: 100%; padding: 11px 14px;
          border: 1.5px solid #e8e5de; border-radius: 9px;
          font-size: 14px; font-family: 'DM Sans', sans-serif;
          color: #1a1a1a; background: #fff; outline: none;
          transition: border-color 0.15s;
        }
        .ps-input:focus { border-color: #8C1D40; }
        .ps-input::placeholder { color: #c5c1b8; }
        .ps-select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239b9b9b' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 14px center; padding-right: 36px; cursor: pointer; }
        .ps-textarea { resize: none; height: 90px; line-height: 1.6; }

        /* Pill selects */
        .pill-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .pill { padding: 9px 16px; border: 1.5px solid #e8e5de; border-radius: 22px; font-size: 13px; font-weight: 500; color: #3a3a3a; cursor: pointer; transition: all 0.15s; background: #fff; white-space: nowrap; }
        .pill:hover { border-color: #8C1D40; color: #8C1D40; }
        .pill.active { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; font-weight: 600; }

        /* Card selects (large tap targets) */
        .card-group { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .sel-card { padding: 16px 12px; border: 1.5px solid #e8e5de; border-radius: 12px; cursor: pointer; text-align: center; transition: all 0.15s; background: #fff; }
        .sel-card:hover { border-color: #8C1D40; background: #fdf2f5; }
        .sel-card.active { border-color: #8C1D40; background: #fdf2f5; }
        .sel-card-icon { font-size: 22px; margin-bottom: 6px; }
        .sel-card-title { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .sel-card-sub { font-size: 11px; color: #9b9b9b; margin-top: 3px; line-height: 1.4; }

        /* Section divider */
        .ps-divider { height: 1px; background: #f0ede6; margin: 20px 0; }

        /* Buttons */
        .ps-btn-next { width: 100%; padding: 14px; background: #8C1D40; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .ps-btn-next:disabled { opacity: 0.45; cursor: not-allowed; }
        .ps-btn-next:not(:disabled):hover { opacity: 0.9; }
        .ps-btn-submit { width: 100%; padding: 15px; background: #FFC627; color: #1a1a1a; border: none; border-radius: 10px; font-size: 15px; font-weight: 800; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s, transform 0.1s; box-shadow: 0 4px 20px rgba(255,198,39,0.4); letter-spacing: -0.2px; }
        .ps-btn-submit:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        .ps-btn-submit:not(:disabled):hover { opacity: 0.92; transform: translateY(-1px); }
        .ps-btn-back { background: none; border: none; font-size: 13px; color: #9b9b9b; cursor: pointer; font-family: 'DM Sans', sans-serif; padding: 0; text-decoration: underline; margin-top: 12px; display: block; text-align: center; width: 100%; }
        .ps-btn-back:hover { color: #3a3a3a; }

        /* Group size stepper */
        .stepper { display: flex; align-items: center; gap: 0; border: 1.5px solid #e8e5de; border-radius: 9px; overflow: hidden; width: fit-content; }
        .stepper-btn { width: 40px; height: 40px; background: #faf9f6; border: none; font-size: 18px; cursor: pointer; color: #3a3a3a; display: flex; align-items: center; justify-content: center; transition: background 0.1s; flex-shrink: 0; }
        .stepper-btn:hover { background: #f0ede6; }
        .stepper-val { width: 48px; text-align: center; font-size: 15px; font-weight: 600; color: #1a1a1a; border-left: 1px solid #e8e5de; border-right: 1px solid #e8e5de; padding: 9px 0; }

        @media (max-width: 500px) {
          .ps-card { margin: 0 12px; padding: 22px 18px; }
          .card-group { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <div className="ps-wrap">

        {/* ── Property header ───────────────────────── */}
        <div className="ps-prop-header">
          {heroImage && <img src={heroImage} alt={propName} />}
          <div className="ps-prop-header-overlay" />
          <div className="ps-prop-logo">Home<span>Hive</span></div>
          <div className="ps-prop-header-content">
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#FFC627', marginBottom: '4px' }}>Pre-Screen Application</div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{propName}</div>
            {propAddress && <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', marginTop: '3px' }}>📍 {propAddress}</div>}
          </div>
        </div>

        {/* ── Progress bar ──────────────────────────── */}
        <div className="ps-progress">
          <div className="ps-steps">
            {[1, 2, 3].map((n, i) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  className="ps-step-dot"
                  style={{
                    background: step > n ? '#8C1D40' : step === n ? '#8C1D40' : '#f0ede6',
                    color: step >= n ? '#fff' : '#9b9b9b',
                    boxShadow: step === n ? '0 0 0 3px rgba(140,29,64,0.15)' : 'none',
                  }}
                >
                  {step > n ? '✓' : n}
                </div>
                {i < 2 && (
                  <div className="ps-step-line" style={{ background: step > n ? '#8C1D40' : '#e8e5de' }} />
                )}
              </div>
            ))}
          </div>
          <div>
            <div className="ps-step-label">
              {step === 1 ? 'About you' : step === 2 ? 'Your move' : 'Budget & lifestyle'}
            </div>
            <div className="ps-step-sub">Step {step} of 3 · ~{step === 1 ? '1' : step === 2 ? '1' : '1'} min</div>
          </div>
        </div>

        {/* ── Step 1: About you ─────────────────────── */}
        {step === 1 && (
          <div className="ps-card">
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#8C1D40', marginBottom: '6px' }}>Step 1 of 3</div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>
              {firstName ? `Hey ${firstName}! 👋` : 'Tell us about yourself'}
            </h1>
            <p style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '24px', lineHeight: 1.5 }}>
              Quick intro so the landlord knows who&apos;s applying. Takes about a minute.
            </p>

            {/* Student */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">Are you currently a student? *</label>
              <div className="pill-group">
                <div
                  className={`pill${form.is_student === 'yes' ? ' active' : ''}`}
                  onClick={() => set('is_student', 'yes')}
                >🎓 Yes, I&apos;m a student</div>
                <div
                  className={`pill${form.is_student === 'no' ? ' active' : ''}`}
                  onClick={() => set('is_student', 'no')}
                >💼 Not a student</div>
              </div>
            </div>

            {/* University — only if student */}
            {form.is_student === 'yes' && (
              <div style={{ marginBottom: '20px' }}>
                <label className="ps-label">Which university? *</label>
                <input
                  className="ps-input"
                  value={form.university}
                  onChange={e => set('university', e.target.value)}
                  placeholder="Arizona State University"
                />
              </div>
            )}

            <div className="ps-divider" />

            {/* Birthdate */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">Date of Birth *</label>
              <input
                className="ps-input"
                type="date"
                value={form.birthdate}
                onChange={e => set('birthdate', e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
              <div className="ps-hint">Required for lease verification purposes</div>
            </div>

            {/* Gender */}
            <div style={{ marginBottom: '28px' }}>
              <label className="ps-label">Gender *</label>
              <div className="pill-group">
                {GENDER_OPTIONS.map(g => (
                  <div
                    key={g}
                    className={`pill${form.gender === g ? ' active' : ''}`}
                    onClick={() => set('gender', g)}
                  >{g}</div>
                ))}
              </div>
            </div>

            <button
              className="ps-btn-next"
              disabled={!step1Valid}
              onClick={() => setStep(2)}
            >
              Next: Your Move →
            </button>

            <p style={{ textAlign: 'center', fontSize: '11px', color: '#b0a898', marginTop: '12px' }}>
              Your info is private and only shared with the landlord
            </p>
          </div>
        )}

        {/* ── Step 2: Your move ─────────────────────── */}
        {step === 2 && (
          <div className="ps-card">
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#8C1D40', marginBottom: '6px' }}>Step 2 of 3</div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Tell us about your move</h1>
            <p style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '24px', lineHeight: 1.5 }}>
              Help the landlord understand your timeline and living situation.
            </p>

            {/* Move-in date */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">When are you looking to move in? *</label>
              <select
                className="ps-input ps-select"
                value={form.move_in_date}
                onChange={e => set('move_in_date', e.target.value)}
                style={{ color: form.move_in_date ? '#1a1a1a' : '#b0a898' }}
              >
                <option value="">Select a month</option>
                {getMoveInOptions().map(o => <option key={o}>{o}</option>)}
              </select>
            </div>

            <div className="ps-divider" />

            {/* Solo or group */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">Are you moving solo or with a group? *</label>
              <div className="card-group">
                <div
                  className={`sel-card${form.is_group === 'solo' ? ' active' : ''}`}
                  onClick={() => set('is_group', 'solo')}
                >
                  <div className="sel-card-icon">🙋</div>
                  <div className="sel-card-title">Just me</div>
                  <div className="sel-card-sub">I&apos;m looking for a room solo</div>
                </div>
                <div
                  className={`sel-card${form.is_group === 'group' ? ' active' : ''}`}
                  onClick={() => set('is_group', 'group')}
                >
                  <div className="sel-card-icon">👥</div>
                  <div className="sel-card-title">With a group</div>
                  <div className="sel-card-sub">We&apos;re moving together</div>
                </div>
              </div>
            </div>

            {/* Group size — only if group */}
            {form.is_group === 'group' && (
              <div style={{ marginBottom: '20px' }}>
                <label className="ps-label">How many people total (including you)? *</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stepper">
                    <button
                      className="stepper-btn"
                      onClick={() => set('group_size', Math.max(2, Number(form.group_size) - 1))}
                    >−</button>
                    <div className="stepper-val">{form.group_size}</div>
                    <button
                      className="stepper-btn"
                      onClick={() => set('group_size', Math.min(10, Number(form.group_size) + 1))}
                    >+</button>
                  </div>
                  <span style={{ fontSize: '13px', color: '#6b6b6b' }}>
                    {form.group_size === 2 ? '2 people' : `${form.group_size} people`}
                  </span>
                </div>
              </div>
            )}

            <div className="ps-divider" />

            {/* About */}
            <div style={{ marginBottom: '28px' }}>
              <label className="ps-label">Tell us a bit about yourself *</label>
              <textarea
                className="ps-input ps-textarea"
                placeholder="e.g. I'm a junior at ASU studying Business. I love cooking and hiking, and I keep a clean, chill space. Great with roommates — I'm respectful of shared areas!"
                value={form.about}
                onChange={e => set('about', e.target.value)}
              />
              <div className="ps-hint">2–3 sentences is perfect · {form.about.length}/10 min characters</div>
            </div>

            <button
              className="ps-btn-next"
              disabled={!step2Valid}
              onClick={() => setStep(3)}
            >
              Next: Budget & Lifestyle →
            </button>
            <button className="ps-btn-back" onClick={() => setStep(1)}>← Back</button>
          </div>
        )}

        {/* ── Step 3: Budget & lifestyle ────────────── */}
        {step === 3 && (
          <div className="ps-card">
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#8C1D40', marginBottom: '6px' }}>Step 3 of 3 — Almost done!</div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '4px' }}>Budget & lifestyle</h1>
            <p style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '24px', lineHeight: 1.5 }}>
              Last step! This helps the landlord confirm you&apos;re a great fit.
            </p>

            {/* Budget */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">Total monthly budget *</label>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '15px', fontWeight: 600, color: '#3a3a3a', pointerEvents: 'none' }}>$</div>
                <input
                  className="ps-input"
                  type="number"
                  min="100"
                  max="9999"
                  placeholder="750"
                  value={form.monthly_budget}
                  onChange={e => set('monthly_budget', e.target.value)}
                  style={{ paddingLeft: '28px' }}
                />
              </div>
              <div className="ps-hint">Your all-in budget including rent, utilities, and any fees</div>
            </div>

            {/* Lease length */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">Lease preference *</label>
              <select
                className="ps-input ps-select"
                value={form.lease_length}
                onChange={e => set('lease_length', e.target.value)}
                style={{ color: form.lease_length ? '#1a1a1a' : '#b0a898' }}
              >
                <option value="">Select preference</option>
                <option value="1 semester">1 semester (~5 months)</option>
                <option value="Academic year">Academic year (~10 months)</option>
                <option value="1 year">1 year (12 months)</option>
                <option value="Flexible">Flexible / open to discuss</option>
              </select>
            </div>

            <div className="ps-divider" />

            {/* Lifestyle */}
            <div style={{ marginBottom: '20px' }}>
              <label className="ps-label">Your lifestyle vibe *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {LIFESTYLE_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => set('lifestyle', opt.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 14px',
                      border: `1.5px solid ${form.lifestyle === opt.value ? '#8C1D40' : '#e8e5de'}`,
                      borderRadius: '10px',
                      background: form.lifestyle === opt.value ? '#fdf2f5' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: '20px', flexShrink: 0 }}>{opt.label.split(' ')[0]}</div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{opt.label.split(' ').slice(1).join(' ')}</div>
                      <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '1px' }}>{opt.sub}</div>
                    </div>
                    {form.lifestyle === opt.value && (
                      <div style={{ marginLeft: 'auto', width: '20px', height: '20px', borderRadius: '50%', background: '#8C1D40', color: '#fff', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✓</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notes — optional */}
            <div style={{ marginBottom: '28px' }}>
              <label className="ps-label">Anything else you&apos;d like us to know? <span style={{ fontWeight: 400, color: '#9b9b9b' }}>(optional)</span></label>
              <textarea
                className="ps-input ps-textarea"
                placeholder="Pets, parking needs, specific room questions, special circumstances..."
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </div>

            <button
              className="ps-btn-submit"
              disabled={!step3Valid || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Submitting…' : `Submit My Pre-Screen →`}
            </button>

            <button className="ps-btn-back" onClick={() => setStep(2)}>← Back</button>

            <p style={{ textAlign: 'center', fontSize: '11px', color: '#b0a898', marginTop: '14px', lineHeight: 1.5 }}>
              🔒 Your info is private and only shared with the landlord at {propName}
            </p>
          </div>
        )}

      </div>
    </>
  )
}
