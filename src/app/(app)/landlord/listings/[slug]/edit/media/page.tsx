'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, updatePropertyCore, replacePropertyImages, Property } from '@/lib/properties'

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

  const [heroImage, setHeroImage] = useState('')
  const [galleryImages, setGalleryImages] = useState<string[]>([])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

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

    const { error: imgError } = await replacePropertyImages(property.id, filteredGallery)
    setSaving(false)

    if (imgError) {
      setErrorMsg('Hero image saved, but gallery failed to save. Please try again.')
    } else {
      setSuccessMsg('Photos saved successfully!')
      setTimeout(() => {
        router.push(`/landlord/listings/${slug}`)
      }, 1200)
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
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .edit-wrap { max-width: 680px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .edit-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 20px; }
        .edit-breadcrumb a { color: #10b981; text-decoration: none; }
        .edit-breadcrumb a:hover { text-decoration: underline; }
        .edit-title { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 24px; }

        .section-heading { font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; margin-top: 24px; }

        .form-group { margin-bottom: 18px; }
        .form-label { display: block; font-size: 12px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; }
        .form-input { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; transition: border-color 0.15s; }
        .form-input:focus { border-color: #10b981; }

        .hero-preview { width: 100%; max-height: 180px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 8px; display: block; }

        .gallery-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .gallery-row .form-input { flex: 1; margin-bottom: 0; }
        .btn-remove { background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; border-radius: 7px; padding: 7px 12px; font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; flex-shrink: 0; }
        .btn-remove:hover { background: #fee2e2; }

        .btn-add-img { background: #f1f5f9; color: #334155; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; width: 100%; margin-top: 4px; }
        .btn-add-img:hover { background: #e2e8f0; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .coming-soon-note { font-size: 12px; color: #94a3b8; margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; }
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

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        <div className="form-group">
          <label className="form-label">Hero Image URL</label>
          <input
            className="form-input"
            type="url"
            value={heroImage}
            onChange={e => setHeroImage(e.target.value)}
            placeholder="https://example.com/hero.jpg"
          />
          {heroImage && (
            <img src={heroImage} alt="Hero preview" className="hero-preview" />
          )}
        </div>

        <div className="section-heading">Gallery Images</div>

        {galleryImages.map((url, i) => (
          <div key={i} className="gallery-row">
            <input
              className="form-input"
              type="url"
              value={url}
              onChange={e => updateImage(i, e.target.value)}
              placeholder={`https://example.com/photo-${i + 1}.jpg`}
            />
            <button className="btn-remove" onClick={() => removeImage(i)} title="Remove image">
              ✕
            </button>
          </div>
        ))}

        <button className="btn-add-img" onClick={addImage}>
          + Add image URL
        </button>

        <div className="form-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <a href={`/landlord/listings/${slug}`} className="btn-cancel">Cancel</a>
        </div>

        <div className="coming-soon-note">
          Full image upload (drag &amp; drop) coming soon — for now, paste image URLs directly.
        </div>
      </div>
    </>
  )
}
