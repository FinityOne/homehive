'use client'

/**
 * One tenant, whole.
 *
 * ── The question this page exists to answer ─────────────────────────────────
 *
 * "How is this person doing?" Until now that was unanswerable in one place.
 * Financials knew what was owed *this month*, the lease page knew who had
 * signed, Reminders knew what had been emailed, and nothing anywhere put them
 * next to each other. So a landlord deciding whether to renew, or whether to
 * escalate, was assembling the story from four screens and their memory — and
 * memory is exactly the wrong instrument, because the tenant who shouts is
 * remembered as the problem and the one who is quietly two months behind is not.
 *
 * So: the record, in order of what a landlord actually asks.
 *
 *   1. **Where do they stand right now** — one badge, one balance, one action.
 *   2. **Have they always been like this** — the payment timeline. Twelve
 *      months as twelve marks, each one coloured by what became of it, with
 *      today's position in the tenancy marked. A landlord reads it in about a
 *      second, and it is the only thing on this page that cannot be faked by a
 *      good month.
 *   3. **What have we already done about it** — notices sent, reminders sent,
 *      and whether any of it was opened or bounced.
 *   4. **What is on file** — leases, documents, amendments, renewals, screening,
 *      co-signers, and whether they can even sign in to pay.
 *
 * ── Two rules the page keeps ────────────────────────────────────────────────
 *
 *   • **Every figure comes from the model, never from this file.** Standing,
 *     outcomes, days late and balances are `src/lib/tenantRecord.ts`, which is
 *     the same module the warning email is built from. A number shown here and
 *     the number posted to a co-signer cannot disagree, because they are the
 *     same call.
 *   • **Colour is never the only signal.** Every state on the timeline carries
 *     a word as well as a tone — in the legend, in the hover line, and in the
 *     Payments table underneath, which is the same data as text. That is what
 *     makes this legible to a colour-blind landlord and in a screenshot pasted
 *     into a text message.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { FINANCE_THEME } from '@/lib/financeTheme'
import { fmtMoney, METHOD_META } from '@/lib/rentPayments'
import { getLeaseDocumentSignedUrl } from '@/lib/leases'
import { kindLabel, OUTCOME_META as EMAIL_OUTCOME } from '@/lib/paymentEmails'
import {
  tenantRecord, warningBasis,
  OUTCOME_META, STANDING_META,
  type RentStop, type TenantRecord, type WarningBasis,
} from '@/lib/tenantRecord'
import type { Dossier, DossierPayer } from '@/lib/tenantDossierServer'

// ─── Small formatters ────────────────────────────────────────────────────────

const fmtDay = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const fmtMonthShort = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

const ago = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

/** `YYYY-MM-DD`, n days from today, for the deadline input's default. */
function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Tab = 'overview' | 'payments' | 'activity' | 'leases' | 'people'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'payments',  label: 'Payments' },
  { id: 'activity',  label: 'Activity' },
  { id: 'leases',    label: 'Leases & files' },
  { id: 'people',    label: 'Screening' },
]

/** A payer on a plan, with their record worked out. */
type Tenancy = { payer: DossierPayer; record: TenantRecord; basis: WarningBasis }

// ─── Page CSS ────────────────────────────────────────────────────────────────
// Only what the shared theme has no opinion about: the timeline, the modal's
// two-column body, and the little definition lists.

const CSS = `
  .tn-wrap { max-width: 1180px; margin: 0 auto; padding: 26px 24px 100px; }

  .tn-head { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; justify-content: space-between; }
  .tn-who { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .tn-av {
    width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    display: flex; align-items: center; justify-content: center;
    font-size: 19px; font-weight: 600; letter-spacing: -0.02em;
  }
  .tn-contact { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 5px; font-size: 13px; color: var(--ink-2); }
  .tn-contact a { color: var(--accent); text-decoration: none; }
  .tn-contact a:hover { text-decoration: underline; }
  .tn-stars { color: #d9a400; font-size: 13px; letter-spacing: 1px; }

  /* ── The timeline ──────────────────────────────────────────────────────────
     One mark per month, in order, each the width of its share of the tenancy.
     A 2px surface gap keeps adjacent months from reading as one block, and the
     ends are rounded so the run has a visible start and finish. */
  .tn-bar { display: flex; gap: 2px; margin: 14px 0 0; }
  .tn-seg {
    flex: 1 1 0; min-width: 0; height: 26px; border: none; padding: 0;
    background: var(--idle-bg); cursor: pointer; position: relative;
    border-radius: 2px;
  }
  .tn-bar .tn-seg:first-child { border-radius: 5px 2px 2px 5px; }
  .tn-bar .tn-seg:last-child  { border-radius: 2px 5px 5px 2px; }
  .tn-seg.on_time  { background: var(--in); }
  .tn-seg.late     { background: var(--fee); }
  .tn-seg.clearing { background: var(--flight); }
  .tn-seg.overdue  { background: var(--late); }
  .tn-seg.due      { background: var(--idle); }
  .tn-seg.upcoming { background: var(--line); }
  .tn-seg.voided   { background: repeating-linear-gradient(45deg, var(--line-2) 0 4px, var(--line) 4px 8px); }
  .tn-seg[aria-pressed="true"] { outline: 2px solid var(--ink); outline-offset: 2px; }
  /* Today's place in the tenancy, so the empty months to the right read as
     "not yet" rather than as "unpaid". */
  .tn-seg.now::after {
    content: ''; position: absolute; top: -6px; bottom: -6px; right: -2px;
    width: 2px; background: var(--ink); border-radius: 2px;
  }
  .tn-ticks { display: flex; gap: 2px; margin-top: 5px; }
  .tn-tick {
    flex: 1 1 0; min-width: 0; text-align: center; font-size: 10px; color: var(--ink-3);
    overflow: hidden; white-space: nowrap;
  }
  .tn-read {
    margin-top: 12px; padding: 11px 14px; border-radius: 10px;
    background: var(--surface-2); border: 1px solid var(--line-2);
    font-size: 13px; color: var(--ink-2); line-height: 1.5; min-height: 44px;
  }
  .tn-read b { color: var(--ink); font-weight: 600; }

  .tn-dl { display: grid; grid-template-columns: auto 1fr; gap: 7px 18px; font-size: 13px; }
  .tn-dl dt { color: var(--ink-3); white-space: nowrap; }
  .tn-dl dd { color: var(--ink); font-variant-numeric: tabular-nums; }

  .tn-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }

  .tn-lease { border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; background: var(--surface); }
  .tn-lease h3 { font-size: 16px; font-weight: 600; letter-spacing: -0.015em; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .tn-docs { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .tn-doc {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 8px 11px; border: 1px solid var(--line); border-radius: 9px; font-size: 13px;
    background: var(--surface-2);
  }

  /* ── The notice composer ───────────────────────────────────────────────── */
  .tn-modal-scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.34); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 22px; }
  .tn-modal {
    background: var(--surface); border-radius: 18px; width: min(1060px, 100%);
    max-height: 92vh; display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 24px 70px rgba(0,0,0,0.26);
  }
  .tn-modal-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 20px 24px 16px; border-bottom: 1px solid var(--line); }
  .tn-modal-bd { flex: 1; overflow-y: auto; display: grid; grid-template-columns: minmax(300px, 380px) 1fr; }
  .tn-modal-ctrl { padding: 20px 22px; border-right: 1px solid var(--line); }
  .tn-modal-prev { padding: 16px 18px; background: var(--surface-2); min-width: 0; }
  .tn-modal-ft { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 24px; border-top: 1px solid var(--line); flex-wrap: wrap; }
  .tn-field { margin-bottom: 16px; }
  .tn-field > label { display: block; font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
  .tn-input, .tn-textarea {
    width: 100%; border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px;
    font-family: inherit; font-size: 13.5px; color: var(--ink); background: var(--surface); outline: none;
  }
  .tn-input:focus, .tn-textarea:focus { border-color: var(--accent); }
  .tn-textarea { min-height: 86px; resize: vertical; line-height: 1.5; }
  .tn-check {
    display: flex; align-items: flex-start; gap: 9px; padding: 10px 12px; font-size: 13px;
    border: 1px solid var(--line); border-radius: 10px; margin-bottom: 7px; cursor: pointer;
  }
  .tn-check:hover { border-color: var(--accent); }
  .tn-check input { margin-top: 2px; }
  .tn-check em { font-style: normal; display: block; font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
  .tn-frame { width: 100%; height: 100%; min-height: 460px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
  .tn-err { background: var(--late-bg); border: 1px solid var(--late-line); color: #8c2f26; border-radius: 10px; padding: 10px 13px; font-size: 13px; line-height: 1.5; }
  .tn-ok  { background: var(--in-bg); border: 1px solid var(--in-line); color: var(--in); border-radius: 10px; padding: 10px 13px; font-size: 13px; line-height: 1.5; }

  @media (max-width: 860px) {
    .tn-modal-bd { grid-template-columns: 1fr; }
    .tn-modal-ctrl { border-right: none; border-bottom: 1px solid var(--line); }
    .tn-tick { font-size: 0; }
  }
  @media (max-width: 700px) {
    .tn-wrap { padding: 20px 15px 80px; }
  }
`

