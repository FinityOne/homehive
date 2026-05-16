'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getPropertiesByOwner, updatePropertyCore, replacePropertyRooms, Property } from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type RoomRow = { id?: string; name: string; price: string; is_available: boolean; images?: string[] }

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
    security_deposit: '',
    beds: '',
    baths: '',
    sqft: '',
    asu_distance: '',
    asu_score: '',
    utilities_included: false,
    rental_mode: 'whole_home' as 'whole_home' | 'by_room',
  })

  const [rooms, setRooms] = useState<RoomRow[]>([{ name: '', price: '', is_available: true }])

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
        security_deposit: found.security_deposit?.toString() ?? '',
        beds: found.beds?.toString() || '',
        baths: found.baths?.toString() || '',
        sqft: found.sqft?.toString() || '',
        asu_distance: found.asu_distance?.toString() || '',
        asu_score: found.asu_score?.toString() || '',
        utilities_included: found.utilities_included ?? false,
        rental_mode: found.rental_mode ?? 'whole_home',
      })

      if (found.rooms && found.rooms.length > 0) {
        setRooms(found.rooms.map(r => ({
          id: r.id,
          name: r.name,
          price: r.price.toString(),
          is_available: r.is_available,
          images: r.images,
        })))
      }

      setLoading(false)
    }
    load()
  }, [slug, router])

  // Room helpers
  const updateRoom = (i: number, field: keyof RoomRow, value: string | boolean) => {
    setRooms(rs => rs.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }
  const addRoom = () => setRooms(rs => [...rs, { name: '', price: '', is_available: true }])
  const removeRoom = (i: number) => setRooms(rs => rs.filter((_, idx) => idx !== i))

  const isByRoom = form.rental_mode === 'by_room'
  const roomTotal = rooms.reduce((s, r) => s + (Number(r.price) || 0), 0)
  const roomMinPrice = rooms.length > 0 ? Math.min(...rooms.filter(r => Number(r.price) > 0).map(r => Number(r.price))) : 0

  async function handleSave() {
    if (!property) return
    setSaving(true)
    setErrorMsg('')
    setSuccessMsg('')

    // Core property fields
    const updates: any = {
      name: form.name,
      address: form.address,
      description: form.description,
      beds: parseInt(form.beds) || 0,
      baths: parseFloat(form.baths) || 0,
      sqft: form.sqft,
      asu_distance: parseFloat(form.asu_distance) || 0,
      asu_score: parseFloat(form.asu_score) || 0,
      utilities_included: form.utilities_included,
      security_deposit: form.security_deposit === '' ? null : parseInt(form.security_deposit),
      rental_mode: form.rental_mode,
    }

    if (isByRoom) {
      // Price, total_rooms, available are synced from rooms
      const validRooms = rooms.filter(r => r.name.trim() && Number(r.price) > 0)
      if (validRooms.length === 0) {
        setErrorMsg('Add at least one room with a name and price.')
        setSaving(false)
        return
      }
      const { error: roomErr } = await replacePropertyRooms(
        property.id,
        validRooms.map(r => ({ name: r.name.trim(), price: Number(r.price), is_available: r.is_available })),
        true
      )
      if (roomErr) {
        setErrorMsg('Failed to save rooms. Please try again.')
        setSaving(false)
        return
      }
    } else {
      // Whole home: use single price field
      updates.price = parseFloat(form.price) || 0
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

        /* Rental mode toggle */
        .mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
        .mode-opt { border: 2px solid #e2e8f0; border-radius: 10px; padding: 13px 14px; cursor: pointer; text-align: left; background: #fff; font-family: 'DM Sans', sans-serif; transition: border-color 0.15s, background 0.15s; width: 100%; }
        .mode-opt:hover { border-color: #94a3b8; }
        .mode-opt.selected { border-color: #10b981; background: #f0fdf4; }
        .mode-opt-title { font-size: 13px; font-weight: 600; color: #0f172a; margin-bottom: 3px; }
        .mode-opt.selected .mode-opt-title { color: #166534; }
        .mode-opt-desc { font-size: 11px; color: #64748b; line-height: 1.4; }

        /* Room builder */
        .rooms-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-top: 6px; }
        .rooms-header { display: grid; grid-template-columns: 1fr 110px 80px auto; gap: 8px; margin-bottom: 8px; padding: 0 2px; }
        .rooms-col-label { font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
        .room-row { display: grid; grid-template-columns: 1fr 110px 80px auto; gap: 8px; align-items: center; margin-bottom: 8px; }
        .room-avail-btn { padding: 8px 10px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1.5px solid; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: all 0.15s; }
        .room-avail-btn.avail { border-color: #10b981; background: #f0fdf4; color: #10b981; }
        .room-avail-btn.filled { border-color: #e2e8f0; background: #fff; color: #94a3b8; }
        .room-remove-btn { background: #fef2f2; color: #ef4444; border: 1.5px solid #fecaca; border-radius: 7px; padding: 8px 10px; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .room-remove-btn:hover { background: #fee2e2; }
        .btn-add-room { background: #fff; color: #334155; border: 1.5px dashed #cbd5e1; border-radius: 7px; padding: 9px 14px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; width: 100%; margin-top: 4px; }
        .btn-add-room:hover { background: #f1f5f9; }
        .room-summary { display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-top: 12px; }
        .room-summary-label { font-size: 12px; color: #64748b; }
        .room-summary-val { font-size: 15px; font-weight: 700; color: #0f172a; }
        .room-summary-from { font-size: 11px; color: #10b981; font-weight: 500; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .section-divider { height: 1px; background: #e2e8f0; margin: 24px 0; }

        @media (max-width: 480px) {
          .form-row { grid-template-columns: 1fr; }
          .mode-grid { grid-template-columns: 1fr; }
          .rooms-header { grid-template-columns: 1fr 90px; }
          .room-row { grid-template-columns: 1fr 90px; }
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

        <div className="section-divider" />

        {/* Rental mode */}
        <div className="form-group">
          <label className="form-label">Rental Type</label>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
            Choose whether you rent the entire property or price each room/unit individually.
          </div>
          <div className="mode-grid">
            <button
              className={`mode-opt${form.rental_mode === 'whole_home' ? ' selected' : ''}`}
              onClick={() => setForm(f => ({ ...f, rental_mode: 'whole_home' }))}
            >
              <div className="mode-opt-title">Entire property</div>
              <div className="mode-opt-desc">One price for the whole unit — house, apartment, or condo</div>
            </button>
            <button
              className={`mode-opt${form.rental_mode === 'by_room' ? ' selected' : ''}`}
              onClick={() => setForm(f => ({ ...f, rental_mode: 'by_room' }))}
            >
              <div className="mode-opt-title">By room / by unit</div>
              <div className="mode-opt-desc">Each bedroom or unit has its own name and price</div>
            </button>
          </div>
        </div>

        {/* Price — whole home only */}
        {!isByRoom && (
          <div className="form-row" style={{ marginBottom: '18px' }}>
            <div className="form-group" style={{ margin: 0 }}>
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
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Security Deposit ($) <span style={{ fontWeight: 400, textTransform: 'none', color: '#94a3b8' }}>— 0 for none</span></label>
              <input
                className="form-input"
                type="number"
                min="0"
                value={form.security_deposit}
                onChange={e => setForm(f => ({ ...f, security_deposit: e.target.value }))}
                placeholder="e.g. 699 or 0"
              />
              {form.security_deposit === '0' && (
                <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}>No deposit — shown as $0 on listing</div>
              )}
            </div>
          </div>
        )}

        {/* Room builder — by room mode */}
        {isByRoom && (
          <div className="form-group">
            <label className="form-label">Rooms / Units</label>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
              Define each room or unit with a name, monthly price, and availability status.
            </div>
            <div className="rooms-section">
              <div className="rooms-header">
                <div className="rooms-col-label">Room / Unit name</div>
                <div className="rooms-col-label">Price/mo ($)</div>
                <div className="rooms-col-label">Status</div>
                <div />
              </div>

              {rooms.map((room, i) => (
                <div key={i} className="room-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder={`e.g. ${i === 0 ? 'Master Bedroom' : i === 1 ? 'Room B' : `Unit ${101 + i}`}`}
                    value={room.name}
                    onChange={e => updateRoom(i, 'name', e.target.value)}
                  />
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    placeholder="700"
                    value={room.price}
                    onChange={e => updateRoom(i, 'price', e.target.value)}
                  />
                  <button
                    className={`room-avail-btn ${room.is_available ? 'avail' : 'filled'}`}
                    onClick={() => updateRoom(i, 'is_available', !room.is_available)}
                  >
                    {room.is_available ? 'Open' : 'Filled'}
                  </button>
                  {rooms.length > 1 ? (
                    <button className="room-remove-btn" onClick={() => removeRoom(i)} title="Remove room">✕</button>
                  ) : (
                    <div />
                  )}
                </div>
              ))}

              <button className="btn-add-room" onClick={addRoom}>+ Add room / unit</button>

              {rooms.length > 0 && rooms.some(r => Number(r.price) > 0) && (
                <div className="room-summary">
                  <div>
                    <div className="room-summary-label">{rooms.filter(r => r.is_available).length} of {rooms.length} rooms available</div>
                    {roomMinPrice > 0 && (
                      <div className="room-summary-from">Listing shows "from ${roomMinPrice.toLocaleString()}/mo"</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="room-summary-label">Total potential rent</div>
                    <div className="room-summary-val">${roomTotal.toLocaleString()}/mo</div>
                  </div>
                </div>
              )}
            </div>

            {/* Security deposit for by_room mode */}
            <div style={{ marginTop: '16px' }}>
              <label className="form-label">Security Deposit ($) <span style={{ fontWeight: 400, textTransform: 'none', color: '#94a3b8' }}>— 0 for none</span></label>
              <input
                className="form-input"
                type="number"
                min="0"
                value={form.security_deposit}
                onChange={e => setForm(f => ({ ...f, security_deposit: e.target.value }))}
                placeholder="e.g. 699 or 0"
              />
              {form.security_deposit === '0' && (
                <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}>No deposit — shown as $0 on listing</div>
              )}
            </div>
          </div>
        )}

        {/* Utilities */}
        <div className="form-group">
          <label className="form-label">Utilities</label>
          <div
            onClick={() => setForm(f => ({ ...f, utilities_included: !f.utilities_included }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: `1.5px solid ${form.utilities_included ? '#10b981' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', background: form.utilities_included ? '#f0fdf4' : '#fff', transition: 'all 0.15s', userSelect: 'none' }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                {form.utilities_included ? 'Utilities included' : 'Utilities not included'}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Water, electric, gas — covered in rent</div>
            </div>
            <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: form.utilities_included ? '#10b981' : '#e2e8f0', transition: 'background 0.2s', position: 'relative', flexShrink: 0 }}>
              <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', transition: 'left 0.2s', left: form.utilities_included ? '21px' : '3px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
          </div>
        </div>

        <div className="section-divider" />

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
            <label className="form-label">ASU Distance (miles)</label>
            <input
              className="form-input"
              type="number"
              min="0"
              value={form.asu_distance}
              onChange={e => setForm(f => ({ ...f, asu_distance: e.target.value }))}
              placeholder="0.8"
            />
          </div>
        </div>

        <div className="form-row">
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
