'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, updatePropertyCore, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function EditLocationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [asuDistance, setAsuDistance] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [mapEmbedUrl, setMapEmbedUrl] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setAsuDistance(found.asu_distance?.toString() || '')
      setLat(found.lat?.toString() || '')
      setLng(found.lng?.toString() || '')
      setMapEmbedUrl(found.map_embed_url || '')
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
      asu_distance: parseFloat(asuDistance) || 0,
      lat: parseFloat(lat) || 0,
      lng: parseFloat(lng) || 0,
      map_embed_url: mapEmbedUrl,
    })

    setSaving(false)
    if (error) {
      setErrorMsg('Failed to save changes. Please try again.')
    } else {
      setSuccessMsg('Location saved successfully!')
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
        .form-hint { font-size: 12px; color: #94a3b8; margin-top: 4px; line-height: 1.5; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

        .map-helper-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; font-size: 13px; color: #166534; line-height: 1.6; }
        .map-helper-box strong { font-weight: 600; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

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
          Edit Location
        </div>

        <h1 className="edit-title">Location</h1>

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        <div className="form-group">
          <label className="form-label">ASU Distance (minutes walk)</label>
          <input
            className="form-input"
            type="number"
            min="0"
            value={asuDistance}
            onChange={e => setAsuDistance(e.target.value)}
            placeholder="5"
          />
          <div className="form-hint">How many minutes does it take to walk to ASU Tempe campus?</div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Latitude</label>
            <input
              className="form-input"
              type="number"
              step="any"
              value={lat}
              onChange={e => setLat(e.target.value)}
              placeholder="33.4255"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Longitude</label>
            <input
              className="form-input"
              type="number"
              step="any"
              value={lng}
              onChange={e => setLng(e.target.value)}
              placeholder="-111.9400"
            />
          </div>
        </div>

        <div className="map-helper-box">
          <strong>How to get your map embed URL:</strong><br />
          Go to <strong>Google Maps</strong> → search your property address → click <strong>Share</strong> → select <strong>Embed a map</strong> → copy the URL from the <code>src="..."</code> attribute in the iframe code.
        </div>

        <div className="form-group">
          <label className="form-label">Map Embed URL</label>
          <input
            className="form-input"
            type="url"
            value={mapEmbedUrl}
            onChange={e => setMapEmbedUrl(e.target.value)}
            placeholder="https://www.google.com/maps/embed?pb=..."
          />
          <div className="form-hint">Paste the src URL from the Google Maps embed iframe code.</div>
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
