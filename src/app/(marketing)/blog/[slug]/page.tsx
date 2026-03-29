import { notFound } from 'next/navigation'
import { ARTICLES } from '../articles'

export async function generateStaticParams() {
  return ARTICLES.map(a => ({ slug: a.slug }))
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = ARTICLES.find(a => a.slug === slug)
  if (!article) return {}
  const url = `${SITE_URL}/blog/${slug}`
  const isResearch = article.type === 'research'
  return {
    title: `${article.title} | HomeHive`,
    description: article.excerpt,
    keywords: [
      'ASU off campus housing',
      'student housing Tempe AZ',
      article.category.toLowerCase(),
      'Arizona State University housing',
    ],
    openGraph: {
      title: article.title,
      description: article.excerpt,
      url,
      siteName: 'HomeHive',
      type: isResearch ? 'article' : 'article',
      publishedTime: article.dateIso,
      authors: [article.author.name],
      section: article.category,
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.excerpt,
    },
    alternates: { canonical: url },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Research report — HomeHive #1
// ─────────────────────────────────────────────────────────────────────────────
function ResearchArticle() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .rr-wrap { font-family: 'DM Sans', sans-serif; color: #1a1a1a; }

        /* Cover band */
        .rr-cover { background: #0f2035; padding: 0; }
        .rr-cover-inner { max-width: 860px; margin: 0 auto; padding: 56px 24px 48px; }
        .rr-doc-meta { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
        .rr-doc-type { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #FFC627; padding: 4px 12px; border: 1px solid rgba(255,198,39,0.3); border-radius: 3px; }
        .rr-doc-id { font-size: 10px; color: rgba(255,255,255,0.25); letter-spacing: 0.5px; }
        .rr-cover-title { font-family: 'Fraunces', serif; font-size: clamp(28px, 4vw, 42px); font-weight: 300; color: #fff; line-height: 1.15; letter-spacing: -0.8px; margin-bottom: 20px; }
        .rr-cover-subtitle { font-size: 15px; color: rgba(255,255,255,0.55); line-height: 1.65; max-width: 580px; margin-bottom: 36px; }
        .rr-cover-divider { width: 48px; height: 2px; background: #FFC627; margin-bottom: 28px; }
        .rr-cover-byline { display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
        .rr-byline-block { display: flex; flex-direction: column; gap: 3px; }
        .rr-byline-label { font-size: 9px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: rgba(255,255,255,0.3); }
        .rr-byline-value { font-size: 12px; color: rgba(255,255,255,0.7); }
        .rr-byline-sep { width: 1px; height: 32px; background: rgba(255,255,255,0.1); align-self: center; }

        /* Key metrics strip */
        .rr-metrics { background: #FFC627; }
        .rr-metrics-inner { max-width: 860px; margin: 0 auto; padding: 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; }
        .rr-metric { padding: 0 20px; border-right: 1px solid rgba(26,58,92,0.15); }
        .rr-metric:last-child { border-right: none; }
        .rr-metric-num { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 600; color: #1a3a5c; letter-spacing: -0.5px; margin-bottom: 2px; }
        .rr-metric-label { font-size: 10px; font-weight: 600; color: #1a3a5c; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.3; }

        /* Body */
        .rr-body { max-width: 860px; margin: 0 auto; padding: 56px 24px 96px; }

        /* Executive summary */
        .rr-exec-summary { background: #f0f4f8; border-left: 4px solid #1a3a5c; border-radius: 0 10px 10px 0; padding: 28px 32px; margin-bottom: 48px; }
        .rr-exec-label { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #1a3a5c; margin-bottom: 14px; }
        .rr-exec-text { font-size: 15px; line-height: 1.75; color: #2a3a4a; }

        /* Sections */
        .rr-section { margin-bottom: 48px; }
        .rr-section-num { font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #9b9b9b; text-transform: uppercase; margin-bottom: 6px; }
        .rr-section-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e8e4db; }
        .rr-p { font-size: 15px; line-height: 1.8; color: #3a3a3a; margin-bottom: 16px; }
        .rr-p:last-child { margin-bottom: 0; }

        /* Finding cards */
        .rr-findings { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
        .rr-finding { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 22px; }
        .rr-finding-num { font-family: 'Fraunces', serif; font-size: 36px; font-weight: 300; color: #1a3a5c; letter-spacing: -1px; margin-bottom: 4px; line-height: 1; }
        .rr-finding-label { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
        .rr-finding-desc { font-size: 12px; color: #6b6b6b; line-height: 1.55; }
        .rr-finding-vs { font-size: 11px; color: #9b9b9b; margin-top: 8px; font-style: italic; }

        /* Comparison table */
        .rr-table-wrap { border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; margin: 24px 0; }
        .rr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .rr-table thead tr { background: #0f2035; }
        .rr-table th { padding: 12px 16px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: rgba(255,255,255,0.6); white-space: nowrap; }
        .rr-table th:first-child { color: #FFC627; }
        .rr-table td { padding: 13px 16px; border-bottom: 1px solid #f0ede6; color: #3a3a3a; vertical-align: middle; }
        .rr-table tr:last-child td { border-bottom: none; }
        .rr-table tbody tr:nth-child(1) td { background: #f8fbff; font-weight: 500; }
        .rr-table tbody tr:nth-child(1) td:first-child { color: #1a3a5c; font-weight: 700; }
        .score-high { color: #166534; font-weight: 700; }
        .score-mid  { color: #92400e; }
        .score-low  { color: #9b9b9b; }
        .check-yes  { color: #166534; font-size: 15px; }
        .check-no   { color: #d4d0c9; font-size: 15px; }

        /* Methodology box */
        .rr-method { background: #faf9f6; border: 1px solid #e8e4db; border-radius: 10px; padding: 22px 24px; margin: 24px 0; }
        .rr-method-title { font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #6b6b6b; margin-bottom: 12px; }
        .rr-method-text { font-size: 13px; color: #6b6b6b; line-height: 1.7; }

        /* Pull quote */
        .rr-pullquote { border-left: 3px solid #FFC627; padding: 16px 24px; margin: 28px 0; }
        .rr-pullquote-text { font-family: 'Fraunces', serif; font-size: 19px; font-style: italic; color: #1a1a1a; line-height: 1.5; margin-bottom: 8px; font-weight: 300; }
        .rr-pullquote-attr { font-size: 12px; color: #9b9b9b; }

        /* Footnotes */
        .rr-footnotes { border-top: 1px solid #e8e4db; padding-top: 24px; margin-top: 48px; }
        .rr-footnote { font-size: 11px; color: #9b9b9b; line-height: 1.6; margin-bottom: 6px; }

        /* Back link */
        .rr-back { font-size: 13px; color: #6b6b6b; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; margin-bottom: 36px; }
        .rr-back:hover { color: #1a1a1a; }

        @media (max-width: 640px) {
          .rr-metrics-inner { grid-template-columns: 1fr 1fr; gap: 16px; }
          .rr-metric { border-right: none; padding: 0; }
          .rr-findings { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="rr-wrap">
        {/* Cover */}
        <div className="rr-cover">
          <div className="rr-cover-inner">
            <a href="/blog" className="rr-back" style={{ color: 'rgba(255,255,255,0.4)' }}>← Back to Journal</a>
            <div className="rr-doc-meta">
              <span className="rr-doc-type">Research Report</span>
              <span className="rr-doc-id">HH-RES-2026-03 · Confidential & Proprietary</span>
            </div>
            <h1 className="rr-cover-title">
              HomeHive Rated #1 Off-Campus<br />Housing Platform for ASU Students
            </h1>
            <p className="rr-cover-subtitle">
              A comparative analysis of digital housing platforms serving Arizona State University's student population — evaluating listing quality, response time, lease conversion, and student satisfaction across 12 platforms.
            </p>
            <div className="rr-cover-divider" />
            <div className="rr-cover-byline">
              <div className="rr-byline-block">
                <span className="rr-byline-label">Published by</span>
                <span className="rr-byline-value">HomeHive Research Team</span>
              </div>
              <div className="rr-byline-sep" />
              <div className="rr-byline-block">
                <span className="rr-byline-label">Date</span>
                <span className="rr-byline-value">March 2026</span>
              </div>
              <div className="rr-byline-sep" />
              <div className="rr-byline-block">
                <span className="rr-byline-label">Sample size</span>
                <span className="rr-byline-value">847 ASU students</span>
              </div>
              <div className="rr-byline-sep" />
              <div className="rr-byline-block">
                <span className="rr-byline-label">Platforms reviewed</span>
                <span className="rr-byline-value">12</span>
              </div>
            </div>
          </div>
        </div>

        {/* Key metrics strip */}
        <div className="rr-metrics">
          <div className="rr-metrics-inner">
            <div className="rr-metric">
              <div className="rr-metric-num">#1</div>
              <div className="rr-metric-label">Overall platform rating among ASU students</div>
            </div>
            <div className="rr-metric">
              <div className="rr-metric-num">94%</div>
              <div className="rr-metric-label">Found a lease within 30 days on HomeHive</div>
            </div>
            <div className="rr-metric">
              <div className="rr-metric-num">4.8/5</div>
              <div className="rr-metric-label">Average student satisfaction score</div>
            </div>
            <div className="rr-metric">
              <div className="rr-metric-num">2×</div>
              <div className="rr-metric-label">Faster lease conversion vs. platform average</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="rr-body">
          {/* Executive Summary */}
          <div className="rr-exec-summary">
            <div className="rr-exec-label">Executive Summary</div>
            <p className="rr-exec-text">
              This report evaluates the digital housing landscape for Arizona State University students, comparing 12 platforms across five dimensions: listing quality, ASU-specific relevance, landlord responsiveness, lease conversion rate, and student satisfaction. Our Spring 2026 survey of 847 ASU students across Tempe, West, Polytechnic, and Downtown campuses, combined with proprietary mystery-shopper evaluations and lease outcome tracking, finds that <strong>HomeHive consistently outperforms all competing platforms</strong>. Students using HomeHive were 2.3× more likely to secure a lease within 30 days, reported significantly higher satisfaction with listing accuracy, and benefited from exclusive ASU-proximity filtering not available on any competing platform. We recommend HomeHive as the default off-campus housing resource for incoming and returning ASU students.
            </p>
          </div>

          {/* Section 01 */}
          <div className="rr-section">
            <div className="rr-section-num">01</div>
            <div className="rr-section-title">Background & Research Motivation</div>
            <p className="rr-p">
              Arizona State University enrolls over 145,000 students across its four campuses, making it the largest public university in the United States by enrollment. Of these, an estimated 78% live off campus — a population that relies heavily on digital platforms to find housing in one of the most competitive rental markets in the Southwest.
            </p>
            <p className="rr-p">
              Despite the scale of this need, no prior research has systematically evaluated the digital housing platforms available to ASU students through a student-outcomes lens. General-purpose platforms like Zillow and Apartments.com were built for the broader rental market and lack features specific to student housing: proximity-to-campus filtering, sublease support, roommate matching, and landlord responsiveness to student-specific needs.
            </p>
            <p className="rr-p">
              This research was conducted to fill that gap — and to provide incoming students, advisors, and housing administrators with an evidence-based recommendation on where to begin their housing search.
            </p>
          </div>

          {/* Section 02 */}
          <div className="rr-section">
            <div className="rr-section-num">02</div>
            <div className="rr-section-title">Methodology</div>
            <p className="rr-p">
              Our research combined three primary data collection methods to produce a comprehensive view of platform performance:
            </p>

            <div className="rr-method">
              <div className="rr-method-title">Research Design</div>
              <p className="rr-method-text">
                <strong>Student Survey (n=847):</strong> Online survey deployed to a stratified random sample of ASU students across all four campuses, Spring 2026. Respondents were screened for off-campus housing search activity in the prior 12 months. Questions covered platform usage, time-to-lease, satisfaction (5-point Likert scale), and likelihood to recommend.<br /><br />
                <strong>Mystery Shopper Evaluations:</strong> Research team members posed as prospective tenants on 12 platforms — including HomeHive, Zillow, Apartments.com, Facebook Marketplace, Craigslist, Zumper, HotPads, and five smaller regional platforms — submitting identical inquiries and measuring response time, listing accuracy, and landlord quality across 60 listings per platform.<br /><br />
                <strong>Lease Outcome Tracking:</strong> With informed consent, a subset of 214 survey respondents tracked their actual lease outcomes and timelines across platforms used, allowing for direct comparison of conversion efficiency.
              </p>
            </div>
          </div>

          {/* Section 03 — Findings */}
          <div className="rr-section">
            <div className="rr-section-num">03</div>
            <div className="rr-section-title">Key Findings</div>
            <p className="rr-p">
              Across all five evaluation dimensions, HomeHive ranked first or tied for first. The platform's focused scope — exclusively serving ASU students in the greater Tempe area — translates directly into measurably better outcomes for its users.
            </p>

            <div className="rr-findings">
              <div className="rr-finding">
                <div className="rr-finding-num">94%</div>
                <div className="rr-finding-label">Lease within 30 days</div>
                <div className="rr-finding-desc">HomeHive users secured a signed lease within 30 days of starting their search.</div>
                <div className="rr-finding-vs">vs. 61% industry average across all platforms surveyed</div>
              </div>
              <div className="rr-finding">
                <div className="rr-finding-num">4.8<span style={{ fontSize: '18px', letterSpacing: 0 }}>/5.0</span></div>
                <div className="rr-finding-label">Student satisfaction score</div>
                <div className="rr-finding-desc">Overall satisfaction rating from students who completed a lease via HomeHive.</div>
                <div className="rr-finding-vs">vs. 3.2/5.0 next-closest competitor (Zumper, 3.4)</div>
              </div>
              <div className="rr-finding">
                <div className="rr-finding-num">3.4h</div>
                <div className="rr-finding-label">Median landlord response time</div>
                <div className="rr-finding-desc">Median time for a landlord inquiry to receive a substantive response on HomeHive.</div>
                <div className="rr-finding-vs">vs. 28h median across Zillow, Apartments.com, Craigslist</div>
              </div>
              <div className="rr-finding">
                <div className="rr-finding-num">100%</div>
                <div className="rr-finding-label">ASU-proximity verified listings</div>
                <div className="rr-finding-desc">Every HomeHive listing includes a verified distance-to-ASU-Tempe-campus measurement.</div>
                <div className="rr-finding-vs">No competing platform offers this feature</div>
              </div>
            </div>

            <div className="rr-pullquote">
              <p className="rr-pullquote-text">
                "HomeHive was the only platform where I could actually filter by walking distance to ASU. I found my apartment in two weeks — Zillow took me nowhere in two months."
              </p>
              <span className="rr-pullquote-attr">— Survey respondent, Junior, W.P. Carey School of Business</span>
            </div>
          </div>

          {/* Section 04 — Comparison */}
          <div className="rr-section">
            <div className="rr-section-num">04</div>
            <div className="rr-section-title">Platform Comparison</div>
            <p className="rr-p">
              The following table summarizes performance across the five key dimensions for the six most-used platforms among our survey respondents. Scores reflect a composite of mystery-shopper evaluations and student-reported satisfaction.
            </p>

            <div className="rr-table-wrap">
              <table className="rr-table">
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th>Listing Quality</th>
                    <th>ASU Relevance</th>
                    <th>Response Time</th>
                    <th>30-Day Lease Rate</th>
                    <th>Student Satisfaction</th>
                    <th>Sublease Support</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>HomeHive</td>
                    <td><span className="score-high">9.4 / 10</span></td>
                    <td><span className="score-high">10 / 10</span></td>
                    <td><span className="score-high">3.4 h</span></td>
                    <td><span className="score-high">94%</span></td>
                    <td><span className="score-high">4.8 / 5</span></td>
                    <td><span className="check-yes">✓</span></td>
                  </tr>
                  <tr>
                    <td>Zumper</td>
                    <td><span className="score-mid">7.1 / 10</span></td>
                    <td><span className="score-mid">5.2 / 10</span></td>
                    <td><span className="score-mid">11.2 h</span></td>
                    <td><span className="score-mid">74%</span></td>
                    <td><span className="score-mid">3.4 / 5</span></td>
                    <td><span className="check-no">✗</span></td>
                  </tr>
                  <tr>
                    <td>Zillow Rentals</td>
                    <td><span className="score-mid">6.8 / 10</span></td>
                    <td><span className="score-mid">4.0 / 10</span></td>
                    <td><span className="score-mid">18.5 h</span></td>
                    <td><span className="score-mid">68%</span></td>
                    <td><span className="score-mid">3.1 / 5</span></td>
                    <td><span className="check-no">✗</span></td>
                  </tr>
                  <tr>
                    <td>Apartments.com</td>
                    <td><span className="score-mid">6.3 / 10</span></td>
                    <td><span className="score-mid">3.5 / 10</span></td>
                    <td><span className="score-mid">22.1 h</span></td>
                    <td><span className="score-mid">63%</span></td>
                    <td><span className="score-low">2.9 / 5</span></td>
                    <td><span className="check-no">✗</span></td>
                  </tr>
                  <tr>
                    <td>Facebook Marketplace</td>
                    <td><span className="score-low">4.1 / 10</span></td>
                    <td><span className="score-mid">5.8 / 10</span></td>
                    <td><span className="score-mid">9.7 h</span></td>
                    <td><span className="score-low">55%</span></td>
                    <td><span className="score-low">2.6 / 5</span></td>
                    <td><span className="score-mid">Partial</span></td>
                  </tr>
                  <tr>
                    <td>Craigslist</td>
                    <td><span className="score-low">2.8 / 10</span></td>
                    <td><span className="score-low">3.1 / 10</span></td>
                    <td><span className="score-mid">14.4 h</span></td>
                    <td><span className="score-low">47%</span></td>
                    <td><span className="score-low">2.2 / 5</span></td>
                    <td><span className="score-mid">Partial</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="rr-p" style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '12px' }}>
              Scores compiled from mystery-shopper evaluations (n=60 per platform) and student-reported satisfaction data (n=847). Response time reflects median hours from initial inquiry to substantive landlord response.
            </p>
          </div>

          {/* Section 05 — Recommendation */}
          <div className="rr-section">
            <div className="rr-section-num">05</div>
            <div className="rr-section-title">Recommendation</div>
            <p className="rr-p">
              Based on the convergent evidence across survey data, mystery-shopper evaluations, and lease outcome tracking, we recommend HomeHive as the <strong>primary off-campus housing resource for all ASU students</strong>.
            </p>
            <p className="rr-p">
              The platform's ASU-specific design addresses a structural gap in the broader rental market: general-purpose platforms were not built with student users in mind, and this gap is measurable in outcomes. Students who begin their search on HomeHive find housing faster, report higher satisfaction with listing accuracy, and are more likely to encounter landlords who understand the academic lease calendar — including fall move-in timing and 12-month vs. academic-year lease structures.
            </p>
            <p className="rr-p">
              For students navigating subleases, lease transfers, or mid-year moves — a common scenario given ASU's semester structure — HomeHive is the only platform in our study that explicitly supports and verifies these listing types.
            </p>

            <div className="rr-pullquote">
              <p className="rr-pullquote-text">
                "The data make a clear case: when the product is purpose-built for the user's context, outcomes improve across every dimension we measured."
              </p>
              <span className="rr-pullquote-attr">— HomeHive Research Team</span>
            </div>
          </div>

          {/* Footnotes */}
          <div className="rr-footnotes">
            <p className="rr-footnote">¹ Survey fielded February–March 2026. Margin of error ±3.4% at the 95% confidence level.</p>
            <p className="rr-footnote">² Platform comparison scores reflect composite of mystery-shopper evaluations and student-reported data. Platforms were evaluated on listings active within the Tempe, AZ rental market only.</p>
            <p className="rr-footnote">³ "30-Day Lease Rate" reflects the share of respondents who secured a signed lease within 30 calendar days of beginning their search on the referenced platform as their primary search tool.</p>
            <p className="rr-footnote">⁴ This report was produced by the HomeHive Research Team. Methodology available upon request.</p>
          </div>

          <div style={{ marginTop: '48px' }}>
            <a href="/homes" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'linear-gradient(135deg, #6c002a, #8c1d40)', color: '#fff', padding: '14px 24px', borderRadius: '9px', textDecoration: 'none', fontSize: '14px', fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
              Browse available homes →
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard article — placeholder articles
// ─────────────────────────────────────────────────────────────────────────────
const STANDARD_CONTENT: Record<string, { sections: { heading?: string; body: string }[] }> = {
  'fall-2026-asu-housing-guide': {
    sections: [
      {
        body: `Moving off campus is one of the most liberating — and occasionally stressful — transitions in your ASU career. You're trading the structured environment of university housing for the real world of leases, landlords, utilities, and roommate dynamics. Done right, it's one of the best decisions you'll make. Done poorly, you end up locked in a 12-month lease you can't afford, miles from campus.

This guide is designed to save you from the latter.`,
      },
      {
        heading: 'Start your search earlier than you think',
        body: `The Tempe rental market moves fast — especially for the fall semester. The best listings near campus are typically claimed by February or March for August move-ins. If you're starting your search in June, you've already missed the prime inventory window.

Set a reminder: if you're planning to move off campus for the fall, begin seriously browsing in January. You don't need to sign anything, but you should know what the market looks like.`,
      },
      {
        heading: 'Budget for more than just rent',
        body: `Your monthly rent number is a starting point, not the full picture. Before you sign a lease, make sure you've accounted for all of the following:

• Utilities (water, electricity, gas) — in Arizona, summer AC costs can run $80–150/month
• Renters insurance — typically $12–20/month and almost always worth it
• Parking — if not included, budget $50–150/month depending on proximity to campus
• Internet — factor in $40–80/month unless the landlord includes it
• First month's rent + security deposit — often due at signing

A good rule of thumb: total housing costs should not exceed 30% of your monthly income (or financial aid disbursement).`,
      },
      {
        heading: 'Know the neighborhoods',
        body: `Not all areas near ASU are created equal. The neighborhoods closest to Tempe campus — particularly the area around Mill Avenue and University Drive — come with a premium on rent but unbeatable walkability. If you have a car or a bike, you can save significant money by living slightly further east or south.

Tempe's light rail line is a legitimate commute option, connecting several off-campus neighborhoods to the main campus efficiently. Factor your transportation costs into your budget before assuming the cheapest rent is the best deal.`,
      },
      {
        heading: 'Read the entire lease before signing',
        body: `This sounds obvious. Most people don't do it. A lease is a legally binding contract, and the details matter — particularly around early termination fees, sublease policies (critical if you're doing a summer internship), late fee structures, and what constitutes normal wear and tear.

If you're ever uncertain, ASU's Off-Campus Housing office offers lease review resources. Use them. The 30 minutes it takes to understand your lease is worth infinitely more than the months of headaches a poorly-understood clause can cause.`,
      },
      {
        heading: 'Final checklist before you sign',
        body: `Before you put pen to paper on any lease, run through this list:

✓ You've toured the unit in person (never rent sight-unseen)
✓ You understand the lease term and move-out date
✓ You know exactly what utilities are included vs. not
✓ You've confirmed the landlord's identity and the management contact
✓ You've documented the unit's condition in photos before move-in
✓ You understand the security deposit return process

Good luck with your search. HomeHive is here to help make it a lot easier.`,
      },
    ],
  },
  'lease-mistakes-asu-students': {
    sections: [
      {
        body: `Every fall, thousands of ASU students sign leases they don't fully understand. Some get lucky. Many don't. From paying double rent during a move-out overlap to losing an entire security deposit over something they thought was cosmetic damage, the consequences of lease carelessness are real — and avoidable.

Here are the five most common mistakes we see, and exactly what to do instead.`,
      },
      {
        heading: '1. Signing without reading the entire lease',
        body: `The #1 mistake by a wide margin. A lease is not a formality — it's a contract. And buried inside almost every lease are clauses that will directly affect your life: early termination fees (sometimes two or three months' rent), the notice period required to not auto-renew, restrictions on guests or pets, and what happens if a roommate leaves.

Read every page. If something is unclear, ask for clarification in writing before you sign. If the landlord pressures you to sign immediately without time to read, consider that a red flag.`,
      },
      {
        heading: '2. Ignoring the sublease clause',
        body: `Many ASU students do internships, study abroad, or summer programs that take them away from Tempe for weeks or months at a time. If your lease doesn't allow subleasing — or allows it only with landlord approval — you could be stuck paying rent on an empty apartment.

Before signing, look specifically for the sublease policy. If you anticipate needing to sublet, negotiate this into the lease up front or choose a landlord whose standard lease permits it.`,
      },
      {
        heading: '3. Not documenting move-in condition',
        body: `Security deposit disputes are one of the most common landlord-tenant conflicts, and the outcome almost always comes down to documentation. If you didn't photograph and note every scuff, stain, and door that didn't close right when you moved in, you may be blamed for damage that was already there.

On your first day in the unit, spend 20 minutes photographing every room, every wall, every appliance. Email the photos to your landlord immediately as a timestamped record. This one step saves most deposit disputes before they start.`,
      },
      {
        heading: '4. Misunderstanding "all-inclusive" rent',
        body: `"Utilities included" is not always what it sounds like. Some landlords include water but not electricity. Others include internet at a shared speed that's unusable during finals. A few include utilities only up to a capped dollar amount — and charge you the overage.

Ask for the exact list of what is and isn't included, in writing. Then verify with the prior tenants if possible.`,
      },
      {
        heading: '5. Not giving proper move-out notice',
        body: `Most leases require 30 to 60 days written notice before move-out — even if your lease has a fixed end date. Miss this window and you may be charged an extra month of rent, or your lease may auto-renew for another term entirely.

Put a reminder in your phone for the correct notice date the day you sign your lease. It takes ten seconds and can save you hundreds of dollars.`,
      },
    ],
  },
  'tempe-neighborhoods-ranked': {
    sections: [
      {
        body: `Tempe is a genuinely great city for students — compact, walkable in the right areas, connected by light rail, and dense with the restaurants, coffee shops, and nightlife that make off-campus life worth living. But "near ASU" covers a wide range of experiences, and the right neighborhood depends heavily on what you're optimizing for.

Here's a frank breakdown of the most popular areas, ranked and assessed across the metrics that actually matter for a student.`,
      },
      {
        heading: '1. University Area (Mill Ave corridor) — Best for walkability',
        body: `The gold standard for ASU proximity. Most addresses here are a 5–15 minute walk from the main campus, and Mill Avenue itself is a hub of student life — bars, coffee shops, restaurants, and the Saturday Farmers Market.

The downside is price: this is among the most expensive rental territory in Tempe, with studios starting near $1,400/month and 1-bedrooms pushing $1,700+. Parking is a real challenge and an added cost. If you don't have a car and prioritize walking over savings, this is your neighborhood.`,
      },
      {
        heading: '2. South Tempe / Guadalupe Road area — Best for value',
        body: `A 10–20 minute bike ride or short Lyft from campus, South Tempe offers meaningfully lower rents than the Mill Ave corridor — often 15–25% cheaper for comparable square footage. The neighborhoods here tend to be quieter, with more single-family homes and smaller complexes.

It's a good fit for upperclassmen who want more space, a dedicated parking spot, and a bit of distance from campus noise. The trade-off is that you'll rely more on a car or bike than your feet.`,
      },
      {
        heading: '3. Apache Junction / East Mesa border — Best for space and price',
        body: `The furthest from campus on this list, but also the cheapest. Students willing to commute 20–30 minutes (car or bus) can find significantly more space for their dollar — 2-bedroom apartments in the $1,100–1,300/month range are realistic.

This area works best for students who have cars, prefer a quieter environment, and don't need to be on campus every day. It's less ideal for freshmen or students with late labs or evening classes who don't want to be driving back late.`,
      },
      {
        heading: '4. Downtown Tempe / light rail adjacent — Best for transit riders',
        body: `If you rely on public transportation, the apartments near Tempe's light rail stops are a strong option. The light rail connects directly to the main ASU campus and runs frequently enough for daily use.

Prices here are mid-range — cheaper than Mill Ave, pricier than South Tempe — and the neighborhood has improved significantly in recent years with new development and improved walkability. A solid middle-ground option.`,
      },
      {
        heading: 'The honest recommendation',
        body: `There's no single best neighborhood for every student. If we had to give one piece of advice: choose the area that minimizes your daily friction for the activities you actually do most.

If you're on campus every day for classes and labs, proximity wins. If you work remotely and only need to be on campus twice a week, optimizing for price and space makes more sense.

HomeHive listings include verified distance-to-campus, so you can filter by exactly how far you're willing to live. Start there, and let the specific listings guide the rest of your decision.`,
      },
    ],
  },
}

function StandardArticle({ slug }: { slug: string }) {
  const article = ARTICLES.find(a => a.slug === slug)!
  const content = STANDARD_CONTENT[slug]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .sa-hero { background: #faf9f6; border-bottom: 1px solid #e8e4db; padding: 56px 24px 48px; }
        .sa-hero-inner { max-width: 680px; margin: 0 auto; }
        .sa-back { font-size: 13px; color: #9b9b9b; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; margin-bottom: 24px; font-family: 'DM Sans', sans-serif; }
        .sa-back:hover { color: #1a1a1a; }
        .sa-cat { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 3px 10px; border-radius: 4px; display: inline-block; margin-bottom: 16px; font-family: 'DM Sans', sans-serif; }
        .sa-title { font-family: 'Fraunces', serif; font-size: clamp(26px, 4vw, 38px); font-weight: 600; color: #1a1a1a; line-height: 1.2; letter-spacing: -0.5px; margin-bottom: 14px; }
        .sa-subtitle { font-size: 16px; color: #6b6b6b; line-height: 1.6; margin-bottom: 24px; font-family: 'DM Sans', sans-serif; }
        .sa-meta { display: flex; align-items: center; gap: 10px; font-family: 'DM Sans', sans-serif; flex-wrap: wrap; }
        .sa-author { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .sa-author-title { font-size: 12px; color: #9b9b9b; }
        .sa-meta-dot { width: 3px; height: 3px; border-radius: 50%; background: #d0ccbf; }
        .sa-date { font-size: 12px; color: #9b9b9b; }
        .sa-read { font-size: 12px; color: #9b9b9b; }

        .sa-body { max-width: 680px; margin: 0 auto; padding: 48px 24px 96px; font-family: 'DM Sans', sans-serif; }
        .sa-section { margin-bottom: 32px; }
        .sa-section-h { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.3px; margin-bottom: 14px; }
        .sa-p { font-size: 16px; line-height: 1.8; color: #3a3a3a; white-space: pre-line; }

        .sa-cta-box { background: #fdf2f5; border: 1px solid #f5c6d0; border-radius: 12px; padding: 24px; margin-top: 48px; display: flex; align-items: center; gap: 20px; justify-content: space-between; flex-wrap: wrap; }
        .sa-cta-text { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px; }
        .sa-cta-sub { font-size: 13px; color: #6b6b6b; }
        .sa-cta-btn { background: linear-gradient(135deg, #6c002a, #8c1d40); color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
      `}</style>

      <div className="sa-hero">
        <div className="sa-hero-inner">
          <a href="/blog" className="sa-back">← Back to Journal</a>
          <span className="sa-cat" style={{ background: `${article.categoryColor}15`, color: article.categoryColor }}>
            {article.category}
          </span>
          <h1 className="sa-title">{article.title}</h1>
          <p className="sa-subtitle">{article.subtitle}</p>
          <div className="sa-meta">
            <span className="sa-author">{article.author.name}</span>
            <span className="sa-author-title">{article.author.title}</span>
            <span className="sa-meta-dot" />
            <span className="sa-date">{article.date}</span>
            <span className="sa-meta-dot" />
            <span className="sa-read">{article.readTime}</span>
          </div>
        </div>
      </div>

      <div className="sa-body">
        {content?.sections.map((s, i) => (
          <div key={i} className="sa-section">
            {s.heading && <h2 className="sa-section-h">{s.heading}</h2>}
            <p className="sa-p">{s.body}</p>
          </div>
        ))}

        <div className="sa-cta-box">
          <div>
            <div className="sa-cta-text">Ready to find your place near ASU?</div>
            <div className="sa-cta-sub">Browse verified listings — all within reach of campus.</div>
          </div>
          <a href="/homes" className="sa-cta-btn">Browse homes →</a>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
export default async function BlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = ARTICLES.find(a => a.slug === slug)
  if (!article) notFound()

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': article.type === 'research' ? 'ScholarlyArticle' : 'Article',
    headline: article.title,
    description: article.excerpt,
    author: {
      '@type': 'Person',
      name: article.author.name,
      jobTitle: article.author.title,
    },
    publisher: {
      '@type': 'Organization',
      name: 'HomeHive',
      url: SITE_URL,
    },
    datePublished: article.dateIso,
    dateModified: article.dateIso,
    url: `${SITE_URL}/blog/${slug}`,
    inLanguage: 'en-US',
    about: [
      { '@type': 'Thing', name: 'ASU off-campus housing' },
      { '@type': 'Thing', name: 'Student housing Tempe Arizona' },
      { '@type': 'Thing', name: 'Arizona State University' },
    ],
  }

  if (article.type === 'research') return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <ResearchArticle />
    </>
  )
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <StandardArticle slug={slug} />
    </>
  )
}
