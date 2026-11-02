/**
 * Telling people a late fee was written off.
 *
 * Waiving used to be a silent act. The fee left the landlord's ledger and
 * disappeared from the tenant's portal, and nobody said anything. That is the
 * one message in the whole money area it is worth going out of our way to send,
 * for two reasons that have nothing to do with bookkeeping:
 *
 *   • A tenant who was chased about a fee and then hears nothing assumes the
 *     fee is still coming. The goodwill is spent and buys nothing. Said out
 *     loud, the same decision is the single most relationship-repairing email
 *     a landlord ever sends — and it is the moment they are most likely to be
 *     paid on time next month.
 *   • A disappearing charge looks like a bug. "You owed $105, now you don't,
 *     and here is who decided that and when" is the difference between a
 *     portal a tenant trusts and one they screenshot.
 *
 * Three rules this email keeps:
 *
 *   1. **It asks for nothing.** No payment link, no "but please pay the rest",
 *      no nudge riding along. A forgiveness email with a demand in it is a
 *      demand. If rent is still owed, that is said as a plain fact at the end,
 *      once, without a button.
 *   2. **It names the amount and the charge.** A tenant must be able to match
 *      it against the fee they were asked for.
 *   3. **It never shows the landlord's private note.** `reason` is the
 *      landlord's own record ("not enforceable this late"). Only the message
 *      they wrote *to* the tenant goes out.
 *
 * The landlord gets a separate, plainer copy: a receipt, because a write-off is
 * money they chose to give up and it should be as traceable as money received.
 */
import { fmtMoney } from './rentPayments'

export type WaivedFeeRow = {
  /** 'September 2026 rent' */
  label: string
  dueDate: string
  /** The fee forgiven on this charge. */
  amount: number
  /** Whether the tenant had already been asked for this one. */
  askedBefore: boolean
}

export type BuiltEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

const SHELL_TOP = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:26px 14px 44px;">
  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
    <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
  </div>
  <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px 24px 30px;">`

const SHELL_BOTTOM = `  </div>
</div>
</body>
</html>`

