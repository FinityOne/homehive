'use client'

import { useState, use } from 'react'
import { homes } from '@/lib/homes'
import { notFound } from 'next/navigation'

const AMENITIES = [
  { icon: '⚡', label: 'High-speed WiFi' },
  { icon: '🧺', label: 'In-unit washer/dryer' },
  { icon: '❄️', label: 'A/C & heat' },
  { icon: '🚗', label: 'Parking included' },
  { icon: '🐾', label: 'Pet friendly' },
  { icon: '🛋️', label: 'Furnished option' },
]

const NEARBY = [
  { place: 'ASU Main Campus', time: '5 min walk' },
  { place: 'Mill Ave Dining', time: '4 min walk' },
  { place: 'Light Rail Stop', time: '3 min walk' },
  { place: 'Target / Groceries', time: '8 min bike' },
]

export default function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ name?: string; msg?: string; from?: string }>
}) {
  const { slug } = use(params)
  const resolvedSearch = use(searchParams)

  const home = homes.find(h => h.slug === slug)
  if (!home) return notFound()

  const guestName = resolvedSearch?.name || ''
  const customMsg = resolvedSearch?.msg || ''
  const fromName = resolvedSearch?.from || 'Mike'
  const isPersonalized = !!guestName

  const nameParts = guestName.trim().split(' ')

  const [activePhoto, setActivePhoto] = useState(0)
  const [formData, setFormData] = useState({
    first_name: nameParts[0] || '',
    last_name: nameParts[1] || '',
    email: '',
    phone: '',
    move_in_date: '',
    budget: '',
    roommate_preference: '',
    lifestyle: '',
    notes: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const canSubmit = formData.first_name.trim() !== '' && formData.email.trim() !== ''

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData }),
      })
      if (res.ok) setSubmitted(true)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f4f0; color: #1a1a1a; }

        .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
        .breadcrumb { font-size: 12px; color: #9b9b9b; margin-bottom: 20px; }
        .breadcrumb a { color: #9b9b9b; text-decoration: none; }
        .breadcrumb a:hover { color: #1a1a1a; }
        .breadcrumb strong { color: #1a1a1a; font-weight: 500; }

        .property-title { font-family: 'DM Serif Display', serif; font-size: 38px; color: #1a1a1a; line-height: 1.15; margin-bottom: 8px; }
        .property-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
        .property-address { font-size: 14px; color: #6b6b6b; display: flex; align-items: center; gap: 4px; }
        .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; letter-spacing: 0.3px; }
        .badge-gold { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .badge-green { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }

        .photo-grid { display: grid; grid-template-columns: 1fr 280px; grid-template-rows: 240px 160px; gap: 8px; margin-bottom: 32px; border-radius: 14px; overflow: hidden; }
        .photo-main { grid-row: 1 / 3; overflow: hidden; cursor: pointer; }
        .photo-main img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s; }
        .photo-main:hover img { transform: scale(1.02); }
        .photo-thumb { overflow: hidden; cursor: pointer; position: relative; }
        .photo-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s; }
        .photo-thumb:hover img { transform: scale(1.04); }
        .photo-count { position: absolute; bottom: 10px; right: 10px; background: rgba(0,0,0,0.6); color: #fff; font-size: 11px; padding: 4px 10px; border-radius: 20px; }

        .content-grid { display: grid; grid-template-columns: 1fr 340px; gap: 32px; align-items: start; }
        .right-col { position: sticky; top: 76px; }

        .section { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; border: 1px solid #e8e5de; }
        .section-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #d4a843; margin-bottom: 14px; }

        .stats-row { display: flex; border: 1px solid #e8e5de; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
        .stat-item { flex: 1; padding: 14px 16px; text-align: center; border-right: 1px solid #e8e5de; }
        .stat-item:last-child { border-right: none; }
        .stat-num { font-family: 'DM Serif Display', serif; font-size: 24px; color: #1a1a1a; }
        .stat-lbl { font-size: 11px; color: #9b9b9b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

        .amenities-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .amenity-item { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #f9f8f5; border-radius: 8px; border: 1px solid #e8e5de; }
        .amenity-icon { font-size: 16px; }
        .amenity-label { font-size: 13px; color: #3a3a3a; }

        .pain-list { display: flex; flex-direction: column; gap: 12px; }
        .pain-item { display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px; background: #f9f8f5; border-radius: 8px; border: 1px solid #e8e5de; }
        .pain-dot { width: 8px; height: 8px; border-radius: 50%; background: #d4a843; flex-shrink: 0; margin-top: 6px; }
        .pain-text { font-size: 14px; color: #3a3a3a; line-height: 1.65; }

        .pricing-row { display: flex; justify-content: space-between; padding: 11px 0; border-bottom: 1px solid #f0ede6; font-size: 14px; }
        .pricing-row:last-of-type { border-bottom: none; }
        .pricing-label { color: #6b6b6b; }
        .pricing-val { font-weight: 500; }
        .pricing-val.green { color: #16a34a; }
        .pricing-total { display: flex; justify-content: space-between; padding-top: 14px; margin-top: 6px; border-top: 2px solid #1a1a1a; font-size: 16px; font-weight: 600; }
        .pricing-note { font-size: 12px; color: #9b9b9b; margin-top: 10px; line-height: 1.5; }

        .map-wrap { border-radius: 10px; overflow: hidden; border: 1px solid #e8e5de; margin-bottom: 14px; }
        .nearby-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .nearby-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f9f8f5; border-radius: 8px; border: 1px solid #e8e5de; }
        .nearby-place { font-size: 13px; color: #3a3a3a; }
        .nearby-time { font-size: 12px; color: #d4a843; font-weight: 500; }

        .testimonial { padding: 18px 20px; background: #f9f8f5; border-radius: 10px; border: 1px solid #e8e5de; border-left: 3px solid #d4a843; margin-bottom: 10px; }
        .testimonial-quote { font-size: 14px; color: #3a3a3a; line-height: 1.65; font-style: italic; margin-bottom: 8px; }
        .testimonial-author { font-size: 12px; color: #9b9b9b; font-weight: 500; }

        .cta-price { font-family: 'DM Serif Display', serif; font-size: 32px; color: #1a1a1a; }
        .cta-price-sub { font-family: 'DM Sans', sans-serif; font-size: 14px; color: #9b9b9b; font-weight: 400; }
        .cta-divider { height: 1px; background: #e8e5de; margin: 16px 0; }
        .cta-features { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
        .cta-feature { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #3a3a3a; }
        .cta-check { width: 16px; height: 16px; border-radius: 50%; background: #dcfce7; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #16a34a; flex-shrink: 0; }
        .cta-btn-primary { width: 100%; padding: 14px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-bottom: 10px; transition: background 0.2s; }
        .cta-btn-primary:hover { background: #333; }
        .cta-btn-secondary { width: 100%; padding: 13px; background: #fff; color: #1a1a1a; border: 1.5px solid #1a1a1a; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .cta-btn-secondary:hover { background: #f9f8f5; }
        .cta-trust { display: flex; justify-content: center; gap: 16px; margin-top: 14px; flex-wrap: wrap; }
        .cta-trust-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #9b9b9b; }
        .cta-trust-dot { width: 5px; height: 5px; border-radius: 50%; background: #d4a843; }

        /* FORM */
        .form-section { background: #fff; border-radius: 12px; padding: 36px; border: 1px solid #e8e5de; margin-top: 32px; }
        .form-header { text-align: center; margin-bottom: 32px; }
        .form-header-title { font-family: 'DM Serif Display', serif; font-size: 30px; color: #1a1a1a; margin-bottom: 8px; }
        .form-header-sub { font-size: 14px; color: #6b6b6b; line-height: 1.6; }
        .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        .form-field { margin-bottom: 14px; }
        .form-label { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #9b9b9b; margin-bottom: 5px; }
        .form-input { width: 100%; padding: 11px 14px; border: 1.5px solid #e8e5de; border-radius: 8px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #fff; outline: none; transition: border-color 0.15s; box-sizing: border-box; }
        .form-input:focus { border-color: #d4a843; }
        .form-input::placeholder { color: #c5c1b8; }

        .roommate-options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .roommate-card { padding: 16px; border: 1.5px solid #e8e5de; border-radius: 10px; cursor: pointer; transition: all 0.15s; background: #fff; }
        .roommate-card:hover { border-color: #d4a843; background: #fefdf9; }
        .roommate-card.selected { border-color: #1a1a1a; background: #f9f8f5; }
        .roommate-card-icon { font-size: 20px; margin-bottom: 6px; }
        .roommate-card-title { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 3px; }
        .roommate-card-sub { font-size: 12px; color: #9b9b9b; line-height: 1.4; }

        .submit-btn { width: 100%; padding: 14px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-top: 8px; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .submit-btn:hover:not(:disabled) { background: #333; }
        .submit-btn:disabled { background: #d1d5db; cursor: not-allowed; }
        .form-trust { display: flex; justify-content: center; gap: 20px; margin-top: 14px; flex-wrap: wrap; }
        .form-trust-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #9b9b9b; }

        .success-state { text-align: center; padding: 56px 24px; }
        .success-icon { width: 64px; height: 64px; border-radius: 50%; background: #dcfce7; border: 2px solid #bbf7d0; display: flex; align-items: center; justify-content: center; font-size: 28px; margin: 0 auto 20px; }
        .success-title { font-family: 'DM Serif Display', serif; font-size: 28px; color: #1a1a1a; margin-bottom: 8px; }
        .success-sub { font-size: 14px; color: #6b6b6b; line-height: 1.6; }

        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }

        @media (max-width: 768px) {
          .content-grid { grid-template-columns: 1fr; }
          .photo-grid { grid-template-columns: 1fr; grid-template-rows: 260px; }
          .photo-thumb { display: none; }
          .photo-main { grid-row: 1; }
          .right-col { position: static; }
          .amenities-grid { grid-template-columns: 1fr 1fr; }
          .form-grid-2 { grid-template-columns: 1fr; }
          .roommate-options { grid-template-columns: 1fr; }
          .property-title { font-size: 28px; }
        }
      `}</style>

      <div className="page">

        {/* PERSONALIZED BANNER */}
        {isPersonalized && (
          <div style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2410 100%)', borderRadius: '14px', padding: '28px 32px', marginBottom: '28px', border: '1px solid #d4a843', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,168,67,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(212,168,67,0.15)', border: '1px solid rgba(212,168,67,0.4)', borderRadius: '20px', padding: '4px 12px', marginBottom: '16px' }}>
              <span style={{ fontSize: '10px', color: '#d4a843', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>✦ Personalized Listing</span>
            </div>
            <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: '26px', color: '#fff', lineHeight: 1.2, marginBottom: '10px' }}>
              {guestName}, we think this home<br />
              <span style={{ color: '#d4a843' }}>was made for you.</span>
            </div>
            <p style={{ fontSize: '14px', color: '#c5c1b8', lineHeight: 1.65, marginBottom: '20px', maxWidth: '520px' }}>
              {customMsg || `We handpicked this listing specifically for you. This is one of our most sought-after homes near ASU — spots fill up fast before semester starts.`}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#d4a843', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
                  {fromName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>{fromName} from HomeHive</div>
                  <div style={{ fontSize: '11px', color: '#9b9b9b' }}>Sent this listing just for you</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(220,252,231,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '20px', padding: '6px 14px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '12px', color: '#86efac', fontWeight: 500 }}>{home.available} rooms available · Move-in flexible</span>
              </div>
            </div>
            <div onClick={() => document.getElementById('interest-form')?.scrollIntoView({ behavior: 'smooth' })} style={{ marginTop: '20px', paddingTop: '18px', borderTop: '1px solid rgba(212,168,67,0.2)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#d4a843', fontWeight: 500 }}>
              <span>Reserve your spot before it's gone</span>
              <span>↓</span>
            </div>
          </div>
        )}

        {/* BREADCRUMB */}
        <div className="breadcrumb">
          <a href="/">HomeHive</a> › <a href="/">Tempe</a> › <strong>{home.name}</strong>
        </div>

        {/* HEADER */}
        <h1 className="property-title">{home.name}</h1>
        <div className="property-meta">
          <div className="property-address"><span style={{ color: '#d4a843' }}>📍</span>{home.address}</div>
          <span className="badge badge-gold">⭐ Sun Devils Approved</span>
          <span className="badge badge-green">{home.available} Room{home.available !== 1 ? 's' : ''} Available</span>
        </div>

        {/* PHOTO GRID */}
        <div className="photo-grid">
          <div className="photo-main">
            <img src={home.images[activePhoto]} alt={home.name} />
          </div>
          <div className="photo-thumb" onClick={() => setActivePhoto(1)}>
            <img src={home.images[1]} alt="Interior" />
          </div>
          <div className="photo-thumb" onClick={() => setActivePhoto(2)} style={{ position: 'relative' }}>
            <img src={home.images[2] || home.images[1]} alt="Kitchen" />
            <div className="photo-count">+{home.images.length - 2} photos</div>
          </div>
        </div>

        {/* TWO COL */}
        <div className="content-grid">

          {/* LEFT */}
          <div>

            <div className="section">
              <div className="section-label">Property Overview</div>
              <div className="stats-row">
                {[[String(home.beds), 'Bedrooms'], [String(home.baths), 'Bathrooms'], [home.sqft, 'Sq Ft'], [home.asuDistance, 'To ASU']].map(([n, l]) => (
                  <div className="stat-item" key={l}>
                    <div className="stat-num">{n}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
              <div className="amenities-grid">
                {AMENITIES.map(a => (
                  <div className="amenity-item" key={a.label}>
                    <span className="amenity-icon">{a.icon}</span>
                    <span className="amenity-label">{a.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-label">Built for ASU Students</div>
              <div className="pain-list">
                {[
                  'Done with Zillow listings that vanish before you can apply? HomeHive is run directly by the homeowner — no middleman, no agency fees, ever.',
                  "Finding roommates you actually like is hard. Tell us about yourself and we'll match you with compatible housemates before you sign anything.",
                  'Move-in dates flex around the ASU academic calendar. Fall and spring availability.',
                ].map((text, i) => (
                  <div className="pain-item" key={i}>
                    <div className="pain-dot" />
                    <p className="pain-text">{text}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-label">Transparent Pricing</div>
              {[
                ['Monthly rent (per room)', `$${home.price}`, false],
                ['Utilities (water, electric, gas)', 'Included', true],
                ['High-speed WiFi', 'Included', true],
                ['Move-in fee', '$0', true],
                ['Broker / agency fee', '$0', true],
                ['Security deposit', `$${home.price} (refundable)`, false],
              ].map(([l, v, g]) => (
                <div className="pricing-row" key={String(l)}>
                  <span className="pricing-label">{l}</span>
                  <span className={`pricing-val${g ? ' green' : ''}`}>{v}</span>
                </div>
              ))}
              <div className="pricing-total">
                <span>Total to move in</span>
                <span>${home.price * 2}</span>
              </div>
              <p className="pricing-note">The price you see is the price you pay. No hidden charges at signing. Deposit fully refunded at move-out.</p>
            </div>

            <div className="section">
              <div className="section-label">Location</div>
              <div className="map-wrap">
                <iframe src={home.mapEmbedUrl} style={{ width: '100%', height: '220px', border: 'none', display: 'block' }} loading="lazy"></iframe>
              </div>
              <div className="nearby-grid">
                {NEARBY.map(n => (
                  <div className="nearby-item" key={n.place}>
                    <span className="nearby-place">{n.place}</span>
                    <span className="nearby-time">{n.time}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-label">What Students Say</div>
              {[
                { q: 'Found my roommates through HomeHive before I even moved in. So much less stressful than scrolling Facebook groups for weeks.', a: 'Sofia M. — ASU Junior, Psychology' },
                { q: 'The price I saw was exactly what I paid. No surprise fees at signing — genuinely the first time that has happened renting near campus.', a: 'Marcus T. — ASU Grad Student, Engineering' },
              ].map(({ q, a }) => (
                <div className="testimonial" key={a}>
                  <p className="testimonial-quote">"{q}"</p>
                  <p className="testimonial-author">— {a}</p>
                </div>
              ))}
            </div>

          </div>

          {/* RIGHT STICKY */}
          <div className="right-col">
            <div className="section">
              <div className="cta-price">${home.price} <span className="cta-price-sub">/ mo per room</span></div>
              <div className="cta-divider" />
              <div className="cta-features">
                {['All utilities included', 'No broker fees', 'Flexible move-in date', 'Roommate matching'].map(f => (
                  <div className="cta-feature" key={f}>
                    <div className="cta-check">✓</div>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
              <button className="cta-btn-primary" onClick={() => document.getElementById('interest-form')?.scrollIntoView({ behavior: 'smooth' })}>
                Express Interest & Apply
              </button>
              <button className="cta-btn-secondary">Schedule a Virtual Tour</button>
              <div className="cta-trust">
                {['No spam', 'No commitment', 'Fast response'].map(t => (
                  <div className="cta-trust-item" key={t}>
                    <div className="cta-trust-dot" />
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section" style={{ background: '#1a1a1a', borderColor: '#333' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#d4a843', marginBottom: '10px' }}>The HomeHive Promise</div>
              <p style={{ fontSize: '13px', color: '#c5c1b8', lineHeight: '1.65' }}>
                We pair you with homes and housemates that fit your life — your schedule, your major, your vibe. No surprises, no runaround.
              </p>
              <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #333', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#d4a843', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>🏠</div>
                <div>
                  <div style={{ fontSize: '12px', color: '#fff', fontWeight: 500 }}>150+ Students Placed</div>
                  <div style={{ fontSize: '11px', color: '#6b6b6b' }}>Near ASU since 2022</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* INTEREST FORM */}
        <div id="interest-form" className="form-section">
          {submitted ? (
            <div className="success-state">
              <div className="success-icon">✓</div>
              <div className="success-title">You're on the list!</div>
              <p style={{ fontSize: '14px', color: '#6b6b6b', lineHeight: 1.6, marginTop: '8px' }}>
                We'll reach out within a few hours to answer your questions and set up a tour if it's a great fit.
              </p>
            </div>
          ) : (
            <>
              <div className="form-header">
                <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#d4a843', marginBottom: '8px' }}>Apply in 2 minutes</div>
                <div className="form-header-title">
                  {isPersonalized ? `${guestName}, secure your spot` : 'Check availability'}
                </div>
                <p className="form-header-sub">No commitment. Just tell us about yourself and we'll reach out shortly.</p>
              </div>

              <div className="form-grid-2">
                <div>
                  <label className="form-label">First Name</label>
                  <input className="form-input" name="first_name" placeholder="Jordan" value={formData.first_name} onChange={handleChange} />
                </div>
                <div>
                  <label className="form-label">Last Name</label>
                  <input className="form-input" name="last_name" placeholder="Lee" value={formData.last_name} onChange={handleChange} />
                </div>
              </div>

              <div className="form-grid-2">
                <div>
                  <label className="form-label">ASU Email</label>
                  <input className="form-input" name="email" type="email" placeholder="jlee@asu.edu" value={formData.email} onChange={handleChange} />
                </div>
                <div>
                  <label className="form-label">Phone Number</label>
                  <input className="form-input" name="phone" placeholder="(480) 000-0000" value={formData.phone} onChange={handleChange} />
                </div>
              </div>

              <div className="form-grid-2">
                <div>
                  <label className="form-label">Expected Move-in</label>
                  <select className="form-input" name="move_in_date" value={formData.move_in_date} onChange={handleChange}>
                    <option value="">Select a date</option>
                    <option>August 2025</option>
                    <option>January 2026</option>
                    <option>Flexible</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Monthly Budget (per room)</label>
                  <select className="form-input" name="budget" value={formData.budget} onChange={handleChange}>
                    <option value="">Select range</option>
                    <option>Under $700</option>
                    <option>$700 – $850</option>
                    <option>$850 – $1,000</option>
                    <option>$1,000+</option>
                  </select>
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Roommate Status</label>
                <div className="roommate-options">
                  {[
                    { val: 'have_roommates', icon: '👥', title: 'I have roommates', sub: "We're a group looking for a place" },
                    { val: 'need_roommates', icon: '🔍', title: "I'm looking alone", sub: 'Help me find compatible roommates' },
                  ].map(opt => (
                    <div
                      key={opt.val}
                      className={`roommate-card${formData.roommate_preference === opt.val ? ' selected' : ''}`}
                      onClick={() => setFormData(prev => ({ ...prev, roommate_preference: opt.val }))}
                    >
                      <div className="roommate-card-icon">{opt.icon}</div>
                      <div className="roommate-card-title">{opt.title}</div>
                      <div className="roommate-card-sub">{opt.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Living Style</label>
                <select className="form-input" name="lifestyle" value={formData.lifestyle} onChange={handleChange}>
                  <option value="">Select your vibe</option>
                  <option>Early riser, quiet household</option>
                  <option>Night owl, social energy</option>
                  <option>Balanced — work hard, chill on weekends</option>
                  <option>Grad student, mostly working</option>
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">Anything else? (optional)</label>
                <textarea
                  className="form-input"
                  name="notes"
                  placeholder="Pet, specific room needs, questions about the property..."
                  value={formData.notes}
                  onChange={handleChange}
                  style={{ height: '80px', resize: 'none' }}
                />
              </div>

              <button
                className="submit-btn"
                onClick={handleSubmit}
                disabled={loading || !canSubmit}
              >
                {loading ? 'Submitting...' : 'Submit & Check Availability →'}
              </button>

              <div className="form-trust">
                {['No spam', 'No commitment', 'Response within hours'].map(t => (
                  <div className="form-trust-item" key={t}>
                    <span className="cta-trust-dot" />
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>
    </>
  )
}
