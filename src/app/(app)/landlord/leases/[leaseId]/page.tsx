'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  getLeaseById, getLeaseStatus, formatLeaseDate, getLeaseDocumentSignedUrl,
  addLeaseDocument, deleteLeaseDocument,
} from '@/lib/leases'
import type { Lease, LeaseStatus, LeaseDocument } from '@/lib/leases'
import { computeProration, fmtCurrency, fmtDate, getPlanById, isOverdue, type PaymentPlan } from '@/lib/payments'
import {
  getInspectionsForLease, createInspectionFromLease, computeTotals, fmtMoney,
  type Inspection,
} from '@/lib/inspections'

const PlanWorkspace = dynamic(() => import('@/components/payments/PlanWorkspace'), { ssr: false })

const STATUS_META: Record<LeaseStatus, { label: string; color: string; bg: string; border: string }> = {
  upcoming: { label: 'Upcoming', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)' },
  current:  { label: 'Current',  color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)' },
  past:     { label: 'Past',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)', border: 'rgba(107,114,128,0.25)' },
}

type Tab = 'overview' | 'tenants' | 'payments' | 'documents' | 'moveout'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'tenants',   label: 'Tenants' },
  { id: 'payments',  label: 'Payments' },
  { id: 'documents', label: 'Documents' },
  { id: 'moveout',   label: 'Move-out' },
]

/**
 * The lease hub — everything tied to one tenancy in one place.
 *
 * A lease is the natural spine of property management: the people, the money,
 * the paperwork and the move-out all hang off it. Prior to this the landlord had
 * to bounce between /leases, /payments/[planId] and /inspections/[id] to answer
 * one question about one tenancy. Now the lease owns all of it and the top-level
 * nav keeps only the portfolio-wide rollups.
 */
