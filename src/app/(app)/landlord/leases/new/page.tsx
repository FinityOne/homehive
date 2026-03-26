'use client'

import { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { createLease, addLeaseDocument } from '@/lib/leases'
import { getPropertiesByOwner } from '@/lib/properties'
import { getTenantsByOwner, type Tenant } from '@/lib/tenants'
import type { Property } from '@/lib/properties'
import type { TenantInput } from '@/lib/leases'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function NewLeasePage() {
  const router = useRouter()
  const userIdRef = useRef<string | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [allTenants, setAllTenants] = useState<Tenant[]>([])
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [form, setForm] = useState({
    property_id: '',
    unit_number: '',
    start_date: '',
    end_date: '',
    rent_amount: '',
    notes: '',
  })

  const [pendingDocs, setPendingDocs] = useState<{ file: File; name: string }[]>([])
  const [tenants, setTenants] = useState<TenantInput[]>([])
  const [tenantSearch, setTenantSearch] = useState('')
  const [showTenantSearch, setShowTenantSearch] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      userIdRef.current = user.id
      Promise.all([getPropertiesByOwner(user.id), getTenantsByOwner(user.id)]).then(([props, ts]) => {
        setProperties(props)
        setAllTenants(ts)
      })
    })
  }, [router])

  const alreadyAddedIds = new Set(tenants.map(t => t.tenant_id).filter(Boolean))

  const filteredTenants = allTenants.filter(t => {
    if (alreadyAddedIds.has(t.id)) return false
    if (!tenantSearch.trim()) return true
    const q = tenantSearch.toLowerCase()
    return (
      t.first_name.toLowerCase().includes(q) ||
      t.last_name?.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q)
    )
  })

  function addTenant(t: Tenant) {
    setTenants(prev => [...prev, {
      tenant_id: t.id,
      lead_id: t.lead_id,
      name: [t.first_name, t.last_name].filter(Boolean).join(' '),
      email: t.email,
    }])
    setTenantSearch('')
    setShowTenantSearch(false)
  }

  function removeTenant(idx: number) {
    setTenants(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    const userId = userIdRef.current
    if (!userId) return
    if (!form.property_id) { setErrorMsg('Please select a property.'); return }
    if (!form.start_date || !form.end_date) { setErrorMsg('Please enter start and end dates.'); return }
    if (form.end_date <= form.start_date) { setErrorMsg('End date must be after start date.'); return }

    setSaving(true)
    setErrorMsg('')

    const { id, error } = await createLease(
      userId,
      {
        property_id: form.property_id,
        start_date: form.start_date,
        end_date: form.end_date,
        rent_amount: form.rent_amount ? parseInt(form.rent_amount) : null,
        unit_number: form.unit_number || null,
        notes: form.notes || null,
        document_url: null,
      },
      tenants
    )

    if (error || !id) {
      setSaving(false)
      setErrorMsg('Failed to create lease. Please try again.')
      return
    }

    // Upload all pending documents
    for (const pd of pendingDocs) {
      await addLeaseDocument(id, pd.file, pd.name)
    }

    setSaving(false)
    setSuccessMsg('Lease created!')
    setTimeout(() => router.push(`/landlord/leases/${id}`), 1000)
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
        .form-select { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; cursor: pointer; }
        .form-select:focus { border-color: #10b981; }
        .form-textarea { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; resize: vertical; min-height: 90px; transition: border-color 0.15s; }
        .form-textarea:focus { border-color: #10b981; }

        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .section-divider { border: none; border-top: 1px solid #e2e8f0; margin: 28px 0; }
        .section-label { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 14px; }
        .section-sub { font-size: 12px; color: #94a3b8; margin-bottom: 14px; }

        .tenant-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .tenant-row { display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
        .tenant-info { font-size: 14px; color: #0f172a; }
        .tenant-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
        .tenant-remove { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 4px; }
        .tenant-remove:hover { color: #ef4444; }

        .btn-add-tenant { background: #fff; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 9px 14px; font-size: 13px; font-weight: 500; color: #64748b; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-right: 8px; }
        .btn-add-tenant:hover { border-color: #10b981; color: #10b981; }
        .btn-go-tenants { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 9px 14px; font-size: 13px; font-weight: 500; color: #166534; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-go-tenants:hover { background: #dcfce7; }

        .tenant-search-box { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 8px; margin-top: 10px; overflow: hidden; }
        .tenant-search-input { width: 100%; border: none; border-bottom: 1px solid #e2e8f0; padding: 10px 12px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #0f172a; outline: none; }
        .tenant-search-item { padding: 10px 12px; cursor: pointer; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
        .tenant-search-item:last-child { border-bottom: none; }
        .tenant-search-item:hover { background: #f0fdf4; }
        .tenant-search-sub { font-size: 12px; color: #94a3b8; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .doc-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .doc-row { display: flex; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; }
        .doc-icon { font-size: 16px; flex-shrink: 0; }
        .doc-name-input { flex: 1; border: none; background: transparent; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; outline: none; }
        .doc-filename { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
        .doc-remove { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 4px; flex-shrink: 0; }
        .doc-remove:hover { color: #ef4444; }
        .btn-add-doc { background: #fff; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 9px 14px; font-size: 13px; font-weight: 500; color: #64748b; cursor: pointer; font-family: 'DM Sans', sans-serif; display: inline-block; }
        .btn-add-doc:hover { border-color: #10b981; color: #10b981; }
        .file-hint { font-size: 12px; color: #94a3b8; margin-top: 4px; }

        @media (max-width: 480px) {
          .form-row { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="edit-wrap">
        <div className="edit-breadcrumb">
          <a href="/landlord/leases">Leases</a>
          {' › '}
          New Lease
        </div>

        <h1 className="edit-title">New Lease</h1>

        {successMsg && <div className="alert-success">{successMsg}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        <div className="form-group">
          <label className="form-label">Property *</label>
          <select
            className="form-select"
            value={form.property_id}
            onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))}
          >
            <option value="">Select a property...</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Unit / Room Number</label>
          <input
            className="form-input"
            type="text"
            value={form.unit_number}
            onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))}
            placeholder="e.g. 4B, Room 2"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date *</label>
            <input
              className="form-input"
              type="date"
              value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">End Date *</label>
            <input
              className="form-input"
              type="date"
              value={form.end_date}
              onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Monthly Rent ($)</label>
          <input
            className="form-input"
            type="number"
            min="0"
            value={form.rent_amount}
            onChange={e => setForm(f => ({ ...f, rent_amount: e.target.value }))}
            placeholder="e.g. 850"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea
            className="form-textarea"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Any additional notes about this lease..."
          />
        </div>

        <div className="form-group">
          <label className="form-label">Documents</label>
          {pendingDocs.length > 0 && (
            <div className="doc-list">
              {pendingDocs.map((pd, i) => (
                <div key={i} className="doc-row">
                  <span className="doc-icon">📄</span>
                  <input
                    className="doc-name-input"
                    type="text"
                    value={pd.name}
                    onChange={e => setPendingDocs(prev => prev.map((d, j) => j === i ? { ...d, name: e.target.value } : d))}
                    placeholder="Document name"
                  />
                  <span className="doc-filename">{pd.file.name}</span>
                  <button className="doc-remove" onClick={() => setPendingDocs(prev => prev.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          <label className="btn-add-doc">
            + Add Document
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) {
                  setPendingDocs(prev => [...prev, { file, name: file.name.replace(/\.[^/.]+$/, '') }])
                  e.target.value = ''
                }
              }}
            />
          </label>
        </div>

        <hr className="section-divider" />
        <div className="section-label">Tenants</div>
        <div className="section-sub">
          Only tenants from your{' '}
          <a href="/landlord/tenants" style={{ color: '#10b981' }}>Tenants list</a>
          {' '}can be added to a lease.
        </div>

        {tenants.length > 0 && (
          <div className="tenant-list">
            {tenants.map((t, i) => (
              <div key={i} className="tenant-row">
                <div>
                  <div className="tenant-info">{t.name || '—'}</div>
                  {t.email && <div className="tenant-sub">{t.email}</div>}
                </div>
                <button className="tenant-remove" onClick={() => removeTenant(i)}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn-add-tenant"
            onClick={() => setShowTenantSearch(v => !v)}
          >
            + Add Tenant
          </button>
          <a href="/landlord/tenants" className="btn-go-tenants">
            Manage Tenants →
          </a>
        </div>

        {showTenantSearch && (
          <div className="tenant-search-box">
            <input
              className="tenant-search-input"
              type="text"
              placeholder="Search tenants by name or email..."
              value={tenantSearch}
              onChange={e => setTenantSearch(e.target.value)}
              autoFocus
            />
            {filteredTenants.slice(0, 8).map(t => (
              <div
                key={t.id}
                className="tenant-search-item"
                onClick={() => addTenant(t)}
              >
                <div>{[t.first_name, t.last_name].filter(Boolean).join(' ')}</div>
                <div className="tenant-search-sub">{t.email} · {t.status}</div>
              </div>
            ))}
            {filteredTenants.length === 0 && (
              <div style={{ padding: '12px', fontSize: '13px', color: '#94a3b8' }}>
                No tenants found.{' '}
                <a href="/landlord/tenants" style={{ color: '#10b981' }}>Add tenants first.</a>
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create Lease'}
          </button>
          <a href="/landlord/leases" className="btn-cancel">Cancel</a>
        </div>
      </div>
    </>
  )
}
