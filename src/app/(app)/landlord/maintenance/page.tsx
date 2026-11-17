'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import {
  getWorkItems, createWorkItem, updateWorkItem, deleteWorkItem,
  sortWorkItems, computeTotals, isOpen, isOverdue, fmtMoney,
  KIND_META, PRIORITY_META, STATUS_META, KIND_ORDER, PRIORITY_ORDER, STATUS_ORDER,
  type WorkItem, type WorkKind, type WorkPriority, type WorkStatus, type WorkItemInput,
} from '@/lib/maintenance'
import {
  shareAudience, describeAudience, TENANT_STATUS_META, tenantKindLabel,
  type AudienceLease,
} from '@/lib/tenantMaintenance'

type Property = { id: string; name: string; slug: string }

const BLANK = (propertyId: string): WorkItemInput => ({
  property_id: propertyId,
  title: '',
  kind: 'repair',
  priority: 'medium',
  status: 'todo',
  area: '',
  description: '',
  estimated_cost: null,
  target_date: null,
  vendor_name: '',
  tenant_visible: false,
  tenant_note: '',
})

/** Which items the resident filter lets through. */
type ShareView = 'all' | 'shared' | 'private'

/**
 * Maintenance & upgrades — one list per portfolio, filtered to a property.
 *
 * A landlord standing in a vacant unit doesn't keep two lists in their head
 * ("repairs" and "improvements"), they ask "what needs doing here and what will
 * it cost". So it's one list with a `kind` on each row: the same priorities,
 * costs and statuses apply to a broken faucet and to new flooring, and both
 * roll into one budget.
 *
 * The page is built around the three things a landlord actually does here, in
 * descending order of frequency: **move a job along** (one click on the row),
 * **tell the tenant where it's up to** (the share control, also on the row),
 * and **change its details** (the drawer). Everything that is neither of those
 * — the vendor's number, the quote, the private note, deleting the thing — is
 * in the drawer, off the daily path, where it can't be hit by accident.
 */
