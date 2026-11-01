/**
 * Asking a tenant to pay a late fee.
 *
 * A late fee is the single most disputed line a landlord ever sends, and the
 * reason is almost never the money — it is that the tenant cannot see where the
 * number came from. "You owe $105" invites an argument. "Rent was due Sept 1,
 * arrived Sept 8, the lease charges $15 a day after the due date, 7 days ×
 * $15 = $105" ends one. So this email is built around showing the arithmetic,
 * not around demanding the total.
 *
 * Two things it will not do:
 *
 *   • **Promise a payment it cannot take.** A fee on *settled* rent is not
 *     payable through the tenant portal — `/api/tenant/pay` only ever collects
 *     a fee riding on rent that is still owed, so a charge the tenant has
 *     already cleared offers nothing for the fee to attach to. Sending a "Pay
 *     now" button there would land the tenant on a page that cannot charge
 *     them. When the fee is not collectable online the email says how to settle
 *     it instead, and asks rather than instructs.
 *
 *   • **Pretend a stale fee is urgent.** A fee frozen four months ago is not
 *     getting worse and the email does not imply it is. Only a fee still
 *     accruing gets the daily-rate line, because only there is it true.
 */
import { fmtMoney, type LateFeeRuleLike } from './rentPayments'

export type LateFeeEmailRow = {
  /** 'September 2026 rent' */
  label: string
  dueDate: string
  /** The rent the fee is attached to. */
  rentAmount: number
  /** The fee outstanding on this charge. */
  fee: number
  daysLate: number
  /** Rent still owed on this charge — 0 once it has settled. */
  rentOutstanding: number
  /** The date the rent landed, for a charge that has settled. */
  paidOn: string | null
  /** The fee was trimmed to the size of the charge by an uncapped rule. */
  capped: boolean
}

export type BuiltEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * How one fee was arrived at, in one line a tenant can check against a bank
 * statement. This sentence is the whole point of the email.
 */
export function feeWorkings(row: LateFeeEmailRow, rule: LateFeeRuleLike): string {
  const unit = rule.frequency_days === 1 ? 'day' : `${rule.frequency_days}-day period`
  const chargeable = Math.max(0, row.daysLate - rule.grace_period_days)
  const periods = Math.floor(chargeable / Math.max(1, rule.frequency_days))
  const grace = rule.grace_period_days > 0
    ? ` after the ${plural(rule.grace_period_days, 'day')} grace period`
    : ''
  const arrival = row.paidOn
    ? `arrived ${fmtDate(row.paidOn)}, ${plural(row.daysLate, 'day')} late`
    : `is still unpaid, ${plural(row.daysLate, 'day')} past due`

  const sum = `${plural(periods, unit)}${grace} × ${fmtMoney(rule.fee_amount)}`
  return row.capped
    // Say plainly that the rule's own arithmetic was overridden downwards. A
    // tenant who multiplies it out and gets a bigger number than the one we
    // billed should find the discrepancy explained, not hidden.
    ? `Due ${fmtDate(row.dueDate)}, ${arrival}. The lease's fee of ${sum} would come to more than the rent itself, so it has been reduced to ${fmtMoney(row.fee)}.`
    : `Due ${fmtDate(row.dueDate)}, ${arrival}. ${sum} = ${fmtMoney(row.fee)}.`
}

