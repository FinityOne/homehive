'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── TYPES ────────────────────────────────────────────────────────────────────
type AppStatus = 'new' | 'reviewing' | 'approved' | 'declined'

type Application = {
  id: string
  tenantName: string
  tenantEmail: string
  property: string
  room: string
  moveIn: string
  status: AppStatus
  submittedDate: string
}

type Property = {
  id: string
  name: string
  address: string
  totalRooms: number
  occupied: number
  monthlyRent: number
  image: string
}

// ─── FAKE DATA ────────────────────────────────────────────────────────────────
const FAKE_PROPERTIES: Property[] = [
  {
    id: 'palace',
    name: 'University Dr Palace w/ Jacuzzi',
    address: '820 W 9th Street, Tempe, AZ 85281',
    totalRooms: 6,
    occupied: 4,
    monthlyRent: 699,
    image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',
  },
  {
    id: 'delrio',
    name: 'ASU Student Castle',
    address: '110 W Del Rio Dr, Tempe, AZ 85282',
    totalRooms: 5,
    occupied: 3,
    monthlyRent: 599,
    image: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
  },
]

const FAKE_APPLICATIONS: Application[] = [
  {
    id: '1',
    tenantName: 'Jordan Martinez',
    tenantEmail: 'jmart@asu.edu',
    property: 'University Dr Palace',
    room: 'Room 5',
    moveIn: 'Aug 2025',
    status: 'new',
    submittedDate: '2 hours ago',
  },
  {
    id: '2',
    tenantName: 'Priya Nair',
    tenantEmail: 'pnair@asu.edu',
    property: 'University Dr Palace',
    room: 'Room 6',
    moveIn: 'Aug 2025',
    status: 'reviewing',
    submittedDate: '1 day ago',
  },
  {
    id: '3',
    tenantName: 'Tyler Brooks',
    tenantEmail: 'tbrooks@asu.edu',
    property: 'ASU Student Castle',
    room: 'Room 4',
    moveIn: 'Jan 2026',
    status: 'approved',
    submittedDate: '3 days ago',
  },
]

