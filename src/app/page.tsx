'use client'

import { homes } from '@/lib/homes'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function ScoreBar({ score }: { score: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '3px', background: '#e8e4db', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ width: `${score * 10}%`, height: '100%', background: score >= 8 ? '#c9973a' : '#6b9e6b', borderRadius: '10px' }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color: score >= 8 ? '#c9973a' : '#6b9e6b', minWidth: '32px' }}>{score}/10</span>
    </div>
  )
}

function HomePageInner() {
  const searchParams = useSearchParams()
  const guestName = searchParams.get('name') || ''
  const isPersonalized = !!guestName

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }

        .personal-bar { background: #1a1a1a; padding: 10px 24px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: #c5c1b8; }
        .personal-bar strong { color: #d4a843; font-weight: 500; }
        .pbar-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; flex-shrink: 0; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

        .hero { padding: 72px 0 64px; display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; border-bottom: 1px solid #e8e4db; margin-bottom: 72px; }
        .hero-tag { display: inline-flex; align-items: center; gap: 7px; background: #f0e6cc; color: #92620a; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 22px; }
        .hero-tag-dot { width: 5px; height: 5px; border-radius: 50%; background: #c9973a; }
        .hero-title { font-family: 'Fraunces', serif; font-size: 54px; font-weight: 300; line-height: 1.06; color: #1a1a1a; letter-spacing: -1.5px; margin-bottom: 20px; }
        .hero-title em { font-style: italic; color: #c9973a; }
        .hero-body { font-size: 16px; color: #6b6b6b; line-height: 1.75; margin-bottom: 32px; max-width: 420px; }
        .hero-actions { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
        .btn-dark { background: #1a1a1a; color: #fff; padding: 13px 26px; border-radius: 7px; font-size: 14px; font-weight: 500; text-decoration: none; font-family: 'DM Sans', sans-serif; }
        .btn-dark:hover { background: #333; }
        .btn-ghost { color: #1a1a1a; font-size: 14px; font-weight: 500; text-decoration: none; display: flex; align-items: center; gap: 4px; }
        .btn-ghost:hover { color: #c9973a; }
        .hero-proof { display: flex; align-items: center; gap: 12px; }
        .proof-avatars { display: flex; }
        .proof-av { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #faf9f6; background: #f0e6cc; color: #92620a; font-size: 9px; font-weight: 600; display: flex; align-items: center; justify-content: center; margin-left: -6px; }
        .proof-av:first-child { margin-left: 0; }
        .proof-text { font-size: 12px; color: #6b6b6b; }
        .proof-text strong { color: #1a1a1a; }

        .answer-list { display: flex; flex-direction: column; gap: 8px; }
        .answer-row { display: flex; align-items: flex-start; gap: 12px; background: #fff; border: 1px solid #e8e4db; border-radius: 10px; padding: 14px 16px; transition: border-color 0.2s; }
        .answer-row:hover { border-color: #c9973a; }
        .answer-icon { font-size: 18px; flex-shrink: 0; }
        .answer-q { font-size: 12px; font-weight: 600; color: #1a1a1a; margin-bottom: 3px; }
        .answer-a { font-size: 12px; color: #6b6b6b; line-height: 1.55; }
        .answer-a strong { color: #16a34a; font-weight: 500; }

        .homes-section { margin-bottom: 88px; }
        .homes-hdr { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 28px; }
        .homes-hdr-title { font-family: 'Fraunces', serif; font-size: 32px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; }
        .homes-hdr-meta { font-size: 13px; color: #9b9b9b; }
        .homes-hdr-meta span { color: #16a34a; font-weight: 500; }
        .homes-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }

        .home-card { background: #fff; border: 1px solid #e8e4db; border-radius: 16px; overflow: hidden; text-decoration: none; color: inherit; display: block; transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s; }
        .home-card:hover { transform: translateY(-5px); box-shadow: 0 20px 60px rgba(0,0,0,0.09); border-color: #d4c9b0; }
        .card-img { height: 220px; overflow: hidden; position: relative; }
        .card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }
        .home-card:hover .card-img img { transform: scale(1.06); }
        .card-avail { position: absolute; top: 12px; left: 12px; font-size: 11px; font-weight: 600; padding: 4px 11px; border-radius: 20px; backdrop-filter: blur(8px); }
        .card-avail.green { background: rgba(220,252,231,0.92); color: #166534; border: 1px solid rgba(187,247,208,0.8); }
        .card-avail.amber { background: rgba(254,249,195,0.92); color: #854d0e; border: 1px solid rgba(253,224,71,0.5); }
        .card-price { position: absolute; bottom: 12px; right: 12px; background: rgba(26,26,26,0.88); color: #fff; font-family: 'Fraunces', serif; font-size: 20px; font-weight: 300; padding: 6px 14px; border-radius: 8px; backdrop-filter: blur(6px); letter-spacing: -0.3px; }
        .card-price span { font-family: 'DM Sans', sans-serif; font-size: 11px; opacity: 0.7; font-weight: 400; }
        .card-body { padding: 18px 20px 20px; }
        .card-name { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 300; color: #1a1a1a; margin-bottom: 4px; letter-spacing: -0.3px; }
        .card-addr { font-size: 12px; color: #9b9b9b; margin-bottom: 12px; }
        .card-stats { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .card-stat { font-size: 12px; color: #6b6b6b; }
        .card-sep { width: 3px; height: 3px; border-radius: 50%; background: #e8e4db; }
        .card-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 16px; }
        .card-tag { font-size: 11px; background: #faf9f6; border: 1px solid #e8e4db; color: #6b6b6b; padding: 3px 9px; border-radius: 20px; }
        .card-tag.gold { background: #f0e6cc; border-color: #e8d5a8; color: #92620a; }
        .card-footer { border-top: 1px solid #f0ede6; padding-top: 14px; }
        .card-score-lbl { font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 6px; }
        .card-reasons { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
        .card-reason { font-size: 11px; color: #6b6b6b; display: flex; align-items: center; gap: 5px; }
        .reason-chk { color: #c9973a; font-size: 10px; }
        .card-cta { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding-top: 12px; border-top: 1px solid #f0ede6; }
        .card-cta-hint { font-size: 11px; color: #9b9b9b; }
        .card-cta-btn { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .home-card:hover .card-cta-btn { color: #c9973a; }

        .section-hdr { text-align: center; margin-bottom: 40px; }
        .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #c9973a; margin-bottom: 10px; }
        .section-title { font-family: 'Fraunces', serif; font-size: 36px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.2; }
        .section-title em { font-style: italic; }

        .trust-section { margin-bottom: 88px; }
        .trust-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .trust-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 24px; }
        .trust-num { font-family: 'Fraunces', serif; font-size: 40px; font-weight: 300; color: #c9973a; letter-spacing: -1px; margin-bottom: 6px; }
        .trust-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
        .trust-body { font-size: 13px; color: #6b6b6b; line-height: 1.65; }

        .process-section { margin-bottom: 88px; }
        .process-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; position: relative; }
        .process-steps::before { content: ''; position: absolute; top: 20px; left: 12%; right: 12%; height: 1px; background: #e8e4db; z-index: 0; }
        .process-step { text-align: center; padding: 0 12px; position: relative; z-index: 1; }
        .process-num { width: 40px; height: 40px; border-radius: 50%; background: #1a1a1a; color: #c9973a; font-family: 'Fraunces', serif; font-size: 18px; font-weight: 300; display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
        .process-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
        .process-body { font-size: 12px; color: #6b6b6b; line-height: 1.6; }

        .faq-section { margin-bottom: 88px; }
        .faq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .faq-item { background: #fff; border: 1px solid #e8e4db; border-radius: 10px; padding: 20px 22px; }
        .faq-q { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 8px; }
        .faq-icon { color: #c9973a; flex-shrink: 0; }
        .faq-a { font-size: 13px; color: #6b6b6b; line-height: 1.65; padding-left: 24px; }

        .bottom-cta { background: #1a1a1a; border-radius: 16px; padding: 56px 48px; margin-bottom: 80px; text-align: center; position: relative; overflow: hidden; }
        .bottom-cta::before { content: ''; position: absolute; top: -80px; right: -80px; width: 300px; height: 300px; border-radius: 50%; background: radial-gradient(circle, rgba(201,151,58,0.12) 0%, transparent 70%); pointer-events: none; }
        .bottom-cta-title { font-family: 'Fraunces', serif; font-size: 40px; font-weight: 300; color: #fff; letter-spacing: -0.5px; margin-bottom: 12px; line-height: 1.15; }
        .bottom-cta-title em { font-style: italic; color: #d4a843; }
        .bottom-cta-sub { font-size: 15px; color: #9b9b9b; line-height: 1.7; max-width: 440px; margin: 0 auto 32px; }
        .btn-gold { background: #d4a843; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-block; font-family: 'DM Sans', sans-serif; }
        .btn-gold:hover { background: #c49a35; }
        .cta-trust-row { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 20px; flex-wrap: wrap; }
        .cta-trust-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #6b6b6b; }
        .cta-trust-dot { width: 4px; height: 4px; border-radius: 50%; background: #d4a843; }

        @media (max-width: 768px) {
          .hero { grid-template-columns: 1fr; gap: 40px; padding: 48px 0 40px; }
          .hero-title { font-size: 38px; }
          .trust-grid { grid-template-columns: 1fr; }
          .process-steps { grid-template-columns: 1fr 1fr; gap: 28px; }
          .process-steps::before { display: none; }
          .faq-grid { grid-template-columns: 1fr; }
          .bottom-cta { padding: 36px 24px; }
          .bottom-cta-title { font-size: 30px; }
        }
      `}</style>

      {isPersonalized && (
        <div className="personal-bar">
          <span className="pbar-dot" />
          <span>Hey <strong>{guestName}</strong> — we picked these homes for you near ASU. Spots go fast.</span>
        </div>
      )}

      <div className="wrap" style={{ paddingTop: '48px' }}>

        {/* HERO */}
        <div className="hero">
          <div>
            <div className="hero-tag"><span className="hero-tag-dot" />Tempe, AZ · Near ASU</div>
            <h1 className="hero-title">Real homes.<br />Real prices.<br /><em>No games.</em></h1>
            <p className="hero-body">
              Done scrolling Zillow listings that vanish before you can apply? HomeHive is run directly by the owner — transparent pricing, zero broker fees, and someone who actually responds.
            </p>
            <div className="hero-actions">
              <a href="#homes" className="btn-dark">See available homes →</a>
              <a href="/roommates" className="btn-ghost">Need roommates? ↗</a>
            </div>
            <div className="hero-proof">
              <div className="proof-avatars">
                {['SO', 'MT', 'JL', 'KP'].map(i => <div className="proof-av" key={i}>{i}</div>)}
              </div>
              <p className="proof-text"><strong>40+ ASU students</strong> placed this year</p>
            </div>
          </div>

          <div className="answer-list">
            {[
              { icon: '🏠', q: 'Is there a home for me near ASU?', a: <><strong>Yes.</strong> Both homes are under 1 mile from campus with rooms available now.</> },
              { icon: '👥', q: 'Can I bring my friends?', a: <><strong>Absolutely.</strong> 3 and 4-bedroom homes. Groups welcome — we coordinate move-in together.</> },
              { icon: '💰', q: 'Is this actually the best deal?', a: <><strong>Starting at $680/mo</strong> — all utilities included. No broker fees. No move-in charges. Ever.</> },
              { icon: '🔒', q: "Will I get scammed?", a: <>You talk directly to the owner. <strong>What you see is what you pay.</strong> Zero hidden fees at signing.</> },
              { icon: '📋', q: 'What happens after I apply?', a: <>Submit → <strong>hear back within hours</strong> → tour → move in. No cold calls, no runaround.</> },
            ].map(({ icon, q, a }) => (
              <div className="answer-row" key={q}>
                <span className="answer-icon">{icon}</span>
                <div>
                  <div className="answer-q">{q}</div>
                  <div className="answer-a">{a}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* HOMES */}
        <div className="homes-section" id="homes">
          <div className="homes-hdr">
            <div className="homes-hdr-title">Available homes</div>
            <div className="homes-hdr-meta">
              <span>{homes.filter(h => h.available > 0).length} homes available</span> · updated today
            </div>
          </div>
          <div className="homes-grid">
            {homes.map(home => (
              <a href={`/homes/${home.slug}`} className="home-card" key={home.slug}>
                <div className="card-img">
                  <img src={home.heroImage} alt={home.name} />
                  <div className={`card-avail ${home.available === 1 ? 'amber' : 'green'}`}>
                    {home.available === 1 ? '⚡ Last room' : `${home.available} rooms open`}
                  </div>
                  <div className="card-price">${home.price}<span>/mo</span></div>
                </div>
                <div className="card-body">
                  <div className="card-name">{home.name}</div>
                  <div className="card-addr">📍 {home.address}</div>
                  <div className="card-stats">
                    <span className="card-stat">{home.beds} bed</span>
                    <span className="card-sep" />
                    <span className="card-stat">{home.baths} bath</span>
                    <span className="card-sep" />
                    <span className="card-stat">{home.sqft} sqft</span>
                    <span className="card-sep" />
                    <span className="card-stat">{home.asuDistance} to ASU</span>
                  </div>
                  <div className="card-tags">
                    <span className="card-tag gold">All utilities included</span>
                    <span className="card-tag gold">$0 broker fee</span>
                    {home.tags.slice(0, 2).map(t => <span className="card-tag" key={t}>{t}</span>)}
                  </div>
                  <div className="card-footer">
                    <div className="card-score-lbl">ASU fit score</div>
                    <ScoreBar score={home.asuScore} />
                    <div className="card-reasons">
                      {home.asuScoreReasons.slice(0, 2).map(r => (
                        <div className="card-reason" key={r}><span className="reason-chk">✓</span>{r}</div>
                      ))}
                    </div>
                    <div className="card-cta">
                      <span className="card-cta-hint">No commitment to view</span>
                      <span className="card-cta-btn">See this home →</span>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* TRUST */}
        <div className="trust-section">
          <div className="section-hdr">
            <div className="eyebrow">Why HomeHive</div>
            <div className="section-title">Built because finding housing<br />near ASU was <em>broken.</em></div>
          </div>
          <div className="trust-grid">
            {[
              { num: '$0', title: 'Broker fees. Always.', body: 'Every other platform charges you to rent. We never do. The price you see is exactly what you sign for — nothing added at the table.' },
              { num: '<2hr', title: 'Response time', body: "Submit interest and a real person follows up the same day. No bots, no automated sequences. Someone who actually knows the homes." },
              { num: '100%', title: 'Utilities included', body: 'WiFi, electric, water, gas — all bundled into your rent. No surprise bills or awkward roommate Venmo requests at the end of the month.' },
            ].map(t => (
              <div className="trust-card" key={t.title}>
                <div className="trust-num">{t.num}</div>
                <div className="trust-title">{t.title}</div>
                <p className="trust-body">{t.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* PROCESS */}
        <div className="process-section">
          <div className="section-hdr">
            <div className="eyebrow">The process</div>
            <div className="section-title">From browsing to moved in.<br /><em>No surprises at any step.</em></div>
          </div>
          <div className="process-steps">
            {[
              { n: '1', title: 'Browse homes', body: 'Real photos, honest pricing, ASU fit score. No bait and switch.' },
              { n: '2', title: 'Submit interest', body: '2 minutes. No commitment, no phone call needed. Just the basics.' },
              { n: '3', title: 'We reach out', body: 'A real person follows up within hours. Tour on your schedule.' },
              { n: '4', title: 'Move in', body: 'Sign, pay exactly what was quoted, get your keys. Nothing hidden.' },
            ].map(s => (
              <div className="process-step" key={s.n}>
                <div className="process-num">{s.n}</div>
                <div className="process-title">{s.title}</div>
                <p className="process-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="faq-section">
          <div className="section-hdr">
            <div className="eyebrow">Common questions</div>
            <div className="section-title">Things students always ask.<br /><em>Answered honestly.</em></div>
          </div>
          <div className="faq-grid">
            {[
              { icon: '💸', q: 'Are there really no hidden fees?', a: "Yes, really. The rent listed is your rent. No admin fee, no broker fee, no processing charge at signing. Security deposit is the only extra — fully refunded at move-out." },
              { icon: '👫', q: 'Can I move in with my friend group?', a: "Yes. Our homes are 3 and 4 bedrooms. Submit interest together, mention your group size, and we'll hold rooms for your crew while you sort the details." },
              { icon: '📅', q: 'Can I move in at the start of a semester?', a: "We coordinate around the ASU academic calendar. Fall and spring move-ins are our most common, with flexibility a few weeks either direction." },
              { icon: '🔍', q: "I don't have roommates. Can you help?", a: "That's one of the things we do. Tell us your lifestyle on the interest form and we'll match you with compatible people already in the home or also looking." },
              { icon: '🏠', q: 'Can I see the home before committing?', a: "Of course. After you submit interest we'll set up an in-person or virtual tour — no commitment required. We want you to feel good before signing anything." },
              { icon: '⚡', q: "What's actually included in 'utilities'?", a: "Everything: electricity, water, gas, and high-speed WiFi. You pay rent and that's your total monthly cost. No splitting bills or surprise charges." },
            ].map(({ icon, q, a }) => (
              <div className="faq-item" key={q}>
                <div className="faq-q"><span className="faq-icon">{icon}</span>{q}</div>
                <p className="faq-a">{a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* BOTTOM CTA */}
        <div className="bottom-cta">
          <div className="bottom-cta-title">Stop wasting time on<br /><em>dead-end listings.</em></div>
          <p className="bottom-cta-sub">Two great homes. Real pricing. A landlord who responds. Browse what's available and apply in under 2 minutes.</p>
          <a href="#homes" className="btn-gold">See available homes →</a>
          <div className="cta-trust-row">
            {['No broker fees', 'Respond within 2hrs', 'No commitment to apply', 'Utilities included'].map(t => (
              <div className="cta-trust-item" key={t}>
                <span className="cta-trust-dot" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageInner />
    </Suspense>
  )
}