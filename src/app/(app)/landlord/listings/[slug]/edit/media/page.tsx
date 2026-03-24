'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, updatePropertyCore, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function EditMediaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [userId, setUserId] = useState('')
  const [heroImage, setHeroImage] = useState('')
  const [galleryImages, setGalleryImages] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setHeroImage(found.hero_image || '')
      setGalleryImages(found.images || [])
      setLoading(false)
    }
    load()
  }, [slug, router])

  async function handleSave() {
    if (!property) return
    setSaving(true)
    setErrorMsg('')
    setSuccessMsg('')

    const filteredGallery = galleryImages.filter(url => url.trim() !== '')

    const { error: coreError } = await updatePropertyCore(property.id, {
      hero_image: heroImage,
    })

    if (coreError) {
      setSaving(false)
      setErrorMsg('Failed to save hero image. Please try again.')
      return
    }

    const res = await fetch(`/api/properties/${property.id}/images`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: filteredGallery, ownerId: userId }),
    })
    setSaving(false)

    if (!res.ok) {
      setErrorMsg('Hero image saved, but gallery failed to save. Please try again.')
    } else {
      setSuccessMsg('Photos saved successfully!')
      setTimeout(() => router.push(`/landlord/listings/${slug}`), 1200)
    }
  }

  function addImage() {
    setGalleryImages(imgs => [...imgs, ''])
  }

  function updateImage(index: number, value: string) {
    setGalleryImages(imgs => imgs.map((img, i) => i === index ? value : img))
  }

  function removeImage(index: number) {
    setGalleryImages(imgs => imgs.filter((_, i) => i !== index))
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
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .edit-wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .edit-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 20px; }
        .edit-breadcrumb a { color: #10b981; text-decoration: none; }
        .edit-breadcrumb a:hover { text-decoration: underline; }
        .edit-title { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
        .edit-subtitle { font-size: 14px; color: #64748b; margin-bottom: 28px; }

        .section-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; margin-bottom: 20px; }
        .section-heading { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 14px; }

        .hero-block { display: grid; grid-template-columns: 1fr 220px; gap: 16px; align-items: start; }
        @media (max-width: 560px) { .hero-block { grid-template-columns: 1fr; } }

        .form-label { display: block; font-size: 12px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; }
        .form-input { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; transition: border-color 0.15s; }
        .form-input:focus { border-color: #10b981; }
        .form-input::placeholder { color: #94a3b8; }

        .img-preview { width: 100%; aspect-ratio: 16/10; object-fit: cover; border-radius: 8px; border: 1.5px solid #e2e8f0; display: block; background: #f8fafc; }
        .img-placeholder { width: 100%; aspect-ratio: 16/10; border-radius: 8px; border: 1.5px dashed #cbd5e1; background: #f8fafc; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 6px; color: #94a3b8; font-size: 13px; }

        .hero-badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #8C1D40; background: #fdf2f5; border: 1px solid #f4c9d5; border-radius: 20px; padding: 3px 10px; margin-bottom: 10px; }

        .gallery-list { display: flex; flex-direction: column; gap: 12px; }
        .gallery-item { display: grid; grid-template-columns: 100px 1fr auto; gap: 12px; align-items: start; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px; }
        @media (max-width: 500px) { .gallery-item { grid-template-columns: 1fr auto; } .gallery-thumb { display: none; } }

        .gallery-thumb { width: 100px; aspect-ratio: 1; object-fit: cover; border-radius: 7px; border: 1px solid #e2e8f0; display: block; background: #fff; }
        .gallery-thumb-placeholder { width: 100px; aspect-ratio: 1; border-radius: 7px; border: 1.5px dashed #cbd5e1; background: #fff; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 22px; }

        .gallery-input-col { display: flex; flex-direction: column; gap: 6px; }
        .gallery-index { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; }

        .btn-remove { background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; border-radius: 7px; padding: 7px 10px; font-size: 14px; cursor: pointer; font-family: 'DM Sans', sans-serif; flex-shrink: 0; line-height: 1; transition: background 0.15s; }
        .btn-remove:hover { background: #fee2e2; }

        .btn-add-img { background: #fff; color: #334155; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 12px 16px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; width: 100%; margin-top: 4px; transition: background 0.15s, border-color 0.15s; }
        .btn-add-img:hover { background: #f1f5f9; border-color: #94a3b8; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .count-badge { font-size: 12px; color: #64748b; margin-left: 6px; font-weight: 400; text-transform: none; letter-spacing: 0; }
      `}</style>

      <div className="edit-wrap">
        <div className="edit-breadcrumb">
          <a href="/landlord/listings">Listings</a>
          {' › '}
          <a href={`/landlord/listings/${slug}`}>{property?.name}</a>
          {' › '}
          Edit Photos
        </div>

        <h1 className="edit-title">Photos</h1>
        <p className="edit-subtitle">Paste image URLs to set your hero photo and gallery images.</p>

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        {/* Hero Image */}
        <div className="section-card">
          <div className="section-heading">
            <span className="hero-badge">Hero</span> Cover Photo
          </div>
          <div className="hero-block">
            <div>
              <label className="form-label">Image URL</label>
              <input
                className="form-input"
                type="url"
                value={heroImage}
                onChange={e => setHeroImage(e.target.value)}
                placeholder="https://example.com/hero.jpg"
              />
              <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
                This is the main photo shown in listings and emails.
              </p>
            </div>
            <div>
              {heroImage ? (
                <img src={heroImage} alt="Hero preview" className="img-preview" />
              ) : (
                <div className="img-placeholder">
                  <span style={{ fontSize: '28px' }}>🖼️</span>
                  <span>No image yet</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Gallery Images */}
        <div className="section-card">
          <div className="section-heading">
            Gallery Images
            <span className="count-badge">
              {galleryImages.filter(u => u.trim() !== '').length} photo{galleryImages.filter(u => u.trim() !== '').length !== 1 ? 's' : ''}
            </span>
          </div>

          {galleryImages.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>No gallery images yet. Add one below.</p>
          ) : (
            <div className="gallery-list">
              {galleryImages.map((url, i) => (
                <div key={i} className="gallery-item">
                  <div className="gallery-thumb">
                    {url.trim() ? (
                      <img src={url} alt={`Photo ${i + 1}`} className="gallery-thumb" />
                    ) : (
                      <div className="gallery-thumb-placeholder">📷</div>
                    )}
                  </div>
                  <div className="gallery-input-col">
                    <span className="gallery-index">Photo {i + 1}</span>
                    <input
                      className="form-input"
                      type="url"
                      value={url}
                      onChange={e => updateImage(i, e.target.value)}
                      placeholder={`https://example.com/photo-${i + 1}.jpg`}
                    />
                  </div>
                  <button className="btn-remove" onClick={() => removeImage(i)} title="Remove image">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="btn-add-img" onClick={addImage} style={{ marginTop: galleryImages.length > 0 ? '12px' : '0' }}>
            + Add image URL
          </button>
        </div>

        <div className="form-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <a href={`/landlord/listings/${slug}`} className="btn-cancel">Cancel</a>
        </div>
      </div>
    </>
  )
}
