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

export type PaidRow = {
  label: string
  amount: number
  /**
   * ISO due date of the charge, when it is known. Only the landlord email uses
   * it: the *timing* of a payment is the most useful thing about it to the
   * person waiting on the money, and an amount alone cannot say whether rent
   * arrived four days early or six days late.
   */
  dueDate?: string | null
  /** Rent, a one-off charge, or a late fee collected on its own. */
  kind?: 'rent' | 'charge' | 'late_fee'
}

/** What is still owed per payer on a split plan. */
export type TenantBalance = {
  name: string
  outstanding: number
  /** True for the person who just paid, so the email can mark them. */
  isPayer: boolean
}

/** The next charge coming up on the plan, after this payment. */
export type NextCharge = { label: string; dueDate: string; amount: number }

/**
 * How reliably this tenant pays, over the charges they have actually settled.
 *
 * A landlord reading one receipt cannot tell a habitually punctual tenant from
 * one who is three weeks late every month, and that distinction — not the
 * amount — is what decides whether they chase, renew, or raise the rent.
 */
export type PayerHistory = {
  /**
   * Settled charges counted. Below two the email says nothing: one data point
   * is not a habit, and "1 of 1 on time" reads as flattery, not information.
   */
  settled: number
  onTime: number
  /** Consecutive on-time settlements, counting back from the most recent. */
  streak: number
}

/** What happened to the money. ACH sits in `processing` for days before either. */
export type PayEvent = 'paid' | 'processing' | 'failed'

export type BuiltEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDateTime = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || 'there'

const fmtShortDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * Days between a charge's due date and the day it settled. Positive = late.
 *
 * Both sides collapse to a calendar day before subtracting. A card taken at
 * 11pm on the 1st is on time for rent due the 1st, and measuring in elapsed
 * hours would call it late by a rounding error.
 */
export function daysOffDue(dueDate: string, paidOn: Date): number {
  const due = new Date(dueDate + 'T00:00:00').getTime()
  const paid = new Date(paidOn.getFullYear(), paidOn.getMonth(), paidOn.getDate()).getTime()
  return Math.round((paid - due) / 86_400_000)
}

/** How to say a number of days off the due date, in the landlord's terms. */
export function timingLabel(days: number): { text: string; tone: string } {
  if (days > 0) return { text: `${days} ${days === 1 ? 'day' : 'days'} late`, tone: '#b45309' }
  if (days === 0) return { text: 'on the due date', tone: '#047857' }
  const early = -days
  return { text: `${early} ${early === 1 ? 'day' : 'days'} early`, tone: '#047857' }
}

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

/**
 * The same table for the landlord, with each charge's due date and how far off
 * it settled. A failed debit collected nothing, so timing is meaningless there
 * and the subline falls back to the due date alone.
 */
