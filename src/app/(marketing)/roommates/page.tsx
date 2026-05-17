'use client'

import { useState } from 'react'

type FormData = {
  first_name: string
  last_name: string
  email: string
  phone: string
  grad_semester: string
  major: string
  housing_type: string
  move_in_month: string
  budget: string
  roommates_wanted: string
  sleep_schedule: string
  cleanliness: string
  guests_frequency: string
  noise_preference: string
  pets: string
  smoking: string
  gender_preference: string
  about_me: string
}

const INITIAL: FormData = {
  first_name: '', last_name: '', email: '', phone: '',
  grad_semester: '', major: '',
  housing_type: '', move_in_month: '', budget: '', roommates_wanted: '',
  sleep_schedule: '', cleanliness: '', guests_frequency: '', noise_preference: '',
  pets: '', smoking: '', gender_preference: '', about_me: '',
}

function Pill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '9px 18px',
        borderRadius: 100,
        border: `1.5px solid ${selected ? 'var(--hh-ink-900, #1a1a1a)' : 'var(--hh-border, #e8e5de)'}`,
        background: selected ? 'var(--hh-ink-900, #1a1a1a)' : 'transparent',
        color: selected ? '#fff' : 'var(--hh-ink-600, #6b6b6b)',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'var(--hh-font-ui, Geist, sans-serif)',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function PillGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(o => (
        <Pill key={o} label={o} selected={value === o} onClick={() => onChange(o)} />
      ))}
    </div>
  )
}

const GRAD_OPTIONS = [
  'Spring 2026', 'Fall 2026', 'Spring 2027', 'Fall 2027',
  'Spring 2028', 'Fall 2028', 'Grad student', 'PhD candidate', 'Exchange student',
]
const HOUSING_OPTIONS = ['Room in shared house', 'Full apartment', 'Either works']
const MOVEIN_OPTIONS = ['Aug 2025', 'Jan 2026', 'Aug 2026', 'Flexible']
const BUDGET_OPTIONS = ['Under $650', '$650–$850', '$850–$1,100', '$1,100+']
const ROOMMATES_OPTIONS = ['0 (solo)', '1', '2', '3+']
const SLEEP_OPTIONS = ['Before midnight', 'Night owl (1am+)', 'Varies']
const CLEAN_OPTIONS = ['Spotless', 'Tidy', 'Relaxed', 'Chaotic is fine']
const GUESTS_OPTIONS = ['Often social', 'Sometimes', 'Rarely', 'Never']
const NOISE_OPTIONS = ['Library quiet', 'Background noise ok', 'Lively is fine']
const PETS_OPTIONS = ['I have a pet', 'Love pets', 'No pets please']
const SMOKING_OPTIONS = ['Yes', 'Outside only', 'No please']
const GENDER_OPTIONS = ['No preference', 'Women only', 'Men only']

function step1Valid(f: FormData) {
  return f.first_name.trim() && f.last_name.trim() && f.email.trim() && f.grad_semester
}
function step2Valid(f: FormData) {
  return f.housing_type && f.move_in_month && f.budget && f.roommates_wanted
}
function step3Valid(f: FormData) {
  return f.sleep_schedule && f.cleanliness && f.guests_frequency && f.noise_preference
}
function step4Valid(f: FormData) {
  return f.pets && f.smoking && f.gender_preference
}

const STEP_VALID = [step1Valid, step2Valid, step3Valid, step4Valid]

