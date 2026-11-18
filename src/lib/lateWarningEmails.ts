/**
 * The first formal notice that rent is late — to the resident, and to the
 * co-signer who guaranteed the lease.
 *
 * ── What this email is for ──────────────────────────────────────────────────
 *
 * A rent reminder says "this hasn't come through yet". A first notice says
 * something different and heavier: *the clock has started*. It is the document
 * that makes every later step defensible, and the one a tenant will reread if
 * things go badly. So it has to do three things at once, and the whole design
 * of this file is the tension between them:
 *
 *   1. **Be unambiguous.** It names itself as the first notice, says exactly
 *      what is unpaid, how late it is, what it costs, and what happens next if
 *      nothing changes. No euphemism. A notice a tenant can later claim they
 *      did not understand is not worth sending.
 *   2. **Be easy to act on.** One button, straight into the payment flow,
 *      quoting the figure. Most late rent on a student platform is a forgotten
 *      transfer or a thin week, not a refusal — and the cheapest outcome for
 *      everybody is that the tenant pays it this afternoon.
 *   3. **Not burn the relationship.** This person is staying for another eight
 *      months, and a landlord who writes like a collections agency on day two
 *      buys a tenant who stops replying to everything. So it opens by assuming
 *      good faith, offers a reply if they cannot pay right now, and tells them
 *      plainly when it is nothing more than a crossed-wires timing issue.
 *
 * ── The co-signer copy ──────────────────────────────────────────────────────
 *
 * A co-signer is not a cc. They signed a separate promise to pay this rent, and
 * they are usually a parent who would far rather hear about $900 now than about
 * $3,000 in March. So they get their own letter, in their own voice: it explains
 * who they are to this lease, states the same figures, and asks them to help
 * rather than accusing them of anything.
 *
 * It carries **no payment button**, on purpose. The portal's pay flow is behind
 * the resident's own login — a co-signer who followed it would land somewhere
 * that cannot take their money, which is the mistake `lateFeeEmails` documents
 * at length. They are asked to reply instead, which is the thing that actually
 * works.
 *
 * And the resident is *told* their co-signer was copied. Finding out afterwards
 * that their parent was written to behind their back is the single fastest way
 * to lose a tenant's trust, and it is also the fair thing to do.
 *
 * Pure: every figure comes in from `warningBasis` (src/lib/tenantRecord.ts), so
 * what the preview shows and what the recipient reads cannot drift.
 */
import { fmtMoney, type LateFeeRuleLike } from './rentPayments'
import type { WarningBasis, WarningLine } from './tenantRecord'

export type BuiltEmail = { subject: string; html: string; text: string }

/** Who is reading. See the file note — these are two different letters. */
export type WarningAudience = 'tenant' | 'cosigner'

