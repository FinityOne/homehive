'use client'

/**
 * One charge, opened from any payment line anywhere in the money area.
 *
 * Every figure in this product is dense by design, which leaves one question
 * none of them can answer: *what is this number made of?* A landlord on the
 * phone to a tenant needs the parts — the rent, the utilities riding on it, the
 * fee the rule assessed and the rule that assessed it, what has already
 * arrived, and who has been chased. That is what this sheet is.
 *
 * It lives here rather than inside a page because the point is that it is the
 * *same* sheet: a charge found in the overview's action list, in the aging
 * table on collections, in a month on the schedule and in a lease's own ledger
 * reads identically, so a landlord never has to work out whether two screens
 * are telling them the same thing.
 *
 * It is a drawer, not a page. A landlord inspecting the third row of a
 * forty-row aging table must not lose that table to look at one charge.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import { METHOD_META } from '@/lib/financialsRollup'
import { CHARGE_STATE_META, type Charge } from '@/lib/financialsMonth'
import { planHref } from '@/lib/financialsTree'
import PaymentEmailHistory, {
  emailsForCharge, type PlanEmail,
} from '@/components/payments/PaymentEmailHistory'

/** Paid / Overdue / Scheduled — the state of one charge, as a pill. */
export function StatePill({ state }: { state: Charge['state'] }) {
  const meta = CHARGE_STATE_META[state]
  return <span className={`st st-${meta.tone}`}>{meta.label}</span>
}

