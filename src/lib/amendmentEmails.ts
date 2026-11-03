// The emails a lease amendment needs.
//
//   1. "please sign this"       — to the tenant, the only one with an action
//   2. the same thing again     — the landlord's reminder, worded as a nudge
//                                 rather than as a repeat of the original
//   3. the countersigned copy   — to the tenant, once it is signed
//   4. "she signed it"          — to the landlord, with what to do next
//
// All four are transactional: each is caused by somebody acting on a contract
// they are a party to. No unsubscribe, for the same reason the rent reminders
// carry none — a tenant cannot opt out of being sent the lease document they
// are being asked to sign.
//
// The signing email is the load-bearing one, and it has a harder job than the
// renewal offer does. A renewal is a decision; a signature is a commitment, and
// a tenant who feels hurried into one either signs without reading or does not
// sign at all. So it states the complete terms in the email — the charge, the
// date it starts, and the fact that nothing else about their lease moves — and
// then says explicitly that signing happens after reading the full document.
// The email is never the place the agreement is made.

import { emailShell, emailButton, esc } from './emailShell'
import {
  fmtLegalDate, fmtDollars, monthName,
  type AmendmentDocument, type LeaseAmendment,
} from './leaseAmendments'

export type BuiltEmail = { subject: string; html: string; text: string }

const p = (s: string) =>
  `<p style="margin:0 0 14px;font-size:14px;color:#3a3a3a;line-height:1.65;">${s}</p>`

/** A label/value table — the terms, stated once and unambiguously. */
function terms(rows: Array<[string, string]>): string {
  const body = rows.map(([k, v], i) => (
    `<tr>` +
    `<td style="padding:9px 0;font-size:12.5px;color:#9b9b9b;${i ? 'border-top:1px solid #f0ece4;' : ''}">${esc(k)}</td>` +
    `<td style="padding:9px 0;font-size:13.5px;color:#1a1a1a;font-weight:600;text-align:right;${i ? 'border-top:1px solid #f0ece4;' : ''}">${esc(v)}</td>` +
    `</tr>`
  )).join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:6px 16px;margin-bottom:20px;">${body}</table>`
}

/**
 * The reassurance block.
 *
 * Not decoration. The reason a tenant hesitates over "your landlord has sent
 * you a change to your lease" is the fear that something else moved with it, so
 * the email answers that before they have to ask. It is also simply true —
 * `CLAUSE_NO_MODIFICATION` is in the document and the send route refuses to
 * send one without it — which is the only reason it is safe to print.
 */
function unchangedNote(): string {
  return (
    `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:20px;">` +
    `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#166534;margin-bottom:6px;">` +
    `Your lease is otherwise unchanged</div>` +
    `<div style="font-size:13px;color:#166534;line-height:1.6;">` +
    `Your monthly rent, your security deposit, your move-out date and everyone on the lease all stay ` +
    `exactly as they are. This document adds one thing and changes nothing else — it says so in writing, ` +
    `in the clause headed <em>“The rest of the Lease is unchanged”</em>.` +
    `</div></div>`
  )
}

const firstName = (name: string | null | undefined, fallback = 'there') =>
  (name || '').trim().split(/\s+/)[0] || fallback

/** The terms rows shared by the request and the reminder. */
function termRows(doc: AmendmentDocument): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Document', doc.title]]
  rows.push(['Home', doc.premises])
  if (doc.monthlyCharge > 0) {
    rows.push([
      doc.monthlyChargeLabel || 'Monthly charge',
      `${fmtDollars(doc.monthlyCharge)} per month, from ${monthName(doc.effectiveDate)}`,
    ])
    rows.push(['Anything else to pay', 'Nothing — no deposit, no fee'])
  } else {
    rows.push(['Cost', 'No charge'])
  }
  rows.push(['Takes effect', fmtLegalDate(doc.effectiveDate)])
  return rows
}

// ── 1. Please sign this ──────────────────────────────────────────────────────

