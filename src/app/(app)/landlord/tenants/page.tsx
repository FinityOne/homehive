'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import {
  getTenantsByOwner,
  createTenant,
  updateTenant,
  deleteTenant,
  tenantEmailExists,
  type Tenant,
  type TenantStatus,
  type TenantFormData,
} from '@/lib/tenants'
import { getLeadsForOwner, type Lead } from '@/lib/leads'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_LABEL: Record<TenantStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  pending: 'Pending',
  former: 'Former',
}

const STATUS_COLOR: Record<TenantStatus, { bg: string; color: string }> = {
  active:   { bg: '#dcfce7', color: '#166534' },
  pending:  { bg: '#fef9c3', color: '#854d0e' },
  inactive: { bg: '#f1f5f9', color: '#475569' },
  former:   { bg: '#fce7f3', color: '#9d174d' },
}

function StarRating({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div style={{ display: 'flex', gap: '2px' }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          onMouseEnter={() => onChange && setHovered(n)}
          onMouseLeave={() => onChange && setHovered(0)}
          onClick={() => onChange && onChange(n === value ? 0 : n)}
          style={{
            fontSize: '16px',
            cursor: onChange ? 'pointer' : 'default',
            color: (hovered || value || 0) >= n ? '#f59e0b' : '#e2e8f0',
            lineHeight: 1,
          }}
        >★</span>
      ))}
    </div>
  )
}

const BLANK_FORM: TenantFormData = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  notes: '',
  status: 'active',
  rating: null,
  lead_id: null,
}