export default function LeaseHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ leaseId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { leaseId } = use(params)
  const { tab: tabParam } = use(searchParams)
  const router = useRouter()

  const [tab, setTab] = useState<Tab>(
    TABS.some(t => t.id === tabParam) ? (tabParam as Tab) : 'overview'
  )
  const [lease, setLease] = useState<Lease | null>(null)
  const [loading, setLoading] = useState(true)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})

  // Checkout inspections covering this lease
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [creatingInspection, setCreatingInspection] = useState(false)

  // Full payment plan (schedule + charges) — powers the money numbers
  const [plan, setPlan] = useState<PaymentPlan | null>(null)

  // Add / terminate payment member
  const [showAddMember, setShowAddMember] = useState(false)
  const [showTerminate, setShowTerminate] = useState<string | null>(null)
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [memberSuccess, setMemberSuccess] = useState('')

  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newMonthly, setNewMonthly] = useState('')
  const [newStartDate, setNewStartDate] = useState('')
  const [newEndDate, setNewEndDate] = useState('')
  const [generateSchedule, setGenerateSchedule] = useState(true)
  const [includeProration, setIncludeProration] = useState(true)

  const [terminationDate, setTerminationDate] = useState('')
  const [terminationReason, setTerminationReason] = useState('')
  const [terminateSaving, setTerminateSaving] = useState(false)
  const [terminatePreview, setTerminatePreview] = useState<number | null>(null)

  // Documents
  const [docFile, setDocFile] = useState<File | null>(null)
  const [docName, setDocName] = useState('')
  const [docUploading, setDocUploading] = useState(false)

  useEffect(() => { document.title = 'Lease — Landlord | HomeHive' }, [])

  // Keep the tab in the URL so a lease view can be linked or refreshed in place.
  const selectTab = (next: Tab) => {
    setTab(next)
    const url = next === 'overview'
      ? `/landlord/leases/${leaseId}`
      : `/landlord/leases/${leaseId}?tab=${next}`
    window.history.replaceState(null, '', url)
  }

  const signDocs = useCallback(async (docs: LeaseDocument[]) => {
    const results = await Promise.all(
      docs.map(async d => ({ id: d.id, url: await getLeaseDocumentSignedUrl(d.storage_path) }))
    )
    const map: Record<string, string> = {}
    results.forEach(r => { if (r.url) map[r.id] = r.url })
    setSignedUrls(map)
  }, [])

  const loadPlan = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('payment_plans').select('id').eq('lease_id', id).maybeSingle()
    if (data?.id) setPlan(await getPlanById(data.id))
    else setPlan(null)
  }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) { router.push('/login'); return }
      getLeaseById(leaseId).then(data => {
        if (!data || data.owner_id !== user.id) { router.push('/landlord/leases'); return }
        setLease(data)
        setLoading(false)
        signDocs(data.documents || [])
        getInspectionsForLease(leaseId).then(setInspections)
        loadPlan(leaseId)
      })
    })
  }, [leaseId, router, signDocs, loadPlan])

  const refreshLease = async () => {
    const data = await getLeaseById(leaseId)
    if (data) { setLease(data); signDocs(data.documents || []) }
  }

  const prorationPreview = (() => {
    if (!plan || !newStartDate || !newMonthly || !includeProration) return null
    const amt = parseFloat(newMonthly)
    if (isNaN(amt) || amt <= 0) return null
    return computeProration(amt, newStartDate, plan.due_day)
  })()

  async function handleAddMember() {
    if (!plan || !newName || !newMonthly) return
    setMemberSaving(true); setMemberError('')

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
    if (!res.ok) { setMemberError(json.error || 'Failed to add member'); return }

    await loadPlan(leaseId)
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
    if (!res.ok) { setMemberError(json.error || 'Failed to terminate'); return }

    await loadPlan(leaseId)
    setMemberSuccess(`Tenant terminated. ${json.voided} future payment${json.voided !== 1 ? 's' : ''} voided.`)
    setShowTerminate(null); setTerminationDate(''); setTerminationReason(''); setTerminatePreview(null)
    setTimeout(() => setMemberSuccess(''), 5000)
  }

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

  async function startInspection() {
    if (!lease) return
    setCreatingInspection(true)
    const user = await getCurrentUser()
    if (!user) { setCreatingInspection(false); return }

    const { id, error } = await createInspectionFromLease(
      user.id,
      {
        id: lease.id,
        property_id: lease.property_id,
        start_date: lease.start_date,
        end_date: lease.end_date,
        unit_number: lease.unit_number,
        tenants: lease.tenants.map(t => ({ tenant_id: t.tenant_id, name: t.name, email: t.email })),
      },
      lease.property?.name
    )
    setCreatingInspection(false)
    if (error || !id) { setMemberError('Could not start the inspection. Please try again.'); return }
    router.push(`/landlord/inspections/${id}`)
  }

  async function uploadDoc() {
    if (!docFile) return
    setDocUploading(true)
    const { error } = await addLeaseDocument(leaseId, docFile, docName || docFile.name)
    setDocUploading(false)
    if (error) { setMemberError('Upload failed. Please try again.'); return }
    setDocFile(null); setDocName('')
    await refreshLease()
  }

  async function removeDoc(doc: LeaseDocument) {
    if (!confirm(`Delete "${doc.name}"?`)) return
    const { error } = await deleteLeaseDocument(doc)
    if (error) { setMemberError('Could not delete that document.'); return }
    await refreshLease()
  }

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading…
      </div>
    )
  }
  if (!lease) return null

  const status = getLeaseStatus(lease.start_date, lease.end_date)
  const meta = STATUS_META[status]

  // ── Money at a glance ──────────────────────────────────────────────────────
  const sps = plan?.scheduled_payments ?? []
  const today = new Date()
  const thisMonth = sps.filter(p => {
    const d = new Date(p.due_date + 'T00:00:00')
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  })
  const monthExpected  = thisMonth.reduce((s, p) => s + p.amount, 0)
  const monthCollected = thisMonth.reduce((s, p) => s + p.paid_amount, 0)
  const overdue        = sps.filter(p => isOverdue(p))
  const overdueAmount  = overdue.reduce((s, p) => s + (p.amount - p.paid_amount), 0)
  const leaseCollected = sps.filter(p => p.status === 'paid').reduce((s, p) => s + p.paid_amount, 0)
  const leaseTotal     = sps.reduce((s, p) => s + p.amount, 0)
  const activeMembers  = (plan?.tenants ?? []).filter(t => t.status === 'active')
  const monthlyTotal   = activeMembers.reduce((s, t) => s + t.monthly_total, 0)

  const daysToEnd = Math.ceil(
    (new Date(lease.end_date + 'T00:00:00').getTime() - today.setHours(0, 0, 0, 0)) / 86_400_000
  )
  const endingSoon = status === 'current' && daysToEnd <= 60 && daysToEnd >= 0
  const openInspection = inspections.find(i => i.status !== 'settled')
  const inspectionTotals = openInspection ? computeTotals(openInspection) : null

  const counts: Record<Tab, number | null> = {
    overview: null,
    tenants: lease.tenants.length || null,
    payments: overdue.length || null,
    documents: lease.documents.length || null,
    moveout: inspections.length || null,
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="lh-wrap">
        {/* ── Breadcrumb ── */}
        <div className="lh-crumb">
          <a href="/landlord/leases">Leases</a> › {lease.property?.name || 'Lease'}
        </div>

        {/* ── Sticky identity header ── */}
        <div className="lh-head">
          <div className="lh-head-main">
            <div>
              <h1 className="lh-title">{lease.property?.name || 'Lease'}</h1>
              <div className="lh-sub">
                {lease.unit_number && <span className="lh-unit">{lease.unit_number}</span>}
                {formatLeaseDate(lease.start_date)} – {formatLeaseDate(lease.end_date)}
                {lease.rent_amount ? ` · ${fmtCurrency(lease.rent_amount)}/mo` : ''}
              </div>
            </div>
            <div className="lh-head-actions">
              <span className="lh-status" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
                {meta.label}
              </span>
              <a href={`/landlord/leases/${leaseId}/edit`} className="btn-ghost">Edit lease</a>
            </div>
          </div>

          {/* Key figures — the answer to "how is this tenancy doing?" */}
          <div className="lh-figs">
            <Fig label="Monthly rent" value={fmtCurrency(monthlyTotal || lease.rent_amount || 0)} />
            <Fig
              label="Collected this month"
              value={monthExpected > 0 ? `${fmtCurrency(monthCollected)} / ${fmtCurrency(monthExpected)}` : '—'}
              tone={monthExpected > 0 && monthCollected >= monthExpected ? 'good' : undefined}
            />
            <Fig
              label="Overdue"
              value={overdue.length > 0 ? `${fmtCurrency(overdueAmount)} · ${overdue.length}` : 'None'}
              tone={overdue.length > 0 ? 'bad' : 'good'}
            />
            <Fig label="Tenants" value={String(lease.tenants.length)} />
          </div>

          {/* ── Tabs ── */}
          <div className="lh-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`lh-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
                {counts[t.id] !== null && (
                  <span className={`lh-count${t.id === 'payments' && overdue.length > 0 ? ' bad' : ''}`}>
                    {counts[t.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {memberSuccess && <div className="alert-ok">{memberSuccess}</div>}
        {memberError && <div className="alert-err">{memberError}</div>}

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <>
            {/* What needs attention, if anything */}
            {(overdue.length > 0 || endingSoon || openInspection) && (
              <div className="card">
                <div className="card-hd"><span className="card-title">Needs attention</span></div>
                <div className="card-bd">
                  {overdue.length > 0 && (
                    <Action
                      tone="bad"
                      title={`${overdue.length} payment${overdue.length !== 1 ? 's' : ''} overdue — ${fmtCurrency(overdueAmount)}`}
                      body="Follow up with the tenant, then record the payment on the Payments tab."
                      cta="Go to payments"
                      onClick={() => selectTab('payments')}
                    />
                  )}
                  {endingSoon && (
                    <Action
                      tone="warn"
                      title={`Lease ends in ${daysToEnd} day${daysToEnd !== 1 ? 's' : ''}`}
                      body="Time to renew, re-list the property, or line up the move-out inspection."
                      cta="Start move-out"
                      onClick={() => selectTab('moveout')}
                    />
                  )}
                  {openInspection && inspectionTotals && (
                    <Action
                      tone="warn"
                      title={
                        openInspection.status === 'draft'
                          ? 'Move-out inspection in draft'
                          : `${inspectionTotals.outstandingCount} deposit${inspectionTotals.outstandingCount !== 1 ? 's' : ''} still to settle`
                      }
                      body={
                        openInspection.status === 'draft'
                          ? 'Finish logging findings, then finalize to start tracking refunds.'
                          : `${fmtMoney(inspectionTotals.outstandingRefunds)} still to return to tenants.`
                      }
                      cta="Open inspection"
                      href={`/landlord/inspections/${openInspection.id}`}
                    />
                  )}
                </div>
              </div>
            )}

            <div className="lh-cols">
              <div className="card">
                <div className="card-hd"><span className="card-title">Lease terms</span></div>
                <div className="card-bd">
                  <Row label="Property" value={
                    lease.property
                      ? <a href={`/landlord/listings/${lease.property.slug}`} className="lnk">{lease.property.name}</a>
                      : '—'
                  } />
                  <Row label="Unit / room" value={lease.unit_number || '—'} />
                  <Row label="Term" value={`${formatLeaseDate(lease.start_date)} – ${formatLeaseDate(lease.end_date)}`} />
                  <Row label="Rent on lease" value={lease.rent_amount ? `${fmtCurrency(lease.rent_amount)}/mo` : '—'} />
                  {plan && <Row label="Rent due" value={`${plan.due_day}${ordinal(plan.due_day)} of the month`} />}
                  {lease.notes && <Row label="Notes" value={<span className="notes">{lease.notes}</span>} />}
                </div>
              </div>

              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Money</span>
                  {plan && <button className="lnk-btn" onClick={() => selectTab('payments')}>Full ledger →</button>}
                </div>
                <div className="card-bd">
                  {!plan ? (
                    <div className="empty-inline">
                      No payment plan yet — rent isn&apos;t being tracked for this lease.
                      <a href={`/landlord/payments/new?lease=${leaseId}`} className="btn-dark" style={{ marginTop: 12, display: 'inline-block' }}>
                        Set up rent collection
                      </a>
                    </div>
                  ) : (
                    <>
                      <Row label="Collected to date" value={`${fmtCurrency(leaseCollected)} of ${fmtCurrency(leaseTotal)}`} />
                      <div className="bar"><div className="bar-fill" style={{ width: `${leaseTotal > 0 ? Math.min(100, (leaseCollected / leaseTotal) * 100) : 0}%` }} /></div>
                      <Row label="Payers" value={`${activeMembers.length} active`} />
                      <Row label="Monthly total" value={fmtCurrency(monthlyTotal)} />
                      {plan.special_payments && plan.special_payments.length > 0 && (
                        <Row label="Deposits & charges" value={`${plan.special_payments.length} on file`} />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="lh-cols">
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Tenants ({lease.tenants.length})</span>
                  <button className="lnk-btn" onClick={() => selectTab('tenants')}>Manage →</button>
                </div>
                <div className="card-bd">
                  {lease.tenants.length === 0 ? (
                    <div className="empty-inline">No tenants on this lease yet.</div>
                  ) : lease.tenants.map(t => {
                    const member = (plan?.tenants ?? []).find(
                      m => m.email && t.email && m.email.toLowerCase() === t.email.toLowerCase()
                    )
                    return (
                      <div key={t.id} className="person">
                        <div className="avatar">{(t.name || t.email || '?').slice(0, 2).toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="person-name">{t.name || '—'}</div>
                          {t.email && <div className="person-sub">{t.email}</div>}
                        </div>
                        {member && <div className="person-amt">{fmtCurrency(member.monthly_total)}/mo</div>}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Documents ({lease.documents.length})</span>
                  <button className="lnk-btn" onClick={() => selectTab('documents')}>Manage →</button>
                </div>
                <div className="card-bd">
                  {lease.documents.length === 0 ? (
                    <div className="empty-inline">
                      No signed lease or agreements uploaded yet.
                    </div>
                  ) : lease.documents.slice(0, 4).map(d => (
                    <div key={d.id} className="doc">
                      <span>📄</span>
                      <span className="doc-name">{d.name}</span>
                      {signedUrls[d.id] && (
                        <a href={signedUrls[d.id]} target="_blank" rel="noopener noreferrer" className="lnk">Open</a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══ TENANTS ══ */}
        {tab === 'tenants' && (
          <>
            <div className="card">
              <div className="card-hd"><span className="card-title">On the lease ({lease.tenants.length})</span></div>
              <div className="card-bd">
                {lease.tenants.length === 0 ? (
                  <div className="empty-inline">
                    No tenants assigned. <a href={`/landlord/leases/${leaseId}/edit`} className="lnk">Edit the lease</a> to add them.
                  </div>
                ) : lease.tenants.map(t => (
                  <div key={t.id} className="person">
                    <div className="avatar">{(t.name || t.email || '?').slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="person-name">{t.name || '—'}</div>
                      {t.email && <div className="person-sub">{t.email}</div>}
                    </div>
                    {t.tenant_id && <a href="/landlord/tenants" className="lnk">Tenant record →</a>}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-hd">
                <span className="card-title">Who pays ({(plan?.tenants ?? []).length})</span>
                {plan && (
                  <button className="btn-dark-sm" onClick={() => { setShowAddMember(v => !v); setMemberError('') }}>
                    {showAddMember ? 'Cancel' : '+ Add payer'}
                  </button>
                )}
              </div>
              <div className="card-bd">
                {!plan ? (
                  <div className="empty-inline">
                    Rent isn&apos;t being tracked for this lease yet.
                    <a href={`/landlord/payments/new?lease=${leaseId}`} className="btn-dark" style={{ marginTop: 12, display: 'inline-block' }}>
                      Set up rent collection
                    </a>
                  </div>
                ) : (
                  <>
                    {plan.tenants.length === 0 && !showAddMember && (
                      <div className="empty-inline">No payers on the plan yet.</div>
                    )}
                    {plan.tenants.map(m => (
                      <div key={m.id}>
                        <div className="person">
                          <div className={`avatar${m.status !== 'active' ? ' off' : ''}`}>{m.name.slice(0, 2).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="person-name">
                              {m.name}
                              <span className={`chip chip-${m.status}`}>
                                {m.status === 'active' ? 'Active' : m.status === 'terminated' ? 'Terminated' : 'Completed'}
                              </span>
                            </div>
                            {m.email && <div className="person-sub">{m.email}</div>}
                            <div className="person-sub">
                              {fmtCurrency(m.monthly_total)}/mo
                              {m.start_date && ` · from ${fmtDate(m.start_date)}`}
                              {m.end_date && ` → ${fmtDate(m.end_date)}`}
                              {m.termination_date && ` · terminated ${fmtDate(m.termination_date)}`}
                              {m.termination_reason && ` (${m.termination_reason})`}
                            </div>
                          </div>
                          {m.status === 'active' && (
                            <button
                              className="btn-danger-sm"
                              onClick={() => {
                                setShowTerminate(showTerminate === m.id ? null : m.id)
                                setTerminationDate(''); setTerminationReason(''); setTerminatePreview(null)
                              }}
                            >
                              Terminate
                            </button>
                          )}
                        </div>

                        {showTerminate === m.id && (
                          <div className="panel-danger">
                            <div className="panel-title">Early termination — {m.name}</div>
                            <div className="grid2">
                              <Field label="Termination date">
                                <input className="inp" type="date" value={terminationDate}
                                  onChange={e => { setTerminationDate(e.target.value); loadTerminatePreview(m.id, e.target.value) }} />
                              </Field>
                              <Field label="Reason (optional)">
                                <input className="inp" type="text" value={terminationReason}
                                  onChange={e => setTerminationReason(e.target.value)} placeholder="e.g. Moved out early" />
                              </Field>
                            </div>
                            {terminatePreview !== null && terminationDate && (
                              <div className="void-note">
                                {terminatePreview === 0
                                  ? 'No future pending payments to void.'
                                  : `${terminatePreview} future payment${terminatePreview !== 1 ? 's' : ''} will be voided after ${fmtDate(terminationDate)}.`}
                              </div>
                            )}
                            <div className="btn-row">
                              <button className="btn-danger" disabled={!terminationDate || terminateSaving} onClick={handleTerminate}>
                                {terminateSaving ? 'Terminating…' : 'Confirm termination'}
                              </button>
                              <button className="btn-ghost" onClick={() => setShowTerminate(null)}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {showAddMember && (
                      <div className="panel">
                        <div className="panel-title">Add payer</div>
                        <div className="grid2">
                          <Field label="Full name *">
                            <input className="inp" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Doe" />
                          </Field>
                          <Field label="Email">
                            <input className="inp" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@email.com" />
                          </Field>
                        </div>
                        <div className="grid3">
                          <Field label="Monthly amount *">
                            <input className="inp" type="number" min="0" step="0.01" value={newMonthly} onChange={e => setNewMonthly(e.target.value)} placeholder="750" />
                          </Field>
                          <Field label="Start date">
                            <input className="inp" type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} />
                          </Field>
                          <Field label="End date">
                            <input className="inp" type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} />
                          </Field>
                        </div>
                        <label className="switch-row">
                          <input type="checkbox" checked={generateSchedule} onChange={e => setGenerateSchedule(e.target.checked)} />
                          Generate payment schedule
                        </label>
                        {generateSchedule && (
                          <label className="switch-row">
                            <input type="checkbox" checked={includeProration} onChange={e => setIncludeProration(e.target.checked)} />
                            Prorate first month
                          </label>
                        )}
                        {prorationPreview && (
                          <div className="proration">
                            <strong>Proration preview:</strong> first payment on {fmtDate(newStartDate)} is{' '}
                            <strong>{fmtCurrency(prorationPreview.proratedAmount)}</strong>{' '}
                            ({prorationPreview.proratedDays} of {prorationPreview.totalDays} days).
                            Full payments of <strong>{fmtCurrency(parseFloat(newMonthly))}</strong> start {fmtDate(prorationPreview.firstDueDate)}.
                          </div>
                        )}
                        <div className="btn-row">
                          <button className="btn-dark" disabled={!newName || !newMonthly || memberSaving} onClick={handleAddMember}>
                            {memberSaving ? 'Adding…' : 'Add payer'}
                          </button>
                          <button className="btn-ghost" onClick={() => { setShowAddMember(false); setMemberError('') }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* ══ PAYMENTS — the full rent ledger, in place ══ */}
        {tab === 'payments' && (
          <div className="card">
            <div className="card-hd">
              <span className="card-title">Rent ledger</span>
              {plan && (
                <a href={`/landlord/payments/${plan.id}`} className="lnk">Open full page ↗</a>
              )}
            </div>
            <div className="card-bd">
              {!plan ? (
                <div className="empty-inline">
                  No payment plan for this lease yet. Set one up to schedule rent, track who has
                  paid, and record deposits and one-off charges.
                  <a href={`/landlord/payments/new?lease=${leaseId}`} className="btn-dark" style={{ marginTop: 14, display: 'inline-block' }}>
                    Set up rent collection
                  </a>
                </div>
              ) : (
                <PlanWorkspace planId={plan.id} embedded />
              )}
            </div>
          </div>
        )}

        {/* ══ DOCUMENTS ══ */}
        {tab === 'documents' && (
          <div className="card">
            <div className="card-hd"><span className="card-title">Lease documents ({lease.documents.length})</span></div>
            <div className="card-bd">
              <div className="hint" style={{ marginBottom: 14 }}>
                Signed lease, addenda, house rules, move-in condition reports — anything tied to this
                tenancy. Files are private; links you open expire after an hour.
              </div>

              {lease.documents.length === 0 ? (
                <div className="empty-inline">Nothing uploaded yet.</div>
              ) : lease.documents.map(d => (
                <div key={d.id} className="doc">
                  <span>📄</span>
                  <span className="doc-name">{d.name}</span>
                  <span className="doc-date">{new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {signedUrls[d.id]
                    ? <a href={signedUrls[d.id]} target="_blank" rel="noopener noreferrer" className="lnk">Download</a>
                    : <span className="person-sub">Loading…</span>}
                  <button className="btn-danger-sm" onClick={() => removeDoc(d)}>Delete</button>
                </div>
              ))}

              <div className="panel" style={{ marginTop: 16 }}>
                <div className="panel-title">Upload a document</div>
                <div className="grid2">
                  <Field label="File">
                    <input className="inp" type="file" onChange={e => {
                      const f = e.target.files?.[0] ?? null
                      setDocFile(f)
                      if (f && !docName) setDocName(f.name.replace(/\.[^.]+$/, ''))
                    }} />
                  </Field>
                  <Field label="Display name">
                    <input className="inp" value={docName} onChange={e => setDocName(e.target.value)} placeholder="Signed lease agreement" />
                  </Field>
                </div>
                <button className="btn-dark" disabled={!docFile || docUploading} onClick={uploadDoc}>
                  {docUploading ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ MOVE-OUT ══ */}
        {tab === 'moveout' && (
          <div className="card">
            <div className="card-hd">
              <span className="card-title">Move-out inspections</span>
              {inspections.length > 0 && (
                <button className="btn-dark-sm" onClick={startInspection} disabled={creatingInspection}>
                  {creatingInspection ? 'Starting…' : '+ New inspection'}
                </button>
              )}
            </div>
            <div className="card-bd">
              {inspections.length === 0 ? (
                <div className="empty-inline">
                  {status === 'past'
                    ? 'This lease has ended. Generate a move-out report to log findings, attach photos, split costs across tenants and reconcile deposits.'
                    : 'When the tenancy ends, generate a move-out report — findings with photos and costs, charged to the right tenants, with deposits reconciled.'}
                  {' '}Other leases on this property can be linked to the same report.
                  <button className="btn-dark" style={{ marginTop: 14, display: 'block' }} onClick={startInspection} disabled={creatingInspection}>
                    {creatingInspection ? 'Starting…' : 'Start checkout inspection'}
                  </button>
                </div>
              ) : inspections.map(ins => {
                const t = computeTotals(ins)
                return (
                  <div key={ins.id} className="person">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="person-name">
                        {ins.title || 'Move-out inspection'}
                        <span className={`chip chip-${ins.status === 'settled' ? 'active' : ins.status === 'finalized' ? 'terminated' : 'completed'}`}>
                          {ins.status === 'settled' ? 'Settled' : ins.status === 'finalized' ? 'Awaiting refunds' : 'Draft'}
                        </span>
                      </div>
                      <div className="person-sub">
                        {ins.items.length} finding{ins.items.length !== 1 ? 's' : ''} ·{' '}
                        {ins.parties.length} tenant{ins.parties.length !== 1 ? 's' : ''} ·{' '}
                        {fmtMoney(t.chargeable)} charged
                        {ins.status !== 'draft' && t.outstandingRefunds > 0
                          ? ` · ${fmtMoney(t.outstandingRefunds)} still to refund`
                          : ` · ${fmtMoney(t.totalRefunds)} refundable`}
                      </div>
                    </div>
                    <a href={`/checkout-report/${ins.share_token}`} target="_blank" rel="noopener noreferrer" className="lnk">Report ↗</a>
                    <a href={`/landlord/inspections/${ins.id}`} className="lnk">Open →</a>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="fig">
      <div className="fig-label">{label}</div>
      <div className={`fig-val${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label className="lbl">{label}</label>{children}</div>
}

function Action({
  tone, title, body, cta, onClick, href,
}: {
  tone: 'bad' | 'warn'
  title: string
  body: string
  cta: string
  onClick?: () => void
  href?: string
}) {
  return (
    <div className={`action ${tone}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="action-title">{title}</div>
        <div className="action-body">{body}</div>
      </div>
      {href
        ? <a href={href} className="btn-ghost">{cta}</a>
        : <button className="btn-ghost" onClick={onClick}>{cta}</button>}
    </div>
  )
}

function ordinal(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 4] ?? 'th'
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .lh-wrap { max-width: 1000px; margin: 0 auto; padding: 26px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .lh-crumb { font-size: 13px; color: #64748b; margin-bottom: 14px; }
  .lh-crumb a { color: #10b981; text-decoration: none; }
  .lh-crumb a:hover { text-decoration: underline; }

  .lh-head { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 20px 22px 0; margin-bottom: 18px; }
  .lh-head-main { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .lh-title { font-size: 23px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .lh-sub { font-size: 13px; color: #64748b; margin-top: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lh-unit { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #eef2f7; color: #475569; padding: 2px 8px; border-radius: 5px; }
  .lh-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .lh-status { font-size: 12px; font-weight: 700; padding: 4px 13px; border-radius: 20px; border: 1px solid; }

  .lh-figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 18px 0 4px; }
  .fig { border-left: 2px solid #e2e8f0; padding-left: 12px; }
  .fig-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 3px; }
  .fig-val { font-size: 16px; font-weight: 700; color: #0f172a; }
  .fig-val.good { color: #059669; }
  .fig-val.bad { color: #dc2626; }

  .lh-tabs { display: flex; gap: 2px; margin-top: 16px; border-top: 1px solid #f1f5f9; overflow-x: auto; }
  .lh-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 12px 15px; font-size: 13.5px; font-weight: 500; color: #64748b; cursor: pointer; font-family: inherit; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  .lh-tab:hover { color: #0f172a; }
  .lh-tab.active { color: #0f172a; font-weight: 700; border-bottom-color: #0f172a; }
  .lh-count { background: #eef2f7; color: #64748b; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
  .lh-count.bad { background: #fee2e2; color: #991b1b; }

  .lh-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
  .card-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 18px; border-bottom: 1px solid #f1f5f9; }
  .card-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px; }
  .card-bd { padding: 16px 18px; }

  .row { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid #f8fafc; font-size: 13.5px; }
  .row:last-child { border-bottom: none; }
  .row-label { color: #64748b; flex-shrink: 0; }
  .row-value { color: #0f172a; font-weight: 500; text-align: right; }
  .notes { white-space: pre-wrap; font-weight: 400; color: #475569; font-size: 13px; }

  .bar { height: 5px; background: #f1f5f9; border-radius: 99px; overflow: hidden; margin: 6px 0 10px; }
  .bar-fill { height: 100%; background: #10b981; border-radius: 99px; }

  .person { display: flex; align-items: center; gap: 11px; padding: 10px 0; border-bottom: 1px solid #f8fafc; }
  .person:last-child { border-bottom: none; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; background: rgba(16,185,129,0.14); color: #10b981; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
  .avatar.off { background: #f1f5f9; color: #94a3b8; }
  .person-name { font-size: 13.5px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .person-sub { font-size: 11.5px; color: #94a3b8; margin-top: 1px; }
  .person-amt { font-size: 13px; font-weight: 600; color: #0f172a; white-space: nowrap; }

  .chip { font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.4px; }
  .chip-active { background: #dcfce7; color: #166534; }
  .chip-terminated { background: #fce7f3; color: #9d174d; }
  .chip-completed { background: #f1f5f9; color: #475569; }

  .doc { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f8fafc; font-size: 13.5px; }
  .doc:last-child { border-bottom: none; }
  .doc-name { flex: 1; font-weight: 500; color: #0f172a; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .doc-date { font-size: 11.5px; color: #94a3b8; white-space: nowrap; }

  .action { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 10px; margin-bottom: 10px; }
  .action:last-child { margin-bottom: 0; }
  .action.bad { background: #fef2f2; border: 1px solid #fecaca; }
  .action.warn { background: #fffbeb; border: 1px solid #fde68a; }
  .action-title { font-size: 13.5px; font-weight: 700; color: #0f172a; }
  .action-body { font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.5; }

  .lnk { color: #10b981; text-decoration: none; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
  .lnk:hover { text-decoration: underline; }
  .lnk-btn { background: none; border: none; color: #10b981; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .lnk-btn:hover { text-decoration: underline; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; }
  .btn-dark:disabled { opacity: .5; cursor: not-allowed; }
  .btn-dark-sm { background: #0f172a; color: #34d399; border: none; border-radius: 7px; padding: 6px 13px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-ghost { background: #fff; color: #475569; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; white-space: nowrap; }
  .btn-ghost:hover { border-color: #94a3b8; }
  .btn-danger { background: #dc2626; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-danger:disabled { opacity: .5; cursor: not-allowed; }
  .btn-danger-sm { background: none; border: 1px solid #fca5a5; color: #dc2626; border-radius: 6px; padding: 3px 10px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
  .btn-danger-sm:hover { background: #fef2f2; }
  .btn-row { display: flex; gap: 9px; margin-top: 12px; flex-wrap: wrap; }

  .panel { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 15px; margin-top: 12px; }
  .panel-danger { background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: 10px; padding: 15px; margin: 4px 0 12px; }
  .panel-title { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
  .void-note { font-size: 12px; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 7px; padding: 8px 12px; margin-top: 10px; }
  .proration { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 11px 13px; font-size: 12px; color: #166534; margin-top: 10px; line-height: 1.5; }

  .field { margin-bottom: 12px; }
  .lbl { display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
  .inp { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; color: #0f172a; font-family: inherit; background: #fff; outline: none; }
  .inp:focus { border-color: #10b981; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .switch-row { display: flex; align-items: center; gap: 9px; font-size: 13px; color: #334155; padding: 5px 0; cursor: pointer; }
  .switch-row input { accent-color: #10b981; cursor: pointer; }

  .hint { font-size: 12px; color: #94a3b8; line-height: 1.55; }
  .empty-inline { font-size: 13px; color: #94a3b8; line-height: 1.6; }

  .alert-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }
  .alert-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }

  @media (max-width: 820px) {
    .lh-cols, .grid2, .grid3 { grid-template-columns: 1fr; }
    .lh-figs { grid-template-columns: repeat(2, 1fr); }
  }
`
