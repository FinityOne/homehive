import type { Metadata } from 'next'
import { ARTICLES } from '../blog/articles'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'Sitemap — HomeHive',
  description: 'A full list of pages on HomeHive, the off-campus housing platform for ASU students in Tempe.',
  alternates: { canonical: `${SITE_URL}/sitemap-page` },
  robots: { index: true, follow: true },
}

const SECTIONS = [
  {
    heading: 'Main Pages',
    links: [
      { label: 'Home',                href: '/'              },
      { label: 'Browse Listings',     href: '/homes'         },
      { label: 'How It Works',        href: '/how-it-works'  },
      { label: 'Pricing & Fees',      href: '/pricing'       },
      { label: 'Student Housing Guide', href: '/student-guide'},
      { label: 'List Your Place',     href: '/for-landlords' },
      { label: 'Blog & Research',     href: '/blog'          },
      { label: 'Contact Us',          href: '/contact'       },
    ],
  },
  {
    heading: 'Blog Articles',
    links: ARTICLES.map(a => ({
      label: a.title,
      href: `/blog/${a.slug}`,
    })),
  },
]

export default function SitemapPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .sm-hero { background: #faf9f6; border-bottom: 1px solid #e8e4db; padding: 52px 24px 44px; text-align: center; }
        .sm-hero-label { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 12px; font-family: 'DM Sans', sans-serif; }
        .sm-hero-title { font-family: 'Fraunces', serif; font-size: clamp(30px, 4vw, 44px); font-weight: 600; font-style: italic; color: #1a1a1a; letter-spacing: -1px; line-height: 1.1; }
        .sm-hero-sub { font-size: 15px; color: #6b6b6b; font-family: 'DM Sans', sans-serif; margin-top: 12px; }

        .sm-body { max-width: 800px; margin: 0 auto; padding: 52px 24px 96px; font-family: 'DM Sans', sans-serif; }

        .sm-section { margin-bottom: 48px; }
        .sm-section-heading { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #8C1D40; margin-bottom: 18px; padding-bottom: 10px; border-bottom: 2px solid #FFC627; display: inline-block; }

        .sm-list { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 4px; }
        .sm-list li a { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; text-decoration: none; color: #1a1a1a; font-size: 14px; font-weight: 400; transition: background 0.15s, color 0.15s; border: 1px solid transparent; }
        .sm-list li a:hover { background: #fff; border-color: #e8e4db; color: #8C1D40; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        .sm-list li a .sm-arrow { font-size: 12px; color: #c5c1b8; margin-left: auto; transition: transform 0.15s; }
        .sm-list li a:hover .sm-arrow { transform: translateX(3px); color: #8C1D40; }

        .sm-xml { margin-top: 48px; padding: 20px 24px; background: #faf9f6; border: 1px solid #e8e4db; border-radius: 12px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .sm-xml-text { font-size: 13px; color: #6b6b6b; line-height: 1.6; }
        .sm-xml-text strong { color: #1a1a1a; display: block; margin-bottom: 2px; font-size: 14px; }
        .sm-xml-link { font-size: 13px; font-weight: 600; color: #8C1D40; text-decoration: none; white-space: nowrap; border: 1px solid #8C1D40; padding: 8px 16px; border-radius: 7px; transition: background 0.15s, color 0.15s; }
        .sm-xml-link:hover { background: #8C1D40; color: #fff; }

        @media (max-width: 540px) {
          .sm-list { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="sm-hero">
        <div className="sm-hero-label">HomeHive</div>
        <h1 className="sm-hero-title">Sitemap</h1>
        <p className="sm-hero-sub">Every page on HomeHive, organized for easy navigation.</p>
      </div>

      <div className="sm-body">
        {SECTIONS.map(section => (
          <div key={section.heading} className="sm-section">
            <div className="sm-section-heading">{section.heading}</div>
            <ul className="sm-list">
              {section.links.map(link => (
                <li key={link.href}>
                  <a href={link.href}>
                    {link.label}
                    <span className="sm-arrow">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="sm-xml">
          <div className="sm-xml-text">
            <strong>XML Sitemap for Search Engines</strong>
            The machine-readable sitemap is available for Google and other search engines to crawl all pages automatically.
          </div>
          <a href="/sitemap.xml" className="sm-xml-link" target="_blank" rel="noopener noreferrer">
            View XML Sitemap →
          </a>
        </div>
      </div>
    </>
  )
}
