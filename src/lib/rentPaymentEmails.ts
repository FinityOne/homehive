// Emails sent when money moves on a rent plan.
//
// Two audiences, one event. The tenant gets a receipt that breaks the charge
// into rent and the processing fee — Stripe's own receipt shows one lump sum
// under the Stripe account's business name, which reads like a stranger took
// the money. The landlord gets the thing the product promises: who paid, what
// it covered, by what method, and what is still outstanding.
//
// Follows the visual language of rentReminderEmails.ts on purpose — a tenant
// should recognise the receipt as coming from the same place as the reminder.

import { fmtMoney, METHOD_META, type PayMethod } from './rentPayments'

export type PaidRow = { label: string; amount: number }

/** What happened to the money. ACH sits in `processing` for days before either. */
export type PayEvent = 'paid' | 'processing' | 'failed'

export type BuiltEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDateTime = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || 'there'

const SHELL_OPEN = `<!DOCTYPE html>
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

const SHELL_CLOSE = `  </div>
</div>
</body>
</html>`

/** Rows table shared by both emails. */
function rowsTable(rows: PaidRow[]): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      ${rows.map(r => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#0f172a;font-weight:600;">
          ${esc(r.label)}
        </td>
        <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;">
          ${fmtMoney(r.amount)}
        </td>
      </tr>`).join('')}
    </table>`
}

const TONE: Record<PayEvent, { accent: string; bg: string; border: string }> = {
  paid:       { accent: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  processing: { accent: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  failed:     { accent: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
}

// ─── Tenant receipt ───────────────────────────────────────────────────────────

export function buildRentReceiptEmail(input: {
  tenantName: string
  propertyName: string
  event: PayEvent
  rows: PaidRow[]
  /** Rent itself — what the landlord's ledger records. */
  rent: number
  /** Surcharge the tenant paid on top; not rent. */
  fee: number
  method: PayMethod
  /** Everything this tenant still owes after this payment. */
  remaining: number
  paidOn: Date
  payUrl: string
  landlordName?: string | null
  landlordEmail?: string | null
  /** Stripe's id, so a bank-statement line can be matched to this email. */
  reference?: string | null
}): BuiltEmail {
  const {
    tenantName, propertyName, event, rows, rent, fee, method,
    remaining, paidOn, payUrl, landlordName, landlordEmail, reference,
  } = input

  const total = rent + fee
  const t = TONE[event]
  const methodLabel = METHOD_META[method].label
  const first = firstNameOf(tenantName)

  const heading =
    event === 'paid' ? 'Payment received — thank you'
    : event === 'processing' ? 'Payment submitted'
    : 'Your payment didn\'t go through'

  const lead =
    event === 'paid'
      ? `We've received your rent payment for ${propertyName}. Here's your receipt.`
      : event === 'processing'
      ? `Your bank transfer for ${propertyName} has been submitted. Bank transfers take 2–5 business days to clear — we'll email you again once it settles, and your landlord can already see it as submitted.`
      : `Your bank transfer for ${propertyName} was returned by your bank, so these charges are showing as unpaid again. No fee was taken. You can pay again below.`

  const subject =
    event === 'paid' ? `Receipt — ${fmtMoney(total)} for ${propertyName}`
    : event === 'processing' ? `Payment submitted — ${fmtMoney(total)} for ${propertyName}`
    : `Payment failed — ${fmtMoney(total)} for ${propertyName}`

  const text = [
    heading,
    '',
    `Hi ${first},`,
    lead,
    '',
    ...rows.map(r => `${r.label} — ${fmtMoney(r.amount)}`),
    '',
    `Rent: ${fmtMoney(rent)}`,
    `Processing fee (${methodLabel}): ${fmtMoney(fee)}`,
    `Total ${event === 'paid' ? 'charged' : 'requested'}: ${fmtMoney(total)}`,
    `Date: ${fmtDateTime(paidOn)}`,
    ...(reference ? [`Reference: ${reference}`] : []),
    '',
    remaining > 0
      ? `Remaining balance on your rent: ${fmtMoney(remaining)}`
      : 'You are fully paid up — nothing else is outstanding.',
    '',
    `View your rent: ${payUrl}`,
    ...(landlordEmail ? ['', `Questions? Reply to this email${landlordName ? ` — ${landlordName}` : ''}.`] : []),
  ].join('\n')

  const html = `${SHELL_OPEN}
    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">${esc(propertyName)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:18px;">
      Hi ${esc(first)}, ${esc(lead)}
    </div>

    <div style="margin-top:20px;background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${t.accent};">
        ${event === 'paid' ? 'Paid' : event === 'processing' ? 'Submitted' : 'Not collected'}
      </div>
      <div style="font-size:32px;font-weight:800;color:${t.accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(total)}
      </div>
      <div style="font-size:12px;color:${t.accent};opacity:0.8;margin-top:4px;">
        ${esc(methodLabel)} · ${esc(fmtDateTime(paidOn))}
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-top:22px;">
      What this covered
    </div>
    ${rowsTable(rows)}

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;">
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;">Rent</td>
        <td style="padding:5px 0;text-align:right;font-size:13px;color:#0f172a;font-weight:600;">${fmtMoney(rent)}</td>
      </tr>
      <tr>
        <td style="padding:5px 0;font-size:13px;color:#64748b;">Processing fee (${esc(methodLabel)})</td>
        <td style="padding:5px 0;text-align:right;font-size:13px;color:#0f172a;font-weight:600;">${fmtMoney(fee)}</td>
      </tr>
      <tr>
        <td style="padding:9px 0 0;border-top:1px solid #e2e8f0;font-size:13.5px;color:#0f172a;font-weight:700;">
          Total ${event === 'paid' ? 'charged' : 'requested'}
        </td>
        <td style="padding:9px 0 0;border-top:1px solid #e2e8f0;text-align:right;font-size:14px;color:#0f172a;font-weight:800;">
          ${fmtMoney(total)}
        </td>
      </tr>
    </table>

    <div style="margin-top:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155;line-height:1.6;">
      ${remaining > 0
        ? `Remaining balance on your rent: <strong style="color:#0f172a;">${fmtMoney(remaining)}</strong>`
        : `You're fully paid up — nothing else is outstanding.`}
    </div>

    <div style="margin-top:22px;text-align:center;">
      <a href="${payUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:14.5px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px;">
        ${event === 'failed' ? 'Try again' : 'View your rent'} →
      </a>
    </div>

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      ${reference ? `Reference ${esc(reference)}.` : ''}
      Keep this email for your records.
      ${landlordEmail ? `Questions? Just reply${landlordName ? ` and ${esc(landlordName)} will get back to you` : ''}.` : ''}
    </div>