export default function MaintenancePage() {
  const router = useRouter()
  const [items, setItems] = useState<WorkItem[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  /**
   * Active tenancies, purely so the share control can name its audience.
   * Optional data: it fails quiet and the control then says nothing about
   * reach rather than blocking the page.
   */
  const [leases, setLeases] = useState<AudienceLease[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)

  // Filters
  const [propertyFilter, setPropertyFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<WorkKind | 'all'>('all')
  const [statusView, setStatusView] = useState<'open' | 'all' | 'completed'>('open')
  const [shareView, setShareView] = useState<ShareView>('all')
  const [search, setSearch] = useState('')

  // Add form
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<WorkItemInput>(BLANK(''))
  const [editing, setEditing] = useState<WorkItem | null>(null)

  const say = (ok: boolean, text: string) => {
    setFlash({ ok, text })
    setTimeout(() => setFlash(null), 5000)
  }

  useEffect(() => { document.title = 'Maintenance & Upgrades — Landlord | HomeHive' }, [])

  const load = useCallback(async (userId: string) => {
    setItems(await getWorkItems(userId))
  }, [])

  useEffect(() => {
    getCurrentUser().then(async user => {
      if (!user) { router.push('/login'); return }
      const [{ data: props }] = await Promise.all([
        supabase.from('properties').select('id, name, slug').eq('owner_id', user.id).order('name'),
        load(user.id),
      ])
      setProperties(props ?? [])
      setLoading(false)

      // After the list is usable, never before it.
      supabase
        .from('leases')
        .select('id, property_id, start_date, end_date, tenants:lease_tenants ( id )')
        .eq('owner_id', user.id)
        .then(({ data }) => setLeases((data ?? []) as unknown as AudienceLease[]))
    })
  }, [router, load])

  const reload = async () => {
    const user = await getCurrentUser()
    if (user) await load(user.id)
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = items.filter(i => {
      if (propertyFilter !== 'all' && i.property_id !== propertyFilter) return false
      if (kindFilter !== 'all' && i.kind !== kindFilter) return false
      if (statusView === 'open' && !isOpen(i)) return false
      if (statusView === 'completed' && i.status !== 'completed') return false
      if (shareView === 'shared' && !i.tenant_visible) return false
      if (shareView === 'private' && i.tenant_visible) return false
      if (q && !(
        i.title.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.area ?? '').toLowerCase().includes(q) ||
        (i.property?.name ?? '').toLowerCase().includes(q)
      )) return false
      return true
    })
    return sortWorkItems(filtered)
  }, [items, propertyFilter, kindFilter, statusView, shareView, search])

  /**
   * The list, grouped by property.
   *
   * A portfolio list sorted only by urgency reads as a single undifferentiated
   * queue, and a landlord's actual unit of attention is a building: they go to
   * one address and do the three things waiting there. Grouping is skipped when
   * a property is already selected, or when there is only one — a heading over
   * the only group is just noise.
   */
  const groups = useMemo(() => {
    if (propertyFilter !== 'all' || properties.length < 2) {
      return [{ id: null as string | null, name: null as string | null, items: visible }]
    }
    const byProperty = new Map<string, WorkItem[]>()
    for (const i of visible) {
      const list = byProperty.get(i.property_id)
      if (list) list.push(i); else byProperty.set(i.property_id, [i])
    }
    // Property order follows the already-urgency-sorted list, so the building
    // with the emergency in it comes first rather than the one starting with A.
    return [...byProperty.entries()].map(([id, list]) => ({
      id,
      name: list[0]?.property?.name ?? properties.find(p => p.id === id)?.name ?? 'Property',
      items: list,
    }))
  }, [visible, propertyFilter, properties])

  // Totals follow the property filter but ignore the open/completed view, so
  // the money never changes just because you switched tabs.
  const totals = useMemo(() => computeTotals(
    items.filter(i => propertyFilter === 'all' || i.property_id === propertyFilter)
  ), [items, propertyFilter])

  const audienceFor = useCallback(
    (propertyId: string) => shareAudience(propertyId, leases),
    [leases],
  )

  async function submitDraft() {
    if (!draft.title.trim()) return say(false, 'Give the item a title.')
    if (!draft.property_id) return say(false, 'Pick a property.')
    setBusy(true)
    const { error } = await createWorkItem(draft)
    setBusy(false)
    if (error) return say(false, error)
    await reload()
    setDraft(BLANK(draft.property_id))
    setAdding(false)
    say(true, 'Added to the list — a copy has been emailed to you.')
  }

  async function patch(item: WorkItem, changes: Partial<WorkItemInput>) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...changes } as WorkItem : i))
    const { error } = await updateWorkItem(item.id, changes)
    if (error) { say(false, 'Could not save that change.'); await reload() }
  }

  /**
   * Flip an item's visibility to the tenants of this property.
   *
   * Confirmed in one direction only. Sharing publishes a title a tenant will
   * read and may act on, so it is worth a sentence that names the audience;
   * un-sharing only ever takes something away, and a landlord who has realised
   * they published the wrong thing should not have to get past a dialog to fix
   * it.
   */
  async function toggleShare(item: WorkItem) {
    const next = !item.tenant_visible
    if (next) {
      const a = audienceFor(item.property_id)
      const who = a.residents === 0
        ? 'No resident is on an active lease here yet, so nobody will see it until a tenancy starts.'
        : `${a.residents} ${a.residents === 1 ? 'resident' : 'residents'} on an active lease will see it.`
      if (!confirm(`Share "${item.title}" with the tenants of this home?\n\n${who}\n\nThey see the title, type, status and dates — never your costs, vendor details or private notes.`)) return
    }
    await patch(item, { tenant_visible: next })
    say(true, next
      ? 'Shared with the residents of that home.'
      : 'Hidden from residents again.')
  }

  async function remove(item: WorkItem) {
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return
    const { error } = await deleteWorkItem(item.id)
    if (error) return say(false, 'Could not delete that item.')
    setEditing(null)
    await reload()
    say(true, 'Item deleted.')
  }

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading…
      </div>
    )
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="mt-wrap">
        <div className="mt-head">
          <div>
            <h1 className="mt-title">Maintenance &amp; Upgrades</h1>
            <p className="mt-sub">
              Everything that needs doing across your properties — repairs, planned upgrades,
              tenant issues and turnover work, in one prioritised list. Share an item to put it
              on your residents&apos; portal.
            </p>
          </div>
          <button
            className="btn-dark"
            onClick={() => {
              setDraft(BLANK(propertyFilter !== 'all' ? propertyFilter : properties[0]?.id ?? ''))
              setAdding(v => !v)
            }}
            disabled={properties.length === 0}
          >
            {adding ? 'Cancel' : '+ Add item'}
          </button>
        </div>

        {flash && <div className={flash.ok ? 'alert-ok' : 'alert-err'}>{flash.text}</div>}

        {properties.length === 0 ? (
          <div className="empty">
            <div className="empty-title">No properties yet</div>
            <div className="empty-sub">Add a listing first — maintenance items attach to a property.</div>
          </div>
        ) : (
          <>
            {/* Pressure, then money. "Shared" sits with them because what your
                residents can see is a standing fact about this list, not a
                filter you remember to check. */}
            <div className="kpis">
              <Kpi label="Open items" value={String(totals.open)} sub={totals.emergencies > 0 ? `${totals.emergencies} emergency` : undefined} tone={totals.emergencies > 0 ? 'bad' : undefined} />
              <Kpi label="Overdue" value={String(totals.overdue)} tone={totals.overdue > 0 ? 'warn' : undefined} />
              <Kpi
                label="Shared with residents"
                value={String(totals.shared)}
                sub={totals.open > 0 ? `of ${totals.open} open` : 'nothing open'}
                onClick={totals.shared > 0 ? () => { setShareView('shared'); setStatusView('open') } : undefined}
              />
              <Kpi label="Estimated to come" value={fmtMoney(totals.estimatedOpen)} />
              <Kpi
                label="Spent (completed)"
                value={fmtMoney(totals.actualSpent)}
                sub={totals.varianceBase > 0
                  ? `${totals.variance >= 0 ? '+' : '−'}${fmtMoney(Math.abs(totals.variance))} vs estimate`
                  : undefined}
                tone={totals.varianceBase > 0 && totals.variance > 0 ? 'warn' : undefined}
              />
            </div>

            {/* Add form */}
            {adding && (
              <div className="card add-card">
                <div className="card-hd"><span className="card-title">New item</span></div>
                <div className="card-bd">
                  <ItemForm
                    value={draft}
                    properties={properties}
                    audience={draft.property_id ? audienceFor(draft.property_id) : null}
                    onChange={setDraft}
                    showStatus={false}
                    showActual={false}
                  />
                  <div className="btn-row">
                    <button className="btn-dark" onClick={submitDraft} disabled={busy}>
                      {busy ? 'Adding…' : 'Add to list'}
                    </button>
                    <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
                  </div>
                  <div className="hint" style={{ marginTop: 10 }}>
                    You&apos;ll get an email confirming the item, so it exists somewhere other than this screen.
                  </div>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="filters">
              <div className="seg">
                {(['open', 'completed', 'all'] as const).map(v => (
                  <button
                    key={v}
                    className={`seg-btn${statusView === v ? ' on' : ''}`}
                    onClick={() => setStatusView(v)}
                  >
                    {v === 'open' ? 'Open' : v === 'completed' ? 'Completed' : 'All'}
                  </button>
                ))}
              </div>
              {/* The audit view: "what exactly have I published to my tenants?"
                  is a question a landlord asks at the worst possible moment,
                  and it should take one click to answer. */}
              <div className="seg">
                {(['all', 'shared', 'private'] as ShareView[]).map(v => (
                  <button
                    key={v}
                    className={`seg-btn${shareView === v ? ' on' : ''}`}
                    onClick={() => setShareView(v)}
                  >
                    {v === 'all' ? 'Everything' : v === 'shared' ? 'Shared' : 'Private'}
                  </button>
                ))}
              </div>
              <select className="inp sm" value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}>
                <option value="all">All properties</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="inp sm" value={kindFilter} onChange={e => setKindFilter(e.target.value as WorkKind | 'all')}>
                <option value="all">All types</option>
                {KIND_ORDER.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
              </select>
              <input
                className="inp sm grow"
                placeholder="Search title, area, property…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* List */}
            {visible.length === 0 ? (
              <div className="empty">
                <div className="empty-title">
                  {items.length === 0 ? 'Nothing on the list yet' : 'Nothing matches those filters'}
                </div>
                <div className="empty-sub">
                  {items.length === 0
                    ? 'Add the upgrades you\'re planning and the repairs you owe — flooring, fixtures, paint, a broken lock. Priority and cost make the list plan itself.'
                    : 'Try a different property, type or view.'}
                </div>
              </div>
            ) : (
              groups.map(g => (
                <div key={g.id ?? 'all'} className="group">
                  {g.name && (
                    <div className="group-hd">
                      <span className="group-name">{g.name}</span>
                      <span className="group-meta">
                        {g.items.filter(isOpen).length} open
                        {g.items.filter(i => i.tenant_visible && isOpen(i)).length > 0 &&
                          ` · ${g.items.filter(i => i.tenant_visible && isOpen(i)).length} shared`}
                      </span>
                    </div>
                  )}
                  {g.items.map(item => (
                    <Row
                      key={item.id}
                      item={item}
                      showProperty={!g.name}
                      audience={audienceFor(item.property_id)}
                      onPatch={patch}
                      onToggleShare={() => toggleShare(item)}
                      onEdit={() => setEditing(item)}
                    />
                  ))}
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Edit drawer */}
      {editing && (
        <EditModal
          item={editing}
          properties={properties}
          audience={audienceFor(editing.property_id)}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); say(true, 'Item updated.') }}
          onDelete={() => remove(editing)}
          onFlash={say}
        />
      )}
    </>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Kpi({
  label, value, sub, tone, onClick,
}: {
  label: string; value: string; sub?: string; tone?: 'bad' | 'warn'; onClick?: () => void
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-val${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  )
  return onClick
    ? <button className="kpi tappable" onClick={onClick} title="Show these">{body}</button>
    : <div className="kpi">{body}</div>
}

const fmtDay = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * One row.
 *
 * Three tiers down the row, in the order a landlord reads them: what and where,
 * then what it costs, then what to do about it. The actions live in a footer
 * strip rather than a third column — the old three-column layout gave the two
 * dropdowns and a red "Delete" link equal weight with the title, so the most
 * destructive control on the page sat in the easiest place to mis-click. Delete
 * now lives in the drawer; the footer holds only the moves you make daily.
 */
function Row({
  item, showProperty, audience, onPatch, onToggleShare, onEdit,
}: {
  item: WorkItem
  showProperty: boolean
  audience: { leases: number; residents: number }
  onPatch: (item: WorkItem, changes: Partial<WorkItemInput>) => Promise<void>
  onToggleShare: () => void
  onEdit: () => void
}) {
  const kind = KIND_META[item.kind]
  const priority = PRIORITY_META[item.priority]
  const status = STATUS_META[item.status]
  const overdue = isOverdue(item)
  const open = isOpen(item)
  const [cost, setCost] = useState(item.actual_cost?.toString() ?? '')

  const variance = item.estimated_cost != null && item.actual_cost != null
    ? item.actual_cost - item.estimated_cost
    : null

  // Medium and low are the default and the shrug. Printing them on every row
  // trains the eye to skip the priority tag entirely, which is exactly when an
  // "Emergency" stops being visible.
  const loudPriority = item.priority === 'emergency' || item.priority === 'high'

  return (
    <div className={`row${open ? '' : ' done'}${item.priority === 'emergency' && open ? ' urgent' : ''}`}>
      <div className="row-body">
        <div className="row-main">
          <div className="row-top">
            <span className="tag" style={{ background: kind.bg, color: kind.color }}>{kind.icon} {kind.label}</span>
            {loudPriority && <span className="tag" style={{ background: priority.bg, color: priority.color }}>{priority.label}</span>}
            {overdue && <span className="tag overdue">Overdue</span>}
          </div>

          <button className="row-title" onClick={onEdit} title="Open details">{item.title}</button>

          <div className="row-meta">
            {[
              showProperty ? item.property?.name : null,
              item.area,
              item.scheduled_for ? `booked ${fmtDay(item.scheduled_for)}` : null,
              item.target_date ? `target ${fmtDay(item.target_date)}` : null,
              item.vendor_name,
            ].filter(Boolean).join(' · ')}
          </div>

          {item.description && <div className="row-desc">{item.description}</div>}
        </div>

        <div className="row-money">
          <div className="money-line">
            <span className="money-k">Est.</span>
            <span className="money-v">{item.estimated_cost != null ? fmtMoney(item.estimated_cost) : '—'}</span>
          </div>
          <div className="money-line">
            <span className="money-k">Actual</span>
            {open ? (
              <span className="money-v muted">—</span>
            ) : (
              <input
                className="inp cost"
                type="number" min="0" step="0.01"
                placeholder="0.00"
                value={cost}
                onChange={e => setCost(e.target.value)}
                onBlur={() => {
                  const v = cost === '' ? null : Number(cost)
                  if (v !== item.actual_cost) onPatch(item, { actual_cost: v })
                }}
              />
            )}
          </div>
          {variance !== null && Math.abs(variance) >= 0.01 && (
            <div className={`variance${variance > 0 ? ' over' : ' under'}`}>
              {variance > 0 ? '+' : '−'}{fmtMoney(Math.abs(variance))} vs est.
            </div>
          )}
        </div>
      </div>

      <div className="row-foot">
        <select
          className="inp pill status"
          value={item.status}
          style={{ color: status.color, background: status.bg, borderColor: status.bg }}
          onChange={e => onPatch(item, { status: e.target.value as WorkStatus })}
        >
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>

        {/* The one-click version of the commonest edit on the page. */}
        {open && (
          <button className="btn-soft" onClick={() => onPatch(item, { status: 'completed' })}>
            Mark done
          </button>
        )}

        <div className="foot-right">
          {/* The share state is a *fact about this row*, so it is readable at a
              glance and flippable in place — burying it in the drawer makes
              "what have I told my tenants" a thing you have to go and audit. */}
          <button
            className={`btn-share${item.tenant_visible ? ' on' : ''}`}
            onClick={onToggleShare}
            title={item.tenant_visible
              ? `Visible on the tenant portal. ${describeAudience(audience)}.`
              : `Private to you. ${describeAudience(audience)}.`}
          >
            {item.tenant_visible ? '👁 Shared with residents' : 'Private'}
          </button>
          {item.tenant_visible && audience.residents === 0 && (
            <span className="foot-warn" title="There is no active tenancy at this property">no audience yet</span>
          )}
          <button className="btn-soft" onClick={onEdit}>Details</button>
        </div>
      </div>
    </div>
  )
}

/**
 * The share control, in full, for the add form and the drawer.
 *
 * A toggle plus the sentence the tenant will read plus a statement of who will
 * read it. The note matters more than it looks: without it a shared item says
 * only "Replace bedroom 2 flooring — Scheduled", and the tenant's next move is
 * an email asking the questions the note would have answered.
 */
function ShareField({
  value, audience, onChange,
}: {
  value: WorkItemInput
  audience: { leases: number; residents: number } | null
  onChange: (patch: Partial<WorkItemInput>) => void
}) {
  const on = !!value.tenant_visible
  return (
    <div className={`share${on ? ' on' : ''}`}>
      <label className="share-top">
        <input type="checkbox" checked={on} onChange={e => onChange({ tenant_visible: e.target.checked })} />
        <span>
          <span className="share-lbl">Show this to the residents of this home</span>
          <span className="share-sub">
            {audience ? describeAudience(audience) : 'Only tenants on an active lease here will see it'}
            {' '}· they never see your costs, vendor details, private notes or priority.
          </span>
        </span>
      </label>

      {on && (
        <div className="share-body">
          <label className="lbl">Note to residents</label>
          <textarea
            className="inp" rows={2}
            value={value.tenant_note ?? ''}
            onChange={e => onChange({ tenant_note: e.target.value })}
            placeholder="The plumber is booked for Thursday morning — you don't need to be home."
          />
          <div className="hint">
            Written to them, not about the job. Your &quot;details&quot; field above stays private.
          </div>
          <div className="share-preview">
            <div className="share-preview-k">What they&apos;ll see</div>
            <div className="share-preview-row">
              <div>
                <div className="share-preview-t">{value.title.trim() || 'Your item title'}</div>
                <div className="share-preview-m">
                  {tenantKindLabel(value.kind)}
                  {value.area ? ` · ${value.area}` : ''}
                  {value.scheduled_for ? ` · Booked for ${fmtDay(value.scheduled_for)}`
                    : value.target_date ? ` · Aiming for ${fmtDay(value.target_date)}` : ''}
                </div>
                {value.tenant_note && <div className="share-preview-n">{value.tenant_note}</div>}
              </div>
              <span
                className="share-preview-pill"
                style={{
                  background: TENANT_STATUS_META[value.status as keyof typeof TENANT_STATUS_META]?.bg ?? '#f1f5f9',
                  color: TENANT_STATUS_META[value.status as keyof typeof TENANT_STATUS_META]?.color ?? '#475569',
                }}
              >
                {TENANT_STATUS_META[value.status as keyof typeof TENANT_STATUS_META]?.label ?? value.status}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemForm({
  value, properties, audience, onChange, showStatus, showActual,
}: {
  value: WorkItemInput
  properties: Property[]
  audience: { leases: number; residents: number } | null
  onChange: (v: WorkItemInput) => void
  showStatus: boolean
  showActual: boolean
}) {
  const set = (patch: Partial<WorkItemInput>) => onChange({ ...value, ...patch })
  return (
    <>
      <div className="grid2">
        <Field label="What needs doing *">
          <input className="inp" value={value.title} onChange={e => set({ title: e.target.value })}
            placeholder="Replace bedroom 2 flooring" />
        </Field>
        <Field label="Property *">
          <select className="inp" value={value.property_id} onChange={e => set({ property_id: e.target.value })}>
            <option value="">Select…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid3">
        <Field label="Type" hint={KIND_META[value.kind].blurb}>
          <select className="inp" value={value.kind} onChange={e => set({ kind: e.target.value as WorkKind })}>
            {KIND_ORDER.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="inp" value={value.priority} onChange={e => set({ priority: e.target.value as WorkPriority })}>
            {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        </Field>
        <Field label="Area / room" hint="Bedroom 2, kitchen, roof…">
          <input className="inp" value={value.area ?? ''} onChange={e => set({ area: e.target.value })} placeholder="Bedroom 2" />
        </Field>
      </div>

      <div className="grid3">
        {showStatus && (
          <Field label="Status">
            <select className="inp" value={value.status} onChange={e => set({ status: e.target.value as WorkStatus })}>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Target date" hint="When it needs to be done by">
          <input className="inp" type="date" value={value.target_date ?? ''}
            onChange={e => set({ target_date: e.target.value || null })} />
        </Field>
        <Field label="Booked for" hint="The date the work actually happens">
          <input className="inp" type="date" value={value.scheduled_for ?? ''}
            onChange={e => set({ scheduled_for: e.target.value || null })} />
        </Field>
      </div>

      <Field label="Details" hint="Private to you — never shown to residents.">
        <textarea className="inp" rows={2} value={value.description ?? ''}
          onChange={e => set({ description: e.target.value })}
          placeholder="Carpet is stained beyond cleaning — replace with LVP throughout." />
      </Field>

      {/* Residents, as its own block. It is a publishing decision, and a
          checkbox lost in a row of cost fields is one people tick by accident
          in both directions. */}
      <ShareField value={value} audience={audience} onChange={set} />

      <div className="fieldset">
        <div className="fieldset-hd">Costs &amp; vendor <span className="fieldset-note">private</span></div>
        <div className="grid3">
          <Field label="Estimated cost">
            <input className="inp" type="number" min="0" step="0.01"
              value={value.estimated_cost ?? ''}
              onChange={e => set({ estimated_cost: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="1200.00" />
          </Field>
          {showActual && (
            <Field label="Actual cost" hint="Fill in once the work is done">
              <input className="inp" type="number" min="0" step="0.01"
                value={value.actual_cost ?? ''}
                onChange={e => set({ actual_cost: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          )}
          <Field label="Vendor">
            <input className="inp" value={value.vendor_name ?? ''} onChange={e => set({ vendor_name: e.target.value })} placeholder="Tempe Flooring Co." />
          </Field>
          <Field label="Vendor contact">
            <input className="inp" value={value.vendor_contact ?? ''} onChange={e => set({ vendor_contact: e.target.value })} placeholder="480-555-0134" />
          </Field>
          <Field label="Reported by" hint="For tenant-reported issues">
            <input className="inp" value={value.reported_by ?? ''} onChange={e => set({ reported_by: e.target.value })} />
          </Field>
        </div>
      </div>
    </>
  )
}

function EditModal({
  item, properties, audience, onClose, onSaved, onDelete, onFlash,
}: {
  item: WorkItem
  properties: Property[]
  audience: { leases: number; residents: number }
  onClose: () => void
  onSaved: () => Promise<void>
  onDelete: () => void
  onFlash: (ok: boolean, text: string) => void
}) {
  const [value, setValue] = useState<WorkItemInput>({
    property_id: item.property_id,
    title: item.title,
    kind: item.kind,
    priority: item.priority,
    status: item.status,
    area: item.area,
    description: item.description,
    estimated_cost: item.estimated_cost,
    actual_cost: item.actual_cost,
    target_date: item.target_date,
    scheduled_for: item.scheduled_for,
    vendor_name: item.vendor_name,
    vendor_contact: item.vendor_contact,
    assigned_to: item.assigned_to,
    reported_by: item.reported_by,
    notes: item.notes,
    tenant_visible: item.tenant_visible,
    tenant_note: item.tenant_note,
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!value.title.trim()) return onFlash(false, 'Give the item a title.')
    setSaving(true)
    const { error } = await updateWorkItem(item.id, value)
    setSaving(false)
    if (error) return onFlash(false, 'Could not save.')
    await onSaved()
  }

  return (
    <div className="modal-back" onClick={() => !saving && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hd">
          <div>
            <div className="modal-title">Item details</div>
            <div className="modal-sub">
              {item.property?.name}
              {item.tenant_visible ? ' · shared with residents' : ' · private'}
            </div>
          </div>
          <button className="modal-x" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className="modal-body">
          <ItemForm
            value={value}
            properties={properties}
            audience={audience}
            onChange={setValue}
            showStatus
            showActual
          />
          <Field label="Private notes" hint="Yours alone. Quotes, who said what, why it's stalled.">
            <textarea className="inp" rows={2} value={value.notes ?? ''}
              onChange={e => setValue({ ...value, notes: e.target.value })}
              placeholder="Quote received 08/10, work booked for the 22nd." />
          </Field>
        </div>
        <div className="modal-ft">
          {/* Destructive action, kept here and only here: off the row, behind a
              confirm, and visually separated from the thing you came to click. */}
          <button className="btn-link-danger" onClick={onDelete} disabled={saving}>Delete item</button>
          <div className="ft-right">
            <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn-dark" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="lbl">{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .mt-wrap { max-width: 1040px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .mt-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .mt-title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .mt-sub { font-size: 13px; color: #64748b; margin-top: 4px; max-width: 580px; line-height: 1.55; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .kpi { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; text-align: left; font-family: inherit; }
  .kpi.tappable { cursor: pointer; }
  .kpi.tappable:hover { border-color: #cbd5e1; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 5px; }
  .kpi-val { font-size: 20px; font-weight: 700; color: #0f172a; }
  .kpi-val.bad { color: #dc2626; }
  .kpi-val.warn { color: #b45309; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

  .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  .seg { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
  .seg-btn { background: none; border: none; border-radius: 7px; padding: 6px 13px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; font-family: inherit; }
  .seg-btn.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
  .inp.sm { padding: 7px 10px; font-size: 12.5px; width: auto; }
  .inp.grow { flex: 1; min-width: 150px; }

  .group { margin-bottom: 10px; }
  .group-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 0 2px 7px; margin-top: 18px; }
  .group-name { font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -0.1px; }
  .group-meta { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }

  .row { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
  .row.urgent { border-left: 4px solid #dc2626; }
  .row.done { background: #fafbfc; }
  .row.done .row-body { opacity: 0.72; }
  .row-body { display: flex; align-items: flex-start; gap: 16px; padding: 14px 16px 12px; }
  .row-main { flex: 1; min-width: 0; }
  .row-top { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 3px 8px; border-radius: 20px; }
  .tag.overdue { background: #fee2e2; color: #991b1b; }
  .row-title { background: none; border: none; padding: 0; font-family: inherit; font-size: 15px; font-weight: 600; color: #0f172a; cursor: pointer; text-align: left; line-height: 1.35; }
  .row-title:hover { text-decoration: underline; }
  .row-meta { font-size: 11.5px; color: #94a3b8; margin-top: 3px; }
  .row-desc { font-size: 12.5px; color: #64748b; margin-top: 6px; line-height: 1.5; }

  .row-money { width: 150px; flex-shrink: 0; }
  .money-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .money-k { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
  .money-v { font-size: 13px; font-weight: 700; color: #0f172a; }
  .money-v.muted { color: #cbd5e1; font-weight: 500; }
  .inp.cost { width: 84px; padding: 4px 7px; font-size: 12.5px; text-align: right; }
  .variance { font-size: 10.5px; font-weight: 700; margin-top: 3px; text-align: right; }
  .variance.over { color: #b45309; }
  .variance.under { color: #059669; }

  .row-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 16px; border-top: 1px solid #f1f5f9; background: #fcfdfe; }
  .foot-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
  .foot-warn { font-size: 10.5px; font-weight: 700; color: #b45309; text-transform: uppercase; letter-spacing: 0.4px; }
  .inp.pill { padding: 5px 9px; font-size: 12px; font-weight: 600; width: auto; border-radius: 20px; }
  .btn-soft { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 5px 11px; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer; font-family: inherit; }
  .btn-soft:hover { border-color: #cbd5e1; color: #0f172a; }
  .btn-share { background: #fff; border: 1.5px dashed #cbd5e1; border-radius: 20px; padding: 5px 12px; font-size: 11.5px; font-weight: 700; color: #94a3b8; cursor: pointer; font-family: inherit; }
  .btn-share:hover { border-color: #94a3b8; color: #475569; }
  .btn-share.on { background: #ecfdf5; border: 1.5px solid #a7f3d0; color: #047857; }
  .btn-share.on:hover { border-color: #34d399; }

  .card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
  .add-card { border-color: #cbd5e1; }
  .card-hd { padding: 13px 18px; border-bottom: 1px solid #f1f5f9; }
  .card-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px; }
  .card-bd { padding: 16px 18px; }

  .field { margin-bottom: 13px; }
  .lbl { display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
  .inp { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; color: #0f172a; font-family: inherit; background: #fff; outline: none; }
  .inp:focus { border-color: #10b981; }
  textarea.inp { resize: vertical; line-height: 1.5; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 13px; }
  .hint { font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.45; }

  .fieldset { border: 1.5px solid #f1f5f9; border-radius: 11px; padding: 14px 15px 2px; margin-bottom: 14px; }
  .fieldset-hd { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 11px; }
  .fieldset-note { font-weight: 600; color: #94a3b8; letter-spacing: 0.3px; }

  .share { border: 1.5px solid #e2e8f0; border-radius: 11px; padding: 13px 15px; margin-bottom: 14px; background: #fcfdfe; }
  .share.on { border-color: #a7f3d0; background: #f6fffb; }
  .share-top { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  .share-top input { margin-top: 3px; width: 15px; height: 15px; accent-color: #059669; flex-shrink: 0; }
  .share-lbl { display: block; font-size: 13.5px; font-weight: 600; color: #0f172a; }
  .share-sub { display: block; font-size: 11.5px; color: #64748b; margin-top: 3px; line-height: 1.5; }
  .share-body { margin-top: 13px; padding-top: 13px; border-top: 1px solid #e2f5ec; }
  .share-preview { margin-top: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 11px 13px; }
  .share-preview-k { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 8px; }
  .share-preview-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .share-preview-t { font-size: 13.5px; font-weight: 600; color: #0f172a; }
  .share-preview-m { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .share-preview-n { font-size: 12px; color: #475569; margin-top: 5px; line-height: 1.5; }
  .share-preview-pill { flex-shrink: 0; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 3px 8px; border-radius: 20px; white-space: nowrap; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 9px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-dark:disabled { opacity: .5; cursor: not-allowed; }
  .btn-ghost { background: #fff; color: #475569; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 15px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-link-danger { background: none; border: none; color: #dc2626; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-link-danger:hover { text-decoration: underline; }
  .btn-row { display: flex; gap: 9px; margin-top: 6px; }

  .alert-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }
  .alert-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }

  .empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 42px 32px; text-align: center; }
  .empty-title { font-size: 17px; font-weight: 600; color: #0f172a; margin-bottom: 7px; }
  .empty-sub { font-size: 13.5px; color: #64748b; line-height: 1.6; max-width: 460px; margin: 0 auto; }

  .modal-back { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .modal { background: #fff; border-radius: 14px; width: 100%; max-width: 660px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 15px 20px; border-bottom: 1px solid #f1f5f9; }
  .modal-title { font-size: 16px; font-weight: 700; color: #0f172a; }
  .modal-sub { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }
  .modal-x { background: none; border: none; font-size: 22px; line-height: 1; color: #94a3b8; cursor: pointer; }
  .modal-body { flex: 1; overflow: auto; padding: 18px 20px; }
  .modal-ft { display: flex; align-items: center; justify-content: space-between; gap: 9px; padding: 14px 20px; border-top: 1px solid #f1f5f9; }
  .ft-right { display: flex; gap: 9px; }

  @media (max-width: 860px) {
    .grid2, .grid3 { grid-template-columns: 1fr; }
    .row-body { flex-direction: column; gap: 12px; }
    .row-money { width: 100%; display: flex; gap: 18px; align-items: center; }
    .foot-right { margin-left: 0; width: 100%; }
  }
`