export default function TenantsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  // Add/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [form, setForm] = useState<TenantFormData>(BLANK_FORM)
  const [modalMode, setModalMode] = useState<'new' | 'from-lead'>('new')
  const [leadSearch, setLeadSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Filter / search
  const [searchQ, setSearchQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<TenantStatus | 'all'>('all')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      Promise.all([getTenantsByOwner(user.id), getLeadsForOwner(user.id)]).then(([ts, ls]) => {
        setTenants(ts)
        setLeads(ls)
        setLoading(false)
      })
    })
  }, [router])

  function openAddModal() {
    setEditingTenant(null)
    setForm(BLANK_FORM)
    setModalMode('new')
    setSelectedLead(null)
    setLeadSearch('')
    setFormError('')
    setModalOpen(true)
  }

  function openEditModal(t: Tenant) {
    setEditingTenant(t)
    setForm({
      first_name: t.first_name,
      last_name: t.last_name || '',
      email: t.email,
      phone: t.phone || '',
      notes: t.notes || '',
      status: t.status,
      rating: t.rating,
      lead_id: t.lead_id,
    })
    setModalMode('new')
    setSelectedLead(null)
    setLeadSearch('')
    setFormError('')
    setModalOpen(true)
  }

  function selectLead(lead: Lead) {
    setSelectedLead(lead)
    setForm(f => ({
      ...f,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      email: lead.email,
      phone: lead.phone || '',
      lead_id: lead.id,
    }))
    setLeadSearch('')
  }

  async function handleSave() {
    if (!userId) return
    setFormError('')

    const email = form.email.toLowerCase().trim()
    if (!form.first_name.trim()) { setFormError('First name is required.'); return }
    if (!email) { setFormError('Email is required.'); return }

    // Duplicate email check
    const exists = await tenantEmailExists(userId, email, editingTenant?.id)
    if (exists) { setFormError('A tenant with this email already exists.'); return }

    setSaving(true)
    const payload: TenantFormData = {
      ...form,
      email,
      first_name: form.first_name.trim(),
      last_name: form.last_name?.trim() || null,
      phone: form.phone?.trim() || null,
      notes: form.notes?.trim() || null,
    }

    if (editingTenant) {
      const { error } = await updateTenant(editingTenant.id, payload)
      if (error) { setFormError('Failed to save changes.'); setSaving(false); return }
      setTenants(prev => prev.map(t => t.id === editingTenant.id ? { ...t, ...payload } : t))
    } else {
      const { tenant, error } = await createTenant(userId, payload)
      if (error || !tenant) { setFormError('Failed to create tenant.'); setSaving(false); return }
      setTenants(prev => [tenant, ...prev])
    }

    setSaving(false)
    setModalOpen(false)
  }

  async function handleDelete(id: string) {
    const { error } = await deleteTenant(id)
    if (!error) {
      setTenants(prev => prev.filter(t => t.id !== id))
    }
    setDeletingId(null)
  }

  const filteredLeads = leads.filter(l => {
    const alreadyTenant = tenants.some(t => t.lead_id === l.id)
    if (alreadyTenant) return false
    if (!leadSearch.trim()) return true
    const q = leadSearch.toLowerCase()
    return (
      l.first_name?.toLowerCase().includes(q) ||
      l.last_name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    )
  })

  const filtered = tenants.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      return (
        t.first_name.toLowerCase().includes(q) ||
        t.last_name?.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.phone?.includes(q)
      )
    }
    return true
  })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .page { max-width: 900px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
        .page-title { font-size: 22px; font-weight: 700; color: #0f172a; }

        .toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; align-items: center; }
        .search-input { border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; outline: none; width: 220px; }
        .search-input:focus { border-color: #10b981; }
        .filter-select { border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; outline: none; background: #fff; cursor: pointer; }
        .filter-select:focus { border-color: #10b981; }

        .btn-primary { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .btn-primary:hover { background: #1e293b; }
        .btn-danger { background: #fff; color: #ef4444; border: 1.5px solid #fecaca; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-danger:hover { background: #fef2f2; }
        .btn-edit { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-edit:hover { border-color: #10b981; color: #10b981; }

        .tenant-table { width: 100%; border-collapse: collapse; }
        .tenant-table th { text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; border-bottom: 2px solid #e2e8f0; }
        .tenant-table td { padding: 12px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .tenant-table tr:last-child td { border-bottom: none; }
        .tenant-table tr:hover td { background: #f8fafc; }

        .tenant-name { font-size: 14px; font-weight: 600; color: #0f172a; }
        .tenant-email { font-size: 12px; color: #94a3b8; margin-top: 2px; }
        .tenant-phone { font-size: 13px; color: #475569; }

        .status-badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .lead-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 20px; font-size: 11px; font-weight: 500; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }

        .empty-state { text-align: center; padding: 60px 20px; color: #94a3b8; }
        .empty-title { font-size: 16px; font-weight: 600; color: #475569; margin-bottom: 8px; }
        .empty-sub { font-size: 13px; }

        /* Modal */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal { background: #fff; border-radius: 14px; padding: 28px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
        .modal-title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 20px; }

        .modal-tabs { display: flex; gap: 0; border: 1.5px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
        .modal-tab { flex: 1; padding: 8px 12px; font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif; background: #fff; border: none; cursor: pointer; color: #64748b; }
        .modal-tab.active { background: #0f172a; color: #34d399; font-weight: 600; }

        .form-group { margin-bottom: 16px; }
        .form-label { display: block; font-size: 12px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px; }
        .form-input { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; transition: border-color 0.15s; }
        .form-input:focus { border-color: #10b981; }
        .form-select { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; cursor: pointer; }
        .form-select:focus { border-color: #10b981; }
        .form-textarea { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; resize: vertical; min-height: 72px; }
        .form-textarea:focus { border-color: #10b981; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        .lead-search-box { border: 1.5px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
        .lead-search-input { width: 100%; border: none; border-bottom: 1px solid #e2e8f0; padding: 10px 12px; font-size: 14px; font-family: 'DM Sans', sans-serif; color: #0f172a; outline: none; }
        .lead-search-item { padding: 10px 12px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
        .lead-search-item:last-child { border-bottom: none; }
        .lead-search-item:hover { background: #f0fdf4; }
        .lead-search-sub { font-size: 12px; color: #94a3b8; }

        .selected-lead-banner { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }
        .selected-lead-clear { background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 16px; }
        .selected-lead-clear:hover { color: #ef4444; }

        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 14px; }
        .modal-actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
        .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 22px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-save:not(:disabled):hover { background: #1e293b; }
        .btn-cancel-modal { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-cancel-modal:hover { border-color: #94a3b8; }

        /* Delete confirm */
        .delete-confirm { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 14px; margin-top: 8px; font-size: 13px; color: #991b1b; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .btn-confirm-delete { background: #ef4444; color: #fff; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-confirm-delete:hover { background: #dc2626; }
        .btn-cancel-delete { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-cancel-delete:hover { border-color: #94a3b8; }

        @media (max-width: 600px) {
          .form-row { grid-template-columns: 1fr; }
          .tenant-table th:nth-child(3), .tenant-table td:nth-child(3) { display: none; }
        }
      `}</style>

      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Tenants</h1>
          <button className="btn-primary" onClick={openAddModal}>+ Add Tenant</button>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            type="text"
            placeholder="Search by name or email..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          <select
            className="filter-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as TenantStatus | 'all')}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
            <option value="former">Former</option>
          </select>
          <span style={{ fontSize: '13px', color: '#94a3b8', marginLeft: 'auto' }}>
            {filtered.length} tenant{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">{tenants.length === 0 ? 'No tenants yet' : 'No results'}</div>
            <div className="empty-sub">
              {tenants.length === 0
                ? 'Add tenants manually or convert a lead into a tenant.'
                : 'Try adjusting your search or filter.'}
            </div>
          </div>
        ) : (
          <table className="tenant-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Rating</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <>
                  <tr key={t.id}>
                    <td>
                      <div className="tenant-name">{t.first_name} {t.last_name}</div>
                      <div className="tenant-email">{t.email}</div>
                      {t.lead_id && (
                        <span className="lead-badge" style={{ marginTop: '4px' }}>
                          ◉ From Lead
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="tenant-phone">{t.phone || <span style={{ color: '#cbd5e1' }}>—</span>}</span>
                    </td>
                    <td>
                      <span
                        className="status-badge"
                        style={{ background: STATUS_COLOR[t.status].bg, color: STATUS_COLOR[t.status].color }}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td>
                      <StarRating value={t.rating} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button className="btn-edit" onClick={() => openEditModal(t)}>Edit</button>
                        <button className="btn-danger" onClick={() => setDeletingId(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  {deletingId === t.id && (
                    <tr key={`${t.id}-confirm`}>
                      <td colSpan={5} style={{ paddingTop: 0 }}>
                        <div className="delete-confirm">
                          <span>Remove <strong>{t.first_name} {t.last_name}</strong>? This cannot be undone.</span>
                          <button className="btn-confirm-delete" onClick={() => handleDelete(t.id)}>Yes, delete</button>
                          <button className="btn-cancel-delete" onClick={() => setDeletingId(null)}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="modal">
            <div className="modal-title">{editingTenant ? 'Edit Tenant' : 'Add Tenant'}</div>

            {!editingTenant && (
              <div className="modal-tabs">
                <button
                  className={`modal-tab${modalMode === 'new' ? ' active' : ''}`}
                  onClick={() => { setModalMode('new'); setSelectedLead(null); setLeadSearch(''); setForm(BLANK_FORM) }}
                >
                  New Tenant
                </button>
                <button
                  className={`modal-tab${modalMode === 'from-lead' ? ' active' : ''}`}
                  onClick={() => { setModalMode('from-lead'); setSelectedLead(null); setLeadSearch('') }}
                >
                  From a Lead
                </button>
              </div>
            )}

            {modalMode === 'from-lead' && !selectedLead && (
              <div className="lead-search-box">
                <input
                  className="lead-search-input"
                  type="text"
                  placeholder="Search leads by name or email..."
                  value={leadSearch}
                  onChange={e => setLeadSearch(e.target.value)}
                  autoFocus
                />
                {filteredLeads.slice(0, 8).map(l => (
                  <div key={l.id} className="lead-search-item" onClick={() => selectLead(l)}>
                    <div>{[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}</div>
                    <div className="lead-search-sub">{l.email} · {l.status}</div>
                  </div>
                ))}
                {filteredLeads.length === 0 && (
                  <div style={{ padding: '12px', fontSize: '13px', color: '#94a3b8' }}>
                    No leads found (or all already converted)
                  </div>
                )}
              </div>
            )}

            {modalMode === 'from-lead' && selectedLead && (
              <div className="selected-lead-banner">
                <span>Importing from lead: <strong>{[selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ')}</strong></span>
                <button className="selected-lead-clear" onClick={() => { setSelectedLead(null); setForm(BLANK_FORM) }}>×</button>
              </div>
            )}

            {(modalMode === 'new' || selectedLead || editingTenant) && (
              <>
                {formError && <div className="alert-error">{formError}</div>}

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">First Name *</label>
                    <input className="form-input" type="text" value={form.first_name}
                      onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="Jane" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name</label>
                    <input className="form-input" type="text" value={form.last_name || ''}
                      onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Doe" />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Email *</label>
                  <input className="form-input" type="email" value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" />
                </div>

                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" type="tel" value={form.phone || ''}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 (480) 555-1234" />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <select className="form-select" value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value as TenantStatus }))}>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="inactive">Inactive</option>
                      <option value="former">Former</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rating</label>
                    <div style={{ paddingTop: '10px' }}>
                      <StarRating value={form.rating} onChange={v => setForm(f => ({ ...f, rating: v || null }))} />
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" value={form.notes || ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Any notes about this tenant..." />
                </div>

                <div className="modal-actions">
                  <button className="btn-save" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : editingTenant ? 'Save Changes' : 'Add Tenant'}
                  </button>
                  <button className="btn-cancel-modal" onClick={() => setModalOpen(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
