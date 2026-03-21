'use client'

import { useState, useEffect } from 'react'
import Loader from '@/components/Loader'

export default function Nav() {
  const [showLoader, setShowLoader] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const replayLoader = () => {
    sessionStorage.removeItem('hh_loader_seen')
    setShowLoader(true)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        .asu-ribbon { background:#8C1D40; border-bottom:3px solid #FFC627; padding:0 32px; font-family:'DM Sans',sans-serif; }
        .asu-ribbon-inner { max-width:1200px; margin:0 auto; height:36px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
        .asu-left { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .asu-fork { color:#FFC627; font-size:13px; }
        .asu-title { font-size:11px; font-weight:700; letter-spacing:.9px; text-transform:uppercase; color:#fff; }
        .asu-div { width:1px; height:13px; background:rgba(255,255,255,.25); }
        .asu-sub { font-size:11px; color:rgba(255,255,255,.65); white-space:nowrap; }
        .asu-right { display:flex; align-items:center; gap:12px; }
        .asu-pill { background:#FFC627; color:#8C1D40; font-size:10px; font-weight:700; letter-spacing:.4px; padding:2px 9px; border-radius:20px; white-space:nowrap; }
        .asu-rlink { font-size:11px; color:rgba(255,255,255,.75); text-decoration:none; font-weight:500; }
        .asu-rlink:hover { color:#FFC627; }
        .play-btn { width:24px; height:24px; border-radius:50%; border:1.5px solid rgba(255,255,255,.3); background:rgba(255,255,255,.08); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; }
        .play-btn:hover { background:rgba(255,198,39,.2); border-color:#FFC627; }
        .play-tri { width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:8px solid rgba(255,255,255,.8); margin-left:2px; }
        .play-btn:hover .play-tri { border-left-color:#FFC627; }
        .play-tip { font-size:10px; color:rgba(255,255,255,.5); white-space:nowrap; }

        .nav { background:#fff; border-bottom:1px solid #e8e4db; padding:0 32px; height:58px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:200; font-family:'DM Sans',sans-serif; transition:box-shadow .2s; }
        .nav.scrolled { box-shadow:0 2px 20px rgba(0,0,0,.07); }
        .nav-logo { font-family:'DM Sans',sans-serif; font-size:19px; font-weight:600; color:#1a1a1a; text-decoration:none; letter-spacing:-.3px; }
        .nav-logo em { font-family:'Fraunces',serif; font-style:italic; color:#FFC627; }
        .nav-center { display:flex; align-items:center; gap:4px; }
        .nav-link { font-size:13px; color:#6b6b6b; text-decoration:none; padding:6px 12px; border-radius:6px; transition:color .15s,background .15s; white-space:nowrap; display:flex; align-items:center; gap:6px; }
        .nav-link:hover { color:#1a1a1a; background:#f5f4f0; }
        .pill-hot { background:#FFC627; color:#8C1D40; font-size:9px; font-weight:700; letter-spacing:.5px; padding:1px 5px; border-radius:4px; text-transform:uppercase; }
        .pill-new { background:#8C1D40; color:#fff; font-size:9px; font-weight:700; letter-spacing:.5px; padding:1px 5px; border-radius:4px; text-transform:uppercase; }
        .nav-sep { width:1px; height:20px; background:#e8e4db; margin:0 6px; }
        .nav-right { display:flex; align-items:center; gap:8px; }
        .nav-signin { font-size:13px; color:#6b6b6b; text-decoration:none; padding:6px 14px; border-radius:6px; transition:color .15s,background .15s; }
        .nav-signin:hover { color:#1a1a1a; background:#f5f4f0; }
        .nav-cta { background:#8C1D40; color:#fff; font-size:13px; font-weight:600; padding:8px 18px; border-radius:7px; border:none; cursor:pointer; font-family:'DM Sans',sans-serif; text-decoration:none; white-space:nowrap; transition:background .2s; display:flex; align-items:center; gap:6px; }
        .nav-cta:hover { background:#7a1835; }
        .cta-dot { width:6px; height:6px; border-radius:50%; background:#FFC627; animation:blink 2s infinite; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.4} }

        .mob-cta { display:none; background:#8C1D40; color:#fff; font-size:13px; font-weight:600; padding:8px 16px; border-radius:7px; text-decoration:none; font-family:'DM Sans',sans-serif; }
        .ham { display:none; background:none; border:none; cursor:pointer; padding:6px; flex-direction:column; gap:5px; align-items:center; width:36px; height:36px; justify-content:center; }
        .ham-bar { width:20px; height:2px; background:#1a1a1a; border-radius:2px; transition:all .25s; transform-origin:center; }
        .ham.open .ham-bar:nth-child(1) { transform:translateY(7px) rotate(45deg); }
        .ham.open .ham-bar:nth-child(2) { opacity:0; transform:scaleX(0); }
        .ham.open .ham-bar:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }

        .mob-drawer { position:fixed; top:58px; left:0; right:0; bottom:0; background:#fff; z-index:190; display:flex; flex-direction:column; transform:translateX(100%); transition:transform .3s cubic-bezier(.22,1,.36,1); overflow-y:auto; font-family:'DM Sans',sans-serif; }
        .mob-drawer.open { transform:translateX(0); }
        .mob-asu { background:#8C1D40; border-bottom:2px solid #FFC627; padding:10px 20px; display:flex; align-items:center; justify-content:space-between; }
        .mob-asu-label { font-size:11px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; color:#fff; }
        .mob-asu-pill { background:#FFC627; color:#8C1D40; font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px; }
        .mob-links { padding:8px 0; flex:1; }
        .mob-link { display:flex; align-items:center; justify-content:space-between; padding:15px 20px; font-size:16px; color:#1a1a1a; text-decoration:none; border-bottom:1px solid #f5f4f0; transition:background .15s; }
        .mob-link:hover { background:#faf9f6; }
        .mob-link-inner { display:flex; align-items:center; gap:10px; }
        .mob-bottom { padding:16px 20px 40px; border-top:1px solid #f0ede6; display:flex; flex-direction:column; gap:10px; }
        .mob-replay { display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:9px; border:1px solid #e8e4db; cursor:pointer; background:#faf9f6; }
        .mob-replay-circle { width:30px; height:30px; border-radius:50%; background:#8C1D40; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .mob-replay-tri { width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:8px solid #fff; margin-left:2px; }
        .mob-replay-title { font-size:13px; font-weight:500; color:#1a1a1a; }
        .mob-replay-sub { font-size:11px; color:#9b9b9b; }
        .mob-main-cta { background:#8C1D40; color:#fff; padding:15px; border-radius:9px; text-align:center; font-size:15px; font-weight:600; text-decoration:none; font-family:'DM Sans',sans-serif; }
        .mob-signin-link { text-align:center; font-size:14px; color:#9b9b9b; text-decoration:none; padding:10px; }

        @media (max-width:860px) {
          .asu-ribbon { display:none; }
          .nav { padding:0 16px; }
          .nav-center,.nav-right { display:none; }
          .mob-cta { display:block; }
          .ham { display:flex; }
        }
        @media (min-width:861px) {
          .mob-drawer,.mob-cta,.ham { display:none !important; }
        }
      `}</style>

      {showLoader && <Loader onComplete={() => setShowLoader(false)} />}

      <div className="asu-ribbon">
        <div className="asu-ribbon-inner">
          <div className="asu-left">
            <span className="asu-fork">⚡</span>
            <span className="asu-title">ASU Off-Campus Housing</span>
            <span className="asu-div" />
            <span className="asu-sub">Verified homes for Sun Devils in Tempe</span>
          </div>
          <div className="asu-right">
            <a href="/student-guide" className="asu-rlink">Student Guide</a>
            <a href="/roommates" className="asu-rlink">Find roommates</a>
            <span className="asu-pill">Fall 2025 open</span>
            <button className="play-btn" onClick={replayLoader} title="Replay intro">
              <span className="play-tri" />
            </button>
            <span className="play-tip">replay</span>
          </div>
        </div>
      </div>

      <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
        <a href="/" className="nav-logo">Home<em>Hive</em></a>
        <div className="nav-center">
          <a href="/homes" className="nav-link">Homes <span className="pill-hot">2 open</span></a>
          <a href="/roommates" className="nav-link">Roommates <span className="pill-new">new</span></a>
          <a href="/how-it-works" className="nav-link">How it works</a>
          <div className="nav-sep" />
          <a href="/pricing" className="nav-link">Pricing</a>
          <a href="/student-guide" className="nav-link">Student Guide</a>
        </div>
        <div className="nav-right">
          <a href="/signin" className="nav-signin">Sign in</a>
          <a href="/homes" className="nav-cta"><span className="cta-dot" />View homes</a>
        </div>
        <a href="/homes" className="mob-cta">View homes</a>
        <button className={`ham${mobileOpen ? ' open' : ''}`} onClick={() => setMobileOpen(o => !o)} aria-label="Menu">
          <span className="ham-bar" /><span className="ham-bar" /><span className="ham-bar" />
        </button>
      </nav>

      <div className={`mob-drawer${mobileOpen ? ' open' : ''}`}>
        <div className="mob-asu">
          <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
            <span style={{color:'#FFC627',fontSize:'12px'}}>⚡</span>
            <span className="mob-asu-label">ASU Off-Campus Housing</span>
          </div>
          <span className="mob-asu-pill">Fall 2025 open</span>
        </div>
        <div className="mob-links">
          {[
            {href:'/homes',     label:'Homes',        pill:'2 open', pt:'hot'},
            {href:'/roommates',  label:'Roommates',    pill:'new',    pt:'new'},
            {href:'/how-it-works',label:'How it works',pill:null,     pt:null },
            {href:'/pricing',    label:'Pricing',      pill:null,     pt:null },
            {href:'/student-guide',label:'Student Guide',pill:null,   pt:null },
          ].map(({href,label,pill,pt}) => (
            <a key={href} href={href} className="mob-link" onClick={() => setMobileOpen(false)}>
              <span className="mob-link-inner">
                {label}
                {pill && <span className={pt==='hot'?'pill-hot':'pill-new'}>{pill}</span>}
              </span>
              <span style={{color:'#ccc',fontSize:'18px'}}>›</span>
            </a>
          ))}
        </div>
        <div className="mob-bottom">
          <div className="mob-replay" role="button" tabIndex={0}
            onClick={() => { setMobileOpen(false); replayLoader() }}
            onKeyDown={e => e.key==='Enter' && replayLoader()}>
            <div className="mob-replay-circle"><span className="mob-replay-tri" /></div>
            <div>
              <div className="mob-replay-title">Watch the intro</div>
              <div className="mob-replay-sub">See what HomeHive is all about</div>
            </div>
          </div>
          <a href="/homes" className="mob-main-cta" onClick={() => setMobileOpen(false)}>View available homes →</a>
          <a href="/signin" className="mob-signin-link" onClick={() => setMobileOpen(false)}>Already have an account? Sign in</a>
        </div>
      </div>
    </>
  )
}
