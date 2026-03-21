'use client'

import { useState } from 'react'

type Tab = 'student' | 'landlord'

const STUDENT_STEPS = [
  {
    n: '01',
    icon: '🏠',
    title: 'Browse verified homes',
    body: 'Every home on HomeHive is owner-verified and listed with real photos, exact pricing, and an ASU fit score. No ghost listings. No bait-and-switch.',
  },
  {
    n: '02',
    icon: '✍️',
    title: 'Submit interest in 2 minutes',
    body: "Tell us your move-in date, budget, and whether you're flying solo or bringing a group. No commitment, no phone call, no credit check yet.",
  },
  {
    n: '03',
    icon: '💬',
    title: 'We reach out within hours',
    body: 'A real person — not a bot — follows up to answer your questions, introduce you to potential roommates if needed, and schedule a tour on your timeline.',
  },
  {
    n: '04',
    icon: '👀',
    title: 'Tour in person or virtually',
    body: "See the home before you commit. In-person or video tour, your choice. We'll coordinate everything — no awkward cold calls with strangers.",
  },
  {
    n: '05',
    icon: '📋',
    title: 'Sign your lease',
    body: 'Everything handled through HomeHive — digital lease, clear terms, no surprise fees at signing. The price you saw is the price you pay.',
  },
  {
    n: '06',
    icon: '🎉',
    title: 'Move in & manage everything here',
    body: 'Pay rent, message your landlord, coordinate with roommates, and handle renewals — all from one place. No Venmo chains. No group chats with 7 people.',
  },
]

const LANDLORD_STEPS = [
  {
    n: '01',
    icon: '📬',
    title: 'Apply to list your property',
    body: 'Email us at landlord@homehive.live with your property details. We review every application — only verified, quality homes make it onto the platform.',
  },
  {
    n: '02',
    icon: '🔍',
    title: 'We vet your listing',
    body: 'Our team verifies ownership, inspects photos, confirms pricing accuracy, and ensures the property meets our quality standards. This protects you and your tenants.',
  },
  {
    n: '03',
    icon: '🚀',
    title: 'Your home goes live',
    body: "We write your listing, optimize it for ASU students, and publish it to our platform. You'll start receiving qualified interest — no cold DMs, no tire-kickers.",
  },
  {
    n: '04',
    icon: '🎯',
    title: 'We qualify your leads',
    body: 'HomeHive filters and scores every inquiry by move-in timeline, budget, and group size. You only spend time on serious, qualified applicants.',
  },
  {
    n: '05',
    icon: '📋',
    title: 'Lease & payment, handled',
    body: 'Digital lease signing, rent collection, and maintenance requests — all managed through HomeHive. Less admin, more time for you.',
  },
  {
    n: '06',
    icon: '📈',
    title: 'Track performance',
    body: 'See views, inquiries, and conversion rates for your listing. Know exactly what\'s working and when to update your price or photos.',
  },
]

const STUDENT_PROBLEMS = [
  {
    problem: 'Listings are already gone by the time you apply',
    solution: 'Every HomeHive listing is live and confirmed available. We update in real time — no stale posts.',
    icon: '👻',
  },
  {
    problem: 'Hidden fees appear at signing',
    solution: 'The price you see is the price you sign. No broker fee, no admin fee, no move-in charge. Period.',
    icon: '💸',
  },
  {
    problem: 'No one responds to your messages',
    solution: 'We guarantee a response within hours. A real person follows up — not an automated email sequence.',
    icon: '🦗',
  },
  {
    problem: 'Finding compatible roommates is a nightmare',
    solution: "Tell us your lifestyle and schedule. We match you with compatible housemates before anyone signs anything.",
    icon: '😬',
  },
  {
    problem: 'Facebook groups are full of scams',
    solution: 'Every landlord on HomeHive is verified. Every listing is reviewed. You\'re dealing with real owners, not scammers.',
    icon: '🚨',
  },
  {
    problem: 'Coordinating a group of friends is chaos',
    solution: 'Submit group interest together. We hold rooms for your crew and coordinate move-in as a unit.',
    icon: '🤯',
  },
]

