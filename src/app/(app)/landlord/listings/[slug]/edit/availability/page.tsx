'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, updatePropertyCore, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function EditAvailabilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [available, setAvailable] = useState('')
  const [totalRooms, setTotalRooms] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [isFeatured, setIsFeatured] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setAvailable(found.available?.toString() || '0')
      setTotalRooms(found.total_rooms?.toString() || '0')
      setIsActive(found.is_active ?? false)
      setIsFeatured(found.is_featured ?? false)
      setLoading(false)
    }
    load()
  }, [slug, router])

  async function handleSave() {
    if (!property) return
    setSaving(true)
    setErrorMsg('')
    setSuccessMsg('')

    const { error } = await updatePropertyCore(property.id, {
      available: parseInt(available) || 0,
      total_rooms: parseInt(totalRooms) || 0,
      is_active: isActive,
      is_featured: isFeatured,
    })

    setSaving(false)
    if (error) {
      setErrorMsg('Failed to save changes. Please try again.')
    } else {
      setSuccessMsg('Changes saved successfully!')
      setTimeout(() => {
        router.push(`/landlord/listings/${slug}`)
      }, 1200)
    }
  }

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
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .edit-wrap { max-width: 680px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .edit-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 20px; }
        .edit-breadcrumb a { color: #10b981; text-decoration: none; }
        .edit-breadcrumb a:hover { text-decoration: underline; }
        .edit-title { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 24px; }

        .form-group { margin-bottom: 18px; }
        .form-label { display: block; font-size: 12px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; }
        .form-input { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; transition: border-color 0.15s; }
        .form-input:focus { border-color: #10b981; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

        .toggle-row { display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
        .toggle-info { flex: 1; }
        .toggle-title { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 2px; }
        .toggle-sub { font-size: 12px; color: #64748b; }
        .toggle-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; margin-left: 12px; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .toggle-slider { position: absolute; inset: 0; background: #e2e8f0; border-radius: 24px; cursor: pointer; transition: background 0.2s; }
        .toggle-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
        .toggle-switch input:checked + .toggle-slider { background: #10b981; }
        .toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .section-heading { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; margin-top: 6px; }

        @media (max-width: 480px) {
          .form-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="edit-wrap">
        <div className="edit-breadcrumb">
          <a href="/landlord/listings">Listings</a>
          {' › '}
          <a href={`/landlord/listings/${slug}`}>{property?.name}</a>
          {' › '}
          Edit Availability
        </div>

        <h1 className="edit-title">Status &amp; Availability</h1>

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        <div className="section-heading">Room Counts</div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Available Rooms</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={available}
              onChange={e => setAvailable(e.target.value)}
              placeholder="2"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Total Rooms</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={totalRooms}
              onChange={e => setTotalRooms(e.target.value)}
              placeholder="6"
            />
          </div>
        </div>

        <div className="section-heading">Listing Status</div>

        <div className="toggle-row">
          <div className="toggle-info">
            <div className="toggle-title">Active Listing</div>
            <div className="toggle-sub">When active, your property is visible to students searching for housing</div>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div className="toggle-info">
            <div className="toggle-title">Featured Listing</div>
            <div className="toggle-sub">Featured listings appear at the top of search results and get 3x more views</div>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={isFeatured} onChange={e => setIsFeatured(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="form-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <a href={`/landlord/listings/${slug}`} className="btn-cancel">Cancel</a>
        </div>
      </div>
    </>
  )
}
