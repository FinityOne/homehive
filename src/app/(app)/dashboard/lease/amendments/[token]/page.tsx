'use client'

import { useCallback, useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AmendmentDocumentView from '@/components/leases/AmendmentDocument'
import Icon from '@/components/NavIcons'
import { TenantStyles, PageSkeleton } from '@/components/tenant/TenantFrame'
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

  // Holds the shape of the document rather than printing a sentence in an
  // empty viewport — this is a page somebody opened from an email, slightly
  // worried, and a blank screen is the wrong first impression of a contract.
  if (loading) return <><TenantStyles css={CSS} /><PageSkeleton panel={false} cards={4} /></>

  if (notFound || !row) {
    return (
      <div className="tp sa-wrap">
        <TenantStyles css={CSS} />
        <div className="sa-empty">
          <div className="sa-empty-t">We can&apos;t find that document</div>
          <div className="sa-empty-b">
            The link may be out of date, or it may have been sent to a different email address than
            the one you&apos;re signed in with. Check the email your landlord sent you, or ask them
            to send it again.
          </div>
          <Link href="/dashboard/lease" className="tp-btn tp-btn-primary">Back to my lease</Link>
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

  /**
   * How far through signing they are.
   *
   * The three gates — read it, agree to it, then name and date it — were
   * enforced by `disabled` attributes and nothing else, so a tenant looking at
   * a greyed-out name field had no way to know what would un-grey it. Naming
   * the steps turns a dead form into an obvious sequence.
   */
  const step = !reading ? 1 : !agreed ? 2 : 3

  return (
    <div className="tp sa-wrap">
      <TenantStyles css={CSS} />

      <a className="tp-back" href="/dashboard/lease">
        <Icon name="arrowLeft" size={15} />My lease
      </a>

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
          {doc.isBackdated && (
            <li>
              This starts <strong>{fmtLegalDate(doc.effectiveDate)}</strong>, which is before you
              sign it. That is deliberate and the document says so — it means the{' '}
              <strong>{monthName(doc.effectiveDate)}</strong> pet rent is owed in full, even
              though that month has already begun.
            </li>
          )}
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
        <button className="tp-btn tp-btn-secondary" onClick={() => window.print()}>
          <Icon name="receipt" size={16} />Print or save as PDF
        </button>
      </div>

      {/* ── The signature ─────────────────────────────────────────────────── */}
      {row.status === 'sent' && !lateProblem && (
        <div className="sa-sign">
          <div className="sa-sign-hd">
            <div className="sa-sign-t">Sign it</div>
            {!declining && <div className="sa-step">Step {step} of 3</div>}
          </div>

          {err && <div className="tp-note bad" role="alert">{err}</div>}

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
                <button className="tp-btn tp-btn-primary lg" disabled={!canSign} onClick={() => submit('sign')}>
                  {busy ? 'Signing…' : 'Sign this amendment'}
                </button>
                <button className="sa-btn link" onClick={() => { setDeclining(true); setErr('') }}>
                  I don&apos;t want to agree to this
                </button>
              </div>
              {/* Says what is still missing, rather than leaving a disabled
                  button to be guessed at. */}
              {!canSign && !busy && (
                <div className="sa-gate">
                  {!reading ? 'Tick the first box once you have read the document above.'
                    : !agreed ? 'Tick the second box to agree to the terms.'
                    : nameProblem ? nameProblem
                    : date !== today ? 'The date has to be today.'
                    : 'Type your full legal name to sign.'}
                </div>
              )}
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
                className="tp-textarea"
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
  /* This page is a legal document a worried person is reading on a phone, so
     it keeps the portal's own surfaces and type rather than the slate-and-
     emerald admin palette it used to wear. The one thing deliberately left
     alone is the document itself — AmendmentDocument renders what gets
     printed, and a contract should look like a contract. */
  .sa-wrap { max-width: 820px; margin: 0 auto; padding: 24px 18px 100px; }

  .sa-head { margin-bottom: 18px; }
  .sa-kicker { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px;
    font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--fee);
    background: var(--fee-wash); border: 1px solid var(--fee-line); border-radius: 20px;
    padding: 4px 11px; margin-bottom: 11px; }
  .sa-title { font-family: var(--display); font-size: 29px; font-weight: 400;
    letter-spacing: -0.6px; line-height: 1.18; margin: 0; color: var(--ink); }
  .sa-prem { font-size: 13.5px; color: var(--ink-3); margin-top: 6px; }

  .sa-banner { border-radius: var(--r-sm); padding: 14px 17px; font-size: 13.5px;
    line-height: 1.6; margin-bottom: 18px; }
  .sa-banner.good { background: var(--paid-wash); border: 1px solid var(--paid-line);
    color: var(--paid); }
  .sa-banner.bad { background: var(--owed-wash); border: 1px solid var(--owed-line);
    color: var(--owed); }

  /* The plain-language summary. Tinted, so it reads as explanation sitting
     beside the contract rather than as part of it. */
  .sa-plain { background: var(--primary-wash); border: 1px solid var(--primary-tint);
    border-radius: var(--r); padding: 18px 20px; margin-bottom: 20px; }
  .sa-plain-t { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .9px; color: var(--primary); margin-bottom: 11px; }
  .sa-list { margin: 0; padding-left: 20px; }
  .sa-list li { font-size: 14px; line-height: 1.68; margin-bottom: 10px; color: var(--ink-2); }
  .sa-list li:last-child { margin-bottom: 0; }
  .sa-list li strong { color: var(--ink); }
  .sa-list li::marker { color: var(--primary); }
  .sa-plain-f { font-size: 12px; color: var(--ink-3); line-height: 1.6; margin-top: 13px;
    padding-top: 12px; border-top: 1px solid var(--primary-tint); }

  .sa-doc { margin-bottom: 14px; }
  .sa-actions-row { margin-bottom: 24px; }

  /* The signature card is the one thing on this page the tenant must act on,
     and it wears the portal's "yours to act on" outline. */
  .sa-sign { background: var(--surface); border: 1.5px solid var(--primary);
    border-radius: var(--r); padding: 20px 22px; box-shadow: var(--shadow); }
  .sa-sign-hd { display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; margin-bottom: 16px; }
  .sa-sign-t { font-size: 16px; font-weight: 600; color: var(--ink); }
  .sa-step { font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .6px; color: var(--primary); background: var(--primary-wash);
    border-radius: 20px; padding: 3px 10px; white-space: nowrap; }

  .sa-check { display: flex; gap: 11px; align-items: flex-start; margin-bottom: 13px;
    cursor: pointer; }
  .sa-check input { margin-top: 2px; flex-shrink: 0; width: 18px; height: 18px;
    accent-color: var(--primary); }
  .sa-check span { font-size: 13px; line-height: 1.6; color: var(--ink-2); }
  .sa-check input:disabled + span { color: var(--ink-4); }

  .sa-fields { display: flex; gap: 14px; flex-wrap: wrap; margin: 18px 0 4px; }
  .sa-field { flex: 1; min-width: 220px; }
  .sa-field.narrow { flex: 0 0 170px; min-width: 150px; }
  .sa-lbl { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .5px; color: var(--ink-3); margin-bottom: 6px; }
  .sa-inp { width: 100%; border: 1.5px solid var(--line); border-radius: var(--r-sm);
    padding: 11px 13px; font-size: 14px; font-family: var(--sans); color: var(--ink);
    background: var(--surface); outline: none; transition: border-color .14s ease; }
  .sa-inp:focus { border-color: var(--primary); }
  .sa-inp:disabled { background: var(--surface-2); color: var(--ink-4); }
  .sa-inp.bad { border-color: var(--owed); }
  /* The name field is the signature, so it is set in the same script face the
     document renders it in — what you type is what will appear on the contract. */
  .sa-inp.sig:not(:disabled) { font-family: 'Snell Roundhand', 'Brush Script MT',
    'Segoe Script', cursive; font-size: 25px; color: var(--primary-ink); padding: 6px 13px; }

  .sa-hint { font-size: 11.5px; color: var(--ink-4); line-height: 1.5; margin-top: 5px; }
  .sa-hint.bad { color: var(--owed); }

  .sa-btns { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 18px; }
  .sa-btn { border-radius: var(--r-sm); font-size: 14px; font-weight: 600; cursor: pointer;
    font-family: var(--sans); text-decoration: none; display: inline-block; }
  .sa-btn.danger { background: var(--surface); color: var(--owed);
    border: 1.5px solid var(--owed-line); padding: 12px 22px; }
  .sa-btn.danger:hover { background: var(--owed-wash); }
  .sa-btn.link { background: none; border: none; color: var(--ink-3); font-size: 13px;
    font-weight: 500; text-decoration: underline; padding: 4px 0; }
  .sa-btn.link:hover { color: var(--primary); }

  /* What is still missing. Quiet, and directly under the button it explains. */
  .sa-gate { font-size: 12px; color: var(--fee); background: var(--fee-wash);
    border: 1px solid var(--fee-line); border-radius: var(--r-sm); padding: 9px 12px;
    margin-top: 12px; line-height: 1.55; }

  .sa-foot { font-size: 11.5px; color: var(--ink-4); margin-top: 13px; line-height: 1.55; }
  .sa-decline-t { font-size: 14.5px; font-weight: 600; color: var(--ink); margin-bottom: 7px; }

  .sa-empty { background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r-lg); padding: 44px 28px; text-align: center;
    box-shadow: var(--shadow); }
  .sa-empty-t { font-family: var(--display); font-size: 20px; font-weight: 400;
    color: var(--ink); margin-bottom: 9px; }
  .sa-empty-b { font-size: 13.5px; color: var(--ink-3); line-height: 1.65; max-width: 460px;
    margin: 0 auto 20px; }

  @media (max-width: 720px) {
    .sa-title { font-size: 24px; }
    .sa-field.narrow { flex: 1 1 100%; }
    .sa-btns { flex-direction: column; align-items: stretch; }
    .sa-btns .tp-btn, .sa-btn.danger { width: 100%; text-align: center; }
  }

  /* Printing gives the tenant their copy: the contract alone, with the
     reading aids and the form stripped out. */
  @media print {
    .tp-back, .sa-plain, .sa-sign, .sa-actions-row, .sa-banner, .sa-kicker { display: none !important; }
    .sa-wrap { padding: 0; max-width: none; }
    .sa-head { display: none; }
  }
`
