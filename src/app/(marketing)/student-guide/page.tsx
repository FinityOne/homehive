'use client'

import { useState, useEffect, useRef } from 'react'

const SECTIONS = [
  { id: 'overview',       label: 'Overview' },
  { id: 'neighborhoods',  label: 'Neighborhoods' },
  { id: 'budgeting',      label: 'Budgeting' },
  { id: 'commuting',      label: 'Commuting' },
  { id: 'roommates',      label: 'Roommates' },
  { id: 'logistics',      label: 'Food & Errands' },
  { id: 'attractions',    label: 'Tempe Life' },
  { id: 'freshman',       label: 'By Year' },
  { id: 'international',  label: 'International' },
  { id: 'checklist',      label: 'Checklist' },
]

export default function StudentGuidePage() {
  const [active, setActive] = useState('overview')
  const [navStuck, setNavStuck] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const onScroll = () => setNavStuck(window.scrollY > 120)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) setActive(entry.target.id)
        })
      },
      { rootMargin: '-20% 0px -70% 0px' }
    )
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observerRef.current?.observe(el)
    })
    return () => observerRef.current?.disconnect()
  }, [])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        /* LAYOUT */
        .guide-wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px 100px; }
        .guide-body { display: grid; grid-template-columns: 200px 1fr; gap: 48px; align-items: start; }

        /* HERO */
        .guide-hero { padding: 56px 0 48px; border-bottom: 1px solid #e8e4db; margin-bottom: 48px; }
        .guide-hero-inner { max-width: 720px; }
        .guide-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: #f0e6cc; color: #92620a; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 20px; }
        .guide-title { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 300; color: #1a1a1a; letter-spacing: -1.5px; line-height: 1.1; margin-bottom: 16px; }
        .guide-title em { font-style: italic; color: #8C1D40; }
        .guide-sub { font-size: 17px; color: #6b6b6b; line-height: 1.75; max-width: 600px; margin-bottom: 24px; }
        .guide-meta { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
        .guide-meta-item { font-size: 12px; color: #9b9b9b; display: flex; align-items: center; gap: 5px; }
        .guide-meta-dot { width: 3px; height: 3px; border-radius: 50%; background: #c9973a; }

        /* STICKY SUBNAV */
        .subnav { position: sticky; top: 68px; display: flex; flex-direction: column; gap: 2px; }
        .subnav-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #c9973a; margin-bottom: 10px; padding: 0 10px; }
        .subnav-link { font-size: 13px; color: #9b9b9b; text-decoration: none; padding: 7px 10px; border-radius: 6px; transition: color 0.15s, background 0.15s; border-left: 2px solid transparent; line-height: 1.3; }
        .subnav-link:hover { color: #1a1a1a; background: #f0ede6; }
        .subnav-link.active { color: #8C1D40; font-weight: 500; border-left-color: #8C1D40; background: #fdf2f5; }

        /* CONTENT */
        .guide-content { min-width: 0; }
        .guide-section { padding-bottom: 64px; border-bottom: 1px solid #e8e4db; margin-bottom: 64px; }
        .guide-section:last-child { border-bottom: none; }

        /* TYPOGRAPHY */
        .s-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #c9973a; margin-bottom: 10px; }
        .s-title { font-family: 'Fraunces', serif; font-size: 34px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.15; margin-bottom: 16px; }
        .s-title em { font-style: italic; }
        .s-lead { font-size: 16px; color: #4a4a4a; line-height: 1.8; margin-bottom: 24px; }
        .s-body { font-size: 14px; color: #4a4a4a; line-height: 1.85; margin-bottom: 16px; }
        .s-body strong { color: #1a1a1a; font-weight: 600; }
        .s-h3 { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 400; color: #1a1a1a; margin: 28px 0 12px; letter-spacing: -0.3px; }
        .s-h3 em { font-style: italic; }

        /* CARDS & CALLOUTS */
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 24px 0; }
        .info-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 20px 22px; }
        .info-card-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 8px; }
        .info-card-body { font-size: 13px; color: #6b6b6b; line-height: 1.65; }
        .info-card-stat { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 300; color: #8C1D40; letter-spacing: -0.5px; margin-bottom: 4px; }

        .callout { background: #fdf2f5; border-left: 3px solid #8C1D40; border-radius: 0 10px 10px 0; padding: 16px 20px; margin: 24px 0; }
        .callout-title { font-size: 13px; font-weight: 700; color: #8C1D40; margin-bottom: 6px; letter-spacing: 0.2px; }
        .callout-body { font-size: 13px; color: #4a4a4a; line-height: 1.65; }

        .tip-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px 20px; margin: 20px 0; }
        .tip-box-label { font-size: 11px; font-weight: 700; color: #166534; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px; }
        .tip-box-body { font-size: 13px; color: #1a4a2e; line-height: 1.65; }

        .warn-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 16px 20px; margin: 20px 0; }
        .warn-box-label { font-size: 11px; font-weight: 700; color: #92400e; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px; }
        .warn-box-body { font-size: 13px; color: #78350f; line-height: 1.65; }

        /* TABLES */
        .data-table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 13px; }
        .data-table th { background: #f5f4f0; color: #6b6b6b; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; padding: 10px 14px; text-align: left; border-bottom: 1px solid #e8e4db; }
        .data-table td { padding: 11px 14px; border-bottom: 1px solid #f0ede6; color: #3a3a3a; line-height: 1.5; vertical-align: top; }
        .data-table tr:last-child td { border-bottom: none; }
        .data-table tr:hover td { background: #faf9f6; }
        .td-highlight { font-weight: 600; color: #8C1D40; }

        /* NEIGHBORHOOD CARDS */
        .hood-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
        .hood-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 22px; transition: border-color 0.2s; }
        .hood-card:hover { border-color: #d4c9b0; }
        .hood-name { font-family: 'Fraunces', serif; font-size: 18px; font-weight: 400; color: #1a1a1a; margin-bottom: 6px; }
        .hood-tag { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; padding: 2px 8px; border-radius: 20px; margin-bottom: 10px; }
        .hood-tag.best-value { background: #dcfce7; color: #166534; }
        .hood-tag.most-popular { background: #fdf2f5; color: #8C1D40; }
        .hood-tag.quieter { background: #e0f2fe; color: #0369a1; }
        .hood-tag.walkable { background: #fef9c3; color: #854d0e; }
        .hood-body { font-size: 13px; color: #6b6b6b; line-height: 1.65; margin-bottom: 12px; }
        .hood-stats { display: flex; gap: 16px; flex-wrap: wrap; }
        .hood-stat { font-size: 12px; color: #9b9b9b; }
        .hood-stat strong { color: #1a1a1a; font-weight: 600; }

        /* CHECKLIST */
        .checklist { display: flex; flex-direction: column; gap: 6px; margin: 20px 0; }
        .check-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; background: #fff; border: 1px solid #e8e4db; border-radius: 8px; font-size: 13px; color: #3a3a3a; line-height: 1.5; }
        .check-box { width: 18px; height: 18px; border: 1.5px solid #d4c9b0; border-radius: 4px; flex-shrink: 0; margin-top: 1px; }

        /* PLACES LIST */
        .places-list { display: flex; flex-direction: column; gap: 0; border: 1px solid #e8e4db; border-radius: 12px; overflow: hidden; margin: 20px 0; }
        .place-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 13px 16px; border-bottom: 1px solid #f0ede6; font-size: 13px; }
        .place-row:last-child { border-bottom: none; }
        .place-row:hover { background: #faf9f6; }
        .place-name { font-weight: 500; color: #1a1a1a; }
        .place-detail { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .place-dist { font-size: 12px; color: #6b6b6b; white-space: nowrap; }
        .place-time { font-size: 12px; font-weight: 600; color: #8C1D40; white-space: nowrap; text-align: right; }

        /* CTA INLINE */
        .inline-cta { background: #1a1a1a; border-radius: 12px; padding: 28px 32px; margin: 32px 0; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
        .inline-cta-text { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 300; color: #fff; line-height: 1.25; }
        .inline-cta-text em { font-style: italic; color: #FFC627; }
        .inline-cta-btn { background: #FFC627; color: #1a1a1a; padding: 11px 22px; border-radius: 7px; font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap; font-family: 'DM Sans', sans-serif; flex-shrink: 0; }
        .inline-cta-btn:hover { background: #e6b320; }

        @media (max-width: 860px) {
          .guide-body { grid-template-columns: 1fr; }
          .subnav { position: static; flex-direction: row; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; margin-bottom: 32px; border-bottom: 1px solid #e8e4db; }
          .subnav-label { display: none; }
          .subnav-link { white-space: nowrap; border-left: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; }
          .subnav-link.active { border-left: none; border-bottom-color: #8C1D40; background: none; }
          .info-grid { grid-template-columns: 1fr; }
          .hood-grid { grid-template-columns: 1fr; }
          .guide-title { font-size: 34px; }
          .s-title { font-size: 26px; }
        }
      `}</style>

      <div className="guide-wrap">

        {/* HERO */}
        <div className="guide-hero">
          <div className="guide-hero-inner">
            <div className="guide-eyebrow">ASU Off-Campus Housing Guide 2026–2027</div>
            <h1 className="guide-title">The complete guide to living<br />off-campus near <em>ASU.</em></h1>
            <p className="guide-sub">Everything you need to know about finding, affording, and thriving in off-campus housing near Arizona State University in Tempe. Written for freshmen, seniors, grad students, and international students alike.</p>
            <div className="guide-meta">
              <span className="guide-meta-item"><span className="guide-meta-dot" />Updated March 2026</span>
              <span className="guide-meta-item"><span className="guide-meta-dot" />25 min read</span>
              <span className="guide-meta-item"><span className="guide-meta-dot" />Tempe, AZ</span>
              <span className="guide-meta-item"><span className="guide-meta-dot" />ASU Tempe Campus</span>
            </div>
          </div>
        </div>

        <div className="guide-body">

          {/* SUBNAV */}
          <nav className="subnav">
            <div className="subnav-label">On this page</div>
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`} className={`subnav-link${active === s.id ? ' active' : ''}`}>{s.label}</a>
            ))}
          </nav>

          {/* CONTENT */}
          <div className="guide-content">

            {/* ── OVERVIEW ── */}
            <section id="overview" className="guide-section">
              <div className="s-eyebrow">Why off-campus housing</div>
              <h2 className="s-title">Off-campus vs. on-campus:<br /><em>what you need to know.</em></h2>
              <p className="s-lead">Arizona State University's Tempe campus is surrounded by one of the most active off-campus housing markets in the country. With over 80,000 students across four metro campuses, the demand for housing near ASU is enormous — which means you need to know exactly what you're looking for before you start searching.</p>
              <p className="s-body">On-campus housing at ASU averages <strong>$1,100–$1,600 per month</strong> for a shared room in a residence hall. Off-campus housing near campus ranges from <strong>$599–$900 per room per month</strong>, depending on the neighborhood, the number of bedrooms, and what's included. For most students, moving off-campus after freshman year is one of the smartest financial decisions they can make.</p>
              <p className="s-body">Beyond price, off-campus living gives you control over your environment — who you live with, what your kitchen looks like, whether you have a backyard, and what your commute looks like. It's the first real taste of independence for most students, and getting it right makes a significant difference in your overall college experience.</p>

              <div className="info-grid">
                <div className="info-card">
                  <div className="info-card-stat">~$400</div>
                  <div className="info-card-title">Monthly savings</div>
                  <div className="info-card-body">Average monthly savings when moving from on-campus to an off-campus shared house near ASU's Tempe campus.</div>
                </div>
                <div className="info-card">
                  <div className="info-card-stat">0.2–1.5mi</div>
                  <div className="info-card-title">Distance to campus</div>
                  <div className="info-card-body">Most popular off-campus neighborhoods are within a 5–20 minute walk, bike, or light rail ride to ASU's main Tempe campus.</div>
                </div>
                <div className="info-card">
                  <div className="info-card-stat">6–8 wks</div>
                  <div className="info-card-title">How far ahead to search</div>
                  <div className="info-card-body">The best rooms near ASU go 6–8 weeks before each semester starts. Start your search in June for fall and November for spring.</div>
                </div>
                <div className="info-card">
                  <div className="info-card-stat">3–6 people</div>
                  <div className="info-card-title">Typical group size</div>
                  <div className="info-card-body">Most off-campus houses near ASU are 3–6 bedrooms. Groups of friends sharing a full house get the best value per person.</div>
                </div>
              </div>

              <div className="callout">
                <div className="callout-title">The biggest mistake ASU students make</div>
                <div className="callout-body">Starting their search too late. By the time most students begin looking in July for fall move-in, the best homes near campus are already gone. The students who land great housing start in May or early June, sometimes earlier for the most sought-after streets.</div>
              </div>
            </section>

            {/* ── NEIGHBORHOODS ── */}
            <section id="neighborhoods" className="guide-section">
              <div className="s-eyebrow">Where to live near ASU Tempe</div>
              <h2 className="s-title">Neighborhoods near ASU:<br /><em>a honest breakdown.</em></h2>
              <p className="s-lead">Tempe is a walkable, bikeable city built around ASU. Different neighborhoods suit different students — here's what actually matters when choosing where to live.</p>

              <div className="hood-grid">
                <div className="hood-card">
                  <div className="hood-name">University Drive Corridor</div>
                  <span className="hood-tag most-popular">Most popular</span>
                  <p className="hood-body">The strip between University Drive and 9th Street, running east-west near campus. This is the heart of ASU's off-campus scene. You're within a 5–10 minute walk to most academic buildings. Mill Avenue is right there. The light rail runs through it. Expect higher prices for this proximity but the walkability is unmatched.</p>
                  <div className="hood-stats">
                    <span className="hood-stat">Walk to ASU: <strong>5–12 min</strong></span>
                    <span className="hood-stat">Avg rent: <strong>$700–$900/mo</strong></span>
                    <span className="hood-stat">Best for: <strong>Freshmen, social students</strong></span>
                  </div>
                </div>

                <div className="hood-card">
                  <div className="hood-name">South Tempe / Del Rio</div>
                  <span className="hood-tag best-value">Best value</span>
                  <p className="hood-body">Streets like Del Rio Drive and South Hardy offer significantly more space for the money. You're 1–1.5 miles from campus — an easy bike ride or quick bus trip on the 72 line. You get larger homes, backyards, and quieter streets. Perfect for groups who want a full house without paying premium near-campus prices.</p>
                  <div className="hood-stats">
                    <span className="hood-stat">Walk to ASU: <strong>20–30 min</strong></span>
                    <span className="hood-stat">Avg rent: <strong>$550–$750/mo</strong></span>
                    <span className="hood-stat">Best for: <strong>Groups, value seekers</strong></span>
                  </div>
                </div>

                <div className="hood-card">
                  <div className="hood-name">Apache Boulevard</div>
                  <span className="hood-tag walkable">Light rail access</span>
                  <p className="hood-body">Running east from campus along Apache, this corridor has strong light rail access and a mix of older single-family homes and newer apartments. Diverse, affordable, and well-connected. The 72 bus and light rail make campus commutes straightforward. Closer to Tempe Marketplace for groceries and errands.</p>
                  <div className="hood-stats">
                    <span className="hood-stat">Light rail: <strong>2–4 stops</strong></span>
                    <span className="hood-stat">Avg rent: <strong>$600–$800/mo</strong></span>
                    <span className="hood-stat">Best for: <strong>Transit-dependent students</strong></span>
                  </div>
                </div>

                <div className="hood-card">
                  <div className="hood-name">Kyrene / Warner Area</div>
                  <span className="hood-tag quieter">Quieter</span>
                  <p className="hood-body">Further south in Tempe, this area has newer housing stock and is much quieter. Better for graduate students, PhD candidates, or students with families who want a residential feel over a college-town atmosphere. You'll need a car or reliable bike — it's a 2+ mile commute to campus. Grocery stores and restaurants are plentiful nearby.</p>
                  <div className="hood-stats">
                    <span className="hood-stat">Drive to ASU: <strong>10–15 min</strong></span>
                    <span className="hood-stat">Avg rent: <strong>$800–$1,100/mo</strong></span>
                    <span className="hood-stat">Best for: <strong>Grad students, families</strong></span>
                  </div>
                </div>
              </div>

              <div className="tip-box">
                <div className="tip-box-label">Pro tip — look at specific streets</div>
                <div className="tip-box-body">The best off-campus streets for ASU students are W 9th Street, W 8th Street, W University Drive, S Hardy Drive, S College Avenue, and E Apache Blvd. Walking distance on these streets is real — not "walkable" in the real estate sense, but actually a 5–8 minute walk to class. Pull up Google Maps and measure before you commit.</div>
              </div>
            </section>

            {/* ── BUDGETING ── */}
            <section id="budgeting" className="guide-section">
              <div className="s-eyebrow">Understanding the real cost</div>
              <h2 className="s-title">Budgeting for off-campus<br /><em>housing in Tempe.</em></h2>
              <p className="s-lead">Rent is only one part of what you'll pay. Here's a complete breakdown of what living off-campus near ASU actually costs, so there are no surprises after you sign.</p>

              <h3 className="s-h3">Monthly cost breakdown</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Low estimate</th>
                    <th>High estimate</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="td-highlight">Rent (per room)</td><td>$599</td><td>$950</td><td>Shared house near ASU Tempe</td></tr>
                  <tr><td>Electricity</td><td>$40</td><td>$120</td><td>Highly variable — A/C in summer is expensive</td></tr>
                  <tr><td>Water & gas</td><td>$20</td><td>$50</td><td>Usually split among housemates</td></tr>
                  <tr><td>WiFi / internet</td><td>$0</td><td>$35</td><td>Many houses include WiFi in rent</td></tr>
                  <tr><td>Groceries</td><td>$200</td><td>$400</td><td>Depends heavily on cooking habits</td></tr>
                  <tr><td>Transportation</td><td>$0</td><td>$150</td><td>Free if walking/biking; ASU bus pass available</td></tr>
                  <tr><td>Renters insurance</td><td>$12</td><td>$20</td><td>Highly recommended, cheap to get</td></tr>
                  <tr><td className="td-highlight">Total estimate</td><td className="td-highlight">$871</td><td className="td-highlight">$1,725</td><td>Per person per month</td></tr>
                </tbody>
              </table>

              <div className="warn-box">
                <div className="warn-box-label">Arizona summers and your electric bill</div>
                <div className="warn-box-body">This is the number one surprise for students who move to Tempe. Summer temperatures regularly hit 110°F, and running A/C continuously can push a single person's electricity share to $80–$120 per month in June, July, and August. Ask your landlord for last year's summer utility bills before you sign. If the home has newer A/C units and good insulation, you'll pay significantly less.</div>
              </div>

              <h3 className="s-h3">Security deposits and move-in costs</h3>
              <p className="s-body">Most landlords near ASU require a <strong>security deposit equal to one month's rent</strong>, paid upfront before you move in. On a $699/mo room, that's $699 out of pocket before your first month's rent. Some landlords also charge first and last month's rent upfront, which can make move-in day expensive.</p>
              <p className="s-body">At HomeHive, our listed homes charge <strong>one month's deposit only — no first and last, no broker fee, no move-in processing charge</strong>. Always ask what the total cost to move in is before you agree to anything.</p>

              <div className="tip-box">
                <div className="tip-box-label">How to protect your security deposit</div>
                <div className="tip-box-body">On the day you move in, photograph every room in detail — walls, floors, appliances, bathroom tile, any existing damage. Send those photos to your landlord in writing the same day. This protects you when you move out. Without documentation, landlords can claim damage that existed before you arrived.</div>
              </div>

              <div className="inline-cta">
                <div className="inline-cta-text">HomeHive homes start at <em>$599/mo</em> with $0 broker fees.</div>
                <a href="/homes" className="inline-cta-btn">View available homes</a>
              </div>
            </section>

            {/* ── COMMUTING ── */}
            <section id="commuting" className="guide-section">
              <div className="s-eyebrow">Getting around Tempe</div>
              <h2 className="s-title">Commuting to ASU:<br /><em>every option explained.</em></h2>
              <p className="s-lead">One of Tempe's best qualities as a college town is how many ways there are to get to campus without a car. Here's every commute option, honestly rated for ASU students.</p>

              <h3 className="s-h3">Walking</h3>
              <p className="s-body">If you're within 0.5 miles of campus, walking is the obvious choice. The streets immediately north, south, and west of ASU's main campus are genuinely walkable — 8–15 minutes on foot to most academic buildings. The route along University Drive and College Avenue are well-lit and heavily trafficked by students.</p>
              <p className="s-body"><strong>Best for:</strong> Students who want to sleep in, avoid parking, and stay close to Mill Ave. The premium for these streets is real — expect to pay $50–$150 more per month — but many students find it worth it for the lifestyle.</p>

              <h3 className="s-h3">Biking</h3>
              <p className="s-body">Tempe has an excellent network of bike lanes, and cycling is arguably the best commute option for students within 1.5 miles of campus. A 1-mile bike ride takes about 5–7 minutes. The flat terrain makes it accessible even if you haven't been on a bike in years.</p>
              <p className="s-body">ASU has secure bike parking at most buildings. A decent commuter bike costs $150–$300 new, or you can find used bikes on Facebook Marketplace for $50–$100. Lock it well — bike theft near campus is common. Use a U-lock through the frame and wheel.</p>
              <p className="s-body"><strong>Best streets for biking:</strong> S College Avenue, Mill Ave Bike Path, Rural Road, University Drive bike lane. Avoid biking on Apache Blvd — heavy traffic and fewer protected lanes.</p>

              <h3 className="s-h3">Light Rail (Valley Metro Rail)</h3>
              <p className="s-body">The Valley Metro light rail runs directly through Tempe with several stops near or on ASU's campus. The most relevant stops for students are <strong>Mill Ave / 3rd St</strong> (right at the heart of campus), <strong>University Dr / Rural Rd</strong> (east side of campus), and <strong>Dorsey / Apache Blvd</strong>.</p>
              <p className="s-body">A day pass is $4; a monthly pass is $64. ASU students can get a subsidized Upass — check with the Dean of Students office for current pricing, as this changes each year. Light rail is fully air-conditioned, runs every 12 minutes during peak hours, and connects Tempe to Phoenix and Mesa.</p>

              <table className="data-table">
                <thead>
                  <tr><th>Station</th><th>Distance from ASU center</th><th>Walk to center</th><th>Neighborhoods served</th></tr>
                </thead>
                <tbody>
                  <tr><td className="td-highlight">Mill Ave / 3rd St</td><td>0.1 mi</td><td>2 min</td><td>University Drive, W 9th, W 8th</td></tr>
                  <tr><td>University Dr / Rural Rd</td><td>0.6 mi</td><td>12 min</td><td>East of campus, Apache Blvd (east)</td></tr>
                  <tr><td>Dorsey / Apache Blvd</td><td>0.8 mi</td><td>16 min</td><td>Apache corridor, south Tempe</td></tr>
                  <tr><td>Tempe Transportation Center</td><td>1.4 mi</td><td>28 min</td><td>North Tempe, Tempe Town Lake area</td></tr>
                </tbody>
              </table>

              <h3 className="s-h3">Bus (Valley Metro)</h3>
              <p className="s-body">Several bus routes connect off-campus neighborhoods to ASU. The <strong>Route 72</strong> (Apache Blvd) and <strong>Route 66</strong> (University Dr) are the most useful. Buses run every 15–30 minutes. The ASU Shuttle also runs free point-to-point service within the campus area.</p>

              <h3 className="s-h3">Driving and parking</h3>
              <p className="s-body">Driving to campus is the least recommended option for most students. ASU parking permits cost <strong>$350–$600 per semester</strong> depending on the lot. Street parking near campus is heavily enforced with 2-hour limits during the day. If you live more than 2 miles away and have a car, driving is practical — but factor the permit cost into your housing budget.</p>

              <div className="callout">
                <div className="callout-title">Tempe's heat and your commute choice</div>
                <div className="callout-body">Walking or biking in August in Tempe is genuinely brutal at midday — temperatures regularly exceed 105°F. This is a real factor in choosing how close to campus you want to live. Students who live within a 10-minute walk can handle the heat. Students who live 25 minutes away on foot often switch to the bus in summer months.</div>
              </div>
            </section>

            {/* ── ROOMMATES ── */}
            <section id="roommates" className="guide-section">
              <div className="s-eyebrow">Living with other people</div>
              <h2 className="s-title">Finding and living with<br /><em>roommates at ASU.</em></h2>
              <p className="s-lead">Your roommates will significantly shape your off-campus experience — for better or worse. Here's how to find compatible people, set expectations early, and handle the inevitable friction.</p>

              <h3 className="s-h3">Where ASU students find roommates</h3>
              <p className="s-body">Most students use Facebook groups, Craigslist, or random roommate-matching apps with mixed results. The problem with these platforms is there's no vetting, no context, and no accountability. You're essentially cold-messaging strangers with no shared context.</p>
              <p className="s-body">HomeHive's roommate matching pairs you with people in the same home or looking for the same type of living situation, with shared preferences around lifestyle, sleep schedule, and academic workload. Before anyone signs a lease, you've already had a conversation with your potential housemates.</p>

              <h3 className="s-h3">Questions to ask before agreeing to live together</h3>
              <table className="data-table">
                <thead><tr><th>Category</th><th>Questions worth asking</th></tr></thead>
                <tbody>
                  <tr><td>Schedule</td><td>Are you an early riser or night owl? Do you study at home or go to the library?</td></tr>
                  <tr><td>Cleanliness</td><td>How often do you clean? What's your standard for a clean kitchen and bathroom?</td></tr>
                  <tr><td>Guests</td><td>How often do you have people over? Overnight guests?</td></tr>
                  <tr><td>Noise</td><td>Do you listen to music out loud? Work on zoom calls at home? Play video games late?</td></tr>
                  <tr><td>Bills</td><td>How do you want to split utilities? Venmo monthly, or one person manages and others pay?</td></tr>
                  <tr><td>Shared items</td><td>Are you okay sharing food? Kitchen supplies? Do you expect repayment for shared items?</td></tr>
                </tbody>
              </table>

              <div className="tip-box">
                <div className="tip-box-label">Write a roommate agreement — even with friends</div>
                <div className="tip-box-body">A simple written agreement about cleaning rotations, quiet hours, guest policies, and how bills are split prevents 90% of roommate conflicts. It doesn't need to be formal. A shared Google Doc works fine. Having the conversation before you move in is what matters — not the document itself.</div>
              </div>

              <h3 className="s-h3">Groups taking a whole house</h3>
              <p className="s-body">If you already have 3–6 friends who want to live together, renting a whole house is almost always better value than renting individual rooms in different apartments. You control who you live with, you share common spaces, and you often pay less per person than in a shared apartment complex.</p>
              <p className="s-body">At HomeHive, both of our current homes can be taken in their entirety by a group — a 5-bedroom and a 6-bedroom. Groups of this size moving in together as a unit tend to have the best experience, because everyone already knows and has agreed to live with each other.</p>

              <div className="inline-cta">
                <div className="inline-cta-text">Need roommates? <em>We match you before you sign.</em></div>
                <a href="/roommates" className="inline-cta-btn">Find roommates</a>
              </div>
            </section>

            {/* ── LOGISTICS ── */}
            <section id="logistics" className="guide-section">
              <div className="s-eyebrow">Food, groceries, and errands</div>
              <h2 className="s-title">Everything near campus:<br /><em>the practical guide.</em></h2>
              <p className="s-lead">Living off-campus means figuring out groceries, food, laundry, and day-to-day logistics for the first time. Here's everything within reach of ASU's Tempe campus.</p>

              <h3 className="s-h3">Chipotle locations near ASU</h3>
              <div className="places-list">
                <div className="place-row">
                  <div>
                    <div className="place-name">Chipotle — Mill Avenue</div>
                    <div className="place-detail">807 S Mill Ave, Tempe — right on the main strip near campus</div>
                  </div>
                  <div className="place-dist">0.4 mi from ASU</div>
                  <div className="place-time">8 min walk</div>
                </div>
                <div className="place-row">
                  <div>
                    <div className="place-name">Chipotle — University Drive</div>
                    <div className="place-detail">1435 E University Dr, Tempe — east of campus near Rural Rd</div>
                  </div>
                  <div className="place-dist">0.9 mi from ASU</div>
                  <div className="place-time">5 min bike</div>
                </div>
                <div className="place-row">
                  <div>
                    <div className="place-name">Chipotle — Tempe Marketplace</div>
                    <div className="place-detail">2000 E Rio Salado Pkwy, Tempe — inside the outdoor mall</div>
                  </div>
                  <div className="place-dist">2.1 mi from ASU</div>
                  <div className="place-time">10 min bike / light rail</div>
                </div>
              </div>

              <h3 className="s-h3">Grocery stores</h3>
              <div className="places-list">
                <div className="place-row">
                  <div>
                    <div className="place-name">Trader Joe's</div>
                    <div className="place-detail">1911 N McClintock Dr, Tempe — best value for the quality near campus</div>
                  </div>
                  <div className="place-dist">1.6 mi from ASU</div>
                  <div className="place-time">10 min bike</div>
                </div>
                <div className="place-row">
                  <div>
                    <div className="place-name">Fry's Food Stores (Kroger)</div>
                    <div className="place-detail">1416 E Southern Ave, Tempe — large selection, good for bulk shopping</div>
                  </div>
                  <div className="place-dist">1.8 mi from ASU</div>
                  <div className="place-time">8 min drive / 15 min bike</div>
                </div>
                <div className="place-row">
                  <div>
                    <div className="place-name">Walmart Supercenter</div>
                    <div className="place-detail">1325 W Elliot Rd, Tempe — for household items, supplies, bulk</div>
                  </div>
                  <div className="place-dist">2.4 mi from ASU</div>
                  <div className="place-time">10 min drive</div>
                </div>
                <div className="place-row">
                  <div>
                    <div className="place-name">Whole Foods Market</div>
                    <div className="place-detail">2605 W Camelback Rd, Phoenix — worth it if you're near the light rail north line</div>
                  </div>
                  <div className="place-dist">5.2 mi from ASU</div>
                  <div className="place-time">Light rail</div>
                </div>
                <div className="place-row">
                  <div>
                    <div className="place-name">Target</div>
                    <div className="place-detail">4011 S McClintock Dr, Tempe — best for move-in essentials and dorm supplies</div>
                  </div>
                  <div className="place-dist">1.9 mi from ASU</div>
                  <div className="place-time">10 min drive / 15 min bike</div>
                </div>
              </div>

              <h3 className="s-h3">Dining on and around Mill Avenue</h3>
              <p className="s-body">Mill Avenue is the main student dining and nightlife corridor running north-south through Tempe. Within a 10-minute walk from campus you'll find every price point — from $4 street tacos to sit-down restaurants and everything in between.</p>
              <p className="s-body"><strong>Notable spots students frequent:</strong> Four Peaks Brewery (ASU institution), House of Tricks (for special occasions), Culinary Dropout (Farmer Arts District), Changing Hands Bookstore with a coffee bar, Za'atar (Mediterranean, great for dietary restrictions), and the many taco trucks on Apache.</p>

              <h3 className="s-h3">Laundry</h3>
              <p className="s-body">Most single-family houses near ASU include a washer and dryer. If your house doesn't, the nearest laundromats are on Apache Blvd and S McClintock Drive. Factor this into your housing decision — hauling laundry gets old quickly, and houses with in-unit laundry command a small premium that's usually worth it.</p>
            </section>

            {/* ── ATTRACTIONS ── */}
            <section id="attractions" className="guide-section">
              <div className="s-eyebrow">Life in Tempe</div>
              <h2 className="s-title">Tempe beyond the classroom:<br /><em>what's actually here.</em></h2>
              <p className="s-lead">Tempe is a genuinely excellent college town. Here's what makes it worth living in, not just studying in.</p>

              <h3 className="s-h3">Hayden Butte — "A Mountain"</h3>
              <p className="s-body"><strong>Location: S. College Ave & W. University Dr, Tempe.</strong> The "A Mountain" (officially Hayden Butte) is Tempe's most iconic landmark — a small volcanic butte with a giant "A" painted near the summit, repainted by freshmen each year as a tradition. The trail to the top takes about 20 minutes and gives you a panoramic view of the entire Valley including ASU's campus. Sunrise and sunset hikes are popular. It's free, open daily, and a genuine Tempe rite of passage. Distance from campus: 0.4 miles.</p>

              <h3 className="s-h3">Tempe Town Lake</h3>
              <p className="s-body">A 2-mile-long reservoir on the Salt River, right north of campus. You can kayak, paddleboard, run the paved loop, or just sit on the bank. The ASU rowing team trains here. Tempe Beach Park on the south shore has events, food trucks, and concerts throughout the year. It's genuinely peaceful — one of the better spots in the metro area to clear your head.</p>

              <h3 className="s-h3">Papago Park</h3>
              <p className="s-body">Just 3 miles from ASU, Papago Park is a remarkable urban park with red sandstone buttes, desert trails, and the Phoenix Zoo. The Hole-in-the-Rock formation gives you a framed view of the city from an elevated position. Phoenix Botanical Garden is adjacent. Worth visiting at least once per semester.</p>

              <h3 className="s-h3">Sun Devil Stadium and ASU sports culture</h3>
              <p className="s-body">ASU's athletic culture is a significant part of campus life. Football games at Sun Devil Stadium (which neighbors the main academic core) create a communal energy unlike most campuses. Student tickets are subsidized and sell out for big games. Basketball at Desert Financial Arena is more intimate and underrated.</p>

              <h3 className="s-h3">Mill Avenue and Old Town Scottsdale</h3>
              <p className="s-body">Mill Avenue runs through the heart of Tempe and is walking distance from campus. Old Town Scottsdale — a more upscale dining and nightlife district — is about 5 miles east and easily reached by Lyft or the 72 bus extended. Between the two, you have essentially every restaurant, bar, and entertainment option within reach.</p>

              <h3 className="s-h3">Desert recreation</h3>
              <p className="s-body">One of the underrated aspects of living in Tempe is access to desert hiking. South Mountain Park (the largest municipal park in the US), Camelback Mountain, and the McDowell Sonoran Preserve are all within 20–40 minutes. If you have a car or a friend with one, Arizona's landscape becomes accessible — Sedona is 2 hours, the Grand Canyon 3.5 hours, Flagstaff's ski area is 2.5 hours.</p>
            </section>

            {/* ── BY YEAR ── */}
            <section id="freshman" className="guide-section">
              <div className="s-eyebrow">Housing by stage</div>
              <h2 className="s-title">Housing advice for every<br /><em>year at ASU.</em></h2>

              <h3 className="s-h3">Freshman year</h3>
              <p className="s-body">ASU strongly recommends (and in some programs, requires) freshmen to live on campus for their first year. If you're a freshman, on-campus housing gives you built-in community, proximity to orientation activities, and an easier social start. The cost premium is real but the social infrastructure is genuinely useful for the first year.</p>
              <p className="s-body">If you're a freshman looking to move off-campus anyway, <strong>the key is starting the search early in spring semester</strong> for the following fall — and finding at least one other person to search with. Living with a stranger is fine; having a friend you've already met makes the transition easier.</p>

              <h3 className="s-h3">Sophomore and junior year</h3>
              <p className="s-body">This is when most ASU students make the switch to off-campus housing. You've established friend groups, you know the area, and the savings are significant. A group of 4–5 people moving into a house together is the most popular and cost-effective scenario. Start looking in April or May for fall move-in. The best houses are gone by late June.</p>
              <p className="s-body">At this stage, <strong>location matters most</strong>. You know which buildings your classes are in. Map your housing options relative to where you spend 80% of your academic time, not just "near campus" in the abstract.</p>

              <h3 className="s-h3">Senior year</h3>
              <p className="s-body">Senior year often involves more group work, internships, and varied schedules — which changes what you want from housing. Proximity to campus matters less if you're in an internship three days a week. Proximity to freeways or light rail may matter more. Many seniors prefer a quieter house over a lively one as they gear up for job applications and post-grad planning.</p>

              <h3 className="s-h3">Graduate students</h3>
              <p className="s-body">Graduate students are often overlooked in off-campus housing conversations — most resources assume an 18–22-year-old undergrad. If you're a grad student at ASU, your priorities are typically different: you want quieter housemates, more consistent schedules, proximity to your department building rather than undergrad buildings, and a stable lease rather than a semester-to-semester setup.</p>
              <p className="s-body">South Tempe neighborhoods work well for grad students — slightly removed from the undergrad social scene, good value, and easy access to campus by bike or car. HomeHive homes are a good fit for grad students who want the affordability of shared housing without the chaos of a party house.</p>

              <div className="callout">
                <div className="callout-title">A note on lease timing for grad students</div>
                <div className="callout-body">Grad school doesn't follow the same August-to-May rhythm as undergrad. If you're starting in January or in a non-standard cohort, ask landlords about flexible start dates. Many off-campus landlords near ASU accommodate mid-semester starts, especially for 12-month leases.</div>
              </div>
            </section>

            {/* ── INTERNATIONAL ── */}
            <section id="international" className="guide-section">
              <div className="s-eyebrow">For international students</div>
              <h2 className="s-title">Off-campus housing for<br /><em>international students at ASU.</em></h2>
              <p className="s-lead">Finding housing from abroad, dealing with documentation requirements, and navigating the US rental market for the first time are genuinely challenging. Here's what international students at ASU need to know.</p>

              <h3 className="s-h3">The documentation challenge</h3>
              <p className="s-body">Most US landlords ask for a Social Security Number (SSN), US credit history, and proof of income to rent an apartment. International students on F-1 visas often don't have any of these when they first arrive. This locks them out of the standard application process at many apartment complexes.</p>
              <p className="s-body"><strong>What actually works:</strong> Private landlords (like those on HomeHive) are significantly more flexible than apartment management companies. Many will accept a larger security deposit, a letter from ASU confirming enrollment, proof of international funds, or a co-signer in lieu of a credit check. The key is communicating this upfront — most private landlords will work with you if you're transparent about your situation.</p>

              <h3 className="s-h3">Arriving before your housing is confirmed</h3>
              <p className="s-body">If you're arriving to Tempe without confirmed housing, your short-term options are: ASU's international student residence halls, extended-stay hotels near campus (Residence Inn on Rio Salado is frequently used), or Airbnb for the first 1–2 weeks while you view properties in person.</p>
              <p className="s-body">Never sign a lease for a property you haven't seen in person or via a live video tour. Rental scams specifically targeting international students who can't visit in advance are common. Any landlord unwilling to do a live video walkthrough should be avoided.</p>

              <h3 className="s-h3">Cultural and practical adjustments</h3>
              <p className="s-body">A few practical notes for international students new to Tempe specifically: <strong>The heat is not theoretical.</strong> 110°F in August feels nothing like what most international students expect. Plan your move-in for early morning, bring water everywhere, and do not underestimate how much A/C affects your comfort and your budget.</p>
              <p className="s-body">Tempe is exceptionally diverse — ASU's international student population is one of the largest in the US. You will find community, food, and cultural familiarity relatively easily compared to smaller college towns. The area around Apache Blvd has a particularly diverse food scene including South Asian, Middle Eastern, Mexican, and East Asian restaurants within a few miles of campus.</p>

              <div className="tip-box">
                <div className="tip-box-label">Resources for international students at ASU</div>
                <div className="tip-box-body">ASU's International Students and Scholars office (iss.asu.edu) has housing resources specifically for international students including temporary housing referrals, legal rights guides, and connections to student groups by country of origin. Their housing workshops at the start of each semester are worth attending even if you already have housing arranged — they cover tenant rights, scam identification, and utility setup that most domestic students take for granted.</div>
              </div>

              <h3 className="s-h3">Building US credit as an international student</h3>
              <p className="s-body">Paying rent on time is one of the fastest ways to start building a US credit history. Ask your landlord if they report rent payments to credit bureaus, or use a service like Experian RentBureau or RentTrack to self-report. Starting to build credit in your first year has compounding benefits by the time you're looking for housing or financing after graduation.</p>
            </section>

            {/* ── CHECKLIST ── */}
            <section id="checklist" className="guide-section">
              <div className="s-eyebrow">Before you sign anything</div>
              <h2 className="s-title">The complete move-in<br /><em>checklist for ASU students.</em></h2>
              <p className="s-lead">Use this list before signing a lease, on move-in day, and when setting up your new place. Print it out or save it to your phone.</p>

              <h3 className="s-h3">Before signing the lease</h3>
              <div className="checklist">
                {[
                  'Verify the landlord owns the property (ask for the deed or property tax records if needed)',
                  'Ask for last 3 months of utility bills to understand actual costs including summer A/C',
                  'Confirm the total move-in cost: first month, deposit, any fees — in writing',
                  'Read the full lease before signing — pay attention to lease break penalties, subletting rules, and guest policies',
                  'Clarify who is responsible for repairs and how maintenance requests are submitted',
                  'Ask whether utilities are included or separately metered',
                  'Confirm move-in and lease end dates align with your academic calendar',
                  'Ask about renewing or month-to-month options at lease end',
                  'If taking the whole house as a group, confirm all roommates are on the lease or understand the implications if they aren\'t',
                ].map((item, i) => (
                  <div className="check-item" key={i}>
                    <div className="check-box" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <h3 className="s-h3">Move-in day</h3>
              <div className="checklist">
                {[
                  'Photograph every room thoroughly — walls, floors, ceilings, appliances, fixtures — before unpacking anything',
                  'Send dated photos to your landlord in writing (email or text) the same day',
                  'Test every appliance, window lock, door lock, and faucet',
                  'Note the condition of the A/C unit — this is critical in Arizona',
                  'Locate the breaker box, water shutoff valve, and A/C filter location',
                  'Get the WiFi password and confirm it works throughout the house',
                  'Confirm where mail is delivered and how packages are handled',
                  'Get your landlord\'s contact info and preferred method for maintenance requests',
                  'Confirm garbage and recycling collection days',
                  'Set up renters insurance — takes 10 minutes online and costs ~$15/month',
                ].map((item, i) => (
                  <div className="check-item" key={i}>
                    <div className="check-box" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <h3 className="s-h3">First month setup</h3>
              <div className="checklist">
                {[
                  'Set up a system for splitting utilities — Splitwise is free and works well for groups',
                  'Establish cleaning expectations with housemates in writing (even a basic shared note works)',
                  'Register your address with ASU\'s registrar if you want mail at your new address',
                  'Change your address with any subscriptions, bank, and Arizona DMV if you have a car',
                  'Buy a quality bike lock if you\'re commuting by bike — U-lock through frame and wheel',
                  'Locate the nearest urgent care and pharmacy to your address',
                  'Download the Valley Metro app for real-time light rail and bus schedules',
                ].map((item, i) => (
                  <div className="check-item" key={i}>
                    <div className="check-box" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {/* FINAL CTA */}
              <div style={{ background: '#8C1D40', borderRadius: '16px', padding: '40px 36px', marginTop: '40px', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: '30px', fontWeight: 300, color: '#fff', letterSpacing: '-0.5px', marginBottom: '10px', lineHeight: 1.2 }}>
                  Ready to find your home<br /><em style={{ fontStyle: 'italic', color: '#FFC627' }}>near ASU?</em>
                </div>
                <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, maxWidth: '420px', margin: '0 auto 28px' }}>
                  Browse verified off-campus homes near ASU's Tempe campus. Transparent pricing, zero broker fees, and roommate matching included — free for students, always.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <a href="/homes" style={{ background: '#FFC627', color: '#8C1D40', padding: '13px 28px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>Browse available homes</a>
                  <a href="/roommates" style={{ color: 'rgba(255,255,255,0.8)', padding: '13px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 500, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.25)' }}>Find roommates</a>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </>
  )
}