export default function RoommatesPage() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof FormData, value: string) =>
    setForm(f => ({ ...f, [field]: value }))

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    border: '1.5px solid var(--hh-border, #e8e5de)',
    borderRadius: 10,
    fontSize: 15,
    fontFamily: 'var(--hh-font-ui, Geist, sans-serif)',
    color: 'var(--hh-ink-900, #1a1a1a)',
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--hh-ink-500, #9b9b9b)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  }

  const qStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--hh-ink-900, #1a1a1a)',
    marginBottom: 10,
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const roommatesWanted = form.roommates_wanted === '0 (solo)' ? '0' : form.roommates_wanted
      const res = await fetch('/api/roommate-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          roommates_wanted: roommatesWanted,
          budget: form.budget,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Something went wrong. Please try again.')
      } else {
        setSubmitted(true)
      }
    } catch {
      setError('Network error. Please try again.')
    }
    setLoading(false)
  }

  const canContinue = STEP_VALID[step - 1]?.(form)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,300;0,400;1,300;1,400&family=Geist:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--hh-bg, #FAF8F3); }
        .rmp-page { max-width: 640px; margin: 0 auto; padding: 48px 24px 96px; }
        .rmp-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: var(--hh-accent, #D9A14A); margin-bottom: 10px; }
        .rmp-headline { font-family: 'Newsreader', Georgia, serif; font-size: 32px; font-weight: 400; color: var(--hh-ink-900, #1a1a1a); line-height: 1.2; margin-bottom: 32px; }
        .rmp-progress { width: 100%; height: 3px; background: var(--hh-border, #e8e5de); border-radius: 3px; margin-bottom: 40px; }
        .rmp-progress-fill { height: 3px; border-radius: 3px; background: var(--hh-accent, #D9A14A); transition: width 0.35s ease; }
        .rmp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
        .rmp-field { margin-bottom: 20px; }
        .rmp-q { margin-bottom: 20px; }
        .rmp-continue { width: 100%; padding: 13px 32px; background: var(--hh-ink-900, #1a1a1a); color: #fff; border: none; border-radius: 100px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: 'Geist', sans-serif; transition: opacity 0.15s; margin-top: 8px; }
        .rmp-continue:disabled { opacity: 0.35; cursor: not-allowed; }
        .rmp-trust { font-size: 12px; color: var(--hh-ink-400, #b0a898); text-align: center; margin-top: 12px; }
        .rmp-back { background: none; border: none; cursor: pointer; font-size: 13px; color: var(--hh-ink-500, #9b9b9b); font-family: 'Geist', sans-serif; padding: 0; margin-bottom: 28px; display: flex; align-items: center; gap: 5px; }
        .rmp-back:hover { color: var(--hh-ink-900, #1a1a1a); }
        .rmp-step-label { font-size: 12px; color: var(--hh-ink-400, #b0a898); margin-bottom: 16px; font-weight: 500; }
        .rmp-textarea { width: 100%; padding: 12px 14px; border: 1.5px solid var(--hh-border, #e8e5de); border-radius: 10px; font-size: 15px; font-family: 'Geist', sans-serif; color: var(--hh-ink-900, #1a1a1a); resize: none; outline: none; height: 110px; background: #fff; }
        .rmp-char-count { font-size: 11px; color: var(--hh-ink-400, #b0a898); text-align: right; margin-top: 4px; }
        .rmp-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #dc2626; margin-bottom: 16px; }
        @media (max-width: 520px) {
          .rmp-grid-2 { grid-template-columns: 1fr; }
          .rmp-headline { font-size: 26px; }
        }
      `}</style>

      <div style={{ background: 'var(--hh-bg, #FAF8F3)', minHeight: '100vh', fontFamily: "'Geist', sans-serif" }}>
        {/* Top progress bar */}
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 3, background: 'var(--hh-border, #e8e5de)' }}>
          <div style={{ height: 3, background: 'var(--hh-accent, #D9A14A)', width: submitted ? '100%' : `${(step / 4) * 100}%`, transition: 'width 0.35s ease' }} />
        </div>

        <div className="rmp-page">
          {submitted ? (
            /* ── Confirmation ── */
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(217,161,74,0.12)', border: '2px solid rgba(217,161,74,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 28 }}>
                ✓
              </div>
              <div className="rmp-eyebrow">You're in</div>
              <h1 style={{ fontFamily: 'Newsreader, Georgia, serif', fontSize: 34, fontWeight: 400, color: 'var(--hh-ink-900, #1a1a1a)', lineHeight: 1.2, marginBottom: 16 }}>
                Profile submitted.
              </h1>
              <p style={{ fontSize: 16, color: 'var(--hh-ink-500, #9b9b9b)', lineHeight: 1.7, maxWidth: 440, margin: '0 auto 32px' }}>
                We've got your details, {form.first_name}. We'll reach out within 24 hours to discuss options and potential matches.
              </p>
              <a
                href="/homes"
                style={{ display: 'inline-block', background: 'var(--hh-ink-900, #1a1a1a)', color: '#fff', padding: '13px 32px', borderRadius: 100, fontSize: 14, fontWeight: 600, textDecoration: 'none', fontFamily: 'Geist, sans-serif' }}
              >
                Browse available homes →
              </a>
            </div>
          ) : (
            <>
              {/* Step label */}
              {step > 1 && (
                <button className="rmp-back" onClick={() => setStep(s => s - 1)}>
                  ← Back
                </button>
              )}
              <div className="rmp-step-label">Step {step} of 4</div>

              {/* Step 1 — About you */}
              {step === 1 && (
                <>
                  <div className="rmp-eyebrow">About you</div>
                  <h1 className="rmp-headline">Let's start with the basics.</h1>

                  <div className="rmp-grid-2">
                    <div>
                      <label style={labelStyle}>First name *</label>
                      <input
                        style={inputStyle}
                        placeholder="Jordan"
                        value={form.first_name}
                        onChange={e => set('first_name', e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Last name *</label>
                      <input
                        style={inputStyle}
                        placeholder="Lee"
                        value={form.last_name}
                        onChange={e => set('last_name', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="rmp-grid-2">
                    <div>
                      <label style={labelStyle}>Email *</label>
                      <input
                        style={inputStyle}
                        type="email"
                        placeholder="you@asu.edu"
                        value={form.email}
                        onChange={e => set('email', e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Phone (optional)</label>
                      <input
                        style={inputStyle}
                        type="tel"
                        placeholder="(480) 000-0000"
                        value={form.phone}
                        onChange={e => set('phone', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="rmp-field">
                    <label style={labelStyle}>Graduation semester *</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {GRAD_OPTIONS.map(o => (
                        <Pill key={o} label={o} selected={form.grad_semester === o} onClick={() => set('grad_semester', o)} />
                      ))}
                    </div>
                  </div>

                  <div className="rmp-field">
                    <label style={labelStyle}>Major (optional)</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. Computer Science"
                      value={form.major}
                      onChange={e => set('major', e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Step 2 — Your setup */}
              {step === 2 && (
                <>
                  <div className="rmp-eyebrow">Your setup</div>
                  <h1 className="rmp-headline">What are you looking for?</h1>

                  <div className="rmp-q">
                    <p style={qStyle}>Housing type</p>
                    <PillGroup options={HOUSING_OPTIONS} value={form.housing_type} onChange={v => set('housing_type', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Move-in</p>
                    <PillGroup options={MOVEIN_OPTIONS} value={form.move_in_month} onChange={v => set('move_in_month', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Monthly budget per person</p>
                    <PillGroup options={BUDGET_OPTIONS} value={form.budget} onChange={v => set('budget', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>How many roommates do you want?</p>
                    <PillGroup options={ROOMMATES_OPTIONS} value={form.roommates_wanted} onChange={v => set('roommates_wanted', v)} />
                  </div>
                </>
              )}

              {/* Step 3 — Your vibe */}
              {step === 3 && (
                <>
                  <div className="rmp-eyebrow">Your vibe</div>
                  <h1 className="rmp-headline">What kind of home do you keep?</h1>

                  <div className="rmp-q">
                    <p style={qStyle}>Sleep schedule</p>
                    <PillGroup options={SLEEP_OPTIONS} value={form.sleep_schedule} onChange={v => set('sleep_schedule', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Cleanliness</p>
                    <PillGroup options={CLEAN_OPTIONS} value={form.cleanliness} onChange={v => set('cleanliness', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Guests</p>
                    <PillGroup options={GUESTS_OPTIONS} value={form.guests_frequency} onChange={v => set('guests_frequency', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Noise level</p>
                    <PillGroup options={NOISE_OPTIONS} value={form.noise_preference} onChange={v => set('noise_preference', v)} />
                  </div>
                </>
              )}

              {/* Step 4 — A few more */}
              {step === 4 && (
                <>
                  <div className="rmp-eyebrow">A few more</div>
                  <h1 className="rmp-headline">Almost there — a few final things.</h1>

                  <div className="rmp-q">
                    <p style={qStyle}>Pets</p>
                    <PillGroup options={PETS_OPTIONS} value={form.pets} onChange={v => set('pets', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Smoking / vaping</p>
                    <PillGroup options={SMOKING_OPTIONS} value={form.smoking} onChange={v => set('smoking', v)} />
                  </div>

                  <div className="rmp-q">
                    <p style={qStyle}>Gender preference for housemates</p>
                    <PillGroup options={GENDER_OPTIONS} value={form.gender_preference} onChange={v => set('gender_preference', v)} />
                  </div>

                  <div className="rmp-field">
                    <p style={qStyle}>About me</p>
                    <label style={{ ...labelStyle, marginBottom: 8 }}>What should your future roommates know?</label>
                    <textarea
                      className="rmp-textarea"
                      placeholder="I'm a junior studying CS, usually in class until 3pm, keep things clean, love cooking on weekends..."
                      maxLength={300}
                      value={form.about_me}
                      onChange={e => set('about_me', e.target.value)}
                    />
                    <div className="rmp-char-count">{form.about_me.length} / 300</div>
                  </div>
                </>
              )}

              {/* Error */}
              {error && <div className="rmp-error">{error}</div>}

              {/* Navigation */}
              {step < 4 ? (
                <button
                  className="rmp-continue"
                  disabled={!canContinue}
                  onClick={() => setStep(s => s + 1)}
                >
                  Continue →
                </button>
              ) : (
                <button
                  className="rmp-continue"
                  disabled={!canContinue || loading}
                  onClick={handleSubmit}
                >
                  {loading ? 'Submitting…' : 'Submit profile →'}
                </button>
              )}
              <p className="rmp-trust">No commitment · We respond within 24 hours · No spam</p>
            </>
          )}
        </div>
      </div>
    </>
  )
}
