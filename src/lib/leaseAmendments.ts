// Lease amendments: changing one term of a signed tenancy, in writing, with a
// signature on it.
//
// The thing a student landlord actually needs mid-lease is almost never a new
// lease. It is one change — a pet arrives, a parking space is added, a roommate
// swaps a room — agreed in a text message and then remembered differently by
// both sides in June. The portal had nowhere to put that, so it happened in
// iMessage and the lease stayed silent about it.
//
// Three decisions shape everything here, and they are the ones worth arguing
// about rather than the schema:
//
//   • **An amendment is not an edit to the lease.** Nothing in this file writes
//     to `leases`. The signed lease is the historical record of what was agreed
//     in August and it has to keep saying that — the same reason an accepted
//     renewal becomes a *new* lease rather than overwriting the old one (see
//     src/lib/renewals.ts). An amendment is a second document that sits on top,
//     names the first, and changes exactly what it says it changes.
//
//   • **The document is frozen at send time, not re-rendered at read time.**
//     `buildPetAdditionDocument` runs once, when the landlord sends it, and the
//     result is stored on the row. Every later read — the landlord's copy, the
//     tenant's signing page, the PDF they print in a dispute — renders that
//     stored JSON. If instead the page rebuilt the document from the property
//     name and the rent each time it loaded, then renaming the property in
//     March would silently change the wording of a contract signed in November.
//     A signed document that can change is not a signed document.
//
//   • **The non-modification clause is not boilerplate, it is the feature.**
//     The whole risk in handing a landlord a one-click "change the lease"
//     button is that they change more than they meant to, and a tenant signs
//     something that quietly re-opens their rent or their term. So every
//     document this file builds ends with an express statement that the rest of
//     the lease is untouched, and the charge clause states the complete list of
//     money owed under the amendment — including, out loud, that there is
//     nothing else. `verifyAmendmentDocument` fails a build that drops either.
//
// Pure, with no Supabase import, so `npm run verify:amendments` can exercise
// the document and the state machine without a database.

import { billingToday } from './rentPayments'

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * What somebody did, and nothing else.
 *
 * Deliberately four verbs, matching `lease_renewals`:
 *
 *   sent      — it is out with the tenant, waiting for a signature
 *   signed    — the tenant signed it; it is now part of the tenancy
 *   declined  — the tenant said no
 *   withdrawn — the landlord pulled it before it was answered
 *
 * There is no `expired`, and there is no `active`/`ended` pair. An amendment
 * whose effective date has not arrived yet is still perfectly signed, and one
 * on a lease that has since ended is still the record of what was agreed. Both
 * of those are arithmetic over dates, so they are derived by `amendmentPhase`
 * and never stored — the lesson `late_fees_applied` taught this codebase the
 * expensive way, where a stored boolean drifted from the facts and every reader
 * that trusted it was wrong.
 */
export type AmendmentStatus = 'sent' | 'signed' | 'declined' | 'withdrawn'

export const AMENDMENT_STATUSES: AmendmentStatus[] = ['sent', 'signed', 'declined', 'withdrawn']

export const STATUS_META: Record<AmendmentStatus, {
  label: string
  /** What the landlord should understand from this state, in one line. */
  blurb: string
  color: string
  bg: string
  border: string
  /** Sort weight for the landlord's list: lower is more pressing. */
  rank: number
}> = {
  sent: {
    label: 'Awaiting signature',
    blurb: 'Sent to the tenant. Not in force until they sign it.',
    color: '#92400e', bg: '#fffbeb', border: '#f59e0b', rank: 0,
  },
  signed: {
    label: 'Signed',
    blurb: 'Signed by the tenant and part of the tenancy.',
    color: '#065f46', bg: '#ecfdf5', border: '#10b981', rank: 1,
  },
  declined: {
    label: 'Declined',
    blurb: 'The tenant declined. The lease is unchanged.',
    color: '#991b1b', bg: '#fef2f2', border: '#dc2626', rank: 2,
  },
  withdrawn: {
    label: 'Withdrawn',
    blurb: 'You pulled this before it was signed. The lease is unchanged.',
    color: '#475569', bg: '#f8fafc', border: '#94a3b8', rank: 3,
  },
}

