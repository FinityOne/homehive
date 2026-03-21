'use client'

import { homes } from '@/lib/homes'
import { useSearchParams } from 'next/navigation'

function ScoreBar({ score }: { score: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '4px', background: '#e8e5de', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ width: `${score * 10}%`, height: '100%', background: score >= 8 ? '#d4a843' : '#6b9e6b', borderRadius: '10px' }} />
      </div>
      <span style={{ fontSize: '12px', fontWeight: 600, color: score >= 8 ? '#d4a843' : '#6b9e6b', minWidth: '28px' }}>{score}/10</span>
    </div>
  )
}

const PAIN_POINTS = [
  { icon: '😤', headline: 'Zillow listings are already gone', body: 'You find something great, fill out a form, and hear nothing. We respond within hours — not days.' },
  { icon: '💸', headline: 'Hidden fees at signing', body: 'Broker fees, admin fees, "processing" fees. With HomeHive, the price you see is exactly what you pay.' },
  { icon: '📱', headline: 'Facebook group chaos', body: 'Cold DMs, ghosts, and zero accountability. Every HomeHive listing is managed directly by the owner.' },
  { icon: '🤝', headline: 'No one helps with roommates', body: "You're on your own to find compatible people. We match you before you sign — by lifestyle, not just availability." },
]

