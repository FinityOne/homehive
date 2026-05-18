'use client'

import '@/styles/brand-tokens.css'
import { useState } from 'react'

const SECTIONS = [
  {
    heading: 'Students',
    links: [
      { label: 'Browse homes',    href: '/homes'        },
      { label: 'Find roommates',  href: '/roommates'    },
      { label: 'Lease guides',    href: '/student-guide'},
      { label: 'Trust & safety',  href: '/how-it-works' },
      { label: 'Refer a friend',  href: '/refer'        },
    ],
  },
  {
    heading: 'Hosts',
    links: [
      { label: 'List a place',    href: '/for-landlords'          },
      { label: 'Pricing',         href: '/pricing'                },
      { label: 'Host handbook',   href: '/how-it-works#landlords' },
      { label: 'Tax & lease docs',href: '/blog'                   },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About',   href: '/about'   },
      { label: 'Careers', href: '/careers' },
      { label: 'Press',   href: '/press'   },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Campuses',
    links: [
      { label: 'ASU Tempe',         href: '/homes'           },
      { label: 'ASU West',          href: '/homes'           },
      { label: 'ASU Downtown',      href: '/homes'           },
      { label: 'Request a campus',  href: '/contact'         },
    ],
  },
]

export default function Footer() {
  const [openSection, setOpenSection] = useState<string | null>(null)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Geist:wght@300;400;500;600;700&display=swap');

        /* ── FOOTER ───────────────────────────────────────────── */
        .footer {
          background: #141210;
          color: rgba(255,255,255,0.5);
          font-family: var(--hh-font-ui);
        }

        .f-body {
          max-width: 1280px;
          margin: 0 auto;
          padding: 72px 48px 64px;
          display: grid;
          grid-template-columns: 1.6fr 1fr 1fr 1fr 1fr;
          gap: 40px;
        }

        /* ── Brand column ─────────────────────────────────────── */
        .f-brand-col { padding-right: 16px; }

        .f-wordmark {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          margin-bottom: 20px;
        }
        .f-wordmark-text {
          font-family: var(--hh-font-ui);
          font-size: 20px;
          font-weight: 500;
          color: #fff;
          letter-spacing: -0.3px;
          line-height: 1;
        }
        .f-wordmark-text em {
          font-family: var(--hh-font-display);
          font-style: italic;
          font-weight: 400;
          font-size: 21px;
        }

        .f-tagline {
          font-size: 13.5px;
          line-height: 1.7;
          color: rgba(255,255,255,0.38);
          max-width: 240px;
          margin-bottom: 28px;
          font-family: var(--hh-font-ui);
        }

        /* App buttons */
        .f-app-btns {
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: flex-start;
        }
        .f-app-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--hh-font-ui);
          font-size: 13px;
          font-weight: 500;
          color: rgba(255,255,255,0.75);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 100px;
          padding: 9px 18px;
          text-decoration: none;
          white-space: nowrap;
          letter-spacing: -0.01em;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
          cursor: default;
        }
        .f-app-btn:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.2);
          color: rgba(255,255,255,0.9);
        }

        /* ── Link columns ─────────────────────────────────────── */
        .f-col-heading {
          font-family: var(--hh-font-ui);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #D9A14A;
          margin-bottom: 20px;
        }
        .f-link {
          display: block;
          font-family: var(--hh-font-ui);
          font-size: 14px;
          font-weight: 400;
          color: rgba(255,255,255,0.55);
          text-decoration: none;
          margin-bottom: 14px;
          transition: color 0.15s;
          line-height: 1.3;
          letter-spacing: -0.01em;
        }
        .f-link:hover { color: rgba(255,255,255,0.9); }
        .f-link:last-child { margin-bottom: 0; }

        /* ── Bottom bar ───────────────────────────────────────── */
        .f-bottom {
          border-top: 1px solid rgba(255,255,255,0.07);
          padding: 20px 48px 28px;
        }
        .f-bottom-inner {
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }
        .f-copy {
          font-family: var(--hh-font-ui);
          font-size: 12.5px;
          color: rgba(255,255,255,0.22);
          letter-spacing: 0.005em;
        }
        .f-legal {
          display: flex;
          gap: 24px;
        }
        .f-legal a {
          font-family: var(--hh-font-ui);
          font-size: 12.5px;
          color: rgba(255,255,255,0.22);
          text-decoration: none;
          transition: color 0.15s;
          letter-spacing: 0.005em;
        }
        .f-legal a:hover { color: rgba(255,255,255,0.55); }

        /* ── Mobile: accordions ───────────────────────────────── */
        .f-mob-accordions { display: none; }

        @media (max-width: 900px) {
          .f-body { grid-template-columns: 1fr; gap: 0; padding: 40px 24px 0; }
          .f-brand-col { padding-right: 0; padding-bottom: 32px; border-bottom: 1px solid rgba(255,255,255,0.07); }
          .f-tagline { max-width: 100%; }
          .f-app-btns { flex-direction: row; }
          .f-col-desktop { display: none; }

          .f-mob-accordions { display: block; padding: 0 24px; }
          .f-mob-acc { border-bottom: 1px solid rgba(255,255,255,0.07); }
          .f-mob-acc-btn {
            width: 100%; background: none; border: none;
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 0; font-size: 13px; font-weight: 600;
            letter-spacing: 0.08em; text-transform: uppercase;
            color: #D9A14A; cursor: pointer;
            font-family: var(--hh-font-ui); text-align: left;
          }
          .f-mob-acc-arrow { font-size: 12px; transition: transform 0.25s; display: inline-block; opacity: 0.6; color: rgba(255,255,255,0.4); }
          .f-mob-acc-arrow.open { transform: rotate(180deg); opacity: 1; }
          .f-mob-acc-body { overflow: hidden; max-height: 0; transition: max-height 0.3s ease; }
          .f-mob-acc-body.open { max-height: 400px; }
          .f-mob-acc-inner { padding: 4px 0 16px; display: flex; flex-direction: column; }
          .f-mob-link {
            font-size: 14px; color: rgba(255,255,255,0.45); text-decoration: none;
            padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
            font-family: var(--hh-font-ui);
          }
          .f-mob-link:last-child { border-bottom: none; }
          .f-mob-link:hover { color: rgba(255,255,255,0.85); }

          .f-bottom { padding: 18px 24px 32px; }
          .f-bottom-inner { flex-direction: column; align-items: center; gap: 8px; text-align: center; }
          .f-legal { gap: 16px; flex-wrap: wrap; justify-content: center; }
        }
      `}</style>

      <footer className="footer">

        {/* ── Desktop body ── */}
        <div className="f-body">

          {/* Brand column */}
          <div className="f-brand-col">
            <a href="/" className="f-wordmark">
              {/* Hex icon */}
              <svg width="28" height="32" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 1L27 8.5V23.5L14 31L1 23.5V8.5L14 1Z" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"/>
                <path d="M14 1L27 8.5V23.5L14 31L1 23.5V8.5L14 1Z" fill="rgba(217,161,74,0.08)"/>
                <circle cx="14" cy="16" r="3.5" fill="#D9A14A" opacity="0.9"/>
                <circle cx="9" cy="11.5" r="2" fill="rgba(217,161,74,0.45)"/>
                <circle cx="19" cy="11.5" r="2" fill="rgba(217,161,74,0.45)"/>
                <circle cx="9" cy="20.5" r="2" fill="rgba(217,161,74,0.45)"/>
                <circle cx="19" cy="20.5" r="2" fill="rgba(217,161,74,0.45)"/>
              </svg>
              <span className="f-wordmark-text">Home<em>Hive</em></span>
            </a>

            <p className="f-tagline">
              The verified housing platform for college students. Built first in Tempe. Rolling out across every U.S. campus.
            </p>

            <div className="f-app-btns">
              <span className="f-app-btn">iOS app — soon</span>
              <span className="f-app-btn">Android — soon</span>
            </div>
          </div>

          {/* Link columns */}
          {SECTIONS.map(section => (
            <div key={section.heading} className="f-col-desktop">
              <div className="f-col-heading">{section.heading}</div>
              {section.links.map(link => (
                <a key={link.label} href={link.href} className="f-link">{link.label}</a>
              ))}
            </div>
          ))}

        </div>

        {/* ── Mobile accordions ── */}
        <div className="f-mob-accordions">
          {SECTIONS.map(section => (
            <div key={section.heading} className="f-mob-acc">
              <button
                className="f-mob-acc-btn"
                onClick={() => setOpenSection(prev => prev === section.heading ? null : section.heading)}
              >
                {section.heading}
                <span className={`f-mob-acc-arrow${openSection === section.heading ? ' open' : ''}`}>↓</span>
              </button>
              <div className={`f-mob-acc-body${openSection === section.heading ? ' open' : ''}`}>
                <div className="f-mob-acc-inner">
                  {section.links.map(link => (
                    <a key={link.label} href={link.href} className="f-mob-link">{link.label}</a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Bottom bar ── */}
        <div className="f-bottom">
          <div className="f-bottom-inner">
            <div className="f-copy">© 2026 HomeHive Inc. · Built for students.</div>
            <div className="f-legal">
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/accessibility">Accessibility</a>
              <a href="/cookie-preferences">Cookie preferences</a>
            </div>
          </div>
        </div>

      </footer>
    </>
  )
}
