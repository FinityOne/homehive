// Rent reminder sent by the landlord to one tenant.
//
// The tone shifts with how late the payment is — a courtesy nudge before the
// due date shouldn't read like a demand, and a 30-days-late notice shouldn't
// read like a friendly ping. Every version ends in the same place: the amount,
// and a button that actually pays it.

import { fmtMoney } from './rentPayments'

export type ReminderRow = {
  label: string
  dueDate: string
  amount: number
  daysLate: number
}

export type BuiltEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** Worst row drives the tone for the whole email. */
function tone(maxDaysLate: number) {
  if (maxDaysLate <= 0) return {
    key: 'upcoming' as const,
    subject: 'Rent reminder',
    heading: 'A quick reminder about your rent',
    lead: 'This is a friendly heads-up — nothing is late.',
    accent: '#0f172a', bg: '#f8fafc', border: '#e2e8f0',
  }
  if (maxDaysLate <= 5) return {
    key: 'due' as const,
    subject: 'Rent is due',
    heading: 'Your rent is now due',
    lead: 'It looks like this hasn\'t come through yet.',
    accent: '#b45309', bg: '#fffbeb', border: '#fde68a',
  }
  return {
    key: 'overdue' as const,
    subject: 'Rent is overdue',
    heading: 'Your rent is overdue',
    lead: 'This is now past due. Please settle it as soon as you can.',
    accent: '#b91c1c', bg: '#fef2f2', border: '#fecaca',
  }
}

export function buildRentReminderEmail(input: {
  tenantName: string
  propertyName: string
  rows: ReminderRow[]
  payUrl: string
  landlordName?: string | null
  landlordEmail?: string | null
  /** Included only when the landlord has a late-fee rule on the plan. */
  lateFeeNote?: string | null
  customMessage?: string | null
}): BuiltEmail {
  const { tenantName, propertyName, rows, payUrl, landlordName, landlordEmail, lateFeeNote, customMessage } = input

  const total = rows.reduce((s, r) => s + r.amount, 0)
  const maxLate = Math.max(0, ...rows.map(r => r.daysLate))
  const t = tone(maxLate)
  const firstName = tenantName.trim().split(/\s+/)[0] || 'there'

  const subject = `${t.subject} — ${fmtMoney(total)} for ${propertyName}`

  const text = [
    t.heading,
    '',
    `Hi ${firstName},`,
    t.lead,
    '',
    ...rows.map(r =>
      `${r.label} — ${fmtMoney(r.amount)} (due ${fmtDate(r.dueDate)}${r.daysLate > 0 ? `, ${r.daysLate} days late` : ''})`
    ),
    '',
    `Total due: ${fmtMoney(total)}`,
    ...(lateFeeNote ? ['', lateFeeNote] : []),
    ...(customMessage ? ['', customMessage] : []),
    '',
    `Pay online: ${payUrl}`,
    ...(landlordEmail ? ['', `Questions? Reply to this email${landlordName ? ` — ${landlordName}` : ''}.`] : []),
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

    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(t.heading)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">${esc(propertyName)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:20px;">
      Hi ${esc(firstName)}, ${esc(t.lead)}
    </div>

    ${customMessage ? `
    <div style="margin-top:16px;background:#f8fafc;border-left:3px solid #cbd5e1;padding:11px 14px;font-size:13px;color:#475569;line-height:1.6;">
      ${esc(customMessage)}
    </div>` : ''}

    <!-- The amount -->
    <div style="margin-top:20px;background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${t.accent};">
        Total due
      </div>
      <div style="font-size:32px;font-weight:800;color:${t.accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(total)}
      </div>
    </div>

    <!-- Breakdown -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:20px;">
      ${rows.map(r => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <div style="font-size:13.5px;color:#0f172a;font-weight:600;">${esc(r.label)}</div>
          <div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">
            Due ${fmtDate(r.dueDate)}${r.daysLate > 0 ? ` · <span style="color:#b91c1c;font-weight:600;">${r.daysLate} day${r.daysLate !== 1 ? 's' : ''} late</span>` : ''}
          </div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;">
          ${fmtMoney(r.amount)}
        </td>
      </tr>`).join('')}
    </table>

    ${lateFeeNote ? `
    <div style="margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:10px 13px;font-size:12px;color:#92400e;line-height:1.55;">
      ${esc(lateFeeNote)}
    </div>` : ''}

    <div style="margin-top:24px;text-align:center;">
      <a href="${payUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:15px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:10px;">
        Pay ${fmtMoney(total)} now →
      </a>
      <div style="font-size:11px;color:#94a3b8;margin-top:9px;">
        Pay by bank transfer (2% fee) or card (5% fee).
      </div>
    </div>

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      Already paid? Ignore this — it may have crossed with your payment.
      ${landlordEmail ? `Questions? Just reply to this email${landlordName ? ` and ${esc(landlordName)} will get back to you` : ''}.` : ''}
    </div>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}