export function buildAmendmentRequestEmail(input: {
  doc: AmendmentDocument
  tenantName: string | null
  landlordName: string | null
  signUrl: string
  heroImage?: string | null
}): BuiltEmail {
  const { doc, tenantName, landlordName, signUrl } = input
  const first = firstName(tenantName)
  const from = landlordName ? esc(landlordName) : 'Your landlord'

  const subject = doc.monthlyCharge > 0
    ? `Sign your ${shortNoun(doc)} — ${fmtDollars(doc.monthlyCharge)}/mo, nothing else changes`
    : `Sign your ${shortNoun(doc)} — nothing else about your lease changes`

  const body = [
    p(`Hi ${esc(first)},`),
    p(
      `${from} has drawn up a change to your lease at <strong>${esc(doc.premises)}</strong> and needs ` +
      `your signature on it. Here is the whole of it:`
    ),
    terms(termRows(doc)),
    unchangedNote(),
    p(
      `Sign in to HomeHive to read the full document and sign it. You type your full legal name and ` +
      `today’s date — that’s your signature. Your signed copy stays in your account, and ` +
      `we’ll email you one too.`
    ),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Read and sign the document', url: signUrl })}</div>`,
    p(
      `<span style="font-size:12.5px;color:#9b9b9b;">Nothing is agreed until you sign. If you don’t ` +
      `want this change, you can decline it on the same page, or reply to this email and talk to ` +
      `${from.toLowerCase() === 'your landlord' ? 'your landlord' : esc(landlordName!)} about it.</span>`
    ),
  ].join('\n')

  const text = [
    `Hi ${first},`, '',
    `${landlordName || 'Your landlord'} has drawn up a change to your lease at ${doc.premises} and needs your signature on it.`,
    '',
    ...termRows(doc).map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Your lease is otherwise unchanged. Your monthly rent, your security deposit, your',
    'move-out date and everyone on the lease all stay exactly as they are.',
    '',
    'Read the full document and sign it here:',
    signUrl,
    '',
    'You type your full legal name and today\'s date — that is your signature.',
    'Nothing is agreed until you sign, and you can decline on the same page.',
  ].join('\n')

  return {
    subject,
    html: emailShell({
      banner: 'Signature needed',
      bannerSubject: doc.title,
      tone: 'action',
      hero: input.heroImage ?? undefined,
      heroAlt: doc.premises,
      body,
    }),
    text,
  }
}

/** "pet addendum" rather than the full legal title, for a subject line. */
function shortNoun(doc: AmendmentDocument): string {
  return /pet/i.test(doc.title) ? 'pet addendum' : 'lease change'
}

// ── 2. The reminder ──────────────────────────────────────────────────────────

/**
 * The nudge.
 *
 * A different email, not a resend. Repeating the original word for word trains
 * a tenant to ignore both, and it also hides the one new fact — that this has
 * been sitting there for a week. So this one leads with the wait and is shorter
 * than the original, on the assumption they have already read the terms once.
 */
export function buildAmendmentReminderEmail(input: {
  doc: AmendmentDocument
  tenantName: string | null
  landlordName: string | null
  signUrl: string
  /** Whole days since the original went out. */
  daysWaiting: number
}): BuiltEmail {
  const { doc, tenantName, landlordName, signUrl, daysWaiting } = input
  const first = firstName(tenantName)
  const waited = daysWaiting <= 1 ? 'yesterday' : `${daysWaiting} days ago`
  // Named, because a second email about the same document reads as automated
  // unless it is obvious that a person is on the other end of it, waiting.
  const from = landlordName?.trim() ? esc(landlordName.trim()) : 'Your landlord'

  const subject = `Reminder: your ${shortNoun(doc)} is still unsigned`

  const body = [
    p(`Hi ${esc(first)},`),
    p(
      `${from} sent you a ${esc(shortNoun(doc))} for <strong>${esc(doc.premises)}</strong> ` +
      `${esc(waited)}, and it hasn’t been signed yet. It takes about a minute.`
    ),
    terms(termRows(doc)),
    p(`Nothing about the rest of your lease changes, and nothing is agreed until you sign.`),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Read and sign the document', url: signUrl })}</div>`,
    p(
      `<span style="font-size:12.5px;color:#9b9b9b;">If you’d rather not go ahead, decline it on ` +
      `that page — that’s a perfectly good answer and it stops the reminders.</span>`
    ),
  ].join('\n')

  const text = [
    `Hi ${first},`, '',
    `${landlordName || 'Your landlord'} sent you a ${shortNoun(doc)} for ${doc.premises} ` +
    `${waited}, and it hasn't been signed yet.`,
    '',
    ...termRows(doc).map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Nothing about the rest of your lease changes, and nothing is agreed until you sign.',
    '',
    signUrl,
    '',
    "If you'd rather not go ahead, decline it on that page — that stops the reminders.",
  ].join('\n')

  return {
    subject,
    html: emailShell({
      banner: 'Still unsigned',
      bannerSubject: doc.title,
      tone: 'action',
      body,
    }),
    text,
  }
}

