'use client'

import '@/styles/brand-tokens.css'
import { useState } from 'react'

const SECTIONS = [
  {
    heading: 'Find a Home',
    links: [
      { label: 'Browse listings',       href: '/homes'        },
      { label: 'How it works',          href: '/how-it-works' },
      { label: 'Pricing & fees',        href: '/pricing'      },
      { label: 'Student housing guide', href: '/student-guide'},
      { label: 'Blog & research',       href: '/blog'         },
    ],
  },
  {
    heading: 'List Your Place',
    links: [
      { label: 'List your place',       href: '/for-landlords'          },
      { label: 'How listing works',     href: '/how-it-works#landlords' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Contact us',            href: '/contact'                  },
      { label: 'hello@homehive.live',   href: 'mailto:hello@homehive.live'},
      { label: '+1 (949) 867-0499',     href: 'tel:+19498670499'          },
      { label: 'Sign in',               href: '/login'                    },
      { label: 'Sitemap',               href: '/sitemap-page'             },
    ],
  },
]

export default function Footer() {
  const [openSection, setOpenSection] = useState<string | null>(null)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Geist:wght@300;400;500;600;700&display=swap');

        /* ── PRE-FOOTER CTA STRIP ─────────────────────────────── */
        .f-prefooter {
          background: var(--hh-cream-100);
          border-top: 1px solid var(--hh-border-faint);
          padding: 56px 32px;
        }
        .f-prefooter-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 32px;
          flex-wrap: wrap;
        }
        .f-prefooter-eyebrow {
          font-family: var(--hh-font-ui);
          font-size: var(--hh-sz-eyebrow);
          font-weight: var(--hh-wt-eyebrow);
          letter-spacing: var(--hh-ls-eyebrow);
          text-transform: uppercase;
          color: var(--hh-accent);
          margin-bottom: 10px;
        }
        .f-prefooter-headline {
          font-family: var(--hh-font-display);
          font-size: clamp(26px, 3.5vw, 40px);
          font-weight: 380;
          color: var(--hh-text);
          line-height: 1.12;
          letter-spacing: -0.02em;
        }
        .f-prefooter-headline em {
          font-style: italic;
          color: var(--hh-primary);
        }
        .f-prefooter-sub {
          font-family: var(--hh-font-ui);
          font-size: 14px;
          color: var(--hh-text-muted);
          margin-top: 10px;
          line-height: 1.6;
          max-width: 380px;
        }
        .f-prefooter-actions {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }
        .f-prefooter-ghost {
          font-family: var(--hh-font-ui);
          font-size: 14px;
          color: var(--hh-text-muted);
          text-decoration: none;
          transition: color 0.15s;
          white-space: nowrap;
        }
        .f-prefooter-ghost:hover { color: var(--hh-text); }
        .f-prefooter-btn {
          font-family: var(--hh-font-ui);
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          background: var(--hh-primary);
          padding: 13px 28px;
          border-radius: 100px;
          text-decoration: none;
          white-space: nowrap;
          letter-spacing: -0.01em;
          transition: opacity 0.15s, transform 0.1s;
        }
        .f-prefooter-btn:hover { opacity: 0.88; transform: translateY(-1px); }

        /* ── FOOTER BODY ──────────────────────────────────────── */
        .footer {
          background: #1c2824;
          color: rgba(255,255,255,0.55);
          font-family: var(--hh-font-ui);
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        .f-body {
          max-width: 1200px;
          margin: 0 auto;
          padding: 60px 32px 48px;
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 56px;
        }

        /* Brand column */
        .f-logo {
          text-decoration: none;
          display: inline-block;
          margin-bottom: 16px;
        }
        .f-logo img { height: 28px; width: auto; display: block; }
        .f-tagline {
          font-size: 13px;
          line-height: 1.75;
          color: rgba(255,255,255,0.45);
          max-width: 230px;
          margin-bottom: 24px;
        }

        /* ASU badge — brand-aligned */
        .f-asu-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(217,161,74,0.1);
          border: 1px solid rgba(217,161,74,0.25);
          border-radius: 100px;
          padding: 6px 14px;
        }
        .f-asu-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--hh-accent);
          flex-shrink: 0;
          box-shadow: 0 0 6px rgba(217,161,74,0.6);
        }
        .f-asu-text {
          font-size: 11px;
          font-weight: 500;
          color: var(--hh-accent);
          letter-spacing: 0.02em;
        }

        /* Social links */
        .f-socials {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        .f-social-btn {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          text-decoration: none;
          transition: background 0.15s, border-color 0.15s;
          color: rgba(255,255,255,0.6);
        }
        .f-social-btn:hover {
          background: rgba(217,161,74,0.15);
          border-color: rgba(217,161,74,0.35);
          color: var(--hh-accent);
        }

        /* Link columns */
        .f-col-heading {
          font-size: var(--hh-sz-eyebrow);
          font-weight: var(--hh-wt-eyebrow);
          letter-spacing: var(--hh-ls-eyebrow);
          text-transform: uppercase;
          color: var(--hh-accent);
          margin-bottom: 18px;
        }
        .f-link {
          display: block;
          font-size: 13px;
          color: rgba(255,255,255,0.45);
          text-decoration: none;
          margin-bottom: 12px;
          transition: color 0.15s;
          line-height: 1.4;
        }
        .f-link:hover { color: rgba(255,255,255,0.9); }
        .f-link:last-child { margin-bottom: 0; }

        /* ── BOTTOM BAR ───────────────────────────────────────── */
        .f-bottom {
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 20px 32px 24px;
        }
        .f-bottom-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }
        .f-copy {
          font-size: 12px;
          color: rgba(255,255,255,0.25);
          letter-spacing: 0.01em;
        }
        .f-legal {
          display: flex;
          gap: 20px;
        }
        .f-legal a {
          font-size: 12px;
          color: rgba(255,255,255,0.25);
          text-decoration: none;
          transition: color 0.15s;
        }
        .f-legal a:hover { color: rgba(255,255,255,0.55); }

        /* ── MOBILE: accordion ────────────────────────────────── */
        .mob-accordions { display: none; }

        @media (max-width: 860px) {
          .f-prefooter { padding: 40px 20px; }
          .f-prefooter-inner { flex-direction: column; align-items: flex-start; gap: 24px; }
          .f-prefooter-sub { max-width: 100%; }
          .f-prefooter-actions { width: 100%; flex-direction: column; }
          .f-prefooter-btn { text-align: center; width: 100%; padding: 15px; }
          .f-prefooter-ghost { display: none; }

          .f-body { grid-template-columns: 1fr; gap: 0; padding: 32px 20px 0; }
          .f-brand { padding-bottom: 28px; border-bottom: 1px solid rgba(255,255,255,0.07); }
          .f-tagline { max-width: 100%; }
          .f-col-desktop { display: none; }

          .mob-accordions { display: block; }
          .f-acc { border-bottom: 1px solid rgba(255,255,255,0.07); }
          .f-acc-btn {
            width: 100%; background: none; border: none;
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 0; font-size: 14px; font-weight: 500;
            color: rgba(255,255,255,0.55); cursor: pointer;
            font-family: var(--hh-font-ui); text-align: left;
          }
          .f-acc-btn:hover { color: rgba(255,255,255,0.9); }
          .f-acc-arrow { font-size: 13px; transition: transform 0.25s; display: inline-block; opacity: 0.5; }
          .f-acc-arrow.open { transform: rotate(180deg); opacity: 1; color: var(--hh-accent); }
          .f-acc-body { overflow: hidden; max-height: 0; transition: max-height 0.3s ease; }
          .f-acc-body.open { max-height: 400px; }
          .f-acc-inner { padding: 4px 0 16px; display: flex; flex-direction: column; }
          .f-mob-link {
            font-size: 14px; color: rgba(255,255,255,0.4); text-decoration: none;
            padding: 11px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
          }
          .f-mob-link:last-child { border-bottom: none; }
          .f-mob-link:hover { color: rgba(255,255,255,0.85); }

          .mob-accordions { padding: 0 20px; }
          .f-bottom { padding: 18px 20px 32px; }
          .f-bottom-inner { flex-direction: column; align-items: center; gap: 8px; text-align: center; }
          .f-legal { gap: 16px; }
        }
      `}</style>

      {/* ── PRE-FOOTER CTA ─────────────────────────────────────── */}
      <div className="f-prefooter">
        <div className="f-prefooter-inner">
          <div>
            <div className="f-prefooter-eyebrow">Ready to move?</div>
            <div className="f-prefooter-headline">
              Your home near ASU<br />is <em>waiting for you.</em>
            </div>
            <p className="f-prefooter-sub">
              Verified listings, zero broker fees, no surprises at signing.
            </p>
          </div>
          <div className="f-prefooter-actions">
            <a href="/for-landlords" className="f-prefooter-ghost">List your place →</a>
            <a href="/homes" className="f-prefooter-btn">View available homes</a>
          </div>
        </div>
      </div>

      <footer className="footer">

        {/* ── Desktop body ── */}
        <div className="f-body">

          {/* Brand column */}
          <div className="f-brand">
            <a href="/" className="f-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hh-logo-white.png" alt="HomeHive" />
            </a>
            <p className="f-tagline">
              The off-campus housing platform built for ASU students. Verified homes, transparent pricing, zero broker fees.
            </p>

            {/* ASU badge */}
            <div className="f-asu-badge">
              <span className="f-asu-dot" />
              <span className="f-asu-text">ASU Off-Campus · Tempe, AZ</span>
            </div>

            {/* Social links */}
            <div className="f-socials">
              <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="f-social-btn" aria-label="Instagram">📷</a>
              <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" className="f-social-btn" aria-label="TikTok">🎵</a>
              <a href="mailto:hello@homehive.live" className="f-social-btn" aria-label="Email">✉️</a>
            </div>
          </div>

          {/* Link columns */}
          {SECTIONS.map(section => (
            <div key={section.heading} className="f-col-desktop">
              <div className="f-col-heading">{section.heading}</div>
              {section.links.map(link => (
                <a key={link.href} href={link.href} className="f-link">{link.label}</a>
              ))}
            </div>
          ))}

        </div>

        {/* ── Mobile accordions ── */}
        <div className="mob-accordions">
          {SECTIONS.map(section => (
            <div key={section.heading} className="f-acc">
              <button
                className="f-acc-btn"
                onClick={() => setOpenSection(prev => prev === section.heading ? null : section.heading)}
              >
                {section.heading}
                <span className={`f-acc-arrow${openSection === section.heading ? ' open' : ''}`}>↓</span>
              </button>
              <div className={`f-acc-body${openSection === section.heading ? ' open' : ''}`}>
                <div className="f-acc-inner">
                  {section.links.map(link => (
                    <a key={link.href} href={link.href} className="f-mob-link">{link.label}</a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Bottom bar ── */}
        <div className="f-bottom">
          <div className="f-bottom-inner">
            <div className="f-copy">© 2026 HomeHive · Tempe, AZ · Built for Sun Devils</div>
            <div className="f-legal">
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/sitemap-page">Sitemap</a>
            </div>
          </div>
        </div>

      </footer>
    </>
  )
}