export type LateWarningInput = {
  audience: WarningAudience
  /** 1 today. The sequence exists so notice #2 is a different letter, not a resend. */
  level: 1 | 2 | 3
  /** The resident, in both letters: the co-signer's is *about* them. */
  tenantName: string
  /** The person being addressed, when that is not the resident. */
  recipientName?: string | null
  /** 'Guardian', 'Parent' — as recorded on the co-signer's screening. */
  relationship?: string | null
  propertyName: string
  /** Unit or room, when the lease names one. */
  unitLabel?: string | null
  basis: WarningBasis
  /** Deep link into the tenant's payment flow. Tenant letter only. */
  payUrl: string
  /** The date the landlord is asking for it by, `YYYY-MM-DD`. */
  respondBy: string
  /** Quoted only when the plan actually carries a rule. */
  rule?: LateFeeRuleLike | null
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

const fmtShort = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const firstNameOf = (s: string) => s.trim().split(/\s+/)[0] || 'there'

const NOTICE_NAME: Record<1 | 2 | 3, string> = {
  1: 'First notice',
  2: 'Second notice',
  3: 'Final notice',
}

/** The lease's fee rule as one sentence a tenant can check their own maths on. */
export function ruleLine(rule: LateFeeRuleLike): string {
  const per = rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`
  const grace = rule.grace_period_days > 0
    ? ` once the ${plural(rule.grace_period_days, 'day')} grace period has passed`
    : ''
  const cap = rule.max_total_fees != null
    ? `, up to ${fmtMoney(rule.max_total_fees)} in total`
    : ''
  return `Your lease charges a late fee of ${fmtMoney(rule.fee_amount)} every ${per}${grace}${cap}.`
}

/** Every line the notice chases, in reading order: rent, charges, then fees. */
function allLines(basis: WarningBasis): WarningLine[] {
  return [...basis.rent, ...basis.charges, ...basis.fees]
}

/** "7 days past due" / "since November 2" — how late this actually is. */
function latenessLine(basis: WarningBasis): string {
  const oldest = [...basis.rent, ...basis.charges]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (!oldest) return ''
  return basis.oldestDaysLate === 1
    ? `It was due on ${fmtDate(oldest.dueDate)} — one day ago.`
    : `It was due on ${fmtDate(oldest.dueDate)}, ${plural(basis.oldestDaysLate, 'day')} ago.`
}

const PALETTE = {
  1: { accent: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  2: { accent: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  3: { accent: '#991b1b', bg: '#fef2f2', border: '#fca5a5' },
} as const

/** The address line: "Del Rio · Room 3". */
function placeLine(input: LateWarningInput): string {
  return input.unitLabel
    ? `${input.propertyName} · ${input.unitLabel}`
    : input.propertyName
}

export function buildLateWarningEmail(input: LateWarningInput): BuiltEmail {
  const {
    audience, level, tenantName, recipientName, relationship, basis,
    payUrl, respondBy, rule, landlordName, landlordEmail, customMessage, copiedTo,
  } = input

  const toCosigner = audience === 'cosigner'
  const lines = allLines(basis)
  const total = basis.total
  const notice = NOTICE_NAME[level]
  const tone = PALETTE[level]
  const place = placeLine(input)
  const who = firstNameOf(toCosigner ? (recipientName || 'there') : tenantName)
  const tenantFirst = firstNameOf(tenantName)

  const subject = toCosigner
    ? `${notice}: rent past due on the lease you co-signed — ${place}`
    : `${notice}: rent past due — ${fmtMoney(total)} for ${place}`

  const heading = toCosigner
    ? `Rent on ${tenantFirst}'s lease is past due`
    : 'Your rent is past due'

  // Rule 3 in the file note, and it is the first sentence for a reason: this is
  // the line that decides whether the rest gets read as information or as an
  // attack.
  const lead = toCosigner
    ? `You co-signed the lease at ${place}${relationship ? ` as ${tenantFirst}'s ${relationship.toLowerCase()}` : ''}, so you are on this notice too. Nothing is being asked of you yet — we would rather you knew about it now, while it is still one month.`
    : 'This is the first written notice about it. If the payment is already on its way, or this has crossed with a transfer you have sent, you can ignore it.'

  const lateness = latenessLine(basis)

  // What actually happens next, stated once. A notice that threatens nothing in
  // particular is noise; one that threatens more than the lease allows is worse.
  const nextStep = toCosigner
    ? `If the balance is still outstanding after ${fmtDate(respondBy)}, a second notice goes to both of you.`
    : `Please settle it by ${fmtDate(respondBy)}. If it is still outstanding after that, a second notice goes to you and to your co-signer.`

  const feeSentence = rule && rule.fee_amount > 0 ? ruleLine(rule) : null
  const growing = basis.rentTotal > 0 || basis.chargeTotal > 0

  const helpLine = toCosigner
    ? `If you would like to settle it directly, or talk it through, reply to this email${landlordName ? ` — it goes straight to ${landlordName}` : ''}.`
    : `If you cannot pay the full amount right now, reply to this email and say so${landlordName ? ` — ${landlordName} would much rather hear from you than not` : ''}. A plan agreed in advance is always better than a missed payment.`

  const copyNote = !toCosigner && copiedTo && copiedTo.length > 0
    ? `A copy of this notice has also gone to ${copiedTo.join(' and ')}, who co-signed your lease.`
    : null

  // ── Plain text ────────────────────────────────────────────────────────────
  // Not an afterthought: this is what a forwarded notice looks like in half of
  // the mail clients a parent reads it in.
  const text = [
    `${notice.toUpperCase()} — ${heading}`,
    place,
    '',
    `Hi ${who},`,
    lead,
    ...(lateness ? ['', lateness] : []),
    ...(customMessage ? ['', `"${customMessage}"`] : []),
    '',
    'Outstanding:',
    ...lines.map(l => {
      const late = l.kind === 'late_fee'
        ? (l.rentSettled ? ' (fee on rent already paid)' : '')
        : ` — ${plural(l.daysLate, 'day')} past due`
      return `  ${l.label}: ${fmtMoney(l.amount)}${late}`
    }),
    '',
    `Total outstanding: ${fmtMoney(total)}`,
    ...(feeSentence && growing ? ['', feeSentence] : []),
    '',
    nextStep,
    ...(toCosigner ? [] : ['', `Pay online: ${payUrl}`]),
    '',
    helpLine,
    ...(copyNote ? ['', copyNote] : []),
    '',
    landlordName ? `— ${landlordName}${landlordEmail ? `, ${landlordEmail}` : ''}` : 'HomeHive',
  ].join('\n')

  // ── HTML ──────────────────────────────────────────────────────────────────
  const rowsHtml = lines.map(l => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:13.5px;color:#0f172a;font-weight:600;">${esc(l.label)}</div>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">
            ${l.kind === 'late_fee'
              ? (l.rentSettled
                  ? 'Fee on rent that has since been paid'
                  : `Fee accruing on ${fmtShort(l.dueDate)} rent`)
              : `Due ${fmtDate(l.dueDate)} · <span style="color:#b91c1c;font-weight:600;">${plural(l.daysLate, 'day')} past due</span>`}
          </div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;">
          ${fmtMoney(l.amount)}
        </td>
      </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:26px 14px 44px;">

  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
    <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
  </div>

  <div style="background:${tone.bg};border-left:4px solid ${tone.accent};padding:14px 24px;">
    <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.9px;color:${tone.accent};">
      ${esc(notice)}${toCosigner ? ' · Co-signer copy' : ''}
    </div>
    <div style="font-size:15.5px;font-weight:700;color:#0f172a;margin-top:3px;">${esc(place)}</div>
  </div>

  <div style="background:#fff;border-radius:0 0 14px 14px;padding:26px 24px 30px;">

    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:16px;">
      Hi ${esc(who)}, ${esc(lead)}
    </div>

    ${lateness ? `
    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:12px;">
      ${esc(lateness)}
    </div>` : ''}

    ${customMessage ? `
    <div style="margin-top:16px;background:#f8fafc;border-left:3px solid #cbd5e1;padding:11px 14px;font-size:13px;color:#475569;line-height:1.6;">
      ${esc(customMessage)}
    </div>` : ''}

    <!-- The figure -->
    <div style="margin-top:20px;background:${tone.bg};border:1px solid ${tone.border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${tone.accent};">
        Total outstanding
      </div>
      <div style="font-size:32px;font-weight:800;color:${tone.accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(total)}
      </div>
      ${basis.feeTotal > 0 ? `
      <div style="font-size:11.5px;color:${tone.accent};margin-top:6px;">
        ${fmtMoney(basis.rentTotal + basis.chargeTotal)} unpaid &middot; ${fmtMoney(basis.feeTotal)} in late fees
      </div>` : ''}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      ${rowsHtml}
    </table>

    ${feeSentence && growing ? `
    <div style="margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:10px 13px;font-size:12px;color:#92400e;line-height:1.55;">
      ${esc(feeSentence)} Settling the balance stops it there.
    </div>` : ''}

    <div style="margin-top:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;font-size:13px;color:#334155;line-height:1.6;">
      <b style="color:#0f172a;">What happens next.</b> ${esc(nextStep)}
    </div>

    ${toCosigner ? '' : `
    <div style="margin-top:22px;text-align:center;">
      <a href="${payUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:15px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:10px;">
        Pay ${fmtMoney(total)} now &rarr;
      </a>
      <div style="font-size:11px;color:#94a3b8;margin-top:9px;">
        Pay by bank transfer (2% fee) or card (5% fee).
      </div>
    </div>`}

    <div style="margin-top:22px;font-size:13px;color:#475569;line-height:1.65;">
      ${esc(helpLine)}
    </div>

    ${copyNote ? `
    <div style="margin-top:14px;font-size:12px;color:#94a3b8;line-height:1.6;">
      ${esc(copyNote)}
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
