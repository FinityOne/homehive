'use client'

/**
 * The tenant roster.
 *
 * ── What changed, and why ───────────────────────────────────────────────────
 *
 * This page used to be an address book: name, email, phone, a hand-typed
 * status and five stars, in a plain table sorted by when the row was created.
 * Everything a landlord actually opens it for — who is living where, on what
 * terms, paying how much, and whether they are behind — was somewhere else.
 *
 * So the default view is no longer a list of contacts. It is the tenancies
 * running right now, one card each, carrying the lease and the payment plan
 * on the face of it. "Active" is derived (a lease running today, a payer not
 * terminated) rather than read from `tenants.status`, which nothing maintains
 * — see `src/lib/tenantRoster.ts`, where every figure on this page comes
 * from. Nothing is computed in this file.
 *
 * The conventional list is still one click away, because the card view is the
 * wrong shape for three real jobs: finding a former tenant, scanning fifty
 * names, and editing a record. The toggle switches between them and nothing
 * else about the page moves.
 *
 * ── Following the Overview ──────────────────────────────────────────────────
 *
 * The visual language is the landlord Overview's, down to the tokens: the
 * money area's theme (`FINANCE_THEME`), the filled-green focal tile, the
 * `srow` list row, the `tbl roomy` table. Two of its rules are kept
 * deliberately:
 *
 *   • **The figures are the navigation.** Each stat tile is the filter for the
 *     thing it counts. Click "Past due" and the roster narrows to the people
 *     behind. The lit tile is the one filled card on the screen, so there is
 *     exactly one focal point and it states where you are.
 *   • **Colour is never the only signal.** Every standing carries its word as
 *     well as its tone, which is what makes this legible in a screenshot and
 *     to a colour-blind landlord.
 *
 * Unlike the Overview this page scrolls: a roster is honestly a list with no
 * natural end, and pretending twelve tenancies fit on one screen would mean
 * twelve cards too small to read.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { FINANCE_THEME } from '@/lib/financeTheme'
import Glyph, { GLYPH_CSS, type GlyphName } from '@/components/finance/Glyph'
import { StatusDot, PANEL_CSS } from '@/components/finance/Panels'
import { fmtCurrency, getPlansForOwner, type PaymentPlan } from '@/lib/payments'
import { getLeasesForOwner, formatLeaseDate, type Lease } from '@/lib/leases'
import {
  getTenantsByOwner, createTenant, updateTenant, deleteTenant, tenantEmailExists,
  type Tenant, type TenantStatus, type TenantFormData,
} from '@/lib/tenants'
import { getLeadsForOwner, type Lead } from '@/lib/leads'
import {
  buildTenantRoster, applyFilter, matchesQuery, tenantFullName,
  STANDING_META, LINKAGE_NOTE, ENDING_SOON_DAYS,
  type RosterEntry, type RosterTenancy, type RosterFilter,
} from '@/lib/tenantRoster'

// ─── Small formatters ────────────────────────────────────────────────────────

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '—'

const shortDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

const firstNameOf = (s: string) => s.trim().split(/\s+/)[0] || s

const STATUS_LABEL: Record<TenantStatus, string> = {
  active: 'Active', inactive: 'Inactive', pending: 'Pending', former: 'Former',
}

// ─── The stat tiles, which are the filters ───────────────────────────────────

type TileSpec = {
  id: RosterFilter
  icon: GlyphName
  label: string
  value: string
  sub: string
  tone?: 'bad' | 'warn'
}

const BLANK_FORM: TenantFormData = {
  first_name: '', last_name: '', email: '', phone: '', notes: '',
  status: 'active', rating: null, lead_id: null,
}

type View = 'roster' | 'list'

export default function TenantsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [leases, setLeases] = useState<Lease[]>([])
  const [plans, setPlans] = useState<PaymentPlan[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [hasListings, setHasListings] = useState(true)

  const [view, setView] = useState<View>('roster')
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [searchQ, setSearchQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<TenantStatus | 'all'>('all')

  // Add/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [form, setForm] = useState<TenantFormData>(BLANK_FORM)
  const [modalMode, setModalMode] = useState<'new' | 'from-lead'>('new')
  const [leadSearch, setLeadSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { document.title = 'Tenants — Landlord | HomeHive' }, [])

  useEffect(() => {
    let cancelled = false
    getCurrentUser().then(user => {
      if (!user) { router.push('/login'); return }
      setUserId(user.id)
      Promise.all([
        getTenantsByOwner(user.id),
        getLeasesForOwner(user.id),
        getPlansForOwner(user.id),
        getLeadsForOwner(user.id),
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('owner_id', user.id),
      ]).then(([ts, ls, ps, lds, { count }]) => {
        if (cancelled) return
        setTenants(ts)
        setLeases(ls)
        setPlans(ps)
        setLeads(lds)
        setHasListings((count ?? 0) > 0)
        setLoading(false)
      })
    })
    return () => { cancelled = true }
  }, [router])

  // Every figure on the page, derived once. See src/lib/tenantRoster.ts.
  const roster = useMemo(
    () => buildTenantRoster(tenants, leases, plans),
    [tenants, leases, plans],
  )

  const tiles: TileSpec[] = useMemo(() => {
    const t = roster.totals
    return [
      { id: 'all', icon: 'users', label: 'Active tenancies',
        value: String(t.active),
        sub: t.unplaced > 0
          ? `${t.unplaced} contact${t.unplaced !== 1 ? 's' : ''} without a lease`
          : `${t.tenants} tenant${t.tenants !== 1 ? 's' : ''} on file` },
      { id: 'arrears', icon: 'alert', label: 'Owed right now',
        value: fmtCurrency(t.outstanding),
        sub: t.overdue > 0
          ? `${fmtCurrency(t.overdue)} past due · ${t.overdueTenants} tenant${t.overdueTenants !== 1 ? 's' : ''}`
          : t.outstanding > 0 ? 'Billed, not yet past due' : 'Everything due has been paid',
        tone: t.overdue > 0 ? 'bad' : undefined },
      { id: 'ending', icon: 'clock', label: 'Ending soon',
        value: String(t.endingSoon),
        sub: t.endingSoon > 0
          ? `Inside the last ${ENDING_SOON_DAYS} days of the term`
          : 'No term ends in the next two months',
        tone: t.endingSoon > 0 ? 'warn' : undefined },
      { id: 'no_plan', icon: 'wallet', label: 'Without a plan',
        value: String(t.withoutPlan),
        sub: t.withoutPlan > 0
          ? 'Living there with no rent scheduled'
          : 'Every tenancy has rent scheduled',
        tone: t.withoutPlan > 0 ? 'warn' : undefined },
    ]
  }, [roster])

  const activeShown = useMemo(
    () => applyFilter(roster.active, filter).filter(e => matchesQuery(e, searchQ)),
    [roster.active, filter, searchQ],
  )

  const listShown = useMemo(
    () => roster.all
      .filter(e => statusFilter === 'all' || e.tenant.status === statusFilter)
      .filter(e => matchesQuery(e, searchQ)),
    [roster.all, statusFilter, searchQ],
  )

  // ── CRUD, unchanged in behaviour ─────────────────────────────────────────

  const openAddModal = useCallback(() => {
    setEditingTenant(null); setForm(BLANK_FORM); setModalMode('new')
    setSelectedLead(null); setLeadSearch(''); setFormError(''); setModalOpen(true)
  }, [])

  function openEditModal(t: Tenant) {
    setEditingTenant(t)
    setForm({
      first_name: t.first_name, last_name: t.last_name || '', email: t.email,
      phone: t.phone || '', notes: t.notes || '', status: t.status,
      rating: t.rating, lead_id: t.lead_id,
    })
    setModalMode('new'); setSelectedLead(null); setLeadSearch('')
    setFormError(''); setModalOpen(true)
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

    const exists = await tenantEmailExists(userId, email, editingTenant?.id)
    if (exists) { setFormError('A tenant with this email already exists.'); return }

    setSaving(true)
    const payload: TenantFormData = {
      ...form, email,
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
    if (!error) setTenants(prev => prev.filter(t => t.id !== id))
    setDeletingId(null)
  }

  const filteredLeads = leads.filter(l => {
    if (tenants.some(t => t.lead_id === l.id)) return false
    if (!leadSearch.trim()) return true
    const q = leadSearch.toLowerCase()
    return (
      l.first_name?.toLowerCase().includes(q) ||
      l.last_name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    )
  })

  const CSS_ALL = `${FINANCE_THEME}${GLYPH_CSS}${PANEL_CSS}${CSS}`

  // ── Screens ──────────────────────────────────────────────────────────────

  if (!loading && !hasListings) {
    return (
      <>
        <style>{CSS_ALL}</style>
        <div className="fin tr-wrap">
          <div className="tr-blank">
            <span className="tr-blank-icon"><Glyph name="building" size={22} /></span>
            <h1 className="tr-blank-title">No listings yet</h1>
            <p className="muted">
              Tenants arrive here from a lease, and a lease needs a property. Create your
              first listing and this page fills in on its own: who is living where, on what
              terms, and whether the rent has landed.
            </p>
            <Link href="/landlord/listings/new" className="btn-primary">Create a listing</Link>
          </div>
        </div>
      </>
    )
  }

  if (loading) {
    return (
      <>
        <style>{CSS_ALL}</style>
        <div className="fin tr-wrap">
          <div className="skeleton" style={{ height: 44, width: 300, marginBottom: 20 }} />
          <div className="tr-tiles">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 16 }} />)}
          </div>
          <div className="tr-cards" style={{ marginTop: 18 }}>
            {[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: 232, borderRadius: 18 }} />)}
          </div>
        </div>
      </>
    )
  }

  const t = roster.totals

  return (
    <>
      <style>{CSS_ALL}</style>
      <div className="fin tr-wrap">

        {/* ══ HEADER ══ */}
        <header className="tr-top">
          <div className="tr-id">
            <h1 className="tr-title">Tenants</h1>
            <p className="tr-line">
              {t.active} active tenanc{t.active !== 1 ? 'ies' : 'y'}
              {t.monthly > 0 && <> · {fmtCurrency(t.monthly)} contracted a month</>}
              {t.collectionRate !== null && <> · {t.collectionRate}% of billed rent collected</>}
              {t.overdue > 0 && <> · <span className="tr-flag">{fmtCurrency(t.overdue)} past due</span></>}
            </p>
          </div>
          <div className="tr-act">
            <Link className="btn-secondary" href="/landlord/leases/new">New lease</Link>
            <button className="btn-primary" onClick={openAddModal}>
              <Glyph name="users" size={15} />
              Add tenant
            </button>
          </div>
        </header>

        {/* ══ THE FOUR FIGURES, WHICH ARE ALSO THE FILTERS ══ */}
        <div className="tr-tiles" role="tablist" aria-label="Filter the roster">
          {tiles.map(tile => (
            <button
              key={tile.id}
              role="tab"
              aria-selected={view === 'roster' && filter === tile.id}
              className={`tr-tile${view === 'roster' && filter === tile.id ? ' on' : ''}${
                tile.tone && !(view === 'roster' && filter === tile.id) ? ' ' + tile.tone : ''}`}
              onClick={() => { setView('roster'); setFilter(tile.id) }}
            >
              <span className="tr-tile-top">
                <span className="tr-tile-icon"><Glyph name={tile.icon} size={16} /></span>
                <span className="tr-tile-label">{tile.label}</span>
              </span>
              <span className="tr-tile-value">{tile.value}</span>
              <span className="tr-tile-sub">{tile.sub}</span>
            </button>
          ))}
        </div>

        {/* ══ VIEW TOGGLE + SEARCH ══ */}
        <div className="tr-bar">
          <div className="seg sm pill" role="tablist" aria-label="View">
            <button
              role="tab" aria-selected={view === 'roster'}
              className={`seg-btn${view === 'roster' ? ' on' : ''}`}
              onClick={() => setView('roster')}
            >
              Active tenancies
              <span className="seg-badge">{roster.active.length}</span>
            </button>
            <button
              role="tab" aria-selected={view === 'list'}
              className={`seg-btn${view === 'list' ? ' on' : ''}`}
              onClick={() => setView('list')}
            >
              All tenants
              <span className="seg-badge">{roster.all.length}</span>
            </button>
          </div>

          <div className="tr-bar-right">
            {view === 'list' && (
              <span className="chipsel">
                <span className="chipsel-label">Status</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as TenantStatus | 'all')}
                  aria-label="Filter by the status on the record"
                >
                  <option value="all">Any</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="inactive">Inactive</option>
                  <option value="former">Former</option>
                </select>
              </span>
            )}
            <span className="tr-search">
              <Glyph name="search" size={14} />
              <input
                type="search"
                placeholder="Name, email, property…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                aria-label="Search tenants"
              />
            </span>
            {view === 'roster' && filter !== 'all' && (
              <button className="btn-quiet sm" onClick={() => setFilter('all')}>Clear filter</button>
            )}
          </div>
        </div>

        {/* ══ THE ROSTER ══ */}
        {view === 'roster' ? (
          <>
            {activeShown.length === 0 ? (
              <EmptyRoster
                total={roster.active.length}
                filtered={filter !== 'all' || searchQ.trim().length > 0}
                onClear={() => { setFilter('all'); setSearchQ('') }}
              />
            ) : (
              <div className="tr-cards">
                {activeShown.map(e => <TenancyCard key={e.tenant.id} e={e} />)}
              </div>
            )}

            {/* Contacts with no tenancy. Shown rather than hidden: a tenant
                record with no lease is usually somebody who has agreed terms
                and is waiting on the paperwork, which is a thing to finish,
                not a thing to lose. */}
            {roster.unplaced.length > 0 && filter === 'all' && (
              <section className="tr-sec">
                <div className="tr-sec-hd">
                  <h2 className="tr-sec-title">No lease on file</h2>
                  <span className="tr-sec-count">{roster.unplaced.length}</span>
                </div>
                <p className="muted sm">
                  On the books as tenants, but on no lease we can find. A lease is what ties
                  someone to a property and a rent schedule — until then nothing can be billed.
                </p>
                <div className="tr-rows">
                  {roster.unplaced.filter(e => matchesQuery(e, searchQ)).map(e => (
                    <div key={e.tenant.id} className="tr-row">
                      <Link className="srow" href={`/landlord/tenants/${e.tenant.id}`}>
                        <span className="srow-badge">{initials(tenantFullName(e.tenant))}</span>
                        <span className="srow-main">
                          <span className="srow-name">{tenantFullName(e.tenant)}</span>
                          <span className="srow-sub">
                            {e.tenant.email}
                            {e.tenant.phone && ` · ${e.tenant.phone}`}
                          </span>
                        </span>
                      </Link>
                      <Link className="btn-secondary sm" href="/landlord/leases/new">Create a lease</Link>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {roster.past.length > 0 && filter === 'all' && (
              <p className="tr-foot">
                {roster.past.length} former tenant{roster.past.length !== 1 ? 's' : ''} whose
                leases have ended are in{' '}
                <button className="btn-quiet sm" onClick={() => setView('list')}>All tenants</button>.
              </p>
            )}
          </>
        ) : (
          <AllTenantsTable
            entries={listShown}
            total={roster.all.length}
            deletingId={deletingId}
            onOpen={id => router.push(`/landlord/tenants/${id}`)}
            onEdit={openEditModal}
            onAskDelete={setDeletingId}
            onDelete={handleDelete}
          />
        )}
      </div>

      {/* ══ ADD / EDIT ══ */}
      {modalOpen && (
        <div className="fin tr-ovl" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div className="tr-modal" role="dialog" aria-modal="true" aria-label={editingTenant ? 'Edit tenant' : 'Add tenant'}>
            <h2 className="tr-modal-title">{editingTenant ? 'Edit tenant' : 'Add a tenant'}</h2>
            <p className="muted sm" style={{ marginBottom: 16 }}>
              This is the person&rsquo;s record. What they pay comes from the lease and the
              payment plan, not from here.
            </p>

            {!editingTenant && (
              <div className="seg sm" style={{ marginBottom: 16 }} role="tablist" aria-label="Source">
                <button
                  role="tab" aria-selected={modalMode === 'new'}
                  className={`seg-btn${modalMode === 'new' ? ' on' : ''}`}
                  onClick={() => { setModalMode('new'); setSelectedLead(null); setLeadSearch(''); setForm(BLANK_FORM) }}
                >New tenant</button>
                <button
                  role="tab" aria-selected={modalMode === 'from-lead'}
                  className={`seg-btn${modalMode === 'from-lead' ? ' on' : ''}`}
                  onClick={() => { setModalMode('from-lead'); setSelectedLead(null); setLeadSearch('') }}
                >From a lead</button>
              </div>
            )}

            {modalMode === 'from-lead' && !selectedLead && (
              <div className="tr-leadbox">
                <input
                  className="tr-input"
                  style={{ border: 'none', borderBottom: '1px solid var(--line-2)', borderRadius: 0 }}
                  type="text"
                  placeholder="Search leads by name or email…"
                  value={leadSearch}
                  onChange={e => setLeadSearch(e.target.value)}
                  autoFocus
                />
                {filteredLeads.slice(0, 8).map(l => (
                  <button key={l.id} className="tr-leaditem" onClick={() => selectLead(l)}>
                    <span className="srow-name">{[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}</span>
                    <span className="srow-sub">{l.email} · {l.status}</span>
                  </button>
                ))}
                {filteredLeads.length === 0 && (
                  <p className="muted sm" style={{ padding: '12px 13px' }}>
                    No leads found, or every one of them is already a tenant.
                  </p>
                )}
              </div>
            )}

            {modalMode === 'from-lead' && selectedLead && (
              <div className="tr-note good">
                <span>
                  Importing from lead{' '}
                  <strong>{[selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ')}</strong>
                </span>
                <button className="btn-quiet sm" onClick={() => { setSelectedLead(null); setForm(BLANK_FORM) }}>
                  Change
                </button>
              </div>
            )}

            {(modalMode === 'new' || selectedLead || editingTenant) && (
              <>
                {formError && <div className="tr-note bad">{formError}</div>}

                <div className="tr-fields two">
                  <label className="tr-field">
                    <span className="tr-label">First name *</span>
                    <input className="tr-input" type="text" value={form.first_name}
                      onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="Jane" />
                  </label>
                  <label className="tr-field">
                    <span className="tr-label">Last name</span>
                    <input className="tr-input" type="text" value={form.last_name || ''}
                      onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Doe" />
                  </label>
                </div>

                <div className="tr-fields two">
                  <label className="tr-field">
                    <span className="tr-label">Email *</span>
                    <input className="tr-input" type="email" value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@asu.edu" />
                    {/* The one field the money depends on: a payer on a payment
                        plan is tied to a tenant record by email and nothing
                        else. See src/lib/tenantRoster.ts. */}
                    <span className="tr-hint">
                      Use the same address as on their lease — it is what ties their rent to this record.
                    </span>
                  </label>
                  <label className="tr-field">
                    <span className="tr-label">Phone</span>
                    <input className="tr-input" type="tel" value={form.phone || ''}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 (480) 555-1234" />
                  </label>
                </div>

                <div className="tr-fields two">
                  <label className="tr-field">
                    <span className="tr-label">Status</span>
                    <select className="tr-input" value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value as TenantStatus }))}>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="inactive">Inactive</option>
                      <option value="former">Former</option>
                    </select>
                    <span className="tr-hint">
                      A label for your own filing. Whether a tenancy is running is read from the lease.
                    </span>
                  </label>
                  <div className="tr-field">
                    <span className="tr-label">Rating</span>
                    <StarRating value={form.rating} onChange={v => setForm(f => ({ ...f, rating: v || null }))} />
                  </div>
                </div>

                <label className="tr-field">
                  <span className="tr-label">Notes</span>
                  <textarea className="tr-input tr-textarea" value={form.notes || ''}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Anything worth remembering about this tenant…" />
                </label>

                <div className="tr-modal-act">
                  <button className="btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : editingTenant ? 'Save changes' : 'Add tenant'}
                  </button>
                  <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── THE CARD ────────────────────────────────────────────────────────────────

/**
 * One live tenancy, whole.
 *
 * The order is the order a landlord asks: who, where, on what terms, paying
 * what, and whether anything is wrong. The name is the way in — everything
 * about how they are actually doing lives on their own page, and this is only
 * the index of it.
 */
function TenancyCard({ e }: { e: RosterEntry }) {
  const name = tenantFullName(e.tenant)
  const ten = e.lead as RosterTenancy
  const m = ten.money
  const note = LINKAGE_NOTE[ten.linkage]

  return (
    <article className={`tr-card ${e.standing}`}>
      <header className="tr-card-hd">
        <Link className="tr-who" href={`/landlord/tenants/${e.tenant.id}`}>
          <span className="tr-av">{initials(name)}</span>
          <span className="tr-who-txt">
            <span className="tr-name">{name}</span>
            <span className="tr-contact">{e.tenant.email}</span>
          </span>
        </Link>
        <StandingBadge standing={e.standing} />
      </header>

      {/* ── Where, and on what terms ── */}
      <div className="tr-place">
        <span className="tr-place-top">
          <Glyph name="building" size={13} />
          {ten.propertySlug ? (
            <Link className="lnk" href={`/landlord/listings/${ten.propertySlug}`}>{ten.propertyName}</Link>
          ) : ten.propertyName}
          {ten.unitNumber && <span className="tr-unit">{ten.unitNumber}</span>}
        </span>
        <span className="tr-term">
          {formatLeaseDate(ten.startDate)} → {formatLeaseDate(ten.endDate)}
        </span>
        <span className="tr-track" aria-hidden="true">
          <span
            className={`tr-fill${ten.daysLeft <= ENDING_SOON_DAYS ? ' warn' : ''}`}
            style={{ width: `${ten.termProgress}%` }}
          />
        </span>
        <span className="tr-termline">
          {ten.stage === 'upcoming'
            ? `Starts in ${ten.startsInDays} day${ten.startsInDays !== 1 ? 's' : ''}`
            : ten.daysLeft >= 0
              ? `${ten.daysLeft} day${ten.daysLeft !== 1 ? 's' : ''} left · ${ten.termProgress}% through the term`
              : 'Term has ended'}
          {ten.housemates.length > 0 &&
            ` · with ${ten.housemates.map(firstNameOf).join(', ')}`}
        </span>
      </div>

      {/* ── The money ── */}
      {m ? (
        <>
          <div className="tr-figs">
            <Fig label="Rent a month" value={fmtCurrency(m.monthly)} />
            <Fig
              label={e.overdue > 0 ? 'Past due' : e.totalDue > 0 ? 'Outstanding' : 'Balance'}
              value={e.totalDue > 0 ? fmtCurrency(e.totalDue) : 'Clear'}
              tone={e.overdue > 0 ? 'bad' : e.totalDue > 0 ? 'warn' : undefined}
            />
            <Fig
              label={e.nextDue ? 'Next due' : 'Next due'}
              value={e.nextDue ? shortDate(e.nextDue.date) : '—'}
              sub={e.nextDue ? fmtCurrency(e.nextDue.amount) : 'Nothing scheduled'}
            />
          </div>

          <p className="tr-read">
            {/* What the three figures cannot say on their own: how this tenancy
                has behaved, which is the only thing on the card a good month
                cannot fake. */}
            {m.lineItems.length > 1 && (
              <>
                {m.lineItems.map(li => `${li.label} ${fmtCurrency(li.amount)}`).join(' + ')}
                {' · '}
              </>
            )}
            Due on the {ordinal(m.dueDay)}
            {e.payRate !== null && <> · {e.payRate}% of billed rent collected</>}
            {e.lateCount > 0
              ? <> · <span className="tr-warn">{e.lateCount} payment{e.lateCount !== 1 ? 's' : ''} arrived late</span>
                  {e.worstDaysLate > 0 && ` (worst ${e.worstDaysLate}d)`}</>
              : e.lastPaid ? <> · last paid {shortDate(e.lastPaid.date)}</> : null}
            {e.inFlight > 0 && <> · <span className="tr-flight">{fmtCurrency(e.inFlight)} clearing</span></>}
          </p>
        </>
      ) : (
        <div className="tr-gap">
          <Glyph name="wallet" size={14} />
          <span>
            <strong>No payment plan on this lease.</strong> Nothing is being billed, so no rent
            is expected and nothing can be late.
          </span>
        </div>
      )}

      {note && (
        <p className="tr-link-note">
          <Glyph name="alert" size={12} />
          {note}
        </p>
      )}

      <footer className="tr-card-ft">
        <Link className="btn-secondary sm" href={`/landlord/tenants/${e.tenant.id}`}>Open record</Link>
        {m && (
          <Link className="btn-secondary sm" href={`/landlord/financials/plan/${m.planId}`}>Ledger</Link>
        )}
        <Link className="btn-quiet sm" href={`/landlord/leases/${ten.leaseId}`}>Lease</Link>
        {e.tenancies.length > 1 && (
          <span className="tr-more">+{e.tenancies.length - 1} other lease{e.tenancies.length > 2 ? 's' : ''}</span>
        )}
      </footer>
    </article>
  )
}

/**
 * Where a tenant stands, as a word with a tone behind it.
 *
 * `clearing` cannot go through StatusDot: that primitive has four tones and
 * none of them is teal, and rendering in-flight money grey would say "nothing
 * to do" about a payment that is on its way. It gets the theme's flight badge
 * instead, which is the same colour the money pages use for it.
 */
function StandingBadge({ standing }: { standing: RosterEntry['standing'] }) {
  const meta = STANDING_META[standing]
  if (meta.tone === 'info') return <span className="badge flight" title={meta.hint}>{meta.label}</span>
  return <StatusDot tone={meta.tone}>{meta.label}</StatusDot>
}

function Fig({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'bad' | 'warn'
}) {
  return (
    <span className="tr-fig">
      <span className="tr-fig-label">{label}</span>
      <span className={`tr-fig-value${tone ? ' ' + tone : ''}`}>{value}</span>
      {sub && <span className="tr-fig-sub">{sub}</span>}
    </span>
  )
}

function EmptyRoster({ total, filtered, onClear }: {
  total: number; filtered: boolean; onClear: () => void
}) {
  return (
    <div className="tr-empty">
      {filtered ? (
        <>
          <h2 className="tr-empty-title">Nothing matches</h2>
          <p className="muted">
            {total} active tenanc{total !== 1 ? 'ies' : 'y'} are on the roster — none of them fit
            this filter.
          </p>
          <button className="btn-secondary" onClick={onClear}>Show everyone</button>
        </>
      ) : (
        <>
          <h2 className="tr-empty-title">No tenancy is running</h2>
          <p className="muted">
            A tenant appears here once a lease with their name on it is running. Add the
            person first if you like, then the lease that puts them in a room.
          </p>
          <Link className="btn-primary" href="/landlord/leases/new">Create a lease</Link>
        </>
      )}
    </div>
  )
}

// ─── THE CONVENTIONAL LIST ───────────────────────────────────────────────────

/**
 * Everyone, as a table.
 *
 * Deliberately plain, and deliberately complete: former tenants, contacts with
 * no lease, and the hand-typed status column all live here. This is the view
 * for the three jobs a card grid is bad at — finding one person among fifty,
 * scanning, and editing a record.
 */
function AllTenantsTable({
  entries, total, deletingId, onOpen, onEdit, onAskDelete, onDelete,
}: {
  entries: RosterEntry[]
  total: number
  deletingId: string | null
  onOpen: (id: string) => void
  onEdit: (t: Tenant) => void
  onAskDelete: (id: string | null) => void
  onDelete: (id: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="tr-empty">
        <h2 className="tr-empty-title">{total === 0 ? 'No tenants yet' : 'Nothing matches'}</h2>
        <p className="muted">
          {total === 0
            ? 'Add a tenant by hand, or convert a lead who has agreed terms.'
            : `${total} tenant${total !== 1 ? 's are' : ' is'} on file — none of them fit this search.`}
        </p>
      </div>
    )
  }

  return (
    <div className="tr-tablewrap">
      <table className="tbl roomy">
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Tenancy</th>
            <th className="num">Rent a month</th>
            <th className="num">Balance</th>
            <th>Standing</th>
            <th>On record</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {entries.map(e => {
            const name = tenantFullName(e.tenant)
            const ten = e.lead
            return (
              <Row key={e.tenant.id}>
                <tr className="click" onClick={() => onOpen(e.tenant.id)}>
                  <td>
                    <span className="at-who">
                      <span className="at-avatar">{initials(name)}</span>
                      <span>
                        <span className="at-name">{name}</span>
                        <span className="at-sub">{e.tenant.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    {ten ? (
                      <>
                        <span className="tr-cell-main">
                          {ten.propertyName}{ten.unitNumber ? ` · ${ten.unitNumber}` : ''}
                        </span>
                        <span className="tr-cell-sub">
                          {formatLeaseDate(ten.startDate)} → {formatLeaseDate(ten.endDate)}
                        </span>
                      </>
                    ) : <span className="tr-cell-sub">No lease on file</span>}
                  </td>
                  <td className="num">{e.monthly > 0 ? fmtCurrency(e.monthly) : '—'}</td>
                  <td className="num">
                    {e.totalDue > 0
                      ? <span className={e.overdue > 0 ? 'tr-bad' : 'tr-warn'}>{fmtCurrency(e.totalDue)}</span>
                      : <span className="tr-quiet">—</span>}
                  </td>
                  <td><StandingBadge standing={e.standing} /></td>
                  <td>
                    <span className="tr-cell-main">{STATUS_LABEL[e.tenant.status]}</span>
                    {e.tenant.rating !== null && (
                      <span className="tr-cell-sub tr-stars">{'★'.repeat(e.tenant.rating)}</span>
                    )}
                  </td>
                  <td onClick={ev => ev.stopPropagation()}>
                    <span className="tr-rowact">
                      <button className="btn-quiet sm" onClick={() => onEdit(e.tenant)}>Edit</button>
                      <button className="btn-quiet sm tr-del" onClick={() => onAskDelete(e.tenant.id)}>Delete</button>
                    </span>
                  </td>
                </tr>
                {deletingId === e.tenant.id && (
                  <tr>
                    <td colSpan={7} style={{ paddingTop: 0 }}>
                      <div className="tr-note bad tr-confirm">
                        <span>
                          Remove <strong>{name}</strong> from your tenants? Their leases and payments
                          stay where they are — only this record goes, and it cannot be undone.
                        </span>
                        <span className="tr-confirm-act">
                          <button className="btn-danger sm" onClick={() => onDelete(e.tenant.id)}>Yes, remove</button>
                          <button className="btn-secondary sm" onClick={() => onAskDelete(null)}>Cancel</button>
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Row>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Two sibling rows under one key, without a wrapper element in the table. */
const Row = ({ children }: { children: React.ReactNode }) => <>{children}</>

function StarRating({ value, onChange }: { value: number | null; onChange?: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <span className="tr-rate" role={onChange ? 'group' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          aria-label={`${n} star${n !== 1 ? 's' : ''}`}
          onMouseEnter={() => onChange && setHovered(n)}
          onMouseLeave={() => onChange && setHovered(0)}
          onClick={() => onChange && onChange(n === value ? 0 : n)}
          className={`tr-star${(hovered || value || 0) >= n ? ' on' : ''}`}
        >★</button>
      ))}
    </span>
  )
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const CSS = `
  .fin.tr-wrap { max-width: 1240px; margin: 0 auto; padding: 26px 24px 100px; }

  /* ── Header ───────────────────────────────────────────────────────────── */
  .fin .tr-top {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
  }
  .fin .tr-title { font-size: 25px; font-weight: 600; letter-spacing: -0.028em; line-height: 1.15; }
  .fin .tr-line { font-size: 13px; color: var(--ink-2); margin-top: 4px; letter-spacing: -0.01em; }
  .fin .tr-flag { color: var(--late); font-weight: 500; }
  .fin .tr-act { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }

  /* ── The figures, which are the filters ───────────────────────────────── */
  .fin .tr-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .fin .tr-tile {
    display: flex; flex-direction: column; align-items: stretch; gap: 6px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 13px 15px; text-align: left; cursor: pointer; font-family: inherit;
    color: inherit; min-width: 0;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease), background 0.15s var(--ease);
  }
  .fin .tr-tile:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  /* The lit tile is the one filled card on the screen — both the focal point
     and the statement of which filter is on. */
  .fin .tr-tile.on { background: var(--fill-hero); border-color: transparent; color: #fff; }
  .fin .tr-tile.on:hover { box-shadow: var(--fill-hero-lift); }
  .fin .tr-tile-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .fin .tr-tile-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0;
    background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line-2);
  }
  .fin .tr-tile.on .tr-tile-icon {
    background: rgba(255,255,255,0.18); color: #fff; border-color: rgba(255,255,255,0.22);
  }
  .fin .tr-tile.bad  .tr-tile-icon { background: var(--late-bg); color: var(--late); border-color: var(--late-line); }
  .fin .tr-tile.warn .tr-tile-icon { background: var(--fee-bg);  color: var(--fee);  border-color: var(--fee-line); }
  .fin .tr-tile-label {
    font-size: 12.5px; font-weight: 500; letter-spacing: -0.012em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .tr-tile-value {
    font-size: 25px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .fin .tr-tile-sub {
    font-size: 11.5px; color: var(--ink-3); letter-spacing: -0.005em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .tr-tile.on .tr-tile-sub { color: rgba(255,255,255,0.76); }

  /* ── Toggle + search ─────────────────────────────────────────────────── */
  .fin .tr-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin: 18px 0 14px;
  }
  .fin .tr-bar-right { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .fin .tr-search {
    display: inline-flex; align-items: center; gap: 7px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 980px;
    padding: 0 13px; height: 34px; color: var(--ink-3);
  }
  .fin .tr-search:focus-within { border-color: var(--accent); }
  .fin .tr-search input {
    border: none; outline: none; background: none; font-family: inherit;
    font-size: 13px; color: var(--ink); width: 180px; letter-spacing: -0.01em;
  }
  .fin .tr-search input::placeholder { color: var(--ink-3); }

  /* ── The cards ────────────────────────────────────────────────────────── */
  .fin .tr-cards {
    display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(352px, 1fr));
    align-items: start;
  }
  .fin .tr-card {
    display: flex; flex-direction: column; gap: 12px; min-width: 0;
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 16px 17px 14px;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .tr-card:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  /* Arrears earn an edge, not a tinted card: three stacked tinted cards read
     as decoration, and the word in the badge is already carrying the state. */
  .fin .tr-card.overdue { border-left: 3px solid var(--late); }
  .fin .tr-card.due     { border-left: 3px solid var(--fee); }
  .fin .tr-card.no_plan { border-left: 3px solid var(--fee); }

  .fin .tr-card-hd {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  }
  .fin .tr-who { display: flex; align-items: center; gap: 11px; min-width: 0; text-decoration: none; color: inherit; }
  .fin .tr-av {
    display: inline-flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    font-size: 13px; font-weight: 700; letter-spacing: -0.01em;
  }
  .fin .tr-who-txt { min-width: 0; }
  .fin .tr-name {
    display: block; font-size: 14.5px; font-weight: 600; letter-spacing: -0.015em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .tr-who:hover .tr-name { color: var(--accent); }
  .fin .tr-contact {
    display: block; font-size: 11.5px; color: var(--ink-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .fin .tr-place {
    display: flex; flex-direction: column; gap: 4px;
    padding: 11px 12px; border-radius: 12px;
    background: var(--surface-2); border: 1px solid var(--line-2);
  }
  .fin .tr-place-top {
    display: flex; align-items: center; gap: 6px; min-width: 0;
    font-size: 12.5px; font-weight: 600; letter-spacing: -0.012em; color: var(--ink);
  }
  .fin .tr-place-top svg { color: var(--ink-3); flex-shrink: 0; }
  .fin .tr-place-top .lnk { font-weight: 600; }
  .fin .tr-unit {
    font-size: 10.5px; font-weight: 600; color: var(--ink-2);
    background: var(--line-2); border-radius: 980px; padding: 1px 7px;
  }
  .fin .tr-term { font-size: 11.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .fin .tr-track {
    display: block; height: 5px; border-radius: 99px; background: var(--line);
    overflow: hidden; margin: 3px 0 1px;
  }
  .fin .tr-fill { display: block; height: 100%; border-radius: 99px; background: var(--in); }
  .fin .tr-fill.warn { background: var(--fee); }
  .fin .tr-termline { font-size: 11px; color: var(--ink-3); }

  .fin .tr-figs { display: flex; gap: 20px; flex-wrap: wrap; }
  .fin .tr-fig { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .fin .tr-fig-label { font-size: 11px; color: var(--ink-3); letter-spacing: -0.005em; }
  .fin .tr-fig-value {
    font-size: 19px; font-weight: 600; letter-spacing: -0.024em;
    font-variant-numeric: tabular-nums;
  }
  .fin .tr-fig-value.bad  { color: var(--late); }
  .fin .tr-fig-value.warn { color: var(--fee); }
  .fin .tr-fig-sub { font-size: 10.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

  .fin .tr-read {
    font-size: 11.5px; color: var(--ink-2); line-height: 1.55;
    padding-top: 10px; border-top: 1px solid var(--line-2);
  }
  .fin .tr-warn   { color: var(--fee); font-weight: 500; }
  .fin .tr-bad    { color: var(--late); font-weight: 500; }
  .fin .tr-flight { color: var(--flight); font-weight: 500; }
  .fin .tr-quiet  { color: var(--ink-3); }

  .fin .tr-gap {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 11.5px; color: var(--fee); line-height: 1.5;
    background: var(--fee-bg); border: 1px solid var(--fee-line);
    border-radius: 11px; padding: 9px 11px;
  }
  .fin .tr-gap svg { flex-shrink: 0; margin-top: 1px; }
  .fin .tr-gap strong { font-weight: 600; }

  .fin .tr-link-note {
    display: flex; align-items: center; gap: 6px;
    font-size: 10.5px; color: var(--ink-3); line-height: 1.4;
  }
  .fin .tr-link-note svg { flex-shrink: 0; }

  .fin .tr-card-ft {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding-top: 11px; border-top: 1px solid var(--line-2); margin-top: auto;
  }
  .fin .tr-more { font-size: 11px; color: var(--ink-3); margin-left: auto; }

  /* ── Sections and plain rows ─────────────────────────────────────────── */
  .fin .tr-sec {
    margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--line);
    display: flex; flex-direction: column; gap: 8px;
  }
  .fin .tr-sec-hd { display: flex; align-items: baseline; gap: 9px; }
  .fin .tr-sec-title { font-size: 15px; font-weight: 600; letter-spacing: -0.015em; }
  .fin .tr-sec-count {
    font-size: 11.5px; color: var(--ink-2); background: var(--line-2);
    border-radius: 980px; padding: 1px 8px; font-variant-numeric: tabular-nums;
  }
  /* ── A plain person row ───────────────────────────────────────────────────
     The Overview's srow, to the pixel. It lives in that page's own CSS
     rather than in the shared theme, so it is restated here instead of
     imported — when it moves into Panels.tsx this block goes with it. */
  .fin .srow {
    display: flex; align-items: center; gap: 10px; padding: 8px 9px;
    border-radius: 11px; text-decoration: none; color: inherit; min-width: 0;
    transition: background 0.13s;
  }
  .fin .srow:hover { background: var(--surface-2); }
  .fin .srow-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    font-size: 10px; font-weight: 700;
  }
  .fin .srow-main { flex: 1; min-width: 0; }
  .fin .srow-name {
    display: block; font-size: 12.5px; font-weight: 500; letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .srow-sub {
    display: block; font-size: 11px; color: var(--ink-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .fin .tr-rows { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
  .fin .tr-row {
    display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--line-2); padding: 2px 0;
  }
  .fin .tr-row:last-child { border-bottom: none; }
  .fin .tr-row .srow { flex: 1; min-width: 0; }
  .fin .tr-foot { margin-top: 20px; font-size: 12px; color: var(--ink-3); }

  /* ── Empty states ────────────────────────────────────────────────────── */
  .fin .tr-empty {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    text-align: center; padding: 60px 24px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
  }
  .fin .tr-empty .muted { max-width: 460px; }
  .fin .tr-empty-title { font-size: 17px; font-weight: 600; letter-spacing: -0.018em; }

  .fin .tr-blank {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    text-align: center; max-width: 520px; margin: 90px auto;
  }
  .fin .tr-blank .muted { max-width: 440px; }
  .fin .tr-blank-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 48px; height: 48px; border-radius: 15px;
    background: var(--accent-bg); color: var(--accent-ink);
  }
  .fin .tr-blank-title { font-size: 21px; font-weight: 600; letter-spacing: -0.024em; }

  /* ── The conventional table ──────────────────────────────────────────── */
  .fin .tr-tablewrap {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 4px 6px; overflow-x: auto;
  }
  .fin .tr-cell-main { display: block; font-size: 13px; letter-spacing: -0.01em; }
  .fin .tr-cell-sub { display: block; font-size: 11px; color: var(--ink-3); margin-top: 1px; }
  .fin .tr-stars { color: #d9a400; letter-spacing: 1px; }
  .fin .tr-rowact { display: flex; gap: 10px; justify-content: flex-end; }
  .fin .tr-del:hover { color: var(--late); }
  .fin .tr-confirm { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .fin .tr-confirm-act { display: flex; gap: 8px; margin-left: auto; }

  /* ── Add / edit ──────────────────────────────────────────────────────── */
  .fin.tr-ovl {
    position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.42);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .fin .tr-modal {
    background: var(--surface); border-radius: 20px; padding: 24px;
    width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto;
  }
  .fin .tr-modal-title { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
  .fin .tr-fields { display: grid; gap: 12px; margin-bottom: 12px; }
  .fin .tr-fields.two { grid-template-columns: 1fr 1fr; }
  .fin .tr-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; min-width: 0; }
  .fin .tr-fields .tr-field { margin-bottom: 0; }
  .fin .tr-label { font-size: 11.5px; font-weight: 600; color: var(--ink-2); letter-spacing: -0.005em; }
  .fin .tr-input {
    width: 100%; border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; font-size: 14px; color: var(--ink); background: var(--surface);
    font-family: inherit; outline: none; transition: border-color 0.15s;
  }
  .fin .tr-input:focus { border-color: var(--accent); }
  .fin .tr-textarea { resize: vertical; min-height: 76px; }
  .fin .tr-hint { font-size: 10.5px; color: var(--ink-3); line-height: 1.45; }
  .fin .tr-modal-act { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 18px; }

  .fin .tr-note {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    border-radius: 11px; padding: 10px 13px; font-size: 12.5px; margin-bottom: 14px;
  }
  .fin .tr-note.good { background: var(--in-bg);   border: 1px solid var(--in-line);   color: var(--in); }
  .fin .tr-note.bad  { background: var(--late-bg); border: 1px solid var(--late-line); color: var(--late); }

  .fin .tr-leadbox {
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 14px;
  }
  .fin .tr-leaditem {
    display: block; width: 100%; text-align: left; background: none; cursor: pointer;
    border: none; border-bottom: 1px solid var(--line-2); padding: 9px 13px; font-family: inherit;
  }
  .fin .tr-leaditem:last-child { border-bottom: none; }
  .fin .tr-leaditem:hover { background: var(--accent-bg); }

  .fin .tr-rate { display: inline-flex; gap: 2px; padding-top: 6px; }
  .fin .tr-star {
    border: none; background: none; padding: 0; cursor: pointer; font-size: 17px;
    line-height: 1; color: var(--line); font-family: inherit;
  }
  .fin .tr-star.on { color: #d9a400; }
  .fin .tr-star:disabled { cursor: default; }

  /* ── Narrower screens ────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .fin .tr-tiles { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 760px) {
    .fin.tr-wrap { padding: 20px 15px 90px; }
    .fin .tr-cards { grid-template-columns: 1fr; }
    .fin .tr-fields.two { grid-template-columns: 1fr; }
    .fin .tr-search input { width: 100%; }
    .fin .tr-search { flex: 1; }
    .fin .tr-bar-right { width: 100%; }
    .fin .tr-act { width: 100%; }
    .fin .tr-act .btn-primary, .fin .tr-act .btn-secondary { flex: 1; justify-content: center; }
  }
  @media (max-width: 560px) {
    .fin .tr-tiles { grid-template-columns: 1fr; }
    .fin .seg.pill { width: 100%; overflow-x: auto; }
  }
`