/** "2 hours ago" / "Aug 12" — recent things get relative time, older get a date. */
export function whenLabel(iso: string): string {
  const then = new Date(iso)
  const mins = Math.floor((Date.now() - then.getTime()) / 60000)
  if (mins < 1)     return 'Just now'
  if (mins < 60)    return `${mins}m ago`
  if (mins < 1440)  return `${Math.floor(mins / 60)}h ago`
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const dayOrdinal = (n: number) =>
  n % 10 === 1 && n !== 11 ? `${n}st`
  : n % 10 === 2 && n !== 12 ? `${n}nd`
  : n % 10 === 3 && n !== 13 ? `${n}rd`
  : `${n}th`

/**
 * Settlement time, to the minute when we have it and honestly vague when not.
 *
 * `paid_date` is a DATE column, so most historical rows genuinely have no time
 * of day. Printing "12:00 AM" for those would be inventing precision, so a row
 * without a recorded instant simply shows its date and says so on hover.
 */
export function settledLabel(
  p: { paidDate: string; settledAt: string | null },
): { date: string; time: string | null } {
  const date = new Date(p.paidDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  if (!p.settledAt) return { date, time: null }
  const d = new Date(p.settledAt)
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
  }
}

export default function ChargeSheet({
  charge: c, onClose,
}: {
  charge: Charge
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // The sheet is a layer over the page, so the page beneath must not scroll
    // out from under it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // What was actually emailed about this charge. The counters on the row can
  // only say "chased twice"; they cannot say to whom, when, or whether either
  // message arrived — which is the question being asked when a landlord opens
  // a charge that has gone quiet. Fetched per lease (one small request) and
  // filtered to this charge, the same way the lease ledger does it.
  const [sends, setSends] = useState<PlanEmail[] | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/payments/${c.planId}/emails`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        })
        const json = await res.json()
        if (live) setSends(res.ok ? (json.emails ?? []) : [])
      } catch {
        if (live) setSends([])
      }
    })()
    return () => { live = false }
  }, [c.planId])

  const mine = useMemo(
    () => emailsForCharge(sends ?? [], c.kind === 'rent' ? { scheduledId: c.id } : { specialId: c.id }),
    [sends, c.id, c.kind],
  )

  const st = c.settlement
  const when = st?.paidDate ? settledLabel({ paidDate: st.paidDate, settledAt: st.settledAt }) : null
  const method = st?.method ? METHOD_META[st.method] : null
  const paidTotal = (st?.net ?? 0) + (st?.lateFee ?? 0)

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={`${c.label} detail`}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-hd">
          <div className="sheet-id">
            <div className="sheet-title">
              {c.label}
              <StatePill state={c.state} />
            </div>
            <div className="sheet-sub">
              {c.propertyName} · {c.leaseName}
              {c.who && <> · {c.who}</>}
              {c.whoEmail && <> · {c.whoEmail}</>}
            </div>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="sheet-bd">
          {/* ── What was asked for ── */}
          <div className="sheet-sec">
            <div className="sheet-sec-hd">
              <h3>What was billed</h3>
              <span>
                due {fmtDate(c.dueDate)}
                {c.daysLate > 0 && <> · {c.daysLate} day{c.daysLate !== 1 ? 's' : ''} late</>}
              </span>
            </div>

            {c.lines.length > 0 ? (
              <>
                {c.lines.map((l, i) => (
                  <div key={i} className="sline">
                    <span className="sline-lbl">
                      {l.label}
                      {l.kind === 'utility' && <span className="pill plain">utility</span>}
                    </span>
                    <span className="sline-amt num">{fmtCurrency(l.amount)}</span>
                  </div>
                ))}
                <div className="sline sub">
                  <span className="sline-lbl">Charge total</span>
                  <span className="sline-amt num">{fmtCurrency(c.amount)}</span>
                </div>
              </>
            ) : (
              <div className="sline">
                <span className="sline-lbl">
                  {c.categoryLabel ?? 'Rent'}
                  {c.kind === 'charge' && <span className="pill plain">one-off</span>}
                </span>
                <span className="sline-amt num">{fmtCurrency(c.amount)}</span>
              </div>
            )}

            {(c.lateFee > 0 || c.lateFeePaid > 0) && (
              <div className="sline fee">
                <span className="sline-lbl">
                  Late fee assessed
                  {c.feeCapped && (
                    <span
                      className="pill warn"
                      title="This rule has no maximum, so it is held to the size of the charge"
                    >
                      capped at the charge
                    </span>
                  )}
                  {c.feeRule && <span className="sline-note">{c.feeRule}</span>}
                </span>
                <span className="sline-amt num">{fmtCurrency(c.lateFee + c.lateFeePaid)}</span>
              </div>
            )}

            {/* The figure the tenant should be quoted: shortfall plus fee. */}
            <div className="sline total">
              <span className="sline-lbl">
                {c.totalDue > 0 ? 'Still due now' : 'Settled in full'}
                {c.lateFee > 0 && (
                  <span className="sline-note">
                    {fmtCurrency(c.outstanding)} of the charge + {fmtCurrency(c.lateFee)} of late fees
                  </span>
                )}
              </span>
              <span className={`sline-amt num${c.totalDue > 0 ? ' owed' : ' good'}`}>
                {c.totalDue > 0 ? fmtCurrency(c.totalDue) : fmtCurrency(0)}
              </span>
            </div>
          </div>

          {/* ── What arrived ── */}
          <div className="sheet-sec">
            <div className="sheet-sec-hd">
              <h3>What has been paid</h3>
              {when && (
                <span>
                  {when.date}
                  {when.time ? ` · ${when.time}` : ' · time not recorded'}
                </span>
              )}
            </div>

            {!st || paidTotal === 0 ? (
              <p className="muted sm">
                Nothing has arrived against this charge yet.
                {c.state === 'scheduled' && ' It is not due yet.'}
                {c.state === 'clearing' && ' A bank transfer is clearing.'}
              </p>
            ) : (
              <>
                <div className="sline">
                  <span className="sline-lbl">
                    {c.kind === 'rent' ? 'Rent received' : 'Charge received'}
                    {method && (
                      <span className="mchip sm" style={{ background: method.bg, color: method.color }}>
                        {method.label}
                      </span>
                    )}
                    {st.recordedBy === 'landlord' && <span className="pill plain">recorded by you</span>}
                  </span>
                  <span className="sline-amt num good">{fmtCurrency(st.net)}</span>
                </div>
                {st.lateFee > 0 && (
                  <div className="sline">
                    <span className="sline-lbl">Late fee received</span>
                    <span className="sline-amt num good">{fmtCurrency(st.lateFee)}</span>
                  </div>
                )}
                <div className="sline sub">
                  <span className="sline-lbl">
                    Credited to you
                    {st.daysLate !== null && (
                      <span className="sline-note">
                        {st.daysLate > 0
                          ? `arrived ${st.daysLate} day${st.daysLate !== 1 ? 's' : ''} after the due date`
                          : st.daysLate < 0
                            ? `arrived ${Math.abs(st.daysLate)} day${st.daysLate !== -1 ? 's' : ''} early`
                            : 'arrived on the due date'}
                      </span>
                    )}
                  </span>
                  <span className="sline-amt num">{fmtCurrency(paidTotal)}</span>
                </div>
              </>
            )}
          </div>

          {/* ── What the tenant was actually sent ── */}
          <div className="sheet-sec">
            <div className="sheet-sec-hd">
              <h3>Emails about this charge</h3>
              <span>
                {sends === null ? 'loading…'
                  : mine.length > 0 ? `${mine.length} sent`
                  : 'none sent'}
              </span>
            </div>
            {sends === null ? (
              <p className="muted sm">Looking up what was sent…</p>
            ) : (
              <PaymentEmailHistory
                emails={mine}
                // Sends counted on the charge itself. Anything above the number
                // of logged emails happened before this history existed, and
                // saying so beats implying nobody was ever contacted.
                priorCount={c.chases.count + c.chases.feeCount}
                empty="No email has been sent to the tenant about this charge yet."
              />
            )}
            <p className="muted sm sheet-link">
              <Link className="lnk" href="/landlord/reminders">See every reminder sent →</Link>
            </p>
          </div>

          {c.notes && (
            <div className="sheet-sec">
              <div className="sheet-sec-hd"><h3>Note</h3></div>
              <p className="muted sm">{c.notes}</p>
            </div>
          )}
        </div>

        <div className="sheet-ft">
          <Link className="btn-secondary sm" href={`/landlord/reminders?plan=${c.planId}`}>
            Emails on this lease
          </Link>
          <Link className="btn-primary sm" href={planHref(c.planId)}>
            Open the rent ledger
          </Link>
        </div>
      </div>
    </div>
  )
}