export function buildLateFeeEmail(input: {
  tenantName: string
  propertyName: string
  rows: LateFeeEmailRow[]
  rule: LateFeeRuleLike
  /** Set only when the fee can genuinely be paid online — see the file note. */
  payUrl: string | null
  landlordName?: string | null
  landlordEmail?: string | null
  customMessage?: string | null
}): BuiltEmail {
  const { tenantName, propertyName, rows, rule, payUrl, landlordName, landlordEmail, customMessage } = input

  const total = rows.reduce((s, r) => s + r.fee, 0)
  const firstName = tenantName.trim().split(/\s+/)[0] || 'there'
  // Still growing only if some rent underneath is genuinely still owed.
  const growing = rows.some(r => r.rentOutstanding > 0)
  const perDay = rule.fee_amount / Math.max(1, rule.frequency_days)
  const rentStillOwed = rows.reduce((s, r) => s + r.rentOutstanding, 0)

  const heading = growing
    ? 'A late fee is building on your rent'
    : rows.length === 1
      ? 'A late fee on your rent payment'
      : 'Late fees on your rent payments'

  const lead = growing
    ? 'Your rent is past due, and the lease charges a late fee for each day it stays unpaid. Settling the rent stops the fee from growing.'
    // The rent is in. Say so first — a tenant who paid is owed that
    // acknowledgement before they are asked for anything else.
    : 'Thanks — your rent for the period below has been received in full. The payment arrived after the due date, so the lease\'s late fee applied. That fee is still outstanding.'

  const accent = growing ? '#b91c1c' : '#b45309'
  const bg = growing ? '#fef2f2' : '#fffbeb'
  const border = growing ? '#fecaca' : '#fde68a'

  const subject = `${growing ? 'Late fee accruing' : 'Outstanding late fee'} — ${fmtMoney(total)} for ${propertyName}`

  const howToPay = payUrl
    ? `Pay online: ${payUrl}`
    : `To settle it, reply to this email and ${landlordName || 'your landlord'} will confirm how to send it.`

  const text = [
    heading,
    '',
    `Hi ${firstName},`,
    lead,
    '',
    'HOW THIS WAS CALCULATED',
    `Your lease charges ${fmtMoney(rule.fee_amount)} every ${rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`}` +
      `${rule.grace_period_days > 0 ? `, after a ${plural(rule.grace_period_days, 'day')} grace period` : ''}` +
      `${rule.max_total_fees != null ? `, up to ${fmtMoney(rule.max_total_fees)}` : ''}.`,
    '',
    ...rows.flatMap(r => [
      `${r.label} — late fee ${fmtMoney(r.fee)}`,
      `  ${feeWorkings(r, rule)}`,
    ]),
    '',
    `Total late fees outstanding: ${fmtMoney(total)}`,
    ...(rentStillOwed > 0 ? [`Unpaid rent, separately: ${fmtMoney(rentStillOwed)}`] : []),
    ...(growing ? ['', `While the rent is unpaid this grows by about ${fmtMoney(perDay)} a day.`] : []),
    ...(customMessage ? ['', customMessage] : []),
    '',
    howToPay,
    '',
    'If you think any of this is wrong, reply and say so — it is worth sorting out rather than leaving.',
    ...(landlordEmail && landlordName ? ['', `— ${landlordName}`] : []),
  ].join('\n')

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

  <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px 24px 30px;">

    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">${esc(propertyName)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:20px;">
      Hi ${esc(firstName)}, ${esc(lead)}
    </div>

    ${customMessage ? `
    <div style="margin-top:16px;background:#f8fafc;border-left:3px solid #cbd5e1;padding:11px 14px;font-size:13px;color:#475569;line-height:1.6;">
      ${esc(customMessage)}
    </div>` : ''}

    <!-- The amount -->
    <div style="margin-top:20px;background:${bg};border:1px solid ${border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${accent};">
        Late fee${rows.length > 1 ? 's' : ''} outstanding
      </div>
      <div style="font-size:32px;font-weight:800;color:${accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(total)}
      </div>
      ${growing ? `
      <div style="font-size:11.5px;color:${accent};margin-top:6px;">
        Growing by about ${fmtMoney(perDay)} a day while the rent is unpaid
      </div>` : `
      <div style="font-size:11.5px;color:#92400e;margin-top:6px;">
        This amount is fixed — it stopped when your rent arrived
      </div>`}
    </div>

    <!-- The rule, stated before the charges it produced -->
    <div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#64748b;">
        How this was calculated
      </div>
      <div style="font-size:13px;color:#334155;line-height:1.6;margin-top:6px;">
        Your lease charges <b>${fmtMoney(rule.fee_amount)}</b> every
        ${rule.frequency_days === 1 ? 'day' : `${rule.frequency_days} days`} that rent is
        late${rule.grace_period_days > 0 ? `, after a <b>${plural(rule.grace_period_days, 'day')}</b> grace period` : ''}${rule.max_total_fees != null ? `, up to <b>${fmtMoney(rule.max_total_fees)}</b>` : ''}.
      </div>
    </div>

    <!-- Each fee, with its arithmetic shown -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      ${rows.map(r => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="font-size:13.5px;color:#0f172a;font-weight:600;">${esc(r.label)}</td>
              <td style="text-align:right;font-size:14px;font-weight:700;color:${accent};white-space:nowrap;">
                ${fmtMoney(r.fee)}
              </td>
            </tr>
          </table>
          <div style="font-size:11.5px;color:#64748b;margin-top:4px;line-height:1.55;">
            ${esc(feeWorkings(r, rule))}
          </div>
          ${r.rentOutstanding > 0 ? `
          <div style="font-size:11.5px;color:#b91c1c;margin-top:4px;">
            ${fmtMoney(r.rentOutstanding)} of rent is also still outstanding on this month.
          </div>` : ''}
        </td>
      </tr>`).join('')}
    </table>

    ${rentStillOwed > 0 ? `
    <div style="margin-top:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:10px 13px;font-size:12px;color:#991b1b;line-height:1.55;">
      Unpaid rent of <b>${fmtMoney(rentStillOwed)}</b> is separate from the fees above. Paying the rent is what stops the fees.
    </div>` : ''}

    ${payUrl ? `
    <div style="margin-top:24px;text-align:center;">
      <a href="${payUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:15px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:10px;">
        Settle this now →
      </a>
      <div style="font-size:11px;color:#94a3b8;margin-top:9px;">
        Pay by bank transfer (2% fee) or card (5% fee).
      </div>
    </div>` : `
    <div style="margin-top:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;font-size:13px;color:#334155;line-height:1.6;">
      <b>How to settle it:</b> because the rent itself is already paid, this fee
      can't be collected through the payment page. Reply to this email and
      ${landlordName ? `${esc(landlordName)} will` : 'your landlord will'} confirm how to send it.
    </div>`}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      If you think any of this is wrong — a payment date, or the fee itself —
      reply and say so. It is worth sorting out rather than leaving.
      ${landlordEmail ? `This goes straight to ${landlordName ? esc(landlordName) : 'your landlord'}.` : ''}
    </div>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}
