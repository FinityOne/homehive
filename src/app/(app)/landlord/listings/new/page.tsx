'use client'

import { useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { createProperty } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type ListingType = 'sublease' | 'lease_transfer' | 'standard_rental'
type UnitType = 'room_in_house' | 'apartment' | 'condo' | 'studio'

const STEPS = ['Type', 'Your Space', 'Location', 'Price', 'Photo', 'Review']

const LISTING_TYPES: { type: ListingType; icon: string; title: string; desc: string; who: string }[] = [
  {
    type: 'standard_rental',
    icon: '🏠',
    title: 'Standard Rental',
    desc: "You own or manage a property and want to rent a room or the whole unit to a student.",
    who: 'Owner / Manager',
  },
  {
    type: 'sublease',
    icon: '✈️',
    title: 'Sublease',
    desc: "You're a current tenant heading out for a semester or summer. Keep your lease — find a subletter.",
    who: 'Current tenant',
  },
  {
    type: 'lease_transfer',
    icon: '🤝',
    title: 'Lease Transfer',
    desc: "You want someone to take over your lease entirely — clean handoff, no penalties on your end.",
    who: 'Current tenant',
  },
]

const UNIT_TYPES: { type: UnitType; label: string; icon: string }[] = [
  { type: 'room_in_house', label: 'Room in a house', icon: '🏡' },
  { type: 'apartment',     label: 'Apartment unit',  icon: '🏢' },
  { type: 'condo',         label: 'Condo',           icon: '🏙️' },
  { type: 'studio',        label: 'Studio',          icon: '🛏️' },
]

type FormData = {
  listing_type: ListingType | null
  unit_type: UnitType | null
  roommates_count: string
  sublease_end_date: string
  beds: string
  baths: string
  sqft: string
  name: string
  address: string
  asu_distance: string
  description: string
  price: string
  available: string
  move_in_date: string
  hero_image: string
}

const INIT: FormData = {
  listing_type: null,
  unit_type: null,
  roommates_count: '',
  sublease_end_date: '',
  beds: '',
  baths: '',
  sqft: '',
  name: '',
  address: '',
  asu_distance: '',
  description: '',
  price: '',
  available: '1',
  move_in_date: '',
  hero_image: '',
}

export default function NewListingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormData>(INIT)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (k: keyof FormData, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => { const n = { ...e }; delete n[k]; return n })
  }

  const isSubleaseType = form.listing_type === 'sublease' || form.listing_type === 'lease_transfer'

  // ── Validation per step ──
  const validate = (): boolean => {
    const e: Record<string, string> = {}

    if (step === 0) {
      if (!form.listing_type) e.listing_type = 'Please select a listing type.'
    }
    if (step === 1) {
      if (isSubleaseType) {
        if (!form.unit_type) e.unit_type = 'Please select your unit type.'
        if (!form.roommates_count || Number(form.roommates_count) < 1) e.roommates_count = 'Enter total number of people in the unit.'
        if (form.listing_type === 'sublease' && !form.sublease_end_date) e.sublease_end_date = 'Enter the date your sublease ends.'
      } else {
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

  // ── Photo upload ──
  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setUploading(false); return }

    const ext = file.name.split('.').pop()
    const path = `${user.id}/listings/hero-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: true })
    if (error) { setUploading(false); return }

    const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
    set('hero_image', publicUrl)
    setUploading(false)
    e.target.value = ''
  }

  // ── Final submit ──
  const handlePublish = async () => {
    setSubmitting(true)
    setSubmitError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { slug, error } = await createProperty(user.id, {
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
      hero_image: form.hero_image,
    })

    setSubmitting(false)
    if (error || !slug) { setSubmitError('Something went wrong. Please try again.'); return }
    router.push(`/landlord/listings/${slug}`)
  }

  const LISTING_TYPE_LABELS: Record<ListingType, string> = {
    standard_rental: 'Standard Rental',
    sublease: 'Sublease',
    lease_transfer: 'Lease Transfer',
  }
  const UNIT_TYPE_LABELS: Record<UnitType, string> = {
    room_in_house: 'Room in a house',
    apartment: 'Apartment unit',
    condo: 'Condo',
    studio: 'Studio',
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .wiz-wrap { max-width: 640px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .wiz-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #9b9b9b; text-decoration: none; margin-bottom: 24px; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; padding: 0; }
        .wiz-back:hover { color: #1a1a1a; }

        /* Progress */
        .wiz-progress { margin-bottom: 36px; }
        .wiz-steps { display: flex; gap: 4px; margin-bottom: 8px; }
        .wiz-step-bar { flex: 1; height: 3px; border-radius: 10px; background: #e8e4db; transition: background 0.2s; }
        .wiz-step-bar.done { background: #10b981; }
        .wiz-step-bar.active { background: #8C1D40; }
        .wiz-step-label { font-size: 12px; color: #9b9b9b; }
        .wiz-step-label strong { color: #1a1a1a; }

        /* Card */
        .wiz-card { background: #fff; border: 1px solid #e8e4db; border-radius: 16px; padding: 28px; margin-bottom: 16px; }
        .wiz-card-title { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 300; color: #1a1a1a; letter-spacing: -0.4px; margin-bottom: 4px; }
        .wiz-card-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 24px; }

        /* Type selection cards */
        .type-grid { display: flex; flex-direction: column; gap: 10px; }
        .type-opt { border: 2px solid #e8e4db; border-radius: 12px; padding: 16px 18px; cursor: pointer; display: flex; align-items: flex-start; gap: 14px; transition: border-color 0.15s, background 0.15s; background: #fff; width: 100%; text-align: left; font-family: 'DM Sans', sans-serif; }
        .type-opt:hover { border-color: #c5c1b8; }
        .type-opt.selected { border-color: #8C1D40; background: #fdf2f5; }
        .type-opt-icon { font-size: 24px; flex-shrink: 0; width: 36px; text-align: center; }
        .type-opt-body { flex: 1; }
        .type-opt-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 3px; }
        .type-opt-desc { font-size: 12px; color: #6b6b6b; line-height: 1.5; }
        .type-opt-who { font-size: 11px; font-weight: 600; color: #9b9b9b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.4px; }

        /* Unit type grid */
        .unit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .unit-opt { border: 2px solid #e8e4db; border-radius: 10px; padding: 14px 16px; cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; color: #1a1a1a; transition: border-color 0.15s, background 0.15s; background: #fff; font-family: 'DM Sans', sans-serif; }
        .unit-opt:hover { border-color: #c5c1b8; }
        .unit-opt.selected { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }
        .unit-opt-icon { font-size: 18px; }

        /* Fields */
        .field-group { display: flex; flex-direction: column; gap: 14px; }
        .field-wrap { display: flex; flex-direction: column; gap: 5px; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .field-label { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #9b9b9b; }
        .field-input { padding: 10px 13px; border: 1.5px solid #e8e4db; border-radius: 9px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #fff; outline: none; transition: border-color 0.15s; width: 100%; }
        .field-input:focus { border-color: #8C1D40; }
        .field-input::placeholder { color: #c5c1b8; }
        .field-input.error { border-color: #f5c6d0; }
        .field-error { font-size: 11px; color: #8C1D40; margin-top: 2px; }
        textarea.field-input { resize: vertical; min-height: 80px; }

        /* Photo */
        .photo-drop { border: 2px dashed #e8e4db; border-radius: 12px; padding: 40px 24px; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
        .photo-drop:hover { border-color: #8C1D40; background: #fdf2f5; }
        .photo-preview { width: 100%; height: 200px; object-fit: cover; border-radius: 10px; display: block; }

        /* Review */
        .review-section { margin-bottom: 20px; }
        .review-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #9b9b9b; margin-bottom: 6px; }
        .review-row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0; border-bottom: 1px solid #f0ede6; color: #1a1a1a; gap: 12px; }
        .review-val { font-weight: 500; text-align: right; }

        /* Nav buttons */
        .wiz-nav { display: flex; gap: 10px; }
        .btn-back { flex: 1; padding: 13px; background: #fff; color: #1a1a1a; border: 1.5px solid #e8e4db; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: border-color 0.15s; }
        .btn-back:hover { border-color: #1a1a1a; }
        .btn-next { flex: 2; padding: 13px; background: #1a1a1a; color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .btn-next:hover:not(:disabled) { background: #333; }
        .btn-next:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-publish { flex: 2; padding: 13px; background: #8C1D40; color: #fff; border: none; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background 0.2s; }
        .btn-publish:hover:not(:disabled) { background: #7a1835; }
        .btn-publish:disabled { opacity: 0.6; cursor: not-allowed; }

        @keyframes spin { to { transform: rotate(360deg); } }

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
                  <span className="type-opt-icon">{opt.icon}</span>
                  <div className="type-opt-body">
                    <div className="type-opt-title">{opt.title}</div>
                    <div className="type-opt-desc">{opt.desc}</div>
                    <div className="type-opt-who">{opt.who}</div>
                  </div>
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
            <div className="wiz-card-sub">
              {isSubleaseType ? 'Help students understand what they\'re moving into.' : 'Basic details about your property.'}
            </div>

            {isSubleaseType ? (
              <div className="field-group">
                <div className="field-wrap">
                  <div className="field-label">Unit type</div>
                  <div className="unit-grid">
                    {UNIT_TYPES.map(u => (
                      <button
                        key={u.type}
                        className={`unit-opt${form.unit_type === u.type ? ' selected' : ''}`}
                        onClick={() => set('unit_type', u.type)}
                      >
                        <span className="unit-opt-icon">{u.icon}</span> {u.label}
                      </button>
                    ))}
                  </div>
                  {errors.unit_type && <div className="field-error">{errors.unit_type}</div>}
                </div>

                <div className="field-row">
                  <div className="field-wrap">
                    <label className="field-label">Total people in unit</label>
                    <input
                      type="number"
                      min="1"
                      className={`field-input${errors.roommates_count ? ' error' : ''}`}
                      placeholder="e.g. 4"
                      value={form.roommates_count}
                      onChange={e => set('roommates_count', e.target.value)}
                    />
                    {errors.roommates_count && <div className="field-error">{errors.roommates_count}</div>}
                  </div>

                  {form.listing_type === 'sublease' && (
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
                  )}
                </div>
              </div>
            ) : (
              <div className="field-group">
                <div className="field-row">
                  <div className="field-wrap">
                    <label className="field-label">Bedrooms</label>
                    <input
                      type="number"
                      min="1"
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
                      type="number"
                      min="1"
                      step="0.5"
                      className={`field-input${errors.baths ? ' error' : ''}`}
                      placeholder="e.g. 2"
                      value={form.baths}
                      onChange={e => set('baths', e.target.value)}
                    />
                    {errors.baths && <div className="field-error">{errors.baths}</div>}
                  </div>
                </div>
                <div className="field-wrap">
                  <label className="field-label">Square footage <span style={{ textTransform: 'none', fontWeight: 400, color: '#c5c1b8' }}>(optional)</span></label>
                  <input
                    type="text"
                    className="field-input"
                    placeholder="e.g. 1,100"
                    value={form.sqft}
                    onChange={e => set('sqft', e.target.value)}
                  />
                </div>
              </div>
            )}
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
                  type="number"
                  min="0"
                  step="0.1"
                  className={`field-input${errors.asu_distance ? ' error' : ''}`}
                  placeholder="e.g. 0.8"
                  value={form.asu_distance}
                  onChange={e => set('asu_distance', e.target.value)}
                />
                {errors.asu_distance && <div className="field-error">{errors.asu_distance}</div>}
              </div>
              <div className="field-wrap">
                <label className="field-label">Description <span style={{ textTransform: 'none', fontWeight: 400, color: '#c5c1b8' }}>(optional)</span></label>
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
                  type="number"
                  min="1"
                  className={`field-input${errors.price ? ' error' : ''}`}
                  placeholder="e.g. 750"
                  value={form.price}
                  onChange={e => set('price', e.target.value)}
                />
                {errors.price && <div className="field-error">{errors.price}</div>}
              </div>

              {!isSubleaseType && (
                <div className="field-wrap">
                  <label className="field-label">Available rooms</label>
                  <input
                    type="number"
                    min="1"
                    className="field-input"
                    placeholder="e.g. 2"
                    value={form.available}
                    onChange={e => set('available', e.target.value)}
                  />
                </div>
              )}

              <div className="field-wrap">
                <label className="field-label">Available from <span style={{ textTransform: 'none', fontWeight: 400, color: '#c5c1b8' }}>(optional)</span></label>
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

        {/* ── STEP 4: Photo ── */}
        {step === 4 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Add a hero photo.</div>
            <div className="wiz-card-sub">Listings with photos get 3× more leads. You can add more photos after publishing.</div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handlePhoto}
            />

            {form.hero_image ? (
              <div>
                <img src={form.hero_image} alt="Hero" className="photo-preview" style={{ marginBottom: '12px' }} />
                <button
                  onClick={() => { set('hero_image', ''); }}
                  style={{ font: 'inherit', fontSize: '12px', color: '#9b9b9b', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  Remove photo
                </button>
              </div>
            ) : (
              <div className="photo-drop" onClick={() => fileRef.current?.click()}>
                {uploading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', color: '#9b9b9b' }}>
                    <div style={{ width: '24px', height: '24px', border: '2px solid #e8e4db', borderTopColor: '#8C1D40', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                    <span style={{ fontSize: '13px' }}>Uploading…</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '32px', marginBottom: '8px' }}>📷</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', marginBottom: '4px' }}>Click to upload a photo</div>
                    <div style={{ fontSize: '12px', color: '#9b9b9b' }}>JPG, PNG or WebP · max 10MB</div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: Review ── */}
        {step === 5 && (
          <div className="wiz-card">
            <div className="wiz-card-title">Review your listing.</div>
            <div className="wiz-card-sub">Everything look good? Hit publish and your listing goes live immediately.</div>

            {form.hero_image && (
              <img src={form.hero_image} alt="Hero" className="photo-preview" style={{ marginBottom: '20px' }} />
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
              {form.roommates_count && (
                <div className="review-row">
                  <span>People in unit</span>
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
              {form.sqft && <div className="review-row"><span>Sqft</span><span className="review-val">{form.sqft}</span></div>}
            </div>

            <div className="review-section">
              <div className="review-label">Location</div>
              <div className="review-row"><span>Title</span><span className="review-val">{form.name}</span></div>
              <div className="review-row"><span>Address</span><span className="review-val" style={{ maxWidth: '60%' }}>{form.address}</span></div>
              <div className="review-row"><span>Distance to ASU</span><span className="review-val">{form.asu_distance} mi</span></div>
            </div>

            <div className="review-section">
              <div className="review-label">Pricing</div>
              <div className="review-row"><span>Monthly rent</span><span className="review-val" style={{ color: '#10b981', fontWeight: 700 }}>${Number(form.price).toLocaleString()}/mo</span></div>
              {!isSubleaseType && <div className="review-row"><span>Available rooms</span><span className="review-val">{form.available}</span></div>}
            </div>

            {submitError && (
              <div style={{ background: '#fdf2f5', border: '1px solid #f5c6d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#8C1D40', marginBottom: '16px' }}>
                {submitError}
              </div>
            )}
          </div>
        )}

        {/* ── Skip photo hint (step 4 only) ── */}
        {step === 4 && !form.hero_image && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <button
              onClick={() => setStep(5)}
              style={{ font: 'inherit', fontSize: '13px', color: '#9b9b9b', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
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
            <button className="btn-next" onClick={next}>
              {step === 4 && form.hero_image ? 'Continue →' : step === 4 ? 'Skip & continue →' : 'Continue →'}
            </button>
          ) : (
            <button className="btn-publish" onClick={handlePublish} disabled={submitting}>
              {submitting ? 'Publishing…' : 'Publish listing →'}
            </button>
          )}
        </div>

      </div>
    </>
  )
}
