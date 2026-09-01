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
})

/**
 * Maintenance & upgrades — one list per portfolio, filtered to a property.
 *
 * A landlord standing in a vacant unit doesn't keep two lists in their head
 * ("repairs" and "improvements"), they ask "what needs doing here and what will
 * it cost". So it's one list with a `kind` on each row: the same priorities,
 * costs and statuses apply to a broken faucet and to new flooring, and both
 * roll into one budget.
 */
export default function MaintenancePage() {
  const router = useRouter()
  const [items, setItems] = useState<WorkItem[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)

  // Filters
  const [propertyFilter, setPropertyFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<WorkKind | 'all'>('all')
  const [statusView, setStatusView] = useState<'open' | 'all' | 'completed'>('open')
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
      if (q && !(
        i.title.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        (i.area ?? '').toLowerCase().includes(q) ||
        (i.property?.name ?? '').toLowerCase().includes(q)
      )) return false
      return true
    })
    return sortWorkItems(filtered)
  }, [items, propertyFilter, kindFilter, statusView, search])

  // Totals follow the property filter but ignore the open/completed view, so
  // the money never changes just because you switched tabs.
  const totals = useMemo(() => computeTotals(
    items.filter(i => propertyFilter === 'all' || i.property_id === propertyFilter)
  ), [items, propertyFilter])

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

  async function remove(item: WorkItem) {
    if (!confirm(`Delete "${item.title}"?`)) return
    const { error } = await deleteWorkItem(item.id)
    if (error) return say(false, 'Could not delete that item.')
    await reload()
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
              tenant issues and turnover work, in one prioritised list.
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
            {/* Money & pressure at a glance */}
            <div className="kpis">
              <Kpi label="Open items" value={String(totals.open)} sub={totals.emergencies > 0 ? `${totals.emergencies} emergency` : undefined} tone={totals.emergencies > 0 ? 'bad' : undefined} />
              <Kpi label="Overdue" value={String(totals.overdue)} tone={totals.overdue > 0 ? 'warn' : undefined} />
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
              visible.map(item => (
                <Row
                  key={item.id}
                  item={item}
                  onPatch={patch}
                  onEdit={() => setEditing(item)}
                  onDelete={() => remove(item)}
                />
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
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); say(true, 'Item updated.') }}
          onFlash={say}
        />
      )}
    </>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-val${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/** One row. Status and priority are editable inline — that's the daily action. */
function Row({
  item, onPatch, onEdit, onDelete,
}: {
  item: WorkItem
  onPatch: (item: WorkItem, changes: Partial<WorkItemInput>) => Promise<void>
  onEdit: () => void
  onDelete: () => void
}) {
  const kind = KIND_META[item.kind]
  const priority = PRIORITY_META[item.priority]
  const status = STATUS_META[item.status]
  const overdue = isOverdue(item)
  const [cost, setCost] = useState(item.actual_cost?.toString() ?? '')

  const variance = item.estimated_cost != null && item.actual_cost != null
    ? item.actual_cost - item.estimated_cost
    : null

  return (
    <div className={`row${isOpen(item) ? '' : ' done'}${item.priority === 'emergency' && isOpen(item) ? ' urgent' : ''}`}>
      <div className="row-main">
        <div className="row-top">
          <span className="tag" style={{ background: kind.bg, color: kind.color }}>{kind.icon} {kind.label}</span>
          <span className="tag" style={{ background: priority.bg, color: priority.color }}>{priority.label}</span>
          {overdue && <span className="tag overdue">Overdue</span>}
        </div>

        <button className="row-title" onClick={onEdit} title="Edit item">{item.title}</button>

        <div className="row-meta">
          {item.property?.name}
          {item.area ? ` · ${item.area}` : ''}
          {item.target_date ? ` · target ${new Date(item.target_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
          {item.vendor_name ? ` · ${item.vendor_name}` : ''}
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
          {isOpen(item) ? (
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

      <div className="row-actions">
        <select
          className="inp sm status"
          value={item.status}
          style={{ color: status.color, background: status.bg, borderColor: status.bg }}
          onChange={e => onPatch(item, { status: e.target.value as WorkStatus })}
        >
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select
          className="inp sm"
          value={item.priority}
          onChange={e => onPatch(item, { priority: e.target.value as WorkPriority })}
        >
          {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
        </select>
        <button className="btn-link-danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

function ItemForm({
  value, properties, onChange, showStatus, showActual,
}: {
  value: WorkItemInput
  properties: Property[]
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
        <Field label="Target date">
          <input className="inp" type="date" value={value.target_date ?? ''}
            onChange={e => set({ target_date: e.target.value || null })} />
        </Field>
        {showStatus && (
          <Field label="Status">
            <select className="inp" value={value.status} onChange={e => set({ status: e.target.value as WorkStatus })}>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </Field>
        )}
      </div>

      <Field label="Details">
        <textarea className="inp" rows={2} value={value.description ?? ''}
          onChange={e => set({ description: e.target.value })}
          placeholder="Carpet is stained beyond cleaning — replace with LVP throughout." />
      </Field>

      <div className="grid3">
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
    </>
  )
}

function EditModal({
  item, properties, onClose, onSaved, onFlash,
}: {
  item: WorkItem
  properties: Property[]
  onClose: () => void
  onSaved: () => Promise<void>
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
          <div className="modal-title">Edit item</div>
          <button className="modal-x" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className="modal-body">
          <ItemForm value={value} properties={properties} onChange={setValue} showStatus showActual />
          <Field label="Notes">
            <textarea className="inp" rows={2} value={value.notes ?? ''}
              onChange={e => setValue({ ...value, notes: e.target.value })}
              placeholder="Quote received 08/10, work booked for the 22nd." />
          </Field>
        </div>
        <div className="modal-ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-dark" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
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
  .mt-sub { font-size: 13px; color: #64748b; margin-top: 4px; max-width: 560px; line-height: 1.55; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .kpi { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 5px; }
  .kpi-val { font-size: 20px; font-weight: 700; color: #0f172a; }
  .kpi-val.bad { color: #dc2626; }
  .kpi-val.warn { color: #b45309; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

  .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .seg { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
  .seg-btn { background: none; border: none; border-radius: 7px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; font-family: inherit; }
  .seg-btn.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
  .inp.sm { padding: 7px 10px; font-size: 12.5px; width: auto; }
  .inp.grow { flex: 1; min-width: 160px; }

  .row { display: flex; align-items: flex-start; gap: 16px; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; }
  .row.urgent { border-left: 4px solid #dc2626; }
  .row.done { opacity: 0.72; background: #fafbfc; }
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

  .row-actions { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; flex-shrink: 0; }
  .inp.status { font-weight: 600; }

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

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 9px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-dark:disabled { opacity: .5; cursor: not-allowed; }
  .btn-ghost { background: #fff; color: #475569; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 15px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-link-danger { background: none; border: none; color: #dc2626; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-link-danger:hover { text-decoration: underline; }
  .btn-row { display: flex; gap: 9px; margin-top: 6px; }

  .alert-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }
  .alert-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }

  .empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 42px 32px; text-align: center; }
  .empty-title { font-size: 17px; font-weight: 600; color: #0f172a; margin-bottom: 7px; }
  .empty-sub { font-size: 13.5px; color: #64748b; line-height: 1.6; max-width: 460px; margin: 0 auto; }

  .modal-back { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .modal { background: #fff; border-radius: 14px; width: 100%; max-width: 640px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
  .modal-hd { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #f1f5f9; }
  .modal-title { font-size: 16px; font-weight: 700; color: #0f172a; }
  .modal-x { background: none; border: none; font-size: 22px; line-height: 1; color: #94a3b8; cursor: pointer; }
  .modal-body { flex: 1; overflow: auto; padding: 18px 20px; }
  .modal-ft { display: flex; justify-content: flex-end; gap: 9px; padding: 14px 20px; border-top: 1px solid #f1f5f9; }

  @media (max-width: 860px) {
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .grid2, .grid3 { grid-template-columns: 1fr; }
    .row { flex-direction: column; gap: 12px; }
    .row-money { width: 100%; display: flex; gap: 18px; align-items: center; }
    .row-actions { flex-direction: row; align-items: center; width: 100%; }
  }
`
