'use client'

import { useState } from 'react'

/**
 * The tenant's decision, and the only interactive thing on the page.
 *
 * Two deliberate choices in how it asks:
 *
 *   • Accepting takes one tap. Declining takes two — the button reveals a
 *     short confirm with a note field. Not friction for its own sake: a
 *     mis-tapped decline is the one outcome here that cannot be undone from
 *     this page, and it costs the tenant their home and the landlord their
 *     year. The asymmetry matches the asymmetry of the mistake.
 *   • There is no "maybe". A tenant who is unsure should close the tab and
 *     reply to their landlord, and a third button labelled "not sure" would
 *     collect that ambivalence as data without ever resolving it.
 */
export default function RenewalResponder({
  token,
  respondBy,
}: {
  token: string
  respondBy: string
}) {
  const [stage, setStage] = useState<'ask' | 'confirmDecline' | 'done'>('ask')
  const [decision, setDecision] = useState<'accept' | 'decline' | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (choice: 'accept' | 'decline') => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/renewals/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, decision: choice, note: note.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Something went wrong. Try again.'); return }
      setDecision(choice)
      setStage('done')
    } catch {
      setError('Could not reach HomeHive. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'done') {
    return (
      <div className={`rr-done ${decision === 'accept' ? 'yes' : 'no'}`}>
        <div className="rr-done-h">
          {decision === 'accept' ? 'You’re renewing — nice.' : 'Thanks for letting them know.'}
        </div>
        <p>
          {decision === 'accept'
            ? 'Your landlord has been told and will send the new lease to sign. Nothing changes until you sign it, and nothing else is needed from you today.'
            : 'Your landlord has been told you’ll be moving out at the end of your current term. Your existing lease is unchanged and runs to its end date as normal.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rr">
      {error && <div className="rr-err">{error}</div>}

      {stage === 'ask' ? (
        <>
          <button className="rr-yes" disabled={busy} onClick={() => send('accept')}>
            {busy ? 'Sending…' : 'Yes — I’ll stay'}
          </button>
          <button className="rr-no" disabled={busy} onClick={() => setStage('confirmDecline')}>
            No — I’m moving out
          </button>
          <div className="rr-foot">Reply by {respondBy}. Nothing is binding until you sign a lease.</div>
        </>
      ) : (
        <div className="rr-confirm">
          <div className="rr-confirm-h">Just to be sure — you’re moving out?</div>
          <p>
            Your landlord will start advertising the room. Your current lease is unaffected
            and runs to its end date.
          </p>
          <label className="rr-lbl" htmlFor="rr-note">Anything you want to tell them? (optional)</label>
          <textarea
            id="rr-note"
            className="rr-note"
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Graduating in May, so moving home…"
            maxLength={2000}
          />
          <button className="rr-no solid" disabled={busy} onClick={() => send('decline')}>
            {busy ? 'Sending…' : 'Confirm — I’m moving out'}
          </button>
          <button className="rr-back" disabled={busy} onClick={() => setStage('ask')}>
            Back
          </button>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
  .rr { margin-top: 4px; }
  .rr-err { background: #fef2f2; border: 1.5px solid #fecaca; color: #991b1b; border-radius: 9px; padding: 11px 13px; font-size: 13px; line-height: 1.5; margin-bottom: 14px; }

  .rr-yes, .rr-no, .rr-back {
    display: block; width: 100%; font-family: inherit; font-size: 15px; font-weight: 700;
    border-radius: 11px; padding: 15px 18px; cursor: pointer; margin-bottom: 10px;
    border: 1.5px solid transparent;
  }
  .rr-yes { background: linear-gradient(135deg,#6c002a,#8c1d40); color: #fff; }
  .rr-yes:hover:not(:disabled) { filter: brightness(1.08); }
  .rr-no { background: #fff; border-color: #e8e4db; color: #3a3a3a; }
  .rr-no:hover:not(:disabled) { border-color: #cbd5e1; }
  .rr-no.solid { background: #9f1239; border-color: #9f1239; color: #fff; }
  .rr-back { background: none; border-color: transparent; color: #9b9b9b; font-weight: 600; font-size: 13.5px; padding: 8px; }
  .rr-yes:disabled, .rr-no:disabled, .rr-back:disabled { opacity: 0.6; cursor: default; }

  .rr-foot { font-size: 12px; color: #9b9b9b; text-align: center; margin-top: 6px; line-height: 1.5; }

  .rr-confirm { background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 11px; padding: 16px; }
  .rr-confirm-h { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 6px; }
  .rr-confirm p { font-size: 13px; color: #3a3a3a; line-height: 1.6; margin-bottom: 14px; }
  .rr-lbl { display: block; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #92400e; margin-bottom: 5px; }
  .rr-note { width: 100%; border: 1.5px solid #e8e4db; border-radius: 9px; padding: 10px 12px; font-family: inherit; font-size: 14px; color: #1a1a1a; resize: vertical; line-height: 1.55; margin-bottom: 14px; background: #fff; }
  .rr-note:focus { outline: none; border-color: #f59e0b; }

  .rr-done { border-radius: 12px; padding: 20px; border: 1.5px solid; }
  .rr-done.yes { background: #f0fdf4; border-color: #86efac; }
  .rr-done.no { background: #f8fafc; border-color: #e2e8f0; }
  .rr-done-h { font-size: 17px; font-weight: 700; color: #1a1a1a; margin-bottom: 7px; letter-spacing: -0.2px; }
  .rr-done p { font-size: 13.5px; color: #3a3a3a; line-height: 1.65; }
`
