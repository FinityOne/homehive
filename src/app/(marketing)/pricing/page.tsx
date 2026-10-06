'use client'

import { useState } from 'react'
import { PLANS, PLAN_ORDER, formatUsd, formatPropertyLimit } from '@/lib/landlordPlans'

type Tab = 'student' | 'landlord'

const STUDENT_FREE = [
  { icon: '🏠', label: 'Browse all verified listings' },
  { icon: '✍️', label: 'Submit unlimited interest forms' },
  { icon: '👥', label: 'Roommate matching & introductions' },
  { icon: '💬', label: 'Direct messaging with landlords' },
  { icon: '📅', label: 'Tour scheduling & coordination' },
  { icon: '📋', label: 'Digital lease signing' },
  { icon: '💳', label: 'Rent payments through the platform' },
  { icon: '🔔', label: 'New listing alerts' },
  { icon: '📦', label: 'Move-in coordination & checklists' },
]

// Every plan includes all of this. The tiers differ only in how many
// properties you may list, so the feature list is written once.
const LANDLORD_INCLUDED = [
  { icon: '📸', label: 'Listing creation & professional copy' },
  { icon: '🎯', label: 'Unlimited inquiries — no per-lead fees' },
  { icon: '✅', label: 'Tenant pre-screening & background checks' },
  { icon: '📋', label: 'Digital leases & e-signature' },
  { icon: '💳', label: 'Online rent collection' },
  { icon: '📊', label: 'Listing analytics & performance data' },
  { icon: '🔧', label: 'Maintenance request management' },
  { icon: '📅', label: 'Tours, calendar & messaging' },
  { icon: '📦', label: 'Move-out inspections & deposits' },
]

const FAQS_STUDENT = [
  {
    q: 'Is HomeHive actually free for students?',
    a: "Yes. No credit card, no trial period, no freemium catch. HomeHive is completely free for students — now and going forward. We make money from landlords, not tenants.",
  },
  {
    q: 'Will you ever charge students?',
    a: "No. That's our brand promise. The moment we charge students, we become just another rental platform. We exist to make finding housing easier for ASU students, not to extract money from them.",
  },
  {
    q: "What's the catch?",
    a: "There isn't one. We're building the platform landlords want to use, and a marketplace only works if students show up. Keeping students free forever is how we grow.",
  },
  {
    q: 'Do I need to create an account?',
    a: "You can browse and submit interest without an account. Creating one unlocks messaging, tour scheduling, lease signing, and payment — all still free.",
  },
]

const FAQS_LANDLORD = [
  {
    q: 'What exactly am I paying for?',
    a: "Access to the whole platform. Every plan includes the same tools — listings, leads, screening, tours, leases, rent collection, maintenance and move-out. The only difference between plans is how many properties you can have listed at once.",
  },
  {
    q: 'Are there any other fees?',
    a: "No. No per-lead charges, no commission on filled rooms, no listing fees, no setup fee. One monthly price, and that is the whole relationship. (Tenants paying rent by card or ACH see a processing surcharge, which goes to the card networks, not to us.)",
  },
  {
    q: 'What if I add a property mid-month?',
    a: "If it fits your plan, just add it — nothing changes. If you have hit your limit, switching up a tier takes effect immediately and Stripe prorates the difference, so you are never charged twice for the same month.",
  },
  {
    q: 'Can I cancel?',
    a: "Any time, from your billing page, in two clicks. You keep full access until the end of the period you have already paid for. We do not ask you to email anyone or sit through a retention call.",
  },
  {
    q: 'What does the vetting process involve?',
    a: "We verify property ownership, review listing accuracy, confirm pricing transparency, and do a quality check on photos — usually within 48 hours of your first listing. This protects your reputation as much as it protects our students.",
  },
]