const LANDLORD_BENEFITS = [
  { icon: '🎯', title: 'Only qualified leads', body: 'No more wasting hours on people who ghost you. We pre-qualify every tenant by budget, timeline, and seriousness.' },
  { icon: '⏱️', title: 'Fill rooms faster', body: 'Our ASU student network means your rooms get in front of the right people at exactly the right time — peak semester season.' },
  { icon: '🔒', title: 'Vetted tenants', body: 'We screen for student status, move-in timeline, and group compatibility. Fewer surprises after move-in.' },
  { icon: '📱', title: 'Manage everything in one place', body: 'Lease, payments, maintenance, renewals — centralized. Stop juggling texts, emails, and Venmo.' },
  { icon: '📣', title: 'Platform marketing included', body: 'We handle your listing copy, photos optimization, and promotion to our ASU student community. No ad spend needed.' },
  { icon: '💼', title: 'Professional, compliant leases', body: 'We provide lease templates that protect you legally and are clearly understood by first-time renters.' },
]

export default function HowItWorksPage() {
  const [tab, setTab] = useState<Tab>('student')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        .page { max-width: 960px; margin: 0 auto; padding: 0 24px 100px; }

        /* HERO */
        .hiw-hero { text-align: center; padding: 64px 0 48px; border-bottom: 1px solid #e8e4db; margin-bottom: 48px; }
        .hiw-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: #f0e6cc; color: #92620a; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 20px; }
        .hiw-title { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 300; color: #1a1a1a; letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 16px; }
        .hiw-title em { font-style: italic; color: #8C1D40; }
        .hiw-sub { font-size: 16px; color: #6b6b6b; line-height: 1.7; max-width: 520px; margin: 0 auto; }

        /* TAB TOGGLE */
        .tab-wrap { display: flex; justify-content: center; margin-bottom: 56px; }
        .tab-toggle { display: flex; background: #fff; border: 1.5px solid #e8e4db; border-radius: 10px; padding: 4px; gap: 4px; }
        .tab-btn {
          padding: 10px 28px; border-radius: 7px; border: none; cursor: pointer;
          font-size: 14px; font-weight: 500; font-family: 'DM Sans', sans-serif;
          color: #6b6b6b; background: transparent; transition: all 0.2s; white-space: nowrap;
        }
        .tab-btn.active { background: #8C1D40; color: #fff; }
        .tab-btn:not(.active):hover { background: #f5f4f0; color: #1a1a1a; }

        /* SECTION TITLES */
        .section-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #c9973a; margin-bottom: 10px; }
        .section-title { font-family: 'Fraunces', serif; font-size: 34px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.2; margin-bottom: 8px; }
        .section-title em { font-style: italic; }
        .section-sub { font-size: 15px; color: #6b6b6b; line-height: 1.7; max-width: 540px; margin-bottom: 40px; }

        /* STEPS GRID */
        .steps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 72px; }
        .step-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 24px; position: relative; transition: border-color 0.2s, box-shadow 0.2s; }
        .step-card:hover { border-color: #d4c9b0; box-shadow: 0 8px 32px rgba(0,0,0,0.06); }
        .step-num { font-family: 'Fraunces', serif; font-size: 11px; font-weight: 600; color: #c9973a; letter-spacing: 1px; margin-bottom: 12px; }
        .step-icon { font-size: 28px; margin-bottom: 10px; display: block; }
        .step-title { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; }
        .step-body { font-size: 13px; color: #6b6b6b; line-height: 1.65; }

        /* CONNECTOR LINE between steps */
        .steps-visual { display: flex; flex-direction: column; gap: 0; margin-bottom: 72px; }
        .step-row { display: flex; gap: 20px; align-items: flex-start; padding: 20px 0; border-bottom: 1px solid #f0ede6; }
        .step-row:last-child { border-bottom: none; }
        .step-circle { width: 44px; height: 44px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
        .step-content { flex: 1; }
        .step-row-title { font-size: 16px; font-weight: 600; color: #1a1a1a; margin-bottom: 5px; display: flex; align-items: center; gap: 8px; }
        .step-row-body { font-size: 14px; color: #6b6b6b; line-height: 1.65; }

        /* PROBLEMS & SOLUTIONS */
        .problems-section { margin-bottom: 72px; }
        .problems-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .problem-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 20px 22px; }
        .problem-top { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
        .problem-icon { font-size: 20px; flex-shrink: 0; }
        .problem-label { font-size: 13px; font-weight: 600; color: #1a1a1a; line-height: 1.4; }
        .problem-divider { height: 1px; background: #f0ede6; margin-bottom: 10px; }
        .solution-row { display: flex; align-items: flex-start; gap: 8px; }
        .solution-check { color: #16a34a; font-size: 13px; flex-shrink: 0; margin-top: 1px; font-weight: 700; }
        .solution-text { font-size: 13px; color: #3a3a3a; line-height: 1.55; }

        /* BENEFITS GRID */
        .benefits-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 72px; }
        .benefit-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 22px; }
        .benefit-icon { font-size: 24px; margin-bottom: 10px; display: block; }
        .benefit-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
        .benefit-body { font-size: 13px; color: #6b6b6b; line-height: 1.6; }

        /* VETTING CALLOUT */
        .vetting-box { background: #1a1a1a; border-radius: 14px; padding: 36px 40px; margin-bottom: 72px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; }
        .vetting-left {}
        .vetting-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #c9973a; margin-bottom: 10px; }
        .vetting-title { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 300; color: #fff; line-height: 1.25; margin-bottom: 12px; }
        .vetting-title em { font-style: italic; color: #FFC627; }
        .vetting-body { font-size: 14px; color: #9b9b9b; line-height: 1.7; }
        .vetting-right { display: flex; flex-direction: column; gap: 12px; }
        .vetting-step { display: flex; align-items: flex-start; gap: 12px; }
        .vetting-bullet { width: 24px; height: 24px; border-radius: 50%; background: rgba(201,151,58,0.2); border: 1px solid rgba(201,151,58,0.4); display: flex; align-items: center; justify-content: center; font-size: 11px; color: #c9973a; font-weight: 700; flex-shrink: 0; }
        .vetting-step-text { font-size: 13px; color: #c5c1b8; line-height: 1.55; }
        .vetting-step-text strong { color: #fff; font-weight: 500; }

        /* CTA SECTION */
        .cta-section { background: #8C1D40; border-radius: 16px; padding: 48px 40px; text-align: center; }
        .cta-title { font-family: 'Fraunces', serif; font-size: 36px; font-weight: 300; color: #fff; letter-spacing: -0.5px; margin-bottom: 12px; line-height: 1.15; }
        .cta-title em { font-style: italic; color: #FFC627; }
        .cta-sub { font-size: 15px; color: rgba(255,255,255,0.75); line-height: 1.7; max-width: 440px; margin: 0 auto 32px; }
        .cta-buttons { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
        .cta-primary { background: #FFC627; color: #8C1D40; padding: 13px 30px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .cta-primary:hover { background: #e6b320; }
        .cta-ghost { color: rgba(255,255,255,0.85); padding: 13px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none; border: 1px solid rgba(255,255,255,0.25); transition: all 0.2s; }
        .cta-ghost:hover { border-color: rgba(255,255,255,0.6); color: #fff; }

        /* COMING SOON BADGE */
        .coming-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(201,151,58,0.15); border: 1px solid rgba(201,151,58,0.3); border-radius: 20px; padding: 4px 12px; font-size: 11px; color: #c9973a; font-weight: 600; letter-spacing: 0.3px; margin-bottom: 24px; }

        @media (max-width: 680px) {
          .hiw-title { font-size: 34px; }
          .steps-grid { grid-template-columns: 1fr; }
          .problems-grid { grid-template-columns: 1fr; }
          .benefits-grid { grid-template-columns: 1fr 1fr; }
          .vetting-box { grid-template-columns: 1fr; padding: 28px 24px; }
          .cta-section { padding: 36px 24px; }
          .cta-title { font-size: 28px; }
          .tab-btn { padding: 10px 18px; font-size: 13px; }
          .section-title { font-size: 26px; }
        }
        @media (max-width: 420px) {
          .benefits-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="page">

        {/* HERO */}
        <div className="hiw-hero">
          <div className="hiw-eyebrow">⚡ Tempe, AZ · Near ASU</div>
          <h1 className="hiw-title">Finding your home<br />shouldn't be this <em>hard.</em></h1>
          <p className="hiw-sub">HomeHive makes off-campus housing simple, scam-free, and actually kind of stress-free. Here's exactly how it works.</p>
        </div>

        {/* TAB TOGGLE */}
        <div className="tab-wrap">
          <div className="tab-toggle">
            <button className={`tab-btn${tab === 'student' ? ' active' : ''}`} onClick={() => setTab('student')}>
              🎓 I'm a student
            </button>
            <button className={`tab-btn${tab === 'landlord' ? ' active' : ''}`} onClick={() => setTab('landlord')}>
              🏠 I'm a landlord
            </button>
          </div>
        </div>

        {/* ── STUDENT VIEW ── */}
        {tab === 'student' && (
          <>
            {/* SIMPLE STEPS */}
            <div style={{ marginBottom: '72px' }}>
              <div className="section-eyebrow">How it works</div>
              <div className="section-title">From browsing to <em>moved in.</em></div>
              <p className="section-sub">Six steps. No cold calls. No surprises. Everything managed in one place — solo or with your whole squad.</p>

              <div className="steps-visual">
                {STUDENT_STEPS.map((step, i) => (
                  <div className="step-row" key={step.n}>
                    <div className="step-circle">{i + 1}</div>
                    <div className="step-content">
                      <div className="step-row-title">
                        <span>{step.icon}</span>
                        {step.title}
                      </div>
                      <div className="step-row-body">{step.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PROBLEMS & SOLUTIONS */}
            <div className="problems-section">
              <div className="section-eyebrow">Sound familiar?</div>
              <div className="section-title">The problems <em>we solve.</em></div>
              <p className="section-sub">Every one of these has happened to an ASU student this semester. Here's what HomeHive does about it.</p>
              <div className="problems-grid">
                {STUDENT_PROBLEMS.map(p => (
                  <div className="problem-card" key={p.problem}>
                    <div className="problem-top">
                      <span className="problem-icon">{p.icon}</span>
                      <span className="problem-label">{p.problem}</span>
                    </div>
                    <div className="problem-divider" />
                    <div className="solution-row">
                      <span className="solution-check">✓</span>
                      <span className="solution-text">{p.solution}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* BENEFITS CALLOUT */}
            <div style={{ marginBottom: '72px' }}>
              <div className="section-eyebrow">Why students choose HomeHive</div>
              <div className="section-title">Built for how <em>you actually live.</em></div>
              <p className="section-sub">Whether you're a grad student who wants quiet, or a group of 6 who needs a whole house — we've got you.</p>
              <div className="steps-grid">
                {[
                  { icon: '👥', title: 'Solo or squad', body: "Coming in solo and need roommates? We match you. Already have 5 friends? We'll find you a whole house." },
                  { icon: '💰', title: 'Price you can trust', body: 'No broker fees, no move-in fees, no surprises. The number on the listing is the number you pay.' },
                  { icon: '⚡', title: 'Response within hours', body: 'Submit interest in 2 minutes and hear back the same day. Not next week.' },
                  { icon: '📱', title: 'Manage everything here', body: 'Questions, tours, lease, payments, maintenance — all from one dashboard. No more text threads with 6 people.' },
                  { icon: '🔒', title: 'Zero scam risk', body: 'Every listing is owner-verified. Every landlord is vetted. You know exactly who you\'re dealing with.' },
                  { icon: '📅', title: 'Semester-friendly timing', body: 'Move-in dates built around the ASU academic calendar. Fall, spring, or summer — we work with your schedule.' },
                ].map(b => (
                  <div className="step-card" key={b.title}>
                    <span className="step-icon">{b.icon}</span>
                    <div className="step-title">{b.title}</div>
                    <div className="step-body">{b.body}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* STUDENT CTA */}
            <div className="cta-section">
              <div className="cta-title">Ready to find your<br /><em>home near ASU?</em></div>
              <p className="cta-sub">Browse our verified listings and submit interest in under 2 minutes. No commitment, no phone calls.</p>
              <div className="cta-buttons">
                <a href="/homes" className="cta-primary">Browse available homes →</a>
                <a href="/roommates" className="cta-ghost">Find roommates</a>
              </div>
            </div>
          </>
        )}

        {/* ── LANDLORD VIEW ── */}
        {tab === 'landlord' && (
          <>
            {/* COMING SOON CALLOUT */}
            <div style={{ textAlign: 'center', marginBottom: '48px' }}>
              <div className="coming-badge">🚀 Landlord platform — coming soon</div>
              <p style={{ fontSize: '15px', color: '#6b6b6b', lineHeight: 1.7, maxWidth: '520px', margin: '0 auto' }}>
                We're opening HomeHive to verified landlords near ASU. If you have a property to list, reach out now and get early access — your listing could be live within 48 hours.
              </p>
            </div>

            {/* LANDLORD STEPS */}
            <div style={{ marginBottom: '72px' }}>
              <div className="section-eyebrow">How it works for landlords</div>
              <div className="section-title">List once. Fill rooms <em>faster.</em></div>
              <p className="section-sub">Stop spending hours on Facebook groups, Zillow, and Craigslist. HomeHive brings qualified ASU tenants directly to you.</p>

              <div className="steps-visual">
                {LANDLORD_STEPS.map((step, i) => (
                  <div className="step-row" key={step.n}>
                    <div className="step-circle">{i + 1}</div>
                    <div className="step-content">
                      <div className="step-row-title">
                        <span>{step.icon}</span>
                        {step.title}
                      </div>
                      <div className="step-row-body">{step.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* VETTING BOX */}
            <div className="vetting-box" style={{ marginBottom: '56px' }}>
              <div className="vetting-left">
                <div className="vetting-eyebrow">Our promise to tenants</div>
                <div className="vetting-title">Every landlord on<br />HomeHive is <em>verified.</em></div>
                <p className="vetting-body">We run a thorough vetting process before any landlord goes live on our platform. This protects our student community — and it makes your listing more credible to serious applicants.</p>
              </div>
              <div className="vetting-right">
                {[
                  { n: '1', text: '<strong>Ownership verification</strong> — we confirm you own or are authorized to lease the property.' },
                  { n: '2', text: '<strong>Property inspection</strong> — photos, condition, and accuracy of listing details reviewed.' },
                  { n: '3', text: '<strong>Pricing transparency check</strong> — no hidden fees or misleading rates permitted.' },
                  { n: '4', text: '<strong>Identity confirmation</strong> — we know who we\'re working with before going live.' },
                  { n: '5', text: '<strong>Ongoing quality monitoring</strong> — tenant feedback directly impacts your listing status.' },
                ].map(v => (
                  <div className="vetting-step" key={v.n}>
                    <div className="vetting-bullet">{v.n}</div>
                    <div className="vetting-step-text" dangerouslySetInnerHTML={{ __html: v.text }} />
                  </div>
                ))}
              </div>
            </div>

            {/* LANDLORD BENEFITS */}
            <div style={{ marginBottom: '72px' }}>
              <div className="section-eyebrow">Why landlords choose HomeHive</div>
              <div className="section-title">Less work.<br /><em>Better tenants.</em></div>
              <p className="section-sub" style={{ marginBottom: '32px' }}>We built this for landlords who are tired of managing everything manually and dealing with unqualified leads.</p>
              <div className="benefits-grid">
                {LANDLORD_BENEFITS.map(b => (
                  <div className="benefit-card" key={b.title}>
                    <span className="benefit-icon">{b.icon}</span>
                    <div className="benefit-title">{b.title}</div>
                    <p className="benefit-body">{b.body}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* LANDLORD CTA */}
            <div className="cta-section">
              <div className="cta-title">Ready to list your<br /><em>property on HomeHive?</em></div>
              <p className="cta-sub">Email us to apply. We'll review your property within 48 hours and get you set up with early access to the platform.</p>
              <div className="cta-buttons">
                <a href="mailto:landlord@homehive.live" className="cta-primary">Apply to list — landlord@homehive.live</a>
                <a href="/homes" className="cta-ghost">See how listings look</a>
              </div>
              <p style={{ marginTop: '16px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                We respond to every application within 48 hours. No spam. No cold outreach.
              </p>
            </div>
          </>
        )}

      </div>
    </>
  )
}
