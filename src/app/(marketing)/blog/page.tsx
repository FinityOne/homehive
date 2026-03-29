import { ARTICLES } from './articles'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata = {
  title: 'HomeHive Journal — ASU Off-Campus Housing Guides & Research',
  description:
    'Guides, research reports, and housing insights for Arizona State University students. Covering neighborhoods, leases, subleases, and life in Tempe.',
  keywords: [
    'ASU housing blog',
    'off campus housing guide ASU',
    'student housing tips Tempe',
    'ASU sublease guide',
    'Tempe neighborhoods students',
    'Arizona State University housing research',
  ],
  openGraph: {
    title: 'HomeHive Journal — ASU Off-Campus Housing Guides & Research',
    description: 'Guides, research, and housing insights for ASU students in Tempe.',
    url: `${SITE_URL}/blog`,
    siteName: 'HomeHive',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HomeHive Journal — ASU Off-Campus Housing Guides',
    description: 'Guides and research for ASU students navigating off-campus housing in Tempe.',
  },
  alternates: { canonical: `${SITE_URL}/blog` },
}

export default function BlogPage() {
  const featured = ARTICLES.find(a => a.featured)
  const rest = ARTICLES.filter(a => !a.featured)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .blog-hero { background: #faf9f6; border-bottom: 1px solid #e8e4db; padding: 56px 24px 48px; text-align: center; }
        .blog-hero-label { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 14px; font-family: 'DM Sans', sans-serif; }
        .blog-hero-title { font-family: 'Fraunces', serif; font-size: clamp(36px, 5vw, 52px); font-weight: 300; color: #1a1a1a; letter-spacing: -1px; margin-bottom: 14px; line-height: 1.1; }
        .blog-hero-sub { font-size: 16px; color: #6b6b6b; font-family: 'DM Sans', sans-serif; max-width: 480px; margin: 0 auto; line-height: 1.6; }

        .blog-body { max-width: 1060px; margin: 0 auto; padding: 48px 24px 96px; font-family: 'DM Sans', sans-serif; }

        /* Featured */
        .blog-featured { display: grid; grid-template-columns: 1fr 1fr; gap: 0; background: #1a3a5c; border-radius: 16px; overflow: hidden; margin-bottom: 48px; text-decoration: none; color: inherit; transition: transform 0.2s, box-shadow 0.2s; }
        .blog-featured:hover { transform: translateY(-2px); box-shadow: 0 16px 48px rgba(26,58,92,0.25); }
        .blog-featured-graphic { background: linear-gradient(135deg, #0f2035 0%, #1a3a5c 40%, #1e4976 100%); display: flex; align-items: center; justify-content: center; padding: 40px; min-height: 280px; position: relative; overflow: hidden; }
        .blog-feat-bg-num { position: absolute; font-family: 'Fraunces', serif; font-size: 160px; font-weight: 600; color: rgba(255,255,255,0.04); bottom: -20px; right: -10px; line-height: 1; user-select: none; }
        .blog-feat-badge { background: #FFC627; color: #1a3a5c; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 4px 10px; border-radius: 4px; display: inline-block; margin-bottom: 16px; font-family: 'DM Sans', sans-serif; }
        .blog-feat-stat { font-family: 'Fraunces', serif; font-size: 64px; font-weight: 300; color: #fff; letter-spacing: -2px; line-height: 1; }
        .blog-feat-stat-label { font-size: 12px; color: rgba(255,255,255,0.55); font-family: 'DM Sans', sans-serif; margin-top: 6px; }
        .blog-featured-body { padding: 36px; display: flex; flex-direction: column; justify-content: center; }
        .blog-cat-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 3px 10px; border-radius: 4px; margin-bottom: 14px; font-family: 'DM Sans', sans-serif; }
        .blog-feat-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 600; color: #fff; line-height: 1.25; margin-bottom: 12px; letter-spacing: -0.3px; }
        .blog-feat-excerpt { font-size: 13px; color: rgba(255,255,255,0.65); line-height: 1.65; margin-bottom: 20px; }
        .blog-feat-meta { display: flex; align-items: center; gap: 10px; }
        .blog-feat-author { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); }
        .blog-feat-dot { width: 3px; height: 3px; border-radius: 50%; background: rgba(255,255,255,0.3); }
        .blog-feat-date { font-size: 12px; color: rgba(255,255,255,0.4); }
        .blog-feat-read { font-size: 12px; color: rgba(255,255,255,0.4); }
        .blog-feat-cta { margin-top: 20px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #FFC627; }
        .blog-feat-cta svg { transition: transform 0.15s; }
        .blog-featured:hover .blog-feat-cta svg { transform: translateX(4px); }

        /* Grid */
        .blog-section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 20px; }
        .blog-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .blog-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; text-decoration: none; color: inherit; display: flex; flex-direction: column; transition: transform 0.15s, box-shadow 0.15s; }
        .blog-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.07); }
        .blog-card-top { height: 120px; display: flex; align-items: center; justify-content: center; background: #faf9f6; border-bottom: 1px solid #e8e4db; font-family: 'Fraunces', serif; font-size: 40px; font-weight: 300; color: #c5c1b8; letter-spacing: -1px; position: relative; overflow: hidden; }
        .blog-card-top-num { position: absolute; font-family: 'Fraunces', serif; font-size: 100px; color: rgba(0,0,0,0.03); font-weight: 600; bottom: -16px; right: 8px; line-height: 1; user-select: none; }
        .blog-card-body { padding: 20px; flex: 1; display: flex; flex-direction: column; }
        .blog-card-cat { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 10px; font-family: 'DM Sans', sans-serif; }
        .blog-card-title { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; color: #1a1a1a; line-height: 1.3; margin-bottom: 10px; letter-spacing: -0.2px; }
        .blog-card-excerpt { font-size: 13px; color: #6b6b6b; line-height: 1.6; flex: 1; margin-bottom: 16px; }
        .blog-card-footer { display: flex; align-items: center; justify-content: space-between; }
        .blog-card-date { font-size: 11px; color: #9b9b9b; }
        .blog-card-read { font-size: 11px; color: #9b9b9b; }

        @media (max-width: 860px) {
          .blog-featured { grid-template-columns: 1fr; }
          .blog-featured-graphic { min-height: 180px; }
          .blog-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 540px) {
          .blog-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="blog-hero">
        <div className="blog-hero-label">HomeHive Journal</div>
        <h1 className="blog-hero-title">Housing insights<br />for Sun Devils</h1>
        <p className="blog-hero-sub">Research, guides, and advice for ASU students navigating off-campus housing.</p>
      </div>

      <div className="blog-body">
        {/* Featured research piece */}
        {featured && (
          <a href={`/blog/${featured.slug}`} className="blog-featured">
            <div className="blog-featured-graphic">
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div className="blog-feat-badge">Research Report · {featured.date}</div>
                <div className="blog-feat-stat">#1</div>
                <div className="blog-feat-stat-label">Rated platform for ASU off-campus housing</div>
              </div>
              <span className="blog-feat-bg-num">01</span>
            </div>
            <div className="blog-featured-body">
              <span className="blog-cat-pill" style={{ background: 'rgba(255,198,39,0.12)', color: '#FFC627' }}>
                {featured.category}
              </span>
              <div className="blog-feat-title">{featured.title}</div>
              <div className="blog-feat-excerpt">{featured.excerpt}</div>
              <div className="blog-feat-meta">
                <span className="blog-feat-author">{featured.author.name}</span>
                <span className="blog-feat-dot" />
                <span className="blog-feat-read">{featured.readTime}</span>
              </div>
              <div className="blog-feat-cta">
                Read the full report
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7h10M7 2l5 5-5 5" stroke="#FFC627" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </a>
        )}

        <div className="blog-section-label">Latest articles</div>
        <div className="blog-grid">
          {rest.map((article, i) => (
            <a key={article.slug} href={`/blog/${article.slug}`} className="blog-card">
              <div className="blog-card-top">
                <span className="blog-card-top-num">{String(i + 2).padStart(2, '0')}</span>
              </div>
              <div className="blog-card-body">
                <span className="blog-card-cat" style={{ background: `${article.categoryColor}15`, color: article.categoryColor }}>
                  {article.category}
                </span>
                <div className="blog-card-title">{article.title}</div>
                <div className="blog-card-excerpt">{article.excerpt}</div>
                <div className="blog-card-footer">
                  <span className="blog-card-date">{article.date}</span>
                  <span className="blog-card-read">{article.readTime}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </>
  )
}
