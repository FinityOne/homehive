/**
 * Closing out a tenancy that has already ended.
 *
 * ── Why this is not a notice ────────────────────────────────────────────────
 *
 * `lateWarningEmails` chases money on a *live* lease: the clock is running, the
 * balance is growing, and the letter's job is to start a defensible paper trail
 * before it gets worse. Every line of it assumes the tenant still lives there
 * and still has something to lose.
 *
 * This letter is the opposite situation and so it has to be a different letter:
 *
 *   • **The lease is over.** The tenant moved out, the keys are back, and there
 *     is no next month to threaten. "A second notice will follow" is an empty
 *     sentence here, and a tenant who reads one knows it.
 *   • **Nothing is accruing.** Every fee it reports froze on the day its rent
 *     landed. Borrowing the notice template's red urgency would be a lie about
 *     a figure that has not moved in months.
 *   • **The rent was paid.** That is the first thing this email says, because
 *     it is true and because a former tenant who met every month of rent is
 *     owed that acknowledgement before being asked for anything. What is left
 *     is the late fees the lease assessed along the way and nobody ever billed.
 *   • **It is a year-end tidy-up, and it says so.** The honest reason this is
 *     arriving in November about a lease that ended in July is that the books
 *     are being closed. Pretending to a fresh urgency invents a deadline the
 *     facts do not support, and the first thing the reader would do is ask why
 *     they are only hearing now.
 *
 * ── The co-signer copy ──────────────────────────────────────────────────────
 *
 * Same split as the notice, same reasoning: a co-signer signed their own
 * promise to pay this rent and gets their own letter rather than a cc. Theirs
 * explains who they are to a lease that has since ended, states the identical
 * figures, and asks for help rather than implying they did something wrong.
 *
 * Neither copy carries a payment button when the fees sit on settled rent, and
 * on a closed lease they always do. `/api/tenant/pay` only ever collects a fee
 * riding on rent that is *still owed* — there is nothing for a fee on cleared
 * rent to attach to, so a "Pay now" link would land either reader on a page
 * that cannot take their money. `lateFeeEmails` documents this at length; the
 * `payUrl` here exists only so a future caller with a genuinely payable balance
 * can pass one, and `null` is the expected value.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 *   1. **Invent a consequence.** The lease is discharged; the remedies that
 *      remain are a conversation, a payment plan, or a claim the landlord may
 *      or may not pursue. The letter asks, states a date it would like an
 *      answer by, and stops. It does not imply eviction, credit reporting, or
 *      collections, none of which this platform does.
 *   2. **Hide the arithmetic.** Every fee is shown with the rent it sits on,
 *      the day that rent arrived, and the multiplication — via `feeWorkings`,
 *      the same sentence builder the live late-fee email uses, so a tenant who
 *      checks one against the other finds them identical.
 *   3. **Quietly pocket an overpayment.** Fee money that arrived recorded as
 *      rent is credited and *shown* as credited. Billing a tenant twice for
 *      money they already sent is how a $1,400 ask becomes a dispute.
 *   4. **Round the cap into silence.** Where an uncapped daily rule accrued
 *      more than the rent itself and was held down to it, the letter says so
 *      and names both numbers. A reader who multiplies $15 by 55 days and gets
 *      more than we asked for should find that explained, not buried — it is a
 *      concession, and concessions only earn goodwill when they are visible.
 *
 * Pure: every figure arrives in `basis`, so the preview a landlord approves and
 * the letter the recipient opens cannot drift.
 */
import { fmtMoney, type LateFeeRuleLike } from './rentPayments'
import { feeWorkings, type LateFeeEmailRow, type BuiltEmail } from './lateFeeEmails'

export type { BuiltEmail }

/** Who is reading. See the file note — these are two different letters. */
export type CloseoutAudience = 'tenant' | 'cosigner'

/**
 * The tenancy, totalled. Computed once by the caller from the real charge rows
 * and the real rule, never re-derived in here.
 */
