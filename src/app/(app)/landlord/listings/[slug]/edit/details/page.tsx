'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import {
  getPropertiesByOwner,
  replacePropertyNearby,
  replacePropertyAsuReasons,
  replacePropertyTags,
  Property,
} from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type NearbyRow = { place: string; travel_time: string }

export default function EditDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [nearbyRows, setNearbyRows] = useState<NearbyRow[]>([])
  const [asuReasons, setAsuReasons] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setNearbyRows(found.nearby?.length > 0 ? found.nearby : [{ place: '', travel_time: '' }])
      setAsuReasons(found.asu_reasons?.length > 0 ? found.asu_reasons : [''])
      setTags(found.tags || [])
      setLoading(false)
    }
    load()
  }, [slug, router])

  // Nearby helpers
  function updateNearby(index: number, field: 'place' | 'travel_time', value: string) {
    setNearbyRows(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }
  function addNearby() {
    setNearbyRows(rows => [...rows, { place: '', travel_time: '' }])
  }
  function removeNearby(index: number) {
    setNearbyRows(rows => rows.filter((_, i) => i !== index))
  }

  // ASU reasons helpers
  function updateReason(index: number, value: string) {
    setAsuReasons(rs => rs.map((r, i) => i === index ? value : r))
  }
  function addReason() {
    setAsuReasons(rs => [...rs, ''])
  }
  function removeReason(index: number) {
    setAsuReasons(rs => rs.filter((_, i) => i !== index))
  }

  // Tag helpers
  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags(ts => [...ts, t])
    }
    setTagInput('')
  }
  function removeTag(tag: string) {
    setTags(ts => ts.filter(t => t !== tag))
  }
  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  async function handleSaveAll() {
    if (!property) return
    setSaving(true)
    setErrorMsg('')
    setSuccessMsg('')

    const filteredNearby = nearbyRows.filter(r => r.place.trim() !== '')
    const filteredReasons = asuReasons.filter(r => r.trim() !== '')
    const filteredTags = tags.filter(t => t.trim() !== '')

    const [nearbyResult, reasonsResult, tagsResult] = await Promise.all([
      replacePropertyNearby(property.id, filteredNearby),
      replacePropertyAsuReasons(property.id, filteredReasons),
      replacePropertyTags(property.id, filteredTags),
    ])

    setSaving(false)

    const errors = [nearbyResult.error, reasonsResult.error, tagsResult.error].filter(Boolean)
    if (errors.length > 0) {
      setErrorMsg('Some sections failed to save. Please try again.')
    } else {
      setSuccessMsg('All details saved successfully!')
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
        .edit-title { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 28px; }

        .section-block { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .section-block-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 14px; }

        .form-input { border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; transition: border-color 0.15s; }
        .form-input:focus { border-color: #10b981; }

        /* Nearby */
        .nearby-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .nearby-row .place-input { flex: 2; }
        .nearby-row .time-input { flex: 1; }
        .btn-remove-sm { background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; border-radius: 6px; padding: 7px 10px; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; flex-shrink: 0; }
        .btn-remove-sm:hover { background: #fee2e2; }
        .btn-add-row { background: #f1f5f9; color: #334155; border: 1.5px dashed #cbd5e1; border-radius: 7px; padding: 8px 14px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; width: 100%; margin-top: 4px; }
        .btn-add-row:hover { background: #e2e8f0; }

        /* Reasons */
        .reason-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .reason-num { width: 24px; height: 24px; border-radius: 50%; background: rgba(16,185,129,0.15); color: #10b981; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .reason-row .form-input { flex: 1; }

        /* Tags */
        .tag-pill-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; min-height: 32px; }
        .tag-pill { background: #f1f5f9; color: #334155; border-radius: 20px; padding: 4px 10px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
        .tag-pill-remove { background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0; font-size: 13px; line-height: 1; }
        .tag-pill-remove:hover { color: #ef4444; }
        .tag-input-row { display: flex; gap: 8px; }
        .tag-input-row .form-input { flex: 1; }
        .btn-add-tag { background: #0f172a; color: #34d399; border: none; border-radius: 7px; padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; flex-shrink: 0; }
        .btn-add-tag:hover { background: #1e293b; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .col-hint { font-size: 11px; color: #94a3b8; margin-bottom: 10px; }
      `}</style>

      <div className="edit-wrap">
        <div className="edit-breadcrumb">
          <a href="/landlord/listings">Listings</a>
          {' › '}
          <a href={`/landlord/listings/${slug}`}>{property?.name}</a>
          {' › '}
          Edit Details
        </div>

        <h1 className="edit-title">Details</h1>

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        {/* NEARBY PLACES */}
        <div className="section-block">
          <div className="section-block-title">Nearby Places</div>
          <div className="col-hint">Add places students care about — coffee shops, gyms, grocery stores, transit stops.</div>

          {nearbyRows.map((row, i) => (
            <div key={i} className="nearby-row">
              <input
                className="form-input place-input"
                type="text"
                value={row.place}
                onChange={e => updateNearby(i, 'place', e.target.value)}
                placeholder="e.g. Starbucks"
              />
              <input
                className="form-input time-input"
                type="text"
                value={row.travel_time}
                onChange={e => updateNearby(i, 'travel_time', e.target.value)}
                placeholder="3 min walk"
              />
              <button className="btn-remove-sm" onClick={() => removeNearby(i)} title="Remove">✕</button>
            </div>
          ))}

          <button className="btn-add-row" onClick={addNearby}>+ Add nearby place</button>
        </div>

        {/* ASU HIGHLIGHTS */}
        <div className="section-block">
          <div className="section-block-title">ASU Highlights</div>
          <div className="col-hint">Why is this property perfect for ASU students? List your top reasons.</div>

          {asuReasons.map((reason, i) => (
            <div key={i} className="reason-row">
              <span className="reason-num">{i + 1}</span>
              <input
                className="form-input"
                type="text"
                value={reason}
                onChange={e => updateReason(i, e.target.value)}
                placeholder="e.g. 5-minute walk to Engineering buildings"
              />
              <button className="btn-remove-sm" onClick={() => removeReason(i)} title="Remove">✕</button>
            </div>
          ))}

          <button className="btn-add-row" onClick={addReason}>+ Add highlight</button>
        </div>

        {/* TAGS */}
        <div className="section-block">
          <div className="section-block-title">Tags</div>
          <div className="col-hint">Add tags that describe your property — amenities, rules, features. Press Enter or comma to add.</div>

          <div className="tag-pill-list">
            {tags.map(tag => (
              <span key={tag} className="tag-pill">
                {tag}
                <button className="tag-pill-remove" onClick={() => removeTag(tag)} title="Remove tag">×</button>
              </span>
            ))}
          </div>

          <div className="tag-input-row">
            <input
              className="form-input"
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="e.g. WiFi, Pet-friendly, Parking..."
            />
            <button className="btn-add-tag" onClick={addTag}>Add</button>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn-save" onClick={handleSaveAll} disabled={saving}>
            {saving ? 'Saving...' : 'Save All'}
          </button>
          <a href={`/landlord/listings/${slug}`} className="btn-cancel">Cancel</a>
        </div>
      </div>
    </>
  )
}
