'use client'

import { Suspense, useState, useEffect } from 'react'
import { homes } from '@/lib/homes'
import { useSearchParams } from 'next/navigation'
import Loader from '@/components/Loader'

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

  const [showLoader, setShowLoader] = useState(false)

  useEffect(() => {
    // Only show loader once per session
    const seen = sessionStorage.getItem('hh_loader_seen')
    if (!seen) {
      setShowLoader(true)
    }
  }, [])

  const handleLoaderComplete = () => {
    sessionStorage.setItem('hh_loader_seen', '1')
    setShowLoader(false)
  }

  return (
    <>
      {showLoader && <Loader onComplete={handleLoaderComplete} />}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }

        /* ASU BAR */
        .asu-bar { background: #8C1D40; border-bottom: 3px solid #FFC627; padding: 0 24px; }
        .asu-bar-inner { max-width: 1080px; margin: 0 auto; height: 38px; display: flex; align-items: center; justify-content: space-between; }
        .asu-bar-left { display: flex; align-items: center; gap: 8px; }
        .asu-pitchfork { color: #FFC627; font-size: 14px; }
        .asu-bar-label { font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #fff; }
        .asu-bar-sep { width: 1px; height: 14px; background: rgba(255,255,255,0.25); margin: 0 8px; }
        .asu-bar-sub { font-size: 11px; color: rgba(255,255,255,0.7); }
        .asu-bar-right { display: flex; align-items: center; gap: 16px; }
        .asu-bar-link { font-size: 11px; color: rgba(255,255,255,0.75); text-decoration: none; font-weight: 500; }
        .asu-bar-link:hover { color: #FFC627; }
        .asu-bar-badge { background: #FFC627; color: #8C1D40; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; letter-spacing: 0.4px; }

        /* PERSONAL BAR */
        .personal-bar { background: #1a1a1a; padding: 9px 24px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #c5c1b8; }
        .personal-bar strong { color: #FFC627; font-weight: 500; }
        .pbar-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; flex-shrink: 0; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.3} }

        /* HERO — dead simple */
        .hero { padding: 64px 0 56px; text-align: center; border-bottom: 1px solid #e8e4db; margin-bottom: 56px; }
        .hero-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: #f0e6cc; color: #92620a; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 24px; }
        .hero-eyebrow-dot { width: 5px; height: 5px; border-radius: 50%; background: #c9973a; }
        .hero-title { font-family: 'Fraunces', serif; font-size: 58px; font-weight: 300; line-height: 1.06; color: #1a1a1a; letter-spacing: -2px; margin-bottom: 18px; }
        .hero-title em { font-style: italic; color: #8C1D40; }
        .hero-sub { font-size: 17px; color: #6b6b6b; line-height: 1.7; max-width: 480px; margin: 0 auto 36px; }
        .hero-sub strong { color: #1a1a1a; font-weight: 500; }
        .hero-cta { display: inline-block; background: #8C1D40; color: #fff; padding: 15px 36px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; font-family: 'DM Sans', sans-serif; letter-spacing: 0.1px; transition: background 0.2s; }
        .hero-cta:hover { background: #7a1835; }
        .hero-trust { display: flex; align-items: center; justify-content: center; gap: 24px; margin-top: 24px; flex-wrap: wrap; }
        .hero-trust-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9b9b9b; }
        .trust-dot { width: 4px; height: 4px; border-radius: 50%; background: #FFC627; }

        /* HOMES */
        .homes-hdr { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; }
        .homes-hdr-title { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; }
        .homes-hdr-meta { font-size: 13px; color: #9b9b9b; }
        .homes-hdr-meta span { color: #16a34a; font-weight: 500; }
        .homes-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 80px; }

        /* HOME CARD */
        .home-card { background: #fff; border: 1px solid #e8e4db; border-radius: 16px; overflow: hidden; text-decoration: none; color: inherit; display: block; transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s; }
        .home-card:hover { transform: translateY(-5px); box-shadow: 0 20px 60px rgba(0,0,0,0.09); border-color: #d4c9b0; }
        .card-img { height: 220px; overflow: hidden; position: relative; }
        .card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s; }
        .home-card:hover .card-img img { transform: scale(1.05); }
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
        .card-tag.maroon { background: #fdf2f5; border-color: #f5c6d0; color: #8C1D40; }
        .card-footer { border-top: 1px solid #f0ede6; padding-top: 14px; }
        .card-score-lbl { font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 6px; }
        .card-reasons { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
        .card-reason { font-size: 11px; color: #6b6b6b; display: flex; align-items: center; gap: 5px; }
        .reason-chk { color: #c9973a; font-size: 10px; }
        .card-cta { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; padding-top: 12px; border-top: 1px solid #f0ede6; }
        .card-cta-hint { font-size: 11px; color: #9b9b9b; }
        .card-cta-btn { font-size: 13px; font-weight: 600; color: #8C1D40; display: flex; align-items: center; gap: 4px; }
        .home-card:hover .card-cta-btn { color: #c9973a; }

        @media (max-width: 768px) {
          .asu-bar-right { display: none; }
          .asu-bar-sub { display: none; }
          .hero { padding: 48px 0 40px; }
          .hero-title { font-size: 40px; letter-spacing: -1px; }
          .hero-sub { font-size: 15px; }
          .homes-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* PERSONALIZED BAR */}
      {isPersonalized && (
        <div className="personal-bar">
          <span className="pbar-dot" />
          <span>Hey <strong>{guestName}</strong> — we picked these homes for you near ASU. Spots go fast.</span>
        </div>
      )}

      <div className="wrap">

        {/* HERO */}
        <div className="hero">
          <div className="hero-eyebrow">
            <span className="hero-eyebrow-dot" />
            Tempe, AZ · Near ASU Campus
          </div>
          <h1 className="hero-title">
            Off-campus housing<br />for <em>Sun Devils.</em>
          </h1>
          <p className="hero-sub">
            Solo or with a group — find verified homes near ASU with <strong>transparent pricing</strong> and <strong>zero broker fees.</strong> No Zillow runaround. No scams.
          </p>
          <a href="#homes" className="hero-cta">View homes for rent →</a>
          <div className="hero-trust">
            {['$0 broker fees', 'Verified landlords', 'No commitment to apply', 'Groups welcome'].map(t => (
              <div className="hero-trust-item" key={t}>
                <span className="trust-dot" />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* HOMES */}
        <div id="homes">
          <div className="homes-hdr">
            <div className="homes-hdr-title">Homes available now</div>
            <div className="homes-hdr-meta">
              <span>{homes.filter(h => h.available > 0).length} available</span> · updated today
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
                    <span className="card-tag maroon">✓ Verified landlord</span>
                    <span className="card-tag maroon">$0 broker fee</span>
                    {home.tags.slice(0, 2).map(t => (
                      <span className="card-tag" key={t}>{t}</span>
                    ))}
                  </div>
                  <div className="card-footer">
                    <div className="card-score-lbl">ASU fit score</div>
                    <ScoreBar score={home.asuScore} />
                    <div className="card-reasons">
                      {home.asuScoreReasons.slice(0, 2).map(r => (
                        <div className="card-reason" key={r}>
                          <span className="reason-chk">✓</span>{r}
                        </div>
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
