'use client'

import { useState } from 'react'
import Loader from '@/components/Loader'

const SECTIONS = [
  {
    heading: 'Find a Home',
    links: [
      { label: 'Browse all homes', href: '/#homes', tag: '2 open', tagType: 'new' },
      { label: 'The Mill Ave Residence', href: '/homes/mill-ave-residence' },
      { label: 'The Apache House', href: '/homes/apache-house' },
      { label: 'Roommate matching', href: '/roommates', tag: 'new', tagType: 'new' },
      { label: 'Pricing & fees', href: '/pricing' },
    ],
  },
  {
    heading: 'Students',
    links: [
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Student housing guide', href: '/student-guide' },
      { label: 'ASU neighborhoods', href: '/student-guide/asu-neighborhoods' },
      { label: 'Move-in checklist', href: '/student-guide/move-in-checklist' },
      { label: 'Roommate tips', href: '/student-guide/roommate-tips', tag: 'soon', tagType: 'soon' },
      { label: 'Sign in', href: '/signin' },
    ],
  },
  {
    heading: 'Contact',
    links: [
      { label: 'hello@homehive.live', href: 'mailto:hello@homehive.live' },
      { label: '+1 (949) 867-0499', href: 'tel:+19498670499' },
      { label: 'Contact us', href: '/contact' },
      { label: 'List your home', href: '/list-your-home', tag: 'soon', tagType: 'soon' },
      { label: 'Landlord guide', href: '/landlord-guide' },
    ],
  },
] as const

