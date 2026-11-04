'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import AmendmentDocumentView from './AmendmentDocument'
import {
  STATUS_META, KIND_META, PHASE_META, amendmentPhase, nextAction, sortAmendments,
  signatureOf, fmtShortDate, fmtLegalDate, fmtDollars, signingToday, monthName,
  buildPetAdditionDocument, type LeaseAmendment, type AmendmentDocument,
} from '@/lib/leaseAmendments'

type Send = {
  id: string
  amendment_id: string
  kind: 'request' | 'reminder' | 'signed' | 'landlord'
  recipient: string
  subject: string | null
  sent_at: string
}

type Tenant = { id: string; name: string | null; email: string | null }

/**
 * The Amendments tab of the lease hub.
 *
 * It belongs here and not in Financials, which is the call worth explaining:
 * a pet addendum obviously involves money, and this codebase has a standing
 * rule that money lives in Financials (see the Lease Hub IA note). But the
 * amendment is not the money. It is the *agreement* that gives rise to the
 * money — tenancy paperwork, alongside the lease documents and the move-out
 * report — and the $65 itself still lands in Financials as a line item like
 * every other charge. Putting the document here and the charge there keeps
 * both rules intact, which is why the signed row carries an explicit "now go
 * add the charge" instruction rather than quietly creating one.
 *
 * The tab is built around one honest fact: an unsigned amendment changes
 * nothing. So the list leads with whether it has been signed, the chase
 * history is on the page rather than in the landlord's memory, and a signed
 * amendment with an uncollected charge is the loudest thing on it.
 */