/** The forgiven charges as a table, shared by both copies of the email. */
function rowsTable(rows: WaivedFeeRow[], accent: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
    ${rows.map(r => `
    <tr>
      <td style="padding:11px 0;border-bottom:1px solid #f1f5f9;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="font-size:13.5px;color:#0f172a;font-weight:600;">${esc(r.label)}</td>
            <td style="text-align:right;font-size:14px;font-weight:700;color:${accent};white-space:nowrap;">
              ${fmtMoney(r.amount)} cleared
            </td>
          </tr>
        </table>
        <div style="font-size:11.5px;color:#64748b;margin-top:4px;line-height:1.55;">
          Rent due ${esc(fmtDate(r.dueDate))}${r.askedBefore ? ' · you were asked about this fee earlier — please disregard that request' : ''}
        </div>
      </td>
    </tr>`).join('')}
  </table>`
}

/**
 * The tenant's copy: the fee is gone, this is what it was, nothing is owed on
 * it, and here is who did it.
 */
export function buildWaiverTenantEmail(input: {
  tenantName: string
  propertyName: string
  rows: WaivedFeeRow[]
  /** The landlord's message to the tenant. Never the private `reason`. */
  tenantNote?: string | null
  landlordName?: string | null
  landlordEmail?: string | null
  /** Rent still genuinely owed across these charges, stated once, at the end. */
  rentOutstanding?: number
}): BuiltEmail {
  const { tenantName, propertyName, rows, tenantNote, landlordName, landlordEmail } = input
  const rentOutstanding = Math.max(0, Number(input.rentOutstanding ?? 0))

  const total = rows.reduce((s, r) => s + r.amount, 0)
  const firstName = tenantName.trim().split(/\s+/)[0] || 'there'
  const many = rows.length > 1
  const by = landlordName ? `${landlordName} has` : 'Your landlord has'

  const heading = many ? 'Your late fees have been waived' : 'Your late fee has been waived'
  const lead = `${by} cancelled ${many ? 'these late fees' : 'this late fee'}. You owe nothing on ${many ? 'them' : 'it'}, and nothing further will be charged for ${many ? 'those months' : 'that month'}.`
  const accent = '#047857'

  const subject = `${fmtMoney(total)} late fee${many ? 's' : ''} waived — ${propertyName}`

  const text = [
    heading,
    '',
    `Hi ${firstName},`,
    lead,
    '',
    ...rows.map(r => `${r.label} — ${fmtMoney(r.amount)} waived (rent due ${fmtDate(r.dueDate)})`
      + (r.askedBefore ? ' — you were asked about this fee earlier; please disregard that request.' : '')),
    '',
    `Total waived: ${fmtMoney(total)}`,
    ...(tenantNote ? ['', tenantNote] : []),
    ...(rentOutstanding > 0
      ? ['', `Separately, ${fmtMoney(rentOutstanding)} of rent is still outstanding. The waiver above covers the late fee only.`]
      : []),
    '',
    'Nothing is needed from you — this is a record of the change. Your payment history in HomeHive has been updated.',
    ...(landlordName ? ['', `— ${landlordName}`] : []),
  ].join('\n')

  const html = `${SHELL_TOP}
    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">${esc(propertyName)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:20px;">
      Hi ${esc(firstName)}, ${esc(lead)}
    </div>

    <!-- The amount. Green, because this is good news and should look like it. -->
    <div style="margin-top:20px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${accent};">
        Late fee${many ? 's' : ''} waived
      </div>
      <div style="font-size:32px;font-weight:800;color:${accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(total)}
      </div>
      <div style="font-size:11.5px;color:${accent};margin-top:6px;">
        Removed from your balance — there is nothing to pay
      </div>
    </div>

    ${tenantNote ? `
    <div style="margin-top:18px;background:#f8fafc;border-left:3px solid #cbd5e1;padding:11px 14px;font-size:13px;color:#475569;line-height:1.6;">
      ${esc(tenantNote)}
      ${landlordName ? `<div style="margin-top:6px;color:#94a3b8;font-size:11.5px;">— ${esc(landlordName)}</div>` : ''}
    </div>` : ''}

    ${rowsTable(rows, accent)}

    ${rentOutstanding > 0 ? `
    <!-- Stated once, as a fact, with no button. A forgiveness email carrying a
         demand reads as a demand. -->
    <div style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:11px 14px;font-size:12.5px;color:#475569;line-height:1.6;">
      Separately, <b>${fmtMoney(rentOutstanding)}</b> of rent is still outstanding. The waiver above
      covers the late fee only, and does not change the rent.
    </div>` : ''}

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      Nothing is needed from you — this email is your record of the change, and your payment
      history in HomeHive has been updated to match.
      ${landlordEmail ? `Questions? Replying goes straight to ${landlordName ? esc(landlordName) : 'your landlord'}.` : ''}
    </div>
${SHELL_BOTTOM}`

  return { subject, html, text }
}

/**
 * The landlord's copy: a receipt for money given up.
 *
 * Deliberately not a celebration. It states the amount, the tenant, the charges,
 * their own recorded reason, and whether the tenant was told — the four things
 * they would need months later to explain the gap between fees assessed and
 * fees collected.
 */
export function buildWaiverLandlordEmail(input: {
  landlordName?: string | null
  tenantName: string
  tenantEmail?: string | null
  propertyName: string
  leaseName: string
  rows: WaivedFeeRow[]
  /** The landlord's private note. Safe here — this is their own copy. */
  reason?: string | null
  tenantNote?: string | null
  tenantNotified: boolean
  /** Deep link back to the fee ledger. */
  ledgerUrl?: string | null
}): BuiltEmail {
  const {
    landlordName, tenantName, tenantEmail, propertyName, leaseName, rows,
    reason, tenantNote, tenantNotified, ledgerUrl,
  } = input

  const total = rows.reduce((s, r) => s + r.amount, 0)
  const many = rows.length > 1
  const firstName = (landlordName || '').trim().split(/\s+/)[0] || 'there'
  const accent = '#334155'

  const subject = `Waived ${fmtMoney(total)} in late fees for ${tenantName} — ${propertyName}`
  const notice = tenantNotified
    ? `${tenantName} has been emailed${tenantEmail ? ` at ${tenantEmail}` : ''} and told the fee${many ? 's are' : ' is'} cancelled.`
    : `${tenantName} has not been told. The fee${many ? 's have' : ' has'} been cleared in your books only.`

  const text = [
    `You waived ${fmtMoney(total)} in late fees`,
    '',
    `Hi ${firstName},`,
    `This is your record of a write-off on ${leaseName} (${propertyName}).`,
    '',
    ...rows.map(r => `${r.label} — ${fmtMoney(r.amount)} waived (rent due ${fmtDate(r.dueDate)})`),
    '',
    `Total waived: ${fmtMoney(total)}`,
    `Tenant: ${tenantName}${tenantEmail ? ` (${tenantEmail})` : ''}`,
    notice,
    ...(reason ? ['', `Your note: ${reason}`] : []),
    ...(tenantNote ? [`Sent to the tenant: ${tenantNote}`] : []),
    '',
    'These fees no longer appear as outstanding, and are reported as written off rather than collected.',
    ...(ledgerUrl ? ['', `Late fees: ${ledgerUrl}`] : []),
  ].join('\n')

  const html = `${SHELL_TOP}
    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">You waived ${fmtMoney(total)} in late fee${many ? 's' : ''}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">${esc(leaseName)} · ${esc(propertyName)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:18px;">
      Hi ${esc(firstName)}, this is your record of the write-off — a write-off is money you chose
      not to collect, so it is kept as traceable as money received.
    </div>

    <div style="margin-top:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12.5px;color:#475569;">
        <tr><td style="padding:3px 0;">Tenant</td><td style="padding:3px 0;text-align:right;color:#0f172a;font-weight:600;">${esc(tenantName)}${tenantEmail ? ` · ${esc(tenantEmail)}` : ''}</td></tr>
        <tr><td style="padding:3px 0;">Charges cleared</td><td style="padding:3px 0;text-align:right;color:#0f172a;font-weight:600;">${rows.length}</td></tr>
        <tr><td style="padding:3px 0;">Total waived</td><td style="padding:3px 0;text-align:right;color:#0f172a;font-weight:700;">${fmtMoney(total)}</td></tr>
      </table>
    </div>

    <div style="margin-top:14px;background:${tenantNotified ? '#ecfdf5' : '#fffbeb'};border:1px solid ${tenantNotified ? '#a7f3d0' : '#fde68a'};border-radius:10px;padding:11px 14px;font-size:12.5px;color:${tenantNotified ? '#047857' : '#b45309'};line-height:1.6;">
      ${esc(notice)}
    </div>

    ${reason ? `
    <div style="margin-top:14px;font-size:12.5px;color:#475569;line-height:1.6;">
      <b style="color:#0f172a;">Your note:</b> ${esc(reason)}
    </div>` : ''}
    ${tenantNote ? `
    <div style="margin-top:8px;font-size:12.5px;color:#475569;line-height:1.6;">
      <b style="color:#0f172a;">Sent to the tenant:</b> ${esc(tenantNote)}
    </div>` : ''}

    ${rowsTable(rows, accent)}

    ${ledgerUrl ? `
    <div style="margin-top:22px;text-align:center;">
      <a href="${ledgerUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:14px;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:10px;">
        Open your late fees →
      </a>
    </div>` : ''}

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      These fees no longer show as outstanding. They are reported as written off, never as collected,
      so your fee totals stay reconcilable. You can restore any of them from the late-fee panel.
    </div>
${SHELL_BOTTOM}`

  return { subject, html, text }
}