export type CloseoutBasis = {
  /** The lease term, `YYYY-MM-DD`. */
  leaseStart: string
  leaseEnd: string
  /** Rent charges the lease billed this payer. */
  monthsBilled: number
  /** How many of them arrived after their due day. */
  monthsLate: number
  /** Rent that actually arrived, across the whole tenancy. */
  rentCollected: number
  /** Every fee still outstanding, oldest first. */
  rows: LateFeeEmailRow[]
  /** The fee the rule assessed in total, before credits. */
  feeAssessed: number
  /** Fee money that arrived recorded as rent, credited back. */
  feeCredited: number
  /** What is actually being asked for: assessed − credited − waived. */
  feeOutstanding: number
  /** Rent still owed, if any. Zero on a properly closed tenancy. */
  rentOutstanding: number
  /** The date these figures were computed. */
  asOf: string
}

export type LeaseCloseoutInput = {
  audience: CloseoutAudience
  /** The former resident, in both letters: the co-signer's is *about* them. */
  tenantName: string
  /** The person being addressed, when that is not the resident. */
  recipientName?: string | null
  /** 'Parent', 'Guardian' — as recorded on the co-signer's record. */
  relationship?: string | null
  propertyName: string
  /** Unit or room, when the lease named one. */
  unitLabel?: string | null
  basis: CloseoutBasis
  rule: LateFeeRuleLike
  /** The date the landlord is asking for an answer by, `YYYY-MM-DD`. */
  settleBy: string
  /**
   * Only ever set when the balance is genuinely payable online. On a closed
   * lease it is `null` — see the file note.
   */
  payUrl?: string | null
  landlordName?: string | null
  landlordEmail?: string | null
  /** The landlord's own words, shown verbatim above the figures. */
  customMessage?: string | null
  /** Names of the co-signers copied, so the resident is told. */
  copiedTo?: string[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

const fmtMonthYear = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const firstNameOf = (s: string) => s.trim().split(/\s+/)[0] || 'there'

/**
 * The tenancy in one phrase: "August 2025 – July 2026".
 *
 * Months rather than exact dates, deliberately. This is the line that tells the
 * reader *which* tenancy is being discussed, and a former tenant thinks of it
 * as a school year, not as a pair of calendar dates. The precise term is stated
 * once, further down, where it belongs.
 */
export function termLabel(basis: CloseoutBasis): string {
  return `${fmtMonthYear(basis.leaseStart)} – ${fmtMonthYear(basis.leaseEnd)}`
}

/** The address line: "University Dr Palace · Room 3". */
function placeLine(input: LeaseCloseoutInput): string {
  return input.unitLabel
    ? `${input.propertyName} · ${input.unitLabel}`
    : input.propertyName
}

/**
 * The rule, as one sentence the reader can check their own maths against.
 *
 * Says "charged" rather than "charges": the lease is over, and a rule stated in
 * the present tense on a discharged lease reads as though it is still running.
 */
export function pastRuleLine(rule: LateFeeRuleLike): string {
  const per = rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`
  const grace = rule.grace_period_days > 0
    ? `, after a ${plural(rule.grace_period_days, 'day')} grace period`
    : ''
  const cap = rule.max_total_fees != null
    ? `, up to ${fmtMoney(rule.max_total_fees)} per month`
    : ''
  return `The lease charged a late fee of ${fmtMoney(rule.fee_amount)} for every ${per} rent was late${grace}${cap}.`
}

/**
 * How the record of the tenancy reads, in one sentence.
 *
 * Leads with what went right, because on a tenancy that paid every month that
 * is the headline fact and the reason the letter can afford to be warm.
 *
 * **"In full" is claimed from `rentOutstanding`, never from the month count.**
 * An earlier draft asserted "all 12 months were received in full" from
 * `monthsBilled` alone, while the same letter went on to report $1,483.92 of
 * unpaid rent further down — two sentences in one email contradicting each
 * other, which is worse than either being wrong on its own. A reader who spots
 * it stops believing any figure in the letter, including the correct ones. So
 * the warm sentence is only available when the balance actually supports it.
 */
export function recordLine(basis: CloseoutBasis): string {
  const months = plural(basis.monthsBilled, 'month')
  const rent = fmtMoney(basis.rentCollected)
  const lateClause = basis.monthsLate === 0
    ? null
    : `${
        basis.monthsLate === basis.monthsBilled
          ? 'Each of those payments'
          : `${basis.monthsLate} of those payments`
      } arrived after the due date, and the lease's late fee applied to ${
        basis.monthsLate === 1 ? 'it' : 'each one'
      }.`

  if (basis.rentOutstanding > 0) {
    // Nothing is said about rent being complete, because it is not.
    return `Across the tenancy, ${rent} of rent was received over ${months}. ${
      lateClause ? `${lateClause} ` : ''
    }`.trim()
  }

  if (basis.monthsLate === 0) {
    return `All ${months} of rent were received in full and on time.`
  }
  return `All ${months} of rent were received in full — ${rent} in total. ${lateClause}`
}

export function buildLeaseCloseoutEmail(input: LeaseCloseoutInput): BuiltEmail {
  const {
    audience, tenantName, recipientName, relationship, basis, rule,
    settleBy, payUrl, landlordName, landlordEmail, customMessage, copiedTo,
  } = input

  const toCosigner = audience === 'cosigner'
  const place = placeLine(input)
  const term = termLabel(basis)
  const who = firstNameOf(toCosigner ? (recipientName || 'there') : tenantName)
  const tenantFirst = firstNameOf(tenantName)
  const total = basis.feeOutstanding
  const rows = basis.rows
  const capped = rows.filter(r => r.capped)

  // Warm slate rather than the notice palette's red. The figure is real and the
  // letter does not soften it, but nothing here is an emergency and colouring
  // it like one would be the first false note.
  const accent = '#b45309'
  const tone = { bg: '#fffbeb', border: '#fde68a' }

  const subject = toCosigner
    ? `Closing out the ${term} lease you co-signed — ${fmtMoney(total)} outstanding`
    : `Closing out your ${term} tenancy — ${fmtMoney(total)} outstanding`

  const heading = toCosigner
    ? `One item left open on ${tenantFirst}'s lease`
    : 'One item left open from your tenancy'

  // The honest reason this is arriving now. See the file note: a letter about a
  // July lease landing in November has to answer "why now?" in its first breath
  // or the reader answers it for themselves, less charitably.
  const lead = toCosigner
    ? `You co-signed ${tenantFirst}'s lease at ${place}${relationship ? ` as their ${relationship.toLowerCase()}` : ''}. That lease ended on ${fmtDate(basis.leaseEnd)}, and as we close out the year's books there is one item still open on it.`
    : `Your lease at ${place} ended on ${fmtDate(basis.leaseEnd)}, and we hope the move went smoothly. As we close out the year's books, there is one item still open on it.`

  const record = recordLine(basis)

  // What is being asked, in the one sentence a skim-reader will take away.
  const ask = toCosigner
    ? `Nothing has gone wrong since — this is a tidy-up, not an escalation. We are raising it with you because the guarantee you signed covers it, and because it is easier to settle one known figure now than to leave it open indefinitely.`
    : `This is a tidy-up, not an escalation. The amount is fixed, nothing is being added to it, and we would like to get it to zero and close the file.`

  // The day the last of these fees stopped moving, so "fixed" is a checkable
  // claim rather than a reassurance. Falls back to the end of the lease, which
  // is the latest date any fee on it could possibly have frozen.
  const frozenSince = rows
    .map(r => r.paidOn)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? basis.leaseEnd

  const frozenLine = `Every fee below stopped growing the day its rent arrived. ${fmtMoney(total)} is the final figure — it has not moved since ${fmtDate(frozenSince)} and it will not.`

  const creditLine = basis.feeCredited > 0
    ? `The lease assessed ${fmtMoney(basis.feeAssessed)} in late fees in total. ${fmtMoney(basis.feeCredited)} of that already reached us alongside rent, so it has been credited — leaving ${fmtMoney(total)}.`
    : null

  const capLine = capped.length > 0
    ? `On ${capped.length === 1 ? `the ${fmtMonthYear(capped[0].dueDate)} payment` : `${capped.length} of these`}, the daily fee would have come to more than a month's rent. ${capped.length === 1 ? 'It has' : 'Each has'} been reduced to the rent itself rather than charged in full.`
    : null

  // No consequence is invented. The lease is discharged; what remains is a
  // request and a date. See rule 1 in the file note.
  const nextStep = toCosigner
    ? `If you can settle it, or would rather spread it out, reply to this email by ${fmtDate(settleBy)} and we will sort out the details.`
    : `Please reply by ${fmtDate(settleBy)} — either to settle it, or to tell us what would work. We would much rather agree something than leave it sitting here.`

  // "your rent" is wrong in the co-signer's copy — it is not their rent, and a
  // letter that muddles who paid what is the first thing a reader distrusts.
  const whoseRent = toCosigner ? `${tenantFirst}'s rent` : 'your rent'
  const howToSettle = payUrl
    ? `Pay online: ${payUrl}`
    : `There is no online payment for this one — the portal can only take money against a live charge, and ${whoseRent} is all settled. Reply to this email and ${landlordName || 'we'} will confirm the best way to send it.`

  const disputeLine = `If any of the dates or figures below look wrong, reply and say so. ${
    toCosigner ? 'We would rather correct the record than argue about it' : 'The record is only as good as what we have, and it is worth fixing rather than leaving'
  }.`

  const helpLine = toCosigner
    ? `Anything you would like to talk through, just reply${landlordName ? ` — it goes straight to ${landlordName}` : ''}.`
    : `Anything unclear, just reply${landlordName ? ` — it goes straight to ${landlordName}` : ''}.`

  const copyNote = !toCosigner && copiedTo && copiedTo.length > 0
    ? `A copy of this has also gone to ${copiedTo.join(' and ')}, who co-signed the lease.`
    : null

  const cosignerToldNote = toCosigner
    ? `${tenantFirst} has received this same letter, with the same figures.`
    : null

  // ── Plain text ────────────────────────────────────────────────────────────
  // Not an afterthought: a parent forwarding this to a spouse is as likely to
  // send the text part as the HTML, and a stripped-out table is unreadable.
  const text = [
    heading.toUpperCase(),
    `${place} · ${term}`,
    '',
    `Hi ${who},`,
    lead,
    '',
    record,
    '',
    ask,
    '',
    `OUTSTANDING LATE FEES: ${fmtMoney(total)}`,
    frozenLine,
    ...(creditLine ? ['', creditLine] : []),
    ...(customMessage ? ['', `"${customMessage}"`] : []),
    '',
    'HOW THIS WAS CALCULATED',
    pastRuleLine(rule),
    '',
    ...rows.flatMap(r => [
      `${r.label} — ${fmtMoney(r.fee)}`,
      `  ${feeWorkings(r, rule)}`,
    ]),
    '',
    `Total outstanding: ${fmtMoney(total)}`,
    ...(basis.rentOutstanding > 0
      ? ['', `Unpaid rent, separately: ${fmtMoney(basis.rentOutstanding)}`]
      : []),
    ...(capLine ? ['', capLine] : []),
    '',
    'WHAT WE ARE ASKING',
    nextStep,
    '',
    howToSettle,
    '',
    disputeLine,
    '',
    helpLine,
    ...(copyNote ? ['', copyNote] : []),
    ...(cosignerToldNote ? ['', cosignerToldNote] : []),
    '',
    landlordName ? `— ${landlordName}${landlordEmail ? `, ${landlordEmail}` : ''}` : 'HomeHive',
    `Figures as of ${fmtDate(basis.asOf)}.`,
  ].join('\n')

  // ── HTML ──────────────────────────────────────────────────────────────────
  const rowsHtml = rows.map(r => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:13.5px;color:#0f172a;font-weight:600;">${esc(r.label)}</div>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;line-height:1.55;">
            ${esc(feeWorkings(r, rule))}
          </div>
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;vertical-align:top;">
          ${fmtMoney(r.fee)}
        </td>
      </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:26px 14px 44px;">

  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
    <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
  </div>

  <div style="background:${tone.bg};border-left:4px solid ${accent};padding:14px 24px;">
    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;color:${accent};">
      Closed lease &middot; Year-end follow-up${toCosigner ? ' &middot; Co-signer copy' : ''}
    </div>
    <div style="font-size:15.5px;font-weight:700;color:#0f172a;margin-top:3px;">${esc(place)}</div>
    <div style="font-size:12.5px;color:#78716c;margin-top:2px;">${esc(term)}</div>
  </div>

  <div style="background:#fff;border-radius:0 0 14px 14px;padding:26px 24px 30px;">

    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:16px;">
      Hi ${esc(who)}, ${esc(lead)}
    </div>

    <!-- What went right, before anything is asked. -->
    <div style="margin-top:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 15px;font-size:13px;color:#166534;line-height:1.6;">
      ${esc(record)}
    </div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:16px;">
      ${esc(ask)}
    </div>

    ${customMessage ? `
    <div style="margin-top:16px;background:#f8fafc;border-left:3px solid #cbd5e1;padding:11px 14px;font-size:13px;color:#475569;line-height:1.6;">
      ${esc(customMessage)}
    </div>` : ''}

    <!-- The figure -->
    <div style="margin-top:20px;background:${tone.bg};border:1px solid ${tone.border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${accent};">
        Outstanding late fees
      </div>
      <div style="font-size:32px;font-weight:800;color:${accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(total)}
      </div>
      <div style="font-size:11.5px;color:#92400e;margin-top:6px;line-height:1.5;">
        Final figure &mdash; nothing has been added since ${fmtDate(frozenSince)}
      </div>
    </div>

    ${creditLine ? `
    <div style="margin-top:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:11px 14px;font-size:12.5px;color:#475569;line-height:1.6;">
      ${esc(creditLine)}
    </div>` : ''}

    <!-- The rule, stated before the charges it produced -->
    <div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#64748b;">
        How this was calculated
      </div>
      <div style="font-size:13px;color:#334155;line-height:1.6;margin-top:6px;">
        ${esc(pastRuleLine(rule))}
      </div>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;">
      ${rowsHtml}
      <tr>
        <td style="padding:13px 0 0;font-size:13.5px;font-weight:700;color:#0f172a;">Total outstanding</td>
        <td style="padding:13px 0 0;text-align:right;font-size:16px;font-weight:800;color:${accent};white-space:nowrap;">
          ${fmtMoney(total)}
        </td>
      </tr>
    </table>

    ${basis.rentOutstanding > 0 ? `
    <div style="margin-top:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:11px 14px;font-size:12.5px;color:#991b1b;line-height:1.55;">
      Separately, ${fmtMoney(basis.rentOutstanding)} of rent is still recorded as unpaid.
    </div>` : ''}

    ${capLine ? `
    <div style="margin-top:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:11px 14px;font-size:12.5px;color:#166534;line-height:1.6;">
      ${esc(capLine)}
    </div>` : ''}

    <div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;font-size:13px;color:#334155;line-height:1.6;">
      <b style="color:#0f172a;">What we are asking.</b> ${esc(nextStep)}
    </div>

    ${payUrl ? `
    <div style="margin-top:20px;text-align:center;">
      <a href="${payUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:15px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:10px;">
        Pay ${fmtMoney(total)} &rarr;
      </a>
    </div>` : `
    <div style="margin-top:14px;font-size:13px;color:#475569;line-height:1.65;">
      ${esc(howToSettle)}
    </div>`}

    <div style="margin-top:18px;font-size:13px;color:#475569;line-height:1.65;">
      ${esc(disputeLine)}
    </div>

    <div style="margin-top:14px;font-size:13px;color:#475569;line-height:1.65;">
      ${esc(helpLine)}
    </div>

    ${copyNote ? `
    <div style="margin-top:14px;font-size:12px;color:#94a3b8;line-height:1.6;">
      ${esc(copyNote)}
    </div>` : ''}

    ${cosignerToldNote ? `
    <div style="margin-top:14px;font-size:12px;color:#94a3b8;line-height:1.6;">
      ${esc(cosignerToldNote)}
    </div>` : ''}

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      ${landlordName ? `${esc(landlordName)}${landlordEmail ? ` &middot; <a href="mailto:${esc(landlordEmail)}" style="color:#0f7a43;">${esc(landlordEmail)}</a>` : ''}<br />` : ''}
      Sent through HomeHive on ${fmtDate(basis.asOf)}. Figures are as of that date.
    </div>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}
