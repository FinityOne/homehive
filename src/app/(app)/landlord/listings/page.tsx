'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function ListingsPage() {
  const router = useRouter()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const props = await getPropertiesByOwner(user.id)
      setProperties(props)
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

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .listings-wrap { max-width: 1000px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }

        .listings-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; gap: 12px; }
        .listings-title { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 300; color: #0f172a; letter-spacing: -0.4px; }
        .btn-add { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-add:hover { background: #1e293b; }

        .prop-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }

        .prop-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
        .prop-card-img-wrap { position: relative; height: 200px; background: #1e293b; }
        .prop-card-img { width: 100%; height: 200px; object-fit: cover; display: block; }
        .prop-card-img-placeholder { width: 100%; height: 200px; display: flex; align-items: center; justify-content: center; font-size: 40px; background: #1e293b; }
        .prop-status-badge { position: absolute; top: 10px; left: 10px; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
        .badge-active   { background: #d1fae5; color: #065f46; }
        .badge-pending  { background: #fef3c7; color: #92400e; }
        .badge-rejected { background: #fff1f2; color: #9f1239; }
        .badge-inactive { background: #e5e7eb; color: #6b7280; }

        .prop-card-body { padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .prop-card-name { font-size: 15px; font-weight: 600; color: #0f172a; line-height: 1.3; }
        .prop-card-addr { font-size: 12px; color: #94a3b8; }
        .prop-card-price { font-size: 14px; font-weight: 600; color: #10b981; }
        .prop-card-specs { display: flex; gap: 10px; font-size: 12px; color: #64748b; flex-wrap: wrap; }
        .prop-card-avail { font-size: 12px; color: #64748b; }
        .avail-bar-track { height: 4px; background: #e2e8f0; border-radius: 10px; overflow: hidden; margin-top: 2px; }
        .avail-bar-fill { height: 100%; background: #10b981; border-radius: 10px; }
        .prop-card-footer { margin-top: auto; padding-top: 12px; }
        .btn-manage { display: block; text-align: center; background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; }
        .btn-manage:hover { background: #1e293b; }

        .pending-insight { background: linear-gradient(135deg, #fffbeb 0%, #fefce8 100%); border: 1.5px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 18px 20px; grid-column: 1 / -1; margin-bottom: 4px; }
        .pending-insight-title { font-size: 14px; font-weight: 700; color: #92400e; margin-bottom: 6px; }
        .pending-insight-body { font-size: 13px; color: #78350f; line-height: 1.55; margin-bottom: 10px; }
        .pending-insight-tips { display: flex; flex-wrap: wrap; gap: 6px; }
        .pending-insight-tip { background: rgba(245,158,11,0.12); border: 1px solid #fde68a; border-radius: 20px; padding: 3px 10px; font-size: 11px; color: #92400e; font-weight: 600; }

        .empty-card { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 12px; padding: 40px 32px; grid-column: 1 / -1; }
        .empty-headline { font-size: 20px; font-weight: 600; color: #0f172a; margin-bottom: 8px; }
        .empty-sub { font-size: 14px; color: #64748b; margin-bottom: 16px; }
        .empty-proof { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        .proof-item { font-size: 12px; color: #10b981; font-weight: 500; display: flex; align-items: center; gap: 4px; }
        .btn-list { background: #10b981; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 14px; font-weight: 600; cursor: not-allowed; font-family: 'DM Sans', sans-serif; opacity: 0.7; }

        @media (max-width: 640px) {
          .prop-grid { grid-template-columns: 1fr; }
          .listings-title { font-size: 22px; }
        }
      `}</style>

      <div className="listings-wrap">
        <div className="listings-header">
          <h1 className="listings-title">My Listings</h1>
          <a href="/landlord/listings/new" className="btn-add">+ Add Property</a>
        </div>

        <div className="prop-grid">
          {properties.some(p => p.admin_status === 'pending') && (
            <div className="pending-insight">
              <div className="pending-insight-title">Your listing is in review — exciting times ahead!</div>
              <div className="pending-insight-body">
                The HomeHive team reviews every listing to ensure it&apos;s verified, legitimate, and a great experience for students.
                Most listings are approved <strong>within 24 hours</strong>. Use this time to complete your listing — the more detail you add, the faster the approval and the more leads you&apos;ll get once you&apos;re live.
              </div>
              <div className="pending-insight-tips">
                <span className="pending-insight-tip">Add clear photos</span>
                <span className="pending-insight-tip">Write a compelling description</span>
                <span className="pending-insight-tip">Set your ASU distance</span>
                <span className="pending-insight-tip">List nearby places</span>
                <span className="pending-insight-tip">Add tags &amp; highlights</span>
              </div>
            </div>
          )}
          {properties.length === 0 ? (
            <div className="empty-card">
              <div className="empty-headline">Your first listing is one step away</div>
              <div className="empty-sub">Join landlords earning $2,000+/mo on HomeHive by listing your property today.</div>
              <div className="empty-proof">
                <span className="proof-item">✓ 150+ students placed</span>
                <span className="proof-item">✓ No agency fees</span>
                <span className="proof-item">✓ Avg. 3 days to first lead</span>
              </div>
              <a href="/landlord/listings/new" style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 24px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", textDecoration: 'none', display: 'inline-block' }}>Create your first listing →</a>
            </div>
          ) : (
            properties.map(p => {
              const availPct = p.total_rooms > 0 ? (p.available / p.total_rooms) * 100 : 0
              return (
                <div key={p.id} className="prop-card">
                  <div className="prop-card-img-wrap">
                    {p.images?.[0]
                      ? <img src={p.images[0]} alt={p.name} className="prop-card-img" />
                      : <div className="prop-card-img-placeholder">🏠</div>
                    }
                    <span className={`prop-status-badge ${
                      p.admin_status === 'active'   ? 'badge-active'   :
                      p.admin_status === 'pending'  ? 'badge-pending'  :
                      p.admin_status === 'rejected' ? 'badge-rejected' :
                      'badge-inactive'
                    }`}>
                      {p.admin_status === 'active'   ? 'Live'          :
                       p.admin_status === 'pending'  ? 'Under Review'  :
                       p.admin_status === 'rejected' ? 'Not Approved'  :
                       'Inactive'}
                    </span>
                  </div>
                  <div className="prop-card-body">
                    <div className="prop-card-name">{p.name}</div>
                    <div className="prop-card-addr">{p.address}</div>
                    <div className="prop-card-price">${p.price?.toLocaleString()}/mo</div>
                    <div className="prop-card-specs">
                      {p.beds > 0 && <span>{p.beds} bed{p.beds !== 1 ? 's' : ''}</span>}
                      {p.baths > 0 && <span>{p.baths} bath{p.baths !== 1 ? 's' : ''}</span>}
                      {p.sqft && <span>{p.sqft} sqft</span>}
                    </div>
                    <div className="prop-card-avail">
                      {p.available} of {p.total_rooms} rooms available
                      <div className="avail-bar-track">
                        <div className="avail-bar-fill" style={{ width: `${availPct}%` }} />
                      </div>
                    </div>
                    <div className="prop-card-footer">
                      <a href={`/landlord/listings/${p.slug}`} className="btn-manage">Manage →</a>
                    </div>
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
