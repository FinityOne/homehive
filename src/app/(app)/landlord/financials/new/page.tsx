'use client'

import { useEffect, useState } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import {
  createPlan, generateScheduleDates, buildPaymentSchedule, previewProration,
  fmtCurrency, fmtDate, fmtMonth, fmtOrdinal,
  PRORATION_DAYS_PER_MONTH, LINE_ITEM_CATEGORIES, SPECIAL_CATEGORIES, type SpecialCategory,
} from '@/lib/payments'

// ─── TYPES ────────────────────────────────────────────────────────────────────

type LineItemDraft = { category: string; label: string; amount: string }
type TenantDraft   = { name: string; email: string; lineItems: LineItemDraft[] }
type SpecialDraft  = { category: SpecialCategory; label: string; amount: string; dueDate: string; forTenant: 'all' | number }

type Property = { id: string; name: string; slug: string }
type Lease    = { id: string; start_date: string; end_date: string; rent_amount: number | null }
/** A person already recorded on the lease — offered as a one-click payer. */
type LeaseTenant = { id: string; name: string | null; email: string | null }

// ─── STEP INDICATOR ──────────────────────────────────────────────────────────

function StepBar({ step, total }: { step: number; total: number }) {
  const labels = ['Property & Lease', 'Payers', 'Schedule & Fees', 'Special Charges', 'Review']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
      {labels.slice(0, total).map((label, i) => {
        const n = i + 1
        const done    = n < step
        const current = n === step
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: n < total ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: 700,
                background: done ? '#10b981' : current ? '#0f172a' : '#e2e8f0',
                color: done || current ? '#fff' : '#94a3b8',
                transition: 'all 0.2s',
              }}>
                {done ? '✓' : n}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: current ? '#0f172a' : '#94a3b8', marginTop: 4, whiteSpace: 'nowrap' }}>
                {label}
              </div>
            </div>
            {n < total && (
              <div style={{ flex: 1, height: '2px', background: done ? '#10b981' : '#e2e8f0', margin: '0 6px', marginBottom: 16, transition: 'background 0.2s' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── FORM HELPERS ─────────────────────────────────────────────────────────────

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        {label}
        {note && <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>{note}</span>}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: '14px',
  border: '1.5px solid #e2e8f0', borderRadius: '8px',
  outline: 'none', fontFamily: "'DM Sans', sans-serif",
  background: '#fff', color: '#0f172a', boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function NewPaymentPlanPage() {
  const [userId,      setUserId]     = useState('')
  const [step,        setStep]       = useState(1)
  const [saving,      setSaving]     = useState(false)
  const [error,       setError]      = useState('')

  // Step 1
  const [properties,        setProperties]        = useState<Property[]>([])
  const [selectedPropId,    setSelectedPropId]    = useState('')
  const [leases,            setLeases]            = useState<Lease[]>([])
  const [selectedLeaseId,   setSelectedLeaseId]   = useState('')
  const [leaseTenants,      setLeaseTenants]      = useState<LeaseTenant[]>([])
  const [planName,          setPlanName]          = useState('')

  // Step 2 — payers
  const [splitType, setSplitType] = useState<'single' | 'multi'>('single')
  const [tenants, setTenants]     = useState<TenantDraft[]>([
    { name: '', email: '', lineItems: [{ category: 'rent', label: 'Rent', amount: '' }] },
  ])

  // Step 3 — schedule & late fees
  const [dueDay,          setDueDay]          = useState(1)
  const [lateFeeEnabled,  setLateFeeEnabled]  = useState(false)
  const [graceDays,       setGraceDays]       = useState(0)
  const [feeAmount,       setFeeAmount]       = useState('')
  const [feeFreqDays,     setFeeFreqDays]     = useState(1)
  const [feeMax,          setFeeMax]          = useState('')

  // Step 4 — special charges
  const [specials, setSpecials] = useState<SpecialDraft[]>([])

  // Declared before the effects that use it — the ?lease= preselect calls it.
  function loadLeaseTenants(leaseId: string) {
    setLeaseTenants([])
    if (!leaseId) return
    supabase
      .from('lease_tenants')
      .select('id, name, email')
      .eq('lease_id', leaseId)
      .then(({ data }) => setLeaseTenants((data ?? []).filter(t => t.name || t.email)))
  }

  useEffect(() => { document.title = 'New Payment — Landlord | HomeHive' }, [])

  useEffect(() => {
    getCurrentUser().then(user => {
      if (!user) return
      setUserId(user.id)
      supabase.from('properties').select('id, name, slug').eq('owner_id', user.id).eq('admin_status', 'active')
        .then(({ data }) => setProperties(data ?? []))
    })
  }, [])

  // Arriving from a lease ("Set up rent collection") — preselect its property
  // and the lease itself so the landlord starts on step 1 already filled in.
  useEffect(() => {
    const leaseParam = new URLSearchParams(window.location.search).get('lease')
    if (!leaseParam || properties.length === 0 || selectedLeaseId) return

    supabase
      .from('leases')
      .select('id, property_id, start_date, end_date, rent_amount')
      .eq('id', leaseParam)
      .maybeSingle()
      .then(({ data: lease }) => {
        if (!lease) return
        const prop = properties.find(p => p.id === lease.property_id)
        if (!prop) return
        setSelectedPropId(lease.property_id)
        setPlanName(`Rent – ${prop.name}`)
        setLeases([lease])
        setSelectedLeaseId(lease.id)
        loadLeaseTenants(lease.id)
        setTenants(prev => prev.map((t, i) => i === 0 ? {
          ...t,
          lineItems: [{ category: 'rent', label: 'Rent', amount: lease.rent_amount?.toString() ?? '' }],
        } : t))
      })
  }, [properties, selectedLeaseId])

  const selectedLease = leases.find(l => l.id === selectedLeaseId)
  const selectedProp  = properties.find(p => p.id === selectedPropId)

  // Load leases when property changes
  const onSelectProp = (id: string) => {
    setSelectedPropId(id)
    setSelectedLeaseId('')
    setLeases([])
    if (!id) return
    supabase.from('leases').select('id, start_date, end_date, rent_amount').eq('property_id', id).order('start_date', { ascending: false })
      .then(({ data }) => setLeases(data ?? []))
    const prop = properties.find(p => p.id === id)
    if (prop) setPlanName(`Rent – ${prop.name}`)
  }

  // When lease is selected, pre-fill rent line item and load the people already
  // on that lease so they can be picked as payers instead of retyped.
  const onSelectLease = (id: string) => {
    setSelectedLeaseId(id)
    loadLeaseTenants(id)
    const lease = leases.find(l => l.id === id)
    if (!lease) return
    setTenants(prev => prev.map((t, i) => i === 0 ? {
      ...t,
      lineItems: [{ category: 'rent', label: 'Rent', amount: lease.rent_amount?.toString() ?? '' }],
    } : t))
  }

  // ── Picking payers off the lease ───────────────────────────────────────────
  const sameParty = (a: { name: string; email: string }, b: LeaseTenant) => {
    const ae = a.email.trim().toLowerCase(), be = (b.email ?? '').trim().toLowerCase()
    if (ae && be) return ae === be
    return a.name.trim().toLowerCase() === (b.name ?? '').trim().toLowerCase()
  }

  const isPicked = (lt: LeaseTenant) => tenants.some(t => sameParty(t, lt))

  /** Toggle one lease tenant in or out of the payer list. */
  const togglePayer = (lt: LeaseTenant) => {
    setSplitType('multi')
    setTenants(prev => {
      const existing = prev.findIndex(t => sameParty(t, lt))
      if (existing >= 0) return prev.filter((_, i) => i !== existing)
      // Drop the empty starter row the wizard begins with.
      const seeded = prev.filter(t => t.name.trim() || t.email.trim() || tenantTotal(t) > 0)
      return [...seeded, {
        name: lt.name ?? '',
        email: lt.email ?? '',
        lineItems: [{ category: 'rent', label: 'Rent', amount: '' }],
      }]
    })
  }

  const addAllLeaseTenants = () => {
    setSplitType('multi')
    setTenants(leaseTenants.map(lt => ({
      name: lt.name ?? '',
      email: lt.email ?? '',
      lineItems: [{ category: 'rent', label: 'Rent', amount: '' }],
    })))
  }

  /**
   * Divide the lease rent across the current payers, in whole cents, giving the
   * remainder to the earliest rows so the parts always sum back to the rent.
   */
  const splitRentEvenly = () => {
    const rent = selectedLease?.rent_amount ?? 0
    if (rent <= 0 || tenants.length === 0) return
    const cents = Math.round(rent * 100)
    const base = Math.floor(cents / tenants.length)
    let rem = cents - base * tenants.length
    setTenants(prev => prev.map(t => {
      const extra = rem > 0 ? 1 : 0
      rem -= extra
      const share = ((base + extra) / 100).toFixed(2)
      const hasRent = t.lineItems.some(li => li.category === 'rent')
      return {
        ...t,
        lineItems: hasRent
          ? t.lineItems.map(li => li.category === 'rent' ? { ...li, amount: share } : li)
          : [{ category: 'rent', label: 'Rent', amount: share }, ...t.lineItems],
      }
    }))
  }

  // Tenant helpers
  const updateTenant = (i: number, field: keyof Omit<TenantDraft, 'lineItems'>, val: string) =>
    setTenants(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: val } : t))

  const updateLineItem = (ti: number, li: number, field: keyof LineItemDraft, val: string) =>
    setTenants(prev => prev.map((t, idx) => idx !== ti ? t : {
      ...t,
      lineItems: t.lineItems.map((item, lidx) => lidx !== li ? item : {
        ...item, [field]: val,
        ...(field === 'category' ? { label: LINE_ITEM_CATEGORIES.find(c => c.value === val)?.label ?? val } : {}),
      }),
    }))

  const addLineItem = (ti: number) =>
    setTenants(prev => prev.map((t, idx) => idx !== ti ? t : {
      ...t, lineItems: [...t.lineItems, { category: 'other', label: 'Other', amount: '' }],
    }))

  const removeLineItem = (ti: number, li: number) =>
    setTenants(prev => prev.map((t, idx) => idx !== ti ? t : {
      ...t, lineItems: t.lineItems.filter((_, lidx) => lidx !== li),
    }))

  const addTenant = () =>
    setTenants(prev => [...prev, { name: '', email: '', lineItems: [{ category: 'rent', label: 'Rent', amount: '' }] }])

  const removeTenant = (i: number) =>
    setTenants(prev => prev.filter((_, idx) => idx !== i))

  // Validation helpers
  const tenantTotal = (t: TenantDraft) =>
    t.lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0)

  const grandTotal   = tenants.reduce((s, t) => s + tenantTotal(t), 0)
  const leaseRent    = selectedLease?.rent_amount ?? 0
  const amountMatch  = leaseRent === 0 || Math.abs(grandTotal - leaseRent) < 0.01

  // Preview schedule
  const previewDates = selectedLease
    ? generateScheduleDates(selectedLease.start_date, selectedLease.end_date, dueDay)
    : []

  // Mid-month proration preview (uses the plan's combined monthly total).
  const proration = selectedLease && grandTotal > 0
    ? previewProration(selectedLease.start_date, selectedLease.end_date, dueDay, grandTotal)
    : null
  const prorationApplies = !!proration?.applies

  // Plan-level schedule entries (combined across payers) for the review preview.
  const previewEntries = selectedLease && grandTotal > 0
    ? buildPaymentSchedule(selectedLease.start_date, selectedLease.end_date, dueDay, grandTotal)
    : []
  const totalPayments = (previewDates.length + (prorationApplies ? 1 : 0)) * tenants.length
  // With proration the schedule is: move-in (full) + following (prorated) + (M−1) full months.
  // = grandTotal × M + prorated following amount.
  const leaseTotal = prorationApplies && proration
    ? grandTotal * previewDates.length + proration.followingAmount
    : grandTotal * previewDates.length

  const canNext: Record<number, boolean> = {
    1: !!selectedPropId && !!selectedLeaseId && planName.trim().length > 0,
    2: tenants.every(t => t.name.trim() && tenantTotal(t) > 0),
    3: !lateFeeEnabled || (!!feeAmount && parseFloat(feeAmount) > 0),
    4: true,
  }

  // ─── SUBMIT ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selectedLease) return
    setSaving(true)
    setError('')
    const { planId, error: err } = await createPlan({
      ownerId:    userId,
      propertyId: selectedPropId,
      leaseId:    selectedLeaseId,
      name:       planName.trim(),
      dueDay,
      leaseStart: selectedLease.start_date,
      leaseEnd:   selectedLease.end_date,
      tenants: tenants.map(t => ({
        name:         t.name.trim(),
        email:        t.email.trim() || undefined,
        monthlyTotal: tenantTotal(t),
        lineItems:    t.lineItems.filter(li => li.amount && parseFloat(li.amount) > 0).map(li => ({
          category: li.category,
          label:    li.label,
          amount:   parseFloat(li.amount),
        })),
      })),
      lateFeeRule: lateFeeEnabled ? {
        gracePeriodDays: graceDays,
        feeAmount:       parseFloat(feeAmount),
        frequencyDays:   feeFreqDays,
        maxTotalFees:    feeMax ? parseFloat(feeMax) : undefined,
      } : undefined,
      specialCharges: specials.map(sc => ({
        planTenantIndex: sc.forTenant === 'all' ? undefined : sc.forTenant,
        category:  sc.category,
        label:     sc.label,
        amount:    parseFloat(sc.amount),
        dueDate:   sc.dueDate,
      })).filter(sc => sc.amount > 0 && sc.dueDate),
    })
    setSaving(false)
    if (err || !planId) { setError('Something went wrong. Please try again.'); return }
    window.location.href = `/landlord/financials?plan=${planId}`
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────────

  const CARD: React.CSSProperties = {
    background: '#fff', borderRadius: '14px', border: '1px solid #e2e8f0',
    padding: '28px 30px', marginBottom: 0,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,wght@0,300;1,300&display=swap'); input:focus, select:focus, textarea:focus { border-color: #0f172a !important; box-shadow: 0 0 0 3px rgba(15,23,42,0.07); } .toggle-btn { cursor:pointer; transition: all 0.15s; } .toggle-btn:hover { filter: brightness(0.95); }`}</style>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 28px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <a href="/landlord/financials" style={{ color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}>← Financials</a>
        <span style={{ color: '#cbd5e1' }}>/</span>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>New Payment Plan</span>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '32px 20px' }}>
        <StepBar step={step} total={5} />

        {/* ── STEP 1: Property & Lease ── */}
        {step === 1 && (
          <div style={CARD}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Property & Lease</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: 24, marginTop: 0 }}>Select the property and lease this payment plan is tied to.</p>

            <Field label="Property">
              <select style={selectStyle} value={selectedPropId} onChange={e => onSelectProp(e.target.value)}>
                <option value="">Select a property…</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>

            {selectedPropId && (
              <Field label="Lease">
                {leases.length === 0
                  ? <div style={{ fontSize: '13px', color: '#94a3b8', padding: '10px 0' }}>
                      No leases found. <a href="/landlord/leases/new" style={{ color: '#0f172a', fontWeight: 600 }}>Create one →</a>
                    </div>
                  : <select style={selectStyle} value={selectedLeaseId} onChange={e => onSelectLease(e.target.value)}>
                      <option value="">Select a lease…</option>
                      {leases.map(l => (
                        <option key={l.id} value={l.id}>
                          {fmtDate(l.start_date)} – {fmtDate(l.end_date)}
                          {l.rent_amount ? ` · ${fmtCurrency(l.rent_amount)}/mo` : ''}
                        </option>
                      ))}
                    </select>
                }
              </Field>
            )}

            {selectedLease && (
              <>
                <div style={{ background: '#f8fafc', borderRadius: '9px', padding: '14px 16px', marginBottom: 18, border: '1px solid #e2e8f0', display: 'flex', gap: 24 }}>
                  <LabelVal label="Start"   value={fmtDate(selectedLease.start_date)} />
                  <LabelVal label="End"     value={fmtDate(selectedLease.end_date)} />
                  <LabelVal label="Monthly" value={selectedLease.rent_amount ? fmtCurrency(selectedLease.rent_amount) : 'Not set'} />
                </div>
                <Field label="Plan name">
                  <input style={inputStyle} value={planName} onChange={e => setPlanName(e.target.value)} placeholder="e.g. Rent – 123 Main St" />
                </Field>
              </>
            )}
          </div>
        )}

        {/* ── STEP 2: Payers ── */}
        {step === 2 && (
          <div style={CARD}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Payers</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: 20, marginTop: 0 }}>
              Configure who pays and how much. Line items break down the monthly total (rent, utilities, etc.).
            </p>

            {/* People already on the lease — pick instead of retype */}
            {leaseTenants.length > 0 && (
              <div style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', marginBottom: 20, background: '#fafbfc' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                      Tenants on this lease ({leaseTenants.length})
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: 2 }}>
                      Tap anyone who pays rent directly — their name and email come across.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={addAllLeaseTenants}
                      style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
                    >
                      Add all as payers
                    </button>
                    {leaseRent > 0 && tenants.length > 1 && (
                      <button
                        onClick={splitRentEvenly}
                        style={{ background: '#0f172a', border: 'none', borderRadius: '7px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: '#34d399', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
                      >
                        Split {fmtCurrency(leaseRent)} evenly
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {leaseTenants.map(lt => {
                    const on = isPicked(lt)
                    return (
                      <button
                        key={lt.id}
                        onClick={() => togglePayer(lt)}
                        title={lt.email ?? undefined}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          border: `1.5px solid ${on ? '#10b981' : '#e2e8f0'}`,
                          background: on ? '#ecfdf5' : '#fff',
                          color: on ? '#065f46' : '#334155',
                          fontWeight: on ? 700 : 500,
                          borderRadius: '20px', padding: '7px 13px', fontSize: '13px',
                          cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
                        }}
                      >
                        <span style={{ fontSize: '11px' }}>{on ? '✓' : '+'}</span>
                        {lt.name || lt.email}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Split type */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              {(['single', 'multi'] as const).map(t => (
                <button
                  key={t}
                  className="toggle-btn"
                  onClick={() => {
                    setSplitType(t)
                    if (t === 'single') {
                      setTenants([{ name: tenants[0]?.name ?? '', email: tenants[0]?.email ?? '', lineItems: [{ category: 'rent', label: 'Rent', amount: selectedLease?.rent_amount?.toString() ?? '' }] }])
                    }
                  }}
                  style={{
                    flex: 1, padding: '12px 16px', borderRadius: '9px', cursor: 'pointer', border: '1.5px solid',
                    borderColor: splitType === t ? '#0f172a' : '#e2e8f0',
                    background: splitType === t ? '#0f172a' : '#fff',
                    color: splitType === t ? '#fff' : '#475569',
                    fontSize: '13px', fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  {t === 'single' ? '⊞ One payer (whole group)' : '⊙ Multiple payers'}
                </button>
              ))}
            </div>

            {/* Amount validation */}
            {leaseRent > 0 && (
              <div style={{
                background: amountMatch ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${amountMatch ? '#bbf7d0' : '#fca5a5'}`,
                borderRadius: '8px', padding: '10px 14px', marginBottom: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: '13px',
              }}>
                <span style={{ color: amountMatch ? '#166534' : '#991b1b', fontWeight: 600 }}>
                  {amountMatch ? `✓ Totals match: ${fmtCurrency(grandTotal)}/mo` : `⚠ Total ${fmtCurrency(grandTotal)} ≠ lease ${fmtCurrency(leaseRent)}/mo`}
                </span>
                {!amountMatch && <span style={{ color: '#b91c1c', fontSize: '12px' }}>Difference: {fmtCurrency(Math.abs(grandTotal - leaseRent))}</span>}
              </div>
            )}

            {/* Tenant rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {tenants.map((t, ti) => (
                <div key={ti} style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', background: '#fafafa', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                      {splitType === 'single' ? 'Payer' : `Tenant ${ti + 1}`}
                    </span>
                    {splitType === 'multi' && tenants.length > 1 && (
                      <button onClick={() => removeTenant(ti)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', borderRadius: '4px' }}>×</button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>NAME *</label>
                      <input style={inputStyle} value={t.name} onChange={e => updateTenant(ti, 'name', e.target.value)} placeholder="Full name" />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>EMAIL (optional)</label>
                      <input style={inputStyle} type="email" value={t.email} onChange={e => updateTenant(ti, 'email', e.target.value)} placeholder="email@example.com" />
                    </div>
                  </div>

                  {/* Line items */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: 8 }}>LINE ITEMS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {t.lineItems.map((li, lidx) => (
                        <div key={lidx} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 100px 28px', gap: 6, alignItems: 'center' }}>
                          <select style={{ ...selectStyle, padding: '7px 10px', fontSize: '12px' }} value={li.category} onChange={e => updateLineItem(ti, lidx, 'category', e.target.value)}>
                            {LINE_ITEM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                          <input style={{ ...inputStyle, padding: '7px 10px', fontSize: '12px' }} value={li.label} onChange={e => updateLineItem(ti, lidx, 'label', e.target.value)} placeholder="Label" />
                          <input style={{ ...inputStyle, padding: '7px 10px', fontSize: '12px' }} type="number" min="0" step="0.01" value={li.amount} onChange={e => updateLineItem(ti, lidx, 'amount', e.target.value)} placeholder="$0" />
                          {t.lineItems.length > 1 && (
                            <button onClick={() => removeLineItem(ti, lidx)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '15px', padding: 0 }}>×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button onClick={() => addLineItem(ti)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'DM Sans', sans-serif" }}>
                      + Add line item
                    </button>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      {fmtCurrency(tenantTotal(t))}<span style={{ fontSize: '11px', fontWeight: 400, color: '#64748b' }}>/mo</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {splitType === 'multi' && (
              <button onClick={addTenant} style={{ marginTop: 12, width: '100%', padding: '10px', border: '1.5px dashed #cbd5e1', borderRadius: '9px', background: 'none', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                + Add tenant
              </button>
            )}
          </div>
        )}

        {/* ── STEP 3: Schedule & Late Fees ── */}
        {step === 3 && (
          <div style={CARD}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Schedule & Late Fees</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: 24, marginTop: 0 }}>
              Set the payment due date and optionally configure late fee penalties.
            </p>

            <Field label="Payment due on the" note="of each month (1–28)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  style={{ ...inputStyle, width: 80 }} type="number" min={1} max={28}
                  value={dueDay} onChange={e => setDueDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                />
                <span style={{ fontSize: '14px', color: '#475569' }}>{fmtOrdinal(dueDay)} of every month</span>
              </div>
            </Field>

            {selectedLease && (
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px 14px', marginBottom: prorationApplies ? 12 : 20, fontSize: '13px', color: '#475569', border: '1px solid #e2e8f0' }}>
                📅 Will generate <strong>{generateScheduleDates(selectedLease.start_date, selectedLease.end_date, dueDay).length}</strong> monthly payments
                — {fmtDate(selectedLease.start_date)} through {fmtDate(selectedLease.end_date)}
              </div>
            )}

            {/* Mid-month proration notice */}
            {proration?.applies && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 14px', marginBottom: 20, fontSize: '12.5px', color: '#1e40af', lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>↺ Mid-month start — rent prorated</div>
                The lease starts mid-month, so the full first month&apos;s rent ({fmtCurrency(proration.moveInAmount)})
                is due on <strong>{fmtDate(proration.moveInDate)}</strong>. The tenant only owes prorated rent of{' '}
                <strong>{fmtCurrency(proration.proratedRent)}</strong>{' '}
                for the {proration.daysStayed} day{proration.daysStayed !== 1 ? 's' : ''} occupied
                ({proration.daysStayed} × {fmtCurrency(grandTotal)} ÷ {PRORATION_DAYS_PER_MONTH}, rounded up),
                leaving a <strong>{fmtCurrency(proration.credit)}</strong> credit.
                The following payment on <strong>{fmtDate(proration.followingDate)}</strong> applies that credit:{' '}
                <strong>{fmtCurrency(proration.followingAmount)}</strong> (rent − credit). Later months are full rent.
              </div>
            )}

            {/* Late fee toggle */}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: lateFeeEnabled ? 20 : 0 }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>Late fee penalties</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: 2 }}>Automatically track accruing fees on overdue payments</div>
                </div>
                <button
                  className="toggle-btn"
                  onClick={() => setLateFeeEnabled(v => !v)}
                  style={{
                    width: 44, height: 24, borderRadius: '99px', border: 'none', cursor: 'pointer',
                    background: lateFeeEnabled ? '#10b981' : '#cbd5e1', position: 'relative', flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3,
                    left: lateFeeEnabled ? 23 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {lateFeeEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Grace period (days)" note="before fees start">
                    <input style={inputStyle} type="number" min={0} value={graceDays} onChange={e => setGraceDays(Math.max(0, parseInt(e.target.value) || 0))} />
                  </Field>
                  <Field label="Late fee amount ($)">
                    <input style={inputStyle} type="number" min={0} step="0.01" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="e.g. 50" />
                  </Field>
                  <Field label="Add fee every (days)">
                    <select style={selectStyle} value={feeFreqDays} onChange={e => setFeeFreqDays(parseInt(e.target.value))}>
                      {[1, 2, 3, 5, 7, 14, 30].map(d => (
                        <option key={d} value={d}>{d === 1 ? 'Every day' : d === 7 ? 'Every week' : d === 30 ? 'Every month' : `Every ${d} days`}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Maximum total ($)" note="optional cap">
                    <input style={inputStyle} type="number" min={0} step="0.01" value={feeMax} onChange={e => setFeeMax(e.target.value)} placeholder="No cap" />
                  </Field>
                  {feeAmount && (
                    <div style={{ gridColumn: '1/-1', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#c2410c' }}>
                      After {graceDays} day{graceDays !== 1 ? 's' : ''} grace: {fmtCurrency(parseFloat(feeAmount) || 0)} added every {feeFreqDays} day{feeFreqDays !== 1 ? 's' : ''}
                      {feeMax ? ` (max ${fmtCurrency(parseFloat(feeMax))})` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 4: Special Charges ── */}
        {step === 4 && (
          <div style={CARD}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Special Charges</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: 20, marginTop: 0 }}>
              Add a security deposit or any one-time charges. These are tracked separately from monthly rent.
            </p>

            {/* Quick add security deposit */}
            {!specials.some(s => s.category === 'security_deposit') && (
              <button
                onClick={() => setSpecials(prev => [...prev, {
                  category: 'security_deposit', label: 'Security Deposit',
                  amount: selectedLease?.rent_amount?.toString() ?? '',
                  dueDate: selectedLease?.start_date ?? '',
                  forTenant: 'all',
                }])}
                style={{ marginBottom: 16, padding: '10px 16px', border: '1.5px dashed #cbd5e1', borderRadius: '9px', background: 'none', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", width: '100%' }}
              >
                + Add security deposit
              </button>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {specials.map((sc, idx) => (
                <div key={idx} style={{ border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', background: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>Special Charge {idx + 1}</span>
                    <button onClick={() => setSpecials(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}>×</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>TYPE</label>
                      <select style={{ ...selectStyle, fontSize: '12px', padding: '7px 10px' }} value={sc.category} onChange={e => setSpecials(prev => prev.map((s, i) => i === idx ? { ...s, category: e.target.value as SpecialCategory, label: SPECIAL_CATEGORIES.find(c => c.value === e.target.value)?.label ?? s.label } : s))}>
                        {SPECIAL_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>LABEL</label>
                      <input style={{ ...inputStyle, fontSize: '12px', padding: '7px 10px' }} value={sc.label} onChange={e => setSpecials(prev => prev.map((s, i) => i === idx ? { ...s, label: e.target.value } : s))} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>AMOUNT ($)</label>
                      <input style={{ ...inputStyle, fontSize: '12px', padding: '7px 10px' }} type="number" min={0} step="0.01" value={sc.amount} onChange={e => setSpecials(prev => prev.map((s, i) => i === idx ? { ...s, amount: e.target.value } : s))} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>DUE DATE</label>
                      <input style={{ ...inputStyle, fontSize: '12px', padding: '7px 10px' }} type="date" value={sc.dueDate} onChange={e => setSpecials(prev => prev.map((s, i) => i === idx ? { ...s, dueDate: e.target.value } : s))} />
                    </div>
                    {tenants.length > 1 && (
                      <div style={{ gridColumn: '1/-1' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>APPLIES TO</label>
                        <select style={{ ...selectStyle, fontSize: '12px', padding: '7px 10px' }} value={sc.forTenant === 'all' ? 'all' : String(sc.forTenant)} onChange={e => setSpecials(prev => prev.map((s, i) => i === idx ? { ...s, forTenant: e.target.value === 'all' ? 'all' : parseInt(e.target.value) } : s))}>
                          <option value="all">All tenants</option>
                          {tenants.map((t, ti) => <option key={ti} value={ti}>{t.name || `Tenant ${ti + 1}`}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSpecials(prev => [...prev, { category: 'special', label: 'Special Charge', amount: '', dueDate: selectedLease?.start_date ?? '', forTenant: 'all' }])}
              style={{ marginTop: 12, padding: '10px 16px', border: '1.5px dashed #cbd5e1', borderRadius: '9px', background: 'none', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", width: '100%' }}
            >
              + Add another charge
            </button>
          </div>
        )}

        {/* ── STEP 5: Review ── */}
        {step === 5 && selectedLease && (
          <div style={CARD}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Review & Create</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: 24, marginTop: 0 }}>Review your payment plan before generating the full schedule.</p>

            {/* Summary */}
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '18px 20px', marginBottom: 20, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <LabelVal label="Plan"        value={planName} />
                <LabelVal label="Property"    value={selectedProp?.name ?? '—'} />
                <LabelVal label="Lease"       value={`${fmtDate(selectedLease.start_date)} – ${fmtDate(selectedLease.end_date)}`} />
                <LabelVal label="Due on"      value={fmtOrdinal(dueDay) + ' of each month'} />
                <LabelVal label="Tenants"     value={String(tenants.length)} />
                <LabelVal label="Monthly total" value={fmtCurrency(grandTotal)} />
                <LabelVal label="Payments"    value={`${totalPayments} total${prorationApplies ? ` (incl. move-in × ${tenants.length})` : ` (${previewDates.length} months × ${tenants.length} payer${tenants.length !== 1 ? 's' : ''})`}`} />
                <LabelVal label="Lease total" value={fmtCurrency(leaseTotal)} />
                {prorationApplies && proration && <LabelVal label="Proration" value={`${proration.daysStayed}d → ${fmtCurrency(proration.proratedRent)} prorated; ${fmtCurrency(proration.credit)} credit next month`} />}
                {lateFeeEnabled && feeAmount && <LabelVal label="Late fees" value={`${fmtCurrency(parseFloat(feeAmount))} every ${feeFreqDays}d after ${graceDays}d grace`} />}
              </div>
            </div>

            {/* Amount mismatch warning */}
            {!amountMatch && leaseRent > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 14px', marginBottom: 16, fontSize: '13px', color: '#991b1b' }}>
                ⚠️ Payer totals ({fmtCurrency(grandTotal)}) don't match the lease rent ({fmtCurrency(leaseRent)}). You can proceed, but verify this is intentional.
              </div>
            )}

            {/* Tenant breakdown */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>PAYER BREAKDOWN</div>
              {tenants.map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < tenants.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{t.name || `Tenant ${i + 1}`}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>{t.lineItems.filter(li => li.amount).map(li => `${li.label}: ${fmtCurrency(parseFloat(li.amount) || 0)}`).join(' · ')}</div>
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{fmtCurrency(tenantTotal(t))}/mo</div>
                </div>
              ))}
            </div>

            {/* Sample months */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>FIRST {Math.min(3, previewEntries.length)} PAYMENTS</div>
              {previewEntries.slice(0, 3).map((e, i) => (
                <div key={`${e.due_date}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: e.kind === 'regular' ? '#f8fafc' : '#eff6ff', border: e.kind === 'regular' ? 'none' : '1px solid #bfdbfe', borderRadius: '8px', marginBottom: 6 }}>
                  <span style={{ fontSize: '13px', color: '#0f172a', fontWeight: 500 }}>
                    Due {fmtDate(e.due_date)}
                    {e.kind === 'move_in' && <span style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600, marginLeft: 6 }}>· move-in (full)</span>}
                    {e.kind === 'prorated_credit' && <span style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600, marginLeft: 6 }}>· rent − prorate</span>}
                  </span>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>{fmtCurrency(e.amount)} across {tenants.length} payer{tenants.length !== 1 ? 's' : ''}</span>
                </div>
              ))}
              {previewEntries.length > 3 && <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', paddingTop: 4 }}>+ {previewEntries.length - 3} more payments</div>}
            </div>

            {error && <div style={{ marginTop: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#991b1b' }}>{error}</div>}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : window.location.href = '/landlord/financials'}
            style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: '9px', background: '#fff', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 5 ? (
            <button
              onClick={() => canNext[step] && setStep(s => s + 1)}
              disabled={!canNext[step]}
              style={{ padding: '10px 24px', borderRadius: '9px', border: 'none', background: canNext[step] ? '#0f172a' : '#e2e8f0', color: canNext[step] ? '#fff' : '#94a3b8', fontSize: '13px', fontWeight: 600, cursor: canNext[step] ? 'pointer' : 'not-allowed', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.15s' }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{ padding: '10px 28px', borderRadius: '9px', border: 'none', background: saving ? '#64748b' : '#10b981', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
            >
              {saving ? 'Creating…' : 'Create plan →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function LabelVal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{value}</div>
    </div>
  )
}
