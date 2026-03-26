'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { createLease, uploadLeaseDocument } from '@/lib/leases'
import { getPropertiesByOwner } from '@/lib/properties'
import { getLeadsForOwner } from '@/lib/leads'
import type { Property } from '@/lib/properties'
import type { Lead } from '@/lib/leads'
import type { TenantInput } from '@/lib/leases'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function NewLeasePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
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

  const [docFile, setDocFile] = useState<File | null>(null)
  const [tenants, setTenants] = useState<TenantInput[]>([])
  const [leadSearch, setLeadSearch] = useState('')
  const [showLeadSearch, setShowLeadSearch] = useState(false)
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualTenant, setManualTenant] = useState({ name: '', email: '' })

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      Promise.all([getPropertiesByOwner(user.id), getLeadsForOwner(user.id)]).then(([props, ls]) => {
        setProperties(props)
        setLeads(ls)
      })
    })
  }, [router])

  const filteredLeads = leads.filter(l => {
    if (!leadSearch.trim()) return true
    const q = leadSearch.toLowerCase()
    return (
      l.first_name?.toLowerCase().includes(q) ||
      l.last_name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    )
  })

  const alreadyAddedLeadIds = new Set(tenants.map(t => t.lead_id).filter(Boolean))

  function addLeadAsTenant(lead: Lead) {
    if (alreadyAddedLeadIds.has(lead.id)) return
    setTenants(prev => [...prev, {
      lead_id: lead.id,
      name: [lead.first_name, lead.last_name].filter(Boolean).join(' '),
      email: lead.email,
    }])
    setLeadSearch('')
    setShowLeadSearch(false)
  }

  function addManualTenant() {
    if (!manualTenant.name && !manualTenant.email) return
    setTenants(prev => [...prev, { lead_id: null, name: manualTenant.name, email: manualTenant.email }])
    setManualTenant({ name: '', email: '' })
    setShowManualForm(false)
  }

  function removeTenant(idx: number) {
    setTenants(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!userId) return
    if (!form.property_id) { setErrorMsg('Please select a property.'); return }
    if (!form.start_date || !form.end_date) { setErrorMsg('Please enter start and end dates.'); return }
    if (form.end_date <= form.start_date) { setErrorMsg('End date must be after start date.'); return }

    setSaving(true)
    setErrorMsg('')

    let document_url: string | null = null
    if (docFile) {
      const tmpId = crypto.randomUUID()
      const { url, error: uploadErr } = await uploadLeaseDocument(docFile, tmpId)
      if (uploadErr) {
        setErrorMsg('Failed to upload document. Please try again.')
        setSaving(false)
        return
      }
      document_url = url
    }

    const { id, error } = await createLease(
      userId,
      {
        property_id: form.property_id,
        start_date: form.start_date,
        end_date: form.end_date,
        rent_amount: form.rent_amount ? parseInt(form.rent_amount) : null,
        unit_number: form.unit_number || null,
        notes: form.notes || null,
        document_url,
      },
      tenants
    )

    setSaving(false)
    if (error || !id) {
      setErrorMsg('Failed to create lease. Please try again.')
    } else {
      setSuccessMsg('Lease created!')
      setTimeout(() => router.push(`/landlord/leases/${id}`), 1000)
    }
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

        .tenant-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .tenant-row { display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
        .tenant-info { font-size: 14px; color: #0f172a; }
        .tenant-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
        .tenant-remove { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 4px; }
        .tenant-remove:hover { color: #ef4444; }

        .btn-add-tenant { background: #fff; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 9px 14px; font-size: 13px; font-weight: 500; color: #64748b; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-right: 8px; }
        .btn-add-tenant:hover { border-color: #10b981; color: #10b981; }

        .lead-search-box { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 8px; margin-top: 10px; overflow: hidden; }
        .lead-search-input { width: 100%; border: none; border-bottom: 1px solid #e2e8f0; padding: 10px 12px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #0f172a; outline: none; }
        .lead-search-item { padding: 10px 12px; cursor: pointer; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
        .lead-search-item:last-child { border-bottom: none; }
        .lead-search-item:hover { background: #f0fdf4; }
        .lead-search-item.disabled { color: #cbd5e1; cursor: default; }
        .lead-search-sub { font-size: 12px; color: #94a3b8; }

        .manual-form { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-top: 10px; }
        .manual-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }

        .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 28px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 11px 24px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 11px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-cancel:hover { border-color: #94a3b8; }
        .btn-small { background: #0f172a; color: #34d399; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-small:hover { background: #1e293b; }
        .btn-small-outline { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-small-outline:hover { border-color: #94a3b8; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .file-hint { font-size: 12px; color: #94a3b8; margin-top: 4px; }

        @media (max-width: 480px) {
          .form-row { grid-template-columns: 1fr; }
          .manual-form-row { grid-template-columns: 1fr; }
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

        {/* Property */}
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
          <label className="form-label">Lease Document (PDF)</label>
          <input
            className="form-input"
            type="file"
            accept=".pdf"
            onChange={e => setDocFile(e.target.files?.[0] || null)}
          />
          {docFile && <div className="file-hint">Selected: {docFile.name}</div>}
        </div>

        {/* Tenants */}
        <hr className="section-divider" />
        <div className="section-label">Tenants</div>

        {tenants.length > 0 && (
          <div className="tenant-list">
            {tenants.map((t, i) => (
              <div key={i} className="tenant-row">
                <div>
                  <div className="tenant-info">{t.name || '—'}</div>
                  {t.email && <div className="tenant-sub">{t.email}</div>}
                  {t.lead_id && <div className="tenant-sub" style={{ color: '#10b981' }}>Linked to lead</div>}
                </div>
                <button className="tenant-remove" onClick={() => removeTenant(i)}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: '10px' }}>
          <button
            className="btn-add-tenant"
            onClick={() => { setShowLeadSearch(v => !v); setShowManualForm(false) }}
          >
            + From Leads
          </button>
          <button
            className="btn-add-tenant"
            onClick={() => { setShowManualForm(v => !v); setShowLeadSearch(false) }}
          >
            + Add Manually
          </button>
        </div>

        {showLeadSearch && (
          <div className="lead-search-box">
            <input
              className="lead-search-input"
              type="text"
              placeholder="Search by name or email..."
              value={leadSearch}
              onChange={e => setLeadSearch(e.target.value)}
              autoFocus
            />
            {filteredLeads.slice(0, 8).map(l => {
              const added = alreadyAddedLeadIds.has(l.id)
              return (
                <div
                  key={l.id}
                  className={`lead-search-item${added ? ' disabled' : ''}`}
                  onClick={() => !added && addLeadAsTenant(l)}
                >
                  <div>{[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}</div>
                  <div className="lead-search-sub">{l.email}{added ? ' · already added' : ''}</div>
                </div>
              )
            })}
            {filteredLeads.length === 0 && (
              <div style={{ padding: '12px', fontSize: '13px', color: '#94a3b8' }}>No leads found</div>
            )}
          </div>
        )}

        {showManualForm && (
          <div className="manual-form">
            <div className="manual-form-row">
              <input
                className="form-input"
                type="text"
                placeholder="Full name"
                value={manualTenant.name}
                onChange={e => setManualTenant(m => ({ ...m, name: e.target.value }))}
              />
              <input
                className="form-input"
                type="email"
                placeholder="Email address"
                value={manualTenant.email}
                onChange={e => setManualTenant(m => ({ ...m, email: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-small" onClick={addManualTenant}>Add Tenant</button>
              <button className="btn-small-outline" onClick={() => setShowManualForm(false)}>Cancel</button>
            </div>
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
