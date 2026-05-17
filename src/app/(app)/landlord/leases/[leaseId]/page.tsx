'use client'

import { useState, useEffect, use } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { getLeaseById, getLeaseStatus, formatLeaseDate, getLeaseDocumentSignedUrl } from '@/lib/leases'
import type { Lease, LeaseStatus, LeaseDocument } from '@/lib/leases'
import { computeProration, fmtCurrency, fmtDate } from '@/lib/payments'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const STATUS_META: Record<LeaseStatus, { label: string; color: string; bg: string; border: string }> = {
  upcoming: { label: 'Upcoming', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)' },
  current:  { label: 'Current',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)' },
  past:     { label: 'Past',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.25)' },
}

type PlanTenant = {
  id: string
  name: string
  email: string | null
  monthly_total: number
  start_date: string | null
  end_date: string | null
  status: 'active' | 'terminated' | 'completed'
  termination_date: string | null
  termination_reason: string | null
}

type PaymentPlanInfo = {
  id: string
  due_day: number
  tenants: PlanTenant[]
}

export default function ViewLeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = use(params)
  const router = useRouter()
  const [lease, setLease] = useState<Lease | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  // Payment plan members state
  const [plan, setPlan] = useState<PaymentPlanInfo | null>(null)
  const [showAddMember, setShowAddMember] = useState(false)
  const [showTerminate, setShowTerminate] = useState<string | null>(null) // memberId
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [memberSuccess, setMemberSuccess] = useState('')

  // Add member form
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newMonthly, setNewMonthly] = useState('')
  const [newStartDate, setNewStartDate] = useState('')
  const [newEndDate, setNewEndDate] = useState('')
  const [generateSchedule, setGenerateSchedule] = useState(true)
  const [includeProration, setIncludeProration] = useState(true)

  // Terminate form
  const [terminationDate, setTerminationDate] = useState('')
  const [terminationReason, setTerminationReason] = useState('')
  const [terminateSaving, setTerminateSaving] = useState(false)
  const [terminatePreview, setTerminatePreview] = useState<number | null>(null)

  useEffect(() => { document.title = 'Lease Details — Landlord | HomeHive' }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/login'); return }
      getLeaseById(leaseId).then(data => {
        if (!data || data.owner_id !== user.id) {
          router.push('/landlord/leases')
          return
        }
        setLease(data)
        Promise.all(
          (data.documents || []).map(async (d: LeaseDocument) => {
            const url = await getLeaseDocumentSignedUrl(d.storage_path)
            return { id: d.id, url }
          })
        ).then(results => {
          const map: Record<string, string> = {}
          results.forEach(r => { if (r.url) map[r.id] = r.url })
          setSignedUrls(map)
        })
        setLoading(false)

        // Fetch associated payment plan
        supabase
          .from('payment_plans')
          .select('id, due_day, tenants:payment_plan_tenants(id, name, email, monthly_total, start_date, end_date, status, termination_date, termination_reason)')
          .eq('lease_id', leaseId)
          .maybeSingle()
          .then(({ data: planData }) => {
            if (planData) {
              setPlan({
                id: planData.id,
                due_day: planData.due_day,
                tenants: (planData.tenants as PlanTenant[]) || [],
              })
            }
          })
      })
    })
  }, [leaseId, router])

  const prorationPreview = (() => {
    if (!plan || !newStartDate || !newMonthly || !includeProration) return null
    const amt = parseFloat(newMonthly)
    if (isNaN(amt) || amt <= 0) return null
    return computeProration(amt, newStartDate, plan.due_day)
  })()

  async function handleAddMember() {
    if (!plan || !newName || !newMonthly) return
    setMemberSaving(true)
    setMemberError('')

    const res = await fetch(`/api/payments/${plan.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        email: newEmail || null,
        monthly_total: parseFloat(newMonthly),
        start_date: newStartDate || null,
        end_date: newEndDate || null,
        generate_schedule: generateSchedule,
        include_proration: includeProration,
      }),
    })

    const json = await res.json()
    setMemberSaving(false)

    if (!res.ok) {
      setMemberError(json.error || 'Failed to add member')
      return
    }

    const added: PlanTenant = {
      id: json.tenantId,
      name: newName,
      email: newEmail || null,
      monthly_total: parseFloat(newMonthly),
      start_date: newStartDate || null,
      end_date: newEndDate || null,
      status: 'active',
      termination_date: null,
      termination_reason: null,
    }
    setPlan(p => p ? { ...p, tenants: [...p.tenants, added] } : p)
    setMemberSuccess(
      generateSchedule
        ? `${newName} added with ${json.payments_created} payment${json.payments_created !== 1 ? 's' : ''} scheduled.`
        : `${newName} added successfully.`
    )
    setNewName(''); setNewEmail(''); setNewMonthly(''); setNewStartDate(''); setNewEndDate('')
    setShowAddMember(false)
    setTimeout(() => setMemberSuccess(''), 4000)
  }

  async function handleTerminate() {
    if (!plan || !showTerminate || !terminationDate) return
    setTerminateSaving(true)

    const res = await fetch(`/api/payments/${plan.id}/members/${showTerminate}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termination_date: terminationDate, termination_reason: terminationReason }),
    })

    const json = await res.json()
    setTerminateSaving(false)

    if (!res.ok) {
      setMemberError(json.error || 'Failed to terminate')
      return
    }

    setPlan(p => p ? {
      ...p,
      tenants: p.tenants.map(t => t.id === showTerminate
        ? { ...t, status: 'terminated', termination_date: terminationDate, termination_reason: terminationReason || null, end_date: terminationDate }
        : t
      ),
    } : p)
    setMemberSuccess(`Tenant terminated. ${json.voided} future payment${json.voided !== 1 ? 's' : ''} voided.`)
    setShowTerminate(null); setTerminationDate(''); setTerminationReason(''); setTerminatePreview(null)
    setTimeout(() => setMemberSuccess(''), 5000)
  }

  // Count future payments to void (preview)
  async function loadTerminatePreview(memberId: string, afterDate: string) {
    if (!plan || !afterDate) { setTerminatePreview(null); return }
    const { count } = await supabase
      .from('scheduled_payments')
      .select('*', { count: 'exact', head: true })
      .eq('plan_tenant_id', memberId)
      .in('status', ['pending', 'late'])
      .gt('due_date', afterDate)
    setTerminatePreview(count ?? 0)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading...
      </div>
    )
  }

  if (!lease) return null

  const status = getLeaseStatus(lease.start_date, lease.end_date)
  const meta = STATUS_META[status]

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .view-wrap { max-width: 680px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'DM Sans', sans-serif; }
        .view-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 20px; }
        .view-breadcrumb a { color: #10b981; text-decoration: none; }
        .view-breadcrumb a:hover { text-decoration: underline; }

        .view-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 28px; gap: 12px; flex-wrap: wrap; }
        .view-title { font-size: 22px; font-weight: 700; color: #0f172a; }
        .view-subtitle { font-size: 14px; color: #64748b; margin-top: 4px; }

        .status-badge-lg { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; border: 1px solid; }
        .btn-edit { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; display: inline-block; }
        .btn-edit:hover { background: #1e293b; }

        .detail-card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
        .detail-card-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .detail-field label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 4px; }
        .detail-field .val { font-size: 15px; color: #0f172a; font-weight: 500; }
        .detail-field .val.muted { color: #cbd5e1; font-weight: 400; }

        .tenant-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
        .tenant-row:last-child { border-bottom: none; }
        .tenant-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(16,185,129,0.15); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
        .tenant-name { font-size: 14px; font-weight: 500; color: #0f172a; }
        .tenant-email { font-size: 12px; color: #94a3b8; }
        .tenant-lead-badge { font-size: 11px; color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 7px; border-radius: 20px; font-weight: 500; }

        .notes-text { font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap; }
        .doc-item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
        .doc-item:last-child { border-bottom: none; }
        .doc-name { font-size: 14px; font-weight: 500; color: #0f172a; flex: 1; }
        .doc-link { color: #3b82f6; font-size: 13px; font-weight: 500; text-decoration: none; white-space: nowrap; }
        .doc-link:hover { text-decoration: underline; }

        /* Members section */
        .card-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .btn-add-sm { background: #0f172a; color: #34d399; border: none; border-radius: 7px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-add-sm:hover { background: #1e293b; }

        .member-row { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .member-row:last-child { border-bottom: none; }
        .member-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(99,102,241,0.12); color: #6366f1; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
        .member-avatar.terminated { background: rgba(107,114,128,0.1); color: #9ca3af; }
        .member-name { font-size: 14px; font-weight: 600; color: #0f172a; }
        .member-email { font-size: 12px; color: #94a3b8; }
        .member-meta { font-size: 11px; color: #64748b; margin-top: 3px; }
        .member-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 20px; }
        .badge-active { background: #dcfce7; color: #166534; }
        .badge-terminated { background: #fce7f3; color: #9d174d; }
        .badge-completed { background: #f1f5f9; color: #475569; }
        .btn-terminate-sm { font-size: 11px; font-weight: 600; color: #ef4444; background: none; border: 1px solid #fca5a5; border-radius: 6px; padding: 3px 10px; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; }
        .btn-terminate-sm:hover { background: #fef2f2; }

        /* Form inside card */
        .add-form { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 18px; margin-top: 14px; }
        .form-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .form-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .form-group { display: flex; flex-direction: column; gap: 4px; }
        .form-label-sm { font-size: 11px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; }
        .form-input-sm { border: 1.5px solid #e2e8f0; border-radius: 7px; padding: 8px 10px; font-size: 13px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; }
        .form-input-sm:focus { border-color: #10b981; }
        .toggle-row-sm { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
        .toggle-label-sm { font-size: 13px; color: #334155; }
        .toggle-switch-sm { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
        .toggle-switch-sm input { opacity: 0; width: 0; height: 0; }
        .toggle-slider-sm { position: absolute; inset: 0; background: #e2e8f0; border-radius: 20px; cursor: pointer; transition: background 0.2s; }
        .toggle-slider-sm::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
        .toggle-switch-sm input:checked + .toggle-slider-sm { background: #10b981; }
        .toggle-switch-sm input:checked + .toggle-slider-sm::before { transform: translateX(16px); }

        .proration-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; font-size: 12px; color: #166534; }
        .proration-box strong { font-weight: 700; }

        .btn-row { display: flex; gap: 8px; margin-top: 4px; }
        .btn-save-sm { background: #0f172a; color: #34d399; border: none; border-radius: 7px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-save-sm:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-cancel-sm { background: #fff; color: #64748b; border: 1.5px solid #e2e8f0; border-radius: 7px; padding: 9px 14px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #166534; margin-bottom: 12px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 12px; }

        .terminate-panel { background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 10px; padding: 16px; margin-top: 10px; }
        .terminate-title { font-size: 13px; font-weight: 700; color: #991b1b; margin-bottom: 12px; }
        .void-preview { font-size: 12px; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 7px; padding: 8px 12px; margin-bottom: 12px; }

        .plan-link { font-size: 12px; color: #3b82f6; text-decoration: none; font-weight: 500; }
        .plan-link:hover { text-decoration: underline; }

        @media (max-width: 480px) {
          .detail-grid { grid-template-columns: 1fr; }
          .view-header { flex-direction: column; }
          .form-row2 { grid-template-columns: 1fr; }
          .form-row3 { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <div className="view-wrap">
        <div className="view-breadcrumb">
          <a href="/landlord/leases">Leases</a>
          {' › '}
          Lease Details
        </div>

        <div className="view-header">
          <div>
            <h1 className="view-title">{lease.property?.name || 'Lease'}</h1>
            {lease.unit_number && <div className="view-subtitle">Unit {lease.unit_number}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span
              className="status-badge-lg"
              style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
            >
              {meta.label}
            </span>
            <a href={`/landlord/leases/${leaseId}/edit`} className="btn-edit">Edit</a>
          </div>
        </div>

        {/* Core details */}
        <div className="detail-card">
          <div className="detail-card-title">Lease Details</div>
          <div className="detail-grid">
            <div className="detail-field">
              <label>Start Date</label>
              <div className="val">{formatLeaseDate(lease.start_date)}</div>
            </div>
            <div className="detail-field">
              <label>End Date</label>
              <div className="val">{formatLeaseDate(lease.end_date)}</div>
            </div>
            <div className="detail-field">
              <label>Monthly Rent</label>
              <div className={`val${lease.rent_amount ? '' : ' muted'}`}>
                {lease.rent_amount ? `$${lease.rent_amount.toLocaleString()}` : '—'}
              </div>
            </div>
            <div className="detail-field">
              <label>Unit / Room</label>
              <div className={`val${lease.unit_number ? '' : ' muted'}`}>
                {lease.unit_number || '—'}
              </div>
            </div>
            <div className="detail-field">
              <label>Property</label>
              <div className="val">
                {lease.property
                  ? <a href={`/landlord/listings/${lease.property.slug}`} style={{ color: '#10b981', textDecoration: 'none' }}>{lease.property.name}</a>
                  : '—'
                }
              </div>
            </div>
          </div>
        </div>

        {/* Tenants */}
        <div className="detail-card">
          <div className="detail-card-title">Tenants ({lease.tenants.length})</div>
          {lease.tenants.length === 0 ? (
            <div style={{ color: '#cbd5e1', fontSize: '14px' }}>No tenants assigned</div>
          ) : (
            lease.tenants.map(t => {
              const initials = (t.name || t.email || '?').slice(0, 2).toUpperCase()
              return (
                <div key={t.id} className="tenant-row">
                  <div className="tenant-avatar">{initials}</div>
                  <div style={{ flex: 1 }}>
                    <div className="tenant-name">{t.name || '—'}</div>
                    {t.email && <div className="tenant-email">{t.email}</div>}
                  </div>
                  {t.tenant_id && (
                    <a href="/landlord/tenants" className="tenant-lead-badge">View Tenant</a>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Payment Plan Members */}
        {plan && (
          <div className="detail-card">
            <div className="card-header-row">
              <div>
                <div className="detail-card-title" style={{ marginBottom: 2 }}>
                  Payment Members ({plan.tenants.length})
                </div>
                <a href={`/landlord/payments/${plan.id}`} className="plan-link">
                  View full payment plan →
                </a>
              </div>
              <button className="btn-add-sm" onClick={() => { setShowAddMember(v => !v); setMemberError('') }}>
                {showAddMember ? 'Cancel' : '+ Add Member'}
              </button>
            </div>

            {memberSuccess && <div className="alert-success">{memberSuccess}</div>}
            {memberError && <div className="alert-error">{memberError}</div>}

            {plan.tenants.length === 0 && !showAddMember && (
              <div style={{ color: '#cbd5e1', fontSize: '14px' }}>No payment members yet</div>
            )}

            {plan.tenants.map(m => (
              <div key={m.id}>
                <div className="member-row">
                  <div className={`member-avatar${m.status !== 'active' ? ' terminated' : ''}`}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="member-name">{m.name}</span>
                      <span className={`member-badge badge-${m.status}`}>
                        {m.status === 'active' ? 'Active' : m.status === 'terminated' ? 'Terminated' : 'Completed'}
                      </span>
                    </div>
                    {m.email && <div className="member-email">{m.email}</div>}
                    <div className="member-meta">
                      {fmtCurrency(m.monthly_total)}/mo
                      {m.start_date && ` · from ${fmtDate(m.start_date)}`}
                      {m.end_date && ` → ${fmtDate(m.end_date)}`}
                      {m.termination_date && ` · Terminated ${fmtDate(m.termination_date)}`}
                      {m.termination_reason && ` (${m.termination_reason})`}
                    </div>
                  </div>
                  {m.status === 'active' && (
                    <button
                      className="btn-terminate-sm"
                      onClick={() => {
                        setShowTerminate(showTerminate === m.id ? null : m.id)
                        setTerminationDate(''); setTerminationReason(''); setTerminatePreview(null)
                      }}
                    >
                      Terminate
                    </button>
                  )}
                </div>

                {/* Terminate panel */}
                {showTerminate === m.id && (
                  <div className="terminate-panel">
                    <div className="terminate-title">Early Termination — {m.name}</div>
                    <div className="form-row2">
                      <div className="form-group">
                        <label className="form-label-sm">Termination Date</label>
                        <input
                          className="form-input-sm"
                          type="date"
                          value={terminationDate}
                          onChange={e => {
                            setTerminationDate(e.target.value)
                            loadTerminatePreview(m.id, e.target.value)
                          }}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label-sm">Reason (optional)</label>
                        <input
                          className="form-input-sm"
                          type="text"
                          value={terminationReason}
                          onChange={e => setTerminationReason(e.target.value)}
                          placeholder="e.g. Moved out early"
                        />
                      </div>
                    </div>
                    {terminatePreview !== null && terminationDate && (
                      <div className="void-preview">
                        {terminatePreview === 0
                          ? 'No future pending payments to void.'
                          : `${terminatePreview} future payment${terminatePreview !== 1 ? 's' : ''} will be voided after ${fmtDate(terminationDate)}.`
                        }
                      </div>
                    )}
                    <div className="btn-row">
                      <button
                        className="btn-save-sm"
                        style={{ background: '#dc2626', color: '#fff' }}
                        disabled={!terminationDate || terminateSaving}
                        onClick={handleTerminate}
                      >
                        {terminateSaving ? 'Terminating...' : 'Confirm Termination'}
                      </button>
                      <button className="btn-cancel-sm" onClick={() => setShowTerminate(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add member form */}
            {showAddMember && (
              <div className="add-form">
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: 14 }}>Add Payment Member</div>
                <div className="form-row2">
                  <div className="form-group">
                    <label className="form-label-sm">Full Name *</label>
                    <input className="form-input-sm" type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Doe" />
                  </div>
                  <div className="form-group">
                    <label className="form-label-sm">Email</label>
                    <input className="form-input-sm" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@email.com" />
                  </div>
                </div>
                <div className="form-row3">
                  <div className="form-group">
                    <label className="form-label-sm">Monthly Amount *</label>
                    <input className="form-input-sm" type="number" min="0" step="0.01" value={newMonthly} onChange={e => setNewMonthly(e.target.value)} placeholder="750" />
                  </div>
                  <div className="form-group">
                    <label className="form-label-sm">Start Date</label>
                    <input className="form-input-sm" type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label-sm">End Date</label>
                    <input className="form-input-sm" type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} />
                  </div>
                </div>

                <div className="toggle-row-sm">
                  <label className="toggle-switch-sm">
                    <input type="checkbox" checked={generateSchedule} onChange={e => setGenerateSchedule(e.target.checked)} />
                    <span className="toggle-slider-sm" />
                  </label>
                  <span className="toggle-label-sm">Generate payment schedule</span>
                </div>

                {generateSchedule && (
                  <div className="toggle-row-sm">
                    <label className="toggle-switch-sm">
                      <input type="checkbox" checked={includeProration} onChange={e => setIncludeProration(e.target.checked)} />
                      <span className="toggle-slider-sm" />
                    </label>
                    <span className="toggle-label-sm">Prorate first month</span>
                  </div>
                )}

                {prorationPreview && (
                  <div className="proration-box" style={{ marginTop: 10 }}>
                    <strong>Proration preview:</strong> First payment on {fmtDate(newStartDate)} is{' '}
                    <strong>{fmtCurrency(prorationPreview.proratedAmount)}</strong>{' '}
                    ({prorationPreview.proratedDays} of 30.5 days).
                    Full payments of <strong>{fmtCurrency(parseFloat(newMonthly))}</strong> start{' '}
                    {fmtDate(prorationPreview.firstDueDate)}.
                  </div>
                )}

                <div className="btn-row" style={{ marginTop: 14 }}>
                  <button
                    className="btn-save-sm"
                    disabled={!newName || !newMonthly || memberSaving}
                    onClick={handleAddMember}
                  >
                    {memberSaving ? 'Adding...' : 'Add Member'}
                  </button>
                  <button className="btn-cancel-sm" onClick={() => { setShowAddMember(false); setMemberError('') }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {lease.notes && (
          <div className="detail-card">
            <div className="detail-card-title">Notes</div>
            <div className="notes-text">{lease.notes}</div>
          </div>
        )}

        {/* Documents */}
        {lease.documents.length > 0 && (
          <div className="detail-card">
            <div className="detail-card-title">Documents ({lease.documents.length})</div>
            {lease.documents.map(d => (
              <div key={d.id} className="doc-item">
                <span style={{ fontSize: '16px' }}>📄</span>
                <span className="doc-name">{d.name}</span>
                {signedUrls[d.id]
                  ? <a href={signedUrls[d.id]} target="_blank" rel="noopener noreferrer" className="doc-link">Download</a>
                  : <span style={{ color: '#94a3b8', fontSize: '13px' }}>Loading...</span>
                }
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
