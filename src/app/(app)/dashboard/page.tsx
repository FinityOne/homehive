'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getProperties, type Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── TYPES ────────────────────────────────────────────────────────────────────
type LeadStatus = 'new' | 'contacted' | 'engaged' | 'qualified' | 'tour_scheduled' | 'closed'

type Lead = {
  id: string
  first_name: string
  email: string
  phone: string | null
  move_in_date: string | null
  property: string | null
  status: LeadStatus
  closed_reason: 'leased' | 'lost' | null
  created_at: string
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string; border: string; icon: string; nextStep: string }> = {
  new:            { label: 'Inquiry Received', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', icon: '📩', nextStep: "We received your inquiry and will be in touch shortly!" },
  contacted:      { label: 'Contacted',        color: '#c9973a', bg: '#fefce8', border: '#fde68a', icon: '📞', nextStep: "We've reached out — check your email or phone for details." },
  engaged:        { label: 'In Conversation',  color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: '💬', nextStep: "You're in active conversation with the team — keep an eye on your messages." },
  qualified:      { label: 'Pre-Qualified',    color: '#166534', bg: '#f0fdf4', border: '#bbf7d0', icon: '✅', nextStep: "You've been pre-qualified! A team member will be reaching out to schedule a tour." },
  tour_scheduled: { label: 'Tour Scheduled',   color: '#8C1D40', bg: '#fdf2f5', border: '#f4c9d5', icon: '📅', nextStep: "Your tour is scheduled — check your email for confirmation details." },
  closed:         { label: 'Closed',           color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb', icon: '🏁', nextStep: "This inquiry has been closed." },
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

function matchProperty(lead: Lead, properties: Property[]): Property | undefined {
  if (!lead.property) return undefined
  const q = lead.property.toLowerCase()
  return properties.find(p =>
    p.slug.toLowerCase() === q ||
    p.name.toLowerCase() === q ||
    p.name.toLowerCase().includes(q) ||
    q.includes(p.name.toLowerCase())
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function TenantDashboard() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Get display name from profiles table, fall back to metadata
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()

      const fullName = profile?.full_name || user.user_metadata?.full_name || ''
      setUserName(fullName.split(' ')[0] || 'there')

      // Fetch user's leads and all properties in parallel
      const [leadsRes, propsRes] = await Promise.all([
        supabase
          .from('leads')
          .select('*')
          .eq('email', user.email!)
          .order('created_at', { ascending: false }),
        getProperties(),
      ])

      setLeads((leadsRes.data as Lead[]) || [])
      setProperties(propsRes)
      setLoading(false)
    }
    load()
  }, [router])

  const upcomingTour = leads.find(l => l.status === 'tour_scheduled')

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  // Properties user has NOT already submitted a lead for
  const inquiredPropertyNames = new Set(leads.map(l => l.property?.toLowerCase()).filter(Boolean))
  const availableHomes = properties.filter(p =>
    p.is_active && p.available > 0 && !inquiredPropertyNames.has(p.name.toLowerCase()) && !inquiredPropertyNames.has(p.slug.toLowerCase())
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .db-wrap { max-width: 680px; margin: 0 auto; padding: 32px 16px 80px; font-family: 'DM Sans', sans-serif; }

        /* ── GREETING ── */
        .greeting-row { margin-bottom: 6px; }
        .greeting-text { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.2; }
        .greeting-sub { font-size: 13px; color: #9b9b9b; margin-top: 5px; }

        /* ── ACTION STRIP ── */
        .action-strip { background: #fff; border: 1px solid #e8e4db; border-left: 3px solid #FFC627; border-radius: 10px; padding: 13px 16px; margin: 20px 0 32px; display: flex; align-items: center; gap: 12px; }
        .action-strip-icon { font-size: 18px; flex-shrink: 0; }
        .action-strip-body { flex: 1; min-width: 0; }
        .action-strip-title { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .action-strip-sub { font-size: 12px; color: #9b9b9b; margin-top: 2px; }
        .action-strip-cta { flex-shrink: 0; background: #8C1D40; color: #fff; border: none; border-radius: 7px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }

        /* ── SECTION ── */
        .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .section-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.8px; }
        .section-link { font-size: 12px; color: #8C1D40; font-weight: 500; text-decoration: none; }
        .section-link:hover { text-decoration: underline; }

        /* ── INQUIRY CARD ── */
        .icard { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; margin-bottom: 10px; }
        .icard-inner { display: flex; flex-direction: column; }
        .icard-img { width: 100%; height: 150px; object-fit: cover; display: block; }
        .icard-img-placeholder { width: 100%; height: 150px; background: linear-gradient(135deg, #fdf2f5 0%, #f5f0eb 100%); display: flex; align-items: center; justify-content: center; font-size: 32px; }
        .icard-body { padding: 14px 16px; }
        .icard-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
        .icard-name { font-size: 14px; font-weight: 600; color: #1a1a1a; line-height: 1.3; }
        .icard-addr { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
        .icard-price { font-size: 15px; font-weight: 700; color: #8C1D40; white-space: nowrap; }
        .icard-price span { font-size: 10px; font-weight: 400; color: #9b9b9b; }
        .icard-meta { font-size: 11px; color: #b0a898; margin-bottom: 8px; }
        .status-pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 20px; padding: 3px 9px; font-size: 11px; font-weight: 600; border: 1px solid; margin-bottom: 9px; }
        .next-step-box { background: #faf9f6; border-left: 3px solid #FFC627; border-radius: 0 7px 7px 0; padding: 9px 12px; font-size: 12px; color: #4a4a4a; line-height: 1.5; }
        .next-step-label { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .icard-actions { display: flex; gap: 8px; margin-top: 11px; }
        .btn-p { flex: 1; background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 9px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-align: center; text-decoration: none; display: block; }
        .btn-s { flex: 1; background: #fff; color: #1a1a1a; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 9px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-align: center; text-decoration: none; display: block; }

        /* ── HOME CARD ── */
        .hcard { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; margin-bottom: 10px; }
        .hcard-img { width: 100%; height: 170px; object-fit: cover; display: block; }
        .hcard-body { padding: 14px 16px; }
        .hcard-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 7px; }
        .hcard-name { font-size: 14px; font-weight: 600; color: #1a1a1a; line-height: 1.3; }
        .hcard-addr { font-size: 11px; color: #9b9b9b; margin-top: 2px; }
        .hcard-price { font-size: 17px; font-weight: 700; color: #8C1D40; white-space: nowrap; }
        .hcard-price span { font-size: 10px; font-weight: 400; color: #9b9b9b; }
        .hcard-stats { display: flex; gap: 12px; margin-bottom: 9px; }
        .hcard-stat { font-size: 11px; color: #6b6b6b; }
        .hcard-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 11px; }
        .hcard-tag { background: #faf9f6; border: 1px solid #e8e4db; border-radius: 20px; padding: 2px 8px; font-size: 10px; color: #4a4a4a; }
        .avail-pill { display: inline-flex; align-items: center; gap: 4px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 20px; padding: 2px 8px; font-size: 10px; color: #166534; font-weight: 600; }
        .avail-dot { width: 5px; height: 5px; border-radius: 50%; background: #16a34a; }

        /* ── DIVIDER ── */
        .section-gap { margin-bottom: 32px; }

        @media (min-width: 560px) {
          .icard-inner { flex-direction: row; }
          .icard-img { width: 140px; height: auto; flex-shrink: 0; }
          .icard-img-placeholder { width: 140px; height: auto; flex-shrink: 0; min-height: 120px; }
          .icard-body { flex: 1; }
          .greeting-text { font-size: 34px; }
        }
      `}</style>

      <div className="db-wrap">

        {/* ── GREETING ── */}
        <div className="greeting-row">
          <div className="greeting-text">{getGreeting(userName)} 👋</div>
          <div className="greeting-sub">
            {leads.length > 0
              ? `You have ${leads.length} active ${leads.length === 1 ? 'inquiry' : 'inquiries'}`
              : 'Start your housing search'}
          </div>
        </div>

        {/* ── ACTION STRIP (only if tour scheduled) ── */}
        {upcomingTour && (() => {
          const prop = matchProperty(upcomingTour, properties)
          return (
            <div className="action-strip">
              <span className="action-strip-icon">📅</span>
              <div className="action-strip-body">
                <div className="action-strip-title">Tour scheduled — {prop?.name || upcomingTour.property || 'your property'}</div>
                <div className="action-strip-sub">Check your email for confirmation details</div>
              </div>
              {prop && <a href={`/homes/${prop.slug}`} className="action-strip-cta">View listing</a>}
            </div>
          )
        })()}

        {/* ── INQUIRIES ── */}
        <div className="section-gap">
          <div className="section-header">
            <span className="section-title">Your inquiries</span>
            <a href="/homes" className="section-link">Browse more →</a>
          </div>

          {leads.length === 0 ? (
            <div style={{ background: '#fff', border: '1px dashed #e8e4db', borderRadius: '14px', padding: '36px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>🏠</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '6px' }}>No inquiries yet</div>
              <div style={{ fontSize: '13px', color: '#9b9b9b', marginBottom: '16px', lineHeight: 1.5 }}>Submit an interest form on any property and it&apos;ll show up here with real-time status updates.</div>
              <a href="/homes" className="btn-p" style={{ display: 'inline-block', width: 'auto', padding: '10px 20px' }}>Browse homes</a>
            </div>
          ) : leads.map(lead => {
            const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new
            const prop = matchProperty(lead, properties)
            const heroImage = prop?.hero_image || (prop?.images?.[0] ?? null)

            return (
              <div key={lead.id} className="icard">
                <div className="icard-inner">
                  {heroImage
                    ? <img src={heroImage} alt={prop?.name || lead.property || 'Property'} className="icard-img" />
                    : <div className="icard-img-placeholder">🏠</div>
                  }
                  <div className="icard-body">
                    <div className="icard-top">
                      <div>
                        <div className="icard-name">{prop?.name || lead.property || 'Property Inquiry'}</div>
                        <div className="icard-addr">{prop?.address || ''}</div>
                      </div>
                      {prop && <div className="icard-price">${prop.price}<span>/mo</span></div>}
                    </div>

                    <div className="icard-meta">Submitted {timeAgo(lead.created_at)}{lead.move_in_date ? ` · Move-in: ${lead.move_in_date}` : ''}</div>

                    <span className="status-pill" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                      {cfg.icon} {cfg.label}
                    </span>

                    {/* {lead.status !== 'closed' && (
                      <div>
                        <div className="next-step-label">What&apos;s next</div>
                        <div className="next-step-box">
                          {lead.status === 'closed' && lead.closed_reason === 'leased'
                            ? '🎉 You leased this property — welcome home!'
                            : lead.status === 'closed' && lead.closed_reason === 'lost'
                            ? 'This inquiry was closed. Browse other available properties below.'
                            : cfg.nextStep}
                        </div>
                      </div>
                    )} */}

                    <div className="icard-actions">
                      {prop
                        ? <a href={`/homes/${prop.slug}`} className="btn-p">View listing</a>
                        : <a href="/homes" className="btn-p">Browse homes</a>
                      }
                      <a
                        href={`mailto:hello@homehive.live?subject=Question about ${encodeURIComponent(prop?.name || lead.property || 'my inquiry')}`}
                        className="btn-s"
                      >
                        Message us
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── AVAILABLE HOMES ── */}
        {availableHomes.length > 0 && (
          <div>
            <div className="section-header">
              <span className="section-title">Available now</span>
              <a href="/homes" className="section-link">See all →</a>
            </div>

            {availableHomes.slice(0, 3).map(home => {
              const heroImage = home.hero_image || home.images?.[0]
              return (
                <div key={home.slug} className="hcard">
                  {heroImage && <img src={heroImage} alt={home.name} className="hcard-img" />}
                  <div className="hcard-body">
                    <div className="hcard-top">
                      <div>
                        <div className="hcard-name">{home.name}</div>
                        <div className="hcard-addr">{home.address}</div>
                      </div>
                      <div className="hcard-price">${home.price}<span>/mo</span></div>
                    </div>

                    <div className="hcard-stats">
                      <span className="hcard-stat">🛏 {home.beds} beds</span>
                      <span className="hcard-stat">🚿 {home.baths} baths</span>
                      {home.asu_distance > 0 && <span className="hcard-stat">📍 {home.asu_distance} mi to ASU</span>}
                    </div>

                    <div className="hcard-tags">
                      <span className="avail-pill"><span className="avail-dot" />{home.available} room{home.available !== 1 ? 's' : ''} left</span>
                      {home.tags.slice(0, 3).map(t => <span key={t} className="hcard-tag">{t}</span>)}
                    </div>

                    <a href={`/homes/${home.slug}`} className="btn-p">View details</a>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── EMPTY STATE when no homes available ── */}
        {availableHomes.length === 0 && leads.length > 0 && (
          <div style={{ textAlign: 'center', padding: '24px 20px', color: '#9b9b9b', fontSize: '13px' }}>
            <div style={{ marginBottom: '6px' }}>You&apos;ve inquired about all our available properties!</div>
            <a href="/homes" className="section-link">View all listings →</a>
          </div>
        )}

      </div>
    </>
  )
}
