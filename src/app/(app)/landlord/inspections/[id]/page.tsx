'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import {
  getInspection, updateInspection, setInspectionStatus, deleteInspection,
  addLeaseToInspection, removeLeaseFromInspection,
  addParty, updateParty, removeParty,
  issueInspection, reopenForRevision, needsResend,
  addItem, updateItem, removeItem,
  uploadItemPhoto, removePhoto,
  findDepositsOnFile, applyDepositMatches,
  findLiveContacts, applyContactUpdates,
  syncLateFees, setLateFeeIncluded, removeLateFee, explainLateFee,
  recordSettlement, clearSettlement, syncInspectionSettlementStatus,
  computeTotals, fmtMoney, AREA_SUGGESTIONS,
  type Inspection, type InspectionItem, type Allocation, type ItemInput,
  type PartyTotal, type SettlementStatus,
} from '@/lib/inspections'
import { getLeasesForOwner, formatLeaseDate, type Lease } from '@/lib/leases'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const BLANK_ITEM: ItemInput = {
  area: '', title: '', description: '', notes: '', cost: 0,
  is_wear_and_tear: false, allocation: 'all',
  allocated_lease_id: null, party_ids: [],
}

export default function InspectionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [ownerLeases, setOwnerLeases] = useState<Lease[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)

  // Details form
  const [form, setForm] = useState({
    title: '', period_start: '', period_end: '', inspection_date: '',
    inspected_by: '', tenant_present: false, response_due_date: '', summary: '',
  })

  // Add-finding form
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState<ItemInput>(BLANK_ITEM)
  const [draftCost, setDraftCost] = useState('')

  // Statement preview modal — nothing sends until it's confirmed here.
  type StatementPreview = {
    partyId: string; name: string; to: string | null
    balance: number; alreadySent: boolean; subject: string; html: string
  }
  const [preview, setPreview] = useState<{ previews: StatementPreview[]; active: number } | null>(null)
  const [sending, setSending] = useState(false)

  const [newPartyName, setNewPartyName] = useState('')
  const [newPartyEmail, setNewPartyEmail] = useState('')
  const [showAddParty, setShowAddParty] = useState(false)

  useEffect(() => { document.title = 'Checkout Inspection — Landlord | HomeHive' }, [])

  const say = (ok: boolean, text: string) => {
    setFlash({ ok, text })
    setTimeout(() => setFlash(null), 3500)
  }

  const reload = useCallback(async () => {
    const data = await getInspection(id)
    if (data) setInspection(data)
    return data
  }, [id])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const data = await getInspection(id)
      if (!data || data.owner_id !== user.id) { router.push('/landlord/leases'); return }

      setInspection(data)
      setForm({
        title: data.title ?? '',
        period_start: data.period_start ?? '',
        period_end: data.period_end ?? '',
        inspection_date: data.inspection_date ?? '',
        inspected_by: data.inspected_by ?? '',
        tenant_present: data.tenant_present,
        response_due_date: data.response_due_date ?? '',
        summary: data.summary ?? '',
      })
      setOwnerLeases(await getLeasesForOwner(user.id))
      setLoading(false)

      // Emails follow the live contact record — a statement must never go to an
      // address the landlord has since corrected. Silent, then reported.
      const drift = await findLiveContacts(data)
      if (drift.length > 0) {
        const { error } = await applyContactUpdates(drift)
        if (!error) {
          const fresh = await getInspection(id)
          if (fresh) setInspection(fresh)
          setFlash({
            ok: true,
            text: `Updated ${drift.length} email${drift.length !== 1 ? 's' : ''} from the latest contact details: ` +
                  drift.map(d => `${d.name} → ${d.to}`).join(', '),
          })
          setTimeout(() => setFlash(null), 8000)
        }
      }
    }
    load()
  }, [id, router])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
        Loading…
      </div>
    )
  }
  if (!inspection) return null

  const locked = inspection.status !== 'draft'
  const totals = computeTotals(inspection)
  const linkedLeaseIds = new Set(inspection.leases.map(l => l.lease_id))
  const linkableLeases = ownerLeases.filter(
    l => l.property_id === inspection.property_id && !linkedLeaseIds.has(l.id)
  )
  const issuedVersion = inspection.version ?? 0
  const isRevising = !locked && issuedVersion > 0
  const staleRecipients = inspection.parties.filter(p => needsResend(inspection, p))

  const reportUrl = `/checkout-report/${inspection.share_token}`
  const absolute = (path: string) =>
    typeof window !== 'undefined' ? `${window.location.origin}${path}` : path
  const copy = (path: string, msg: string) => {
    navigator.clipboard?.writeText(absolute(path))
    say(true, msg)
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function saveDetails() {
    setBusy(true)
    const { error } = await updateInspection(id, {
      title: form.title || null,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      inspection_date: form.inspection_date || null,
      inspected_by: form.inspected_by || null,
      tenant_present: form.tenant_present,
      response_due_date: form.response_due_date || null,
      summary: form.summary || null,
    })
    setBusy(false)
    if (error) return say(false, 'Could not save details.')
    await reload()
    say(true, 'Details saved.')
  }

  /** Issue v1, or a superseding revision once tenants already hold a copy. */
  async function issue() {
    if (!inspection) return
    const isRevision = (inspection.version ?? 0) > 0
    let note: string | null = null

    if (isRevision) {
      note = window.prompt(
        `Issuing version ${inspection.version + 1}. What changed?\n\n` +
        `This prints on the report so tenants can see why their statement was revised.`,
        ''
      )
      if (note === null) return // cancelled
      if (!note.trim()) return say(false, 'A revision needs a reason.')
    }

    setBusy(true)
    const { version, error } = await issueInspection(inspection, note)
    if (!error) {
      const fresh = await getInspection(id)
      if (fresh) await syncInspectionSettlementStatus({ ...fresh, status: 'finalized' })
    }
    setBusy(false)
    if (error) return say(false, 'Could not issue the report.')
    await reload()
    say(true, version === 1
      ? 'Version 1 issued — deposit settlement is now tracked below.'
      : `Version ${version} issued. Tenants who already have an older copy are flagged for re-send.`)
  }

  /** Reopen an issued report to prepare a correction. */
  async function reopen() {
    if (!inspection) return
    const issued = (inspection.version ?? 0) > 0
    const sentCount = inspection.parties.filter(p => p.report_sent_at).length
    if (issued && !confirm(
      `Reopen version ${inspection.version} for editing?\n\n` +
      (sentCount > 0
        ? `${sentCount} tenant${sentCount !== 1 ? 's' : ''} already received this version. `
        : '') +
      `Version ${inspection.version} stays on the record — your changes go out as version ${inspection.version + 1}.`
    )) return

    setBusy(true)
    const { error } = issued
      ? await reopenForRevision(id)
      : await setInspectionStatus(id, 'draft', inspection.finalized_at)
    setBusy(false)
    if (error) return say(false, 'Could not reopen the report.')
    await reload()
    say(true, issued ? 'Reopened — issue a revision when your changes are done.' : 'Reopened for editing.')
  }

  /** Manually re-pull emails from the tenant records. */
  async function syncContacts() {
    if (!inspection) return
    setBusy(true)
    const drift = await findLiveContacts(inspection)
    if (drift.length === 0) {
      setBusy(false)
      return say(true, 'All emails already match the latest contact details.')
    }
    const { error } = await applyContactUpdates(drift)
    setBusy(false)
    if (error) return say(false, 'Could not update contact details.')
    await reload()
    say(true, `Updated ${drift.length} email${drift.length !== 1 ? 's' : ''}: ` +
      drift.map(d => `${d.name} → ${d.to}`).join(', '))
  }

  /** Pull what each tenant actually paid as a deposit out of the payments ledger. */
  async function syncDeposits() {
    if (!inspection) return
    setBusy(true)
    const matches = await findDepositsOnFile(inspection)
    if (matches.length === 0) {
      setBusy(false)
      return say(false, 'No paid security deposits found in Payments for these leases.')
    }
    const { error } = await applyDepositMatches(matches)
    setBusy(false)
    if (error) return say(false, 'Could not apply deposits.')
    await reload()
    say(true, `Pulled ${matches.length} deposit${matches.length !== 1 ? 's' : ''} from Payments.`)
  }

  /**
   * Open the preview modal. Nothing is sent until the landlord approves what
   * they can see — the preview is rendered by the same builder as the send.
   */
  async function sendStatements(partyIds?: string[]) {
    if (!inspection) return
    const targets = partyIds
      ? totals.perParty.filter(p => partyIds.includes(p.party.id))
      : totals.perParty
    if (targets.filter(p => p.party.email?.trim()).length === 0) {
      return say(false, 'No tenants on this report have an email address.')
    }

    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/inspections/${id}/preview-statements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(partyIds ? { partyIds } : {}),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return say(false, json.error || 'Could not build the preview.')

    setPreview({ previews: json.previews ?? [], active: 0 })
  }

  /** Confirmed from the modal — actually send. */
  async function confirmSend() {
    if (!preview || !inspection) return
    const ids = preview.previews.filter(p => p.to).map(p => p.partyId)
    setSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/inspections/${id}/send-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ partyIds: ids }),
    })
    const json = await res.json().catch(() => ({}))
    setSending(false)

    if (!res.ok) return say(false, json.error || 'Could not send the statements.')
    setPreview(null)
    await reload()

    const bits = [`Sent to ${json.sent} tenant${json.sent !== 1 ? 's' : ''}`]
    if (json.skipped?.length) bits.push(`${json.skipped.length} skipped (no email)`)
    if (json.failed?.length) bits.push(`${json.failed.length} failed`)
    say(json.sent > 0, bits.join(' · '))
  }

  /** Bring across every late rent payment from the linked leases. */
  async function pullLateFees() {
    if (!inspection) return
    setBusy(true)
    const { added, error } = await syncLateFees(inspection)
    setBusy(false)
    if (error) return say(false, 'Could not pull late payment charges.')
    if (added === 0) return say(false, 'No new late payments found for these leases.')
    await reload()
    say(true, `Added ${added} late payment charge${added !== 1 ? 's' : ''}.`)
  }

  /** Any settlement change can flip the report in or out of "settled". */
  async function afterSettlementChange() {
    const fresh = await getInspection(id)
    if (!fresh) return
    const { status, changed } = await syncInspectionSettlementStatus(fresh)
    await reload()
    if (changed && status === 'settled') say(true, 'All tenants settled — inspection marked complete.')
  }

  async function handleDelete() {
    if (!confirm('Delete this inspection and all of its findings? This cannot be undone.')) return
    setBusy(true)
    const { error } = await deleteInspection(id)
    setBusy(false)
    if (error) return say(false, 'Could not delete.')
    router.push('/landlord/inspections')
  }

  async function linkLease(leaseId: string) {
    const lease = ownerLeases.find(l => l.id === leaseId)
    if (!lease || !inspection) return
    setBusy(true)
    const { error } = await addLeaseToInspection(
      id,
      {
        id: lease.id,
        unit_number: lease.unit_number,
        tenants: lease.tenants.map(t => ({ tenant_id: t.tenant_id, name: t.name, email: t.email })),
      },
      inspection.parties.length
    )
    setBusy(false)
    if (error) return say(false, 'Could not link that lease.')
    await reload()
    say(true, 'Lease linked — its tenants were added.')
  }

  async function unlinkLease(leaseId: string) {
    if (!confirm('Remove this lease and its tenants from the report?')) return
    setBusy(true)
    const { error } = await removeLeaseFromInspection(id, leaseId)
    setBusy(false)
    if (error) return say(false, 'Could not remove that lease.')
    await reload()
    say(true, 'Lease removed.')
  }

  async function handleAddParty() {
    if (!newPartyName.trim() || !inspection) return
    setBusy(true)
    const { error } = await addParty(
      id,
      { name: newPartyName.trim(), email: newPartyEmail.trim() || null },
      inspection.parties.length
    )
    setBusy(false)
    if (error) return say(false, 'Could not add that person.')
    setNewPartyName(''); setNewPartyEmail(''); setShowAddParty(false)
    await reload()
  }

  async function handleAddItem() {
    if (!draft.title.trim()) return say(false, 'Give the finding a title.')
    if (!draft.is_wear_and_tear && draft.allocation === 'tenants' && draft.party_ids.length === 0) {
      return say(false, 'Select at least one tenant to charge, or change who it goes to.')
    }
    if (!inspection) return
    setBusy(true)
    const { error } = await addItem(
      id,
      { ...draft, title: draft.title.trim(), cost: parseFloat(draftCost) || 0 },
      inspection.items.length
    )
    setBusy(false)
    if (error) return say(false, 'Could not add that finding.')
    setDraft(BLANK_ITEM); setDraftCost(''); setShowAdd(false)
    await reload()
    say(true, 'Finding added.')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{CSS}</style>
      <div className="ins-wrap">
        <div className="ins-crumb">
          <a href="/landlord/inspections">Inspections</a> ›{' '}
          {inspection.property?.name ?? 'Property'}
        </div>

        <div className="ins-head">
          <div>
            <h1 className="ins-title">{inspection.title || 'Move-out inspection'}</h1>
            <div className="ins-sub">
              {inspection.property?.name}
              {inspection.property?.address ? ` · ${inspection.property.address}` : ''}
            </div>
          </div>
          <div className="ins-actions">
            <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">
              Preview report ↗
            </a>
            {locked && (
              <button className="btn-send" onClick={() => sendStatements()} disabled={busy}>
                ✉ Email tenants
              </button>
            )}
            {locked ? (
              <button className="btn-ghost" onClick={reopen} disabled={busy}>Revise</button>
            ) : (
              <button className="btn-dark" onClick={issue} disabled={busy}>
                {issuedVersion > 0 ? `Issue version ${issuedVersion + 1}` : 'Finalize & issue'}
              </button>
            )}
          </div>
        </div>

        {/* The journey: log findings → issue the report → settle the deposits */}
        <div className="journey">
          {([
            { key: 'draft', label: 'Findings', note: `${inspection.items.length} logged` },
            { key: 'finalized', label: 'Report issued', note: inspection.finalized_at
              ? new Date(inspection.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : 'Not yet finalized' },
            { key: 'settled', label: 'Deposits settled', note: totals.allSettled
              ? 'All tenants squared up'
              : `${totals.outstandingCount} pending` },
          ] as const).map((step, i, arr) => {
            const order = { draft: 0, finalized: 1, settled: 2 }
            const done = order[inspection.status] > i
            const active = order[inspection.status] === i
            return (
              <div key={step.key} className={`jstep${done ? ' done' : ''}${active ? ' active' : ''}`}>
                <div className="jdot">{done ? '✓' : i + 1}</div>
                <div>
                  <div className="jlabel">{step.label}</div>
                  <div className="jnote">{step.note}</div>
                </div>
                {i < arr.length - 1 && <div className="jline" />}
              </div>
            )
          })}
        </div>

        {flash && <div className={flash.ok ? 'alert-ok' : 'alert-err'}>{flash.text}</div>}

        {isRevising && (
          <div className="revise-note">
            <strong>Preparing version {issuedVersion + 1}.</strong> Version {issuedVersion} stays on the
            record and is what tenants currently hold. Make your corrections, then{' '}
            <strong>Issue version {issuedVersion + 1}</strong> with a reason — you&apos;ll be able to
            re-send updated statements afterwards.
          </div>
        )}

        {locked && (
          <div className="lock-note">
            {inspection.status === 'settled'
              ? <>Version {issuedVersion} issued and every tenant is settled — this inspection is complete. Use <strong>Revise</strong> if something needs correcting.</>
              : <>Version {issuedVersion} issued{inspection.finalized_at ? ` on ${new Date(inspection.finalized_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. Record refunds under <strong>Deposit settlement</strong>, or <strong>Revise</strong> to correct something.</>}
          </div>
        )}

        {staleRecipients.length > 0 && locked && (
          <div className="alert-warn">
            {staleRecipients.length} tenant{staleRecipients.length !== 1 ? 's have' : ' has'} an
            outdated statement — {staleRecipients.map(p => p.name).join(', ')}.{' '}
            <button className="lnk-btn" onClick={() => sendStatements(staleRecipients.map(p => p.id))}>
              Re-send updated statements
            </button>
          </div>
        )}

        {/* Share links — the house report, plus one per tenant */}
        <div className="card">
          <div className="card-hd"><span className="card-title">Report links</span></div>
          <div className="card-bd">
            <div className="sub-label">Full report — all tenants</div>
            <div className="share-row">
              <input className="inp" readOnly value={absolute(reportUrl)} />
              <button className="btn-ghost" onClick={() => copy(reportUrl, 'Full report link copied.')}>Copy</button>
              <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">Preview ↗</a>
            </div>
            <div className="hint">
              Every finding and each tenant&apos;s reconciliation. This is your record — it shows
              everyone&apos;s deposits and balances, so share it with care.
            </div>

            {inspection.parties.length > 0 && (
              <>
                <div className="sub-label" style={{ marginTop: '20px' }}>
                  Personal statements — one per tenant
                </div>
                <div className="hint" style={{ marginTop: '-4px', marginBottom: '10px' }}>
                  Each link shows only that person&apos;s charges, their share of common findings and
                  their own late fees. This is what the emailed statement links to.
                </div>
                {totals.perParty.map(pt => {
                  const url = `/checkout-report/${pt.party.share_token}`
                  const stale = needsResend(inspection, pt.party)
                  const hasEmail = !!pt.party.email?.trim()
                  return (
                    <div key={pt.party.id} className="share-person">
                      <div className="share-person-main">
                        <div className="row-title">{pt.party.name}</div>
                        <div className="row-sub">
                          {pt.balance >= 0
                            ? `${fmtMoney(pt.balance)} refund`
                            : `${fmtMoney(Math.abs(pt.balance))} owed`}
                          {!hasEmail
                            ? ' · no email on file'
                            : stale
                              ? ' · sent an older version'
                              : pt.party.report_sent_at
                                ? ` · sent ${new Date(pt.party.report_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                                : ' · not sent'}
                        </div>
                      </div>
                      {stale && <span className="pill pill-draft">Outdated</span>}
                      <button className="btn-ghost" onClick={() => copy(url, `${pt.party.name}'s link copied.`)}>Copy</button>
                      <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost">Preview ↗</a>
                      {locked && hasEmail && (
                        <button
                          className="btn-send-sm"
                          onClick={() => sendStatements([pt.party.id])}
                          disabled={busy}
                          title={`Email this statement to ${pt.party.email}`}
                        >
                          ✉ {pt.party.report_sent_at ? 'Resend' : 'Send'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {/* Version history */}
        {inspection.revisions.length > 0 && (
          <div className="card">
            <div className="card-hd">
              <span className="card-title">Version history</span>
              <span className="card-note">Issued statements are superseded, never overwritten</span>
            </div>
            <div className="card-bd">
              {inspection.revisions.map(rev => (
                <div key={rev.id} className="rev-row">
                  <span className={`rev-badge${rev.version === issuedVersion ? ' current' : ''}`}>
                    v{rev.version}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-title">
                      {rev.version === issuedVersion ? 'Current version' : `Superseded by v${rev.version + 1}`}
                      {rev.note && <span className="rev-note"> — {rev.note}</span>}
                    </div>
                    <div className="row-sub">
                      Issued {new Date(rev.issued_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      {rev.snapshot && ` · ${fmtMoney(rev.snapshot.chargeable)} charged`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Details */}
        <div className="card">
          <div className="card-hd"><span className="card-title">Report details</span></div>
          <div className="card-bd">
            <div className="grid2">
              <Field label="Report title">
                <input className="inp" value={form.title} disabled={locked}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Move-out inspection — 820 W 9th St" />
              </Field>
              <Field label="Inspected by">
                <input className="inp" value={form.inspected_by} disabled={locked}
                  onChange={e => setForm(f => ({ ...f, inspected_by: e.target.value }))}
                  placeholder="Your name" />
              </Field>
            </div>
            <div className="grid3">
              <Field label="Occupancy start" hint="Lease start being closed out">
                <input className="inp" type="date" value={form.period_start} disabled={locked}
                  onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
              </Field>
              <Field label="Occupancy end" hint="Move-out date">
                <input className="inp" type="date" value={form.period_end} disabled={locked}
                  onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
              </Field>
              <Field label="Inspection date">
                <input className="inp" type="date" value={form.inspection_date} disabled={locked}
                  onChange={e => setForm(f => ({ ...f, inspection_date: e.target.value }))} />
              </Field>
            </div>
            <div className="grid2">
              <Field label="Deposit settlement due" hint="Most states require 14–30 days">
                <input className="inp" type="date" value={form.response_due_date} disabled={locked}
                  onChange={e => setForm(f => ({ ...f, response_due_date: e.target.value }))} />
              </Field>
              <Field label="Tenant present at walkthrough" hint="Worth recording if charges are disputed">
                <label className="switch-row">
                  <span className="switch">
                    <input type="checkbox" checked={form.tenant_present} disabled={locked}
                      onChange={e => setForm(f => ({ ...f, tenant_present: e.target.checked }))} />
                    <span className="slider" />
                  </span>
                  <span className="switch-label">{form.tenant_present ? 'Yes' : 'No'}</span>
                </label>
              </Field>
            </div>
            <Field label="Summary" hint="Opening paragraph on the report">
              <textarea className="inp" rows={3} value={form.summary} disabled={locked}
                onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
                placeholder="Overall condition, cleaning status, keys returned…" />
            </Field>
            {!locked && (
              <button className="btn-dark" onClick={saveDetails} disabled={busy}>Save details</button>
            )}
          </div>
        </div>

        {/* Leases + tenants */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Leases &amp; tenants</span>
            <span className="card-note">{inspection.parties.length} tenant{inspection.parties.length !== 1 ? 's' : ''} on this report</span>
          </div>
          <div className="card-bd">
            <div className="sub-label">Linked leases</div>
            {inspection.leases.length === 0 ? (
              <div className="muted">No leases linked yet.</div>
            ) : inspection.leases.map(link => (
              <div key={link.id} className="row">
                <div>
                  <div className="row-title">
                    {link.lease
                      ? `${formatLeaseDate(link.lease.start_date)} → ${formatLeaseDate(link.lease.end_date)}`
                      : 'Lease'}
                  </div>
                  <div className="row-sub">
                    {link.lease?.unit_number ? `${link.lease.unit_number} · ` : ''}
                    {inspection.parties.filter(p => p.lease_id === link.lease_id).length} tenant(s)
                  </div>
                </div>
                {!locked && (
                  <button className="btn-link-danger" onClick={() => unlinkLease(link.lease_id)}>Remove</button>
                )}
              </div>
            ))}

            {!locked && linkableLeases.length > 0 && (
              <div className="link-lease">
                <select className="inp" defaultValue="" onChange={e => { if (e.target.value) { linkLease(e.target.value); e.target.value = '' } }}>
                  <option value="">+ Link another lease on this property…</option>
                  {linkableLeases.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.unit_number ? `${l.unit_number} — ` : ''}
                      {formatLeaseDate(l.start_date)} → {formatLeaseDate(l.end_date)}
                      {l.tenants.length ? ` (${l.tenants.map(t => t.name).filter(Boolean).join(', ')})` : ''}
                    </option>
                  ))}
                </select>
                <div className="hint">
                  Room leases and whole-house leases can sit on the same report — link them all so
                  one walkthrough covers the property.
                </div>
              </div>
            )}

            <div className="sub-label" style={{ marginTop: '20px' }}>Tenants &amp; deposits</div>
            {inspection.parties.length === 0 ? (
              <div className="muted">No tenants yet — link a lease or add someone manually.</div>
            ) : (
              <div className="party-table">
                <div className="party-head">
                  <span>Name</span><span>Room / unit</span><span>Deposit held</span><span />
                </div>
                {inspection.parties.map(p => (
                  <PartyRow key={p.id} party={p} locked={locked} onChanged={reload} onFlash={say} />
                ))}
              </div>
            )}

            {!locked && (
              showAddParty ? (
                <div className="inline-form">
                  <input className="inp" placeholder="Name" value={newPartyName} onChange={e => setNewPartyName(e.target.value)} />
                  <input className="inp" placeholder="Email (optional)" value={newPartyEmail} onChange={e => setNewPartyEmail(e.target.value)} />
                  <button className="btn-dark" onClick={handleAddParty} disabled={busy || !newPartyName.trim()}>Add</button>
                  <button className="btn-ghost" onClick={() => setShowAddParty(false)}>Cancel</button>
                </div>
              ) : (
                <button className="btn-ghost" style={{ marginTop: '12px' }} onClick={() => setShowAddParty(true)}>
                  + Add a person not on a lease
                </button>
              )
            )}
          </div>
        </div>

        {/* Findings */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Findings ({inspection.items.length})</span>
            {!locked && (
              <button className="btn-dark-sm" onClick={() => setShowAdd(v => !v)}>
                {showAdd ? 'Cancel' : '+ Add finding'}
              </button>
            )}
          </div>
          <div className="card-bd">
            {showAdd && !locked && (
              <div className="add-panel">
                <div className="grid3">
                  <Field label="Area">
                    <input className="inp" list="ins-areas" value={draft.area ?? ''}
                      onChange={e => setDraft(d => ({ ...d, area: e.target.value }))}
                      placeholder="Front door / entry" />
                    <datalist id="ins-areas">
                      {AREA_SUGGESTIONS.map(a => <option key={a} value={a} />)}
                    </datalist>
                  </Field>
                  <Field label="What was found *">
                    <input className="inp" value={draft.title}
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                      placeholder="Front door lock tampered with" />
                  </Field>
                  <Field label="Cost to remedy">
                    <input className="inp" type="number" min="0" step="0.01" value={draftCost}
                      onChange={e => setDraftCost(e.target.value)} placeholder="300.00" />
                  </Field>
                </div>
                <Field label="Details" hint="What you saw — this prints on the report">
                  <textarea className="inp" rows={2} value={draft.description ?? ''}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                    placeholder="Deep scratches around the cylinder; key no longer turns cleanly. Lock must be replaced." />
                </Field>
                <AllocationPicker
                  inspection={inspection}
                  allocation={draft.allocation}
                  leaseId={draft.allocated_lease_id}
                  partyIds={draft.party_ids}
                  wear={draft.is_wear_and_tear}
                  cost={parseFloat(draftCost) || 0}
                  onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
                />
                <button className="btn-dark" onClick={handleAddItem} disabled={busy}>Add finding</button>
              </div>
            )}

            {inspection.items.length === 0 && !showAdd ? (
              <div className="muted">
                No findings yet. Add one for every issue — each can be charged to everyone, to one
                lease, or to a single tenant.
              </div>
            ) : (
              inspection.items.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  inspection={inspection}
                  locked={locked}
                  onChanged={reload}
                  onFlash={say}
                />
              ))
            )}
          </div>
        </div>

        {/* Late payment charges */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">
              Late payment charges ({inspection.lateFees.filter(f => f.included).length})
            </span>
            {!locked && (
              <button className="btn-ghost" onClick={pullLateFees} disabled={busy}>
                Pull from Payments
              </button>
            )}
          </div>
          <div className="card-bd">
            {inspection.lateFees.length === 0 ? (
              <div className="muted">
                No late payment charges yet. <strong>Pull from Payments</strong> to bring across every
                rent payment that arrived after its due date, with the days late and the fee worked
                out from the plan&apos;s late-fee rule.
              </div>
            ) : (
              totals.perParty.filter(pt => pt.lateFees.length > 0).map(pt => (
                <div key={pt.party.id} className="lf-group">
                  <div className="lf-head">
                    <span className="row-title">{pt.party.name}</span>
                    <span className="lf-total">{fmtMoney(pt.lateFeesTotal)}</span>
                  </div>
                  {pt.lateFees.map(f => (
                    <div key={f.id} className={`lf-row${f.included ? '' : ' is-excluded'}`}>
                      <label className="lf-check">
                        <input
                          type="checkbox"
                          checked={f.included}
                          disabled={locked}
                          onChange={async e => {
                            const { error } = await setLateFeeIncluded(f.id, e.target.checked)
                            if (error) return say(false, 'Could not update that charge.')
                            await afterSettlementChange()
                          }}
                        />
                      </label>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="lf-title">
                          {f.label}
                          <span className={`lf-tag ${f.basis === 'ledger' ? 'lf-tag-ledger' : ''}`}>
                            {f.basis === 'ledger' ? 'charged in Payments' : 'from lease terms'}
                          </span>
                          {!f.is_paid && <span className="lf-tag lf-tag-unpaid">rent unpaid</span>}
                        </div>
                        <div className="lf-why">{explainLateFee(f)}</div>
                        {/* The rent ledger's accrual ignores paid_date, so it
                            often disagrees. Show it rather than hide it. */}
                        {f.ledger_fee_amount != null &&
                         Math.abs(f.ledger_fee_amount - f.fee_amount) >= 0.01 && (
                          <div className="lf-mismatch">
                            Payments shows {fmtMoney(f.ledger_fee_amount)} accrued on this charge.
                            That running total doesn&apos;t account for when rent was actually paid,
                            so this report charges the {fmtMoney(f.fee_amount)} calculated above.
                          </div>
                        )}
                      </div>
                      <div className="lf-amt">{fmtMoney(f.fee_amount)}</div>
                      {!locked && (
                        <button
                          className="btn-link-danger"
                          onClick={async () => {
                            if (!confirm('Remove this late payment charge from the report?')) return
                            const { error } = await removeLateFee(f.id)
                            if (error) return say(false, 'Could not remove.')
                            await afterSettlementChange()
                          }}
                        >Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
            {inspection.lateFees.some(f => !f.included) && (
              <div className="hint" style={{ marginTop: '10px' }}>
                Unticked charges stay on record here but are waived — they don&apos;t appear on the
                tenant&apos;s report or come out of their deposit.
              </div>
            )}
          </div>
        </div>

        {/* Totals */}
        <div className="card">
          <div className="card-hd"><span className="card-title">Running totals</span></div>
          <div className="card-bd">
            {totals.unassigned > 0 && (
              <div className="alert-err" style={{ marginBottom: '14px' }}>
                {fmtMoney(totals.unassigned)} of charges aren&apos;t assigned to anyone — the tenant or
                lease they pointed at is no longer on this report. Fix those findings before finalizing.
              </div>
            )}
            <div className="tot-grid">
              <div className="tot-box">
                <div className="tot-label">Damage</div>
                <div className="tot-val">{fmtMoney(totals.damageTotal)}</div>
              </div>
              <div className="tot-box">
                <div className="tot-label">Late fees</div>
                <div className="tot-val">{fmtMoney(totals.lateFeeTotal)}</div>
              </div>
              <div className="tot-box">
                <div className="tot-label">Deposits held</div>
                <div className="tot-val">{fmtMoney(totals.totalDeposits)}</div>
              </div>
              <div className="tot-box">
                <div className="tot-label">To refund</div>
                <div className="tot-val" style={{ color: '#059669' }}>{fmtMoney(totals.totalRefunds)}</div>
              </div>
            </div>

          </div>
        </div>

        {/* Deposit settlement — one card per person, the whole story */}
        <div className="card">
          <div className="card-hd">
            <span className="card-title">Deposit settlement</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {locked && (
                <button className="btn-send" onClick={() => sendStatements()} disabled={busy}>
                  ✉ Email all statements
                </button>
              )}
              <button className="btn-ghost" onClick={syncContacts} disabled={busy}>
                Sync emails
              </button>
              <button className="btn-ghost" onClick={syncDeposits} disabled={busy}>
                Pull deposits from Payments
              </button>
            </div>
          </div>
          <div className="card-bd">
            {!locked && (
              <div className="lock-note" style={{ marginBottom: '16px' }}>
                Settlement opens once you <strong>finalize</strong> the report. The figures below are
                live previews — check them, then finalize to start tracking refunds.
              </div>
            )}
            {totals.perParty.length === 0 ? (
              <div className="muted">Add tenants to see their deposit settlement.</div>
            ) : totals.perParty.map(pt => (
              <SettlementCard
                key={pt.party.id}
                pt={pt}
                disabled={!locked}
                onChanged={afterSettlementChange}
                onFlash={say}
                onSend={locked ? () => sendStatements([pt.party.id]) : undefined}
                sending={busy}
              />
            ))}
          </div>
        </div>

        <button className="btn-link-danger" style={{ marginTop: '8px' }} onClick={handleDelete} disabled={busy}>
          Delete this inspection
        </button>
      </div>

      {/* ── Statement preview & confirmation ── */}
      {preview && (() => {
        const list = preview.previews
        const current = list[preview.active]
        const sendable = list.filter(p => p.to)
        const missing = list.filter(p => !p.to)
        return (
          <div className="modal-back" onClick={() => !sending && setPreview(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-hd">
                <div>
                  <div className="modal-title">
                    {list.length === 1 ? `Statement for ${list[0].name}` : `${list.length} statements`}
                  </div>
                  <div className="modal-sub">
                    This is exactly what will be sent. Nothing goes out until you confirm.
                  </div>
                </div>
                <button className="modal-x" onClick={() => setPreview(null)} disabled={sending}>×</button>
              </div>

              {list.length > 1 && (
                <div className="modal-tabs">
                  {list.map((p, i) => (
                    <button
                      key={p.partyId}
                      className={`modal-tab${i === preview.active ? ' active' : ''}`}
                      onClick={() => setPreview({ ...preview, active: i })}
                    >
                      {p.name}
                      {!p.to && <span className="modal-tab-warn">no email</span>}
                    </button>
                  ))}
                </div>
              )}

              {current && (
                <div className="modal-meta">
                  <div><span className="modal-meta-k">To</span>{' '}
                    {current.to
                      ? <strong>{current.to}</strong>
                      : <span className="modal-meta-missing">no email on file — will be skipped</span>}
                  </div>
                  <div><span className="modal-meta-k">Subject</span> {current.subject}</div>
                  {current.alreadySent && (
                    <div className="modal-meta-note">
                      This tenant already received a statement — sending again replaces their copy.
                    </div>
                  )}
                </div>
              )}

              <div className="modal-body">
                {current && (
                  <iframe
                    title={`Statement preview for ${current.name}`}
                    srcDoc={current.html}
                    sandbox=""
                    className="modal-frame"
                  />
                )}
              </div>

              <div className="modal-ft">
                <div className="modal-ft-note">
                  {missing.length > 0 && `${missing.length} without an email will be skipped. `}
                  {sendable.length > 0
                    ? `Sending to ${sendable.length} tenant${sendable.length !== 1 ? 's' : ''}.`
                    : 'Nobody here has an email address.'}
                </div>
                <div className="modal-ft-actions">
                  <button className="btn-ghost" onClick={() => setPreview(null)} disabled={sending}>Cancel</button>
                  <button className="btn-dark" onClick={confirmSend} disabled={sending || sendable.length === 0}>
                    {sending
                      ? 'Sending…'
                      : sendable.length === 1
                        ? `Send to ${sendable[0].name}`
                        : `Send ${sendable.length} statements`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="lbl">{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

/** Who pays — the one decision every finding needs. */
function AllocationPicker({
  inspection, allocation, leaseId, partyIds, wear, cost, onChange, disabled,
}: {
  inspection: Inspection
  allocation: Allocation
  leaseId: string | null
  partyIds: string[]
  wear: boolean
  /** Live cost from the form, so the split preview tracks what's typed. */
  cost: number
  disabled?: boolean
  onChange: (patch: Partial<ItemInput>) => void
}) {
  const tenantMode = allocation === 'tenants' || allocation === 'tenant'
  const selected = inspection.parties.filter(p => partyIds.includes(p.id))
  const share = selected.length > 0 ? cost / selected.length : 0

  const toggle = (id: string) => {
    const next = partyIds.includes(id) ? partyIds.filter(x => x !== id) : [...partyIds, id]
    onChange({ party_ids: next })
  }

  return (
    <div className="alloc">
      <div className="grid2">
        <Field label="Charge to">
          <select
            className="inp"
            value={wear ? 'wear' : (tenantMode ? 'tenants' : allocation)}
            disabled={disabled}
            onChange={e => {
              const v = e.target.value
              if (v === 'wear') return onChange({ is_wear_and_tear: true })
              onChange({
                is_wear_and_tear: false,
                allocation: v as Allocation,
                allocated_lease_id: v === 'lease' ? leaseId : null,
                party_ids: v === 'tenants' ? partyIds : [],
              })
            }}
          >
            <option value="all">Everyone on this report (common area)</option>
            <option value="lease">All tenants on one lease</option>
            <option value="tenants">Specific tenant(s)</option>
            <option value="wear">Normal wear &amp; tear — no charge</option>
          </select>
        </Field>

        {!wear && allocation === 'lease' && (
          <Field label="Which lease">
            <select className="inp" value={leaseId ?? ''} disabled={disabled}
              onChange={e => onChange({ allocated_lease_id: e.target.value || null })}>
              <option value="">Select a lease…</option>
              {inspection.leases.map(l => (
                <option key={l.lease_id} value={l.lease_id}>
                  {l.lease?.unit_number || 'Lease'}
                  {l.lease ? ` — ${l.lease.start_date} → ${l.lease.end_date}` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {!wear && tenantMode && (
        <div className="who">
          <div className="who-hd">
            <span className="lbl" style={{ margin: 0 }}>Which tenant(s)</span>
            {inspection.parties.length > 1 && !disabled && (
              <button
                type="button"
                className="who-all"
                onClick={() => onChange({
                  party_ids: partyIds.length === inspection.parties.length
                    ? []
                    : inspection.parties.map(p => p.id),
                })}
              >
                {partyIds.length === inspection.parties.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          <div className="who-grid">
            {inspection.parties.map(p => {
              const on = partyIds.includes(p.id)
              return (
                <label key={p.id} className={`who-chip${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(p.id)} />
                  <span>
                    {p.name}
                    {p.room_label && <span className="who-room">{p.room_label}</span>}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="who-note">
            {selected.length === 0
              ? 'Pick at least one tenant — otherwise this cost has nobody to charge.'
              : selected.length === 1
                ? `Charged in full to ${selected[0].name}.`
                : `${fmtMoney(cost)} split evenly across ${selected.length} tenants — ${fmtMoney(share)} each.`}
          </div>
        </div>
      )}
    </div>
  )
}

function PartyRow({
  party, locked, onChanged, onFlash,
}: {
  party: import('@/lib/inspections').InspectionParty
  locked: boolean
  onChanged: () => Promise<unknown>
  onFlash: (ok: boolean, text: string) => void
}) {
  const [deposit, setDeposit] = useState(String(party.deposit_held ?? 0))
  const [saving, setSaving] = useState(false)

  async function commit() {
    const value = parseFloat(deposit) || 0
    if (value === party.deposit_held) return
    setSaving(true)
    const { error } = await updateParty(party.id, { deposit_held: value })
    setSaving(false)
    if (error) return onFlash(false, 'Could not save that deposit.')
    await onChanged()
  }

  async function remove() {
    if (!confirm(`Remove ${party.name} from this report?`)) return
    const { error } = await removeParty(party.id)
    if (error) return onFlash(false, 'Could not remove that person.')
    await onChanged()
  }

  return (
    <div className="party-row">
      <span>
        <span className="row-title">{party.name}</span>
        {party.email && <span className="row-sub" style={{ display: 'block' }}>{party.email}</span>}
      </span>
      <span className="row-sub">{party.room_label || '—'}</span>
      <span>
        <input
          className="inp inp-sm"
          type="number" min="0" step="0.01"
          value={deposit}
          disabled={locked || saving}
          onChange={e => setDeposit(e.target.value)}
          onBlur={commit}
        />
      </span>
      <span>
        {!locked && <button className="btn-link-danger" onClick={remove}>Remove</button>}
      </span>
    </div>
  )
}

/**
 * One tenant's money, end to end: deposit on file → their own damage → their
 * share of common damage → what to send back, and whether it's been sent.
 */
function SettlementCard({
  pt, disabled, onChanged, onFlash, onSend, sending,
}: {
  pt: PartyTotal
  disabled: boolean
  onChanged: () => Promise<void>
  onFlash: (ok: boolean, text: string) => void
  /** Present once the report is finalized and can be emailed. */
  onSend?: () => void
  sending?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const isRefund = pt.action === 'refund'
  const due = Math.abs(pt.balance)
  const [amount, setAmount] = useState(due.toFixed(2))
  const [when, setWhen] = useState(new Date().toISOString().split('T')[0])
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')

  const settled = pt.party.settlement_status !== 'pending'
  const statusMeta: Record<SettlementStatus, { label: string; cls: string }> = {
    pending:   { label: isRefund ? 'Refund pending' : 'Collection pending', cls: 'pill-draft' },
    returned:  { label: 'Deposit returned', cls: 'pill-final' },
    collected: { label: 'Balance collected', cls: 'pill-final' },
    settled:   { label: 'Nothing to settle', cls: 'pill-none' },
  }
  const meta = pt.action === 'none' && !settled ? statusMeta.settled : statusMeta[pt.party.settlement_status]

  async function record() {
    setSaving(true)
    const { error } = await recordSettlement(pt.party.id, {
      settlement_status: isRefund ? 'returned' : 'collected',
      settled_amount: parseFloat(amount) || 0,
      settled_on: when || null,
      settlement_method: method.trim() || null,
      settlement_note: note.trim() || null,
    })
    setSaving(false)
    if (error) return onFlash(false, 'Could not record that settlement.')
    setOpen(false)
    await onChanged()
    onFlash(true, `${pt.party.name}: ${isRefund ? 'refund' : 'payment'} recorded.`)
  }

  async function undo() {
    if (!confirm(`Mark ${pt.party.name} as unsettled again?`)) return
    const { error } = await clearSettlement(pt.party.id)
    if (error) return onFlash(false, 'Could not undo.')
    await onChanged()
  }

  return (
    <div className={`settle${settled ? ' is-settled' : ''}`}>
      <div className="settle-top">
        <div>
          <div className="settle-name">
            {pt.party.name}
            {pt.party.room_label && <span className="settle-room">{pt.party.room_label}</span>}
          </div>
          {pt.party.email && <div className="row-sub">{pt.party.email}</div>}
        </div>
        <span className={`pill ${meta.cls}`}>{meta.label}</span>
      </div>

      {/* Statement delivery — has this person actually been told? */}
      {onSend && (
        <div className="sent-row">
          {!pt.party.email?.trim() ? (
            <span className="sent-none">No email on file — add one to send their statement.</span>
          ) : pt.party.report_sent_at ? (
            <>
              <span className="sent-ok">
                ✓ Statement emailed {new Date(pt.party.report_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {pt.party.report_sent_to ? ` to ${pt.party.report_sent_to}` : ''}
              </span>
              <button className="lnk-btn" onClick={onSend} disabled={sending}>Resend</button>
            </>
          ) : (
            <>
              <span className="sent-none">Statement not sent yet</span>
              <button className="btn-send-sm" onClick={onSend} disabled={sending}>✉ Send statement</button>
            </>
          )}
        </div>
      )}

      <div className="settle-math">
        <div className="sm-row">
          <span>
            Security deposit on file
            <span className={`src ${pt.party.deposit_source === 'payments' ? 'src-auto' : ''}`}>
              {pt.party.deposit_source === 'payments' ? 'from Payments' : 'manual'}
            </span>
          </span>
          <span className="sm-val">{fmtMoney(pt.depositHeld)}</span>
        </div>
        <div className="sm-row sub">
          <span>Less — damage charged to {pt.party.name.split(' ')[0]} only</span>
          <span className="sm-val neg">{pt.directTotal > 0 ? `− ${fmtMoney(pt.directTotal)}` : '—'}</span>
        </div>
        <div className="sm-row sub">
          <span>Less — share of common / shared damage</span>
          <span className="sm-val neg">{pt.sharedTotal > 0 ? `− ${fmtMoney(pt.sharedTotal)}` : '—'}</span>
        </div>
        <div className="sm-row sub">
          <span>
            Less — late payment charges
            {pt.lateFees.filter(f => f.included).length > 0 &&
              ` (${pt.lateFees.filter(f => f.included).length} payment${pt.lateFees.filter(f => f.included).length !== 1 ? 's' : ''})`}
          </span>
          <span className="sm-val neg">{pt.lateFeesTotal > 0 ? `− ${fmtMoney(pt.lateFeesTotal)}` : '—'}</span>
        </div>
        <div className="sm-row total">
          <span>{isRefund ? 'To send back' : pt.action === 'collect' ? 'Tenant still owes' : 'Nothing to send'}</span>
          <span className="sm-val" style={{ color: isRefund ? '#059669' : pt.action === 'collect' ? '#dc2626' : '#64748b' }}>
            {fmtMoney(due)}
          </span>
        </div>
      </div>

      {settled ? (
        <div className="settle-done">
          {pt.party.settlement_status === 'returned' ? 'Returned' : 'Collected'}{' '}
          {pt.party.settled_amount != null && <strong>{fmtMoney(pt.party.settled_amount)}</strong>}
          {pt.party.settled_on && ` on ${new Date(pt.party.settled_on + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
          {pt.party.settlement_method && ` · ${pt.party.settlement_method}`}
          {pt.party.settlement_note && <div className="row-sub" style={{ marginTop: 3 }}>{pt.party.settlement_note}</div>}
          {!disabled && <button className="btn-link-danger" style={{ marginLeft: 10 }} onClick={undo}>Undo</button>}
        </div>
      ) : pt.action === 'none' ? (
        <div className="settle-done">Charges exactly matched the deposit — nothing to send or collect.</div>
      ) : disabled ? null : open ? (
        <div className="settle-form">
          <div className="grid3">
            <Field label={isRefund ? 'Amount returned' : 'Amount collected'}>
              <input className="inp" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
            </Field>
            <Field label="Date">
              <input className="inp" type="date" value={when} onChange={e => setWhen(e.target.value)} />
            </Field>
            <Field label="Method" hint="Zelle, check #, Venmo…">
              <input className="inp" value={method} onChange={e => setMethod(e.target.value)} placeholder="Zelle" />
            </Field>
          </div>
          <Field label="Note (optional)">
            <input className="inp" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Partial refund agreed by email 08/09" />
          </Field>
          <div className="item-actions">
            <button className="btn-dark" onClick={record} disabled={saving}>
              {saving ? 'Saving…' : isRefund ? 'Confirm refund sent' : 'Confirm payment received'}
            </button>
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn-dark-sm" onClick={() => { setAmount(due.toFixed(2)); setOpen(true) }}>
          {isRefund ? 'Mark deposit returned' : 'Mark balance collected'}
        </button>
      )}
    </div>
  )
}

function ItemCard({
  item, inspection, locked, onChanged, onFlash,
}: {
  item: InspectionItem
  inspection: Inspection
  locked: boolean
  onChanged: () => Promise<unknown>
  onFlash: (ok: boolean, text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [draft, setDraft] = useState<ItemInput>({
    area: item.area, title: item.title, description: item.description, notes: item.notes,
    cost: item.cost, is_wear_and_tear: item.is_wear_and_tear, allocation: item.allocation,
    allocated_lease_id: item.allocated_lease_id, party_ids: item.party_ids ?? [],
  })
  const [cost, setCost] = useState(String(item.cost))

  const namedParties = inspection.parties.filter(p => (item.party_ids ?? []).includes(p.id))
  const chargeLabel = item.is_wear_and_tear
    ? 'Wear & tear — no charge'
    : (item.allocation === 'tenants' || item.allocation === 'tenant')
      ? namedParties.length === 0
        ? '⚠ no tenant selected'
        : namedParties.length === 1
          ? namedParties[0].name
          : `Split: ${namedParties.map(p => p.name.split(' ')[0]).join(', ')} (${fmtMoney(item.cost / namedParties.length)} each)`
      : item.allocation === 'lease'
        ? `Lease split (${inspection.parties.filter(p => p.lease_id === item.allocated_lease_id).length})`
        : `Everyone (${inspection.parties.length})`

  async function save() {
    if (!draft.is_wear_and_tear && draft.allocation === 'tenants' && draft.party_ids.length === 0) {
      return onFlash(false, 'Select at least one tenant to charge, or change who it goes to.')
    }
    setSaving(true)
    const { error } = await updateItem(item.id, { ...draft, cost: parseFloat(cost) || 0 })
    setSaving(false)
    if (error) return onFlash(false, 'Could not save that finding.')
    await onChanged()
    onFlash(true, 'Finding updated.')
    setOpen(false)
  }

  async function destroy() {
    if (!confirm('Delete this finding?')) return
    const { error } = await removeItem(item.id)
    if (error) return onFlash(false, 'Could not delete.')
    await onChanged()
  }

  /**
   * `files` must already be a real array. A FileList is live: the caller resets
   * the input straight after this returns, which empties the list — if we read
   * it after an await, every upload silently becomes a no-op.
   */
  async function upload(files: File[]) {
    if (files.length === 0) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { onFlash(false, 'Your session expired — sign in again to upload.'); return }

    setUploading(true)
    let pos = item.photos.length
    let uploaded = 0
    for (const file of files) {
      const { error } = await uploadItemPhoto(file, user.id, inspection.id, item.id, pos++)
      if (error) {
        // Surface what storage actually said — "upload failed" alone is useless.
        const msg = (error as { message?: string })?.message || 'unknown error'
        onFlash(false, `Could not upload ${file.name}: ${msg}`)
        break
      }
      uploaded++
    }
    setUploading(false)
    if (uploaded > 0) {
      await onChanged()
      onFlash(true, `${uploaded} photo${uploaded !== 1 ? 's' : ''} added.`)
    }
  }

  return (
    <div className="item">
      <div className="item-head" onClick={() => !locked && setOpen(o => !o)} style={{ cursor: locked ? 'default' : 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-title">
            {item.area && <span className="area-tag">{item.area}</span>}
            {item.title}
          </div>
          <div className="item-sub">
            {chargeLabel}
            {item.photos.length > 0 && ` · ${item.photos.length} photo${item.photos.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <div className={`item-cost${item.is_wear_and_tear ? ' wear' : ''}`}>
          {item.is_wear_and_tear ? '—' : fmtMoney(item.cost)}
        </div>
        {!locked && <span className="chev">{open ? '▲' : '▼'}</span>}
      </div>

      {item.photos.length > 0 && (
        <div className="thumbs">
          {item.photos.map(ph => (
            <div key={ph.id} className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ph.url} alt={ph.caption || item.title} />
              {!locked && (
                <button
                  className="thumb-x"
                  onClick={async () => {
                    if (!confirm('Delete this photo?')) return
                    await removePhoto(ph)
                    await onChanged()
                  }}
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && !locked && (
        <div className="item-edit">
          <div className="grid3">
            <Field label="Area">
              <input className="inp" list="ins-areas" value={draft.area ?? ''}
                onChange={e => setDraft(d => ({ ...d, area: e.target.value }))} />
            </Field>
            <Field label="What was found">
              <input className="inp" value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            </Field>
            <Field label="Cost to remedy">
              <input className="inp" type="number" min="0" step="0.01" value={cost}
                onChange={e => setCost(e.target.value)} />
            </Field>
          </div>
          <Field label="Details">
            <textarea className="inp" rows={2} value={draft.description ?? ''}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
          </Field>
          <Field label="Internal notes" hint="Quote reference, vendor, follow-up — also prints on the report">
            <textarea className="inp" rows={2} value={draft.notes ?? ''}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              placeholder="Quote from Tempe Lock & Key, 08/06" />
          </Field>
          <AllocationPicker
            inspection={inspection}
            allocation={draft.allocation}
            leaseId={draft.allocated_lease_id}
            partyIds={draft.party_ids}
            wear={draft.is_wear_and_tear}
            cost={parseFloat(cost) || 0}
            onChange={patch => setDraft(d => ({ ...d, ...patch }))}
          />
          <div className="item-actions">
            <button className="btn-dark" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save finding'}
            </button>
            <label className="btn-ghost" style={{ cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : '+ Photos'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/avif,image/*"
                multiple
                hidden
                disabled={uploading}
                onChange={e => {
                  // Snapshot synchronously — resetting the input clears the list.
                  const picked = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  upload(picked)
                }}
              />
            </label>
            <button className="btn-link-danger" onClick={destroy}>Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .ins-wrap { max-width: 900px; margin: 0 auto; padding: 30px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .ins-crumb { font-size: 13px; color: #64748b; margin-bottom: 16px; }
  .ins-crumb a { color: #10b981; text-decoration: none; }
  .ins-crumb a:hover { text-decoration: underline; }

  .ins-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .ins-title { font-size: 23px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .ins-sub { font-size: 13px; color: #64748b; margin-top: 3px; }
  .ins-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }

  .pill { font-size: 11px; font-weight: 700; padding: 4px 11px; border-radius: 20px; }
  .pill-draft { background: #fef3c7; color: #92400e; }
  .pill-final { background: #d1fae5; color: #065f46; }
  .pill-none { background: #f1f5f9; color: #64748b; }

  /* Journey strip */
  .journey { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
  .jstep { display: flex; align-items: center; gap: 10px; position: relative; padding-right: 14px; }
  .jdot { width: 24px; height: 24px; border-radius: 50%; background: #f1f5f9; color: #94a3b8; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; z-index: 1; }
  .jstep.active .jdot { background: #0f172a; color: #34d399; }
  .jstep.done .jdot { background: #d1fae5; color: #065f46; }
  .jlabel { font-size: 13px; font-weight: 600; color: #94a3b8; }
  .jstep.active .jlabel, .jstep.done .jlabel { color: #0f172a; }
  .jnote { font-size: 11px; color: #94a3b8; margin-top: 1px; }
  .jline { position: absolute; left: 24px; right: 0; top: 12px; height: 2px; background: #f1f5f9; z-index: 0; }
  .jstep.done .jline { background: #a7f3d0; }

  /* Settlement */
  .settle { border: 1.5px solid #e2e8f0; border-radius: 11px; padding: 15px 16px; margin-bottom: 12px; }
  .settle.is-settled { background: #f8fdfb; border-color: #a7f3d0; }
  .settle-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .settle-name { font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .settle-room { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #eef2f7; color: #64748b; padding: 2px 7px; border-radius: 5px; }
  .settle-math { border: 1px solid #eef2f7; border-radius: 9px; overflow: hidden; margin-bottom: 12px; }
  .sm-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 9px 12px; font-size: 13px; color: #334155; }
  .sm-row.sub { background: #fafbfc; color: #64748b; font-size: 12.5px; border-top: 1px solid #f1f5f9; }
  .sm-row.total { border-top: 1.5px solid #e2e8f0; background: #fff; font-weight: 700; font-size: 14px; color: #0f172a; }
  .sm-val { font-weight: 600; white-space: nowrap; }
  .sm-val.neg { color: #b45309; font-weight: 500; }
  .sm-row.total .sm-val { font-size: 16px; font-weight: 700; }
  .src { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #f1f5f9; color: #94a3b8; padding: 2px 6px; border-radius: 4px; margin-left: 7px; }
  .src-auto { background: #ecfdf5; color: #059669; }
  .settle-form { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9px; padding: 14px; }
  .sent-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; background: #fafbfc; border: 1px solid #eef2f7; border-radius: 8px; padding: 8px 11px; margin-bottom: 12px; }
  .sent-ok { font-size: 11.5px; color: #059669; font-weight: 600; }
  .sent-none { font-size: 11.5px; color: #94a3b8; }
  .btn-send { background: #fff; color: #0f172a; border: 1.5px solid #0f172a; border-radius: 8px; padding: 9px 15px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-send:hover:not(:disabled) { background: #0f172a; color: #34d399; }
  .btn-send:disabled { opacity: .5; cursor: not-allowed; }
  .btn-send-sm { background: #0f172a; color: #34d399; border: none; border-radius: 7px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-send-sm:disabled { opacity: .5; cursor: not-allowed; }
  .lnk-btn { background: none; border: none; color: #10b981; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .lnk-btn:hover { text-decoration: underline; }
  .settle-done { font-size: 12.5px; color: #065f46; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-dark:hover:not(:disabled) { background: #1e293b; }
  .btn-dark:disabled { opacity: .5; cursor: not-allowed; }
  .btn-dark-sm { background: #0f172a; color: #34d399; border: none; border-radius: 7px; padding: 6px 13px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-ghost { background: #fff; color: #475569; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 15px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
  .btn-ghost:hover { border-color: #94a3b8; }
  .btn-link-danger { background: none; border: none; color: #dc2626; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 2px 0; }
  .btn-link-danger:hover { text-decoration: underline; }

  .alert-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }
  .alert-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px; padding: 10px 14px; font-size: 13px; margin-bottom: 14px; }
  .lock-note { background: #f0f9ff; border: 1px solid #bae6fd; color: #075985; border-radius: 8px; padding: 11px 14px; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }
  .revise-note { background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; color: #92400e; border-radius: 8px; padding: 11px 14px; font-size: 13px; margin-bottom: 16px; line-height: 1.55; }
  .alert-warn { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 8px; padding: 11px 14px; font-size: 13px; margin-bottom: 14px; line-height: 1.5; }

  .rev-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f8fafc; }
  .rev-row:last-child { border-bottom: none; }
  .rev-badge { font-size: 11px; font-weight: 700; background: #f1f5f9; color: #64748b; padding: 3px 9px; border-radius: 6px; flex-shrink: 0; }
  .rev-badge.current { background: #d1fae5; color: #065f46; }
  .rev-note { font-weight: 400; color: #64748b; }

  .card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
  .card-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; }
  .card-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px; }
  .card-note { font-size: 12px; color: #94a3b8; }
  .card-bd { padding: 18px; }

  .field { margin-bottom: 14px; }
  .lbl { display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
  .inp { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; color: #0f172a; font-family: inherit; background: #fff; outline: none; }
  .inp:focus { border-color: #10b981; }
  .inp:disabled { background: #f8fafc; color: #64748b; }
  .inp-sm { padding: 6px 9px; font-size: 13px; max-width: 120px; }
  textarea.inp { resize: vertical; line-height: 1.55; }
  .hint { font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.45; }
  .muted { font-size: 13px; color: #94a3b8; }
  .sub-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 9px; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }

  .switch-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
  .switch { position: relative; width: 42px; height: 23px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider { position: absolute; inset: 0; background: #e2e8f0; border-radius: 24px; cursor: pointer; transition: background .2s; }
  .slider::before { content: ''; position: absolute; width: 17px; height: 17px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; }
  .switch input:checked + .slider { background: #10b981; }
  .switch input:checked + .slider::before { transform: translateX(19px); }
  .switch-label { font-size: 13px; color: #334155; }

  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .row:last-of-type { border-bottom: none; }
  .row-title { font-size: 13.5px; font-weight: 600; color: #0f172a; }
  .row-sub { font-size: 11.5px; color: #94a3b8; }

  .link-lease { margin-top: 12px; }
  .inline-form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
  .inline-form .inp { flex: 1; min-width: 150px; }

  .party-table { border: 1px solid #eef2f7; border-radius: 9px; overflow: hidden; }
  .party-head, .party-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; align-items: center; padding: 9px 12px; }
  .party-head { background: #f8fafc; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
  .party-row { border-top: 1px solid #f1f5f9; font-size: 13px; }

  .add-panel { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 18px; }
  .alloc { background: #fff; border: 1px solid #eef2f7; border-radius: 9px; padding: 12px 13px; margin-bottom: 14px; }
  .who { border-top: 1px solid #f1f5f9; margin-top: 4px; padding-top: 12px; }
  .who-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .who-all { background: none; border: none; color: #10b981; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .who-all:hover { text-decoration: underline; }
  .who-grid { display: flex; flex-wrap: wrap; gap: 7px; }
  .who-chip { display: inline-flex; align-items: center; gap: 7px; border: 1.5px solid #e2e8f0; border-radius: 20px; padding: 6px 12px; font-size: 13px; color: #334155; cursor: pointer; background: #fff; transition: border-color .12s, background .12s; }
  .who-chip:hover { border-color: #cbd5e1; }
  .who-chip.on { border-color: #10b981; background: #ecfdf5; color: #065f46; font-weight: 600; }
  .who-chip input { accent-color: #10b981; cursor: pointer; }
  .who-room { font-size: 10px; color: #94a3b8; margin-left: 5px; font-weight: 500; }
  .who-note { font-size: 11.5px; color: #64748b; margin-top: 9px; line-height: 1.45; }

  .item { border: 1px solid #eef2f7; border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
  .item-head { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
  .item-title { font-size: 14px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .area-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #eef2f7; color: #64748b; padding: 2px 7px; border-radius: 5px; }
  .item-sub { font-size: 11.5px; color: #94a3b8; margin-top: 3px; }
  .item-cost { font-size: 15px; font-weight: 700; color: #0f172a; white-space: nowrap; }
  .item-cost.wear { color: #cbd5e1; font-weight: 500; }
  .chev { font-size: 9px; color: #cbd5e1; }
  .item-edit { border-top: 1px solid #f1f5f9; background: #fafbfc; padding: 16px 14px; }
  .item-actions { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }

  .thumbs { display: flex; gap: 7px; padding: 0 14px 12px; flex-wrap: wrap; }
  .thumb { position: relative; }
  .thumb img { width: 84px; height: 62px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; display: block; }
  .thumb-x { position: absolute; top: -6px; right: -6px; width: 19px; height: 19px; border-radius: 50%; background: #0f172a; color: #fff; border: none; font-size: 12px; line-height: 1; cursor: pointer; }

  /* Late payment charges */
  .lf-group { border: 1px solid #eef2f7; border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
  .lf-head { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 9px 13px; border-bottom: 1px solid #eef2f7; }
  .lf-total { font-size: 14px; font-weight: 700; color: #b45309; }
  .lf-row { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border-top: 1px solid #f8fafc; }
  .lf-row:first-of-type { border-top: none; }
  .lf-row.is-excluded { opacity: 0.5; }
  .lf-row.is-excluded .lf-amt { text-decoration: line-through; }
  .lf-check { padding-top: 2px; }
  .lf-title { font-size: 13.5px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .lf-tag { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; background: #eef2f7; color: #64748b; padding: 2px 6px; border-radius: 4px; }
  .lf-tag-ledger { background: #ecfdf5; color: #059669; }
  .lf-tag-unpaid { background: #fef2f2; color: #b91c1c; }
  .lf-why { font-size: 11.5px; color: #94a3b8; line-height: 1.5; margin-top: 3px; }
  .lf-mismatch { font-size: 11px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 9px; line-height: 1.5; margin-top: 5px; }
  .lf-amt { font-size: 14px; font-weight: 700; color: #0f172a; white-space: nowrap; }

  /* Statement preview modal */
  .modal-back { position: fixed; inset: 0; background: rgba(15,23,42,0.55); z-index: 400; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .modal { background: #fff; border-radius: 14px; width: 100%; max-width: 680px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(15,23,42,0.3); }
  .modal-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid #f1f5f9; }
  .modal-title { font-size: 16px; font-weight: 700; color: #0f172a; }
  .modal-sub { font-size: 12px; color: #94a3b8; margin-top: 3px; line-height: 1.5; }
  .modal-x { background: none; border: none; font-size: 22px; line-height: 1; color: #94a3b8; cursor: pointer; padding: 0 4px; }
  .modal-x:hover { color: #0f172a; }
  .modal-tabs { display: flex; gap: 4px; padding: 10px 20px 0; overflow-x: auto; border-bottom: 1px solid #f1f5f9; }
  .modal-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 7px 11px; font-size: 12.5px; font-weight: 500; color: #64748b; cursor: pointer; font-family: inherit; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  .modal-tab.active { color: #0f172a; font-weight: 700; border-bottom-color: #0f172a; }
  .modal-tab-warn { font-size: 9px; font-weight: 700; text-transform: uppercase; background: #fef3c7; color: #92400e; padding: 1px 5px; border-radius: 4px; }
  .modal-meta { padding: 13px 20px; background: #fafbfc; border-bottom: 1px solid #f1f5f9; font-size: 12.5px; color: #334155; line-height: 1.75; }
  .modal-meta-k { display: inline-block; min-width: 52px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
  .modal-meta-missing { color: #b45309; font-weight: 600; }
  .modal-meta-note { margin-top: 5px; font-size: 11.5px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px 9px; }
  .modal-body { flex: 1; overflow: auto; background: #f1f5f9; min-height: 220px; }
  .modal-frame { width: 100%; height: 460px; border: none; display: block; background: #f1f5f9; }
  .modal-ft { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; border-top: 1px solid #f1f5f9; flex-wrap: wrap; }
  .modal-ft-note { font-size: 12px; color: #64748b; }
  .modal-ft-actions { display: flex; gap: 9px; }

  @media (max-width: 640px) {
    .modal-back { padding: 0; }
    .modal { max-height: 100vh; border-radius: 0; }
    .modal-frame { height: 340px; }
  }

  .share-row { display: flex; gap: 8px; align-items: center; }
  .share-row .inp { font-size: 12.5px; color: #64748b; }
  .share-person { display: flex; align-items: center; gap: 8px; padding: 9px 0; border-top: 1px solid #f1f5f9; }
  .share-person:first-of-type { border-top: none; }
  .share-person-main { flex: 1; min-width: 0; }

  .tot-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .tot-box { border: 1px solid #eef2f7; background: #fafbfc; border-radius: 9px; padding: 12px 13px; }
  .tot-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 4px; }
  .tot-val { font-size: 17px; font-weight: 700; color: #0f172a; }
  .muted-val { color: #cbd5e1; }

  @media (max-width: 700px) {
    .grid2, .grid3, .tot-grid { grid-template-columns: 1fr; }
    .party-head, .party-row { grid-template-columns: 1.6fr 1fr 1fr; }
    .party-head span:nth-child(4), .party-row span:nth-child(4) { grid-column: 1 / -1; }
  }
`