// ─── The timeline ────────────────────────────────────────────────────────────

/**
 * The tenancy as a run of months.
 *
 * Deliberately not a chart with axes: there is no magnitude here worth plotting
 * — every month is the same rent — only *what happened*, which is a state per
 * step. So it is a sequence of equal marks, which is also what makes the shape
 * of a problem visible: three reds in a row look nothing like three reds spread
 * over a year, and a bar chart of amounts would hide both.
 *
 * Each mark is a button: hovering or tabbing to it writes the month out in full
 * underneath, because a colour with a tooltip is not an accessible encoding and
 * a landlord on a phone has no hover at all.
 */
function Timeline({ record }: { record: TenantRecord }) {
  const [picked, setPicked] = useState<string | null>(null)
  const stops = record.timeline
  if (stops.length === 0) return null

  // The last month that has come due — where "now" sits in the run.
  const nowIndex = stops.reduce((last, s, i) => (s.dueDate <= record.today ? i : last), -1)
  const shown = stops.find(s => s.id === picked)
    ?? stops[nowIndex >= 0 ? nowIndex : 0]

  const line = (s: RentStop) => {
    const meta = OUTCOME_META[s.outcome]
    const money = s.outcome === 'upcoming' || s.outcome === 'voided'
      ? fmtMoney(s.amount)
      : `${fmtMoney(s.paid)} of ${fmtMoney(s.amount)}`
    const when = s.settledOn
      ? ` Sent ${fmtDay(s.settledOn)}${s.daysLate > 0 ? `, ${plural(s.daysLate, 'day')} after the due date.` : ', on time.'}`
      : s.outcome === 'overdue' ? ` Nothing sent — ${plural(s.daysLate, 'day')} past due.` : ''
    const fee = s.lateFee > 0 ? ` ${fmtMoney(s.lateFee)} late fee outstanding.` : ''
    return { meta, text: `${money}. Due ${fmtDay(s.dueDate)}.${when}${fee}` }
  }

  const read = line(shown)

  return (
    <div>
      <div className="tn-bar" role="group" aria-label="Rent paid month by month">
        {stops.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`tn-seg ${s.outcome}${i === nowIndex ? ' now' : ''}`}
            aria-pressed={s.id === shown.id}
            aria-label={`${s.month}: ${OUTCOME_META[s.outcome].label}`}
            title={`${s.month} — ${OUTCOME_META[s.outcome].label}`}
            onMouseEnter={() => setPicked(s.id)}
            onFocus={() => setPicked(s.id)}
            onClick={() => setPicked(s.id)}
          />
        ))}
      </div>
      <div className="tn-ticks" aria-hidden="true">
        {stops.map(s => <div key={s.id} className="tn-tick">{fmtMonthShort(s.dueDate)}</div>)}
      </div>

      <div className="tn-read" aria-live="polite">
        <b>{shown.month}</b>{' '}
        <span className={`badge ${read.meta.tone === 'good' ? 'in' : read.meta.tone === 'bad' ? 'late' : read.meta.tone === 'warn' ? 'fee' : read.meta.tone === 'info' ? 'flight' : 'idle'}`}>
          {read.meta.label}
        </span>{' '}
        {read.text}
      </div>

      <div className="key" style={{ marginTop: 12 }}>
        <span className="key-item"><span className="key-dot in" /> On time</span>
        <span className="key-item"><span className="key-dot fee" /> Paid late</span>
        <span className="key-item"><span className="key-dot flight" /> Clearing</span>
        <span className="key-item"><span className="key-dot late" /> Overdue</span>
        <span className="key-item"><span className="key-dot idle" /> Not due yet</span>
        <span className="key-item">| marks today</span>
      </div>
    </div>
  )
}

// ─── The notice composer ─────────────────────────────────────────────────────

type PreviewMessage = {
  audience: 'tenant' | 'cosigner'
  to: string
  name: string | null
  relationship?: string | null
  checkId?: string
  subject: string
  html: string
}

type PreviewPayload = {
  asOf: string
  respondBy: string
  basis: WarningBasis
  tenancy: { planTenantId: string; propertyName: string; unitLabel: string | null }
  messages: PreviewMessage[]
  cosignersOnFile: {
    id: string; name: string | null; email: string | null; relationship: string | null
    status: string | null; included: boolean
  }[]
}

/**
 * Write the first notice, read it, then send it.
 *
 * The preview is not a nicety. This is the only email in the app that goes to
 * someone who is not a customer — a parent, usually — under the landlord's
 * name, about their child's debt. A landlord who has not read it before it goes
 * has delegated something they should not have, so the composer shows the
 * exact rendered message, for each recipient, and the figures come back from
 * the server that will send it rather than from this page's own arithmetic.
 */