// ── 3. The countersigned copy ────────────────────────────────────────────────

/**
 * The tenant's receipt.
 *
 * Sent the moment they sign, and it matters more than it looks: a signature
 * with no copy coming back is the point at which a tenant starts to wonder what
 * they actually agreed to. It restates the terms as *executed* rather than as
 * proposed, names the date on the signature, and tells them where their copy
 * lives permanently.
 */
export function buildAmendmentSignedTenantEmail(input: {
  doc: AmendmentDocument
  signatureName: string
  signatureDate: string
  viewUrl: string
}): BuiltEmail {
  const { doc, signatureName, signatureDate, viewUrl } = input
  const first = firstName(doc.tenantName)

  const rows: Array<[string, string]> = [
    ['Signed by', signatureName],
    ['Date signed', fmtLegalDate(signatureDate)],
    ['Home', doc.premises],
  ]
  if (doc.monthlyCharge > 0) {
    rows.push([
      doc.monthlyChargeLabel || 'Monthly charge',
      `${fmtDollars(doc.monthlyCharge)} per month, from ${monthName(doc.effectiveDate)}`,
    ])
  }
  rows.push(['Takes effect', fmtLegalDate(doc.effectiveDate)])

  const body = [
    p(`Hi ${esc(first)},`),
    p(`You’ve signed your <strong>${esc(doc.title)}</strong>. Here’s what you agreed to:`),
    terms(rows),
    doc.monthlyCharge > 0
      ? p(
          `Your ${esc((doc.monthlyChargeLabel || 'charge').toLowerCase())} of ` +
          `<strong>${esc(fmtDollars(doc.monthlyCharge))}</strong> will appear on your rent from ` +
          `${esc(monthName(doc.effectiveDate))}. Your rent itself is unchanged — this is an ` +
          `addition to it, not a new rent.`
        )
      : '',
    unchangedNote(),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'View your signed copy', url: viewUrl, secondary: true })}</div>`,
    p(
      `<span style="font-size:12.5px;color:#9b9b9b;">Your signed copy stays in your HomeHive account ` +
      `for as long as the lease lasts. You can open it, print it or download it any time.</span>`
    ),
  ].filter(Boolean).join('\n')

  const text = [
    `Hi ${first},`, '',
    `You've signed your ${doc.title}. Here's what you agreed to:`, '',
    ...rows.map(([k, v]) => `  ${k}: ${v}`), '',
    'Your lease is otherwise unchanged.', '',
    'View your signed copy:', viewUrl,
  ].join('\n')

  return {
    subject: `Signed: ${doc.title}`,
    html: emailShell({
      banner: 'Signed',
      bannerSubject: doc.title,
      tone: 'good',
      body,
    }),
    text,
  }
}

// ── 4. "She signed it" ───────────────────────────────────────────────────────

/**
 * The landlord's notification, which is really a to-do.
 *
 * The signature is not the end of the job — a signed pet addendum is $65 a
 * month that nobody is collecting until the charge is on the ledger. Signing
 * deliberately does not create that charge (see the note on
 * `lease_amendments.monthly_charge`), so this email is where the landlord is
 * told, in the clearest terms available, that money is now owed to them and
 * what single thing collects it.
 */
export function buildAmendmentSignedLandlordEmail(input: {
  amendment: Pick<LeaseAmendment, 'tenant_name' | 'monthly_charge' | 'monthly_charge_label' | 'effective_date'>
  doc: AmendmentDocument
  signatureName: string
  signatureDate: string
  manageUrl: string
}): BuiltEmail {
  const { amendment, doc, signatureName, signatureDate, manageUrl } = input
  const who = amendment.tenant_name || signatureName
  const charge = amendment.monthly_charge

  const subject = charge > 0
    ? `${who} signed — add ${fmtDollars(charge)}/mo to their rent`
    : `${who} signed the ${shortNoun(doc)}`

  const body = [
    p(
      `<strong>${esc(signatureName)}</strong> signed the ${esc(doc.title)} for ` +
      `<strong>${esc(doc.premises)}</strong> on ${esc(fmtLegalDate(signatureDate))}.`
    ),
    terms([
      ['Signed by', signatureName],
      ['Date signed', fmtLegalDate(signatureDate)],
      ...(charge > 0
        ? [[amendment.monthly_charge_label || 'Agreed charge', `${fmtDollars(charge)} per month`] as [string, string]]
        : []),
      ['Takes effect', fmtLegalDate(amendment.effective_date)],
    ]),
    charge > 0
      ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:20px;">` +
        `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#92400e;margin-bottom:6px;">` +
        `One thing left to do</div>` +
        `<div style="font-size:13px;color:#92400e;line-height:1.6;">` +
        `Signing doesn’t charge anybody. Add ` +
        `<strong>${esc(fmtDollars(charge))}</strong> as a ` +
        `${esc((amendment.monthly_charge_label || 'charge').toLowerCase())} line item on ` +
        `${esc(who)}’s share from ${esc(monthName(amendment.effective_date))}, or it won’t ` +
        `be collected. The amendment page has the link.` +
        `</div></div>`
      : '',
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Open the amendment', url: manageUrl })}</div>`,
  ].filter(Boolean).join('\n')

  const text = [
    `${signatureName} signed the ${doc.title} for ${doc.premises} on ${fmtLegalDate(signatureDate)}.`,
    '',
    charge > 0
      ? `One thing left to do: signing doesn't charge anybody. Add ${fmtDollars(charge)} as a ` +
        `${(amendment.monthly_charge_label || 'charge').toLowerCase()} line item on ${who}'s share ` +
        `from ${monthName(amendment.effective_date)}, or it won't be collected.`
      : '',
    '',
    manageUrl,
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: emailShell({
      banner: 'Signed by the tenant',
      bannerSubject: doc.title,
      tone: charge > 0 ? 'action' : 'good',
      body,
    }),
    text,
  }
}

