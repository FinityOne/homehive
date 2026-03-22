'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Mode = 'solo' | 'group' | null

export default function RoommatesPage() {
  const [mode, setMode] = useState<Mode>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    unit_type: '', move_in_date: '', budget: '', lifestyle: '',
    group_size: '', group_name: '', notes: '',
  })
  const perks: { icon: string; title: string; body: string }[] = mode === 'solo' ? [
    { icon: '🔍', title: 'We find your matches', body: 'Tell us your vibe and schedule — we pair you with people who actually fit.' },
    { icon: '👋', title: 'Meet before you sign', body: "We introduce you to potential roommates before anyone commits to anything." },
    { icon: '🏠', title: 'Solo options too', body: 'Need a studio or 1-bed? We have options for people who want their own space.' },
  ] : [
    { icon: '🏡', title: 'Homes built for groups', body: 'Our 3 and 4-bedroom homes are perfect for groups who want to live together.' },
    { icon: '📋', title: 'One easy process', body: 'Register your group once. We handle matching you to the right home.' },
    { icon: '🔒', title: 'Group feature coming soon', body: 'A dedicated group dashboard where your crew can browse and apply together is on the way.' },
  ]

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await supabase.from('leads').insert([{
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        phone: formData.phone,
        move_in_date: formData.move_in_date,
        budget: formData.budget,
        roommate_preference: mode === 'group' ? `Group of ${formData.group_size}` : 'Looking for roommates',
        lifestyle: formData.lifestyle,
        notes: `Unit type: ${formData.unit_type}. ${formData.group_name ? `Group: ${formData.group_name}.` : ''} ${formData.notes}`.trim(),
        status: 'new',
      }])
      setSubmitted(true)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; }

        .page { max-width: 860px; margin: 0 auto; padding: 48px 24px 100px; }

        /* HERO */
        .hero { text-align: center; margin-bottom: 56px; }
        .hero-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #d4a843; margin-bottom: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .hero-eyebrow::before, .hero-eyebrow::after { content: ''; width: 40px; height: 1px; background: #d4a843; opacity: 0.5; }
        .hero-title { font-family: 'DM Serif Display', serif; font-size: 48px; color: #1a1a1a; line-height: 1.1; margin-bottom: 18px; letter-spacing: -0.5px; }
        .hero-title em { font-style: italic; color: #d4a843; }
        .hero-sub { font-size: 16px; color: #6b6b6b; line-height: 1.7; max-width: 500px; margin: 0 auto; }

        /* MODE SELECTOR */
        .mode-section { margin-bottom: 48px; }
        .mode-label { font-size: 13px; color: #9b9b9b; text-align: center; margin-bottom: 20px; font-weight: 500; }
        .mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .mode-card {
          background: #fff; border: 2px solid #e8e5de; border-radius: 16px;
          padding: 28px 24px; cursor: pointer; transition: all 0.2s; text-align: left;
        }
        .mode-card:hover { border-color: #d4a843; background: #fefdf9; }
        .mode-card.selected { border-color: #1a1a1a; background: #fff; }
        .mode-card-icon { font-size: 32px; margin-bottom: 14px; }
        .mode-card-title { font-family: 'DM Serif Display', serif; font-size: 20px; color: #1a1a1a; margin-bottom: 8px; }
        .mode-card-sub { font-size: 13px; color: #6b6b6b; line-height: 1.6; margin-bottom: 14px; }
        .mode-card-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .mode-card-tag { font-size: 11px; background: #f9f8f5; border: 1px solid #e8e5de; color: #6b6b6b; padding: 3px 9px; border-radius: 20px; }
        .mode-card.selected .mode-card-tag { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
        .mode-select-indicator { display: flex; align-items: center; gap: 6px; margin-top: 16px; font-size: 12px; color: #9b9b9b; font-weight: 500; }
        .mode-card.selected .mode-select-indicator { color: #1a1a1a; }
        .indicator-circle { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #e8e5de; display: flex; align-items: center; justify-content: center; font-size: 9px; transition: all 0.2s; }
        .mode-card.selected .indicator-circle { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }

        /* GROUP COMING SOON BANNER */
        .coming-soon-banner { background: linear-gradient(135deg, #1a1a1a, #2d2410); border: 1px solid #d4a843; border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .coming-soon-left { display: flex; align-items: center; gap: 12px; }
        .coming-soon-icon { width: 38px; height: 38px; border-radius: 50%; background: rgba(212,168,67,0.2); border: 1px solid rgba(212,168,67,0.4); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .coming-soon-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px; }
        .coming-soon-sub { font-size: 12px; color: #9b9b9b; }
        .coming-soon-badge { background: rgba(212,168,67,0.15); border: 1px solid rgba(212,168,67,0.4); color: #d4a843; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.5px; white-space: nowrap; }

        /* WHAT YOU GET */
        .perks-section { margin-bottom: 40px; }
        .perks-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .perk-card { background: #fff; border: 1px solid #e8e5de; border-radius: 10px; padding: 18px; text-align: center; }
        .perk-icon { font-size: 22px; margin-bottom: 8px; }
        .perk-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }
        .perk-body { font-size: 12px; color: #6b6b6b; line-height: 1.55; }

        /* FORM */
        .form-card { background: #fff; border: 1px solid #e8e5de; border-radius: 16px; padding: 36px; }
        .form-title { font-family: 'DM Serif Display', serif; font-size: 26px; color: #1a1a1a; margin-bottom: 6px; }
        .form-sub { font-size: 14px; color: #6b6b6b; margin-bottom: 28px; line-height: 1.6; }
        .form-section-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; margin-top: 24px; padding-bottom: 8px; border-bottom: 1px solid #f0ede6; }
        .form-section-label:first-of-type { margin-top: 0; }
        .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        .form-field { margin-bottom: 14px; }
        .form-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 5px; }
        .form-input { width: 100%; padding: 11px 14px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #fff; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
        .form-input:focus { border-color: #d4a843; }
        .form-input::placeholder { color: #c5c1b8; }
        .submit-btn { width: 100%; padding: 14px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-top: 8px; transition: background 0.2s; }
        .submit-btn:hover { background: #333; }
        .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .form-trust { display: flex; justify-content: center; gap: 20px; margin-top: 14px; flex-wrap: wrap; }
        .form-trust-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #9b9b9b; }
        .trust-dot { width: 5px; height: 5px; border-radius: 50%; background: #d4a843; }

        /* SUCCESS */
        .success-state { text-align: center; padding: 56px 24px; }
        .success-icon { width: 72px; height: 72px; border-radius: 50%; background: #dcfce7; border: 2px solid #bbf7d0; display: flex; align-items: center; justify-content: center; font-size: 30px; margin: 0 auto 20px; }
        .success-title { font-family: 'DM Serif Display', serif; font-size: 32px; color: #1a1a1a; margin-bottom: 10px; }
        .success-sub { font-size: 15px; color: #6b6b6b; line-height: 1.7; max-width: 400px; margin: 0 auto 24px; }
        .success-back { display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; }

        @media (max-width: 640px) {
          .hero-title { font-size: 34px; }
          .mode-grid { grid-template-columns: 1fr; }
          .perks-grid { grid-template-columns: 1fr; }
          .form-grid-2 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#f5f4f0', minHeight: '100vh' }}>
        <div className="page">

          {/* HERO */}
          <div className="hero">
            <div className="hero-eyebrow">Roommate matching</div>
            <h1 className="hero-title">
              Find people you'll<br />actually <em>want</em> to live with.
            </h1>
            <p className="hero-sub">
              Whether you're flying solo and need roommates, or you've already got a crew and just need the right home — we've got you.
            </p>
          </div>

          {/* MODE SELECTOR */}
          <div className="mode-section">
            <p className="mode-label">First, tell us your situation →</p>
            <div className="mode-grid">
              <div className={`mode-card ${mode === 'solo' ? 'selected' : ''}`} onClick={() => setMode('solo')}>
                <div className="mode-card-icon">🙋</div>
                <div className="mode-card-title">I'm looking on my own</div>
                <p className="mode-card-sub">
                  You're searching solo — maybe looking for a single room, a studio, or a 1-bed. Or you need a home and want us to help find compatible roommates to fill it with you.
                </p>
                <div className="mode-card-tags">
                  <span className="mode-card-tag">Single room</span>
                  <span className="mode-card-tag">Studio</span>
                  <span className="mode-card-tag">1-bedroom</span>
                  <span className="mode-card-tag">Need roommates</span>
                </div>
                <div className="mode-select-indicator">
                  <div className="indicator-circle">{mode === 'solo' ? '✓' : ''}</div>
                  {mode === 'solo' ? 'Selected' : 'Select this'}
                </div>
              </div>

              <div className={`mode-card ${mode === 'group' ? 'selected' : ''}`} onClick={() => setMode('group')}>
                <div className="mode-card-icon">👥</div>
                <div className="mode-card-title">I have a group</div>
                <p className="mode-card-sub">
                  You already have 2, 3, or 4 people lined up and just need the right home to fit your crew. We'll match your group to a home with the right number of rooms and layout.
                </p>
                <div className="mode-card-tags">
                  <span className="mode-card-tag">2–4 people</span>
                  <span className="mode-card-tag">Group search</span>
                  <span className="mode-card-tag">Full home</span>
                  <span className="mode-card-tag">You pick your crew</span>
                </div>
                <div className="mode-select-indicator">
                  <div className="indicator-circle">{mode === 'group' ? '✓' : ''}</div>
                  {mode === 'group' ? 'Selected' : 'Select this'}
                </div>
              </div>
            </div>
          </div>

          {mode && (
            <>
              {/* PERKS */}
              <div className="perks-section">
                <div className="perks-grid">
                  {perks.map(p => (
                    <div className="perks-grid">
                      {perks.map(p => (
                        <div className="perk-card" key={p.title}>
                          <div className="perk-icon">{p.icon}</div>
                          <div className="perk-title">{p.title}</div>
                          <p className="perk-body">{p.body}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* GROUP COMING SOON BANNER */}
              {mode === 'group' && (
                <div className="coming-soon-banner">
                  <div className="coming-soon-left">
                    <div className="coming-soon-icon">🚀</div>
                    <div>
                      <div className="coming-soon-title">Group search feature is coming soon</div>
                      <div className="coming-soon-sub">Register your group below and we'll reach out personally to match you to the right home — plus give you early access when it launches.</div>
                    </div>
                  </div>
                  <div className="coming-soon-badge">Early access</div>
                </div>
              )}

              {/* FORM */}
              <div className="form-card">
                {submitted ? (
                  <div className="success-state">
                    <div className="success-icon">✓</div>
                    <div className="success-title">
                      {mode === 'group' ? "Your group is registered!" : "You're on the list!"}
                    </div>
                    <p className="success-sub">
                      {mode === 'group'
                        ? "We'll reach out within 24 hours to match your group to the perfect home and get you early access to our group feature."
                        : "We'll be in touch within a few hours to discuss your options, introduce you to potential roommates, and find the right fit."}
                    </p>
                    <a href="/" className="success-back">Browse available homes →</a>
                  </div>
                ) : (
                  <>
                    <div className="form-title">
                      {mode === 'solo' ? 'Tell us about yourself' : 'Register your group'}
                    </div>
                    <p className="form-sub">
                      {mode === 'solo'
                        ? "Takes 2 minutes. No commitment — we'll reach out to discuss options and make introductions."
                        : "Register your group and we'll personally match you to a home that fits. Your whole crew will thank you."}
                    </p>

                    <div className="form-section-label">Your details</div>
                    <div className="form-grid-2">
                      <div>
                        <label className="form-label">First name</label>
                        <input className="form-input" name="first_name" placeholder="Jordan" value={formData.first_name} onChange={handleChange} />
                      </div>
                      <div>
                        <label className="form-label">Last name</label>
                        <input className="form-input" name="last_name" placeholder="Lee" value={formData.last_name} onChange={handleChange} />
                      </div>
                    </div>
                    <div className="form-grid-2">
                      <div>
                        <label className="form-label">ASU email</label>
                        <input className="form-input" name="email" type="email" placeholder="jlee@asu.edu" value={formData.email} onChange={handleChange} />
                      </div>
                      <div>
                        <label className="form-label">Phone</label>
                        <input className="form-input" name="phone" placeholder="(480) 000-0000" value={formData.phone} onChange={handleChange} />
                      </div>
                    </div>

                    {mode === 'group' && (
                      <>
                        <div className="form-section-label">Your group</div>
                        <div className="form-grid-2">
                          <div>
                            <label className="form-label">Group size</label>
                            <select className="form-input" name="group_size" value={formData.group_size} onChange={handleChange}>
                              <option value="">How many people?</option>
                              <option>2 people</option>
                              <option>3 people</option>
                              <option>4 people</option>
                            </select>
                          </div>
                          <div>
                            <label className="form-label">Group name (optional)</label>
                            <input className="form-input" name="group_name" placeholder="e.g. The Engineering Crew" value={formData.group_name} onChange={handleChange} />
                          </div>
                        </div>
                      </>
                    )}

                    {mode === 'solo' && (
                      <>
                        <div className="form-section-label">What you're looking for</div>
                        <div className="form-field">
                          <label className="form-label">Unit type preference</label>
                          <select className="form-input" name="unit_type" value={formData.unit_type} onChange={handleChange}>
                            <option value="">What works for you?</option>
                            <option>Single room in a shared home (most affordable)</option>
                            <option>Studio apartment (own space)</option>
                            <option>1-bedroom apartment</option>
                            <option>Open to anything in my budget</option>
                          </select>
                        </div>
                      </>
                    )}

                    <div className="form-section-label">Move-in & budget</div>
                    <div className="form-grid-2">
                      <div>
                        <label className="form-label">Expected move-in</label>
                        <select className="form-input" name="move_in_date" value={formData.move_in_date} onChange={handleChange}>
                          <option value="">Select semester</option>
                          <option>August 2025</option>
                          <option>January 2026</option>
                          <option>Flexible</option>
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Monthly budget per person</label>
                        <select className="form-input" name="budget" value={formData.budget} onChange={handleChange}>
                          <option value="">Select range</option>
                          <option>Under $700</option>
                          <option>$700 – $850</option>
                          <option>$850 – $1,100</option>
                          <option>$1,100+</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-section-label">Living style</div>
                    <div className="form-field">
                      <label className="form-label">How would you describe your vibe?</label>
                      <select className="form-input" name="lifestyle" value={formData.lifestyle} onChange={handleChange}>
                        <option value="">Select your living style</option>
                        <option>Early riser, quiet household</option>
                        <option>Night owl, social energy</option>
                        <option>Balanced — work hard, chill on weekends</option>
                        <option>Grad student, mostly working from home</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Anything else? (optional)</label>
                      <textarea
                        className="form-input"
                        name="notes"
                        placeholder={mode === 'group' ? "Tell us about your group — majors, schedules, any specific home requirements..." : "Pet, specific needs, questions, anything helpful..."}
                        value={formData.notes}
                        onChange={handleChange}
                        style={{ height: '80px', resize: 'none' }}
                      />
                    </div>

                    <button
                      className="submit-btn"
                      onClick={handleSubmit}
                      disabled={loading || !formData.first_name || !formData.email}
                    >
                      {loading ? 'Submitting...' : mode === 'group' ? 'Register my group →' : 'Find my roommates →'}
                    </button>
                    <div className="form-trust">
                      {['No commitment', 'We respond within hours', 'No spam'].map(t => (
                        <div className="form-trust-item" key={t}>
                          <span className="trust-dot" />
                          <span>{t}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}