export default function AmendmentsTab({
  leaseId,
  tenants,
  isDemo,
  /** The lease's own term, for the effective-date hint. */
  leaseStart,
  leaseEnd,
  landlordName,
  propertyAddress,
  unitNumber,
}: {
  leaseId: string
  tenants: Tenant[]
  isDemo: boolean
  leaseStart: string
  leaseEnd: string
  landlordName: string | null
  propertyAddress: string
  unitNumber: string | null
}) {
  const [rows, setRows] = useState<LeaseAmendment[]>([])
  const [sends, setSends] = useState<Send[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [composing, setComposing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch(`/api/lease-amendments?lease_id=${leaseId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Could not load amendments.'); setLoading(false); return }
    setRows(json.amendments ?? [])
    setSends(json.sends ?? [])
    setLoading(false)
  }, [leaseId])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => sortAmendments(rows), [rows])

  /** Signed, carrying money, and nobody has billed it. The money at risk. */
  const unbilled = useMemo(
    () => sorted.filter(a =>
      a.status === 'signed' && !a.billed_at &&
      (a.monthly_charge > 0 || a.deposit_amount > 0 || a.one_time_fee_amount > 0)
    ),
    [sorted]
  )
  /** Signed, but the document's own condition has not been met yet. */
  const awaitingConsent = useMemo(
    () => sorted.filter(a => amendmentPhase(a) === 'conditional'),
    [sorted]
  )
  const uncollected = useMemo(
    () => unbilled.reduce(
      (s, a) => s + a.monthly_charge + a.deposit_amount + a.one_time_fee_amount, 0),
    [unbilled]
  )

  async function act(id: string, action: string, label: string) {
    setBusy(id); setErr(''); setFlash('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setBusy(null); return }
    const res = await fetch('/api/lease-amendments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id, action }),
    })
    const json = await res.json()
    setBusy(null)
    if (!res.ok) { setErr(json.error || 'That did not work.'); return }
    setFlash(label)
    load()
  }

  async function remind(id: string) {
    setBusy(id); setErr(''); setFlash('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setBusy(null); return }
    const res = await fetch('/api/lease-amendments/remind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id }),
    })
    const json = await res.json()
    setBusy(null)
    if (!res.ok) { setErr(json.error || 'Could not send the reminder.'); return }
    setFlash(`Reminder sent to ${json.sentTo}.`)
    load()
  }

  if (loading) return <div className="empty-inline">Loading amendments…</div>

  return (
    <>
      <style>{CSS}</style>

      {err && <div className="alert-err">{err}</div>}
      {flash && <div className="am-ok">{flash}</div>}

      {/* The money nobody is collecting. Above the list, because a signed
          addendum with no line item is the one failure mode of this feature
          that costs real dollars every month in silence. */}
      {/* The condition the document itself imposes, above the money. Approval
          is not effective until the other tenants consent in writing, so a
          landlord who bills before that is charging for something they have
          not yet granted. */}
      {awaitingConsent.length > 0 && (
        <div className="action bad" style={{ marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="action-title">
              {awaitingConsent.length === 1
                ? `Signed, but you still need the other tenants’ written consent`
                : `${awaitingConsent.length} signed amendments are waiting on housemate consent`}
            </div>
            <div className="action-body">
              The document says your approval isn&apos;t effective until every other tenant at the
              property has consented in writing. Collect those first, then mark them received
              below — and hold off billing until you have.
            </div>
          </div>
        </div>
      )}

      {unbilled.length > 0 && (
        <div className="action warn" style={{ marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="action-title">
              {unbilled.length === 1
                ? `${fmtDollars(uncollected)} agreed and not yet on the ledger`
                : `${unbilled.length} signed amendments are not on the ledger yet`}
            </div>
            <div className="action-body">
              Signing a document doesn&apos;t charge anybody. Add the monthly amount as a line item
              on the tenant&apos;s share, and anything due on signing as a one-off charge, then
              mark it below so this stops nagging.
            </div>
          </div>
          <a className="btn-ghost" href={`/landlord/financials?lease=${leaseId}`}>Open Financials →</a>
        </div>
      )}

      <div className="card">
        <div className="card-hd">
          <span className="card-title">Lease amendments</span>
          {!composing && (
            <button
              className="btn-dark-sm"
              onClick={() => { setComposing(true); setErr(''); setFlash('') }}
              disabled={isDemo}
              title={isDemo ? 'A demo lease has no real tenant to send to.' : undefined}
            >
              + Pet addendum
            </button>
          )}
        </div>
        <div className="card-bd">
          {isDemo && (
            <div className="hint" style={{ marginBottom: 12 }}>
              This is a demo lease, so there is nobody to send an amendment to.
            </div>
          )}

          {composing && (
            <PetAddendumForm
              leaseId={leaseId}
              tenants={tenants}
              leaseStart={leaseStart}
              leaseEnd={leaseEnd}
              landlordName={landlordName}
              propertyAddress={propertyAddress}
              unitNumber={unitNumber}
              onCancel={() => setComposing(false)}
              onSent={(to) => { setComposing(false); setFlash(`Sent to ${to} for signature.`); load() }}
            />
          )}

          {sorted.length === 0 && !composing && (
            <div className="empty-inline">
              No amendments on this lease. An amendment is how you change one thing mid-tenancy —
              adding a pet, say — in writing and with a signature on it, without touching the rest
              of the lease.
            </div>
          )}

          {sorted.map(a => {
            const meta = STATUS_META[a.status]
            const action = nextAction(a)
            const phase = amendmentPhase(a)
            const mySends = sends.filter(s => s.amendment_id === a.id)
            const reminders = mySends.filter(s => s.kind === 'reminder').length
            const isOpen = open === a.id

            return (
              <div key={a.id} className="am-row">
                <div className="am-hd">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="am-title">
                      {a.title}
                      <span
                        className="am-chip"
                        style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
                      >
                        {meta.label}
                      </span>
                      {(phase === 'pending' || phase === 'conditional' || phase === 'expired') && (
                        <span className="am-chip soft">
                          {phase === 'pending'
                            ? `Starts ${fmtShortDate(a.effective_date)}`
                            : PHASE_META[phase].label}
                        </span>
                      )}
                    </div>
                    <div className="am-sub">
                      {KIND_META[a.kind]?.label ?? a.kind} · {a.tenant_name || a.tenant_email}
                      {a.monthly_charge > 0 && <> · {fmtDollars(a.monthly_charge)}/mo</>}
                      {a.deposit_amount + a.one_time_fee_amount > 0 && (
                        <> · {fmtDollars(a.deposit_amount + a.one_time_fee_amount)} on signing</>
                      )}
                      {' · '}effective {fmtShortDate(a.effective_date)}
                      {a.respond_by && a.status === 'sent' && <> · sign by {fmtShortDate(a.respond_by)}</>}
                    </div>
                  </div>
                  <button className="lnk-btn" onClick={() => setOpen(isOpen ? null : a.id)}>
                    {isOpen ? 'Hide document' : 'View document'}
                  </button>
                </div>

                {/* What to do about it, in one line. `bill` is the only one
                    that is really a task; the rest are status told honestly. */}
                <div className={`am-act${action.kind === 'bill' ? ' bill' : ''}${action.kind === 'consent' || action.kind === 'expired' ? ' stop' : ''}`}>
                  <div>
                    <div className="am-act-t">{action.label}</div>
                    <div className="am-act-b">{action.detail}</div>
                  </div>
                </div>

                {a.status === 'signed' && (
                  <div className="am-signed">
                    <span className="am-signed-name">{a.signature_name}</span>
                    <span className="am-signed-meta">
                      signed electronically on {fmtLegalDate(a.signature_date)}
                      {a.signed_at && ` at ${new Date(a.signed_at).toLocaleTimeString('en-US', {
                        hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix',
                      })} MST`}
                    </span>
                  </div>
                )}

                {a.status === 'declined' && a.decline_reason && (
                  <div className="am-quote">
                    <div className="am-quote-k">What they said</div>
                    {a.decline_reason}
                  </div>
                )}

                {/* The chase history. On the page rather than in the
                    landlord's head — the whole reason `lease_amendment_sends`
                    exists is so "have I reminded her?" has an answer. */}
                {mySends.length > 0 && (
                  <details className="am-log">
                    <summary>
                      {mySends.length} email{mySends.length === 1 ? '' : 's'} sent
                      {reminders > 0 && ` · ${reminders} reminder${reminders === 1 ? '' : 's'}`}
                    </summary>
                    {mySends.map(s => (
                      <div key={s.id} className="am-log-row">
                        <span className="am-log-kind">{SEND_LABEL[s.kind]}</span>
                        <span className="am-log-to">{s.recipient}</span>
                        <span className="am-log-at">
                          {new Date(s.sent_at).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                            timeZone: 'America/Phoenix',
                          })}
                        </span>
                      </div>
                    ))}
                  </details>
                )}

                <div className="am-btns">
                  {a.status === 'sent' && (
                    <>
                      <button className="btn-ghost" disabled={busy === a.id} onClick={() => remind(a.id)}>
                        {busy === a.id ? 'Sending…' : 'Send a reminder'}
                      </button>
                      <button
                        className="btn-danger-sm"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, 'withdraw', 'Withdrawn. The lease is unchanged.')}
                      >
                        Withdraw
                      </button>
                    </>
                  )}
                  {a.status === 'signed' && a.document?.requiresCotenantConsent && !a.cotenant_consents_at && (
                    <button
                      className="btn-dark-sm"
                      disabled={busy === a.id}
                      onClick={() => act(a.id, 'mark_consents', 'Consents recorded. The approval is now effective.')}
                    >
                      I have the housemates&apos; consent
                    </button>
                  )}
                  {a.cotenant_consents_at && (
                    <span className="am-billed">
                      Consents received {fmtShortDate(a.cotenant_consents_at.slice(0, 10))}
                      <button className="lnk-btn" onClick={() => act(a.id, 'unmark_consents', 'Unmarked.')}>
                        undo
                      </button>
                    </span>
                  )}
                  {/* Billing is offered only once the approval is actually
                      effective. Showing it beside an outstanding condition
                      would invite a landlord to charge for something the
                      document says has not been granted yet. */}
                  {a.status === 'signed' && phase !== 'conditional' && !a.billed_at &&
                   (a.monthly_charge > 0 || a.deposit_amount > 0 || a.one_time_fee_amount > 0) && (
                    <button
                      className="btn-dark-sm"
                      disabled={busy === a.id}
                      onClick={() => act(a.id, 'mark_billed', 'Marked as billed.')}
                    >
                      I&apos;ve added the charges
                    </button>
                  )}
                  {a.billed_at && (
                    <span className="am-billed">
                      Charges added {fmtShortDate(a.billed_at.slice(0, 10))}
                      <button className="lnk-btn" onClick={() => act(a.id, 'unmark_billed', 'Unmarked.')}>
                        undo
                      </button>
                    </span>
                  )}
                </div>

                {isOpen && (
                  <div className="am-doc-wrap">
                    <AmendmentDocumentView
                      doc={a.document as AmendmentDocument}
                      signature={signatureOf(a)}
                    />
                    <div className="am-print">
                      <button className="btn-ghost" onClick={() => window.print()}>Print / save as PDF</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

const SEND_LABEL: Record<Send['kind'], string> = {
  request: 'Sent for signature',
  reminder: 'Reminder',
  signed: 'Signed copy to tenant',
  landlord: 'Notified you',
}

// ── The form ─────────────────────────────────────────────────────────────────

/**
 * Drawing up a pet addendum.
 *
 * The preview is the point of this form, not a nicety. The landlord is about to
 * email a contract to a tenant under their own name, and the single worst thing
 * this product could do is let them send wording they have not read. So the
 * document is built client-side from the same pure function the server uses,
 * shown in full, and only then sent — and the server rebuilds it from the
 * fields rather than trusting the preview, so the two cannot be made to differ
 * by a crafted request.
 */
function PetAddendumForm({
  leaseId, tenants, leaseStart, leaseEnd, landlordName, propertyAddress, unitNumber,
  onCancel, onSent,
}: {
  leaseId: string
  tenants: Tenant[]
  leaseStart: string
  leaseEnd: string
  landlordName: string | null
  propertyAddress: string
  unitNumber: string | null
  onCancel: () => void
  onSent: (to: string) => void
}) {
  const withEmail = tenants.filter(t => !!t.email?.trim())
  const [tenantId, setTenantId] = useState(withEmail[0]?.id ?? '')
  // The first of next month, which is when a monthly charge sensibly starts —
  // mid-month pet rent is a proration argument nobody wants.
  const [effective, setEffective] = useState(firstOfNextMonth())
  // A fortnight to sign. Long enough that a student who goes home for the
  // weekend does not lose the offer; short enough that an unanswered document
  // does not sit open for a term, which is how a landlord ends up unsure
  // whether a pet is approved.
  const [respondBy, setRespondBy] = useState(inDays(14))
  const [charge, setCharge] = useState('65')
  const [deposit, setDeposit] = useState('300')
  const [cleaning, setCleaning] = useState('100')
  const [petName, setPetName] = useState('')
  const [species, setSpecies] = useState('Dog')
  const [breed, setBreed] = useState('')
  const [sex, setSex] = useState('')
  const [weight, setWeight] = useState('')
  const [dob, setDob] = useState('')
  const [microchip, setMicrochip] = useState('')
  const [recordNumber, setRecordNumber] = useState('')
  const [color, setColor] = useState('')
  const [sterilized, setSterilized] = useState(true)
  const [vaccinated, setVaccinated] = useState(true)
  // On by default: this is a student house, and the paper form makes approval
  // conditional on the housemates agreeing. A landlord with a single tenant
  // turns it off and the clause disappears from the document entirely.
  const [needConsent, setNeedConsent] = useState(tenants.length > 1)
  const [extra, setExtra] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(false)

  const tenant = tenants.find(t => t.id === tenantId) ?? null
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0))
  const chargeNum = num(charge)
  const depositNum = num(deposit)
  const cleaningNum = num(cleaning)
  const premises = [propertyAddress, unitNumber?.trim() || null].filter(Boolean).join(' — ')

  /** The same builder the server runs. See the note above. */
  const doc: AmendmentDocument | null = useMemo(() => {
    if (!tenant?.name?.trim() || !landlordName?.trim() || !petName.trim()) return null
    return buildPetAdditionDocument({
      propertyAddress: premises,
      landlordName: landlordName.trim(),
      tenantName: tenant.name.trim(),
      leaseStartDate: leaseStart,
      leaseEndDate: leaseEnd,
      effectiveDate: effective,
      // Dated today, not on the effective date — a document dated into the
      // future is indistinguishable from a backdated one to a later reader.
      // The server does the same thing, so the preview matches what sends.
      agreementDate: signingToday(),
      monthlyPetRent: chargeNum,
      petDeposit: depositNum,
      cleaningFee: cleaningNum,
      respondBy: respondBy || null,
      requireCotenantConsent: needConsent,
      pet: {
        name: petName, species, breed, color, sex, weight,
        dob: dob || null, microchip, recordNumber,
        sterilized, vaccinated,
      },
      additionalTerms: extra,
    })
  }, [tenant, landlordName, premises, leaseStart, leaseEnd, effective, respondBy,
      chargeNum, depositNum, cleaningNum, needConsent,
      petName, species, breed, color, sex, weight, dob, microchip, recordNumber,
      sterilized, vaccinated, extra])

  async function send() {
    setSending(true); setErr('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setSending(false); return }
    const res = await fetch('/api/lease-amendments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        lease_id: leaseId,
        lease_tenant_id: tenantId,
        kind: 'pet_addition',
        effective_date: effective,
        respond_by: respondBy || null,
        monthly_charge: chargeNum,
        deposit_amount: depositNum,
        one_time_fee_amount: cleaningNum,
        require_cotenant_consent: needConsent,
        pet_name: petName,
        pet_species: species,
        pet_breed: breed || null,
        pet_sex: sex || null,
        pet_weight: weight || null,
        pet_dob: dob || null,
        pet_microchip: microchip || null,
        pet_record_number: recordNumber || null,
        pet_color: color || null,
        pet_sterilized: sterilized,
        pet_vaccinated: vaccinated,
        additional_terms: extra || null,
      }),
    })
    const json = await res.json()
    setSending(false)
    if (!res.ok) { setErr(json.error || 'Could not send it.'); return }
    onSent(json.sentTo)
  }

  if (withEmail.length === 0) {
    return (
      <div className="panel">
        <div className="panel-title">Add a pet to this lease</div>
        <div className="hint">
          Nobody on this lease has an email address on file, so there is nobody to send a document
          to. Add one on the Tenants tab first.
        </div>
        <div className="am-btns"><button className="btn-ghost" onClick={onCancel}>Close</button></div>
      </div>
    )
  }

  return (
    <div className="panel" style={{ marginTop: 0, marginBottom: 16 }}>
      <div className="panel-title">Add a pet to this lease</div>

      {err && <div className="alert-err">{err}</div>}

      <div className="field">
        <label className="lbl">Who is signing it</label>
        <select className="inp" value={tenantId} onChange={e => setTenantId(e.target.value)}>
          {withEmail.map(t => (
            <option key={t.id} value={t.id}>{t.name || t.email} — {t.email}</option>
          ))}
        </select>
        <div className="hint" style={{ marginTop: 5 }}>
          One tenant signs, and the charge lands on their share. Housemates aren&apos;t asked to
          sign for someone else&apos;s pet.
        </div>
      </div>

      {!tenant?.name?.trim() && (
        <div className="alert-err">
          {tenant?.email} has no name on the lease. A document has to name who is signing it — add
          their name on the Tenants tab first.
        </div>
      )}
      {!landlordName?.trim() && (
        <div className="alert-err">
          Add your full name to your HomeHive profile — an amendment has to name you as the landlord.
        </div>
      )}

      <div className="grid2">
        <div className="field">
          <label className="lbl">Pet rent, per month</label>
          <input
            className="inp" type="number" min={0} step={1} value={charge}
            onChange={e => setCharge(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 5 }}>
            Recurring, paid with the rent. Set it to 0 for no pet rent.
          </div>
        </div>
        <div className="field">
          <label className="lbl">Takes effect</label>
          <input
            className="inp" type="date" value={effective}
            min={signingToday()} max={leaseEnd}
            onChange={e => setEffective(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 5 }}>
            Pet rent starts with the {monthName(effective)} rent. The lease runs to{' '}
            {fmtShortDate(leaseEnd)}.
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="lbl">Pet security deposit</label>
          <input
            className="inp" type="number" min={0} step={1} value={deposit}
            onChange={e => setDeposit(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 5 }}>
            Refundable, held under the lease and Arizona law. 0 for none.
          </div>
        </div>
        <div className="field">
          <label className="lbl">One-time cleaning fee</label>
          <input
            className="inp" type="number" min={0} step={1} value={cleaning}
            onChange={e => setCleaning(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 5 }}>
            Nonrefundable, due on signing. 0 for none.
          </div>
        </div>
      </div>

      {/* Whatever you type, the document says it. The closing clause is built
          from these three numbers, and the send is refused if any of them is
          charged without being named in it — so there is no way to add a
          fee here that the tenant does not see. */}
      {depositNum + cleaningNum > 0 && (
        <div className="am-due">
          <strong>{fmtDollars(depositNum + cleaningNum)}</strong> due from{' '}
          {tenant?.name?.split(' ')[0] || 'the tenant'} on signing
          {chargeNum > 0 && <>, then <strong>{fmtDollars(chargeNum)}/mo</strong></>}. The document
          states all of it and says no other charge arises.
        </div>
      )}

      <div className="field">
        <label className="lbl">Must be signed by <span className="am-opt">optional</span></label>
        <input
          className="inp" type="date" value={respondBy}
          min={signingToday()} max={leaseEnd}
          onChange={e => setRespondBy(e.target.value)}
        />
        <div className="hint" style={{ marginTop: 5 }}>
          After this date the offer is deemed withdrawn and HomeHive refuses the signature —
          the document says so, so it has to be true. Clear it for no deadline.
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="lbl">Pet&apos;s name</label>
          <input className="inp" value={petName} onChange={e => setPetName(e.target.value)} placeholder="Dewey" />
        </div>
        <div className="field">
          <label className="lbl">Kind of animal</label>
          <input className="inp" value={species} onChange={e => setSpecies(e.target.value)} placeholder="Dog" />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="lbl">Breed <span className="am-opt">optional</span></label>
          <input className="inp" value={breed} onChange={e => setBreed(e.target.value)} placeholder="Alaskan Husky" />
        </div>
        <div className="field">
          <label className="lbl">Colour <span className="am-opt">optional</span></label>
          <input className="inp" value={color} onChange={e => setColor(e.target.value)} placeholder="Brown" />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="lbl">Sex <span className="am-opt">optional</span></label>
          <input className="inp" value={sex} onChange={e => setSex(e.target.value)} placeholder="Male" />
        </div>
        <div className="field">
          <label className="lbl">Weight <span className="am-opt">optional</span></label>
          {/* Text, not a number: vet records say "33 lbs 15 oz", and rounding
              that to an integer in a document whose job is to identify one
              specific animal loses the detail doing the identifying. */}
          <input className="inp" value={weight} onChange={e => setWeight(e.target.value)} placeholder="33 lbs 15 oz" />
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label className="lbl">Date of birth <span className="am-opt">optional</span></label>
          <input className="inp" type="date" value={dob} max={signingToday()} onChange={e => setDob(e.target.value)} />
        </div>
        <div className="field">
          <label className="lbl">Microchip <span className="am-opt">optional</span></label>
          <input className="inp" value={microchip} onChange={e => setMicrochip(e.target.value)} placeholder="985113014014128" />
        </div>
      </div>

      <div className="field">
        <label className="lbl">Licence / record number <span className="am-opt">optional</span></label>
        <input className="inp" value={recordNumber} onChange={e => setRecordNumber(e.target.value)} placeholder="A861983" />
        <div className="hint" style={{ marginTop: 5 }}>
          Permission is for <em>this</em> animal. Every detail here is what makes that enforceable
          if a second one turns up — the microchip most of all.
        </div>
      </div>

      <div className="am-checks">
        <label><input type="checkbox" checked={sterilized} onChange={e => setSterilized(e.target.checked)} /> Spayed or neutered</label>
        <label><input type="checkbox" checked={vaccinated} onChange={e => setVaccinated(e.target.checked)} /> Licensed &amp; vaccinated (Tempe / Maricopa County)</label>
      </div>

      <div className="am-checks">
        <label>
          <input type="checkbox" checked={needConsent} onChange={e => setNeedConsent(e.target.checked)} />
          The other tenants must consent in writing first
        </label>
      </div>
      {needConsent && (
        <div className="hint" style={{ margin: '-6px 0 14px' }}>
          Adds a clause making your approval conditional on written consent from each other tenant
          at the property. HomeHive then holds the amendment at &ldquo;signed, consents
          outstanding&rdquo; — and keeps the billing prompt back — until you confirm you
          have them.
        </div>
      )}

      <div className="field">
        <label className="lbl">Anything to add <span className="am-opt">optional</span></label>
        <textarea
          className="inp" rows={2} value={extra} onChange={e => setExtra(e.target.value)}
          placeholder="e.g. The pet is not permitted in the jacuzzi area."
        />
        <div className="hint" style={{ marginTop: 5 }}>
          Added as its own clause. It can&apos;t change the rent, the term or the deposit — the
          clause saying the rest of the lease is untouched always comes last.
        </div>
      </div>

      <div className="am-btns">
        <button className="btn-ghost" onClick={() => setPreview(p => !p)} disabled={!doc}>
          {preview ? 'Hide the document' : 'Read the document'}
        </button>
        <button className="btn-dark" disabled={!doc || sending} onClick={send}>
          {sending ? 'Sending…' : `Send to ${tenant?.name?.split(' ')[0] || 'tenant'} to sign`}
        </button>
        <button className="lnk-btn" onClick={onCancel}>Cancel</button>
      </div>

      {!doc && (
        <div className="hint" style={{ marginTop: 8 }}>
          Fill in the pet&apos;s name to see the document.
        </div>
      )}

      {preview && doc && (
        <div className="am-doc-wrap">
          <div className="am-prev-note">
            This is exactly what {tenant?.name?.split(' ')[0] || 'they'} will read and sign. Nothing
            is sent until you press send.
          </div>
          <AmendmentDocumentView doc={doc} signature={null} />
        </div>
      )}
    </div>
  )
}

/** `n` days from today, `YYYY-MM-DD`, in the billing calendar. */
function inDays(n: number): string {
  const t = signingToday()
  const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) + n))
  return d.toISOString().slice(0, 10)
}

/** The first of next month, `YYYY-MM-DD`, in the billing calendar. */
function firstOfNextMonth(): string {
  const today = signingToday()
  const y = +today.slice(0, 4)
  const m = +today.slice(5, 7)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

const CSS = `
  .am-ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 9px; padding: 11px 15px; font-size: 13px; margin-bottom: 14px; }

  .am-row { border: 1.5px solid #e2e8f0; border-radius: 11px; padding: 14px 16px; margin-bottom: 12px; }
  .am-row:last-child { margin-bottom: 0; }
  .am-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .am-title { font-size: 14px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .am-sub { font-size: 12px; color: #64748b; margin-top: 3px; }
  .am-chip { font-size: 9.5px; font-weight: 800; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid; }
  .am-chip.soft { color: #475569; background: #f1f5f9; border-color: #e2e8f0; }

  .am-act { margin-top: 11px; padding: 10px 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #f1f5f9; }
  .am-act.bill { background: #fffbeb; border-color: #fde68a; }
  .am-act.stop { background: #fef2f2; border-color: #fecaca; }
  .am-act-t { font-size: 12.5px; font-weight: 700; color: #0f172a; }
  .am-act-b { font-size: 11.5px; color: #64748b; margin-top: 2px; line-height: 1.55; }

  .am-signed { margin-top: 11px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .am-signed-name { font-family: 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', cursive; font-size: 22px; color: #16324f; }
  .am-signed-meta { font-size: 11.5px; color: #64748b; }

  .am-quote { margin-top: 11px; background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 9px 12px; font-size: 12.5px; color: #475569; font-style: italic; line-height: 1.55; }
  .am-quote-k { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 3px; font-style: normal; }

  .am-log { margin-top: 10px; }
  .am-log summary { font-size: 11.5px; color: #64748b; cursor: pointer; }
  .am-log-row { display: flex; gap: 10px; align-items: baseline; font-size: 11.5px; padding: 5px 0 5px 2px; border-bottom: 1px solid #f8fafc; }
  .am-log-kind { font-weight: 700; color: #0f172a; min-width: 140px; }
  .am-log-to { color: #64748b; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .am-log-at { color: #94a3b8; white-space: nowrap; }

  .am-btns { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .am-billed { font-size: 11.5px; color: #059669; font-weight: 600; display: inline-flex; gap: 7px; align-items: baseline; }

  .am-doc-wrap { margin-top: 14px; }
  .am-print { margin-top: 10px; }
  .am-prev-note { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 9px 12px; margin-bottom: 12px; line-height: 1.55; }

  .am-due { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; border-radius: 9px; padding: 10px 13px; font-size: 12.5px; line-height: 1.55; margin-bottom: 14px; }

  .am-opt { font-weight: 500; text-transform: none; letter-spacing: 0; color: #94a3b8; font-size: 10.5px; }
  .am-checks { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 14px; }
  .am-checks label { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #475569; cursor: pointer; }
`
