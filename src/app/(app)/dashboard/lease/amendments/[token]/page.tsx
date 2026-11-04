'use client'

import { useCallback, useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AmendmentDocumentView from '@/components/leases/AmendmentDocument'
import {
  fmtLegalDate, fmtDollars, monthName, signingToday, checkSignatureName,
  checkSignatureDeadline, chargesOf, dueOnExecution, monthlyTotal,
  type AmendmentDocument,
} from '@/lib/leaseAmendments'

type TenantAmendment = {
  id: string
  lease_id: string
  title: string
  effective_date: string
  monthly_charge: number
  monthly_charge_label: string | null
  deposit_amount: number
  one_time_fee_amount: number
  respond_by: string | null
  document: AmendmentDocument
  status: 'sent' | 'signed' | 'declined' | 'withdrawn'
  tenant_name: string | null
  tenant_email: string
  token: string
  sent_at: string
  signed_at: string | null
  signature_name: string | null
  signature_date: string | null
  declined_at: string | null
  decline_reason: string | null
}

/**
 * Where the tenant reads and signs a change to their lease.
 *
 * Inside `(app)` and behind the login on purpose, which is the one way this
 * differs from /renewal/[token] and /checkout-report/[token]. Those are
 * token-only because a tenant on this platform often has no account, and
 * answering a renewal or reading a move-out report does not need one. A
 * signature does: the whole value of the record is that a specific identified
 * person agreed, and "whoever had the link" is not a person. So the email deep
 * links here, `/login?next=` carries them through the wall, and the POST
 * re-checks that the session is the addressee.
 *
 * The page is written for somebody reading a legal document on a phone, who has
 * never read one before and is slightly worried. Three things follow from that:
 *
 *   • The terms are stated in plain language *above* the contract, and the
 *     reassurance that nothing else about their lease changes is the first
 *     thing they see. A tenant who is anxious about a document does not read it
 *     more carefully, they close the tab.
 *   • Declining is offered as plainly as signing. A signature that was the only
 *     available button is not much of a signature.
 *   • The date field is today and cannot be anything else — min and max are
 *     both today, and the server says the same. Nobody gets to backdate a
 *     contract by scrolling a date picker.
 */
export default function SignAmendmentPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const router = useRouter()

  const [row, setRow] = useState<TenantAmendment | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const today = signingToday()
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [agreed, setAgreed] = useState(false)
  const [reading, setReading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => { document.title = 'Sign your lease amendment — HomeHive' }, [])

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // Keep the destination through the login wall. Without this a tenant
      // clicking "sign this" from their email lands on a generic dashboard and
      // the document is never found again.
      const dest = window.location.pathname
      router.push(`/login?next=${encodeURIComponent(dest)}`)
      return
    }
    const res = await fetch(`/api/tenant/amendments?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) { setNotFound(true); setLoading(false); return }
    const json = await res.json()
    setRow(json.amendment)
    // Pre-fill the name on the lease, which is almost always right and saves a
    // phone keyboard. They can change it — the lease may spell it wrong — and
    // the server checks it is plausibly them either way.
    setName(json.amendment?.tenant_name || json.signerName || '')
    setLoading(false)
  }, [token, router])

  useEffect(() => { load() }, [load])

  async function submit(action: 'sign' | 'decline') {
    setBusy(true); setErr('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setBusy(false); router.push('/login'); return }
    const res = await fetch('/api/tenant/amendments/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(
        action === 'sign'
          ? { token, action, name, date }
          : { token, action, reason: reason.trim() || null }
      ),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setErr(json.error || 'That did not work.'); return }
    setRow(prev => (prev ? { ...prev, ...json.amendment } : prev))
    setDeclining(false)
  }

  if (loading) return <div className="sa-loading">Loading your document…</div>

  if (notFound || !row) {
    return (
      <div className="sa-wrap">
        <style>{CSS}</style>
        <div className="sa-empty">
          <div className="sa-empty-t">We can&apos;t find that document</div>
          <div className="sa-empty-b">
            The link may be out of date, or it may have been sent to a different email address than
            the one you&apos;re signed in with. Check the email your landlord sent you, or ask them
            to send it again.
          </div>
          <Link href="/dashboard/lease" className="sa-btn ghost">Back to my lease</Link>
        </div>
      </div>
    )
  }

  const doc = row.document
  const monthly = monthlyTotal(doc)
  const upfront = dueOnExecution(doc)
  const nameProblem = name.trim() ? checkSignatureName(name, row.tenant_name) : null
  // The offer's own deadline, checked here so a lapsed offer shows an honest
  // page instead of a signature button that the server will reject.
  const lateProblem = checkSignatureDeadline(doc.respondBy)
  const canSign = agreed && !nameProblem && !lateProblem && date === today && !busy

  return (
    <div className="sa-wrap">
      <style>{CSS}</style>

      <div className="sa-crumb">
        <Link href="/dashboard/lease">← My lease</Link>
      </div>

      {/* ── The header, which is the whole decision in four lines ──────────── */}
      <div className="sa-head">
        <div className="sa-kicker">
          {row.status === 'sent' ? 'Your landlord needs your signature' : 'Lease amendment'}
        </div>
        <h1 className="sa-title">{row.title}</h1>
        <div className="sa-prem">{doc.premises}</div>
      </div>

      {row.status === 'signed' && (
        <div className="sa-banner good">
          <strong>You signed this on {fmtLegalDate(row.signature_date)}.</strong> It&apos;s part of
          your tenancy now, and this page is your copy — you can print it or save it as a PDF any
          time.
        </div>
      )}
      {row.status === 'declined' && (
        <div className="sa-banner bad">
          <strong>You declined this{row.declined_at ? ` on ${fmtLegalDate(row.declined_at.slice(0, 10))}` : ''}.</strong>{' '}
          Your lease is unchanged and runs on exactly as before. If you&apos;ve changed your mind,
          talk to your landlord and they can send it again.
        </div>
      )}
      {row.status === 'sent' && lateProblem && (
        <div className="sa-banner bad">
          <strong>This offer has expired.</strong> {lateProblem}
        </div>
      )}
      {row.status === 'withdrawn' && (
        <div className="sa-banner bad">
          <strong>Your landlord withdrew this document.</strong> It can no longer be signed, and
          your lease is unchanged. They&apos;ll usually do this to send one on different terms.
        </div>
      )}

      {/* ── What it says, in plain words ──────────────────────────────────── */}
      <div className="sa-plain">
        <div className="sa-plain-t">In plain language</div>
        <ul className="sa-list">
          <li>
            You&apos;re allowed to keep{' '}
            <strong>{petPhrase(doc)}</strong> at {shortPremises(doc)} from{' '}
            <strong>{fmtLegalDate(doc.effectiveDate)}</strong>.
          </li>
          {/* Every amount, from doc.charges. Never a summary sentence written
              by hand: the first version of this page said "nothing else to
              pay", which was true of the document it was built against and
              would have been a flat lie about this one. */}
          {monthly > 0 && (
            <li>
              It costs <strong>{fmtDollars(monthly)} a month</strong>, added to your rent starting
              with your <strong>{monthName(doc.effectiveDate)}</strong> payment. Your rent itself
              doesn&apos;t change — this sits alongside it.
            </li>
          )}
          {upfront > 0 && (
            <li>
              <strong>{fmtDollars(upfront)} is due when you sign</strong> —{' '}
              {chargesOf(doc).filter(c => c.kind !== 'monthly').map((c, i, arr) => (
                <span key={i}>
                  {fmtDollars(c.amount)}{' '}
                  {c.kind === 'deposit'
                    ? <>as a <strong>refundable</strong> deposit you get back at the end, less
                        anything properly deducted</>
                    : <>as a <strong>one-time fee</strong> that isn&apos;t refunded</>}
                  {i < arr.length - 1 ? ', and ' : '.'}
                </span>
              ))}
            </li>
          )}
          {monthly === 0 && upfront === 0 && <li>There&apos;s no charge for this.</li>}
          <li>
            <strong>Your rent, your existing deposit and your move-out date don&apos;t change.</strong>{' '}
            Neither does anything else in your lease — the document says so in writing, in the last
            clause.
          </li>
          <li>
            You&apos;re responsible for any damage the pet causes, and for keeping it licensed and
            cleaning up after it. That&apos;s what the responsibilities clause covers.
          </li>
          {doc.requiresCotenantConsent && (
            <li>
              Your landlord&apos;s approval only takes effect once your{' '}
              <strong>housemates have each consented in writing</strong>. Signing this is your part
              of that; collecting their consents is theirs.
            </li>
          )}
          {doc.respondBy && row.status === 'sent' && (
            <li>
              You need to sign by <strong>{fmtLegalDate(doc.respondBy)}</strong>. After that the
              offer lapses and your landlord would have to send a new one.
            </li>
          )}
        </ul>
        <div className="sa-plain-f">
          This summary is here to help you read the document. The document below is what you&apos;re
          signing, and it&apos;s the part that counts.
        </div>
      </div>

      {/* ── The document ──────────────────────────────────────────────────── */}
      <div className="sa-doc">
        <AmendmentDocumentView
          doc={doc}
          signature={
            row.status === 'signed' && row.signature_name && row.signature_date
              ? { name: row.signature_name, date: row.signature_date, signedAt: row.signed_at }
              : null
          }
        />
      </div>

      <div className="sa-actions-row">
        <button className="sa-btn ghost" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>

      {/* ── The signature ─────────────────────────────────────────────────── */}
      {row.status === 'sent' && !lateProblem && (
        <div className="sa-sign">
          <div className="sa-sign-t">Sign it</div>

          {err && <div className="sa-err">{err}</div>}

          {!declining ? (
            <>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={reading}
                  onChange={e => setReading(e.target.checked)}
                />
                <span>I&apos;ve read the whole document above.</span>
              </label>

              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  disabled={!reading}
                />
                <span>{doc.signatureStatement}</span>
              </label>

              <div className="sa-fields">
                <div className="sa-field">
                  <label className="sa-lbl">Your full legal name</label>
                  <input
                    className={`sa-inp sig${nameProblem ? ' bad' : ''}`}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Type your full name"
                    autoComplete="name"
                    disabled={!agreed}
                  />
                  {nameProblem
                    ? <div className="sa-hint bad">{nameProblem}</div>
                    : <div className="sa-hint">Typing your name here is your signature.</div>}
                </div>

                <div className="sa-field narrow">
                  <label className="sa-lbl">Date</label>
                  {/* Today and nothing else. A date picker that can be scrolled
                      backwards is a contract that can be backdated, and the
                      server rejects anything but today regardless. */}
                  <input
                    className="sa-inp"
                    type="date"
                    value={date}
                    min={today}
                    max={today}
                    onChange={e => setDate(e.target.value)}
                    disabled={!agreed}
                  />
                  <div className="sa-hint">Today&apos;s date only.</div>
                </div>
              </div>

              <div className="sa-btns">
                <button className="sa-btn primary" disabled={!canSign} onClick={() => submit('sign')}>
                  {busy ? 'Signing…' : 'Sign this amendment'}
                </button>
                <button className="sa-btn link" onClick={() => { setDeclining(true); setErr('') }}>
                  I don&apos;t want to agree to this
                </button>
              </div>
              <div className="sa-foot">
                Nothing is agreed until you press sign. We&apos;ll email you a copy straight away.
              </div>
            </>
          ) : (
            <>
              <div className="sa-decline-t">Decline this amendment</div>
              <div className="sa-hint" style={{ marginBottom: 12 }}>
                Your lease carries on exactly as it is. Your landlord will be told you declined, and
                nothing is added to your rent. Telling them why is optional but usually helps.
              </div>
              <textarea
                className="sa-inp"
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Optional — e.g. I'd like to talk about the amount first."
              />
              <div className="sa-btns">
                <button className="sa-btn danger" disabled={busy} onClick={() => submit('decline')}>
                  {busy ? 'Sending…' : 'Decline'}
                </button>
                <button className="sa-btn link" onClick={() => setDeclining(false)}>
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * "one black and tan labrador mix named Dewey" — pulled out of clause 1.
 *
 * Read from the document rather than from the pet fields, because the document
 * is the only thing that is frozen; the structured pet columns are not stored
 * separately at all, deliberately, so there is nothing to drift from.
 */
function petPhrase(doc: AmendmentDocument): string {
  const first = doc.clauses[0]?.paragraphs[0] ?? ''
  const m = first.match(/permitted to keep (.+?) at the Premises/)
  return m?.[1] ?? 'the pet described below'
}

/** The street line without the state and zip, for a sentence. */
function shortPremises(doc: AmendmentDocument): string {
  return doc.premises.split(',')[0] || doc.premises
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .sa-wrap { max-width: 800px; margin: 0 auto; padding: 24px 18px 100px; font-family: 'DM Sans', sans-serif; color: #0f172a; }
  .sa-loading { max-width: 800px; margin: 0 auto; padding: 60px 18px; font-family: 'DM Sans', sans-serif; color: #64748b; font-size: 14px; }

  .sa-crumb { font-size: 13px; margin-bottom: 16px; }
  .sa-crumb a { color: #10b981; text-decoration: none; font-weight: 600; }
  .sa-crumb a:hover { text-decoration: underline; }

  .sa-head { margin-bottom: 18px; }
  .sa-kicker { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.9px; color: #b45309; margin-bottom: 7px; }
  .sa-title { font-size: 25px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.22; margin: 0; }
  .sa-prem { font-size: 13.5px; color: #64748b; margin-top: 5px; }

  .sa-banner { border-radius: 11px; padding: 14px 17px; font-size: 13.5px; line-height: 1.6; margin-bottom: 18px; }
  .sa-banner.good { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
  .sa-banner.bad { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }

  .sa-plain { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 13px; padding: 18px 20px; margin-bottom: 20px; }
  .sa-plain-t { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.9px; color: #64748b; margin-bottom: 11px; }
  .sa-list { margin: 0; padding-left: 20px; }
  .sa-list li { font-size: 14px; line-height: 1.65; margin-bottom: 9px; color: #1e293b; }
  .sa-list li::marker { color: #10b981; }
  .sa-plain-f { font-size: 12px; color: #94a3b8; line-height: 1.6; margin-top: 12px; padding-top: 11px; border-top: 1px solid #e2e8f0; }

  .sa-doc { margin-bottom: 14px; }
  .sa-actions-row { margin-bottom: 24px; }

  .sa-sign { background: #fff; border: 2px solid #0f172a; border-radius: 13px; padding: 20px 22px; }
  .sa-sign-t { font-size: 15px; font-weight: 700; margin-bottom: 15px; }

  .sa-check { display: flex; gap: 11px; align-items: flex-start; margin-bottom: 13px; cursor: pointer; }
  .sa-check input { margin-top: 3px; flex-shrink: 0; width: 17px; height: 17px; accent-color: #0f172a; }
  .sa-check span { font-size: 12.5px; line-height: 1.6; color: #475569; }
  .sa-check input:disabled + span { color: #b9c0ca; }

  .sa-fields { display: flex; gap: 14px; flex-wrap: wrap; margin: 18px 0 4px; }
  .sa-field { flex: 1; min-width: 220px; }
  .sa-field.narrow { flex: 0 0 170px; min-width: 150px; }
  .sa-lbl { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 6px; }
  .sa-inp { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 9px; padding: 11px 13px; font-size: 14px; font-family: inherit; color: #0f172a; background: #fff; outline: none; }
  .sa-inp:focus { border-color: #0f172a; }
  .sa-inp:disabled { background: #f8fafc; color: #94a3b8; }
  .sa-inp.bad { border-color: #fca5a5; }
  /* The name field is the signature, so it is set in the same script face the
     document renders it in — what you type is what will appear on the contract. */
  .sa-inp.sig:not(:disabled) { font-family: 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', cursive; font-size: 24px; color: #16324f; padding: 6px 13px; }

  .sa-hint { font-size: 11.5px; color: #94a3b8; line-height: 1.5; margin-top: 5px; }
  .sa-hint.bad { color: #dc2626; }
  .sa-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 9px; padding: 11px 14px; font-size: 13px; margin-bottom: 14px; line-height: 1.55; }

  .sa-btns { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 18px; }
  .sa-btn { border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
  .sa-btn.primary { background: #0f172a; color: #34d399; border: none; padding: 13px 26px; }
  .sa-btn.primary:disabled { opacity: .45; cursor: not-allowed; }
  .sa-btn.ghost { background: #fff; color: #475569; border: 1.5px solid #e2e8f0; padding: 9px 16px; font-size: 13px; }
  .sa-btn.ghost:hover { border-color: #94a3b8; }
  .sa-btn.danger { background: #fff; color: #dc2626; border: 1.5px solid #fca5a5; padding: 11px 22px; }
  .sa-btn.danger:hover { background: #fef2f2; }
  .sa-btn.link { background: none; border: none; color: #64748b; font-size: 13px; font-weight: 500; text-decoration: underline; padding: 4px 0; }
  .sa-btn.link:hover { color: #0f172a; }

  .sa-foot { font-size: 11.5px; color: #94a3b8; margin-top: 13px; line-height: 1.55; }
  .sa-decline-t { font-size: 14px; font-weight: 700; margin-bottom: 7px; }

  .sa-empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 13px; padding: 34px 28px; text-align: center; }
  .sa-empty-t { font-size: 17px; font-weight: 700; margin-bottom: 9px; }
  .sa-empty-b { font-size: 13.5px; color: #64748b; line-height: 1.65; max-width: 460px; margin: 0 auto 20px; }

  @media print {
    .sa-crumb, .sa-plain, .sa-sign, .sa-actions-row, .sa-banner, .sa-kicker { display: none !important; }
    .sa-wrap { padding: 0; max-width: none; }
    .sa-head { display: none; }
  }
`