function NoticeComposer({
  tenantId, tenantName, planTenantId, onClose, onSent,
}: {
  tenantId: string
  tenantName: string
  planTenantId: string | null
  onClose: () => void
  onSent: () => void
}) {
  const [message, setMessage] = useState('')
  const [respondBy, setRespondBy] = useState(() => addDays(5))
  const [picked, setPicked] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [reading, setReading] = useState<'tenant' | string>('tenant')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)

  const post = useCallback(async (body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/landlord/tenants/${tenantId}/late-warning`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ level: 1, planTenantId, ...body }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
    return json
  }, [tenantId, planTenantId])

  // Re-asked whenever the landlord changes something the letter says. Debounced
  // so typing a message does not cost a request per keystroke.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setBusy(true)
      post({
        preview: true,
        message: message || undefined,
        respondBy,
        ...(picked ? { cosignerCheckIds: picked } : {}),
      })
        .then(json => {
          if (cancelled) return
          setPreview(json)
          setError(null)
        })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
        .finally(() => { if (!cancelled) setBusy(false) })
    }, 420)
    return () => { cancelled = true; clearTimeout(t) }
  }, [post, message, respondBy, picked])

  const included = preview?.cosignersOnFile.filter(c => c.included) ?? []
  const shown = preview?.messages.find(m =>
    reading === 'tenant' ? m.audience === 'tenant' : m.checkId === reading) ?? preview?.messages[0]

  async function send() {
    setSending(true)
    setError(null)
    try {
      await post({
        message: message || undefined,
        respondBy,
        ...(picked ? { cosignerCheckIds: picked } : {}),
      })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const toggleCosigner = (id: string) => {
    const base = picked ?? included.map(c => c.id)
    setPicked(base.includes(id) ? base.filter(x => x !== id) : [...base, id])
  }

  const b = preview?.basis

  return (
    <div className="tn-modal-scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tn-modal" role="dialog" aria-modal="true" aria-label="Send the first late-rent notice">
        <div className="tn-modal-hd">
          <div>
            <div className="sheet-title">First notice — late rent</div>
            <div className="sheet-sub">
              To {tenantName}
              {included.length > 0 && <> and {included.map(c => c.name || c.email).join(', ')}</>}
              {preview && <> · {preview.tenancy.propertyName}{preview.tenancy.unitLabel ? ` · ${preview.tenancy.unitLabel}` : ''}</>}
            </div>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="tn-modal-bd">
          <div className="tn-modal-ctrl">
            {error && <div className="tn-err" style={{ marginBottom: 16 }}>{error}</div>}

            {b && (
              <div className="tn-field">
                <label>What this notice chases</label>
                {[...b.rent, ...b.charges, ...b.fees].map(l => (
                  <div className="sline" key={`${l.kind}-${l.id}`}>
                    <span className="sline-lbl">
                      {l.label}
                      <span className="sline-note">
                        {l.kind === 'late_fee'
                          ? (l.rentSettled ? 'Fee on rent since paid' : 'Fee still accruing')
                          : `Due ${fmtDay(l.dueDate)} · ${plural(l.daysLate, 'day')} past due`}
                      </span>
                    </span>
                    <span className="sline-amt owed">{fmtMoney(l.amount)}</span>
                  </div>
                ))}
                <div className="sline total">
                  <span className="sline-lbl">Total outstanding</span>
                  <span className="sline-amt owed">{fmtMoney(b.total)}</span>
                </div>
                <div className="muted sm" style={{ marginTop: 8 }}>
                  Worked out on the server as of {fmtDay(b.asOf)} — not from this page, so
                  anything paid since will not be chased.
                </div>
              </div>
            )}

            <div className="tn-field">
              <label htmlFor="tn-by">Asking for it by</label>
              <input
                id="tn-by"
                className="tn-input"
                type="date"
                value={respondBy}
                min={addDays(1)}
                onChange={e => setRespondBy(e.target.value)}
              />
            </div>

            <div className="tn-field">
              <label>Co-signers to copy</label>
              {(preview?.cosignersOnFile.length ?? 0) === 0 ? (
                <div className="muted sm">
                  No co-signer on file for this tenant. Only they will receive the notice.
                </div>
              ) : preview!.cosignersOnFile.map(c => (
                <label className="tn-check" key={c.id}>
                  <input
                    type="checkbox"
                    checked={(picked ?? included.map(x => x.id)).includes(c.id)}
                    disabled={!c.email}
                    onChange={() => toggleCosigner(c.id)}
                  />
                  <span>
                    {c.name || c.email || 'Co-signer'}
                    <em>
                      {c.email ?? 'no email on file'}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                      {c.status && c.status !== 'approved' ? ` · screening ${titleCase(c.status)}` : ''}
                    </em>
                  </span>
                </label>
              ))}
              <div className="muted sm" style={{ marginTop: 6 }}>
                They get their own letter, and {tenantName.split(' ')[0]} is told who was copied.
              </div>
            </div>

            <div className="tn-field">
              <label htmlFor="tn-msg">A note in your own words <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(optional)</span></label>
              <textarea
                id="tn-msg"
                className="tn-textarea"
                maxLength={600}
                value={message}
                placeholder="I know this month has been tight — let me know if you need to split it."
                onChange={e => setMessage(e.target.value)}
              />
            </div>
          </div>

          <div className="tn-modal-prev">
            {(preview?.messages.length ?? 0) > 1 && (
              <div className="seg" style={{ marginBottom: 12 }} role="tablist" aria-label="Whose copy">
                <button
                  role="tab"
                  aria-selected={reading === 'tenant'}
                  className={`seg-btn${reading === 'tenant' ? ' on' : ''}`}
                  onClick={() => setReading('tenant')}
                >
                  {tenantName.split(' ')[0]}&rsquo;s copy
                </button>
                {preview!.messages.filter(m => m.audience === 'cosigner').map(m => (
                  <button
                    key={m.checkId}
                    role="tab"
                    aria-selected={reading === m.checkId}
                    className={`seg-btn${reading === m.checkId ? ' on' : ''}`}
                    onClick={() => setReading(m.checkId!)}
                  >
                    {(m.name ?? m.to).split(' ')[0]}&rsquo;s copy
                  </button>
                ))}
              </div>
            )}

            {shown ? (
              <>
                <div className="muted sm" style={{ marginBottom: 8 }}>
                  <b style={{ color: 'var(--ink)' }}>To</b> {shown.to} · <b style={{ color: 'var(--ink)' }}>Subject</b> {shown.subject}
                </div>
                <iframe
                  className="tn-frame"
                  title="Notice preview"
                  srcDoc={shown.html}
                  sandbox=""
                />
              </>
            ) : (
              <div className="skeleton" style={{ height: 460 }} />
            )}
          </div>
        </div>

        <div className="tn-modal-ft">
          <div className="muted sm">
            {busy ? 'Rebuilding the notice…'
              : preview ? `Recorded on this tenant's file as notice #1, with whatever the mail does next.`
              : ' '}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!preview || sending || busy}
              aria-busy={sending}
              onClick={send}
            >
              {sending ? 'Sending…' : `Send notice${included.length > 0 ? ` to ${included.length + 1} people` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── The page ────────────────────────────────────────────────────────────────

export default function TenantDetailPage() {
  const params = useParams<{ tenantId: string }>()
  const router = useRouter()
  const tenantId = params?.tenantId as string

  const [d, setD] = useState<Dossier | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [which, setWhich] = useState(0)
  const [composing, setComposing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace(`/login?next=/landlord/tenants/${tenantId}`); return }
      const res = await fetch(`/api/landlord/tenants/${tenantId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load this tenant')
      setD(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this tenant')
    }
  }, [tenantId, router])

  useEffect(() => { load() }, [load])

  const name = d ? [d.tenant.first_name, d.tenant.last_name].filter(Boolean).join(' ').trim() : ''
  useEffect(() => {
    document.title = name ? `${name} — Tenants | HomeHive` : 'Tenant — Landlord | HomeHive'
  }, [name])

  /**
   * Every tenancy this person has, with its record worked out.
   *
   * One tenant can hold two: a renewal is a new lease with a new plan, and both
   * have their own months. They are never merged into one timeline — the gap
   * between two leases is not a missed payment.
   */
  const tenancies: Tenancy[] = useMemo(() => {
    if (!d) return []
    return d.payers.map(payer => ({
      payer,
      record: tenantRecord(payer.scheduled, payer.specials, payer.rule),
      basis: warningBasis(payer.scheduled, payer.specials, payer.rule),
    }))
  }, [d])

  // Open on the tenancy that needs attention; failing that, the current one.
  useEffect(() => {
    if (tenancies.length === 0) return
    const behind = tenancies.findIndex(t => t.basis.sendable)
    setWhich(behind >= 0 ? behind : 0)
  }, [tenancies])

  const active = tenancies[which] ?? null

  /** The person's whole record across every tenancy. The headline figures. */
  const overall = useMemo(() => {
    const monthsDue = tenancies.reduce((s, t) => s + t.record.monthsDue, 0)
    const onTime = tenancies.reduce((s, t) => s + t.record.onTime, 0)
    const lateOnes = tenancies.reduce((s, t) => s + t.record.paidLate, 0)
    const lastPayments = tenancies
      .map(t => t.record.lastPayment)
      .filter(Boolean) as { date: string; amount: number }[]
    const nextDues = tenancies
      .map(t => t.record.nextDue)
      .filter(Boolean) as { dueDate: string; amount: number }[]
    return {
      monthsDue, onTime, paidLate: lateOnes,
      onTimeRate: monthsDue > 0 ? Math.round((onTime / monthsDue) * 100) : null,
      owed: tenancies.reduce((s, t) => s + t.record.totalOwed, 0),
      fees: tenancies.reduce((s, t) => s + t.record.lateFeeOwed, 0),
      waived: tenancies.reduce((s, t) => s + t.record.waived, 0),
      collected: tenancies.reduce((s, t) => s + t.record.collected, 0),
      worst: tenancies.reduce((m, t) => Math.max(m, t.record.worstDaysLate), 0),
      lastPayment: lastPayments.sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null,
      nextDue: nextDues.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null,
    }
  }, [tenancies])

  async function openDocument(storagePath: string) {
    const url = await getLeaseDocumentSignedUrl(storagePath)
    if (url) window.open(url, '_blank', 'noopener')
    else setFlash('That document could not be opened — it may have been removed from storage.')
  }

  if (error) {
    return (
      <>
        <style>{FINANCE_THEME}{CSS}</style>
        <div className="fin tn-wrap">
          <div className="empty">
            <div className="empty-title">{error}</div>
            <div className="empty-sub">
              This page only opens tenants on your own account.
            </div>
            <Link className="btn-primary" href="/landlord/tenants">Back to Tenants</Link>
          </div>
        </div>
      </>
    )
  }

  if (!d) {
    return (
      <>
        <style>{FINANCE_THEME}{CSS}</style>
        <div className="fin tn-wrap">
          <div className="hub-crumbs"><Link href="/landlord/tenants">Tenants</Link></div>
          <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 220 }} />
        </div>
      </>
    )
  }

  const standing = active ? STANDING_META[active.record.standing] : null
  const initials = [d.tenant.first_name, d.tenant.last_name]
    .filter(Boolean).map(s => s!.trim()[0]?.toUpperCase()).join('').slice(0, 2) || '?'
  const canWarn = tenancies.some(t => t.basis.sendable)

  return (
    <>
      <style>{FINANCE_THEME}{CSS}</style>
      <div className="fin tn-wrap">

        <div className="hub-crumbs">
          <Link href="/landlord/tenants">Tenants</Link>
          <span className="sep">/</span>
          <span>{name || d.tenant.email}</span>
        </div>

        {/* ── Who ──────────────────────────────────────────────────────────── */}
        <div className="tn-head">
          <div className="tn-who">
            <div className="tn-av" aria-hidden="true">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <h1 className="title" style={{ fontSize: 26 }}>{name || d.tenant.email}</h1>
              <div className="tn-contact">
                <a href={`mailto:${d.tenant.email}`}>{d.tenant.email}</a>
                {d.tenant.phone && <><span className="sep">·</span><a href={`tel:${d.tenant.phone}`}>{d.tenant.phone}</a></>}
                <span className={`badge ${d.tenant.status === 'active' ? 'in' : 'idle'}`}>{titleCase(d.tenant.status)}</span>
                {d.tenant.rating != null && d.tenant.rating > 0 && (
                  <span className="tn-stars" title={`${d.tenant.rating} out of 5`}>
                    {'★'.repeat(d.tenant.rating)}{'☆'.repeat(5 - d.tenant.rating)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="hub-actions">
            {active && (
              <Link className="btn-secondary" href={`/landlord/financials/plan/${active.payer.planId}`}>
                Open the ledger
              </Link>
            )}
            <button
              className="btn-primary"
              disabled={!canWarn}
              title={canWarn
                ? 'Email a first written notice to this tenant and their co-signers'
                : 'Nothing is past due, so there is no notice to send'}
              onClick={() => setComposing(true)}
            >
              Send first notice
            </button>
          </div>
        </div>

        {flash && <div className="tn-ok" style={{ marginTop: 16 }}>{flash}</div>}

        {/* Several tenancies: say which one everything below is about. */}
        {tenancies.length > 1 && (
          <div className="seg" style={{ marginTop: 18 }} role="tablist" aria-label="Tenancy">
            {tenancies.map((t, i) => (
              <button
                key={t.payer.planTenantId}
                role="tab"
                aria-selected={which === i}
                className={`seg-btn${which === i ? ' on' : ''}${t.basis.sendable ? ' hot' : ''}`}
                onClick={() => setWhich(i)}
              >
                {t.payer.propertyName}
                {t.record.totalOwed > 0 && <span className="seg-badge">{fmtMoney(t.record.totalOwed)}</span>}
              </button>
            ))}
          </div>
        )}

        {/* ── Where they stand ─────────────────────────────────────────────── */}
        {active && standing && (active.record.standing === 'behind' || active.record.standing === 'serious') && (
          <div className="alarm-bar" style={{ marginTop: 18, cursor: 'default' }} role="status">
            <span>
              <strong>{standing.label}.</strong>{' '}
              {active.record.oldestOverdue
                ? `${fmtMoney(active.record.totalOwed)} outstanding, oldest charge ${plural(active.record.oldestOverdue.daysLate, 'day')} past due.`
                : `${fmtMoney(active.record.totalOwed)} outstanding.`}
              {d.warnings.length === 0
                ? ' No written notice has been sent yet.'
                : ` Last notice sent ${ago(d.warnings[0].createdAt)}.`}
            </span>
            {canWarn && (
              <button className="btn-quiet" onClick={() => setComposing(true)}>
                <span className="go">Send first notice →</span>
              </button>
            )}
          </div>
        )}

        {/* ── The headline figures ─────────────────────────────────────────── */}
        <section className="kpis" style={{ marginTop: 18 }} aria-label="Payment record">
          <div className={`kpi${overall.owed > 0 ? '' : ' hero'}`}>
            <div className="kpi-label">Outstanding now</div>
            <div className={`kpi-value num${overall.owed > 0 ? ' bad' : ''}`}>{fmtMoney(overall.owed)}</div>
            <div className="kpi-meta">
              {overall.owed > 0
                ? `${fmtMoney(overall.owed - overall.fees)} rent and charges${overall.fees > 0 ? ` · ${fmtMoney(overall.fees)} fees` : ''}`
                : standing?.line ?? 'nothing owed'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Paid on time</div>
            <div className="kpi-value">
              {overall.onTimeRate === null ? '—' : `${overall.onTimeRate}%`}
            </div>
            <div className="kpi-meta">
              {overall.monthsDue === 0
                ? 'no rent has come due yet'
                : `${overall.onTime} of ${plural(overall.monthsDue, 'month')} due${overall.paidLate > 0 ? ` · ${overall.paidLate} paid late` : ''}`}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Late fees outstanding</div>
            <div className={`kpi-value num${overall.fees > 0 ? ' warn' : ''}`}>{fmtMoney(overall.fees)}</div>
            <div className="kpi-meta">
              {overall.waived > 0
                ? `${fmtMoney(overall.waived)} waived to date`
                : overall.worst > 0 ? `worst month was ${plural(overall.worst, 'day')} late` : 'never charged a fee'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Last payment</div>
            <div className="kpi-value">{overall.lastPayment ? fmtMoney(overall.lastPayment.amount) : '—'}</div>
            <div className="kpi-meta">
              {overall.lastPayment ? `sent ${fmtDay(overall.lastPayment.date)}` : 'nothing received yet'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Next due</div>
            <div className="kpi-value">{overall.nextDue ? fmtMoney(overall.nextDue.amount) : '—'}</div>
            <div className="kpi-meta">
              {overall.nextDue ? fmtDay(overall.nextDue.dueDate) : 'nothing scheduled ahead'}
            </div>
          </div>
        </section>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="hub-tabs" role="tablist" aria-label="Tenant record">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`hub-tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'activity' && d.warnings.length > 0 && (
                <span className="seg-badge">{d.warnings.length}</span>
              )}
              {t.id === 'people' && d.cosigners.length > 0 && (
                <span className="seg-badge">{d.cosigners.length}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 20 }}>
          {tab === 'overview' && (
            <OverviewTab tenancy={active} dossier={d} />
          )}
          {tab === 'payments' && (
            <PaymentsTab tenancy={active} />
          )}
          {tab === 'activity' && (
            <ActivityTab dossier={d} tenancies={tenancies} />
          )}
          {tab === 'leases' && (
            <LeasesTab dossier={d} onOpenDocument={openDocument} />
          )}
          {tab === 'people' && (
            <PeopleTab dossier={d} />
          )}
        </div>
      </div>

      {composing && (
        <NoticeComposer
          tenantId={tenantId}
          tenantName={name || d.tenant.email}
          planTenantId={active?.payer.planTenantId ?? null}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false)
            setFlash('First notice sent and recorded on this tenant’s file.')
            load()
          }}
        />
      )}
    </>
  )
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ tenancy, dossier }: { tenancy: Tenancy | null; dossier: Dossier }) {
  if (!tenancy) {
    return (
      <div className="empty">
        <div className="empty-title">No rent is being collected for this tenant</div>
        <div className="empty-sub">
          They have no payment plan on this account yet, so there is nothing to track. Set one up
          from Financials and their record will start building here.
        </div>
        <Link className="btn-primary" href="/landlord/financials/new">Set up rent collection</Link>
      </div>
    )
  }

  const { payer, record } = tenancy
  const rule = payer.rule

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <div>
            <div className="panel-title">Payment record, month by month</div>
            <div className="muted sm" style={{ marginTop: 3 }}>
              {payer.propertyName}{payer.dueDay ? ` · rent due on the ${payer.dueDay}` : ''}
              {payer.matchedBy === 'name' && ' · matched to this tenant by name, not email address'}
            </div>
          </div>
          <div className="panel-note">
            {record.streak > 0
              ? `${plural(record.streak, 'month')} on time in a row`
              : record.paidLate > 0 ? `${plural(record.avgDaysLate, 'day')} late on average` : ''}
          </div>
        </div>
        <div className="panel-bd">
          <Timeline record={record} />
        </div>
      </section>

      <div className="tn-grid">
        <section className="panel">
          <div className="panel-hd"><div className="panel-title">What they are billed</div></div>
          <div className="panel-bd">
            {payer.lineItems.length > 0 ? (
              <>
                {payer.lineItems.map((li, i) => (
                  <div className="sline" key={i}>
                    <span className="sline-lbl">
                      {li.label}
                      {li.notes && <span className="sline-note">{li.notes}</span>}
                    </span>
                    <span className="sline-amt">{fmtMoney(li.amount)}</span>
                  </div>
                ))}
                <div className="sline total">
                  <span className="sline-lbl">Every month</span>
                  <span className="sline-amt">{fmtMoney(payer.monthlyTotal)}</span>
                </div>
              </>
            ) : (
              <div className="sline total">
                <span className="sline-lbl">Every month</span>
                <span className="sline-amt">{fmtMoney(payer.monthlyTotal)}</span>
              </div>
            )}
            <dl className="tn-dl" style={{ marginTop: 16 }}>
              <dt>Collected to date</dt><dd>{fmtMoney(record.collected)} of {fmtMoney(record.billed)}</dd>
              <dt>Late-fee rule</dt>
              <dd>
                {rule && rule.fee_amount > 0
                  ? `${fmtMoney(rule.fee_amount)} every ${rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`}${rule.grace_period_days > 0 ? `, after ${plural(rule.grace_period_days, 'day')} grace` : ''}`
                  : 'none on this lease'}
              </dd>
              {payer.status && <><dt>On the plan</dt><dd>{titleCase(payer.status)}</dd></>}
              {payer.terminationDate && <><dt>Ends</dt><dd>{fmtDay(payer.terminationDate)}</dd></>}
            </dl>
          </div>
        </section>

        <section className="panel">
          <div className="panel-hd">
            <div className="panel-title">Notices sent</div>
            <div className="panel-note">{dossier.warnings.length || 'none'}</div>
          </div>
          <div className="panel-bd">
            {dossier.warnings.length === 0 ? (
              <div className="muted">
                No written notice has gone to this tenant. Reminders are not notices — a notice
                names itself as one, states a deadline, and copies the co-signer.
              </div>
            ) : dossier.warnings.map(w => (
              <div key={w.id} className="sline">
                <span className="sline-lbl">
                  <b style={{ fontWeight: 600 }}>
                    {w.level === 1 ? 'First notice' : w.level === 2 ? 'Second notice' : 'Final notice'}
                  </b>
                  <span className="sline-note">
                    {fmtDay(w.asOf)} · {plural(w.daysLate, 'day')} past due at the time ·{' '}
                    {w.sends.length === 0
                      ? 'no sends recorded'
                      : w.sends.map(s => `${s.name || s.email} (${EMAIL_OUTCOME[s.outcome].label.toLowerCase()})`).join(', ')}
                  </span>
                  {w.note && <span className="sline-note">&ldquo;{w.note}&rdquo;</span>}
                </span>
                <span className="sline-amt owed">{fmtMoney(w.totalDue)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {record.charges.waived.length > 0 && (
        <section className="panel">
          <div className="panel-hd">
            <div className="panel-title">Fees you have written off</div>
            <div className="panel-note">{fmtMoney(record.waived)} of goodwill</div>
          </div>
          <div className="panel-bd">
            {record.charges.waived.map(w => (
              <div className="sline" key={w.id}>
                <span className="sline-lbl">
                  {w.label}
                  <span className="sline-note">
                    Waived {fmtDay(w.waivedOn)}{w.note ? ` — "${w.note}"` : ''}
                  </span>
                </span>
                <span className="sline-amt good">{fmtMoney(w.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {dossier.tenant.notes && (
        <section className="panel">
          <div className="panel-hd"><div className="panel-title">Your notes</div></div>
          <div className="panel-bd"><div className="muted">{dossier.tenant.notes}</div></div>
        </section>
      )}
    </>
  )
}

// ─── Payments ────────────────────────────────────────────────────────────────

/**
 * The timeline as text.
 *
 * The same rows, the same outcomes, the same days-late figures — which is the
 * point: colour is never the only way to read this page, and a landlord sending
 * a screenshot to an accountant needs the words.
 */
function PaymentsTab({ tenancy }: { tenancy: Tenancy | null }) {
  if (!tenancy) return <div className="empty"><div className="empty-title">No rent is being collected for this tenant</div></div>
  const { payer, record } = tenancy

  const toneClass = (t: string) =>
    t === 'good' ? 'st-good' : t === 'bad' ? 'st-bad' : t === 'warn' ? 'st-warn' : t === 'info' ? 'st-info' : 'st-quiet'

  const byId = new Map(payer.scheduled.map(s => [s.id, s]))

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <div className="panel-title">Rent</div>
          <div className="panel-note">{plural(record.timeline.length, 'month')} scheduled</div>
        </div>
        <div className="panel-bd flush">
          <div className="tbl-scroll">
            <table className="tbl roomy">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Due</th>
                  <th className="num">Rent</th>
                  <th className="num">Paid</th>
                  <th>Outcome</th>
                  <th>Sent</th>
                  <th className="num">Days late</th>
                  <th className="num">Fee owed</th>
                  <th>How</th>
                </tr>
              </thead>
              <tbody>
                {[...record.timeline].reverse().map(s => {
                  const raw = byId.get(s.id)
                  const meta = OUTCOME_META[s.outcome]
                  const method = raw?.payment_method as keyof typeof METHOD_META | undefined
                  return (
                    <tr key={s.id}>
                      <td className="cell-main"><b>{s.month}</b></td>
                      <td>{fmtDay(s.dueDate)}</td>
                      <td className="num">{fmtMoney(s.amount)}</td>
                      <td className="num">{s.paid > 0 ? fmtMoney(s.paid) : <span className="num dim">—</span>}</td>
                      <td><span className={`st ${toneClass(meta.tone)}`} title={meta.hint}>{meta.label}</span></td>
                      <td>{s.settledOn ? fmtDay(s.settledOn) : <span className="num dim">—</span>}</td>
                      <td className="num">{s.daysLate > 0 ? <span className="num bad">{s.daysLate}</span> : <span className="num dim">0</span>}</td>
                      <td className="num">{s.lateFee > 0 ? <span className="num warn">{fmtMoney(s.lateFee)}</span> : <span className="num dim">—</span>}</td>
                      <td>
                        {method && METHOD_META[method]
                          ? METHOD_META[method].short
                          : raw?.recorded_by ? 'By hand' : <span className="num dim">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {record.timeline.some(s => s.outcome === 'clearing') && (
          <div className="panel-ft">
            A clearing payment has been sent by the tenant and is still moving through the bank.
            Its late fee is frozen at the day it was sent — the bank&rsquo;s delay is not theirs to pay for.
          </div>
        )}
      </section>

      {payer.specials.length > 0 && (
        <section className="panel">
          <div className="panel-hd"><div className="panel-title">Deposits and one-off charges</div></div>
          <div className="panel-bd flush">
            <div className="tbl-scroll">
              <table className="tbl roomy">
                <thead>
                  <tr>
                    <th>Charge</th><th>Due</th><th className="num">Amount</th><th>Status</th><th>Settled</th>
                  </tr>
                </thead>
                <tbody>
                  {payer.specials.map(sp => (
                    <tr key={sp.id}>
                      <td className="cell-main">
                        <b>{sp.label}</b>
                        {sp.notes && <em>{sp.notes}</em>}
                      </td>
                      <td>{sp.due_date ? fmtDay(sp.due_date) : <span className="num dim">no date</span>}</td>
                      <td className="num">{fmtMoney(sp.amount)}</td>
                      <td>
                        <span className={`st ${sp.status === 'paid' ? 'st-good' : sp.status === 'waived' ? 'st-quiet' : 'st-warn'}`}>
                          {titleCase(sp.status)}
                        </span>
                      </td>
                      <td>{sp.paid_date ? fmtDay(sp.paid_date) : <span className="num dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

// ─── Activity ────────────────────────────────────────────────────────────────

/**
 * Everything that has happened *around* the money: attempts to pay, emails
 * sent, and whether this person can get into the portal at all.
 *
 * The last of those is the one that changes a landlord's mind. A tenant who has
 * never signed in is not ignoring the payment links — they cannot use them.
 */
function ActivityTab({ dossier, tenancies }: { dossier: Dossier; tenancies: Tenancy[] }) {
  const a = dossier.account
  const attempts = dossier.attempts
  const failedCount = attempts.filter(x => x.status === 'failed').length
  const planName = new Map(tenancies.map(t => [t.payer.planId, t.payer.propertyName]))

  return (
    <>
      <div className="tn-grid">
        <section className="panel">
          <div className="panel-hd">
            <div className="panel-title">Portal account</div>
            <div className="panel-note">{a.exists ? 'registered' : 'no account'}</div>
          </div>
          <div className="panel-bd">
            {!a.exists ? (
              <div className="muted">
                <b style={{ color: 'var(--ink)' }}>There is no account on {dossier.tenant.email}.</b>{' '}
                They cannot sign in, which means they cannot pay online or read their lease —
                every payment link we have sent them has led to a sign-in page they have no
                password for. Worth checking the address is right before escalating.
              </div>
            ) : (
              <dl className="tn-dl">
                <dt>Last signed in</dt>
                <dd>{a.lastSignInAt ? `${fmtWhen(a.lastSignInAt)} (${ago(a.lastSignInAt)})` : 'never'}</dd>
                <dt>Account created</dt>
                <dd>{a.createdAt ? fmtDay(a.createdAt.slice(0, 10)) : '—'}</dd>
                <dt>Email confirmed</dt>
                <dd>{a.emailConfirmedAt ? fmtDay(a.emailConfirmedAt.slice(0, 10)) : 'not confirmed'}</dd>
                <dt>Tenant record added</dt>
                <dd>{fmtDay(dossier.tenant.created_at.slice(0, 10))}</dd>
              </dl>
            )}
            {dossier.visits.count > 0 && (
              <div className="muted sm" style={{ marginTop: 14 }}>
                Also seen browsing the public site {plural(dossier.visits.count, 'time')},
                last {ago(dossier.visits.lastAt!)}.
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-hd">
            <div className="panel-title">Attempts to pay</div>
            <div className="panel-note">
              {attempts.length === 0 ? 'none through the platform' : plural(attempts.length, 'attempt')}
            </div>
          </div>
          <div className="panel-bd">
            {attempts.length === 0 ? (
              <div className="muted">
                Nothing has been paid through the platform on this tenancy. Rent recorded by hand
                shows in the Payments tab instead.
              </div>
            ) : (
              <>
                {failedCount > 0 && (
                  <div className="tn-err" style={{ marginBottom: 12 }}>
                    {plural(failedCount, 'payment')} failed. A failed debit resets the charge to
                    unpaid and leaves no trace on it — this is the only record of it.
                  </div>
                )}
                {attempts.slice(0, 14).map(x => (
                  <div className="sline" key={x.id}>
                    <span className="sline-lbl">
                      <span className={`st ${x.status === 'cleared' ? 'st-good' : x.status === 'failed' ? 'st-bad' : 'st-info'}`}>
                        {x.status === 'cleared' ? 'Cleared' : x.status === 'failed' ? 'Failed' : 'Clearing'}
                      </span>
                      {x.method === 'ach' ? 'Bank transfer' : x.method === 'card' ? 'Card' : titleCase(x.method ?? 'unknown')}
                      <span className="sline-note">
                        {planName.get(x.planId) ?? 'Lease'} ·{' '}
                        {x.items.map(i => i.label).join(', ')}
                        {x.submittedAt && ` · sent ${fmtWhen(x.submittedAt)}`}
                        {x.clearedAt && ` · landed ${fmtDay(x.clearedAt.slice(0, 10))}`}
                        {x.failureMessage && ` · ${x.failureMessage}`}
                      </span>
                    </span>
                    <span className={`sline-amt${x.status === 'failed' ? ' owed' : x.status === 'cleared' ? ' good' : ''}`}>
                      {fmtMoney(x.amount)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-hd">
          <div className="panel-title">Everything we have sent them</div>
          <div className="panel-note">
            {dossier.emails.length === 0 ? 'nothing yet' : plural(dossier.emails.length, 'email')}
          </div>
        </div>
        <div className="panel-bd flush">
          {dossier.emails.length === 0 ? (
            <div className="pad"><div className="muted">No money email has been sent to this address.</div></div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Sent</th><th>Kind</th><th>To</th><th className="num">Amount</th><th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.emails.slice(0, 60).map(e => {
                    const meta = EMAIL_OUTCOME[e.outcome]
                    return (
                      <tr key={e.id}>
                        <td title={fmtWhen(e.createdAt)}>{ago(e.createdAt)}</td>
                        <td className="cell-main">
                          <b>{kindLabel(e.kind)}</b>
                          <em>{e.subject}</em>
                        </td>
                        <td className="cell-main">
                          <b>{e.recipientName || e.recipientEmail}</b>
                          <em>
                            {e.audience === 'cosigner' ? 'co-signer copy' : e.recipientEmail}
                            {e.trigger === 'auto' && ' · automatic'}
                          </em>
                        </td>
                        <td className="num">{e.amountTotal > 0 ? fmtMoney(e.amountTotal) : <span className="num dim">—</span>}</td>
                        <td>
                          <span
                            className={`out out-${meta.tone}`}
                            title={e.error ?? meta.hint}
                          >
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="panel-ft">
          A bounced reminder looks exactly like a tenant ignoring you.{' '}
          <Link className="lnk" href="/landlord/reminders">See the whole correspondence log →</Link>
        </div>
      </section>
    </>
  )
}

// ─── Leases & files ──────────────────────────────────────────────────────────

function LeasesTab({
  dossier, onOpenDocument,
}: { dossier: Dossier; onOpenDocument: (path: string) => void }) {
  const today = new Date().toISOString().slice(0, 10)

  const stage = (start: string, end: string) =>
    start > today ? { label: 'Upcoming', cls: 'idle' }
      : end < today ? { label: 'Ended', cls: 'idle' }
      : { label: 'Current', cls: 'in' }

  if (dossier.leases.length === 0) {
    return (
      <div className="empty">
        <div className="empty-title">No lease on file</div>
        <div className="empty-sub">
          This tenant is not named on any lease in your portfolio. Add them to one and the
          documents, amendments and renewals will gather here.
        </div>
        <Link className="btn-primary" href="/landlord/leases/new">Create a lease</Link>
      </div>
    )
  }

  return (
    <>
      <div className="tn-grid">
        {dossier.leases.map(l => {
          const st = stage(l.startDate, l.endDate)
          const others = l.housemates.filter(h => !h.isThisTenant)
          return (
            <section className="tn-lease" key={l.id}>
              <h3>
                {l.propertySlug
                  ? <Link className="lnk" href={`/landlord/listings/${l.propertySlug}`}>{l.propertyName}</Link>
                  : l.propertyName}
                <span className={`badge ${st.cls}`}>{st.label}</span>
                {l.isDemo && <span className="badge idle" title="A rehearsal, never billed">Demo</span>}
              </h3>
              <dl className="tn-dl" style={{ marginTop: 12 }}>
                <dt>Term</dt><dd>{fmtDay(l.startDate)} → {fmtDay(l.endDate)}</dd>
                {l.unitNumber && <><dt>Unit</dt><dd>{l.unitNumber}</dd></>}
                <dt>Lease rent</dt><dd>{l.rentAmount != null ? fmtMoney(l.rentAmount) : '—'}</dd>
                {others.length > 0 && (
                  <><dt>Lives with</dt><dd>{others.map(o => o.name || o.email).join(', ')}</dd></>
                )}
              </dl>
              {l.notes && <div className="muted sm" style={{ marginTop: 10 }}>{l.notes}</div>}

              <div className="tn-docs">
                {l.documents.length === 0 ? (
                  <div className="muted sm">No documents uploaded on this lease.</div>
                ) : l.documents.map(doc => (
                  <div className="tn-doc" key={doc.id}>
                    <span style={{ minWidth: 0 }}>
                      {doc.name}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)' }}>
                        added {fmtDay(doc.createdAt.slice(0, 10))}
                      </span>
                    </span>
                    <button className="btn-quiet sm" onClick={() => onOpenDocument(doc.storagePath)}>Open</button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14 }}>
                <Link className="btn-secondary sm" href={`/landlord/leases/${l.id}`}>Open the lease</Link>
              </div>
            </section>
          )
        })}
      </div>

      {(dossier.amendments.length > 0 || dossier.renewals.length > 0) && (
        <div className="tn-grid" style={{ marginTop: 16 }}>
          {dossier.amendments.length > 0 && (
            <section className="panel">
              <div className="panel-hd"><div className="panel-title">Amendments they signed</div></div>
              <div className="panel-bd">
                {dossier.amendments.map(am => (
                  <div className="sline" key={am.id}>
                    <span className="sline-lbl">
                      {am.title}
                      <span className="sline-note">
                        {titleCase(am.kind)}
                        {am.effectiveDate && ` · effective ${fmtDay(am.effectiveDate)}`}
                        {am.signedAt && ` · signed ${fmtDay(am.signedAt.slice(0, 10))}`}
                      </span>
                    </span>
                    <span className={`st ${am.status === 'signed' ? 'st-good' : am.status === 'declined' ? 'st-bad' : 'st-warn'}`}>
                      {titleCase(am.status)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {dossier.renewals.length > 0 && (
            <section className="panel">
              <div className="panel-hd"><div className="panel-title">Renewal offers</div></div>
              <div className="panel-bd">
                {dossier.renewals.map(r => (
                  <div className="sline" key={r.id}>
                    <span className="sline-lbl">
                      {r.newRent != null ? `${fmtMoney(r.newRent)} a month` : 'Renewal offer'}
                      <span className="sline-note">
                        {r.newStartDate && r.newEndDate && `${fmtDay(r.newStartDate)} → ${fmtDay(r.newEndDate)}`}
                        {r.respondBy && ` · reply by ${fmtDay(r.respondBy)}`}
                        {r.respondedAt && ` · answered ${fmtDay(r.respondedAt.slice(0, 10))}`}
                      </span>
                    </span>
                    <span className={`st ${r.status === 'accepted' ? 'st-good' : r.status === 'declined' ? 'st-bad' : 'st-warn'}`}>
                      {titleCase(r.status)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  )
}

// ─── Screening & co-signers ──────────────────────────────────────────────────

function PeopleTab({ dossier }: { dossier: Dossier }) {
  const checkTone = (c: { status: string | null; decision: string | null }) =>
    c.decision === 'passed' || c.status === 'approved' ? 'st-good'
      : c.decision === 'failed' || c.status === 'declined' ? 'st-bad' : 'st-warn'

  return (
    <>
      <section className="panel">
        <div className="panel-hd">
          <div className="panel-title">Co-signers</div>
          <div className="panel-note">
            {dossier.cosigners.length === 0 ? 'none on file' : plural(dossier.cosigners.length, 'guarantor')}
          </div>
        </div>
        <div className="panel-bd">
          {dossier.cosigners.length === 0 ? (
            <div className="muted">
              Nobody co-signed for this tenant, so a late-rent notice goes to them alone. A
              co-signer is added on their screening — see{' '}
              <Link className="lnk" href="/landlord/background-checks">Screening</Link>.
            </div>
          ) : dossier.cosigners.map(c => (
            <div className="sline" key={c.id}>
              <span className="sline-lbl">
                <b style={{ fontWeight: 600 }}>{c.name || c.email || 'Co-signer'}</b>
                <span className={`st ${checkTone(c)}`}>{titleCase(c.status ?? 'unknown')}</span>
                <span className="sline-note">
                  {c.relationship ? `${c.relationship} · ` : ''}
                  {c.email ? <a className="lnk" href={`mailto:${c.email}`}>{c.email}</a> : 'no email on file'}
                  {c.phone ? ` · ${c.phone}` : ''}
                  {c.incomeMonthly ? ` · ${fmtMoney(c.incomeMonthly)} a month declared` : ''}
                </span>
              </span>
              <Link className="btn-quiet sm" href={`/landlord/background-checks/${c.id}`}>Screening →</Link>
            </div>
          ))}
        </div>
        {dossier.cosigners.length > 0 && (
          <div className="panel-ft">
            A co-signer whose screening was not approved is not copied on a notice by default.
            They did not end up guaranteeing anything, and someone else&rsquo;s rent is not their business.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-hd">
          <div className="panel-title">Their own screening</div>
          <div className="panel-note">{dossier.checks.length || 'none'}</div>
        </div>
        <div className="panel-bd">
          {dossier.checks.length === 0 ? (
            <div className="muted">No background check on file for this tenant.</div>
          ) : dossier.checks.map(c => (
            <div className="sline" key={c.id}>
              <span className="sline-lbl">
                <b style={{ fontWeight: 600 }}>{c.name || dossier.tenant.email}</b>
                <span className={`st ${checkTone(c)}`}>{titleCase(c.status ?? 'unknown')}</span>
                <span className="sline-note">
                  Started {fmtDay(c.createdAt.slice(0, 10))}
                  {c.incomeMonthly ? ` · ${fmtMoney(c.incomeMonthly)} a month declared` : ''}
                  {c.decision ? ` · ${titleCase(c.decision)}` : ''}
                </span>
              </span>
              <Link className="btn-quiet sm" href={`/landlord/background-checks/${c.id}`}>Open →</Link>
            </div>
          ))}
        </div>
        {dossier.tenant.lead_id && (
          <div className="panel-ft">
            <Link className="lnk" href={`/landlord/leads/${dossier.tenant.lead_id}`}>
              See where this tenant came from →
            </Link>
          </div>
        )}
      </section>
    </>
  )
}
