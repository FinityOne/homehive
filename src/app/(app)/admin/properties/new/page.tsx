'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Owner = { id: string; email: string; name: string }

type NearbyRow = { place: string; travel_time: string }

type SuccessResult = { id: string; slug: string; claimUrl: string | null; name: string }

export default function AdminNewPropertyPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Owner options
  const [owners, setOwners] = useState<Owner[]>([])
  const [ownersLoading, setOwnersLoading] = useState(true)
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('claimable')

  // Form fields
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [description, setDescription] = useState('')
  const [listingType, setListingType] = useState('standard_rental')
  const [unitType, setUnitType] = useState('')
  const [beds, setBeds] = useState('1')
  const [baths, setBaths] = useState('1')
  const [sqft, setSqft] = useState('')
  const [price, setPrice] = useState('')
  const [securityDeposit, setSecurityDeposit] = useState('')
  const [totalRooms, setTotalRooms] = useState('1')
  const [available, setAvailable] = useState('1')
  const [asuDistance, setAsuDistance] = useState('')
  const [subleaseEndDate, setSubleaseEndDate] = useState('')
  const [moveInDate, setMoveInDate] = useState('')
  const [mapEmbedUrl, setMapEmbedUrl] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  // Tags (comma-separated input)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])

  // ASU reasons
  const [reasonInput, setReasonInput] = useState('')
  const [asuReasons, setAsuReasons] = useState<string[]>([])

  // Nearby places
  const [nearbyRows, setNearbyRows] = useState<NearbyRow[]>([{ place: '', travel_time: '' }])

  // Image files
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<SuccessResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    fetch('/api/admin/owners')
      .then(r => r.json())
      .then((data: Owner[]) => { setOwners(data); setOwnersLoading(false) })
      .catch(() => setOwnersLoading(false))
  }, [router])

  const addFiles = (files: FileList) => {
    const newFiles = Array.from(files)
    setPendingFiles(prev => [...prev, ...newFiles])
    newFiles.forEach(f => {
      const url = URL.createObjectURL(f)
      setPreviewUrls(prev => [...prev, url])
    })
  }

  const removeFile = (i: number) => {
    URL.revokeObjectURL(previewUrls[i])
    setPendingFiles(prev => prev.filter((_, idx) => idx !== i))
    setPreviewUrls(prev => prev.filter((_, idx) => idx !== i))
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  const addReason = () => {
    const r = reasonInput.trim()
    if (r && !asuReasons.includes(r)) setAsuReasons(prev => [...prev, r])
    setReasonInput('')
  }

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Property name is required.'); return }
    if (!address.trim()) { setError('Address is required.'); return }
    if (!price || isNaN(Number(price)) || Number(price) <= 0) { setError('Valid price is required.'); return }

    setSubmitting(true)
    setError('')
    setUploadStatus('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Upload images via server-side API (uses service role to bypass Storage RLS)
    const imageUrls: string[] = []
    if (pendingFiles.length > 0) {
      for (let i = 0; i < pendingFiles.length; i++) {
        setUploadStatus(`Uploading photo ${i + 1} of ${pendingFiles.length}…`)
        const fd = new FormData()
        fd.append('file', pendingFiles[i])
        fd.append('folder', 'admin-listings')
        const res = await fetch('/api/admin/upload', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok || !data.url) {
          setError(`Photo ${i + 1} failed to upload: ${data.error ?? 'unknown error'}`)
          setSubmitting(false)
          return
        }
        imageUrls.push(data.url)
      }
      setUploadStatus('Saving listing…')
    }

    const isClaimable = selectedOwnerId === 'claimable'
    const ownerId = isClaimable ? null : selectedOwnerId || null

    const nearby = nearbyRows.filter(r => r.place.trim() && r.travel_time.trim())

    const res = await fetch('/api/admin/properties/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        address: address.trim(),
        description: description.trim(),
        listing_type: listingType,
        unit_type: unitType || null,
        beds: Number(beds) || 1,
        baths: Number(baths) || 1,
        sqft: sqft.trim(),
        price: Number(price),
        security_deposit: securityDeposit === '' ? null : Number(securityDeposit),
        total_rooms: Number(totalRooms) || 1,
        available: Number(available) || 1,
        asu_distance: Number(asuDistance) || 0,
        sublease_end_date: subleaseEndDate || null,
        move_in_date: moveInDate || null,
        map_embed_url: mapEmbedUrl.trim(),
        lat: Number(lat) || 0,
        lng: Number(lng) || 0,
        owner_id: ownerId,
        is_claimable: isClaimable,
        tags,
        asu_reasons: asuReasons,
        nearby,
        images: imageUrls,
      }),
    })

    const data = await res.json()
    if (!res.ok || !data.ok) {
      setError(data.error || 'Failed to create listing.')
      setSubmitting(false)
      return
    }

    setResult({ id: data.id, slug: data.slug, claimUrl: data.claimUrl, name: name.trim() })
    setSubmitting(false)
    setUploadStatus('')
  }

  if (result) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
    return (
      <>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@400;500;600&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          .success-wrap { max-width: 560px; margin: 0 auto; padding: 48px 24px; font-family: 'DM Sans', sans-serif; }
          .copy-btn { background: #1a1a1a; color: #fff; border: none; border-radius: 7px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; flex-shrink: 0; transition: background 0.15s; }
          .copy-btn.copied { background: #16a34a; }
          .copy-btn:hover:not(.copied) { background: #3a3a3a; }
        `}</style>
        <div className="success-wrap">
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', padding: '28px', marginBottom: '20px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>✅</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: '22px', fontWeight: 600, color: '#1a1a1a', marginBottom: '6px' }}>{result.name}</div>
            <div style={{ fontSize: '14px', color: '#166534', fontWeight: 500 }}>Listing created and live!</div>
          </div>

          {result.claimUrl && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Private Claim Link</div>
              <p style={{ fontSize: '13px', color: '#78350f', lineHeight: 1.6, marginBottom: '12px' }}>
                Share this link with the landlord. Once they sign in or create an account, the listing will be assigned to them automatically.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px' }}>
                <span style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace', color: '#1a1a1a', wordBreak: 'break-all' }}>{result.claimUrl}</span>
                <button
                  className={`copy-btn${copied ? ' copied' : ''}`}
                  onClick={() => { navigator.clipboard.writeText(result.claimUrl!); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <a href="/admin/properties" style={{ background: '#18181b', color: '#fff', borderRadius: '9px', padding: '11px 20px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
              ← All properties
            </a>
            <a href={`/homes/${result.slug}`} target="_blank" rel="noopener noreferrer" style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', borderRadius: '9px', padding: '11px 20px', fontSize: '14px', fontWeight: 500, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}>
              View listing ↗
            </a>
            <button onClick={() => { setResult(null); setName(''); setAddress(''); setDescription(''); setPrice(''); setPendingFiles([]); setPreviewUrls([]); setTags([]); setAsuReasons([]); setNearbyRows([{ place: '', travel_time: '' }]) }}
              style={{ background: '#fff', color: '#1a1a1a', border: '1.5px solid #e8e4db', borderRadius: '9px', padding: '11px 20px', fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
              Create another
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .anp-wrap { max-width: 760px; margin: 0 auto; padding: 28px 24px 80px; font-family: 'DM Sans', sans-serif; }
        .anp-section { background: #fff; border: 1px solid #e8e4db; border-radius: 12px; padding: 22px 24px; margin-bottom: 14px; }
        .anp-section-title { font-size: 11px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 16px; }
        .anp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        .anp-row.three { grid-template-columns: 1fr 1fr 1fr; }
        .anp-field { display: flex; flex-direction: column; gap: 5px; }
        .anp-label { font-size: 11px; font-weight: 700; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.5px; }
        .anp-input { height: 40px; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #faf9f6; outline: none; transition: border-color 0.15s; }
        .anp-input:focus { border-color: #8C1D40; background: #fff; }
        .anp-textarea { border: 1.5px solid #e8e4db; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #faf9f6; outline: none; resize: vertical; min-height: 90px; transition: border-color 0.15s; width: 100%; }
        .anp-textarea:focus { border-color: #8C1D40; background: #fff; }
        .anp-select { height: 40px; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #faf9f6; outline: none; cursor: pointer; width: 100%; }
        .anp-select:focus { border-color: #8C1D40; }
        .anp-hint { font-size: 11px; color: #9b9b9b; margin-top: 3px; }
        .anp-hint.green { color: #16a34a; font-weight: 600; }

        .tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .tag-pill { display: inline-flex; align-items: center; gap: 5px; background: #faf9f6; border: 1px solid #e8e4db; border-radius: 20px; padding: 4px 10px; font-size: 12px; color: #1a1a1a; }
        .tag-remove { background: none; border: none; color: #9b9b9b; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
        .tag-remove:hover { color: #8C1D40; }

        .add-row { display: flex; gap: 8px; }
        .add-btn { height: 36px; padding: 0 14px; background: #1a1a1a; color: #fff; border: none; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: background 0.15s; }
        .add-btn:hover { background: #3a3a3a; }

        .nearby-row-wrap { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; margin-bottom: 8px; }
        .remove-row-btn { background: none; border: 1.5px solid #e8e4db; border-radius: 7px; width: 36px; height: 36px; color: #9b9b9b; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .remove-row-btn:hover { border-color: #8C1D40; color: #8C1D40; }
        .add-nearby-btn { background: none; border: 1.5px dashed #e8e4db; border-radius: 7px; padding: 8px 14px; font-size: 13px; color: #9b9b9b; cursor: pointer; width: 100%; margin-top: 4px; transition: all 0.15s; font-family: 'DM Sans', sans-serif; }
        .add-nearby-btn:hover { border-color: #1a1a1a; color: #1a1a1a; }

        .photo-zone { border: 2px dashed #e8e4db; border-radius: 10px; padding: 28px 20px; text-align: center; cursor: pointer; transition: all 0.15s; margin-bottom: 12px; }
        .photo-zone:hover { border-color: #8C1D40; background: #fdf7f9; }
        .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
        .photo-thumb-wrap { position: relative; border-radius: 8px; overflow: hidden; aspect-ratio: 4/3; border: 1.5px solid #e8e4db; }
        .photo-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
        .photo-remove { position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.55); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .photo-remove:hover { background: rgba(140,29,64,0.85); }

        .owner-toggle { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .owner-opt { padding: 7px 14px; border-radius: 20px; border: 1.5px solid #e8e4db; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; background: #fff; color: #6b6b6b; transition: all 0.15s; }
        .owner-opt.selected { background: #18181b; color: #fff; border-color: #18181b; }

        .submit-btn { width: 100%; height: 52px; background: linear-gradient(135deg, #6c002a, #8c1d40); color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.2s; letter-spacing: 0.1px; }
        .submit-btn:hover:not(:disabled) { opacity: 0.9; }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .error-box { background: #fdf2f5; border: 1px solid #f5c6d0; border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #8C1D40; margin-bottom: 16px; }

        @media (max-width: 600px) {
          .anp-row, .anp-row.three { grid-template-columns: 1fr; }
          .nearby-row-wrap { grid-template-columns: 1fr auto; }
          .nearby-row-wrap .anp-input:last-of-type { display: none; }
        }
      `}</style>

      <div className="anp-wrap">
        <a href="/admin/properties" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#9b9b9b', textDecoration: 'none', marginBottom: '20px' }}>
          ← Back to properties
        </a>

        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '26px', fontWeight: 300, color: '#1a1a1a', letterSpacing: '-0.4px', marginBottom: '4px' }}>
            Create a new listing
          </h1>
          <p style={{ fontSize: '13px', color: '#9b9b9b' }}>Admin-created listings go live immediately — no review required.</p>
        </div>

        {/* ── Basic Info ── */}
        <div className="anp-section">
          <div className="anp-section-title">Basic Info</div>
          <div style={{ marginBottom: '14px' }}>
            <div className="anp-field">
              <label className="anp-label">Property Name *</label>
              <input className="anp-input" placeholder="e.g. The Commons at Tempe" value={name} onChange={e => setName(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <div className="anp-field">
              <label className="anp-label">Address *</label>
              <input className="anp-input" placeholder="e.g. 123 College Ave, Tempe, AZ 85281" value={address} onChange={e => setAddress(e.target.value)} />
            </div>
          </div>
          <div className="anp-field">
            <label className="anp-label">Description</label>
            <textarea className="anp-textarea" placeholder="Describe the property — layout, vibe, what makes it great for students…" value={description} onChange={e => setDescription(e.target.value)} rows={4} />
          </div>
        </div>

        {/* ── Listing Details ── */}
        <div className="anp-section">
          <div className="anp-section-title">Listing Details</div>
          <div className="anp-row" style={{ marginBottom: '14px' }}>
            <div className="anp-field">
              <label className="anp-label">Listing Type *</label>
              <select className="anp-select" value={listingType} onChange={e => setListingType(e.target.value)}>
                <option value="standard_rental">Standard Rental</option>
                <option value="sublease">Sublease</option>
                <option value="lease_transfer">Lease Transfer</option>
              </select>
            </div>
            <div className="anp-field">
              <label className="anp-label">Unit Type</label>
              <select className="anp-select" value={unitType} onChange={e => setUnitType(e.target.value)}>
                <option value="">— Select —</option>
                <option value="room_in_house">Room in a house</option>
                <option value="apartment">Unit in apartment</option>
                <option value="condo">Condo</option>
                <option value="studio">Studio</option>
              </select>
            </div>
          </div>
          <div className="anp-row three">
            <div className="anp-field">
              <label className="anp-label">Bedrooms</label>
              <input className="anp-input" type="number" min="0" placeholder="1" value={beds} onChange={e => setBeds(e.target.value)} />
            </div>
            <div className="anp-field">
              <label className="anp-label">Bathrooms</label>
              <input className="anp-input" type="number" min="0" step="0.5" placeholder="1" value={baths} onChange={e => setBaths(e.target.value)} />
            </div>
            <div className="anp-field">
              <label className="anp-label">Sq Ft</label>
              <input className="anp-input" type="text" placeholder="e.g. 850" value={sqft} onChange={e => setSqft(e.target.value)} />
            </div>
          </div>
          {(listingType === 'sublease' || listingType === 'lease_transfer') && (
            <div className="anp-row" style={{ marginTop: '14px' }}>
              <div className="anp-field">
                <label className="anp-label">Sublease End Date</label>
                <input className="anp-input" type="date" value={subleaseEndDate} onChange={e => setSubleaseEndDate(e.target.value)} />
              </div>
              <div className="anp-field">
                <label className="anp-label">Move-in Date</label>
                <input className="anp-input" type="date" value={moveInDate} onChange={e => setMoveInDate(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* ── Pricing & Availability ── */}
        <div className="anp-section">
          <div className="anp-section-title">Pricing &amp; Availability</div>
          <div className="anp-row">
            <div className="anp-field">
              <label className="anp-label">Monthly Rent ($) *</label>
              <input className="anp-input" type="number" min="0" placeholder="e.g. 1200" value={price} onChange={e => setPrice(e.target.value)} />
            </div>
            <div className="anp-field">
              <label className="anp-label">Security Deposit ($)</label>
              <input className="anp-input" type="number" min="0" placeholder="Leave blank = 1 month's rent" value={securityDeposit} onChange={e => setSecurityDeposit(e.target.value)} />
              {securityDeposit === '0' && <div className="anp-hint green">No deposit required — will be shown in green</div>}
            </div>
          </div>
          <div className="anp-row" style={{ marginTop: '14px' }}>
            <div className="anp-field">
              <label className="anp-label">Total Rooms</label>
              <input className="anp-input" type="number" min="1" placeholder="1" value={totalRooms} onChange={e => setTotalRooms(e.target.value)} />
            </div>
            <div className="anp-field">
              <label className="anp-label">Available Now</label>
              <input className="anp-input" type="number" min="0" placeholder="1" value={available} onChange={e => setAvailable(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Location ── */}
        <div className="anp-section">
          <div className="anp-section-title">Location</div>
          <div className="anp-row" style={{ marginBottom: '14px' }}>
            <div className="anp-field">
              <label className="anp-label">Distance to ASU (miles)</label>
              <input className="anp-input" type="number" min="0" step="0.1" placeholder="e.g. 0.4" value={asuDistance} onChange={e => setAsuDistance(e.target.value)} />
            </div>
            <div className="anp-field" style={{ gridColumn: 'span 1' }}>
              <label className="anp-label">Move-in Date (if standard)</label>
              <input className="anp-input" type="date" value={moveInDate} onChange={e => setMoveInDate(e.target.value)} />
            </div>
          </div>
          <div className="anp-row">
            <div className="anp-field">
              <label className="anp-label">Latitude</label>
              <input className="anp-input" type="number" step="any" placeholder="e.g. 33.4255" value={lat} onChange={e => setLat(e.target.value)} />
            </div>
            <div className="anp-field">
              <label className="anp-label">Longitude</label>
              <input className="anp-input" type="number" step="any" placeholder="e.g. -111.9400" value={lng} onChange={e => setLng(e.target.value)} />
            </div>
          </div>
          <div className="anp-field" style={{ marginTop: '14px' }}>
            <label className="anp-label">Map Embed URL</label>
            <input className="anp-input" type="url" placeholder="Google Maps embed URL" value={mapEmbedUrl} onChange={e => setMapEmbedUrl(e.target.value)} />
          </div>
        </div>

        {/* ── Tags ── */}
        <div className="anp-section">
          <div className="anp-section-title">Amenity Tags</div>
          {tags.length > 0 && (
            <div className="tag-list">
              {tags.map(t => (
                <span key={t} className="tag-pill">
                  {t}
                  <button className="tag-remove" onClick={() => setTags(prev => prev.filter(x => x !== t))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="add-row">
            <input className="anp-input" style={{ flex: 1 }} placeholder="e.g. WiFi, Parking, In-unit washer/dryer" value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()} />
            <button className="add-btn" onClick={addTag}>Add</button>
          </div>
          <div className="anp-hint" style={{ marginTop: '6px' }}>Press Enter or click Add — use common amenity names students search for</div>
        </div>

        {/* ── ASU Reasons ── */}
        <div className="anp-section">
          <div className="anp-section-title">Why ASU Students Love This</div>
          {asuReasons.length > 0 && (
            <div className="tag-list">
              {asuReasons.map(r => (
                <span key={r} className="tag-pill">
                  {r}
                  <button className="tag-remove" onClick={() => setAsuReasons(prev => prev.filter(x => x !== r))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="add-row">
            <input className="anp-input" style={{ flex: 1 }} placeholder="e.g. Walking distance to Tempe campus" value={reasonInput}
              onChange={e => setReasonInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addReason()} />
            <button className="add-btn" onClick={addReason}>Add</button>
          </div>
        </div>

        {/* ── Nearby Places ── */}
        <div className="anp-section">
          <div className="anp-section-title">Nearby Places</div>
          {nearbyRows.map((row, i) => (
            <div key={i} className="nearby-row-wrap">
              <input className="anp-input" placeholder="Place (e.g. Sun Devil Stadium)" value={row.place}
                onChange={e => setNearbyRows(prev => prev.map((r, idx) => idx === i ? { ...r, place: e.target.value } : r))} />
              <input className="anp-input" placeholder="Travel time (e.g. 4 min walk)" value={row.travel_time}
                onChange={e => setNearbyRows(prev => prev.map((r, idx) => idx === i ? { ...r, travel_time: e.target.value } : r))} />
              {nearbyRows.length > 1 && (
                <button className="remove-row-btn" onClick={() => setNearbyRows(prev => prev.filter((_, idx) => idx !== i))}>×</button>
              )}
            </div>
          ))}
          <button className="add-nearby-btn" onClick={() => setNearbyRows(prev => [...prev, { place: '', travel_time: '' }])}>
            + Add place
          </button>
        </div>

        {/* ── Owner Assignment ── */}
        <div className="anp-section">
          <div className="anp-section-title">Owner Assignment</div>
          <div className="owner-toggle">
            <button className={`owner-opt${selectedOwnerId === 'claimable' ? ' selected' : ''}`} onClick={() => setSelectedOwnerId('claimable')}>
              Claimable (no owner)
            </button>
            <button className={`owner-opt${selectedOwnerId !== 'claimable' && selectedOwnerId !== '' ? ' selected' : ''}`}
              onClick={() => { if (owners.length > 0) setSelectedOwnerId(owners[0].id) }}>
              Assign to landlord
            </button>
          </div>
          {selectedOwnerId === 'claimable' ? (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#78350f', lineHeight: 1.6 }}>
              A private claim link will be generated. Share it with the landlord to let them claim ownership.
            </div>
          ) : (
            <div className="anp-field">
              <label className="anp-label">Select Landlord</label>
              {ownersLoading ? (
                <div style={{ fontSize: '13px', color: '#9b9b9b' }}>Loading landlords…</div>
              ) : owners.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#9b9b9b' }}>No landlords found. Select &quot;Claimable&quot; instead.</div>
              ) : (
                <select className="anp-select" value={selectedOwnerId} onChange={e => setSelectedOwnerId(e.target.value)}>
                  {owners.map(o => (
                    <option key={o.id} value={o.id}>{o.name} ({o.email})</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* ── Images ── */}
        <div className="anp-section">
          <div className="anp-section-title">Photos</div>
          <div className="photo-zone" onClick={() => fileInputRef.current?.click()}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>📸</div>
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#1a1a1a', marginBottom: '3px' }}>Click to add photos</div>
            <div style={{ fontSize: '12px', color: '#9b9b9b' }}>JPG, PNG, WEBP — up to 10 images recommended</div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => e.target.files && addFiles(e.target.files)} />
          {previewUrls.length > 0 && (
            <div className="photo-grid">
              {previewUrls.map((url, i) => (
                <div key={i} className="photo-thumb-wrap">
                  <img src={url} alt={`Photo ${i + 1}`} className="photo-thumb" />
                  <button className="photo-remove" onClick={() => removeFile(i)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Submit ── */}
        {error && <div className="error-box">{error}</div>}
        {uploadStatus && <div style={{ fontSize: '13px', color: '#9b9b9b', textAlign: 'center', marginBottom: '12px' }}>{uploadStatus}</div>}
        <button className="submit-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Creating listing…' : 'Create listing →'}
        </button>
      </div>
    </>
  )
}