function landlordRowsTable(rows: PaidRow[], paidOn: Date, event: PayEvent): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      ${rows.map(r => {
        const t = r.dueDate && event !== 'failed' && r.kind !== 'late_fee'
          ? timingLabel(daysOffDue(r.dueDate, paidOn))
          : null
        const sub = r.dueDate
          ? `Due ${esc(fmtShortDate(r.dueDate))}${t ? ` · <span style="color:${t.tone};font-weight:600;">${esc(t.text)}</span>` : ''}`
          : ''
        return `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#0f172a;font-weight:600;">
          ${esc(r.label)}
          ${sub ? `<div style="font-size:11.5px;color:#94a3b8;font-weight:500;margin-top:2px;">${sub}</div>` : ''}
        </td>
        <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;vertical-align:top;">
          ${fmtMoney(r.amount)}
        </td>
      </tr>`
      }).join('')}
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
  /**
   * The lease this payment landed on. A landlord with three leases at one
   * address cannot act on "Oakwood" alone, and the property name was all this
   * email used to carry.
   */
  planName?: string | null
  event: PayEvent
  rows: PaidRow[]
  /** Rent received — the fee is the tenant's cost, never landlord income. */
  rent: number
  /** The slice of `rent` that is a late fee. Called out because, unlike the
   *  processing surcharge, a late fee *is* the landlord's money. */
  lateFeeCollected?: number
  method: PayMethod
  paidOn: Date
  /** Still owed by this tenant, and across the whole plan, after this payment. */
  tenantOutstanding: number
  planOutstanding: number
  /** Per-payer balances. Only worth printing on a plan with several payers. */
  tenantBalances?: TenantBalance[]
  /** What falls due next on this plan, so the email ends on what to expect. */
  nextCharge?: NextCharge | null
  /** This payer's track record, or null when there is too little of one. */
  payerHistory?: PayerHistory | null
  planUrl: string
  reference?: string | null
}): BuiltEmail {
  const {
    landlordName, tenantName, propertyName, planName, event, rows, rent, method,
    lateFeeCollected = 0, paidOn, tenantOutstanding, planOutstanding,
    tenantBalances = [], nextCharge, payerHistory, planUrl, reference,
  } = input

  const t = TONE[event]
  const methodLabel = METHOD_META[method].label
  const first = landlordName ? firstNameOf(landlordName) : 'there'

  // Timing of the payment as a whole: the worst-off charge it covered. A tenant
  // who clears September three weeks late while paying October early has not
  // paid on time, and averaging the two would hide the only interesting half.
  const dated = rows.filter(r => r.dueDate && r.kind !== 'late_fee')
  const worstDays = dated.length > 0 && event !== 'failed'
    ? Math.max(...dated.map(r => daysOffDue(r.dueDate as string, paidOn)))
    : null
  const timing = worstDays === null ? null : timingLabel(worstDays)

  // Only break the balance down when there is a split to break down. On a
  // single-payer plan the per-tenant and plan totals are the same number, and
  // printing it twice makes the reader hunt for a difference that isn't there.
  const showSplit = tenantBalances.length > 1
  const others = tenantBalances.filter(b => !b.isPayer && b.outstanding > 0)
  // "4 of 5 on time" is only worth saying once there are a few to count.
  const history = payerHistory && payerHistory.settled >= 2 ? payerHistory : null

  const heading =
    event === 'paid' ? `${tenantName} paid rent`
    : event === 'processing' ? `${tenantName} submitted a bank transfer`
    : `${tenantName}'s bank transfer failed`

  const lead =
    event === 'paid'
      ? `${fmtMoney(rent)} has been paid against ${propertyName}${timing ? `, ${timing.text}` : ''}.`
      : event === 'processing'
      ? `${fmtMoney(rent)} is on its way for ${propertyName}. Bank transfers clear in 2–5 business days — this isn't money in your account yet, but don't chase them for it.`
      : `The ${fmtMoney(rent)} bank transfer for ${propertyName} was returned by their bank. These charges are showing as unpaid again and the tenant has been told.`

  // The timing rides in the subject line too: it is the one detail that decides
  // whether an email about money already collected still needs opening.
  const subject =
    event === 'paid' ? `Rent paid — ${fmtMoney(rent)} from ${tenantName}${timing ? ` (${timing.text})` : ''}`
    : event === 'processing' ? `Rent submitted — ${fmtMoney(rent)} from ${tenantName} (clearing)`
    : `Rent payment failed — ${fmtMoney(rent)} from ${tenantName}`

  const text = [
    heading,
    '',
    `Hi ${first},`,
    lead,
    '',
    `Tenant: ${tenantName}`,
    `Property: ${propertyName}${planName ? ` · ${planName}` : ''}`,
    `Method: ${methodLabel}`,
    `Date: ${fmtDateTime(paidOn)}`,
    ...(timing ? [`Timing: ${timing.text}`] : []),
    ...(reference ? [`Reference: ${reference}`] : []),
    '',
    'Covered:',
    ...rows.map(r => {
      const rt = r.dueDate && event !== 'failed' && r.kind !== 'late_fee'
        ? timingLabel(daysOffDue(r.dueDate, paidOn))
        : null
      const due = r.dueDate ? ` (due ${fmtShortDate(r.dueDate)}${rt ? `, ${rt.text}` : ''})` : ''
      return `  ${r.label} — ${fmtMoney(r.amount)}${due}`
    }),
    ...(lateFeeCollected > 0
      ? ['', `Includes ${fmtMoney(lateFeeCollected)} of late fees — that part is yours, not a processing charge.`]
      : []),
    '',
    `Still owed by ${tenantName}: ${fmtMoney(tenantOutstanding)}`,
    `Still outstanding across the lease: ${fmtMoney(planOutstanding)}`,
    ...(showSplit ? others.map(b => `  of which ${b.name} owes ${fmtMoney(b.outstanding)}`) : []),
    ...(nextCharge
      ? [`Next due: ${nextCharge.label} — ${fmtMoney(nextCharge.amount)} on ${fmtShortDate(nextCharge.dueDate)}`]
      : []),
    ...(history
      ? ['', `${tenantName} has settled ${history.onTime} of their last ${history.settled} charges on time${history.streak >= 2 ? ` (${history.streak} in a row)` : ''}.`]
      : []),
    '',
    `Open the plan: ${planUrl}`,
  ].join('\n')

  /** One line in the "where this lease stands" table. */
  const standing = (label: string, value: string, tone?: string, indent = false) => `
      <tr>
        <td style="padding:6px 0${indent ? ' 6px 14px' : ''};font-size:${indent ? '12.5' : '13'}px;color:${indent ? '#94a3b8' : '#64748b'};">
          ${label}
        </td>
        <td style="padding:6px 0;text-align:right;font-size:${indent ? '12.5' : '13.5'}px;font-weight:${indent ? '600' : '700'};color:${tone ?? '#0f172a'};white-space:nowrap;">
          ${value}
        </td>
      </tr>`

  const owedTone = (n: number) => (n > 0 ? '#b45309' : '#047857')

  const html = `${SHELL_OPEN}
    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(heading)}</div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">
      ${esc(propertyName)}${planName ? ` · ${esc(planName)}` : ''}
    </div>

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
        ${esc(methodLabel)} · ${esc(fmtDateTime(paidOn))}${timing ? ` · ${esc(timing.text)}` : ''}
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-top:22px;">
      What it covered
    </div>
    ${landlordRowsTable(rows, paidOn, event)}

    ${lateFeeCollected > 0 ? `
    <div style="margin-top:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 13px;font-size:12.5px;color:#92400e;line-height:1.6;">
      <strong>${fmtMoney(lateFeeCollected)}</strong> of this is late fees. Unlike the
      processing surcharge, that part is your money.
    </div>` : ''}

    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-top:22px;">
      Where this lease stands
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
      ${standing(`Still owed by ${esc(tenantName)}`, fmtMoney(tenantOutstanding), owedTone(tenantOutstanding))}
      ${standing('Outstanding across the lease', fmtMoney(planOutstanding), owedTone(planOutstanding))}
      ${/* Indented *under the lease total*, which is what they break down —
            placed under the payer's own row they read as nested inside it. */ ''}
      ${showSplit ? others.map(b =>
        standing(`${esc(b.name)} owes`, fmtMoney(b.outstanding), owedTone(b.outstanding), true)
      ).join('') : ''}
      ${nextCharge ? standing(
        `Next due · ${esc(fmtShortDate(nextCharge.dueDate))}`,
        `${esc(nextCharge.label)} — ${fmtMoney(nextCharge.amount)}`,
        '#334155'
      ) : ''}
    </table>

    ${history ? `
    <div style="margin-top:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155;line-height:1.6;">
      ${esc(tenantName)} has settled
      <strong style="color:#0f172a;">${history.onTime} of their last ${history.settled}</strong>
      charges on time${history.streak >= 2 ? ` — <strong style="color:#047857;">${history.streak} in a row</strong>` : ''}.
    </div>` : ''}

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

// ─── Admin copy ───────────────────────────────────────────────────────────────

/**
 * What the platform made on one rent payment.
 *
 * The landlord's email is about rent. This one is about the business: the same
 * payment, re-cut into the three numbers that are constantly conflated —
 * volume (not ours), the surcharge (gross revenue), and what survives Stripe.
 *
 * The processor cost is deliberately shown per method with its rate spelled
 * out. Card is 2.9% + 30¢ on the *whole* charge, rent included, so a $2,000
 * payment costs more to process than its own $100 surcharge is worth on a bad
 * day; ACH is 0.8% capped at $5 and keeps most of its fee. An admin reading a
 * single net figure without the rate cannot tell those two apart, and the
 * difference is the entire argument for pushing tenants toward bank transfer.
 */
export function buildAdminPaymentEmail(input: {
  event: PayEvent
  tenantName: string
  landlordName?: string | null
  landlordEmail?: string | null
  propertyName: string
  planName?: string | null
  rows: PaidRow[]
  /** Rent received — pass-through to the landlord. */
  rent: number
  /** Surcharge the tenant paid on top. Gross platform revenue. */
  fee: number
  method: PayMethod
  /** Estimated Stripe cost on the whole charge, in dollars. */
  stripeCost: number
  /** The rate that cost came from, e.g. "2.9% + 30¢". */
  rateLabel: string
  paidOn: Date
  planUrl: string
  reference?: string | null
}): BuiltEmail {
  const {
    event, tenantName, landlordName, landlordEmail, propertyName, planName,
    rows, rent, fee, method, stripeCost, rateLabel, paidOn, planUrl, reference,
  } = input

  const t = TONE[event]
  const methodLabel = METHOD_META[method].label
  const total = Math.round((rent + fee) * 100) / 100
  const net = Math.round((fee - stripeCost) * 100) / 100
  // Share of the surcharge that survives Stripe. Negative on a small card charge.
  const marginPct = fee > 0 ? Math.round((net / fee) * 100) : null

  const verb =
    event === 'paid' ? 'settled'
    : event === 'processing' ? 'submitted (ACH clearing)'
    : 'failed'

  const subject =
    event === 'paid'
      ? `Payment ${fmtMoney(total)} · net ${fmtMoney(net)} — ${propertyName}`
      : event === 'processing'
      ? `Payment clearing ${fmtMoney(total)} · net ${fmtMoney(net)} — ${propertyName}`
      : `Payment FAILED ${fmtMoney(total)} — ${propertyName}`

  // A failed debit collected nothing: no revenue, and Stripe charges no fee.
  const earned = event === 'failed' ? 0 : net
  const grossFee = event === 'failed' ? 0 : fee
  const cost = event === 'failed' ? 0 : stripeCost

  // A failed debit is reported as an attempt, not as a zero charge: the
  // amounts still matter (it is what we will collect on the retry), but none
  // of it was earned and Stripe billed nothing for a payment that never moved.
  const money: { label: string; value: string; strong?: boolean; tone?: string }[] =
    event === 'failed'
      ? [
          { label: 'Rent / charges attempted', value: fmtMoney(rent) },
          { label: `Surcharge (${methodLabel})`, value: fmtMoney(fee) },
          { label: 'Attempted total',          value: fmtMoney(total), strong: true },
          { label: 'Collected',                value: fmtMoney(0), tone: '#b91c1c' },
          { label: 'HomeHive net',             value: fmtMoney(0), strong: true, tone: '#b91c1c' },
        ]
      : [
          { label: 'Rent / charges (to landlord)', value: fmtMoney(rent) },
          { label: `Surcharge (${methodLabel})`,   value: fmtMoney(grossFee) },
          { label: 'Total charged to tenant',      value: fmtMoney(total), strong: true },
          { label: `Stripe cost (${rateLabel})`,   value: `− ${fmtMoney(cost)}`, tone: '#b45309' },
          { label: 'HomeHive net',                 value: fmtMoney(earned), strong: true, tone: earned >= 0 ? '#047857' : '#b91c1c' },
        ]

  const text = [
    `Payment ${verb} — ${propertyName}`,
    '',
    `Tenant:   ${tenantName}`,
    `Landlord: ${landlordName ?? '—'}${landlordEmail ? ` <${landlordEmail}>` : ''}`,
    `Property: ${propertyName}${planName ? ` · ${planName}` : ''}`,
    `Method:   ${methodLabel}`,
    `Date:     ${fmtDateTime(paidOn)}`,
    ...(reference ? [`Reference: ${reference}`] : []),
    '',
    'Covered:',
    ...rows.map(r => `  ${r.label} — ${fmtMoney(r.amount)}`),
    '',
    'Economics:',
    ...money.map(m => `  ${m.label}: ${m.value}`),
    ...(marginPct !== null && event !== 'failed' ? [`  Margin on surcharge: ${marginPct}%`] : []),
    '',
    `Plan: ${planUrl}`,
  ].join('\n')

  const html = `${SHELL_OPEN}
    <div style="display:inline-block;background:${t.bg};border:1px solid ${t.border};border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:${t.accent};text-transform:uppercase;letter-spacing:0.5px;">
      ${event === 'paid' ? 'Payment settled' : event === 'processing' ? 'ACH clearing' : 'Payment failed'}
    </div>
    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;margin-top:14px;">
      ${esc(propertyName)}
    </div>
    <div style="font-size:13px;color:#64748b;margin-top:3px;">
      ${esc(tenantName)} → ${esc(landlordName ?? 'landlord')}${planName ? ` · ${esc(planName)}` : ''}
    </div>

    <div style="margin-top:20px;background:${t.bg};border:1px solid ${t.border};border-radius:12px;padding:18px 20px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${t.accent};">
        HomeHive net
      </div>
      <div style="font-size:32px;font-weight:800;color:${earned >= 0 ? t.accent : '#b91c1c'};margin-top:5px;letter-spacing:-1px;">
        ${fmtMoney(earned)}
      </div>
      <div style="font-size:12px;color:${t.accent};opacity:0.85;margin-top:4px;">
        ${event === 'failed' ? `nothing collected on ${fmtMoney(total)} attempted` : `on ${fmtMoney(total)} processed`} · ${esc(methodLabel)}${marginPct !== null && event !== 'failed' ? ` · ${marginPct}% margin` : ''}
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-top:22px;">
      What it covered
    </div>
    ${rowsTable(rows)}

    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-top:22px;">
      Economics
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
      ${money.map(m => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:${m.strong ? '#0f172a' : '#64748b'};font-weight:${m.strong ? '700' : '500'};">
          ${esc(m.label)}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13.5px;font-weight:700;color:${m.tone ?? '#0f172a'};white-space:nowrap;">
          ${m.value}
        </td>
      </tr>`).join('')}
    </table>

    <div style="margin-top:22px;text-align:center;">
      <a href="${planUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:14.5px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:10px;">
        Open the rent plan →
      </a>
    </div>

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      Stripe cost is estimated from published pricing (${esc(rateLabel)} on the full
      amount charged, rent included) — reconcile against the monthly statement.
      ${event === 'processing' ? 'This ACH debit has not cleared yet; a return would reverse it.' : ''}
      ${reference ? `Reference ${esc(reference)}.` : ''}
    </div>
${SHELL_CLOSE}`

  return { subject, html, text }
}