/** The landlord's notification when a tenant says no. */
export function buildAmendmentDeclinedLandlordEmail(input: {
  doc: AmendmentDocument
  tenantName: string | null
  reason: string | null
  manageUrl: string
}): BuiltEmail {
  const { doc, tenantName, reason, manageUrl } = input
  const who = tenantName || 'Your tenant'

  const body = [
    p(
      `<strong>${esc(who)}</strong> declined the ${esc(doc.title)} for ` +
      `<strong>${esc(doc.premises)}</strong>. Their lease is unchanged and runs on exactly as before.`
    ),
    reason
      ? `<div style="background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:14px 16px;margin-bottom:20px;">` +
        `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#9b9b9b;margin-bottom:6px;">` +
        `What they said</div>` +
        `<div style="font-size:13.5px;color:#3a3a3a;line-height:1.6;font-style:italic;">${esc(reason)}</div></div>`
      : '',
    p(`If you want to offer different terms, send a new amendment — the declined one stays on file.`),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Open the amendment', url: manageUrl, secondary: true })}</div>`,
  ].filter(Boolean).join('\n')

  const text = [
    `${who} declined the ${doc.title} for ${doc.premises}. Their lease is unchanged.`,
    reason ? `\nWhat they said: ${reason}` : '',
    '', manageUrl,
  ].filter(Boolean).join('\n')

  return {
    subject: `${who} declined the ${shortNoun(doc)}`,
    html: emailShell({
      banner: 'Declined',
      bannerSubject: doc.title,
      tone: 'bad',
      body,
    }),
    text,
  }
}
