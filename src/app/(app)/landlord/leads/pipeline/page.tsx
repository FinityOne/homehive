'use client'

const STAGES = [
  {
    status: 'new',
    label: 'New',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    description: 'A tenant just submitted their contact info on your property listing.',
    when: 'Automatically set when a tenant fills out the interest form.',
    tip: 'Best practice: respond within 2 hours for a 3x higher conversion rate. A quick "Got your info!" message goes a long way.',
  },
  {
    status: 'contacted',
    label: 'Contacted',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    description: 'You\'ve reached out to the lead via email, text, or phone.',
    when: 'Move here once you\'ve sent your first outreach message.',
    tip: 'Keep it personal — use their first name and reference the specific property they\'re interested in. Avoid generic copy-paste messages.',
  },
  {
    status: 'engaged',
    label: 'Engaged',
    color: '#eab308',
    bg: 'rgba(234,179,8,0.08)',
    description: 'The lead clicked their personal pre-screen link, showing real intent.',
    when: 'Automatically set when the lead opens their pre-screen link.',
    tip: 'Engaged leads are 4x more likely to convert than cold contacts. Strike while the iron is hot — follow up within the same day.',
  },
  {
    status: 'qualified',
    label: 'Qualified',
    color: '#10b981',
    bg: 'rgba(16,185,129,0.08)',
    description: 'The lead completed their profile: budget, lifestyle, and lease preferences.',
    when: 'Automatically set when the pre-screen form is submitted.',
    tip: 'Review their budget and lifestyle before scheduling a tour. A 5-minute read of their profile can prevent a wasted showing.',
  },
  {
    status: 'tour_scheduled',
    label: 'Tour Scheduled',
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    description: 'A tour has been booked — this lead is one step away from signing.',
    when: 'Move here once a tour date is confirmed with the lead.',
    tip: 'Send a reminder 24 hours before the tour. Have the unit clean and ready. First impressions close leases.',
  },
  {
    status: 'closed',
    label: 'Closed',
    color: '#6b7280',
    bg: 'rgba(107,114,128,0.08)',
    description: 'The lead is done — either they signed (Leased) or moved on (Lost).',
    when: 'Move here after the tour result is known.',
    tip: 'For lost leads, note the reason. Patterns in why leads fall off help you improve your listing or pricing over time.',
  },
]

export default function PipelineGuidePage() {
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#f8fafc', minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      {/* Page Header */}
      <div style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '20px 40px',
      }}>
        <a
          href="/landlord/leads"
          style={{ fontSize: '13px', color: '#10b981', textDecoration: 'none', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}
        >
          ← Back to Leads
        </a>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>
          Understanding Your Lead Pipeline
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: '15px', color: '#64748b', maxWidth: '560px', lineHeight: 1.6 }}>
          HomeHive automatically tracks every lead from first contact to lease. Here's what each stage means and how to move leads forward efficiently.
        </p>
      </div>

      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Flow header */}
        <div style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
          borderRadius: '16px',
          padding: '28px 32px',
          marginBottom: '40px',
          color: '#f1f5f9',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            The Pipeline Flow
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
            {STAGES.map((stage, i) => (
              <span key={stage.status} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{
                  background: stage.color,
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '999px',
                }}>
                  {stage.label}
                </span>
                {i < STAGES.length - 1 && (
                  <span style={{ color: 'rgba(241,245,249,0.4)', fontSize: '14px' }}>→</span>
                )}
              </span>
            ))}
          </div>
          <p style={{ margin: '16px 0 0', fontSize: '13px', color: 'rgba(241,245,249,0.65)', lineHeight: 1.6 }}>
            Each lead automatically advances through stages as they take action. You manually move them between stages as you make contact and schedule tours.
          </p>
        </div>

        {/* Stage Cards */}
        {STAGES.map((stage, i) => (
          <div
            key={stage.status}
            style={{
              display: 'flex',
              gap: '20px',
              marginBottom: '28px',
            }}
          >
            {/* Timeline connector */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: '4px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: stage.color,
                color: '#fff',
                fontSize: '14px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {i + 1}
              </div>
              {i < STAGES.length - 1 && (
                <div style={{ width: '2px', flex: 1, background: '#e2e8f0', marginTop: '8px', minHeight: '40px' }} />
              )}
            </div>

            {/* Card */}
            <div style={{
              flex: 1,
              background: '#ffffff',
              borderRadius: '12px',
              borderLeft: `4px solid ${stage.color}`,
              padding: '20px 24px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              marginBottom: i < STAGES.length - 1 ? '0' : '0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{
                  background: stage.bg,
                  color: stage.color,
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '999px',
                  border: `1px solid ${stage.color}33`,
                }}>
                  {stage.label}
                </span>
              </div>

              <p style={{ margin: '0 0 10px', fontSize: '15px', color: '#0f172a', fontWeight: 500, lineHeight: 1.5 }}>
                {stage.description}
              </p>

              <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
                <strong style={{ color: '#334155' }}>When to move here:</strong> {stage.when}
              </p>

              {/* Tip box */}
              <div style={{
                background: 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: '8px',
                padding: '12px 16px',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                  Pro Tip
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: '#065f46', lineHeight: 1.6 }}>
                  {stage.tip}
                </p>
              </div>
            </div>
          </div>
        ))}

        {/* Competitive edge section */}
        <div style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
          borderRadius: '16px',
          padding: '36px 32px',
          marginTop: '20px',
          color: '#f1f5f9',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            The HomeHive Edge
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 700 }}>
            Why HomeHive leads convert better than Zillow
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: '14px', color: 'rgba(241,245,249,0.6)', lineHeight: 1.6 }}>
            Not all leads are created equal. Here's what makes HomeHive leads different.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '32px' }}>
            {[
              {
                icon: '✅',
                title: 'Pre-screened',
                body: 'Leads fill out their budget, lifestyle, and preferences before they ever call you. You know if they\'re a fit before picking up the phone.',
              },
              {
                icon: '🎯',
                title: 'Intent-based',
                body: 'They came to your specific listing, not a generic search result. That signal of interest is worth more than 10 cold inquiries.',
              },
              {
                icon: '🎓',
                title: 'Student-specific',
                body: 'ASU-focused demographics mean predictable lease cycles — you can plan availability around semesters, not random turnover.',
              },
            ].map(item => (
              <div
                key={item.title}
                style={{
                  display: 'flex',
                  gap: '14px',
                  alignItems: 'flex-start',
                  background: 'rgba(241,245,249,0.05)',
                  borderRadius: '10px',
                  padding: '16px',
                }}
              >
                <span style={{ fontSize: '20px', flexShrink: 0, marginTop: '2px' }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{item.title}</div>
                  <div style={{ fontSize: '13px', color: 'rgba(241,245,249,0.65)', lineHeight: 1.6 }}>{item.body}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats callout */}
          <div style={{
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '12px',
            padding: '20px 24px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '32px', fontWeight: 800, color: '#34d399', letterSpacing: '-1px', marginBottom: '4px' }}>
              18 days
            </div>
            <div style={{ fontSize: '14px', color: 'rgba(241,245,249,0.8)', lineHeight: 1.5 }}>
              Average time to lease for HomeHive landlords<br />
              <span style={{ fontSize: '12px', color: 'rgba(241,245,249,0.45)' }}>vs. 45+ days on traditional platforms</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
