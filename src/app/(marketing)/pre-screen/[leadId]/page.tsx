'use client'

import { useState, useEffect, use } from 'react'
import { getLeadById, updateLeadStatus } from '@/lib/leads'

export default function PreScreenPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = use(params)

  const [firstName, setFirstName] = useState<string | null>(null)
  const [property, setProperty] = useState<string | null>(null)
  const [leadStatus, setLeadStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [formData, setFormData] = useState({
    budget: '',
    lease_length: '',
    roommate_preference: '',
    lifestyle: '',
    notes: '',
  })

  useEffect(() => {
    async function load() {
      const lead = await getLeadById(leadId)
      if (!lead) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setFirstName(lead.first_name)
      setProperty(lead.property)
      setLeadStatus(lead.status)
      setLoading(false)

      // Fire-and-forget: mark as engaged
      if (lead.status === 'new' || lead.status === 'contacted') {
        updateLeadStatus(leadId, 'engaged').catch(console.error)
      }
    }
    load()
  }, [leadId])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleRoommateSelect = (val: string) => {
    setFormData(prev => ({ ...prev, roommate_preference: val }))
  }

  const canSubmit =
    formData.budget.trim() !== '' &&
    formData.lease_length.trim() !== '' &&
    formData.roommate_preference.trim() !== '' &&
    formData.lifestyle.trim() !== ''

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/prescreen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        setSubmitted(true)
      }
    } catch (e) {
      console.error(e)
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');`}</style>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid #e2e8f0',
          borderTopColor: '#10b981',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (notFound) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');`}</style>
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '48px 40px',
          maxWidth: '440px',
          width: '100%',
          textAlign: 'center',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'rgba(239,68,68,0.1)',
            color: '#ef4444',
            fontSize: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            ✕
          </div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            This link has expired
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: '15px', color: '#64748b', lineHeight: 1.6 }}>
            This pre-screen link is no longer valid. It may have already been used or expired after 7 days.
          </p>
          <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8' }}>
            Have questions? Email us at{' '}
            <a href="mailto:hello@homehive.live" style={{ color: '#10b981', textDecoration: 'none' }}>
              hello@homehive.live
            </a>
          </p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');`}</style>
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '48px 40px',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(16,185,129,0.12)',
            color: '#10b981',
            fontSize: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            ✓
          </div>
          <h2 style={{ margin: '0 0 12px', fontSize: '26px', fontWeight: 700, color: '#0f172a' }}>
            You're all set!
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '16px', color: '#475569', lineHeight: 1.7 }}>
            {firstName ? `Great work, ${firstName}.` : 'Great work.'} Your profile is complete.
          </p>
          <div style={{
            background: 'rgba(16,185,129,0.07)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: '10px',
            padding: '16px 20px',
            marginBottom: '24px',
          }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#065f46', lineHeight: 1.6 }}>
              We'll reach out within 24 hours to confirm your spot{property ? ` at ${property}` : ''}.
              Keep an eye on your inbox!
            </p>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
            Questions? <a href="mailto:hello@homehive.live" style={{ color: '#10b981', textDecoration: 'none' }}>hello@homehive.live</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      fontFamily: "'DM Sans', sans-serif",
      padding: '32px 24px 60px',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        .ps-input {
          width: 100%;
          padding: 11px 14px;
          border: 1.5px solid #e2e8f0;
          border-radius: 8px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          color: #0f172a;
          background: #ffffff;
          outline: none;
          transition: border-color 0.15s;
        }
        .ps-input:focus { border-color: #10b981; }
        .ps-label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #334155;
          margin-bottom: 6px;
        }
        .roommate-card {
          flex: 1;
          padding: 16px;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          cursor: pointer;
          text-align: center;
          transition: border-color 0.15s, background 0.15s;
          background: #ffffff;
        }
        .roommate-card:hover { border-color: #10b981; background: rgba(16,185,129,0.04); }
        .roommate-card.selected { border-color: #10b981; background: rgba(16,185,129,0.08); }
        .roommate-card-title { font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 8px; }
        .roommate-card-sub { font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.4; }
        .submit-btn {
          width: 100%;
          padding: 14px;
          background: #10b981;
          color: #ffffff;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .submit-btn:not(:disabled):hover { opacity: 0.9; }
      `}</style>

      <div style={{ maxWidth: '520px', margin: '0 auto' }}>

        {/* Progress indicator */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: '#10b981', color: '#fff',
              fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✓</div>
            <div style={{ width: '32px', height: '2px', background: '#10b981', borderRadius: '1px' }} />
            <div style={{
              width: '24px', height: '24px', borderRadius: '50%',
              background: '#10b981', color: '#fff',
              fontSize: '11px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>2</div>
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Step 2 of 2 — Complete your profile</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Takes about 2 minutes</div>
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
            textTransform: 'uppercase', color: '#10b981', marginBottom: '8px',
          }}>
            Almost there
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            {firstName ? `Hi ${firstName},` : 'Complete your profile'}
          </h1>
          <p style={{ margin: '0 0 28px', fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>
            Help{property ? ` the landlord at ${property}` : ' the landlord'} find the right fit. This takes 2 minutes and dramatically increases your chances of getting the room.
          </p>

          {/* Budget */}
          <div style={{ marginBottom: '20px' }}>
            <label className="ps-label">Monthly Budget *</label>
            <select className="ps-input" name="budget" value={formData.budget} onChange={handleChange}>
              <option value="">Select your range</option>
              <option value="Under $700">Under $700</option>
              <option value="$700–$850">$700–$850</option>
              <option value="$850–$1,000">$850–$1,000</option>
              <option value="$1,000+">$1,000+</option>
            </select>
          </div>

          {/* Lease Length */}
          <div style={{ marginBottom: '20px' }}>
            <label className="ps-label">Lease Length *</label>
            <select className="ps-input" name="lease_length" value={formData.lease_length} onChange={handleChange}>
              <option value="">Select preference</option>
              <option value="1 semester">1 semester</option>
              <option value="1 year">1 year</option>
              <option value="Flexible">Flexible</option>
            </select>
          </div>

          {/* Roommate Status */}
          <div style={{ marginBottom: '20px' }}>
            <label className="ps-label">Roommate Status *</label>
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <div
                className={`roommate-card${formData.roommate_preference === 'have_roommates' ? ' selected' : ''}`}
                onClick={() => handleRoommateSelect('have_roommates')}
              >
                <div style={{ fontSize: '22px' }}>👥</div>
                <div className="roommate-card-title">I have roommates</div>
                <div className="roommate-card-sub">We're a group</div>
              </div>
              <div
                className={`roommate-card${formData.roommate_preference === 'solo' ? ' selected' : ''}`}
                onClick={() => handleRoommateSelect('solo')}
              >
                <div style={{ fontSize: '22px' }}>🙋</div>
                <div className="roommate-card-title">I'm looking solo</div>
                <div className="roommate-card-sub">Just me</div>
              </div>
            </div>
          </div>

          {/* Lifestyle */}
          <div style={{ marginBottom: '20px' }}>
            <label className="ps-label">Lifestyle *</label>
            <select className="ps-input" name="lifestyle" value={formData.lifestyle} onChange={handleChange}>
              <option value="">Select your vibe</option>
              <option value="Early riser / quiet">Early riser / quiet</option>
              <option value="Night owl / social">Night owl / social</option>
              <option value="Balanced">Balanced</option>
              <option value="Grad student / remote">Grad student / remote</option>
            </select>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '28px' }}>
            <label className="ps-label">Anything else? (optional)</label>
            <textarea
              className="ps-input"
              name="notes"
              placeholder="Pets, specific room needs, questions about the property..."
              value={formData.notes}
              onChange={handleChange}
              style={{ height: '80px', resize: 'none' }}
            />
          </div>

          <button
            className="submit-btn"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Submitting...' : 'Submit My Profile →'}
          </button>

          <p style={{ margin: '16px 0 0', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
            Your info is private and only shared with the landlord.
          </p>
        </div>
      </div>
    </div>
  )
}