export default function HomePage() {
  const searchParams = useSearchParams()
  const guestName = searchParams.get('name') || ''
  const customMsg = searchParams.get('msg') || ''
  const fromName = searchParams.get('from') || 'Mike'
  const isPersonalized = !!guestName

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; }

        .page { max-width: 1100px; margin: 0 auto; padding: 0 24px 80px; }

        /* PERSONALIZED BANNER */
        .personal-banner {
          background: linear-gradient(135deg, #1a1a1a 0%, #2d2410 100%);
          border-radius: 14px; padding: 28px 32px; margin-bottom: 0;
          border: 1px solid #d4a843; position: relative; overflow: hidden;
        }
        .personal-glow {
          position: absolute; top: -60px; right: -60px; width: 220px; height: 220px;
          border-radius: 50%; background: radial-gradient(circle, rgba(212,168,67,0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .personal-tag { display: inline-flex; align-items: center; gap: 6px; background: rgba(212,168,67,0.15); border: 1px solid rgba(212,168,67,0.4); border-radius: 20px; padding: 4px 12px; margin-bottom: 14px; }
        .personal-tag-text { font-size: 10px; color: #d4a843; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
        .personal-title { font-family: 'DM Serif Display', serif; font-size: 26px; color: #fff; line-height: 1.2; margin-bottom: 10px; }
        .personal-title em { color: #d4a843; font-style: normal; }
        .personal-msg { font-size: 14px; color: #c5c1b8; line-height: 1.65; margin-bottom: 20px; max-width: 560px; }
        .personal-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-top: 18px; border-top: 1px solid rgba(212,168,67,0.2); }
        .personal-sender { display: flex; align-items: center; gap: 10px; }
        .personal-avatar { width: 34px; height: 34px; border-radius: 50%; background: #d4a843; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; color: #1a1a1a; flex-shrink: 0; }
        .personal-sender-name { font-size: 13px; color: #fff; font-weight: 500; }
        .personal-sender-sub { font-size: 11px; color: #6b6b6b; }
        .personal-live { display: flex; align-items: center; gap: 6px; background: rgba(220,252,231,0.1); border: 1px solid rgba(34,197,94,0.3); border-radius: 20px; padding: 6px 14px; }
        .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
        .live-text { font-size: 12px; color: #86efac; font-weight: 500; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }

        /* HERO */
        .hero { padding: 64px 0 48px; text-align: center; }
        .hero-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #d4a843; margin-bottom: 18px; display: flex; align-items: center; justify-content: center; gap: 10px; }
        .hero-eyebrow::before, .hero-eyebrow::after { content: ''; width: 40px; height: 1px; background: #d4a843; opacity: 0.5; }
        .hero-title { font-family: 'DM Serif Display', serif; font-size: 56px; color: #1a1a1a; line-height: 1.08; margin-bottom: 20px; letter-spacing: -1px; }
        .hero-title em { font-style: italic; color: #d4a843; }
        .hero-sub { font-size: 17px; color: #6b6b6b; line-height: 1.7; max-width: 520px; margin: 0 auto 36px; }
        .hero-cta-row { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .btn-primary { background: #1a1a1a; color: #fff; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-block; transition: background 0.2s; }
        .btn-primary:hover { background: #333; }
        .hero-trust { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }
        .hero-trust-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9b9b9b; }
        .trust-dot { width: 5px; height: 5px; border-radius: 50%; background: #d4a843; }

        /* STATS STRIP */
        .stats-strip { display: flex; justify-content: center; background: #1a1a1a; border-radius: 12px; overflow: hidden; margin-bottom: 64px; }
        .stats-strip-item { flex: 1; padding: 20px 16px; text-align: center; border-right: 1px solid #2a2a2a; }
        .stats-strip-item:last-child { border-right: none; }
        .stats-num { font-family: 'DM Serif Display', serif; font-size: 26px; color: #d4a843; }
        .stats-lbl { font-size: 11px; color: #6b6b6b; margin-top: 3px; letter-spacing: 0.3px; }

        /* PAIN POINTS */
        .pain-section { margin-bottom: 64px; }
        .section-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 10px; text-align: center; }
        .section-title { font-family: 'DM Serif Display', serif; font-size: 36px; color: #1a1a1a; text-align: center; margin-bottom: 36px; line-height: 1.2; }
        .pain-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
        .pain-card { background: #fff; border: 1px solid #e8e5de; border-radius: 12px; padding: 24px; display: flex; gap: 16px; align-items: flex-start; }
        .pain-icon { font-size: 24px; flex-shrink: 0; margin-top: 2px; }
        .pain-headline { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
        .pain-body { font-size: 13px; color: #6b6b6b; line-height: 1.65; }

        /* HOMES */
        .homes-section { margin-bottom: 64px; }
        .homes-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; }
        .homes-header-left {}
        .homes-header-right { font-size: 13px; color: #9b9b9b; }
        .homes-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 24px; }

        /* HOME CARD */
        .home-card { background: #fff; border: 1px solid #e8e5de; border-radius: 16px; overflow: hidden; text-decoration: none; color: inherit; display: block; transition: transform 0.2s, box-shadow 0.2s; }
        .home-card:hover { transform: translateY(-4px); box-shadow: 0 16px 48px rgba(0,0,0,0.1); }
        .home-card-img { height: 210px; overflow: hidden; position: relative; }
        .home-card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }
        .home-card:hover .home-card-img img { transform: scale(1.05); }
        .avail-badge { position: absolute; top: 12px; left: 12px; font-size: 11px; font-weight: 600; padding: 4px 11px; border-radius: 20px; }
        .avail-badge.green { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .avail-badge.amber { background: #fef9c3; color: #854d0e; border: 1px solid #fef08a; }
        .price-badge { position: absolute; bottom: 12px; right: 12px; background: rgba(26,26,26,0.85); color: #fff; font-family: 'DM Serif Display', serif; font-size: 18px; padding: 6px 14px; border-radius: 8px; backdrop-filter: blur(4px); }
        .price-badge span { font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 400; opacity: 0.75; }
        .home-card-body { padding: 20px 22px 22px; }
        .home-card-name { font-family: 'DM Serif Display', serif; font-size: 21px; color: #1a1a1a; margin-bottom: 4px; }
        .home-card-addr { font-size: 12px; color: #9b9b9b; margin-bottom: 14px; display: flex; align-items: center; gap: 4px; }
        .home-stats-row { display: flex; gap: 6px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
        .home-stat { font-size: 12px; color: #6b6b6b; }
        .stat-sep { width: 3px; height: 3px; border-radius: 50%; background: #d1d5db; }
        .home-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
        .home-tag { font-size: 11px; background: #f9f8f5; border: 1px solid #e8e5de; color: #6b6b6b; padding: 3px 9px; border-radius: 20px; }
        .home-card-footer { padding-top: 14px; border-top: 1px solid #f0ede6; }
        .home-score-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .home-score-label { font-size: 11px; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; }
        .home-score-reasons { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
        .home-score-reason { font-size: 12px; color: #6b6b6b; display: flex; align-items: center; gap: 6px; }
        .reason-dot { width: 5px; height: 5px; border-radius: 50%; background: #d4a843; flex-shrink: 0; }
        .home-cta { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; padding-top: 14px; border-top: 1px solid #f0ede6; }
        .home-cta-text { font-size: 13px; color: #9b9b9b; }
        .home-cta-btn { background: #1a1a1a; color: #fff; font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 7px; text-decoration: none; transition: background 0.2s; font-family: 'DM Sans', sans-serif; }
        .home-cta-btn:hover { background: #333; }

        /* URGENCY STRIP */
        .urgency-strip { background: #fff; border: 1px solid #e8e5de; border-radius: 12px; padding: 20px 28px; margin-bottom: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .urgency-left { display: flex; align-items: center; gap: 14px; }
        .urgency-icon { width: 42px; height: 42px; border-radius: 50%; background: #fef9c3; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
        .urgency-title { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
        .urgency-sub { font-size: 13px; color: #6b6b6b; }
        .urgency-btn { background: #d4a843; color: #1a1a1a; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 7px; text-decoration: none; white-space: nowrap; transition: background 0.2s; }
        .urgency-btn:hover { background: #c49a35; }

        /* PROMISE SECTION */
        .promise-section { background: #1a1a1a; border-radius: 16px; padding: 48px; margin-bottom: 64px; text-align: center; }
        .promise-eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 12px; }
        .promise-title { font-family: 'DM Serif Display', serif; font-size: 36px; color: #fff; margin-bottom: 14px; line-height: 1.2; }
        .promise-sub { font-size: 15px; color: #9b9b9b; line-height: 1.7; max-width: 500px; margin: 0 auto 36px; }
        .promise-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 700px; margin: 0 auto; }
        .promise-item { background: rgba(255,255,255,0.05); border: 1px solid #2a2a2a; border-radius: 10px; padding: 20px; }
        .promise-item-icon { font-size: 22px; margin-bottom: 10px; }
        .promise-item-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 6px; }
        .promise-item-body { font-size: 12px; color: #6b6b6b; line-height: 1.6; }

        @media (max-width: 768px) {
          .hero-title { font-size: 38px; }
          .pain-grid { grid-template-columns: 1fr; }
          .promise-grid { grid-template-columns: 1fr; }
          .stats-strip { flex-wrap: wrap; }
          .stats-strip-item { border-right: none; border-bottom: 1px solid #2a2a2a; min-width: 50%; }
          .urgency-strip { flex-direction: column; text-align: center; }
        }
      `}</style>

      <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#f5f4f0', minHeight: '100vh' }}>
        <div className="page">

          {/* PERSONALIZED BANNER */}
          {isPersonalized && (
            <div style={{ paddingTop: '32px' }}>
              <div className="personal-banner">
                <div className="personal-glow" />
                <div className="personal-tag">
                  <span className="personal-tag-text">✦ Personalized for {guestName}</span>
                </div>
                <div className="personal-title">
                  Hey {guestName}, we found homes<br /><em>picked just for you.</em>
                </div>
                <p className="personal-msg">
                  {customMsg || `We handpicked these listings based on what ASU students like you are actually looking for — transparent pricing, flexible move-in, and no broker fees. Ever.`}
                </p>
                <div className="personal-footer">
                  <div className="personal-sender">
                    <div className="personal-avatar">{fromName.charAt(0).toUpperCase()}</div>
                    <div>
                      <div className="personal-sender-name">{fromName} from HomeHive</div>
                      <div className="personal-sender-sub">Sent this listing personally for you</div>
                    </div>
                  </div>
                  <div className="personal-live">
                    <span className="live-dot" />
                    <span className="live-text">Rooms available now</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* HERO */}
          <div className="hero">
            <div className="hero-eyebrow">ASU Student Housing · Tempe, AZ</div>
            <h1 className="hero-title">
              Your home near ASU<br />shouldn't be this <em>hard</em>
              <br />to find.
            </h1>
            <p className="hero-sub">
              No broker fees. No disappearing listings. No Facebook group chaos.
              Just real homes, transparent pricing, and a landlord who actually responds.
            </p>
            <div className="hero-cta-row">
              <a href="#homes" className="btn-primary">See available homes →</a>
            </div>
            <div className="hero-trust">
              {['No broker fees, ever', 'Response within hours', 'Transparent pricing', 'Roommate matching included'].map(t => (
                <div className="hero-trust-item" key={t}>
                  <span className="trust-dot" />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* STATS STRIP */}
          <div className="stats-strip">
            {[['2', 'Homes available'], ['$680', 'Starting per room/mo'], ['$0', 'Broker fees'], ['< 24hrs', 'Avg. response time'], ['100%', 'Utilities included']].map(([n, l]) => (
              <div className="stats-strip-item" key={l}>
                <div className="stats-num">{n}</div>
                <div className="stats-lbl">{l}</div>
              </div>
            ))}
          </div>

          {/* PAIN POINTS */}
          <div className="pain-section">
            <div className="section-eyebrow">Sound familiar?</div>
            <div className="section-title">Finding housing near ASU<br />shouldn't feel like this.</div>
            <div className="pain-grid">
              {PAIN_POINTS.map(p => (
                <div className="pain-card" key={p.headline}>
                  <div className="pain-icon">{p.icon}</div>
                  <div>
                    <div className="pain-headline">{p.headline}</div>
                    <p className="pain-body">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* HOMES GRID */}
          <div className="homes-section" id="homes">
            <div className="homes-header">
              <div>
                <div className="section-eyebrow" style={{ textAlign: 'left' }}>Available now</div>
                <div className="section-title" style={{ textAlign: 'left', marginBottom: 0, fontSize: '32px' }}>Homes near ASU</div>
              </div>
              <div className="homes-header-right">{homes.filter(h => h.available > 0).length} homes · updated today</div>
            </div>
            <div className="homes-grid">
              {homes.map(home => (
                <a href={`/homes/${home.slug}`} className="home-card" key={home.slug}>
                  <div className="home-card-img">
                    <img src={home.heroImage} alt={home.name} />
                    <div className={`avail-badge ${home.available === 1 ? 'amber' : 'green'}`}>
                      {home.available === 1 ? '⚡ Last room' : `${home.available} rooms open`}
                    </div>
                    <div className="price-badge">${home.price}<span>/mo</span></div>
                  </div>
                  <div className="home-card-body">
                    <div className="home-card-name">{home.name}</div>
                    <div className="home-card-addr">
                      <span>📍</span>{home.address}
                    </div>
                    <div className="home-stats-row">
                      <span className="home-stat">{home.beds} beds</span>
                      <span className="stat-sep" />
                      <span className="home-stat">{home.baths} baths</span>
                      <span className="stat-sep" />
                      <span className="home-stat">{home.sqft} sq ft</span>
                      <span className="stat-sep" />
                      <span className="home-stat">{home.asuDistance} to ASU</span>
                    </div>
                    <div className="home-tags">
                      {home.tags.slice(0, 4).map(t => <span className="home-tag" key={t}>{t}</span>)}
                    </div>
                    <div className="home-card-footer">
                      <div className="home-score-row">
                        <span className="home-score-label">ASU fit score</span>
                        <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 500 }}>All utilities included</span>
                      </div>
                      <ScoreBar score={home.asuScore} />
                      <div className="home-score-reasons">
                        {home.asuScoreReasons.slice(0, 2).map(r => (
                          <div className="home-score-reason" key={r}>
                            <span className="reason-dot" />
                            {r}
                          </div>
                        ))}
                      </div>
                      <div className="home-cta">
                        <span className="home-cta-text">No commitment to view details</span>
                        <span className="home-cta-btn">View home →</span>
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* URGENCY STRIP */}
          <div className="urgency-strip">
            <div className="urgency-left">
              <div className="urgency-icon">⏳</div>
              <div>
                <div className="urgency-title">Rooms go fast before semester starts</div>
                <div className="urgency-sub">Most of our rooms are claimed 6–8 weeks before move-in. Submitting interest takes 2 minutes and holds your spot in line.</div>
              </div>
            </div>
            <a href="#homes" className="urgency-btn">Check availability now</a>
          </div>

          {/* PROMISE */}
          <div className="promise-section">
            <div className="promise-eyebrow">The HomeHive promise</div>
            <div className="promise-title">A different kind of landlord experience</div>
            <p className="promise-sub">We built HomeHive because finding student housing near ASU was broken. Here's what we do differently.</p>
            <div className="promise-grid">
              {[
                { icon: '💰', title: 'Price you see = price you pay', body: 'No broker fees, no move-in charges, no admin fees added at signing. Ever.' },
                { icon: '⚡', title: 'We actually respond', body: 'Submit interest and hear back within hours. Not days. Not a week. Hours.' },
                { icon: '🤝', title: 'Roommate matching', body: "Don't have roommates? We'll match you with compatible housemates by lifestyle — not just whoever applied first." },
              ].map(p => (
                <div className="promise-item" key={p.title}>
                  <div className="promise-item-icon">{p.icon}</div>
                  <div className="promise-item-title">{p.title}</div>
                  <p className="promise-item-body">{p.body}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