/** The kinds of change this file knows how to write. */
export type AmendmentKind = 'pet_addition' | 'other'

export const KIND_META: Record<AmendmentKind, { label: string; noun: string }> = {
  pet_addition: { label: 'Pet addition', noun: 'pet addendum' },
  other:        { label: 'Other change', noun: 'lease amendment' },
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** A `YYYY-MM-DD` date as a UTC-midnight instant, for whole-day arithmetic. */
function dayMs(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Today, as the tenant's calendar sees it.
 *
 * Phoenix, not UTC, and not the browser. The signature date on this page is
 * limited to "today" and nothing else, so the definition of today had better
 * not be the one that rolls over at 5pm local — a tenant signing at 6pm on the
 * 3rd would otherwise be offered the 4th as their only legal option, and the
 * server would reject it. Same rule as rent: see `billingToday`.
 */
export function signingToday(now = new Date()): string {
  return billingToday(now)
}

/** "November 3, 2026" — how a contract names a date. */
export function fmtLegalDate(date: string | null | undefined): string {
  if (!date || !DATE_RE.test(date.slice(0, 10))) return '—'
  return new Date(date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/** "Nov 3, 2026" — how a list names one. */
export function fmtShortDate(date: string | null | undefined): string {
  if (!date || !DATE_RE.test(date.slice(0, 10))) return '—'
  return new Date(date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/** Whole dollars, as a contract writes them: `$65.00`. */
export function fmtDollars(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * `$65.00 (sixty-five dollars)`.
 *
 * Words beside the figure, because that is what a rent amendment looks like and
 * because the words are what survive a smudged print or a disputed digit. Only
 * needs to reach into the low thousands — a monthly pet rent of $1,000,000 is
 * not a case worth carrying code for, so above the range it quietly omits the
 * words rather than printing something wrong.
 */
const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function under1000(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]
    const r = n % 10
    return r === 0 ? t : `${t}-${ONES[r]}`
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`
  const r = n % 100
  return r === 0 ? h : `${h} ${under1000(r)}`
}

export function dollarsInWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return null
  if (n < 1000) return `${under1000(n)} dollar${n === 1 ? '' : 's'}`
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  const head = `${under1000(thousands)} thousand`
  const body = rest === 0 ? head : `${head} ${under1000(rest)}`
  return `${body} dollars`
}

/** `$65.00 (sixty-five dollars)`, falling back to the figure alone. */
export function fmtMoneyWithWords(n: number): string {
  const words = dollarsInWords(n)
  return words ? `${fmtDollars(n)} (${words})` : fmtDollars(n)
}

// ── The document ─────────────────────────────────────────────────────────────

/**
 * One numbered clause.
 *
 * `paragraphs` rather than one blob of text so the signing page can set them
 * with real spacing, and so a clause can be quoted on its own ("clause 3 says
 * the pet rent is $65") without string surgery.
 */
export type AmendmentClause = {
  heading: string
  paragraphs: string[]
}

/**
 * The frozen contract.
 *
 * This whole object is written to `lease_amendments.document` at send time and
 * never touched again. Everything a reader needs is inside it — the property
 * address, the parties' names, the lease term it amends — precisely so that no
 * later read has to go looking for those elsewhere and risk finding a changed
 * answer. See the note at the top of the file.
 */
export type AmendmentDocument = {
  /** Schema version of this shape. Bumped if the clause model ever changes. */
  version: 1
  title: string
  /** Address of the premises, as written into the document. */
  premises: string
  /** The party names, snapshotted. */
  landlordName: string
  tenantName: string
  /** The lease being amended, named by its term. */
  leaseStartDate: string
  leaseEndDate: string
  /** When the change takes effect. */
  effectiveDate: string
  /** The date on the document itself — when the landlord drew it up. */
  agreementDate: string
  /** The monthly charge the amendment adds, in whole dollars. 0 = none. */
  monthlyCharge: number
  monthlyChargeLabel: string
  recitals: string[]
  clauses: AmendmentClause[]
  /** The sentence above the signature box. */
  signatureStatement: string
}

/** What a landlord fills in to add a pet to a lease. */
export type PetAdditionInput = {
  propertyAddress: string
  landlordName: string
  tenantName: string
  leaseStartDate: string
  leaseEndDate: string
  effectiveDate: string
  agreementDate: string
  /** Whole dollars per month. The complete charge — see `CLAUSE_NO_OTHER`. */
  monthlyPetRent: number
  pet: {
    name: string
    /** "Dog", "Cat". */
    species: string
    breed?: string | null
    /** Adult weight in pounds. */
    weightLbs?: number | null
    color?: string | null
    /** Spayed or neutered. Named in the document when true. */
    sterilized?: boolean
    /** Licensed and vaccinated per Maricopa County. Named when true. */
    vaccinated?: boolean
  }
  /** Anything the landlord wants to add, verbatim, as a final clause. */
  additionalTerms?: string | null
}

/**
 * A one-line description of the animal, for the clause that identifies it.
 *
 * The identification matters more than it reads: permission is granted for
 * *this* pet, which is the difference between an addendum and an open licence
 * to keep animals. A dispute about a second dog turns entirely on whether the
 * document described the first one.
 */
export function describePet(pet: PetAdditionInput['pet']): string {
  const bits: string[] = []
  if (pet.color?.trim()) bits.push(pet.color.trim())
  if (pet.breed?.trim()) bits.push(pet.breed.trim())
  bits.push(pet.species.trim().toLowerCase() || 'animal')
  let s = `one (1) ${bits.join(' ')}`
  if (pet.name.trim()) s += ` named "${pet.name.trim()}"`
  if (pet.weightLbs && pet.weightLbs > 0) s += `, approximately ${pet.weightLbs} lbs at adult weight`
  return s
}

/**
 * The sentence that keeps this from being a rewrite of the lease.
 *
 * Exported, and asserted on by `verifyAmendmentDocument`, because it is the
 * single clause a well-meaning edit is most likely to soften — and the one the
 * tenant is relying on when they sign a document about a cat without re-reading
 * their rent and their move-out date.
 */
export const CLAUSE_NO_MODIFICATION =
  'Except as expressly provided in this Amendment, every term, covenant and ' +
  'condition of the Lease remains unchanged and in full force and effect. This ' +
  'Amendment does not alter the monthly rent, the security deposit, the lease ' +
  'term, the start or end date, the occupants, or any other provision of the ' +
  'Lease. In the event of any conflict between this Amendment and the Lease, ' +
  'this Amendment controls, and then only as to the subject matter expressly ' +
  'addressed in it.'

/**
 * And the sentence that closes the list of money.
 *
 * "Pet rent is $65" leaves open a pet deposit, a one-time pet fee, a cleaning
 * charge at move-out and an admin fee, all of which are ordinary in this market
 * and none of which the tenant agreed to. Saying so explicitly is the whole
 * difference between a clear document and a cheap one.
 */
export const CLAUSE_NO_OTHER_CHARGES =
  'No other charge of any kind arises under this Amendment. There is no pet ' +
  'deposit, no one-time pet fee, no additional security deposit, no pet ' +
  'cleaning fee and no administrative fee. The security deposit held under the ' +
  'Lease is not increased. Nothing in this paragraph limits the Tenant’s ' +
  'existing obligation under the Lease to pay for actual damage to the premises.'

/**
 * Build the pet addendum.
 *
 * The clause order is the order a reader needs them in, not the order a lawyer
 * drafts them in: what is permitted, what it costs, what the tenant is
 * responsible for, how permission can end, and then — last, where it is read
 * rather than skimmed past — that nothing else about the lease moved.
 */
export function buildPetAdditionDocument(input: PetAdditionInput): AmendmentDocument {
  const {
    propertyAddress, landlordName, tenantName, leaseStartDate, leaseEndDate,
    effectiveDate, agreementDate, monthlyPetRent, pet, additionalTerms,
  } = input

  const petDesc = describePet(pet)
  const rent = fmtMoneyWithWords(monthlyPetRent)

  const recitals = [
    `This Change of Lease Agreement (this “Amendment”) is made as of ` +
    `${fmtLegalDate(agreementDate)} between ${landlordName} (“Landlord”) and ` +
    `${tenantName} (“Tenant”).`,

    `Landlord and Tenant are parties to a residential lease agreement for the ` +
    `premises at ${propertyAddress} (the “Premises”), with a term running from ` +
    `${fmtLegalDate(leaseStartDate)} to ${fmtLegalDate(leaseEndDate)} (the “Lease”).`,

    `Tenant has asked to keep a pet at the Premises, which the Lease does not ` +
    `otherwise permit. Landlord is willing to allow it on the terms below. ` +
    `Landlord and Tenant therefore agree as follows.`,
  ]

  const conditions: string[] = [
    `Permission under this Amendment is limited to the pet described in ` +
    `paragraph 1. It does not extend to any other animal, to a replacement for ` +
    `this pet, or to any additional pet, each of which requires Landlord’s ` +
    `separate written consent.`,
  ]
  if (pet.vaccinated) {
    conditions.push(
      `Tenant shall keep the pet currently licensed and vaccinated as required ` +
      `by the City of Tempe and Maricopa County, and shall provide proof on ` +
      `Landlord’s request.`
    )
  }
  if (pet.sterilized) {
    conditions.push(`Tenant represents that the pet is spayed or neutered.`)
  }
  conditions.push(
    `Tenant shall promptly remove all pet waste from the Premises and from any ` +
    `shared or common area, shall keep the pet leashed or carried outside the ` +
    `Premises, and shall not leave the pet unattended in any shared or outdoor ` +
    `area of the Premises.`,
    `Tenant shall not allow the pet to disturb the quiet enjoyment of any other ` +
    `occupant or neighbour, and shall comply with all applicable animal control ` +
    `ordinances.`,
    `Tenant is responsible for the cost of repairing any damage to the Premises ` +
    `caused by the pet, including damage to flooring, doors, screens, walls and ` +
    `landscaping, and for any pest treatment attributable to the pet. This ` +
    `obligation survives the end of the Lease and is in addition to, and not ` +
    `limited by, the security deposit.`,
  )

  const clauses: AmendmentClause[] = [
    {
      heading: 'Pet permitted',
      paragraphs: [
        `Effective ${fmtLegalDate(effectiveDate)}, Tenant is permitted to keep ` +
        `${petDesc} at the Premises for the remainder of the Lease term, subject ` +
        `to the conditions in this Amendment.`,
      ],
    },
    {
      heading: 'Pet rent',
      paragraphs: [
        `Tenant shall pay pet rent of ${rent} per month, beginning with the ` +
        `rent payment due for ${monthName(effectiveDate)} and continuing each ` +
        `month for so long as the pet is kept at the Premises. Pet rent is due ` +
        `on the same day of the month as rent under the Lease, is payable in the ` +
        `same manner, and is treated as additional rent.`,
        CLAUSE_NO_OTHER_CHARGES,
      ],
    },
    {
      heading: 'Tenant’s obligations',
      paragraphs: conditions,
    },
    {
      heading: 'Ending the permission',
      paragraphs: [
        `If Tenant no longer keeps the pet at the Premises, Tenant shall notify ` +
        `Landlord in writing, and pet rent stops at the end of the month in ` +
        `which that notice is given. Pet rent is not refundable for a month ` +
        `already begun.`,
        `Landlord may revoke the permission granted by this Amendment on ` +
        `fourteen (14) days’ written notice if Tenant materially breaches ` +
        `this Amendment, or if the pet is determined by an animal control ` +
        `authority to be dangerous. Revocation ends the permission and the pet ` +
        `rent; it is not a termination of the Lease, which continues in force.`,
      ],
    },
    {
      heading: 'The rest of the Lease is unchanged',
      paragraphs: [CLAUSE_NO_MODIFICATION],
    },
  ]

  if (additionalTerms?.trim()) {
    // Inserted before the non-modification clause on purpose: that clause has
    // to be the last word, or a free-text addition appearing after it reads as
    // carving an exception out of it.
    clauses.splice(clauses.length - 1, 0, {
      heading: 'Additional terms',
      paragraphs: [additionalTerms.trim()],
    })
  }

  return {
    version: 1,
    title: 'Change of Lease Agreement — Pet Addition',
    premises: propertyAddress,
    landlordName,
    tenantName,
    leaseStartDate,
    leaseEndDate,
    effectiveDate,
    agreementDate,
    monthlyCharge: monthlyPetRent,
    monthlyChargeLabel: 'Pet rent',
    recitals,
    clauses,
    signatureStatement:
      `By typing my full legal name below and submitting this form, I am signing ` +
      `this Amendment electronically. I agree that my electronic signature is ` +
      `the legal equivalent of my handwritten signature under the Arizona ` +
      `Electronic Transactions Act (A.R.S. § 44-7001 et seq.) and the ` +
      `federal E-SIGN Act, and that it binds me to this Amendment. I confirm ` +
      `that I have read this Amendment in full and that I have been able to ` +
      `download or print a copy of it.`,
  }
}

/** "November 2026" — for naming the month a charge starts. */
export function monthName(date: string): string {
  if (!DATE_RE.test(date.slice(0, 10))) return 'the applicable month'
  return new Date(date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * Refuse to send a document that is missing the protections it promises.
 *
 * A guard rather than a test, and run inside the send route, because the
 * failure it catches is not a crash: it is a perfectly plausible-looking
 * contract that quietly dropped the clause saying the rent is untouched. By the
 * time anybody notices, a tenant has signed it. Returns the problems; an empty
 * array means it is safe to send.
 */
export function verifyAmendmentDocument(doc: AmendmentDocument): string[] {
  const problems: string[] = []
  const all = [...doc.recitals, ...doc.clauses.flatMap(c => c.paragraphs)].join('\n')

  if (!doc.title.trim()) problems.push('The document has no title.')
  if (!doc.premises.trim()) problems.push('The document does not name the premises.')
  if (!doc.tenantName.trim()) problems.push('The document does not name the tenant.')
  if (!doc.landlordName.trim()) problems.push('The document does not name the landlord.')
  if (!DATE_RE.test(doc.effectiveDate)) problems.push('The effective date is not a date.')
  if (!DATE_RE.test(doc.leaseStartDate) || !DATE_RE.test(doc.leaseEndDate)) {
    problems.push('The document does not name the lease term it amends.')
  }
  if (doc.clauses.length === 0) problems.push('The document has no clauses.')

  if (!all.includes(CLAUSE_NO_MODIFICATION)) {
    problems.push(
      'The document is missing the clause stating that the rest of the lease is ' +
      'unchanged. It cannot be sent without it.'
    )
  }
  if (doc.monthlyCharge > 0 && !all.includes(CLAUSE_NO_OTHER_CHARGES)) {
    problems.push(
      'The document adds a monthly charge but does not state that no other ' +
      'charge arises. It cannot be sent without it.'
    )
  }
  if (!doc.signatureStatement.trim()) {
    problems.push('The document has no electronic-signature statement.')
  }
  return problems
}

/**
 * The document as plain text.
 *
 * Derived from the stored JSON by this one function, so the printed copy, the
 * emailed copy and the on-screen copy can never say different things. Used for
 * the text part of the signing email and for the download a tenant keeps.
 */
export function renderAmendmentText(
  doc: AmendmentDocument,
  signature?: AmendmentSignature | null
): string {
  const lines: string[] = []
  lines.push(doc.title.toUpperCase(), '')
  lines.push(`Premises: ${doc.premises}`)
  lines.push(`Landlord: ${doc.landlordName}`)
  lines.push(`Tenant:   ${doc.tenantName}`)
  lines.push(`Lease term: ${fmtLegalDate(doc.leaseStartDate)} to ${fmtLegalDate(doc.leaseEndDate)}`)
  lines.push(`Effective: ${fmtLegalDate(doc.effectiveDate)}`)
  lines.push('')
  for (const r of doc.recitals) lines.push(wrap(r), '')
  doc.clauses.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.heading.toUpperCase()}`)
    for (const p of c.paragraphs) lines.push(wrap(p, '   '), '')
  })
  lines.push('SIGNATURE', '')
  lines.push(wrap(doc.signatureStatement, '   '), '')
  if (signature) {
    lines.push(`   Signed by:   ${signature.name}`)
    lines.push(`   Date signed: ${fmtLegalDate(signature.date)}`)
    if (signature.signedAt) lines.push(`   Recorded at: ${signature.signedAt}`)
  } else {
    lines.push('   Signed by:   ____________________________')
    lines.push('   Date signed: ______________')
  }
  lines.push('')
  lines.push(`   Landlord: ${doc.landlordName}`)
  lines.push(`   Date:     ${fmtLegalDate(doc.agreementDate)}`)
  return lines.join('\n')
}

/** Hard-wrap a paragraph to 76 columns with an optional hanging indent. */
function wrap(text: string, indent = ''): string {
  const words = text.split(/\s+/)
  const out: string[] = []
  let line = indent
  for (const w of words) {
    if (line.trim() && (line + ' ' + w).length > 76) {
      out.push(line)
      line = indent + w
    } else {
      line = line.trim() ? `${line} ${w}` : indent + w
    }
  }
  if (line.trim()) out.push(line)
  return out.join('\n')
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** What the tenant typed, and what the server recorded around it. */
export type AmendmentSignature = {
  /** The name they typed. The signature itself. */
  name: string
  /** The date they chose, which the server only accepts as today. */
  date: string
  /** When the server recorded it, ISO. */
  signedAt?: string | null
}

export type LeaseAmendment = {
  id: string
  lease_id: string
  owner_id: string
  property_id: string | null
  lease_tenant_id: string | null
  kind: AmendmentKind
  title: string
  effective_date: string
  monthly_charge: number
  monthly_charge_label: string | null
  document: AmendmentDocument
  status: AmendmentStatus
  tenant_name: string | null
  tenant_email: string
  token: string
  sent_at: string
  /** The signature, flat on the row so it can be indexed and audited. */
  signed_at: string | null
  signature_name: string | null
  signature_date: string | null
  signature_ip: string | null
  signature_user_agent: string | null
  signed_by_user_id: string | null
  declined_at: string | null
  decline_reason: string | null
  /** Set once the landlord has put the charge on the tenant's ledger. */
  billed_at: string | null
  created_at: string
  updated_at: string
}

/** The signature as a value, or null if it was never signed. */
export function signatureOf(a: LeaseAmendment): AmendmentSignature | null {
  if (a.status !== 'signed' || !a.signature_name || !a.signature_date) return null
  return { name: a.signature_name, date: a.signature_date, signedAt: a.signed_at }
}

/**
 * Where a signed amendment is in its life, by the calendar.
 *
 * Never stored. `pending` and `in_force` differ only by whether today has
 * reached the effective date, which changes with no code running.
 */
export type AmendmentPhase = 'unsigned' | 'pending' | 'in_force' | 'closed'

export function amendmentPhase(a: LeaseAmendment, now = new Date()): AmendmentPhase {
  if (a.status === 'declined' || a.status === 'withdrawn') return 'closed'
  if (a.status !== 'signed') return 'unsigned'
  return dayMs(a.effective_date) > dayMs(signingToday(now)) ? 'pending' : 'in_force'
}

/**
 * The one thing the landlord should do about this amendment next.
 *
 * `bill` is the step this feature could easily have hidden: a signed pet
 * addendum means $65 a month that nobody is collecting until somebody adds the
 * line item. Signing the document does *not* add the charge automatically —
 * writing to a tenant's ledger as a side effect of their own signature is the
 * kind of surprise that costs trust, and a shared lease needs the landlord to
 * say which payer carries it. So the signature produces a visible, dismissable
 * instruction instead, and `billed_at` records that it was followed.
 */
export type AmendmentAction =
  | { kind: 'await'; label: string; detail: string }
  | { kind: 'bill'; label: string; detail: string }
  | { kind: 'none'; label: string; detail: string }

export function nextAction(a: LeaseAmendment, now = new Date()): AmendmentAction {
  if (a.status === 'sent') {
    const days = Math.round((dayMs(signingToday(now)) - dayMs(a.sent_at.slice(0, 10))) / 86_400_000)
    return {
      kind: 'await',
      label: 'Waiting on the tenant',
      detail: days <= 0
        ? 'Sent today. Nothing is in force until they sign.'
        : `Sent ${days} day${days === 1 ? '' : 's'} ago and not signed yet. ` +
          'Nothing is in force until they sign.',
    }
  }
  if (a.status === 'signed' && a.monthly_charge > 0 && !a.billed_at) {
    return {
      kind: 'bill',
      label: `Add ${fmtDollars(a.monthly_charge)}/mo to their rent`,
      detail:
        `Signing does not charge anybody. Add ${a.monthly_charge_label || 'this charge'} ` +
        `as a line item on ${a.tenant_name || 'the tenant'}’s share from ` +
        `${monthName(a.effective_date)}, or it will never be collected.`,
    }
  }
  if (a.status === 'signed') {
    return { kind: 'none', label: 'Signed and in force', detail: STATUS_META.signed.blurb }
  }
  return { kind: 'none', label: STATUS_META[a.status].label, detail: STATUS_META[a.status].blurb }
}

/** Newest first, with anything awaiting a signature pulled to the top. */
export function sortAmendments(rows: LeaseAmendment[]): LeaseAmendment[] {
  return [...rows].sort((a, b) =>
    STATUS_META[a.status].rank - STATUS_META[b.status].rank ||
    b.sent_at.localeCompare(a.sent_at)
  )
}

/**
 * Where the tenant signs, relative to the site root.
 *
 * Here rather than in a route file so the send route, the reminder route and
 * the signing page cannot drift apart — a link in an email that 404s is a
 * contract that never gets signed, and it fails silently on the one path
 * nobody is watching. Login-gated: `/login?next=` carries the tenant through.
 */
export function amendmentPath(token: string): string {
  return `/dashboard/lease/amendments/${token}`
}

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * Is this typed name an acceptable signature from this person?
 *
 * The bar is deliberately low and deliberately not zero. Requiring an exact
 * match against `lease_tenants.name` would reject "Aleeya M. Cruz" from
 * somebody recorded as "Aleeya Cruz", and reject a married name, and reject the
 * tenant whose landlord typed their name wrong — each of which blocks a
 * signature the tenant is entitled to give. But accepting "x" or "ok" would
 * make the signature worthless.
 *
 * So: a plausible full name, with two tokens, and it must share a name part
 * with the person on the lease. Identity is established by the login and by the
 * email the document was sent to, which is the part that actually has to hold.
 */
export function checkSignatureName(typed: string, expected: string | null): string | null {
  const t = typed.trim().replace(/\s+/g, ' ')
  if (t.length < 3) return 'Type your full legal name to sign.'
  if (!/[a-z]/i.test(t)) return 'Type your full legal name to sign.'
  if (t.split(' ').length < 2) {
    return 'Type your full legal name — first and last — exactly as you sign it.'
  }
  const exp = (expected || '').trim().toLowerCase()
  if (!exp) return null
  const expParts = new Set(exp.split(/\s+/).filter(p => p.length > 1))
  const typedParts = t.toLowerCase().split(' ').filter(p => p.length > 1)
  if (expParts.size > 0 && !typedParts.some(p => expParts.has(p))) {
    return `That name doesn’t match the tenant on this amendment (${expected}). ` +
      'If your name is recorded wrongly, contact your landlord rather than signing a different name.'
  }
  return null
}

/**
 * Is this an acceptable signature date?
 *
 * Today, in Phoenix, and nothing else. Not yesterday — backdating a contract is
 * the single most consequential thing a signing form can allow, and it is also
 * the easiest to do by accident with a free date field. Not tomorrow either.
 * The UI pins the input to today; this is the server saying the same thing, so
 * a crafted request cannot do what the form will not.
 */
export function checkSignatureDate(date: string, now = new Date()): string | null {
  if (!DATE_RE.test(date)) return 'Pick the date you are signing.'
  const today = signingToday(now)
  if (date !== today) {
    return `An amendment can only be signed with today’s date (${fmtLegalDate(today)}).`
  }
  return null
}
