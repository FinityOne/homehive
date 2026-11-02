'use client'

/**
 * One late fee, explained until there is nothing left to ask.
 *
 * A tenant looking at eleven fees totalling $1,431.96 — on rent they paid in
 * full, months ago, having never been asked — will not pay on the strength of a
 * number. The only thing that earns payment here is showing the work: which
 * month, when the rent was actually due, when it actually arrived, how many
 * days that was, what the rule charges per day, and the multiplication that
 * turns those into this figure. Then every reduction already applied, so the
 * total is visibly *after* credit rather than before it.
 *
 * Three things this deliberately does:
 *
 *   • It names the ceiling when one applied. "55 days × $15 = $825, capped at
 *     $741.96" is a strange sentence until you see it, and a tenant who works
 *     out 55 × 15 themselves and gets a bigger number than we are asking for
 *     deserves to know we already capped it rather than wonder what else is
 *     wrong.
 *   • It credits money they already sent, in words. Two of these charges were
 *     overpaid by exactly the fee and it was recorded as rent; showing "− $15
 *     you already paid with that month's rent" is the difference between a
 *     bill and an argument.
 *   • It says plainly that the rent itself is settled. Without that line the
 *     fee reads as a rent charge they have already paid, which is the single
 *     most likely misreading of this whole screen.
 *
 * Every figure comes from `explainLateFee`, which is also what the payment API
 * charges — so the sheet cannot justify one number and bill another.
 */
import { fmtMoney, type LateFeeExplanation } from '@/lib/rentPayments'

const fmtDay = (d: string | null) =>
  d
    ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
    : '—'