function FAQ({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {items.map((item, i) => (
        <div
          key={i}
          style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.15s', ...(open === i ? { borderColor: '#d4c9b0' } : {}) }}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{ width: '100%', background: 'none', border: 'none', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", gap: '12px' }}
          >
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', textAlign: 'left' }}>{item.q}</span>
            <span style={{ color: '#8C1D40', fontSize: '18px', flexShrink: 0, transition: 'transform 0.2s', transform: open === i ? 'rotate(45deg)' : 'rotate(0)' }}>+</span>
          </button>
          {open === i && (
            <div style={{ padding: '0 20px 16px', fontSize: '14px', color: '#6b6b6b', lineHeight: 1.7 }}>
              {item.a}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>('student')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }
        .page { max-width: 860px; margin: 0 auto; padding: 0 24px 100px; }

        .hero { text-align: center; padding: 64px 0 48px; border-bottom: 1px solid #e8e4db; margin-bottom: 48px; }
        .hero-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: #f0e6cc; color: #92620a; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 20px; }
        .hero-title { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 300; color: #1a1a1a; letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 14px; }
        .hero-title em { font-style: italic; color: #8C1D40; }
        .hero-sub { font-size: 16px; color: #6b6b6b; line-height: 1.7; max-width: 480px; margin: 0 auto; }

        .tab-wrap { display: flex; justify-content: center; margin-bottom: 48px; }
        .tab-toggle { display: flex; background: #fff; border: 1.5px solid #e8e4db; border-radius: 10px; padding: 4px; gap: 4px; }
        .tab-btn { padding: 10px 28px; border-radius: 7px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; font-family: 'DM Sans', sans-serif; color: #6b6b6b; background: transparent; transition: all 0.2s; white-space: nowrap; }
        .tab-btn.active { background: #8C1D40; color: #fff; }
        .tab-btn:not(.active):hover { background: #f5f4f0; color: #1a1a1a; }

        /* PRICE CARD */
        .price-card { border-radius: 20px; padding: 40px; margin-bottom: 32px; position: relative; overflow: hidden; }
        .price-card.free-student { background: #1a1a1a; }
        .price-card.free-landlord { background: linear-gradient(135deg, #1a1a1a 0%, #2d1a0a 100%); border: 1px solid rgba(201,151,58,0.3); }
        .price-glow { position: absolute; top: -60px; right: -60px; width: 240px; height: 240px; border-radius: 50%; background: radial-gradient(circle, rgba(140,29,64,0.18) 0%, transparent 70%); pointer-events: none; }
        .price-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,198,39,0.15); border: 1px solid rgba(255,198,39,0.35); border-radius: 20px; padding: 4px 12px; margin-bottom: 20px; }
        .price-badge-text { font-size: 11px; color: #FFC627; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
        .price-num { font-family: 'Fraunces', serif; font-size: 72px; font-weight: 300; color: #fff; letter-spacing: -3px; line-height: 1; margin-bottom: 4px; }
        .price-num em { font-style: normal; font-size: 20px; color: rgba(255,255,255,0.5); letter-spacing: 0; vertical-align: middle; }
        .price-label { font-size: 14px; color: rgba(255,255,255,0.55); margin-bottom: 24px; }
        .price-title { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 300; color: #fff; margin-bottom: 8px; line-height: 1.2; }
        .price-title em { font-style: italic; color: #FFC627; }
        .price-sub { font-size: 14px; color: rgba(255,255,255,0.6); line-height: 1.65; max-width: 480px; margin-bottom: 32px; }

        .features-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 32px; }
        .feature-item { display: flex; align-items: center; gap: 9px; }
        .feature-icon { font-size: 15px; flex-shrink: 0; }
        .feature-label { font-size: 13px; color: rgba(255,255,255,0.75); }

        .price-cta { display: inline-flex; align-items: center; gap: 8px; background: #FFC627; color: #1a1a1a; padding: 13px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .price-cta:hover { background: #e6b320; }
        .price-cta-ghost { display: inline-flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.7); padding: 13px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none; border: 1px solid rgba(255,255,255,0.2); transition: all 0.2s; margin-left: 10px; }
        .price-cta-ghost:hover { border-color: rgba(255,255,255,0.5); color: #fff; }

        /* TIER GRID */
        .tier-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
        .tier { background: #fff; border: 1.5px solid #e8e4db; border-radius: 14px; padding: 26px 22px; position: relative; display: flex; flex-direction: column; transition: border-color 0.15s, box-shadow 0.15s; }
        .tier:hover { border-color: #d4c9b0; box-shadow: 0 6px 24px rgba(0,0,0,0.05); }
        .tier-featured { border-color: #1a1a1a; border-width: 2px; }
        .tier-flag { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #FFC627; color: #1a1a1a; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; padding: 3px 11px; border-radius: 20px; white-space: nowrap; }
        .tier-name { font-family: 'Fraunces', serif; font-size: 21px; font-weight: 300; color: #1a1a1a; }
        .tier-limit { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .tier-price { font-family: 'Fraunces', serif; font-size: 38px; font-weight: 300; color: #1a1a1a; letter-spacing: -1.6px; margin: 16px 0 0; }
        .tier-price em { font-style: normal; font-family: 'DM Sans', sans-serif; font-size: 13px; color: #9b9b9b; letter-spacing: 0; }
        .tier-audience { font-size: 13px; color: #6b6b6b; line-height: 1.6; margin: 12px 0 20px; flex: 1; }
        .tier-cta { display: block; text-align: center; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 11px; font-size: 13.5px; font-weight: 700; color: #1a1a1a; text-decoration: none; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .tier-cta:hover { border-color: #8C1D40; color: #8C1D40; }
        .tier-cta-dark { background: #1a1a1a; border-color: #1a1a1a; color: #fff; }
        .tier-cta-dark:hover { background: #8C1D40; border-color: #8C1D40; color: #fff; }
        .tier-foot { text-align: center; font-size: 12.5px; color: #9b9b9b; line-height: 1.6; margin-bottom: 32px; }

        /* PROMISE STRIP */
        .promise-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 56px; }
        .promise-item { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 20px; text-align: center; }
        .promise-icon { font-size: 24px; margin-bottom: 8px; }
        .promise-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 5px; }
        .promise-body { font-size: 12px; color: #6b6b6b; line-height: 1.6; }

        /* FUTURE PRICING */
        .future-box { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 32px 36px; margin-bottom: 56px; display: grid; grid-template-columns: 1fr auto; gap: 32px; align-items: center; }
        .future-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #c9973a; margin-bottom: 8px; }
        .future-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 300; color: #1a1a1a; margin-bottom: 8px; line-height: 1.25; }
        .future-title em { font-style: italic; }
        .future-body { font-size: 13px; color: #6b6b6b; line-height: 1.65; }
        .future-locked { background: #faf9f6; border: 1.5px dashed #e8e4db; border-radius: 12px; padding: 20px 24px; text-align: center; min-width: 160px; }
        .future-locked-label { font-size: 11px; color: #9b9b9b; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 8px; }
        .future-locked-price { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; }
        .future-locked-sub { font-size: 11px; color: #9b9b9b; margin-top: 4px; line-height: 1.4; }

        /* FAQ */
        .faq-section { margin-bottom: 56px; }
        .section-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #c9973a; margin-bottom: 10px; }
        .section-title { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; margin-bottom: 24px; line-height: 1.2; }
        .section-title em { font-style: italic; }

        /* BOTTOM CTA */
        .bottom-cta { background: #8C1D40; border-radius: 16px; padding: 48px 40px; text-align: center; }
        .bottom-cta-title { font-family: 'Fraunces', serif; font-size: 34px; font-weight: 300; color: #fff; letter-spacing: -0.5px; margin-bottom: 12px; line-height: 1.15; }
        .bottom-cta-title em { font-style: italic; color: #FFC627; }
        .bottom-cta-sub { font-size: 15px; color: rgba(255,255,255,0.7); line-height: 1.7; max-width: 420px; margin: 0 auto 28px; }
        .bottom-cta-btns { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
        .btn-gold { background: #FFC627; color: #8C1D40; padding: 13px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none; font-family: 'DM Sans', sans-serif; }
        .btn-gold:hover { background: #e6b320; }
        .btn-outline { color: rgba(255,255,255,0.85); padding: 13px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none; border: 1px solid rgba(255,255,255,0.25); }
        .btn-outline:hover { border-color: rgba(255,255,255,0.6); color: #fff; }

        @media (max-width: 640px) {
          .hero-title { font-size: 34px; }
          .price-card { padding: 28px 22px; }
          .price-num { font-size: 56px; }
          .features-grid { grid-template-columns: 1fr; }
          .promise-strip { grid-template-columns: 1fr; }
          .tier-grid { grid-template-columns: 1fr; }
          .future-box { grid-template-columns: 1fr; }
          .future-locked { min-width: auto; }
          .bottom-cta { padding: 36px 24px; }
          .bottom-cta-title { font-size: 26px; }
          .tab-btn { padding: 10px 18px; font-size: 13px; }
        }
      `}</style>

      <div className="page">

        {/* HERO */}
        <div className="hero">
          <div className="hero-eyebrow">Simple, honest pricing</div>
          <h1 className="hero-title">Transparent pricing.<br /><em>No surprises.</em></h1>
          <p className="hero-sub">Just like our homes — what you see is what you pay. We keep things simple so you can focus on finding (or filling) the right home.</p>
        </div>

        {/* TOGGLE */}
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

        {/* ── STUDENT ── */}
        {tab === 'student' && (
          <>
            {/* MAIN CARD */}
            <div className="price-card free-student">
              <div className="price-glow" />
              <div className="price-badge">
                <span style={{ fontSize: '12px' }}>🎉</span>
                <span className="price-badge-text">Free forever · No credit card</span>
              </div>
              <div className="price-num">$0 <em>/ always</em></div>
              <p className="price-label">For every ASU student, now and forever.</p>
              <div className="price-title">Everything you need to find<br /><em>your home near ASU.</em></div>
              <p className="price-sub">Browse listings, find roommates, schedule tours, sign your lease, and pay rent — all completely free. We make money from landlords, not students. That's not changing.</p>
              <div className="features-grid">
                {STUDENT_FREE.map(f => (
                  <div className="feature-item" key={f.label}>
                    <span className="feature-icon">{f.icon}</span>
                    <span className="feature-label">{f.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '8px' }}>
                <a href="/homes" className="price-cta">Browse homes — it's free →</a>
                <a href="/roommates" className="price-cta-ghost">Find roommates</a>
              </div>
            </div>

            {/* PROMISE STRIP */}
            <div className="promise-strip">
              {[
                { icon: '🔒', title: 'No credit card ever', body: 'We will never ask for payment info from a student. Not now, not later.' },
                { icon: '♾️', title: 'Free forever — our promise', body: "We've committed to keeping HomeHive free for students permanently. It's how we grow." },
                { icon: '🚫', title: 'No ads, no data selling', body: 'We don\'t monetize students. No targeted ads, no selling your info to anyone.' },
              ].map(p => (
                <div className="promise-item" key={p.title}>
                  <div className="promise-icon">{p.icon}</div>
                  <div className="promise-title">{p.title}</div>
                  <p className="promise-body">{p.body}</p>
                </div>
              ))}
            </div>

            {/* FAQ */}
            <div className="faq-section">
              <div className="section-eyebrow">Common questions</div>
              <div className="section-title">Still have <em>questions?</em></div>
              <FAQ items={FAQS_STUDENT} />
            </div>

            {/* BOTTOM CTA */}
            <div className="bottom-cta">
              <div className="bottom-cta-title">Ready to find your<br /><em>home near ASU?</em></div>
              <p className="bottom-cta-sub">Free to browse, free to apply, free forever. Thousands of ASU students can't be wrong.</p>
              <div className="bottom-cta-btns">
                <a href="/homes" className="btn-gold">See available homes →</a>
                <a href="/roommates" className="btn-outline">Find roommates</a>
              </div>
            </div>
          </>
        )}

        {/* ── LANDLORD ── */}
        {tab === 'landlord' && (
          <>
            {/* THREE TIERS */}
            <div className="tier-grid">
              {PLAN_ORDER.map(t => {
                const plan = PLANS[t]
                return (
                  <div key={t} className={`tier${plan.highlight ? ' tier-featured' : ''}`}>
                    {plan.highlight && <div className="tier-flag">Most popular</div>}
                    <div className="tier-name">{plan.name}</div>
                    <div className="tier-limit">
                      {formatPropertyLimit(plan.propertyLimit)}{' '}
                      {plan.propertyLimit === 1 ? 'property' : 'properties'}
                    </div>
                    <div className="tier-price">{formatUsd(plan.priceCents)}<em>/month</em></div>
                    <p className="tier-audience">{plan.audience}</p>
                    <a href="/signup?role=landlord" className={`tier-cta${plan.highlight ? ' tier-cta-dark' : ''}`}>
                      Get started &rarr;
                    </a>
                  </div>
                )
              })}
            </div>

            <p className="tier-foot">
              Sign up, pay, and your portal opens immediately. Cancel any time — no contract,
              no setup fee, and no commission when you fill a room.
            </p>

            {/* WHAT'S INCLUDED — same in every plan */}
            <div className="price-card free-landlord">
              <div className="price-glow" />
              <div className="price-badge">
                <span style={{ fontSize: '12px' }}>✓</span>
                <span className="price-badge-text">Included in every plan</span>
              </div>
              <div className="price-title">The whole platform,<br /><em>at every price.</em></div>
              <p className="price-sub">Plans differ by how many properties you list — never by what you can do. Nothing here is behind an upsell, and no inquiry is ever locked.</p>
              <div className="features-grid">
                {LANDLORD_INCLUDED.map(f => (
                  <div className="feature-item" key={f.label}>
                    <span className="feature-icon">{f.icon}</span>
                    <span className="feature-label">{f.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '8px' }}>
                <a href="/signup?role=landlord" className="price-cta">Create your account &rarr;</a>
                <a href="/how-it-works" className="price-cta-ghost">How it works</a>
              </div>
            </div>

            {/* PROMISE STRIP */}
            <div className="promise-strip">
              {[
                { icon: '🚫', title: 'No per-lead charges', body: 'Every inquiry on your properties is yours to read and reply to. There is nothing to unlock.' },
                { icon: '🎯', title: 'Qualified renters', body: 'We pre-screen inquiries by budget, timeline and seriousness before they reach you.' },
                { icon: '🔓', title: 'Cancel in two clicks', body: 'Month to month from your billing page. No contract, no retention call, no exit fee.' },
              ].map(p => (
                <div className="promise-item" key={p.title}>
                  <div className="promise-icon">{p.icon}</div>
                  <div className="promise-title">{p.title}</div>
                  <p className="promise-body">{p.body}</p>
                </div>
              ))}
            </div>

            {/* FAQ */}
            <div className="faq-section">
              <div className="section-eyebrow">Common questions</div>
              <div className="section-title">Still have <em>questions?</em></div>
              <FAQ items={FAQS_LANDLORD} />
            </div>

            {/* BOTTOM CTA */}
            <div className="bottom-cta">
              <div className="bottom-cta-title">List your property<br /><em>this afternoon.</em></div>
              <p className="bottom-cta-sub">Create an account, choose a plan, and your listing can be live today. Starting at {formatUsd(PLANS.starter.priceCents)} a month.</p>
              <div className="bottom-cta-btns">
                <a href="/signup?role=landlord" className="btn-gold">Get started &rarr;</a>
                <a href="/how-it-works" className="btn-outline">How it works</a>
              </div>
            </div>
          </>
        )}

      </div>
    </>
  )
}