// ─── STATUS CONFIG ─────────────────────────────────────────────────────────────
const APP_STATUS: Record<AppStatus, { label: string; color: string; bg: string; border: string }> = {
  new:       { label: 'New',       color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  reviewing: { label: 'Reviewing', color: '#c9973a', bg: '#fefce8', border: '#fde68a' },
  approved:  { label: 'Approved',  color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' },
  declined:  { label: 'Declined',  color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function LandlordDashboard() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      const name = data.user.user_metadata?.full_name?.split(' ')[0] || 'there'
      setUserName(name)
      setLoading(false)
    })
  }, [router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  const totalRooms   = FAKE_PROPERTIES.reduce((s, p) => s + p.totalRooms, 0)
  const totalOccupied = FAKE_PROPERTIES.reduce((s, p) => s + p.occupied, 0)
  const totalVacant  = totalRooms - totalOccupied
  const monthlyRevenue = FAKE_PROPERTIES.reduce((s, p) => s + p.occupied * p.monthlyRent, 0)
  const newApps      = FAKE_APPLICATIONS.filter(a => a.status === 'new').length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ld-wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }

        /* ── GREETING ── */
        .ld-greeting { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.5px; line-height: 1.2; margin-bottom: 4px; }
        .ld-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 28px; }

        /* ── STAT GRID ── */
        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 32px; }
        .stat-card { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 18px 20px; }
        .stat-label { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; }
        .stat-num { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 300; color: #1a1a1a; letter-spacing: -1px; line-height: 1; margin-bottom: 2px; }
        .stat-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; color: #FFC627; background: #8C1D40; padding: 2px 7px; border-radius: 4px; }

        /* ── ACTION STRIP ── */
        .action-strip { background: #fff; border: 1px solid #e8e4db; border-left: 3px solid #FFC627; border-radius: 10px; padding: 13px 16px; margin-bottom: 32px; display: flex; align-items: center; gap: 12px; }
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
        .section-gap { margin-bottom: 32px; }

        /* ── PROPERTY CARD ── */
        .pcard { background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; margin-bottom: 10px; display: flex; }
        .pcard-img { width: 120px; height: 100px; object-fit: cover; flex-shrink: 0; }
        .pcard-body { flex: 1; padding: 14px 16px; }
        .pcard-name { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
        .pcard-addr { font-size: 11px; color: #9b9b9b; margin-bottom: 10px; }
        .pcard-stats { display: flex; gap: 16px; align-items: center; }
        .pcard-stat { font-size: 12px; color: #6b6b6b; }
        .pcard-stat strong { color: #1a1a1a; }
        .occ-bar { width: 80px; height: 4px; background: #e8e4db; border-radius: 10px; overflow: hidden; }
        .occ-fill { height: 100%; background: #FFC627; border-radius: 10px; }
        .pcard-action { margin-left: auto; }
        .btn-s { background: #fff; color: #1a1a1a; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }
        .btn-s:hover { border-color: #8C1D40; color: #8C1D40; }

        /* ── APPLICATION CARD ── */
        .acard { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
        .acard-avatar { width: 36px; height: 36px; border-radius: 50%; background: #fdf2f5; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #8C1D40; flex-shrink: 0; font-family: 'DM Sans', sans-serif; }
        .acard-body { flex: 1; min-width: 0; }
        .acard-name { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px; }
        .acard-meta { font-size: 12px; color: #9b9b9b; }
        .acard-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
        .status-pill { display: inline-flex; align-items: center; border-radius: 20px; padding: 2px 9px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }
        .acard-date { font-size: 11px; color: #9b9b9b; }
        .acard-actions { display: flex; gap: 6px; margin-top: 8px; }
        .btn-xs-p { background: #8C1D40; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-xs-s { background: #fff; color: #1a1a1a; border: 1px solid #e8e4db; border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        @media (min-width: 560px) {
          .ld-greeting { font-size: 34px; }
          .stat-grid { grid-template-columns: repeat(4, 1fr); }
        }
        @media (max-width: 560px) {
          .stat-grid { grid-template-columns: repeat(2, 1fr); }
          .pcard-img { display: none; }
        }
      `}</style>

      <div className="ld-wrap">

        {/* ── GREETING ── */}
        <div className="ld-greeting">{getGreeting(userName)}</div>
        <div className="ld-sub">
          {totalVacant > 0 ? `${totalVacant} room${totalVacant !== 1 ? 's' : ''} vacant across ${FAKE_PROPERTIES.length} properties` : 'All rooms occupied — nice work'}
        </div>

        {/* ── STATS ── */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Total rooms</div>
            <div className="stat-num">{totalRooms}</div>
            <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '4px' }}>across {FAKE_PROPERTIES.length} properties</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Occupied</div>
            <div className="stat-num" style={{ color: '#166534' }}>{totalOccupied}</div>
            <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '4px' }}>{Math.round(totalOccupied / totalRooms * 100)}% occupancy</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Vacant</div>
            <div className="stat-num" style={{ color: totalVacant > 0 ? '#c9973a' : '#9b9b9b' }}>{totalVacant}</div>
            <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '4px' }}>{totalVacant > 0 ? 'rooms available' : 'fully occupied'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Monthly revenue</div>
            <div className="stat-num">${(monthlyRevenue / 1000).toFixed(1)}<span style={{ fontSize: '14px', fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>k</span></div>
            <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '4px' }}>from {totalOccupied} tenants</div>
          </div>
        </div>

        {/* ── ACTION STRIP ── */}
        {newApps > 0 && (
          <div className="action-strip">
            <span className="action-strip-icon">📋</span>
            <div className="action-strip-body">
              <div className="action-strip-title">{newApps} new application{newApps !== 1 ? 's' : ''} need{newApps === 1 ? 's' : ''} review</div>
              <div className="action-strip-sub">Respond within 48 hrs to keep prospects engaged</div>
            </div>
            <a href="/landlord/applications" className="action-strip-cta">Review now</a>
          </div>
        )}

        {/* ── PROPERTIES ── */}
        <div className="section-gap">
          <div className="section-header">
            <span className="section-title">Your properties</span>
            <a href="/landlord/listings" className="section-link">Manage all →</a>
          </div>

          {FAKE_PROPERTIES.map(p => (
            <div key={p.id} className="pcard">
              <img src={p.image} alt={p.name} className="pcard-img" />
              <div className="pcard-body">
                <div className="pcard-name">{p.name}</div>
                <div className="pcard-addr">{p.address}</div>
                <div className="pcard-stats">
                  <div className="pcard-stat">
                    <strong>{p.occupied}</strong> / {p.totalRooms} occupied
                  </div>
                  <div className="occ-bar">
                    <div className="occ-fill" style={{ width: `${(p.occupied / p.totalRooms) * 100}%` }} />
                  </div>
                  <div className="pcard-stat"><strong>${p.monthlyRent}</strong>/mo per room</div>
                  <div className="pcard-action">
                    <a href={`/landlord/listings/${p.id}`} className="btn-s">View details</a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── APPLICATIONS ── */}
        <div>
          <div className="section-header">
            <span className="section-title">Recent applications</span>
            <a href="/landlord/applications" className="section-link">See all →</a>
          </div>

          {FAKE_APPLICATIONS.map(app => {
            const cfg = APP_STATUS[app.status]
            const initials = app.tenantName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            return (
              <div key={app.id} className="acard">
                <div className="acard-avatar">{initials}</div>
                <div className="acard-body">
                  <div className="acard-name">{app.tenantName}</div>
                  <div className="acard-meta">{app.property} · {app.room} · Move-in {app.moveIn}</div>
                  {app.status === 'new' && (
                    <div className="acard-actions">
                      <button className="btn-xs-p">Approve</button>
                      <button className="btn-xs-s">Schedule tour</button>
                      <button className="btn-xs-s">Decline</button>
                    </div>
                  )}
                </div>
                <div className="acard-right">
                  <span
                    className="status-pill"
                    style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}
                  >
                    {cfg.label}
                  </span>
                  <span className="acard-date">{app.submittedDate}</span>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </>
  )
}
