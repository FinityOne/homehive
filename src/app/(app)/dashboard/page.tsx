'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getProperties, type Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

type TourRecord = {
  id: string
  lead_id: string
  property_slug: string
  scheduled_date: string
  time_slot: string
  custom_note: string | null
  status: string
}

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
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTourTime(slot: string): string {
  const [h, m] = slot.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function getTourCountdown(dateStr: string): { label: string; urgent: boolean } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tour = new Date(dateStr + 'T00:00:00')
  const diff = Math.round((tour.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return { label: 'Today!', urgent: true }
  if (diff === 1) return { label: 'Tomorrow', urgent: true }
  if (diff < 0) return { label: 'Recently passed', urgent: false }
  return { label: `In ${diff} days`, urgent: diff <= 3 }
}

function DashboardInner() {
  const router = useRouter()

  const [userName, setUserName]     = useState('')
  const [userRole, setUserRole]     = useState('tenant')
  const [leads, setLeads]           = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [upcomingTourData, setUpcomingTourData] = useState<TourRecord | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [profileRes, leadsRes, propsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, role').eq('id', user.id).single(),
        supabase.from('leads').select('*').eq('email', user.email!).order('created_at', { ascending: false }),
        getProperties(),
      ])

      const fullName = profileRes.data?.full_name || user.user_metadata?.full_name || ''
      setUserName(fullName.split(' ')[0] || 'there')
      setUserRole(profileRes.data?.role || 'tenant')
      const fetchedLeads = (leadsRes.data as Lead[]) || []
      setLeads(fetchedLeads)
      setProperties(propsRes)

      // Fetch confirmed tour for any tour_scheduled lead
      const tourLead = fetchedLeads.find(l => l.status === 'tour_scheduled')
      if (tourLead) {
        const { data: tourRow } = await supabase
          .from('tours')
          .select('*')
          .eq('lead_id', tourLead.id)
          .eq('status', 'confirmed')
          .maybeSingle()
        if (tourRow) setUpcomingTourData(tourRow as TourRecord)
      }

      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  const inquiredSlugs = new Set(leads.map(l => l.property?.toLowerCase()).filter(Boolean))
  const recommendations = properties.filter(p =>
    p.is_active && p.available > 0 &&
    !inquiredSlugs.has(p.name.toLowerCase()) &&
    !inquiredSlugs.has(p.slug.toLowerCase())
  ).slice(0, 2)

  const upcomingTourLead = leads.find(l => l.status === 'tour_scheduled')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .db { max-width: 600px; margin: 0 auto; padding: 28px 16px 72px; font-family: 'DM Sans', sans-serif; }

        .db-greeting { font-family: 'Fraunces', serif; font-size: 27px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.4px; line-height: 1.2; margin-bottom: 3px; }
        .db-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 24px; }

        /* ── TOUR CARD ── */
        .tour-card {
          background: linear-gradient(135deg, #1a1a1a 0%, #2d1520 100%);
          border-radius: 16px; padding: 20px; margin-bottom: 24px;
          position: relative; overflow: hidden;
        }
        .tour-card::before {
          content: ''; position: absolute; top: -30px; right: -30px;
          width: 120px; height: 120px; border-radius: 50%;
          background: rgba(255,198,39,0.08);
        }
        .tour-card-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #FFC627; margin-bottom: 10px; }
        .tour-card-title { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -0.3px; margin-bottom: 4px; line-height: 1.2; }
        .tour-card-sub { font-size: 13px; color: rgba(255,255,255,0.55); margin-bottom: 16px; }
        .tour-card-details { background: rgba(255,255,255,0.08); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
        .tour-card-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: rgba(255,255,255,0.85); margin-bottom: 6px; }
        .tour-card-row:last-child { margin-bottom: 0; }
        .tour-card-row strong { color: #fff; }
        .tour-card-countdown {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px;
          margin-bottom: 16px;
        }
        .tour-card-cta {
          display: inline-block; background: #FFC627; color: #1a1a1a;
          text-decoration: none; font-size: 13px; font-weight: 700;
          padding: 10px 20px; border-radius: 10px;
        }
        .tour-card-note {
          margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);
          font-size: 12px; color: rgba(255,255,255,0.5); font-style: italic; line-height: 1.5;
        }

        /* ── SECTION LABEL ── */
        .sec-label { font-size: 10px; font-weight: 700; color: #b0a898; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; }
        .sec-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .sec-link { font-size: 12px; color: #8C1D40; font-weight: 500; text-decoration: none; }
        .sec-link:hover { text-decoration: underline; }

        /* ── INQUIRY CARD ── */
        .icard {
          display: flex; align-items: stretch;
          background: #fff; border: 1px solid #e8e4db; border-radius: 12px;
          overflow: hidden; margin-bottom: 8px; text-decoration: none;
          transition: border-color 0.12s, box-shadow 0.12s;
        }
        .icard:hover { border-color: #d0ccc4; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
        .icard-thumb {
          width: 88px; flex-shrink: 0; object-fit: cover; display: block;
        }
        .icard-thumb-ph {
          width: 88px; flex-shrink: 0;
          background: linear-gradient(135deg, #fdf2f5, #f5f0eb);
          display: flex; align-items: center; justify-content: center; font-size: 20px;
        }
        .icard-body { flex: 1; min-width: 0; padding: 11px 13px; }
        .icard-name { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .icard-addr { font-size: 11px; color: #9b9b9b; margin-bottom: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .icard-status { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #6b6b6b; }
        .icard-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .icard-right { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding: 11px 13px 11px 0; gap: 5px; }
        .icard-price { font-size: 13px; font-weight: 700; color: #8C1D40; }
        .icard-price span { font-size: 10px; font-weight: 400; color: #9b9b9b; }
        .icard-date { font-size: 10px; color: #b0a898; }
        .icard-arrow { font-size: 15px; color: #d0ccc4; }

        /* ── EMPTY STATE ── */
        .empty { background: #fff; border: 1px dashed #e8e4db; border-radius: 12px; padding: 32px 20px; text-align: center; margin-bottom: 28px; }
        .empty-icon  { font-size: 26px; margin-bottom: 8px; }
        .empty-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 5px; }
        .empty-sub   { font-size: 13px; color: #9b9b9b; line-height: 1.5; margin-bottom: 16px; }
        .btn-p { display: inline-flex; align-items: center; background: #8C1D40; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; }

        /* ── RECOMMENDED ── */
        .rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 28px; }
        .rec-card { background: #fff; border: 1px solid #e8e4db; border-radius: 10px; overflow: hidden; text-decoration: none; display: block; transition: border-color 0.12s, box-shadow 0.12s; }
        .rec-card:hover { border-color: #d0ccc4; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .rec-img { width: 100%; height: 88px; object-fit: cover; display: block; }
        .rec-img-ph { width: 100%; height: 88px; background: linear-gradient(135deg,#fdf2f5,#f5f0eb); display: flex; align-items: center; justify-content: center; font-size: 22px; }
        .rec-body { padding: 10px 11px 11px; }
        .rec-name { font-size: 12px; font-weight: 600; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
        .rec-addr { font-size: 10px; color: #b0a898; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
        .rec-price { font-size: 13px; font-weight: 700; color: #8C1D40; }
        .rec-price span { font-size: 10px; font-weight: 400; color: #9b9b9b; }
        .rec-stats { font-size: 10px; color: #9b9b9b; margin-top: 2px; }

        /* ── LIST BANNER ── */
        .list-banner {
          display: flex; align-items: center; gap: 12px;
          background: linear-gradient(135deg, #1a1a1a 0%, #2d1a0e 100%);
          border-radius: 12px; padding: 14px 16px;
        }
        .list-banner-body { flex: 1; min-width: 0; }
        .list-banner-title { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 2px; }
        .list-banner-sub   { font-size: 11px; color: rgba(255,255,255,0.5); }
        .list-banner-cta   { flex-shrink: 0; background: #FFC627; color: #1a1a1a; border: none; border-radius: 7px; padding: 7px 13px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; text-decoration: none; }

        /* ── LANDLORD CONGRATS ── */
        .congrats-strip { display: flex; align-items: center; gap: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 14px; margin-bottom: 24px; }
        .congrats-link { flex-shrink: 0; background: #16a34a; color: #fff; border: none; border-radius: 7px; padding: 7px 13px; font-size: 12px; font-weight: 600; text-decoration: none; white-space: nowrap; }

        @media (max-width: 400px) {
          .rec-grid { grid-template-columns: 1fr; }
          .icard-thumb, .icard-thumb-ph { width: 72px; }
        }
      `}</style>

      <div className="db">

        {/* ── GREETING ── */}
        <div className="db-greeting">{getGreeting(userName)}</div>
        <div className="db-sub">
          {leads.length > 0
            ? `${leads.length} active ${leads.length === 1 ? 'inquiry' : 'inquiries'}`
            : 'Find your next place near ASU'}
        </div>

        {/* ── TOUR CARD ── */}
        {upcomingTourLead && upcomingTourData && (() => {
          const prop = matchProperty(upcomingTourLead, properties)
          const countdown = getTourCountdown(upcomingTourData.scheduled_date)
          const tourDate = new Date(upcomingTourData.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
          })
          return (
            <div className="tour-card">
              <div className="tour-card-label">📅 Upcoming Tour</div>
              <div className="tour-card-title">{prop?.name || upcomingTourLead.property}</div>
              {prop?.address && <div className="tour-card-sub">📍 {prop.address}</div>}

              <div className="tour-card-countdown" style={{
                background: countdown.urgent ? 'rgba(255,198,39,0.2)' : 'rgba(255,255,255,0.1)',
                color: countdown.urgent ? '#FFC627' : 'rgba(255,255,255,0.7)',
                border: countdown.urgent ? '1px solid rgba(255,198,39,0.4)' : '1px solid rgba(255,255,255,0.15)',
              }}>
                {countdown.urgent ? '🔥' : '🗓'} {countdown.label}
              </div>

              <div className="tour-card-details">
                <div className="tour-card-row">
                  <span style={{ fontSize: 14 }}>📆</span>
                  <span><strong>{tourDate}</strong></span>
                </div>
                <div className="tour-card-row">
                  <span style={{ fontSize: 14 }}>⏰</span>
                  <span><strong>{formatTourTime(upcomingTourData.time_slot)}</strong> · 30 minutes</span>
                </div>
                {prop?.address && (
                  <div className="tour-card-row">
                    <span style={{ fontSize: 14 }}>📍</span>
                    <span>{prop.address}</span>
                  </div>
                )}
              </div>

              {prop && (
                <a href={`/homes/${prop.slug}`} className="tour-card-cta">
                  View Property →
                </a>
              )}

              {upcomingTourData.custom_note && (
                <div className="tour-card-note">
                  Note from host: "{upcomingTourData.custom_note}"
                </div>
              )}
            </div>
          )
        })()}

        {/* ── LANDLORD CONGRATS (if already approved) ── */}
        {userRole === 'landlord' && (
          <div className="congrats-strip">
            <span style={{ fontSize: 16, flexShrink: 0 }}>🎉</span>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#166534' }}>
              You&apos;re approved as a landlord
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 1 }}>List properties and manage leads from your portal</div>
            </div>
            <a href="/landlord/dashboard" className="congrats-link">Go to portal →</a>
          </div>
        )}

        {/* ── INQUIRIES ── */}
        <div className="sec-row">
          <div className="sec-label" style={{ margin: 0 }}>Your inquiries</div>
          <a href="/homes" className="sec-link">Browse more →</a>
        </div>

        {leads.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🏠</div>
            <div className="empty-title">No inquiries yet</div>
            <div className="empty-sub">Browse listings and submit an interest form — it&apos;ll show up here with live status updates.</div>
            <a href="/homes" className="btn-p">Browse homes</a>
          </div>
        ) : (
          <div style={{ marginBottom: 28 }}>
            {leads.map(lead => {
              const isClosed = lead.status === 'closed'
              const prop     = matchProperty(lead, properties)
              const href     = prop ? `/homes/${prop.slug}` : '/homes'
              const thumb    = prop?.images?.[0] ?? null
              const address  = prop?.address || lead.property || ''

              return (
                <a key={lead.id} href={href} className="icard">
                  {thumb
                    ? <img src={thumb} alt={prop?.name || ''} className="icard-thumb" />
                    : <div className="icard-thumb-ph">🏠</div>
                  }
                  <div className="icard-body">
                    <div className="icard-name">{prop?.name || lead.property || 'Property Inquiry'}</div>
                    <div className="icard-addr">{address}</div>
                    <div className="icard-status">
                      <span className="icard-dot" style={{ background: isClosed ? '#d1d5db' : '#FFC627' }} />
                      {isClosed ? 'Closed' : 'Pending Review'}
                    </div>
                  </div>
                  <div className="icard-right">
                    {prop && <div className="icard-price">${prop.price}<span>/mo</span></div>}
                    <div className="icard-date">{timeAgo(lead.created_at)}</div>
                    <div className="icard-arrow">›</div>
                  </div>
                </a>
              )
            })}
          </div>
        )}

        {/* ── RECOMMENDED ── */}
        {recommendations.length > 0 && (
          <>
            <div className="sec-row">
              <div className="sec-label" style={{ margin: 0 }}>Recommended for you</div>
              <a href="/homes" className="sec-link">See all →</a>
            </div>
            <div className="rec-grid">
              {recommendations.map(home => (
                <a key={home.slug} href={`/homes/${home.slug}`} className="rec-card">
                  {home.images?.[0]
                    ? <img src={home.images[0]} alt={home.name} className="rec-img" />
                    : <div className="rec-img-ph">🏠</div>
                  }
                  <div className="rec-body">
                    <div className="rec-name">{home.name}</div>
                    <div className="rec-addr">{home.address}</div>
                    <div className="rec-price">${home.price}<span>/mo</span></div>
                    <div className="rec-stats">{home.beds}bd · {home.baths}ba{home.asu_distance > 0 ? ` · ${home.asu_distance}mi` : ''}</div>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}

        {/* ── LIST YOUR PLACE BANNER ── */}
        {userRole !== 'landlord' && (
          <a href="/dashboard/list" className="list-banner" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>🏠</span>
            <div className="list-banner-body">
              <div className="list-banner-title">Have a place to list?</div>
              <div className="list-banner-sub">Free · No broker fees · Pre-screened leads</div>
            </div>
            <span className="list-banner-cta">Get started</span>
          </a>
        )}

      </div>
    </>
  )
}

export default function TenantDashboard() {
  return <DashboardInner />
}
