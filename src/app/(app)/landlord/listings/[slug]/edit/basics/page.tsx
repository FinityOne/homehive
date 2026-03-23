'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, updatePropertyCore, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function EditBasicsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [form, setForm] = useState({
    name: '',
    address: '',
    description: '',
    price: '',
    beds: '',
    baths: '',
    sqft: '',
    asu_distance: '',
    asu_score: '',
  })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setForm({
        name: found.name || '',
        address: found.address || '',
        description: found.description || '',
        price: found.price?.toString() || '',
        beds: found.beds?.toString() || '',
        baths: found.baths?.toString() || '',
        sqft: found.sqft?.toString() || '',
        asu_distance: found.asu_distance?.toString() || '',
        asu_score: found.asu_score?.toString() || '',
      })
      setLoading(false)
    }
    load()
  }, [slug, router])

  async function handleSave() {
    if (!property) return
    setSaving(true)
    setErrorMsg('')
    setSuccessMsg('')

    const updates: any = {
      name: form.name,
      address: form.address,
      description: form.description,
      price: parseFloat(form.price) || 0,
      beds: parseInt(form.beds) || 0,
      baths: parseFloat(form.baths) || 0,
      sqft: form.sqft,
      asu_distance: parseFloat(form.asu_distance) || 0,
      asu_score: parseFloat(form.asu_score) || 0,
    }

    const { error } = await updatePropertyCore(property.id, updates)
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
        .form-textarea { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; resize: vertical; min-height: 100px; transition: border-color 0.15s; }
        .form-textarea:focus { border-color: #10b981; }

        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

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
          Edit Basics
        </div>

        <h1 className="edit-title">Core Details</h1>

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        <div className="form-group">
          <label className="form-label">Property Name</label>
          <input
            className="form-input"
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. University Dr Palace"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Address</label>
          <input
            className="form-input"
            type="text"
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            placeholder="e.g. 820 W 9th Street, Tempe, AZ 85281"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-textarea"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Describe your property — mention key features, what's nearby, and why students love it..."
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Price per Month ($)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              placeholder="699"
            />
          </div>
          <div className="form-group">
            <label className="form-label">ASU Distance (minutes)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={form.asu_distance}
              onChange={e => setForm(f => ({ ...f, asu_distance: e.target.value }))}
              placeholder="5"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Bedrooms</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={form.beds}
              onChange={e => setForm(f => ({ ...f, beds: e.target.value }))}
              placeholder="4"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Bathrooms</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.5"
              value={form.baths}
              onChange={e => setForm(f => ({ ...f, baths: e.target.value }))}
              placeholder="2"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Square Footage</label>
            <input
              className="form-input"
              type="text"
              value={form.sqft}
              onChange={e => setForm(f => ({ ...f, sqft: e.target.value }))}
              placeholder="1200"
            />
          </div>
          <div className="form-group">
            <label className="form-label">ASU Score (0–100)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              max="100"
              value={form.asu_score}
              onChange={e => setForm(f => ({ ...f, asu_score: e.target.value }))}
              placeholder="95"
            />
          </div>
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
