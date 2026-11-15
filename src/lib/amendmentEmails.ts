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
  fmtLegalDate, fmtDollars, monthName, chargesOf, dueOnExecution, monthlyTotal,
  removalsOf, monthlyRemoved,
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

/** "a, b and c". Plain text, for subjects and sentences. */
function joinPlain(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The reassurance block.
 *
 * Not decoration. The reason a tenant hesitates over "your landlord has sent
 * you a change to your lease" is the fear that something else moved with it, so
 * the email answers that before they have to ask. It is also simply true —
 * `CLAUSE_NO_MODIFICATION` is in the document and the send route refuses to
 * send one without it — which is the only reason it is safe to print.
 *
 * It takes the document because the honest wording depends on it. When there is
 * a pet deposit, "your security deposit stays exactly as it is" would be the
 * kind of half-truth that destroys trust the moment the tenant reads clause 3:
 * their *lease* deposit is untouched and the pet deposit is a separate, extra
 * one. Saying which is which costs a clause and buys the whole paragraph its
 * credibility.
 */
function unchangedNote(doc: AmendmentDocument): string {
  const hasDeposit = chargesOf(doc).some(c => c.kind === 'deposit')
  const depositLine = hasDeposit
    ? `Your existing security deposit is untouched — the pet deposit in this document is a ` +
      `separate, additional one, held and returned under the same rules.`
    : `Your security deposit stays exactly as it is.`
  // When the amendment takes a charge away, "your monthly rent stays exactly as
  // it is" is false — it is the one thing that did move, and in the tenant's
  // favour. Saying it anyway would be a strange way to deliver good news, and
  // would contradict the document attached to the same email.
  const removed = removalsOf(doc)
  const rentLine = removed.length === 0
    ? `Your monthly rent, your move-out date and everyone on the lease all stay exactly as they are.`
    : `Your base rent, your move-out date and everyone on the lease all stay exactly as they are — ` +
      `the only thing that changes is that ` +
      `${joinPlain(removed.map(c => `the ${c.label.toLowerCase()} of ${fmtDollars(c.amount)}`))} ` +
      `${removed.length === 1 ? 'comes off' : 'come off'} your account.`
  return (
    `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:20px;">` +
    `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#166534;margin-bottom:6px;">` +
    `Your lease is otherwise unchanged</div>` +
    `<div style="font-size:13px;color:#166534;line-height:1.6;">` +
    `${rentLine} ` +
    `${depositLine} Nothing else in your lease changes — it says so in writing, in the clause headed ` +
    `<em>“The rest of the Lease is unchanged”</em>.` +
    `</div></div>`
  )
}

const firstName = (name: string | null | undefined, fallback = 'there') =>
  (name || '').trim().split(/\s+/)[0] || fallback

/**
 * The terms rows shared by the request and the reminder.
 *
 * Built from `doc.charges`, so every amount in the contract appears in the
 * email that asks someone to sign it. The earlier version of this function hard
 * coded "Anything else to pay: Nothing — no deposit, no fee", which was true of
 * the document it was written against and became a lie the moment a deposit was
 * added. Walking the list cannot drift; a sentence about the list can.
 */
function termRows(doc: AmendmentDocument): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Document', doc.title], ['Home', doc.premises]]
  const charges = chargesOf(doc)
  const removed = removalsOf(doc)

  // What this amendment stops charging, before what it charges. On an
  // assistance-animal amendment it is the entire substance of the document,
  // and a table that opened with "Cost: No charge" would read as though the
  // tenant had been sent a contract about nothing.
  for (const c of removed) {
    rows.push([
      `${c.label} removed`,
      c.kind === 'monthly'
        ? `${fmtDollars(c.amount)} a month — no longer charged`
        : `${fmtDollars(c.amount)} — no longer charged`,
    ])
  }

  if (charges.length === 0) {
    rows.push(['Cost', removed.length > 0 ? 'Nothing to pay' : 'No charge'])
  } else {
    for (const c of charges) {
      rows.push([
        c.label,
        c.kind === 'monthly'
          ? `${fmtDollars(c.amount)} a month, from ${monthName(doc.effectiveDate)}`
          : c.kind === 'deposit'
            ? `${fmtDollars(c.amount)} — refundable`
            : `${fmtDollars(c.amount)} — one-time`,
      ])
    }
    const upfront = dueOnExecution(doc)
    // The number that actually decides whether they can say yes this week.
    // Leaving a student to add a deposit and a fee together in their head is
    // how a signature turns into a surprise on their bank balance.
    if (upfront > 0) rows.push(['Due when you sign', fmtDollars(upfront)])
  }

  rows.push([
    'Takes effect',
    // Named as retroactive in the table, not only in the document. A tenant
    // who opens the email, sees a date already past and is not told why
    // assumes a mistake — and a tenant who assumes a mistake does not sign.
    doc.isBackdated
      ? `${fmtLegalDate(doc.effectiveDate)} — before you sign, so that month is owed in full`
      : fmtLegalDate(doc.effectiveDate),
  ])
  if (doc.respondBy) rows.push(['Sign by', fmtLegalDate(doc.respondBy)])
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

  const monthly = monthlyTotal(doc)
  const dropped = monthlyRemoved(doc)
  const subject = monthly > 0
    ? `Sign your ${shortNoun(doc)} — ${fmtDollars(monthly)}/mo, and your rent doesn’t change`
    : dropped > 0
      ? `Sign your ${shortNoun(doc)} — ${fmtDollars(dropped)}/mo comes off your rent`
      : `Sign your ${shortNoun(doc)} — nothing else about your lease changes`

  const body = [
    p(`Hi ${esc(first)},`),
    p(
      `${from} has drawn up a change to your lease at <strong>${esc(doc.premises)}</strong> and needs ` +
      `your signature on it. Here is the whole of it:`
    ),
    terms(termRows(doc)),
    unchangedNote(doc),
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

/**
 * The adjustment notice: a charge has been taken off, here is the document.
 *
 * A separate email from `buildAmendmentRequestEmail` because the two have
 * opposite jobs. The request email's work is reassurance — it is asking
 * somebody to take on a new obligation, so it leads with the terms and spends
 * its length proving nothing else moved. This email is telling a tenant that a
 * charge they were told they owed is cancelled. Leading that with "your
 * signature is needed" buries it, and a tenant who skims the first line and
 * closes the email goes on believing they owe the money.
 *
 * So the order is inverted: what came off, what they now pay, why, and only
 * then the signature. The signature is also described honestly — the
 * cancellation is not contingent on it, and saying otherwise would invent a
 * deadline on money that is simply not owed.
 */
export function buildAmendmentAdjustmentEmail(input: {
  doc: AmendmentDocument
  tenantName: string | null
  landlordName: string | null
  signUrl: string
  heroImage?: string | null
  /** What their total monthly payment becomes. Null to leave it unsaid. */
  newMonthlyTotal?: number | null
  /** A one-off charge for this item that has been cancelled unpaid. */
  cancelledCharge?: { label: string; amount: number } | null
}): BuiltEmail {
  const { doc, tenantName, landlordName, signUrl } = input
  const first = firstName(tenantName)
  const from = landlordName ? esc(landlordName) : 'Your landlord'
  const removed = removalsOf(doc)
  const dropped = monthlyRemoved(doc)
  const cancelled = input.cancelledCharge

  const subject = dropped > 0
    ? `Your pet rent is cancelled — ${fmtDollars(dropped)}/mo comes off your account`
    : `A charge has been removed from your lease`

  // The headline figure, stated as a block rather than a sentence so it is the
  // first thing the eye lands on.
  const headline = dropped > 0
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin:0 0 20px;">` +
      `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#166534;margin-bottom:6px;">` +
      `Removed from your account</div>` +
      `<div style="font-size:22px;font-weight:700;color:#14532d;line-height:1.2;">` +
      `${esc(fmtDollars(dropped))} a month</div>` +
      `<div style="font-size:13px;color:#166534;line-height:1.6;margin-top:6px;">` +
      `Pet rent, cancelled from ${esc(fmtLegalDate(doc.effectiveDate))}. You will not be ` +
      `charged it again for the rest of your lease.</div>` +
      `</div>`
    : ''

  const rows: Array<[string, string]> = []
  for (const c of removed) {
    rows.push([
      `${c.label} removed`,
      c.kind === 'monthly'
        ? `${fmtDollars(c.amount)} a month`
        : fmtDollars(c.amount),
    ])
  }
  if (cancelled) rows.push([cancelled.label, `${fmtDollars(cancelled.amount)} — cancelled, not owed`])
  if (typeof input.newMonthlyTotal === 'number') {
    rows.push(['Your new monthly total', `${fmtDollars(input.newMonthlyTotal)} a month`])
  }
  rows.push(['Due now because of this', 'Nothing'])
  rows.push(['Effective', fmtLegalDate(doc.effectiveDate)])

  const body = [
    p(`Hi ${esc(first)},`),
    p(
      `Good news, and the short version first: the pet rent on your account at ` +
      `<strong>${esc(doc.premises)}</strong> has been removed.`
    ),
    headline,
    p(
      `${from} has recorded your animal on the lease as an <strong>assistance animal</strong> ` +
      `rather than as a pet. An assistance animal is not a pet under the Fair Housing Act, and ` +
      `no pet rent, pet deposit or pet fee can be charged for one — so the charge has come off, ` +
      `and the pet addendum that carried it no longer applies.`
    ),
    terms(rows),
    cancelled
      ? p(
          `The separate charge for <strong>${esc(cancelled.label)}</strong> of ` +
          `${esc(fmtDollars(cancelled.amount))} that was sitting on your account has been ` +
          `cancelled. You do not owe it, and there is nothing for you to pay or ask for back.`
        )
      : '',
    p(
      `There is a signed document for this, and it is worth keeping: it is what proves the ` +
      `reclassification and the cancellation if anyone ever asks. ${from} has already signed ` +
      `it. When you add your signature it becomes part of your lease, and you will get a copy.`
    ),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Read and sign the document', url: signUrl })}</div>`,
    p(
      `<span style="font-size:12.5px;color:#9b9b9b;">Nothing here depends on you signing. The ` +
      `pet rent is already off your account and stays off either way — signing just puts the ` +
      `change on the record properly. If anything above doesn’t match what you expected, reply ` +
      `to this email.</span>`
    ),
  ].filter(Boolean).join('\n')

  const text = [
    `Hi ${first},`, '',
    `Good news, and the short version first: the pet rent on your account at ${doc.premises}`,
    `has been removed.`,
    '',
    ...(dropped > 0
      ? [`  ${fmtDollars(dropped)} a month — pet rent, cancelled from ${fmtLegalDate(doc.effectiveDate)}.`, '']
      : []),
    `${landlordName || 'Your landlord'} has recorded your animal on the lease as an assistance`,
    `animal rather than as a pet. An assistance animal is not a pet under the Fair Housing`,
    `Act, and no pet rent, pet deposit or pet fee can be charged for one — so the charge has`,
    `come off, and the pet addendum that carried it no longer applies.`,
    '',
    ...rows.map(([k, v]) => `  ${k}: ${v}`),
    '',
    ...(cancelled
      ? [
          `The separate charge for ${cancelled.label} of ${fmtDollars(cancelled.amount)} on`,
          `your account has been cancelled. You do not owe it.`,
          '',
        ]
      : []),
    `There is a signed document for this. Read and sign it here:`,
    signUrl,
    '',
    `Nothing here depends on you signing — the pet rent is already off your account and`,
    `stays off either way. Signing just puts the change on the record properly.`,
  ].join('\n')

  return {
    subject,
    html: emailShell({
      banner: 'Charge removed',
      bannerSubject: doc.title,
      tone: 'good',
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

  const monthly = monthlyTotal(doc)
  const upfront = dueOnExecution(doc)

  const rows: Array<[string, string]> = [
    ['Signed by', signatureName],
    ['Date signed', fmtLegalDate(signatureDate)],
    ['Home', doc.premises],
  ]
  for (const c of chargesOf(doc)) {
    rows.push([
      c.label,
      c.kind === 'monthly'
        ? `${fmtDollars(c.amount)} a month, from ${monthName(doc.effectiveDate)}`
        : c.kind === 'deposit'
          ? `${fmtDollars(c.amount)} — refundable`
          : `${fmtDollars(c.amount)} — one-time`,
    ])
  }
  if (upfront > 0) rows.push(['Due now', fmtDollars(upfront)])
  rows.push(['Takes effect', fmtLegalDate(doc.effectiveDate)])

  const body = [
    p(`Hi ${esc(first)},`),
    p(`You’ve signed your <strong>${esc(doc.title)}</strong>. Here’s what you agreed to:`),
    terms(rows),
    monthly > 0
      ? p(
          `The <strong>${esc(fmtDollars(monthly))}</strong> a month will appear on your rent from ` +
          `${esc(monthName(doc.effectiveDate))}. Your rent itself is unchanged — this is an ` +
          `addition alongside it, not a new rent.`
        )
      : '',
    // The deposit deserves its own sentence. "Refundable" in a table is a word
    // people skim; what they actually need to know is that it comes back and
    // the fee does not, because confusing the two is how a tenant expects $400
    // at move-out and gets $300.
    upfront > 0
      ? p(
          `The <strong>${esc(fmtDollars(upfront))}</strong> due now is ` +
          esc(joinPlain(chargesOf(doc).filter(c => c.kind !== 'monthly').map(c =>
            `${fmtDollars(c.amount)} ${c.kind === 'deposit' ? 'as a refundable deposit' : 'as a one-time fee'}`
          ))) +
          `. The deposit comes back to you at the end of the tenancy, less anything properly ` +
          `deducted under your lease; the one-time fee does not.`
        )
      : '',
    doc.requiresCotenantConsent
      ? p(
          `<span style="font-size:12.5px;color:#9b9b9b;">One thing left: your landlord needs ` +
          `written consent from the other tenants at the property before the approval takes ` +
          `effect. That’s in the clause headed <em>“Consent of the other tenants”</em>.</span>`
        )
      : '',
    unchangedNote(doc),
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
  amendment: Pick<LeaseAmendment, 'tenant_name' | 'effective_date'>
  doc: AmendmentDocument
  signatureName: string
  signatureDate: string
  manageUrl: string
}): BuiltEmail {
  const { amendment, doc, signatureName, signatureDate, manageUrl } = input
  const who = amendment.tenant_name || signatureName
  const monthly = monthlyTotal(doc)
  const upfront = dueOnExecution(doc)
  const money = monthly + upfront

  // The to-do, in the order the document imposes it. Collecting the other
  // tenants' consent comes first because the contract says approval is not
  // effective without it — billing pet rent for an approval that has not taken
  // effect is charging for something not yet granted.
  const todo: string[] = []
  if (doc.requiresCotenantConsent) {
    todo.push(
      'Collect written consent from the other tenants at the property. Your approval is ' +
      'not effective until you have it — that is this document’s own condition.'
    )
  }
  if (monthly > 0) {
    todo.push(
      `Add ${fmtDollars(monthly)} a month to ${who}’s share in Financials, from ` +
      `${monthName(amendment.effective_date)}.`
    )
  }
  if (upfront > 0) {
    todo.push(`Charge the ${fmtDollars(upfront)} due on signing as a one-off.`)
  }

  const subject = money > 0
    ? `${who} signed — ${joinPlain([
        ...(upfront > 0 ? [`${fmtDollars(upfront)} due now`] : []),
        ...(monthly > 0 ? [`${fmtDollars(monthly)}/mo`] : []),
      ])} to collect`
    : `${who} signed the ${shortNoun(doc)}`

  const rows: Array<[string, string]> = [
    ['Signed by', signatureName],
    ['Date signed', fmtLegalDate(signatureDate)],
  ]
  for (const c of chargesOf(doc)) {
    rows.push([c.label, c.kind === 'monthly' ? `${fmtDollars(c.amount)} per month` : fmtDollars(c.amount)])
  }
  if (upfront > 0) rows.push(['Due on signing', fmtDollars(upfront)])
  rows.push(['Takes effect', fmtLegalDate(amendment.effective_date)])

  const body = [
    p(
      `<strong>${esc(signatureName)}</strong> signed the ${esc(doc.title)} for ` +
      `<strong>${esc(doc.premises)}</strong> on ${esc(fmtLegalDate(signatureDate))}.`
    ),
    terms(rows),
    todo.length > 0
      ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:20px;">` +
        `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#92400e;margin-bottom:8px;">` +
        `${todo.length === 1 ? 'One thing left to do' : `${todo.length} things left to do`}</div>` +
        todo.map((t, i) => (
          `<div style="font-size:13px;color:#92400e;line-height:1.6;${i ? 'margin-top:8px;' : ''}">` +
          `${i + 1}. ${esc(t)}</div>`
        )).join('') +
        (money > 0
          ? `<div style="font-size:12px;color:#92400e;line-height:1.55;margin-top:10px;opacity:.85;">` +
            `Signing doesn’t charge anybody — nothing is collected until you add it.</div>`
          : '') +
        `</div>`
      : '',
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Open the amendment', url: manageUrl })}</div>`,
  ].filter(Boolean).join('\n')

  const text = [
    `${signatureName} signed the ${doc.title} for ${doc.premises} on ${fmtLegalDate(signatureDate)}.`,
    '',
    ...rows.map(([k, v]) => `  ${k}: ${v}`),
    ...(todo.length > 0
      ? ['', todo.length === 1 ? 'One thing left to do:' : 'Left to do:', ...todo.map((t, i) => `  ${i + 1}. ${t}`)]
      : []),
    ...(money > 0 ? ['', "Signing doesn't charge anybody — nothing is collected until you add it."] : []),
    '',
    manageUrl,
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: emailShell({
      banner: 'Signed by the tenant',
      bannerSubject: doc.title,
      tone: todo.length > 0 ? 'action' : 'good',
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