const fmtMonth = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default function LateFeeDetailSheet({
  explanation, onClose, onPay,
}: {
  explanation: LateFeeExplanation
  onClose: () => void
  /** Omitted when nothing is owed — a fully credited fee has nothing to pay. */
  onPay?: () => void
}) {
  const x = explanation
  const month = fmtMonth(x.dueDate)

  // The reductions, in the order they are applied. Each is money the tenant
  // does not owe, named so it cannot look like an arbitrary discount.
  const credits: { label: string; amount: number }[] = []
  if (x.overpaymentCredit > 0) {
    credits.push({
      label: `You already paid this with your ${month} rent`,
      amount: Math.min(x.overpaymentCredit, x.assessed),
    })
  }
  if (x.feePaid > 0) credits.push({ label: 'Already paid toward this fee', amount: x.feePaid })
  if (x.waived > 0) credits.push({ label: 'Waived by your landlord', amount: x.waived })

  const perPeriodLabel =
    x.frequencyDays === 1
      ? `${fmtMoney(x.perPeriod)} per day`
      : `${fmtMoney(x.perPeriod)} every ${x.frequencyDays} days`

  const periodWord = x.frequencyDays === 1
    ? plural(x.periods, 'day')
    : `${x.frequencyDays}-day ${plural(x.periods, 'period')}`

  return (
    <div className="lfd-back" onClick={onClose} role="presentation">
      <style>{CSS}</style>
      <div
        className="lfd"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Late fee for ${month} rent`}
      >
        <div className="lfd-hd">
          <div>
            <div className="lfd-kicker">Late fee</div>
            <div className="lfd-title">{month} rent</div>
          </div>
          <button className="lfd-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="lfd-body">
          <div className="lfd-amount">
            <div className="lfd-amount-v">{fmtMoney(x.outstanding)}</div>
            <div className="lfd-amount-l">
              {x.outstanding > 0 ? 'still owed' : 'nothing left to pay'}
            </div>
          </div>

          {/* The fact that resolves the most likely misreading, first. */}
          {x.rentSettled && (
            <div className="lfd-note good">
              {/* "Settled" rather than "paid in full": a landlord may close a
                  month by hand against money taken outside HomeHive, and two
                  of these charges are exactly that — status `paid` with no
                  recorded amount. Settled is true in both cases. */}
              <strong>Your {month} rent is settled.</strong> This fee is the only thing still
              outstanding on that month — it was charged at the time because the rent arrived
              late, and was never collected.
            </div>
          )}
          {!x.rentSettled && (
            <div className="lfd-note warn">
              <strong>This month&apos;s rent is still outstanding.</strong> The fee keeps growing
              until the rent is paid, so settling the rent stops it.
            </div>
          )}

          {/* What happened, as a timeline rather than prose. */}
          <div className="lfd-section">What happened</div>
          <ol className="lfd-time">
            <li>
              <span className="lfd-dot" />
              <div>
                <div className="lfd-t-l">Rent was due</div>
                <div className="lfd-t-v">{fmtDay(x.dueDate)}</div>
              </div>
            </li>
            {x.graceDays > 0 && (
              <li>
                <span className="lfd-dot" />
                <div>
                  <div className="lfd-t-l">
                    Grace period ended · {x.graceDays} {plural(x.graceDays, 'day')}
                  </div>
                  <div className="lfd-t-v">{fmtDay(x.graceEndDate)}</div>
                </div>
              </li>
            )}
            {/*
              When the tenant *sent* it — the step the fee is actually counted
              to. Without this the timeline read "Rent arrived Sep 10 · 1 day
              past due" and contradicted itself, because the fee is measured to
              submission and the rent landed eight clearing days later. Showing
              both dates is what makes "1 day" an explanation rather than an
              apparent mistake.
            */}
            {x.submittedAt && (
              <li>
                <span className="lfd-dot done" />
                <div>
                  <div className="lfd-t-l">You sent the payment</div>
                  <div className="lfd-t-v">
                    {fmtDay(x.asOfDate)}
                    <em className="lfd-late">
                      {x.daysPastDue} {plural(x.daysPastDue, 'day')} past due
                    </em>
                  </div>
                </div>
              </li>
            )}
            <li>
              <span className={`lfd-dot${x.rentSettled ? ' done' : ' open'}`} />
              <div>
                <div className="lfd-t-l">
                  {x.rentSettled
                    ? 'Rent arrived'
                    : x.submittedAt ? 'Still clearing' : 'Rent still unpaid'}
                </div>
                <div className="lfd-t-v">
                  {x.rentSettled ? fmtDay(x.paidDate) : `as of ${fmtDay(x.asOfDate)}`}
                  {/*
                    The lateness badge belongs to the submission step when there
                    is one: a bank taking six days to clear money sent on time
                    is not the tenant being six days late.
                  */}
                  {!x.submittedAt && (
                    <em className="lfd-late">
                      {x.daysPastDue} {plural(x.daysPastDue, 'day')} past due
                    </em>
                  )}
                  {x.submittedAt && x.rentSettled && x.paidDate !== x.asOfDate && (
                    <em className="lfd-clear">no fee for the clearing time</em>
                  )}
                </div>
              </div>
            </li>
          </ol>

          {/* The arithmetic, line by line, ending on the figure we are asking for. */}
          <div className="lfd-section">How the fee was worked out</div>
          <div className="lfd-math">
            <div className="lfd-m-row">
              <span>
                Your lease charges {perPeriodLabel}
                {x.graceDays > 0 ? `, after a ${x.graceDays}-day grace period` : ' once rent is late'}
              </span>
            </div>
            <div className="lfd-m-row calc">
              <span>
                {x.periods} {periodWord} × {fmtMoney(x.perPeriod)}
              </span>
              <span className="lfd-m-amt">{fmtMoney(x.accrued)}</span>
            </div>

            {x.cappedBy && (
              <div className="lfd-m-row cap">
                <span>
                  {x.cappedBy === 'charge' ? (
                    <>
                      Capped at one month&apos;s rent. A daily fee with no ceiling would have
                      reached {fmtMoney(x.accrued)}, which we don&apos;t charge — the fee is
                      never more than the rent it&apos;s attached to.
                    </>
                  ) : (
                    <>Capped at the maximum your lease allows.</>
                  )}
                </span>
                <span className="lfd-m-amt">{fmtMoney(x.assessed)}</span>
              </div>
            )}

            {credits.map(c => (
              <div key={c.label} className="lfd-m-row credit">
                <span>{c.label}</span>
                <span className="lfd-m-amt">− {fmtMoney(c.amount)}</span>
              </div>
            ))}

            <div className="lfd-m-row total">
              <span>Still owed</span>
              <span className="lfd-m-amt">{fmtMoney(x.outstanding)}</span>
            </div>
          </div>

          <div className="lfd-foot">
            Think this fee is wrong, or want it waived? Contact your landlord — they can remove it,
            and it will disappear from here.
          </div>
        </div>

        <div className="lfd-actions">
          {onPay && x.outstanding > 0 && (
            <button className="lfd-btn" onClick={onPay}>
              Pay this fee · {fmtMoney(x.outstanding)}
            </button>
          )}
          <button className="lfd-btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .lfd-back { position: fixed; inset: 0; background: rgba(15,23,42,0.6); z-index: 600;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    font-family: 'DM Sans', sans-serif; }
  .lfd { background: #fff; border-radius: 16px; width: 100%; max-width: 440px; max-height: 92vh;
    display: flex; flex-direction: column; overflow: hidden; }

  .lfd-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    padding: 18px 20px 14px; border-bottom: 1px solid #f1f5f9; }
  .lfd-kicker { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px;
    color: #b45309; margin-bottom: 3px; }
  .lfd-title { font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px; }
  .lfd-x { background: none; border: none; font-size: 26px; line-height: 1; color: #94a3b8;
    cursor: pointer; padding: 0 2px; }

  .lfd-body { padding: 18px 20px 20px; overflow: auto; }

  .lfd-amount { text-align: center; padding: 6px 0 18px; }
  .lfd-amount-v { font-size: 34px; font-weight: 800; color: #0f172a; letter-spacing: -1px; }
  .lfd-amount-l { font-size: 12px; color: #94a3b8; margin-top: 2px; }

  .lfd-note { border-radius: 9px; padding: 11px 14px; font-size: 12.5px; line-height: 1.6;
    margin-bottom: 18px; }
  .lfd-note.good { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
  .lfd-note.warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
  .lfd-note strong { display: block; }

  .lfd-section { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.7px; color: #94a3b8; margin-bottom: 10px; }

  .lfd-time { list-style: none; margin: 0 0 20px; padding: 0 0 0 4px; }
  .lfd-time li { display: flex; gap: 12px; padding-bottom: 14px; position: relative; }
  .lfd-time li:not(:last-child)::before { content: ''; position: absolute; left: 5px; top: 14px;
    bottom: 0; width: 2px; background: #e8e4db; }
  .lfd-dot { width: 12px; height: 12px; border-radius: 50%; background: #cbd5e1; flex: 0 0 12px;
    margin-top: 3px; z-index: 1; }
  .lfd-dot.done { background: #16a34a; }
  .lfd-dot.open { background: #f59e0b; }
  .lfd-t-l { font-size: 12px; color: #64748b; }
  .lfd-t-v { font-size: 13.5px; font-weight: 600; color: #0f172a; margin-top: 1px; }
  .lfd-late { display: inline-block; font-style: normal; font-size: 11px; font-weight: 700;
    color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 20px;
    padding: 1px 8px; margin-left: 7px; vertical-align: 1px; }

  /* Same badge shape as lfd-late, in the reassuring colour: this one is
     telling the tenant they were NOT charged for something. */
  .lfd-clear { display: inline-block; font-style: normal; font-size: 11px; font-weight: 700;
    color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 20px;
    padding: 1px 8px; margin-left: 7px; vertical-align: 1px; }

  .lfd-math { border: 1px solid #eef2f7; border-radius: 10px; overflow: hidden; }
  .lfd-m-row { display: flex; justify-content: space-between; gap: 12px; padding: 11px 13px;
    font-size: 12.5px; color: #475569; line-height: 1.55; }
  .lfd-m-row + .lfd-m-row { border-top: 1px solid #f8fafc; }
  .lfd-m-amt { font-weight: 700; color: #0f172a; white-space: nowrap; }
  .lfd-m-row.calc { background: #fafbfc; font-weight: 600; color: #0f172a; }
  .lfd-m-row.cap { background: #fffdf8; color: #92400e; font-size: 12px; }
  .lfd-m-row.credit { color: #166534; }
  .lfd-m-row.credit .lfd-m-amt { color: #166534; }
  .lfd-m-row.total { background: #0f172a; color: #fff; font-size: 14px; font-weight: 700;
    padding: 13px; }
  .lfd-m-row.total .lfd-m-amt { color: #34d399; font-size: 15px; }

  .lfd-foot { font-size: 11.5px; color: #94a3b8; line-height: 1.6; margin-top: 16px; }

  .lfd-actions { display: flex; gap: 8px; padding: 14px 20px 18px; border-top: 1px solid #f1f5f9; }
  .lfd-btn { flex: 1; background: #0f172a; color: #34d399; border: none; border-radius: 10px;
    padding: 13px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; }
  .lfd-btn.ghost { flex: 0 0 auto; background: #fff; color: #0f172a; border: 1.5px solid #e2e8f0;
    padding: 13px 20px; }

  @media (max-width: 460px) {
    .lfd-amount-v { font-size: 30px; }
    .lfd-actions { flex-direction: column-reverse; }
    .lfd-btn.ghost { flex: 1; }
  }
`