export default function Footer() {
  const [showLoader, setShowLoader] = useState(false)
  const [openSection, setOpenSection] = useState<string | null>(null)

  const replayLoader = () => {
    sessionStorage.removeItem('hh_loader_seen')
    setShowLoader(true)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        .footer { background:#111; color:#9b9b9b; font-family:'DM Sans',sans-serif; margin-top:80px; }

        .f-top { background:#8C1D40; border-bottom:3px solid #FFC627; padding:20px 32px; }
        .f-top-inner { max-width:1200px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
        .f-top-eyebrow { font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:rgba(255,255,255,.55); margin-bottom:3px; }
        .f-top-headline { font-size:18px; font-weight:500; color:#fff; letter-spacing:-.2px; }
        .f-top-headline em { font-family:'Fraunces',serif; font-style:italic; color:#FFC627; }
        .f-top-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .f-top-ghost { font-size:13px; color:rgba(255,255,255,.8); text-decoration:none; transition:color .2s; }
        .f-top-ghost:hover { color:#FFC627; }
        .f-top-btn { background:#FFC627; color:#8C1D40; font-size:13px; font-weight:700; padding:10px 22px; border-radius:7px; text-decoration:none; white-space:nowrap; font-family:'DM Sans',sans-serif; }
        .f-top-btn:hover { background:#e6b320; }

        /* Desktop body */
        .f-body { max-width:1200px; margin:0 auto; padding:56px 32px 40px; display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:48px; }
        .f-logo { font-family:'DM Sans',sans-serif; font-size:22px; font-weight:600; color:#fff; text-decoration:none; letter-spacing:-.3px; display:inline-block; margin-bottom:12px; }
        .f-logo em { font-family:'Fraunces',serif; font-style:italic; color:#FFC627; }
        .f-tagline { font-size:13px; line-height:1.75; color:#6b6b6b; max-width:240px; margin-bottom:24px; }

        .f-play { display:flex; align-items:center; gap:10px; cursor:pointer; margin-bottom:28px; padding:12px 16px; background:#1a1a1a; border-radius:10px; border:1px solid #2a2a2a; transition:border-color .2s,background .2s; width:fit-content; }
        .f-play:hover { border-color:#8C1D40; background:#1f1f1f; }
        .f-play-circle { width:36px; height:36px; border-radius:50%; background:#8C1D40; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .f-play-tri { width:0; height:0; border-top:6px solid transparent; border-bottom:6px solid transparent; border-left:10px solid #fff; margin-left:3px; }
        .f-play-title { font-size:13px; font-weight:500; color:#fff; margin-bottom:1px; }
        .f-play-sub { font-size:11px; color:#4b4b4b; }

        .f-asu-badge { display:inline-flex; align-items:center; gap:7px; background:rgba(140,29,64,.15); border:1px solid rgba(140,29,64,.3); border-radius:20px; padding:5px 12px; }
        .f-asu-dot { width:6px; height:6px; border-radius:50%; background:#FFC627; }
        .f-asu-text { font-size:11px; color:rgba(255,255,255,.45); font-weight:500; }

        .f-col-heading { font-size:10px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; color:#FFC627; margin-bottom:16px; }
        .f-link { display:flex; align-items:center; gap:6px; font-size:13px; color:#6b6b6b; text-decoration:none; margin-bottom:11px; transition:color .15s; }
        .f-link:hover { color:#fff; }
        .tag-new { background:#8C1D40; color:#fff; font-size:9px; font-weight:700; letter-spacing:.5px; padding:1px 5px; border-radius:3px; text-transform:uppercase; }
        .tag-soon { background:#2a2a2a; color:#4b4b4b; font-size:9px; font-weight:600; padding:1px 5px; border-radius:3px; text-transform:uppercase; }

        .f-bottom { border-top:1px solid #1e1e1e; padding:20px 32px; }
        .f-bottom-inner { max-width:1200px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
        .f-copy { font-size:12px; color:#3a3a3a; }
        .f-legal-row { display:flex; align-items:center; gap:20px; }
        .f-legal { font-size:12px; color:#3a3a3a; text-decoration:none; transition:color .15s; }
        .f-legal:hover { color:#9b9b9b; }
        .f-made { font-size:12px; color:#3a3a3a; display:flex; align-items:center; gap:4px; }
        .f-heart { color:#8C1D40; }

        /* Mobile */
        .mob-accordions { display:none; }

        @media (max-width:768px) {
          .f-top { padding:16px 20px; }
          .f-top-inner { flex-direction:column; align-items:flex-start; gap:12px; }
          .f-top-headline { font-size:16px; }
          .f-top-ghost { display:none; }
          .f-top-actions { width:100%; }
          .f-top-btn { flex:1; text-align:center; padding:13px; font-size:14px; }

          .f-body { grid-template-columns:1fr; gap:0; padding:24px 20px 0; }
          .f-brand { padding-bottom:24px; border-bottom:1px solid #1e1e1e; }
          .f-tagline { max-width:100%; }
          .f-play { width:100%; box-sizing:border-box; }
          .f-col-desktop { display:none; }

          .mob-accordions { display:block; }
          .f-acc { border-bottom:1px solid #1e1e1e; }
          .f-acc-btn { width:100%; background:none; border:none; display:flex; align-items:center; justify-content:space-between; padding:16px 20px; font-size:15px; font-weight:500; color:#9b9b9b; cursor:pointer; font-family:'DM Sans',sans-serif; text-align:left; }
          .f-acc-btn:hover { color:#fff; }
          .f-acc-arrow { font-size:14px; transition:transform .25s; }
          .f-acc-arrow.open { transform:rotate(180deg); color:#FFC627; }
          .f-acc-body { overflow:hidden; max-height:0; transition:max-height .3s ease; }
          .f-acc-body.open { max-height:500px; }
          .f-acc-inner { padding:4px 20px 16px; display:flex; flex-direction:column; }
          .f-mob-link { display:flex; align-items:center; gap:7px; font-size:14px; color:#6b6b6b; text-decoration:none; padding:10px 0; border-bottom:1px solid #1a1a1a; }
          .f-mob-link:last-child { border-bottom:none; }
          .f-mob-link:hover { color:#fff; }

          .f-bottom { padding:16px 20px 24px; }
          .f-bottom-inner { flex-direction:column; align-items:center; gap:10px; text-align:center; }
          .f-legal-row { flex-wrap:wrap; justify-content:center; gap:14px; }
        }
      `}</style>

      {showLoader && <Loader onComplete={() => setShowLoader(false)} />}

      <footer className="footer">

        <div className="f-top">
          <div className="f-top-inner">
            <div>
              <div className="f-top-eyebrow">Still looking?</div>
              <div className="f-top-headline">Your home near ASU is <em>right here.</em></div>
            </div>
            <div className="f-top-actions">
              <a href="/roommates" className="f-top-ghost">Find roommates →</a>
              <a href="/#homes" className="f-top-btn">View available homes</a>
            </div>
          </div>
        </div>

        <div className="f-body">
          <div className="f-brand">
            <a href="/" className="f-logo">Home<em>Hive</em></a>
            <p className="f-tagline">The off-campus housing platform built for ASU students. Verified homes, transparent pricing, zero broker fees — solo or with your squad.</p>
            <div className="f-play" role="button" tabIndex={0} onClick={replayLoader} onKeyDown={e => e.key==='Enter' && replayLoader()}>
              <div className="f-play-circle"><span className="f-play-tri" /></div>
              <div>
                <div className="f-play-title">Watch the intro again</div>
                <div className="f-play-sub">See what HomeHive is all about</div>
              </div>
            </div>
            <div className="f-asu-badge">
              <span className="f-asu-dot" />
              <span className="f-asu-text">⚡ ASU Off-Campus Housing · Tempe, AZ</span>
            </div>
          </div>

          {SECTIONS.map(section => (
            <div key={section.heading} className="f-col-desktop">
              <div className="f-col-heading">{section.heading}</div>
              {section.links.map(link => (
                <a key={link.href} href={link.href} className="f-link">
                  {link.label}
                  {'tag' in link && link.tag && (
                    <span className={link.tagType === 'soon' ? 'tag-soon' : 'tag-new'}>{link.tag}</span>
                  )}
                </a>
              ))}
            </div>
          ))}
        </div>

        <div className="mob-accordions">
          {SECTIONS.map(section => (
            <div key={section.heading} className="f-acc">
              <button className="f-acc-btn" onClick={() => setOpenSection(prev => prev === section.heading ? null : section.heading)}>
                {section.heading}
                <span className={`f-acc-arrow${openSection === section.heading ? ' open' : ''}`}>↓</span>
              </button>
              <div className={`f-acc-body${openSection === section.heading ? ' open' : ''}`}>
                <div className="f-acc-inner">
                  {section.links.map(link => (
                    <a key={link.href} href={link.href} className="f-mob-link">
                      {link.label}
                      {'tag' in link && link.tag && (
                        <span className={link.tagType === 'soon' ? 'tag-soon' : 'tag-new'}>{link.tag}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="f-bottom">
          <div className="f-bottom-inner">
            <div className="f-copy">© 2026 HomeHive · Tempe, AZ · Built for Sun Devils</div>
            <div className="f-legal-row">
              <a href="/privacy" className="f-legal">Privacy</a>
              <a href="/terms" className="f-legal">Terms</a>
              <a href="/sitemap" className="f-legal">Sitemap</a>
              <span className="f-made">Made with <span className="f-heart">♥</span> in Tempe</span>
            </div>
          </div>
        </div>

      </footer>
    </>
  )
}
