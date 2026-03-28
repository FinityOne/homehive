'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, Property } from '@/lib/properties'
import { getLeadsForOwner, Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}!`
  if (h < 17) return `Good afternoon, ${name}!`
  return `Good evening, ${name}!`
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  new:       { label: 'New',       color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  reviewing: { label: 'Reviewing', color: '#c9973a', bg: '#fefce8', border: '#fde68a' },
  approved:  { label: 'Approved',  color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  declined:  { label: 'Declined',  color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

export default function LandlordDashboard() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [properties, setProperties] = useState<Property[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const name = user.user_metadata?.full_name?.split(' ')[0] || 'there'
      setUserName(name)

      const [props, lds] = await Promise.all([
        getPropertiesByOwner(user.id),
        getLeadsForOwner(user.id),
      ])
      setProperties(props)
      setLeads(lds)
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

  const newLeadsCount = leads.filter(l => l.status === 'new').length
  const vacantRooms = properties.reduce((s, p) => s + (p.available || 0), 0)
  const recentLeads = leads.slice(0, 5)
  const pendingProperties = properties.filter(p => p.admin_status === 'pending')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ld-wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }

        .ld-greeting { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #0f172a; letter-spacing: -0.5px; line-height: 1.2; margin-bottom: 4px; }
        .ld-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 28px; }

        .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
        .stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; }
        .stat-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .stat-num { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #0f172a; letter-spacing: -1px; line-height: 1; margin-bottom: 2px; }
        .stat-sub { font-size: 11px; color: #9b9b9b; margin-top: 4px; }

        .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .section-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; }
        .section-link { font-size: 12px; color: #10b981; font-weight: 500; text-decoration: none; }
        .section-link:hover { text-decoration: underline; }
        .section-gap { margin-bottom: 32px; }

        .pcard { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; margin-bottom: 10px; display: flex; }
        .pcard-img { width: 120px; height: 100px; object-fit: cover; flex-shrink: 0; background: #e2e8f0; }
        .pcard-img-placeholder { width: 120px; height: 100px; flex-shrink: 0; background: #1e293b; display: flex; align-items: center; justify-content: center; font-size: 24px; }
        .pcard-body { flex: 1; padding: 14px 16px; min-width: 0; }
        .pcard-name { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pcard-addr { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
        .pcard-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .pcard-price { font-size: 13px; font-weight: 600; color: #10b981; }
        .pcard-avail { font-size: 12px; color: #64748b; }
        .pcard-manage { margin-left: auto; flex-shrink: 0; background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }
        .pcard-manage:hover { background: #1e293b; }

        .empty-state { background: #fff; border: 1px solid #e2e8f0; border-left: 3px solid #10b981; border-radius: 12px; padding: 28px 24px; text-align: center; }
        .empty-headline { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 6px; }
        .empty-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 16px; }
        .btn-primary { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-primary:hover { background: #1e293b; }

        .acard { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 12px; }
        .acard-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(16,185,129,0.15); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #10b981; flex-shrink: 0; }
        .acard-body { flex: 1; min-width: 0; }
        .acard-name { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 2px; }
        .acard-meta { font-size: 12px; color: #9b9b9b; }
        .acard-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
        .status-pill { display: inline-flex; align-items: center; border-radius: 20px; padding: 2px 9px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }
        .acard-date { font-size: 11px; color: #9b9b9b; }

        .coming-soon-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #166534; margin-bottom: 12px; }

        .pending-banner { background: linear-gradient(135deg, #fffbeb 0%, #fefce8 100%); border: 1.5px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 14px; padding: 20px 22px; margin-bottom: 28px; }
        .pending-banner-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
        .pending-banner-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 4px; }
        .pending-banner-sub { font-size: 13px; color: #78350f; line-height: 1.5; }
        .pending-banner-count { background: #f59e0b; color: #fff; border-radius: 20px; padding: 4px 12px; font-size: 12px; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
        .pending-tips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
        .pending-tip { background: rgba(245,158,11,0.12); border: 1px solid #fde68a; border-radius: 20px; padding: 4px 12px; font-size: 12px; color: #92400e; font-weight: 500; }
        .pcard-status { display: inline-flex; align-items: center; border-radius: 20px; padding: 2px 8px; font-size: 11px; font-weight: 700; white-space: nowrap; }

        @media (max-width: 560px) {
          .stat-grid { grid-template-columns: repeat(2, 1fr); }
          .pcard-img, .pcard-img-placeholder { display: none; }
          .pcard-manage { margin-left: 0; }
        }
      `}</style>

      <div className="ld-wrap">

        <div className="ld-greeting">{getGreeting(userName)}</div>
        <div className="ld-sub">
          {properties.length === 0
            ? 'Get started by listing your first property'
            : vacantRooms > 0
              ? `${vacantRooms} room${vacantRooms !== 1 ? 's' : ''} available across ${properties.length} propert${properties.length !== 1 ? 'ies' : 'y'}`
              : `All rooms occupied across ${properties.length} propert${properties.length !== 1 ? 'ies' : 'y'}`
          }
        </div>

        {/* PENDING REVIEW BANNER */}
        {pendingProperties.length > 0 && (
          <div className="pending-banner">
            <div className="pending-banner-top">
              <div>
                <div className="pending-banner-title">Your listing is being reviewed — you&apos;re almost there!</div>
                <div className="pending-banner-sub">
                  The HomeHive team personally reviews every listing to verify it&apos;s legitimate, accurate, and a great fit for students.
                  This keeps our platform trusted and scam-free — which means higher-quality leads for you.
                  Most listings are reviewed <strong>within 24 hours</strong>.
                </div>
              </div>
              <span className="pending-banner-count">{pendingProperties.length} in review</span>
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#92400e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Boost your approval odds while you wait
            </div>
            <div className="pending-tips">
              <span className="pending-tip">Add high-quality photos</span>
              <span className="pending-tip">Write a detailed description</span>
              <span className="pending-tip">Set accurate pricing</span>
              <span className="pending-tip">Add ASU distance & nearby places</span>
            </div>
            {pendingProperties.length === 1 && (
              <a href={`/landlord/listings/${pendingProperties[0].slug}`} style={{ display: 'inline-block', marginTop: '14px', fontSize: '13px', fontWeight: 600, color: '#92400e', textDecoration: 'none', borderBottom: '1px solid #f59e0b' }}>
                Complete your listing →
              </a>
            )}
          </div>
        )}

        {/* STAT CARDS */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Properties</div>
            <div className="stat-num">{properties.length}</div>
            <div className="stat-sub">total listings</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">New Leads</div>
            <div className="stat-num" style={{ color: newLeadsCount > 0 ? '#10b981' : '#0f172a' }}>{newLeadsCount}</div>
            <div className="stat-sub">{leads.length} total leads</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Vacant Rooms</div>
            <div className="stat-num" style={{ color: vacantRooms > 0 ? '#d97706' : '#9b9b9b' }}>{vacantRooms}</div>
            <div className="stat-sub">
              {properties.reduce((s, p) => s + (p.total_rooms || 0), 0)} total rooms
            </div>
          </div>
        </div>

        {/* PROPERTIES */}
        <div className="section-gap">
          <div className="section-header">
            <span className="section-title">Your Properties</span>
            <a href="/landlord/listings" className="section-link">Manage all →</a>
          </div>

          {properties.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderLeft: '4px solid #10b981', borderRadius: '14px', padding: '32px 28px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>Welcome! Let&apos;s get your first listing live.</div>
              <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>It takes about 5 minutes. Once live, students can find and inquire about your place directly.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                {['Student-focused audience — hundreds of ASU students searching near Tempe', '$0 to start — free forever for early landlords, no credit card', 'Average 3 days to your first qualified lead'].map(pt => (
                  <div key={pt} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#1a1a1a' }}>
                    <span style={{ color: '#10b981', fontWeight: 700, flexShrink: 0 }}>✓</span>
                    <span>{pt}</span>
                  </div>
                ))}
              </div>
              <a href="/landlord/listings/new" className="btn-primary">Create your first listing →</a>
            </div>
          ) : (
            properties.map(p => (
              <div key={p.id} className="pcard">
                {p.images?.[0]
                  ? <img src={p.images[0]} alt={p.name} className="pcard-img" />
                  : <div className="pcard-img-placeholder">🏠</div>
                }
                <div className="pcard-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <div className="pcard-name" style={{ margin: 0 }}>{p.name}</div>
                    {p.admin_status === 'pending' && (
                      <span className="pcard-status" style={{ background: '#fef3c7', color: '#92400e' }}>Under Review</span>
                    )}
                    {p.admin_status === 'active' && (
                      <span className="pcard-status" style={{ background: '#d1fae5', color: '#065f46' }}>Live</span>
                    )}
                    {p.admin_status === 'rejected' && (
                      <span className="pcard-status" style={{ background: '#fff1f2', color: '#9f1239' }}>Not Approved</span>
                    )}
                  </div>
                  <div className="pcard-addr">{p.address}</div>
                  <div className="pcard-meta">
                    <span className="pcard-price">${p.price?.toLocaleString()}/mo</span>
                    <span className="pcard-avail">{p.available} of {p.total_rooms} available</span>
                    <a href={`/landlord/listings/${p.slug}`} className="pcard-manage">Manage →</a>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Leads */}
        <div>
          <div className="section-header">
            <span className="section-title">Recent Leads (coming soon)</span>
            <a href="/landlord/leads" className="section-link">See all →</a>
          </div>

          <div className="coming-soon-banner">
            Full application management is coming soon. Below are your recent leads.
          </div>

          {recentLeads.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#9b9b9b', fontSize: '13px' }}>
              No leads yet — leads will appear here once tenants inquire about your properties.
            </div>
          ) : (
            recentLeads.map(lead => {
              const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email
              const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
              const cfg = STATUS_CFG[lead.status] || STATUS_CFG['new']
              const date = lead.created_at ? new Date(lead.created_at).toLocaleDateString() : ''
              return (
                <div key={lead.id} className="acard">
                  <div className="acard-avatar">{initials}</div>
                  <div className="acard-body">
                    <div className="acard-name">{name}</div>
                    <div className="acard-meta">
                      {lead.property && <span>{lead.property}</span>}
                      {lead.move_in_date && <span> · Move-in {lead.move_in_date}</span>}
                    </div>
                  </div>
                  <div className="acard-right">
                    <span className="status-pill" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>
                      {cfg.label}
                    </span>
                    <span className="acard-date">{date}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>

      </div>
    </>
  )
}
