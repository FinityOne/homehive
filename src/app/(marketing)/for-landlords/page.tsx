import { createSupabaseServerClient } from '@/lib/supabase-server'

export const metadata = {
  title: 'List Your Place on HomeHive — Free for Landlords Near ASU',
  description: 'Stop fighting for attention on Zillow and Facebook. HomeHive connects landlords with pre-vetted ASU students. Free forever for the first 100 landlords.',
}

async function getListingCount(): Promise<number> {
  const supabase = await createSupabaseServerClient()
  const { count } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
  return count ?? 0
}

export default async function ForLandlordsPage() {
  const listingCount = await getListingCount()
  const spotsLeft = Math.max(0, 100 - listingCount)
  const pct = Math.min(100, (listingCount / 100) * 100)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; color: #1a1a1a; }

        .wrap { max-width: 1000px; margin: 0 auto; padding: 0 24px; }
        .section { padding: 72px 0; }
        .section + .section { border-top: 1px solid #e8e4db; }

        /* HERO */
        .hero { padding: 80px 0 72px; text-align: center; }
        .hero-label { display: inline-flex; align-items: center; gap: 7px; background: #f0fdf4; color: #166534; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 5px 12px; border-radius: 20px; margin-bottom: 24px; border: 1px solid #bbf7d0; }
        .hero-h1 { font-family: 'Fraunces', serif; font-size: 54px; font-weight: 300; line-height: 1.08; letter-spacing: -1.5px; color: #1a1a1a; margin-bottom: 20px; max-width: 720px; margin-left: auto; margin-right: auto; }
        .hero-h1 em { font-style: italic; color: #8C1D40; }
        .hero-sub { font-size: 17px; color: #6b6b6b; line-height: 1.7; max-width: 520px; margin: 0 auto 36px; }
        .hero-cta-row { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
        .btn-primary { display: inline-block; background: #8C1D40; color: #fff; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .btn-primary:hover { background: #7a1835; }
        .btn-ghost { display: inline-block; color: #6b6b6b; padding: 14px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; text-decoration: none; transition: color 0.15s; }
        .btn-ghost:hover { color: #1a1a1a; }

        /* PAIN POINTS */
        .pain-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .pain-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 24px; }
        .pain-platform { font-size: 11px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 8px; }
        .pain-problem { font-size: 14px; color: #1a1a1a; line-height: 1.6; }
        .pain-strike { text-decoration: line-through; color: #9b9b9b; }
        .pain-vs { text-align: center; font-size: 13px; font-weight: 600; color: #8C1D40; margin: 28px 0 20px; }
        .hive-card { background: #8C1D40; border-radius: 14px; padding: 24px 28px; color: #fff; }
        .hive-card-title { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 300; margin-bottom: 12px; letter-spacing: -0.3px; }
        .hive-points { display: flex; flex-direction: column; gap: 8px; }
        .hive-pt { font-size: 14px; display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
        .hive-check { color: #FFC627; flex-shrink: 0; font-weight: 700; margin-top: 1px; }

        /* HOW IT WORKS */
        .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9b9b9b; margin-bottom: 10px; }
        .section-h2 { font-family: 'Fraunces', serif; font-size: 38px; font-weight: 300; letter-spacing: -0.8px; color: #1a1a1a; margin-bottom: 10px; }
        .section-sub { font-size: 15px; color: #6b6b6b; line-height: 1.7; margin-bottom: 40px; max-width: 520px; }
        .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .step-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 24px; position: relative; }
        .step-num { font-family: 'Fraunces', serif; font-size: 40px; font-weight: 300; color: #e8e4db; letter-spacing: -1px; line-height: 1; margin-bottom: 12px; }
        .step-title { font-size: 15px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
        .step-desc { font-size: 13px; color: #6b6b6b; line-height: 1.6; }

        /* LISTING TYPES */
        .type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        .type-card { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; padding: 24px; }
        .type-icon { font-size: 28px; margin-bottom: 12px; }
        .type-title { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 6px; }
        .type-desc { font-size: 13px; color: #6b6b6b; line-height: 1.6; margin-bottom: 12px; }
        .type-tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 20px; background: #fdf2f5; color: #8C1D40; border: 1px solid #f5c6d0; }

        /* PRICING */
        .pricing-card { background: #fff; border: 2px solid #8C1D40; border-radius: 20px; padding: 40px; max-width: 560px; margin: 0 auto; text-align: center; }
        .pricing-badge { display: inline-block; background: #8C1D40; color: #FFC627; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; padding: 4px 12px; border-radius: 20px; margin-bottom: 20px; }
        .pricing-price { font-family: 'Fraunces', serif; font-size: 64px; font-weight: 300; color: #1a1a1a; letter-spacing: -3px; line-height: 1; margin-bottom: 4px; }
        .pricing-price-sub { font-size: 14px; color: #9b9b9b; margin-bottom: 24px; }
        .pricing-features { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; text-align: left; }
        .pricing-feat { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #1a1a1a; }
        .feat-check { width: 20px; height: 20px; border-radius: 50%; background: #f0fdf4; border: 1px solid #bbf7d0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #166534; flex-shrink: 0; }
        .counter-wrap { background: #faf9f6; border: 1px solid #e8e4db; border-radius: 12px; padding: 16px 20px; margin-bottom: 28px; }
        .counter-label { font-size: 12px; color: #9b9b9b; margin-bottom: 8px; }
        .counter-bar-track { height: 8px; background: #e8e4db; border-radius: 10px; overflow: hidden; margin-bottom: 8px; }
        .counter-bar-fill { height: 100%; background: #8C1D40; border-radius: 10px; transition: width 1s ease; }
        .counter-nums { display: flex; justify-content: space-between; font-size: 12px; }
        .counter-taken { font-weight: 600; color: #8C1D40; }
        .counter-left { color: #9b9b9b; }
        .pricing-future { font-size: 12px; color: '#9b9b9b'; }

        /* BOTTOM CTA */
        .bottom-cta { background: #1a1a1a; border-radius: 20px; padding: 56px 40px; text-align: center; margin: 0 0 80px; }
        .bottom-cta-h2 { font-family: 'Fraunces', serif; font-size: 38px; font-weight: 300; color: #fff; letter-spacing: -0.8px; margin-bottom: 12px; }
        .bottom-cta-h2 em { font-style: italic; color: #FFC627; }
        .bottom-cta-sub { font-size: 15px; color: rgba(255,255,255,0.6); margin-bottom: 32px; }
        .btn-gold { display: inline-block; background: #FFC627; color: #1a1a1a; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .btn-gold:hover { background: #f0b820; }

        @media (max-width: 768px) {
          .hero-h1 { font-size: 38px; letter-spacing: -1px; }
          .pain-grid { grid-template-columns: 1fr; }
          .steps { grid-template-columns: 1fr; }
          .type-grid { grid-template-columns: 1fr; }
          .bottom-cta { padding: 40px 24px; }
          .bottom-cta-h2 { font-size: 28px; }
          .section-h2 { font-size: 28px; }
          .hero { padding: 48px 0 40px; }
        }
      `}</style>

      {/* HERO */}
      <div className="hero">
        <div className="wrap">
          <div className="hero-label">🏠 For Landlords &amp; Subleasing Students</div>
          <h1 className="hero-h1">
            Your listing, not lost in the<br /><em>Facebook jungle.</em>
          </h1>
          <p className="hero-sub">
            Skip Zillow fees and the endless scroll of Marketplace posts. HomeHive puts your listing in front of pre-vetted ASU students actively looking for housing — no noise, no scams.
          </p>
          <div className="hero-cta-row">
            <a href="/landlord/signup" className="btn-primary">List for free →</a>
            <a href="#how-it-works" className="btn-ghost">See how it works ↓</a>
          </div>
        </div>
      </div>

      {/* PAIN POINTS */}
      <div className="section">
        <div className="wrap">
          <div className="section-label">The problem</div>
          <div className="section-h2">Every other platform is working against you.</div>
          <div className="section-sub">You post, cross your fingers, and compete with 200 other listings. Meanwhile students can't tell real offers from scams.</div>

          <div className="pain-grid">
            <div className="pain-card">
              <div className="pain-platform">Zillow / Redfin</div>
              <p className="pain-problem"><span className="pain-strike">$30–$300/month</span> per listing. You're buried under paid ads. No student-specific filters. Leads are unvetted and low quality.</p>
            </div>
            <div className="pain-card">
              <div className="pain-platform">Facebook Marketplace</div>
              <p className="pain-problem"><span className="pain-strike">Unlimited scam reports.</span> Your listing drowns in the feed within hours. Responding to 50 low-quality DMs wastes your weekend.</p>
            </div>
            <div className="pain-card">
              <div className="pain-platform">Craigslist</div>
              <p className="pain-problem"><span className="pain-strike">Zero vetting.</span> Ghosting is the norm. No way to pre-screen tenants, no trust signals, no structured workflow.</p>
            </div>
          </div>

          <div className="pain-vs">vs.</div>

          <div className="hive-card">
            <div className="hive-card-title">HomeHive is built for this exact market.</div>
            <div className="hive-points">
              <div className="hive-pt"><span className="hive-check">✓</span> ASU students only — filtered, verified, actively searching near Tempe</div>
              <div className="hive-pt"><span className="hive-check">✓</span> Built-in lead pre-screening so you only talk to serious prospects</div>
              <div className="hive-pt"><span className="hive-check">✓</span> Your own landlord dashboard — leads, tenants, and leases in one place</div>
              <div className="hive-pt"><span className="hive-check">✓</span> $0 broker fees, ever. Free during beta, locked-in for early landlords.</div>
            </div>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="section" id="how-it-works">
        <div className="wrap">
          <div className="section-label">How it works</div>
          <div className="section-h2">Live in 5 minutes.</div>
          <div className="section-sub">No lengthy approval process. No forms that feel like tax returns. Just a simple flow that gets you in front of students fast.</div>

          <div className="steps">
            <div className="step-card">
              <div className="step-num">01</div>
              <div className="step-title">Create your account</div>
              <div className="step-desc">First name, email, phone, password. That's it. Your landlord dashboard is ready immediately.</div>
            </div>
            <div className="step-card">
              <div className="step-num">02</div>
              <div className="step-title">Create your listing</div>
              <div className="step-desc">Walk through our 6-step guided wizard. Select listing type, describe your space, set your price, and add photos. No experience needed.</div>
            </div>
            <div className="step-card">
              <div className="step-num">03</div>
              <div className="step-title">Get vetted leads</div>
              <div className="step-desc">Students apply directly. Pre-screen answers (budget, lifestyle, move-in date) arrive in your inbox before you spend a minute talking.</div>
            </div>
          </div>
        </div>
      </div>

      {/* LISTING TYPES */}
      <div className="section">
        <div className="wrap">
          <div className="section-label">Listing types</div>
          <div className="section-h2">Whatever your situation, we've got the right type.</div>
          <div className="section-sub">Not everyone listing on HomeHive is a traditional landlord — and that's exactly the point.</div>

          <div className="type-grid">
            <div className="type-card">
              <div className="type-icon">🏠</div>
              <div className="type-title">Standard Rental</div>
              <div className="type-desc">You own or manage a property and want to rent a room or the whole unit to a student. Standard lease, your rules.</div>
              <span className="type-tag">Owner / Manager</span>
            </div>
            <div className="type-card">
              <div className="type-icon">✈️</div>
              <div className="type-title">Sublease</div>
              <div className="type-desc">You're a current tenant heading out for a summer or semester. Find a subletter who takes your spot temporarily while you keep your lease.</div>
              <span className="type-tag">Current tenant</span>
            </div>
            <div className="type-card">
              <div className="type-icon">🤝</div>
              <div className="type-title">Lease Transfer</div>
              <div className="type-desc">You want out of your lease entirely. Find someone to take over your lease from a specific date — clean handoff, no penalties.</div>
              <span className="type-tag">Current tenant</span>
            </div>
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div className="section">
        <div className="wrap">
          <div className="section-label">Pricing</div>
          <div className="section-h2">Free now. Locked in for early adopters.</div>
          <div className="section-sub">We're in beta and growing fast. The first 100 landlords get free access permanently — even after we introduce pricing.</div>

          <div className="pricing-card">
            <div className="pricing-badge">Beta pricing</div>
            <div className="pricing-price">$0</div>
            <div className="pricing-price-sub">per month, forever for early landlords</div>

            <div className="pricing-features">
              {['Unlimited listing views', 'Lead pre-screening included', 'Full landlord dashboard', 'Leads, tenants & leases CRM', 'Photo uploads & listing management', 'Priority support during beta'].map(f => (
                <div key={f} className="pricing-feat">
                  <div className="feat-check">✓</div>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            <div className="counter-wrap">
              <div className="counter-label">Free spots claimed out of first 100</div>
              <div className="counter-bar-track">
                <div className="counter-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="counter-nums">
                <span className="counter-taken">{listingCount} claimed</span>
                <span className="counter-left">{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</span>
              </div>
            </div>

            <a href="/landlord/signup" className="btn-primary" style={{ display: 'block', textAlign: 'center' }}>
              Claim your free spot →
            </a>
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#9b9b9b' }}>
              After 100 listings: plans starting at $29/mo. Early landlords never pay.
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM CTA */}
      <div className="wrap">
        <div className="bottom-cta">
          <div className="bottom-cta-h2">Your next tenant is already<br /><em>searching on HomeHive.</em></div>
          <div className="bottom-cta-sub">It takes 5 minutes to list. The students are ready. All that's missing is you.</div>
          <a href="/landlord/signup" className="btn-gold">Get started free →</a>
        </div>
      </div>
    </>
  )
}
