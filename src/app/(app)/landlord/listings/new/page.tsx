'use client'

import { useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { createProperty, uploadPropertyImage } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type ListingType = 'sublease' | 'lease_transfer' | 'standard_rental'
type UnitType = 'room_in_house' | 'apartment' | 'condo' | 'studio'

const STEPS = ['Type', 'Your Space', 'Location', 'Price', 'Photos', 'Review']

const LISTING_TYPES: { type: ListingType; title: string; desc: string; who: string }[] = [
  {
    type: 'standard_rental',
    title: 'Standard Rental',
    desc: 'You own or manage a property and want to rent a room or the whole unit to a student.',
    who: 'Owner / Manager',
  },
  {
    type: 'sublease',
    title: 'Sublease',
    desc: "You're a current tenant leaving for a semester or summer. Keep your lease — find someone to take your spot temporarily.",
    who: 'Current tenant',
  },
  {
    type: 'lease_transfer',
    title: 'Lease Transfer',
    desc: "You want someone to fully take over your lease — clean handoff, you walk away with no penalties.",
    who: 'Current tenant',
  },
]

const UNIT_TYPES: { type: UnitType; label: string }[] = [
  { type: 'room_in_house',  label: 'Room in a house'   },
  { type: 'apartment',      label: 'Unit in apartment'  },
  { type: 'condo',          label: 'Condo'              },
  { type: 'studio',         label: 'Studio'             },
]

type FormData = {
  listing_type: ListingType | null
  unit_type: UnitType | null
  roommates_count: string
  sublease_end_date: string
  beds: string
  baths: string
  sqft: string
  available: string
  name: string
  address: string
  asu_distance: string
  description: string
  price: string
  security_deposit: string
  move_in_date: string
}

const INIT: FormData = {
  listing_type: null,
  unit_type: null,
  roommates_count: '',
  sublease_end_date: '',
  beds: '',
  baths: '',
  sqft: '',
  available: '1',
  name: '',
  address: '',
  asu_distance: '',
  description: '',
  price: '',
  security_deposit: '',
  move_in_date: '',
}

export default function NewListingWizard() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormData>(INIT)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [submitError, setSubmitError] = useState('')

  const set = (k: keyof FormData, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => { const n = { ...e }; delete n[k]; return n })
  }

  const addFiles = (files: FileList) => {
    setPendingFiles(prev => [...prev, ...Array.from(files)])
  }

  const removeFile = (i: number) => {
    setPendingFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  const isSubleaseType = form.listing_type === 'sublease' || form.listing_type === 'lease_transfer'

  // ── Validation per step ──
  const validate = (): boolean => {
    const e: Record<string, string> = {}

    if (step === 0) {
      if (!form.listing_type) e.listing_type = 'Please select a listing type.'
    }

    if (step === 1) {
      if (!form.unit_type) e.unit_type = 'Please select your unit type.'
      if (form.listing_type === 'standard_rental') {
        if (!form.beds || Number(form.beds) < 1) e.beds = 'Enter number of bedrooms.'
        if (!form.baths || Number(form.baths) < 1) e.baths = 'Enter number of bathrooms.'
        if (!form.available || Number(form.available) < 1) e.available = 'Enter how many rooms you are renting out.'
      } else if (form.listing_type === 'sublease') {
        if (!form.roommates_count || Number(form.roommates_count) < 1) e.roommates_count = 'Enter how many rooms you are subleasing.'
        if (!form.sublease_end_date) e.sublease_end_date = 'Enter the date your sublease ends.'
      } else if (form.listing_type === 'lease_transfer') {
        if (!form.beds || Number(form.beds) < 1) e.beds = 'Enter number of bedrooms.'
        if (!form.baths || Number(form.baths) < 1) e.baths = 'Enter number of bathrooms.'
      }
    }

    if (step === 2) {
      if (!form.name.trim()) e.name = 'Give your listing a title.'
      if (!form.address.trim()) e.address = 'Enter the property address.'
      if (!form.asu_distance || isNaN(Number(form.asu_distance))) e.asu_distance = 'Enter distance to ASU in miles.'
    }

    if (step === 3) {
      if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) e.price = 'Enter a valid monthly rent.'
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const next = () => { if (validate()) setStep(s => s + 1) }
  const back = () => setStep(s => s - 1)

  // ── Final submit ──
  const handlePublish = async () => {
    setSubmitting(true)
    setSubmitError('')
    setUploadStatus('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { slug, id, error } = await createProperty(user.id, {
      name: form.name.trim(),
      address: form.address.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      listing_type: form.listing_type!,
      unit_type: form.unit_type,
      roommates_count: form.roommates_count ? Number(form.roommates_count) : null,
      sublease_end_date: form.sublease_end_date || null,
      beds: Number(form.beds) || 1,
      baths: Number(form.baths) || 1,
      sqft: form.sqft,
      total_rooms: isSubleaseType ? Number(form.roommates_count) || 1 : Number(form.beds) || 1,
      available: Number(form.available) || 1,
      asu_distance: Number(form.asu_distance) || 0,
      security_deposit: form.security_deposit === '' ? null : Number(form.security_deposit),
    })

    if (error || !slug || !id) {
      setSubmitting(false)
      setSubmitError('Something went wrong. Please try again.')
      return
    }

    // Upload photos
    if (pendingFiles.length > 0) {
      const uploadedUrls: string[] = []
      for (let i = 0; i < pendingFiles.length; i++) {
        setUploadStatus(`Uploading photo ${i + 1} of ${pendingFiles.length}…`)
        const { url, error: upErr } = await uploadPropertyImage(pendingFiles[i], user.id, id)
        if (upErr || !url) {
          setSubmitting(false)
          setSubmitError('Listing created but photo upload failed. You can add photos from the listing page.')
          router.push(`/landlord/listings/${slug}`)
          return
        }
        uploadedUrls.push(url)
      }
      await fetch(`/api/properties/${id}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: uploadedUrls, ownerId: user.id }),
      })
    }

    // Notify landlord + admin about new pending listing
    try {
      await fetch(`/api/listings/${slug}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, propertyName: form.name.trim(), propertyId: id }),
      })
    } catch (_) {}

    router.push(`/landlord/listings/${slug}`)
  }

  const LISTING_TYPE_LABELS: Record<ListingType, string> = {
    standard_rental: 'Standard Rental',
    sublease: 'Sublease',
    lease_transfer: 'Lease Transfer',
  }
  const UNIT_TYPE_LABELS: Record<UnitType, string> = {
    room_in_house: 'Room in a house',
    apartment: 'Unit in apartment',
    condo: 'Condo',
    studio: 'Studio',
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .wiz-wrap { max-width: 640px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'Inter', sans-serif; }
        .wiz-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #897174; text-decoration: none; margin-bottom: 24px; background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; padding: 0; }
        .wiz-back:hover { color: #191c1d; }

        /* Progress */
        .wiz-progress { margin-bottom: 36px; }
        .wiz-steps { display: flex; gap: 4px; margin-bottom: 8px; }
        .wiz-step-bar { flex: 1; height: 3px; border-radius: 10px; background: #ddbfc3; transition: background 0.2s; }
        .wiz-step-bar.done { background: #10b981; }
        .wiz-step-bar.active { background: #8C1D40; }
        .wiz-step-label { font-size: 12px; color: #897174; }
        .wiz-step-label strong { color: #191c1d; }

        /* Card */
        .wiz-card { background: #fff; border: 1px solid #ddbfc3; border-radius: 16px; padding: 28px; margin-bottom: 16px; }
        .wiz-card-title { font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 700; color: #191c1d; letter-spacing: -0.02em; margin-bottom: 4px; }
        .wiz-card-sub { font-size: 13px; color: #897174; margin-bottom: 24px; }

        /* Listing type cards */
        .type-grid { display: flex; flex-direction: column; gap: 10px; }
        .type-opt { border: 2px solid #ddbfc3; border-radius: 12px; padding: 16px 18px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; transition: border-color 0.15s, background 0.15s; background: #fff; width: 100%; text-align: left; font-family: 'Inter', sans-serif; }
        .type-opt:hover { border-color: #897174; }
        .type-opt.selected { border-color: #8C1D40; background: #fdf2f5; }
        .type-opt-who { font-size: 10px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; color: #897174; }
        .type-opt.selected .type-opt-who { color: #8C1D40; }
        .type-opt-title { font-size: 14px; font-weight: 600; color: #191c1d; }
        .type-opt-desc { font-size: 12px; color: #564145; line-height: 1.55; }

        /* Unit type grid */
        .unit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .unit-opt { border: 2px solid #ddbfc3; border-radius: 10px; padding: 13px 15px; cursor: pointer; font-size: 13px; font-weight: 500; color: #191c1d; transition: border-color 0.15s, background 0.15s; background: #fff; font-family: 'Inter', sans-serif; text-align: left; }
        .unit-opt:hover { border-color: #897174; }
        .unit-opt.selected { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }

        /* Fields */
        .field-group { display: flex; flex-direction: column; gap: 14px; }
        .field-wrap { display: flex; flex-direction: column; gap: 5px; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .field-label { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #897174; }
        .field-input { padding: 10px 13px; border: 1.5px solid #ddbfc3; border-radius: 9px; font-size: 14px; font-family: 'Inter', sans-serif; color: #191c1d; background: #fff; outline: none; transition: border-color 0.15s; width: 100%; }
        .field-input:focus { border-color: #8C1D40; }
        .field-input::placeholder { color: #ddbfc3; }
        .field-input.error { border-color: #f5c6d0; }
        .field-error { font-size: 11px; color: #8C1D40; margin-top: 2px; }
        textarea.field-input { resize: vertical; min-height: 80px; }

        /* Photo file picker */
        .photo-upload-zone { border: 2px dashed #ddbfc3; border-radius: 12px; padding: 28px 20px; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; margin-bottom: 14px; }
        .photo-upload-zone:hover { border-color: #8C1D40; background: #fdf2f5; }
        .photo-upload-icon { font-size: 28px; margin-bottom: 8px; }
        .photo-upload-text { font-size: 14px; font-weight: 500; color: #564145; margin-bottom: 3px; }
        .photo-upload-sub { font-size: 12px; color: #897174; }
        .photo-preview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; margin-bottom: 14px; }
        .photo-preview-card { position: relative; border-radius: 9px; overflow: hidden; border: 1.5px solid #ddbfc3; aspect-ratio: 4/3; }
        .photo-preview-card.hero { border-color: #FFC627; border-width: 2px; }
        .photo-preview-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
        .photo-preview-badge { position: absolute; top: 6px; left: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #8C1D40; background: rgba(255,255,255,0.92); border-radius: 20px; padding: 2px 7px; }
        .photo-preview-remove { position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.55); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.1s; }
        .photo-preview-remove:hover { background: rgba(140,29,64,0.85); }

        /* Review */
        .review-section { margin-bottom: 20px; }
        .review-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #897174; margin-bottom: 6px; }
        .review-row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0; border-bottom: 1px solid #f3f4f5; color: #191c1d; gap: 12px; }
        .review-val { font-weight: 500; text-align: right; }
        .review-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .review-thumb { width: 80px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #ddbfc3; }

        /* Nav buttons */
        .wiz-nav { display: flex; gap: 10px; }
        .btn-back { flex: 1; padding: 13px; background: #fff; color: #191c1d; border: 1.5px solid #ddbfc3; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; transition: border-color 0.15s; }
        .btn-back:hover { border-color: #191c1d; }
        .btn-next { flex: 2; padding: 13px; background: #191c1d; color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .btn-next:hover:not(:disabled) { background: #2e3132; }
        .btn-next:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-publish { flex: 2; padding: 13px; background: linear-gradient(135deg, #6c002a, #8c1d40); color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; transition: opacity 0.2s; }
        .btn-publish:hover:not(:disabled) { opacity: 0.88; }
        .btn-publish:disabled { opacity: 0.6; cursor: not-allowed; }

        @media (max-width: 480px) {
          .unit-grid { grid-template-columns: 1fr; }
          .field-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="wiz-wrap">

        {/* Back to listings */}
        <a href="/landlord/listings" className="wiz-back">← Back to listings</a>

        {/* Progress bar */}
        <div className="wiz-progress">
          <div className="wiz-steps">
            {STEPS.map((_, i) => (
              <div key={i} className={`wiz-step-bar${i < step ? ' done' : i === step ? ' active' : ''}`} />
            ))}
          </div>
          <div className="wiz-step-label">
            Step <strong>{step + 1} of {STEPS.length}</strong> — {STEPS[step]}
          </div>
        </div>

        {/* ── STEP 0: Listing type ── */}
        {step === 0 && (
          <div className="wiz-card">
            <div className="wiz-card-title">What kind of listing is this?</div>
            <div className="wiz-card-sub">Choose the option that best describes your situation.</div>
            <div className="type-grid">
              {LISTING_TYPES.map(opt => (
                <button
                  key={opt.type}
                  className={`type-opt${form.listing_type === opt.type ? ' selected' : ''}`}
                  onClick={() => set('listing_type', opt.type)}
                >
                  <div className="type-opt-who">{opt.who}</div>
                  <div className="type-opt-title">{opt.title}</div>
                  <div className="type-opt-desc">{opt.desc}</div>
                </button>
              ))}
            </div>
            {errors.listing_type && <div className="field-error" style={{ marginTop: '12px' }}>{errors.listing_type}</div>}
          </div>
        )}

        {/* ── STEP 1: Your space ── */}
        {step === 1 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Tell us about your space.</div>
            <div className="wiz-card-sub">Help students understand what they're moving into.</div>

            <div className="field-group">
              {/* Unit type — shown for all listing types */}
              <div className="field-wrap">
                <div className="field-label">Unit type</div>
                <div className="unit-grid">
                  {UNIT_TYPES.map(u => (
                    <button
                      key={u.type}
                      className={`unit-opt${form.unit_type === u.type ? ' selected' : ''}`}
                      onClick={() => set('unit_type', u.type)}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
                {errors.unit_type && <div className="field-error">{errors.unit_type}</div>}
              </div>

              {/* Standard rental: beds, baths, sqft, rooms renting out */}
              {form.listing_type === 'standard_rental' && (
                <>
                  <div className="field-row">
                    <div className="field-wrap">
                      <label className="field-label">Bedrooms</label>
                      <input
                        type="number" min="1"
                        className={`field-input${errors.beds ? ' error' : ''}`}
                        placeholder="e.g. 3"
                        value={form.beds}
                        onChange={e => set('beds', e.target.value)}
                      />
                      {errors.beds && <div className="field-error">{errors.beds}</div>}
                    </div>
                    <div className="field-wrap">
                      <label className="field-label">Bathrooms</label>
                      <input
                        type="number" min="1" step="0.5"
                        className={`field-input${errors.baths ? ' error' : ''}`}
                        placeholder="e.g. 2"
                        value={form.baths}
                        onChange={e => set('baths', e.target.value)}
                      />
                      {errors.baths && <div className="field-error">{errors.baths}</div>}
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field-wrap">
                      <label className="field-label">Rooms renting out</label>
                      <input
                        type="number" min="1"
                        className={`field-input${errors.available ? ' error' : ''}`}
                        placeholder="e.g. 2"
                        value={form.available}
                        onChange={e => set('available', e.target.value)}
                      />
                      {errors.available && <div className="field-error">{errors.available}</div>}
                    </div>
                    <div className="field-wrap">
                      <label className="field-label">
                        Sq ft <span style={{ textTransform: 'none', fontWeight: 400, color: '#ddbfc3' }}>(optional)</span>
                      </label>
                      <input
                        type="text"
                        className="field-input"
                        placeholder="e.g. 1,100"
                        value={form.sqft}
                        onChange={e => set('sqft', e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Sublease: rooms subleasing + end date */}
              {form.listing_type === 'sublease' && (
                <div className="field-row">
                  <div className="field-wrap">
                    <label className="field-label">Rooms you're subleasing</label>
                    <input
                      type="number" min="1"
                      className={`field-input${errors.roommates_count ? ' error' : ''}`}
                      placeholder="e.g. 1"
                      value={form.roommates_count}
                      onChange={e => set('roommates_count', e.target.value)}
                    />
                    {errors.roommates_count && <div className="field-error">{errors.roommates_count}</div>}
                  </div>
                  <div className="field-wrap">
                    <label className="field-label">Sublease ends</label>
                    <input
                      type="date"
                      className={`field-input${errors.sublease_end_date ? ' error' : ''}`}
                      value={form.sublease_end_date}
                      onChange={e => set('sublease_end_date', e.target.value)}
                    />
                    {errors.sublease_end_date && <div className="field-error">{errors.sublease_end_date}</div>}
                  </div>
                </div>
              )}

              {/* Lease transfer: beds + baths */}
              {form.listing_type === 'lease_transfer' && (
                <div className="field-row">
                  <div className="field-wrap">
                    <label className="field-label">Bedrooms</label>
                    <input
                      type="number" min="1"
                      className={`field-input${errors.beds ? ' error' : ''}`}
                      placeholder="e.g. 2"
                      value={form.beds}
                      onChange={e => set('beds', e.target.value)}
                    />
                    {errors.beds && <div className="field-error">{errors.beds}</div>}
                  </div>
                  <div className="field-wrap">
                    <label className="field-label">Bathrooms</label>
                    <input
                      type="number" min="1" step="0.5"
                      className={`field-input${errors.baths ? ' error' : ''}`}
                      placeholder="e.g. 1"
                      value={form.baths}
                      onChange={e => set('baths', e.target.value)}
                    />
                    {errors.baths && <div className="field-error">{errors.baths}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2: Location & basics ── */}
        {step === 2 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Where is it and what's it called?</div>
            <div className="wiz-card-sub">Give your listing a clear name students will recognize.</div>
            <div className="field-group">
              <div className="field-wrap">
                <label className="field-label">Listing title</label>
                <input
                  type="text"
                  className={`field-input${errors.name ? ' error' : ''}`}
                  placeholder="e.g. Sunny room near Tempe campus"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                />
                {errors.name && <div className="field-error">{errors.name}</div>}
              </div>
              <div className="field-wrap">
                <label className="field-label">Street address</label>
                <input
                  type="text"
                  className={`field-input${errors.address ? ' error' : ''}`}
                  placeholder="1234 Apache Blvd, Tempe, AZ 85281"
                  value={form.address}
                  onChange={e => set('address', e.target.value)}
                />
                {errors.address && <div className="field-error">{errors.address}</div>}
              </div>
              <div className="field-wrap">
                <label className="field-label">Distance to ASU (miles)</label>
                <input
                  type="number" min="0" step="0.1"
                  className={`field-input${errors.asu_distance ? ' error' : ''}`}
                  placeholder="e.g. 0.8"
                  value={form.asu_distance}
                  onChange={e => set('asu_distance', e.target.value)}
                />
                {errors.asu_distance && <div className="field-error">{errors.asu_distance}</div>}
              </div>
              <div className="field-wrap">
                <label className="field-label">
                  Description <span style={{ textTransform: 'none', fontWeight: 400, color: '#ddbfc3' }}>(optional)</span>
                </label>
                <textarea
                  className="field-input"
                  placeholder="Describe your place — amenities, vibe, what's nearby..."
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Price & availability ── */}
        {step === 3 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Price and availability.</div>
            <div className="wiz-card-sub">Be upfront — students filter heavily by price and move-in date.</div>
            <div className="field-group">
              <div className="field-wrap">
                <label className="field-label">Monthly rent ($/mo)</label>
                <input
                  type="number" min="1"
                  className={`field-input${errors.price ? ' error' : ''}`}
                  placeholder="e.g. 750"
                  value={form.price}
                  onChange={e => set('price', e.target.value)}
                />
                {errors.price && <div className="field-error">{errors.price}</div>}
              </div>
              <div className="field-wrap">
                <label className="field-label">
                  Security deposit ($) <span style={{ textTransform: 'none', fontWeight: 400, color: '#ddbfc3' }}>— enter 0 for no deposit</span>
                </label>
                <input
                  type="number" min="0"
                  className="field-input"
                  placeholder="e.g. 750 — or 0 for no deposit"
                  value={form.security_deposit}
                  onChange={e => set('security_deposit', e.target.value)}
                />
                {form.security_deposit === '0' && (
                  <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px', fontWeight: 500 }}>
                    No security deposit — this will be shown as a selling point on your listing.
                  </div>
                )}
              </div>
              <div className="field-wrap">
                <label className="field-label">
                  Available from <span style={{ textTransform: 'none', fontWeight: 400, color: '#ddbfc3' }}>(optional)</span>
                </label>
                <input
                  type="date"
                  className="field-input"
                  value={form.move_in_date}
                  onChange={e => set('move_in_date', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: Photos ── */}
        {step === 4 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Add photos.</div>
            <div className="wiz-card-sub">
              Listings with photos get 3× more leads. The first photo is your hero — shown first in search results.
            </div>

            {pendingFiles.length > 0 && (
              <div className="photo-preview-grid">
                {pendingFiles.map((file, i) => (
                  <div key={i} className={`photo-preview-card${i === 0 ? ' hero' : ''}`}>
                    <img src={URL.createObjectURL(file)} alt={`Photo ${i + 1}`} className="photo-preview-thumb" />
                    {i === 0 && <span className="photo-preview-badge">Hero ★</span>}
                    <button className="photo-preview-remove" onClick={() => removeFile(i)} title="Remove">×</button>
                  </div>
                ))}
              </div>
            )}

            <div
              className="photo-upload-zone"
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
            >
              <div className="photo-upload-icon">📷</div>
              <div className="photo-upload-text">{pendingFiles.length > 0 ? 'Add more photos' : 'Upload photos'}</div>
              <div className="photo-upload-sub">Click to select · JPG, PNG, WEBP</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => e.target.files && e.target.files.length > 0 && addFiles(e.target.files)}
            />
          </div>
        )}

        {/* ── STEP 5: Review ── */}
        {step === 5 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Review your listing.</div>
            <div className="wiz-card-sub">Everything look good? Hit publish and your listing goes live immediately.</div>

            {pendingFiles.length > 0 && (
              <div className="review-section">
                <div className="review-label">Photos ({pendingFiles.length})</div>
                <div className="review-photos">
                  {pendingFiles.map((file, i) => (
                    <img key={i} src={URL.createObjectURL(file)} alt={`Photo ${i + 1}`} className="review-thumb" />
                  ))}
                </div>
              </div>
            )}

            <div className="review-section">
              <div className="review-label">Listing type</div>
              <div className="review-row">
                <span>Type</span>
                <span className="review-val">{LISTING_TYPE_LABELS[form.listing_type!]}</span>
              </div>
              {form.unit_type && (
                <div className="review-row">
                  <span>Unit</span>
                  <span className="review-val">{UNIT_TYPE_LABELS[form.unit_type]}</span>
                </div>
              )}
              {form.listing_type === 'sublease' && form.roommates_count && (
                <div className="review-row">
                  <span>Rooms subleasing</span>
                  <span className="review-val">{form.roommates_count}</span>
                </div>
              )}
              {form.sublease_end_date && (
                <div className="review-row">
                  <span>Sublease ends</span>
                  <span className="review-val">{form.sublease_end_date}</span>
                </div>
              )}
              {form.beds && <div className="review-row"><span>Beds</span><span className="review-val">{form.beds}</span></div>}
              {form.baths && <div className="review-row"><span>Baths</span><span className="review-val">{form.baths}</span></div>}
              {form.listing_type === 'standard_rental' && (
                <div className="review-row"><span>Rooms renting out</span><span className="review-val">{form.available}</span></div>
              )}
            </div>

            <div className="review-section">
              <div className="review-label">Location</div>
              <div className="review-row"><span>Title</span><span className="review-val">{form.name}</span></div>
              <div className="review-row"><span>Address</span><span className="review-val" style={{ maxWidth: '60%' }}>{form.address}</span></div>
              <div className="review-row"><span>Distance to ASU</span><span className="review-val">{form.asu_distance} mi</span></div>
            </div>

            <div className="review-section">
              <div className="review-label">Pricing</div>
              <div className="review-row">
                <span>Monthly rent</span>
                <span className="review-val" style={{ color: '#10b981', fontWeight: 700 }}>${Number(form.price).toLocaleString()}/mo</span>
              </div>
              <div className="review-row">
                <span>Security deposit</span>
                <span className="review-val" style={{ color: form.security_deposit === '0' ? '#10b981' : undefined, fontWeight: form.security_deposit === '0' ? 700 : undefined }}>
                  {form.security_deposit === '' ? 'Not set' : form.security_deposit === '0' ? '$0 — No deposit' : `$${Number(form.security_deposit).toLocaleString()}`}
                </span>
              </div>
            </div>

            {submitError && (
              <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '16px' }}>
                {submitError}
              </div>
            )}
            {uploadStatus && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#166534', marginBottom: '16px' }}>
                {uploadStatus}
              </div>
            )}
          </div>
        )}

        {/* Skip photos hint */}
        {step === 4 && pendingFiles.length === 0 && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <button
              onClick={() => setStep(5)}
              style={{ font: 'inherit', fontSize: '13px', color: '#897174', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
            >
              Skip for now — add photos after publishing
            </button>
          </div>
        )}

        {/* Navigation */}
        <div className="wiz-nav">
          {step > 0 && (
            <button className="btn-back" onClick={back}>← Back</button>
          )}
          {step < 5 ? (
            <button className="btn-next" onClick={next}>Continue →</button>
          ) : (
            <button className="btn-publish" onClick={handlePublish} disabled={submitting}>
              {submitting ? (uploadStatus || 'Publishing…') : 'Publish listing →'}
            </button>
          )}
        </div>

      </div>
    </>
  )
}