${SHELL_CLOSE}`

  return { subject, html, text }
}

// ─── Landlord notification ────────────────────────────────────────────────────

export function buildLandlordRentPaidEmail(input: {
  landlordName?: string | null
  tenantName: string
  propertyName: string
  event: PayEvent
  rows: PaidRow[]
  /** Rent received — the fee is the tenant's cost, never landlord income. */
  rent: number
  method: PayMethod
  paidOn: Date
  /** Still owed by this tenant, and across the whole plan, after this payment. */
  tenantOutstanding: number
  planOutstanding: number
  planUrl: string
  reference?: string | null
}): BuiltEmail {
  const {
    landlordName, tenantName, propertyName, event, rows, rent, method,
    paidOn, tenantOutstanding, planOutstanding, planUrl, reference,
  } = input

  const t = TONE[event]
  const methodLabel = METHOD_META[method].label
  const first = landlordName ? firstNameOf(landlordName) : 'there'

  const heading =
    event === 'paid' ? `${tenantName} paid rent`
    : event === 'processing' ? `${tenantName} submitted a bank transfer`
    : `${tenantName}'s bank transfer failed`

  const lead =
    event === 'paid'
      ? `${fmtMoney(rent)} has been paid against ${propertyName}.`
      : event === 'processing'
      ? `${fmtMoney(rent)} is on its way for ${propertyName}. Bank transfers clear in 2–5 business days — this isn't money in your account yet, but don't chase them for it.`
      : `The ${fmtMoney(rent)} bank transfer for ${propertyName} was returned by their bank. These charges are showing as unpaid again and the tenant has been told.`

  const subject =
    event === 'paid' ? `Rent paid — ${fmtMoney(rent)} from ${tenantName}`
    : event === 'processing' ? `Rent submitted — ${fmtMoney(rent)} from ${tenantName} (clearing)`
    : `Rent payment failed — ${fmtMoney(rent)} from ${tenantName}`

  const text = [
    heading,
    '',
    `Hi ${first},`,
    lead,
    '',
    `Tenant: ${tenantName}`,
    `Property: ${propertyName}`,
    `Method: ${methodLabel}`,
    `Date: ${fmtDateTime(paidOn)}`,
    ...(reference ? [`Reference: ${reference}`] : []),
    '',
    'Covered:',
    ...rows.map(r => `  ${r.label} — ${fmtMoney(r.amount)}`),
    '',
    `Still owed by ${tenantName}: ${fmtMoney(tenantOutstanding)}`,
    `Still outstanding across the plan: ${fmtMoney(planOutstanding)}`,
    '',
    `Open the plan: ${planUrl}`,
  ].join('\n')

  const html = `${SHELL_OPEN}
    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">${esc(propertyName)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:18px;">
      Hi ${esc(first)}, ${esc(lead)}
    </div>

    <div style="margin-top:20px;background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${t.accent};">
        ${event === 'paid' ? 'Rent received' : event === 'processing' ? 'Clearing' : 'Returned'}
      </div>
      <div style="font-size:32px;font-weight:800;color:${t.accent};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(rent)}
      </div>
      <div style="font-size:12px;color:${t.accent};opacity:0.8;margin-top:4px;">
        ${esc(methodLabel)} · ${esc(fmtDateTime(paidOn))}
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-top:22px;">
      What it covered
    </div>
    ${rowsTable(rows)}

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;">
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#64748b;">Still owed by ${esc(tenantName)}</td>
        <td style="padding:6px 0;text-align:right;font-size:13.5px;font-weight:700;color:${tenantOutstanding > 0 ? '#b45309' : '#047857'};">
          ${fmtMoney(tenantOutstanding)}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#64748b;">Outstanding across the plan</td>
        <td style="padding:6px 0;text-align:right;font-size:13.5px;font-weight:700;color:${planOutstanding > 0 ? '#b45309' : '#047857'};">
          ${fmtMoney(planOutstanding)}
        </td>
      </tr>
    </table>

    <div style="margin-top:22px;text-align:center;">
      <a href="${planUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:14.5px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px;">
        Open the rent plan →
      </a>
    </div>

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      The tenant paid a processing surcharge on top of this — it goes to the card
      or bank network, not to you, so your ledger shows the rent only.
      ${reference ? `Reference ${esc(reference)}.` : ''}
    </div>
${SHELL_CLOSE}`

  return { subject, html, text }
}
