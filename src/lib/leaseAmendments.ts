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
//   • **The money clause must name every charge, and the guard checks that it
//     does.** The risk in handing a landlord a one-click "change the lease"
//     button is a tenant signing something whose cost they did not see. So
//     every document ends with a sentence listing the complete set of amounts
//     arising under it, and `verifyAmendmentDocument` refuses to send a
//     document whose charges are not all named in that sentence. It is a
//     computed check rather than a fixed string on purpose: a fixed
//     "there are no other charges" clause was the first version of this file,
//     and it would have been a false statement the moment a deposit was added.
//     The guard now fails the document instead of lying in it.
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
 * There is no `expired`, and no `active`/`ended` pair. An offer past its
 * acceptance deadline is expired by arithmetic the moment it passes, whether or
 * not any code was running to notice; an amendment whose effective date has not
 * arrived is still perfectly signed. Both are derived by `amendmentPhase` and
 * never stored — the lesson `late_fees_applied` taught this codebase the
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

/** Whole days between two `YYYY-MM-DD` dates. Negative when `to` is earlier. */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86_400_000)
}

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

/** "November 2026" — for naming the month a charge starts. */
export function monthName(date: string): string {
  if (!DATE_RE.test(date.slice(0, 10))) return 'the applicable month'
  return new Date(date.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
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
 * needs to reach into the low thousands — a pet deposit of $1,000,000 is not a
 * case worth carrying code for, so above the range it quietly omits the words
 * rather than printing something wrong.
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

// ── The money on an amendment ────────────────────────────────────────────────

/**
 * One amount the tenant owes under the amendment.
 *
 * Modelled rather than hard-coded, because the whole safety property of this
 * file is that the closing sentence names *every* charge — and a guard can only
 * check that if the charges are a list it can walk. Three kinds, because the
 * three behave completely differently at move-out and a tenant who confuses
 * them is a tenant who thinks they are getting $400 back:
 *
 *   monthly     — recurring, paid with rent
 *   deposit     — refundable, held, returned subject to deductions
 *   fee         — one-time and gone
 */
export type AmendmentChargeKind = 'monthly' | 'deposit' | 'fee'

export type AmendmentCharge = {
  kind: AmendmentChargeKind
  /** "Pet rent", "Pet security deposit", "One-time pet cleaning fee". */
  label: string
  /** Whole dollars. */
  amount: number
  /** A phrase for the closing sentence: "monthly pet rent of $65.00". */
  phrase: string
}

/** The charges, in the order a reader meets them. */
export function chargesOf(doc: AmendmentDocument): AmendmentCharge[] {
  return doc.charges.filter(c => c.amount > 0)
}

/** Everything due when the tenant signs: the deposits and the one-time fees. */
export function dueOnExecution(doc: AmendmentDocument): number {
  return chargesOf(doc).filter(c => c.kind !== 'monthly').reduce((s, c) => s + c.amount, 0)
}

/** The recurring part. */
export function monthlyTotal(doc: AmendmentDocument): number {
  return chargesOf(doc).filter(c => c.kind === 'monthly').reduce((s, c) => s + c.amount, 0)
}

/** "a, b and c" — an Oxford-free list, as a contract writes one. */
function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The sentence that closes the list of money.
 *
 * This is the clause that makes the document safe to sign quickly, and it is
 * computed from the charges rather than written by hand so it cannot drift from
 * them. "Pet rent is $65" on its own leaves a deposit, a cleaning fee and an
 * admin fee open, all of which are ordinary in this market; naming the complete
 * set and then closing it is the whole difference between a clear document and
 * a cheap one.
 */
export function buildChargesClosingClause(charges: AmendmentCharge[]): string {
  const live = charges.filter(c => c.amount > 0)
  if (live.length === 0) {
    return 'No charge of any kind arises under this Amendment. The Tenant’s rent, ' +
      'security deposit and every other amount owed under the Lease are unchanged.'
  }
  return (
    `The amounts stated in this Amendment — ${joinList(live.map(c => c.phrase))} — are ` +
    `the complete list of charges arising under it. No other pet fee, pet deposit, ` +
    `administrative fee, recurring charge or move-in charge of any kind arises under this ` +
    `Amendment, and the security deposit held under the Lease is not increased except by the ` +
    `pet security deposit expressly stated above. Nothing in this paragraph limits the ` +
    `Tenant’s obligation under this Amendment or the Lease to pay for actual damage.`
  )
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
 * address, the parties' names, the lease term it amends, every charge —
 * precisely so that no later read has to go looking for those elsewhere and
 * risk finding a changed answer. See the note at the top of the file.
 */
export type AmendmentDocument = {
  /** Schema version of this shape. Bumped if the clause model ever changes. */
  version: 2
  title: string
  /** The boxed statement at the head of the document. */
  notice: string
  /** The heading over the substantive part, e.g. "PET APPROVAL AND LEASE AMENDMENT". */
  sectionTitle: string
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
  /**
   * The last day the tenant may sign. Null means no deadline.
   *
   * Stored as part of the frozen document *and* on the row, because it governs
   * whether a signature is accepted and a column is what an index can use.
   */
  respondBy: string | null
  /** Every amount owed under this amendment. Drives the closing clause. */
  charges: AmendmentCharge[]
  /** The at-a-glance block above the recitals. */
  summary: Array<[label: string, value: string]>
  recitals: string[]
  clauses: AmendmentClause[]
  /** The acceptance terms, printed above the signature block. */
  acceptance: string[]
  /** The sentence above the signature box. */
  signatureStatement: string
  /**
   * True when approval does not take effect until something outside this
   * document arrives — here, written consent from the other tenants.
   */
  requiresCotenantConsent: boolean
  /**
   * True when `effectiveDate` is earlier than `agreementDate`.
   *
   * Computed once, at build time, and frozen with the rest of the document.
   * Every surface that mentions the dates reads this rather than comparing
   * them again, so none of them can disagree about whether a tenant is being
   * asked to agree to something retroactive.
   */
  isBackdated: boolean
}

/** The animal, identified. */
export type PetIdentity = {
  name: string
  /** "Dog", "Cat". */
  species: string
  breed?: string | null
  color?: string | null
  /** "Male" / "Female". */
  sex?: string | null
  /** As written on the vet record: "33 lbs 15 oz". Free text, not a number. */
  weight?: string | null
  /** `YYYY-MM-DD`. */
  dob?: string | null
  microchip?: string | null
  /** Spayed or neutered. Named in the document when true. */
  sterilized?: boolean
  /** Licensed and vaccinated per Maricopa County. Named when true. */
  vaccinated?: boolean
  /** Shelter / licence number, e.g. "A861983". */
  recordNumber?: string | null
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
  /** Whole dollars per month, paid with rent. */
  monthlyPetRent: number
  /** Refundable, held under the Lease and Arizona law. 0 for none. */
  petDeposit?: number
  /** One-time and nonrefundable. 0 for none. */
  cleaningFee?: number
  /** Last day the tenant may sign. Null for no deadline. */
  respondBy?: string | null
  pet: PetIdentity
  /**
   * The other tenants on the lease must consent in writing before approval
   * takes effect. True on a shared house; pointless on a single tenancy.
   */
  requireCotenantConsent?: boolean
  /** Anything the landlord wants to add, verbatim, as a final clause. */
  additionalTerms?: string | null
}

/**
 * A one-line description of the animal, for the clause that identifies it.
 *
 * The identification matters more than it reads: permission is granted for
 * *this* pet, which is the difference between an addendum and an open licence
 * to keep animals. A dispute about a second dog turns entirely on whether the
 * document described the first one — so everything on the vet record that
 * distinguishes this animal goes in, microchip included.
 */
export function describePet(pet: PetIdentity): string {
  const front: string[] = []
  if (pet.sex?.trim()) front.push(pet.sex.trim().toLowerCase())
  if (pet.color?.trim()) front.push(pet.color.trim().toLowerCase())
  if (pet.breed?.trim()) front.push(pet.breed.trim())
  front.push(pet.species.trim().toLowerCase() || 'animal')

  let s = `one (1) ${front.join(' ')}`
  if (pet.name.trim()) s += ` named “${pet.name.trim()}”`

  const tail: string[] = []
  if (pet.dob?.trim() && DATE_RE.test(pet.dob.slice(0, 10))) {
    tail.push(`date of birth ${fmtLegalDate(pet.dob)}`)
  }
  if (pet.weight?.trim()) tail.push(`approximately ${pet.weight.trim()}`)
  if (pet.sterilized) tail.push('spayed or neutered')
  if (pet.microchip?.trim()) tail.push(`microchip no. ${pet.microchip.trim()}`)
  if (pet.recordNumber?.trim()) tail.push(`record no. ${pet.recordNumber.trim()}`)

  return tail.length > 0 ? `${s}, ${joinList(tail)}` : s
}

/**
 * The sentence that keeps this from being a rewrite of the lease.
 *
 * Exported, and asserted on by `verifyAmendmentDocument`, because it is the
 * single clause a well-meaning edit is most likely to soften — and the one the
 * tenant is relying on when they sign a document about a dog without
 * re-reading their rent and their move-out date.
 */
export const CLAUSE_NO_MODIFICATION =
  'Except as specifically amended by this document, all terms, conditions, rules, ' +
  'responsibilities and obligations contained in the original Lease Agreement remain ' +
  'unchanged and in full force and effect. This Amendment does not alter the monthly rent, ' +
  'the security deposit held for the Premises, the lease term, the start or end date, the ' +
  'occupants, or any other provision of the Lease. This document shall be considered an ' +
  'amendment to, and part of, the original Lease Agreement.'

/** The boxed statement at the head of every change agreement. */
export const DOCUMENT_NOTICE =
  'This agreement is an official document with information about the rental property, the ' +
  'terms of the rental lease agreement, and the conditions to which the Tenant agrees.'

/**
 * Build the pet addendum.
 *
 * The clause order is the order a reader needs them in, not the order a lawyer
 * drafts them in: what is permitted, what it costs, what the tenant is
 * responsible for, what happens if it goes wrong, what has to happen before
 * approval is real, and then — last, where it is read rather than skimmed past
 * — that nothing else about the lease moved.
 */
export function buildPetAdditionDocument(input: PetAdditionInput): AmendmentDocument {
  const {
    propertyAddress, landlordName, tenantName, leaseStartDate, leaseEndDate,
    effectiveDate, agreementDate, monthlyPetRent, pet, additionalTerms,
  } = input

  const deposit = Math.max(0, Math.round(input.petDeposit ?? 0))
  const cleaning = Math.max(0, Math.round(input.cleaningFee ?? 0))
  const rent = Math.max(0, Math.round(monthlyPetRent))
  const respondBy = input.respondBy?.trim() || null
  const needsConsent = input.requireCotenantConsent !== false

  const species = pet.species.trim() || 'animal'
  const speciesLower = species.toLowerCase()
  const petDesc = describePet(pet)

  /**
   * Does this take effect before it is signed?
   *
   * Compared against the document's own date rather than against `new Date()`,
   * so the answer is a property of the document and not of when somebody
   * happens to render it. A document built today is backdated or it is not;
   * that fact must not change next week.
   */
  const isBackdated =
    DATE_RE.test(effectiveDate) && DATE_RE.test(agreementDate) && effectiveDate < agreementDate

  // The charges, as data. Everything downstream — the closing clause, the
  // guard, the summary block, the emails — reads this list rather than
  // re-deriving the amounts, so there is one place a charge can be forgotten
  // and the guard watches that place.
  const charges: AmendmentCharge[] = []
  if (rent > 0) {
    charges.push({
      kind: 'monthly', label: 'Pet rent', amount: rent,
      phrase: `additional monthly pet rent of ${fmtMoneyWithWords(rent)}`,
    })
  }
  if (deposit > 0) {
    charges.push({
      kind: 'deposit', label: 'Pet security deposit', amount: deposit,
      phrase: `a refundable pet security deposit of ${fmtMoneyWithWords(deposit)}`,
    })
  }
  if (cleaning > 0) {
    charges.push({
      kind: 'fee', label: 'One-time pet cleaning fee', amount: cleaning,
      phrase: `a one-time, nonrefundable pet cleaning fee of ${fmtMoneyWithWords(cleaning)}`,
    })
  }
  const upfront = charges.filter(c => c.kind !== 'monthly').reduce((s, c) => s + c.amount, 0)

  const summary: Array<[string, string]> = [
    ['Tenant responsible for pet', tenantName],
    ['Approved pet', `One (1) ${species}${pet.name.trim() ? ` — “${pet.name.trim()}”` : ''}`],
  ]
  for (const c of charges) summary.push([c.label, fmtDollars(c.amount)])
  if (upfront > 0) summary.push(['Due on signing', fmtDollars(upfront)])
  if (isBackdated) {
    summary.push(['Effective as of', `${fmtLegalDate(effectiveDate)} (before signing)`])
  }

  const recitals = [
    `This Residential Change Lease Agreement (this “Amendment”) is made as of ` +
    `${fmtLegalDate(agreementDate)} between ${landlordName} (“Landlord”) and ` +
    `${tenantName} (“Tenant”).`,

    `Landlord and Tenant are parties to a residential lease agreement for the ` +
    `premises at ${propertyAddress} (the “Premises”), with a term running from ` +
    `${fmtLegalDate(leaseStartDate)} to ${fmtLegalDate(leaseEndDate)} (the “Lease”).`,

    `Tenant has asked to keep a ${speciesLower} at the Premises, which the Lease does ` +
    `not otherwise permit. Landlord is willing to approve it on the terms below. ` +
    `Landlord and Tenant therefore agree as follows.`,
  ]

  // Backdating, said out loud.
  //
  // An effective date earlier than the date of signing is ordinary and lawful —
  // it is what "as of" means, and a landlord whose tenant's pet arrived at the
  // start of the month has a real reason to want it. What is not acceptable is
  // leaving a reader to *notice* the gap. A document that quietly says
  // "effective November 1" at the top and is signed on the 4th is
  // indistinguishable, months later, from one that was backdated to hide when
  // it was really agreed. So the recital states both dates and the consequence
  // — that a month of rent has already begun — in the tenant's own interest.
  if (isBackdated) {
    recitals.push(
      `This Amendment is signed on or about ${fmtLegalDate(agreementDate)} but takes effect ` +
      `as of ${fmtLegalDate(effectiveDate)}, which the parties intend and agree. Tenant is ` +
      `therefore responsible for the amounts under this Amendment from ` +
      `${fmtLegalDate(effectiveDate)}, including for any period already elapsed when it is ` +
      `signed.`
    )
  }

  // ── Money clauses, built only for the charges that exist ──────────────────
  //
  // A document that recites a $0.00 deposit is a document that has been
  // generated rather than drafted, and a tenant reads it as such.
  const moneyClauses: AmendmentClause[] = []

  if (rent > 0) {
    moneyClauses.push({
      heading: 'Monthly pet rent',
      paragraphs: [
        `Beginning on ${fmtLegalDate(effectiveDate)}, Tenant shall pay additional monthly ` +
        `pet rent of ${fmtMoneyWithWords(rent)} per month for the approved ${speciesLower}. ` +
        `This pet rent shall be paid together with the regular monthly rent, is due on the ` +
        `same day of the month as rent under the Lease, is treated as additional rent, and ` +
        `shall continue for as long as the approved ${speciesLower} remains at the Premises. ` +
        `It is first payable with the ${monthName(effectiveDate)} rent.` +
        (isBackdated
          // The practical consequence of the "as of" date, in the clause where
          // the money is. A tenant signing on the 4th for a term beginning on
          // the 1st owes that month, and the single worst place to discover
          // that is a ledger entry three weeks later.
          ? ` Because this Amendment takes effect as of ${fmtLegalDate(effectiveDate)}, the ` +
            `${monthName(effectiveDate)} pet rent is owed in full even though this Amendment ` +
            `is signed after that month began, and is payable on signing if that month’s ` +
            `rent has already fallen due.`
          : ''),
      ],
    })
  }

  if (deposit > 0) {
    moneyClauses.push({
      heading: 'Pet security deposit',
      paragraphs: [
        `Tenant shall pay a refundable pet security deposit of ${fmtMoneyWithWords(deposit)}. ` +
        `The pet security deposit shall be held and administered in accordance with the ` +
        `Lease and applicable Arizona law. The deposit may be applied, to the extent ` +
        `permitted by law, toward unpaid amounts or the cost of repairing damage to the ` +
        `Premises caused by the approved ${speciesLower}, excluding ordinary wear and tear. ` +
        `Any remaining portion shall be returned in accordance with applicable law following ` +
        `termination of the tenancy and surrender of the Premises.`,
      ],
    })
  }

  if (cleaning > 0) {
    moneyClauses.push({
      heading: 'One-time pet cleaning fee',
      paragraphs: [
        `Tenant shall pay a one-time, nonrefundable pet cleaning fee of ` +
        `${fmtMoneyWithWords(cleaning)}, due upon execution of this Amendment. This fee is ` +
        `intended to cover routine additional cleaning associated with the approved pet at ` +
        `the end of the tenancy, and is separate from the refundable pet security deposit ` +
        `and from the monthly pet rent.`,
      ],
    })
  }

  if (upfront > 0) {
    const parts = charges.filter(c => c.kind !== 'monthly')
      .map(c => `${fmtDollars(c.amount)} ${c.kind === 'deposit' ? 'refundable ' : 'nonrefundable '}${c.label.toLowerCase()}`)
    moneyClauses.push({
      heading: 'Amount due on signing',
      paragraphs: [
        `Upon execution of this Amendment, Tenant shall pay ${fmtMoneyWithWords(upfront)}, ` +
        `consisting of ${joinList(parts)}.`,
      ],
    })
  }

  // ── The closing money sentence, computed from the charges ────────────────
  moneyClauses.push({
    heading: 'No other charges',
    paragraphs: [buildChargesClosingClause(charges)],
  })

  // ── Responsibilities ─────────────────────────────────────────────────────
  const careParagraphs: string[] = [
    `Tenant shall be solely responsible for the care, supervision, control, licensing, ` +
    `vaccination and conduct of the approved ${speciesLower}, and shall comply with all ` +
    `applicable laws, ordinances and requirements relating to it. Tenant shall also be ` +
    `responsible for any damage to the Premises, additional cleaning, odors, waste or other ` +
    `costs caused by the ${speciesLower}, to the extent permitted by the Lease and ` +
    `applicable law.`,
  ]
  if (pet.vaccinated) {
    careParagraphs.push(
      `Tenant shall keep the approved ${speciesLower} currently licensed and vaccinated as ` +
      `required by the City of Tempe and Maricopa County, and shall provide proof on ` +
      `Landlord’s request.`
    )
  }
  careParagraphs.push(
    `Tenant shall promptly remove all pet waste from the Premises and from any shared or ` +
    `common area, shall keep the ${speciesLower} leashed or carried outside the Premises, ` +
    `shall not leave it unattended in any shared or outdoor area of the Premises, and shall ` +
    `not allow it to disturb the quiet enjoyment of any other occupant or neighbour.`
  )

  const clauses: AmendmentClause[] = [
    {
      heading: 'Pet approved',
      paragraphs: [
        `Landlord hereby approves Tenant to keep and maintain ${petDesc} at the Premises ` +
        `(the “approved ${speciesLower}”), effective ${fmtLegalDate(effectiveDate)} ` +
        `and for the remainder of the Lease term, subject to the terms and conditions of the ` +
        `Lease and of this Amendment.`,
      ],
    },
    ...moneyClauses,
    { heading: 'Tenant’s responsibilities', paragraphs: careParagraphs },
    {
      heading: 'Damage and cleaning',
      paragraphs: [
        `Tenant shall be responsible for all actual damage caused by the approved ` +
        `${speciesLower}, including damage to flooring, carpeting, doors, walls, ` +
        `landscaping, fixtures and other property, beyond ordinary wear and tear. Tenant ` +
        `shall also be responsible for reasonable additional cleaning, deodorizing and pest ` +
        `treatment costs attributable to the ${speciesLower}, to the extent permitted by ` +
        `applicable law.`,
        ...(deposit > 0
          ? [`Tenant’s financial responsibility for pet-related damage is not limited to ` +
             `the amount of the refundable pet security deposit. Any additional amounts ` +
             `properly owed remain Tenant’s responsibility.`]
          : []),
      ],
    },
    {
      heading: 'Liability',
      paragraphs: [
        `To the extent permitted by applicable law, Tenant shall be responsible for ` +
        `injuries, property damage or losses caused by the approved ${speciesLower} ` +
        `resulting from Tenant’s negligence, failure to control the ${speciesLower}, or ` +
        `violation of this Amendment.`,
        `Nothing in this Amendment releases Landlord from liability arising from ` +
        `Landlord’s own negligence or other obligations imposed by applicable law.`,
      ],
    },
    {
      heading: 'Violation and withdrawal of approval',
      paragraphs: [
        `Any material violation of the pet-related provisions of this Amendment shall ` +
        `constitute a violation of the Lease. Landlord may require corrective action and ` +
        `exercise the remedies available under the Lease and applicable Arizona law, ` +
        `including any required written notice and opportunity to cure.`,
        `Any withdrawal of pet approval, requirement to remove the approved ` +
        `${speciesLower}, or termination of tenancy shall be subject to applicable law. ` +
        `Withdrawal of approval ends the approval and the monthly pet rent; it is not of ` +
        `itself a termination of the Lease, which continues in force.`,
        `If Tenant ceases to keep the approved ${speciesLower} at the Premises, Tenant ` +
        `shall notify Landlord in writing, and monthly pet rent stops at the end of the ` +
        `month in which that notice is given. Pet rent is not refundable for a month already ` +
        `begun.`,
      ],
    },
  ]

  if (needsConsent) {
    clauses.push({
      heading: 'Consent of the other tenants',
      paragraphs: [
        `As a condition of Landlord’s approval, Tenant acknowledges and agrees that all ` +
        `other tenants residing at the Premises have been informed of the proposed ` +
        `${speciesLower} and have consented to it residing at the Premises. Tenant shall ` +
        `provide Landlord with written consent signed by each other tenant residing at the ` +
        `Premises. Landlord’s approval of the ${speciesLower} shall not become effective ` +
        `until such written consents have been received.`,
      ],
    })
  }

  clauses.push({
    heading: 'This approval covers one specific animal',
    paragraphs: [
      `This approval applies only to the specific ${speciesLower} identified above and does ` +
      `not constitute approval for any additional animal, for a replacement for it, or for ` +
      `any other pet. Any additional pet or animal requires Landlord’s prior written ` +
      `approval.`,
    ],
  })

  if (additionalTerms?.trim()) {
    // Before the non-modification clause on purpose: that clause has to be the
    // last word, or a free-text addition appearing after it reads as carving an
    // exception out of it.
    clauses.push({ heading: 'Additional terms', paragraphs: [additionalTerms.trim()] })
  }

  clauses.push({
    heading: 'The rest of the Lease is unchanged',
    paragraphs: [CLAUSE_NO_MODIFICATION],
  })

  // ── Acceptance ────────────────────────────────────────────────────────────
  //
  // Reworded from the paper form, which assumed a tenant signs and the landlord
  // countersigns later. Here the landlord executes it by issuing it, which is
  // what pressing send does, so the document says that rather than describing a
  // second signature that will never arrive.
  const acceptance: string[] = [
    `Landlord has signed and issued this Amendment on ${fmtLegalDate(agreementDate)}. It ` +
    `becomes a binding change lease agreement, in addition to the Lease, when Tenant signs ` +
    `it electronically below.`,
  ]
  if (respondBy) {
    acceptance.push(
      `This offer must be signed by Tenant no later than ${fmtLegalDate(respondBy)} at ` +
      `midnight. If it is not signed by that date and time, this offer shall be deemed ` +
      `withdrawn and the Lease continues unchanged.`
    )
  }
  acceptance.push(
    `Tenant acknowledges receipt of a copy of this Amendment. Nothing in it is agreed until ` +
    `Tenant signs, and Tenant may decline it at any time before signing.`
  )

  return {
    version: 2,
    title: 'Residential Change Lease Agreement',
    notice: DOCUMENT_NOTICE,
    sectionTitle: 'Pet approval and lease amendment',
    premises: propertyAddress,
    landlordName,
    tenantName,
    leaseStartDate,
    leaseEndDate,
    effectiveDate,
    agreementDate,
    respondBy,
    charges,
    summary,
    recitals,
    clauses,
    acceptance,
    requiresCotenantConsent: needsConsent,
    isBackdated,
    signatureStatement:
      `By typing my full legal name below and submitting this form, I am signing this ` +
      `Amendment electronically. I agree that my electronic signature is the legal ` +
      `equivalent of my handwritten signature under the Arizona Electronic Transactions Act ` +
      `(A.R.S. § 44-7001 et seq.) and the federal E-SIGN Act, and that it binds me to ` +
      `this Amendment. I confirm that I have read this Amendment in full and that I have ` +
      `been able to download or print a copy of it.`,
  }
}

/**
 * Refuse to send a document that is missing the protections it promises.
 *
 * A guard rather than a test, and run inside the send route *and* again at
 * signing, because the failure it catches is not a crash: it is a
 * plausible-looking contract that quietly dropped the clause saying the rest of
 * the lease is untouched, or that charges a deposit it never disclosed. By the
 * time anybody notices, a tenant has signed it.
 *
 * The money check is the one that earns its keep. It walks `charges` and
 * insists each one appears, by its own phrase, in the closing sentence — so a
 * charge added to the model without being added to the prose fails here rather
 * than becoming an undisclosed fee. Returns the problems; empty means safe.
 */
export function verifyAmendmentDocument(doc: AmendmentDocument): string[] {
  const problems: string[] = []
  const all = [
    ...doc.recitals,
    ...doc.clauses.flatMap(c => c.paragraphs),
    ...doc.acceptance,
  ].join('\n')

  if (!doc.title.trim()) problems.push('The document has no title.')
  if (!doc.premises.trim()) problems.push('The document does not name the premises.')
  if (!doc.tenantName.trim()) problems.push('The document does not name the tenant.')
  if (!doc.landlordName.trim()) problems.push('The document does not name the landlord.')
  if (!DATE_RE.test(doc.effectiveDate)) problems.push('The effective date is not a date.')
  if (!DATE_RE.test(doc.leaseStartDate) || !DATE_RE.test(doc.leaseEndDate)) {
    problems.push('The document does not name the lease term it amends.')
  }
  if (doc.respondBy && !DATE_RE.test(doc.respondBy)) {
    problems.push('The signing deadline is not a date.')
  }
  if (doc.clauses.length === 0) problems.push('The document has no clauses.')

  if (!all.includes(CLAUSE_NO_MODIFICATION)) {
    problems.push(
      'The document is missing the clause stating that the rest of the lease is ' +
      'unchanged. It cannot be sent without it.'
    )
  }

  // The money check, and the reason this function exists.
  //
  // One comparison does the work: the clause the document *contains* must be
  // the clause its own `charges` list generates. That catches both directions
  // of the failure, which is why it is written this way rather than as a loop
  // over the charges asking whether each is mentioned — such a loop, run
  // against a freshly computed clause, is a tautology and can never fail.
  //
  //   • a charge added to the model but not to the prose: the generated clause
  //     now names it, the stored prose does not, so they differ.
  //   • prose edited to soften or drop the clause: same comparison, same fail.
  //
  // Either way the tenant would be signing an amount the document does not
  // disclose, and the document does not go out.
  const live = doc.charges.filter(c => c.amount > 0)
  if (!all.includes(buildChargesClosingClause(doc.charges))) {
    problems.push(
      live.length > 0
        ? 'The charges on this amendment are not the charges its "no other charges" clause ' +
          'lists, so the tenant would be signing an undisclosed amount. It cannot be sent.'
        : 'The document is missing the clause stating that no charge arises under it. ' +
          'It cannot be sent without it.'
    )
  }
  // And every amount must be stated somewhere in the prose, not only summarised
  // in the closing sentence — a figure that appears once, in a list, is a
  // figure a reader can miss.
  for (const c of live) {
    if (!all.includes(fmtDollars(c.amount))) {
      problems.push(
        `${c.label} of ${fmtDollars(c.amount)} is charged but never stated in the document.`
      )
    }
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
 * emailed copy and the on-screen copy can never say different things.
 */
export function renderAmendmentText(
  doc: AmendmentDocument,
  signature?: AmendmentSignature | null
): string {
  const lines: string[] = []
  lines.push(doc.title.toUpperCase(), doc.premises, '')
  lines.push(wrap(doc.notice), '')
  lines.push(doc.sectionTitle.toUpperCase(), '')
  for (const [k, v] of doc.summary) lines.push(`  ${k}: ${v}`)
  lines.push('')
  lines.push(`Landlord: ${doc.landlordName}`)
  lines.push(`Tenant:   ${doc.tenantName}`)
  lines.push(`Lease term: ${fmtLegalDate(doc.leaseStartDate)} to ${fmtLegalDate(doc.leaseEndDate)}`)
  lines.push(`Effective: ${fmtLegalDate(doc.effectiveDate)}`)
  if (doc.respondBy) lines.push(`Sign by:   ${fmtLegalDate(doc.respondBy)}`)
  lines.push('')
  for (const r of doc.recitals) lines.push(wrap(r), '')
  doc.clauses.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.heading.toUpperCase()}`)
    for (const p of c.paragraphs) lines.push(wrap(p, '   '), '')
  })
  lines.push('TERMS OF ACCEPTANCE', '')
  for (const a of doc.acceptance) lines.push(wrap(a, '   '), '')
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
  lines.push(`   Issued:   ${fmtLegalDate(doc.agreementDate)}`)
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
  /** Recurring, in whole dollars. */
  monthly_charge: number
  monthly_charge_label: string | null
  /** Refundable, held. */
  deposit_amount: number
  /** One-time and nonrefundable. */
  one_time_fee_amount: number
  /** Last day the tenant may sign. Null = no deadline. */
  respond_by: string | null
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
  /** When the written consents from the other tenants were received. */
  cotenant_consents_at: string | null
  /** Set once the landlord has put the charges on the tenant's ledger. */
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
 * Where an amendment is in its life, by the calendar.
 *
 * Never stored. `expired` and `in_force` both flip with no code running, which
 * is exactly why they are computed here and nowhere else.
 *
 * `conditional` is the state the paper document creates and a naive product
 * would hide: signed, but approval does not take effect until the written
 * consents from the other tenants arrive. Reporting that as "in force" would be
 * the product contradicting the contract it just had somebody sign.
 */
export type AmendmentPhase =
  | 'unsigned' | 'expired' | 'conditional' | 'pending' | 'in_force' | 'closed'

export function amendmentPhase(a: LeaseAmendment, now = new Date()): AmendmentPhase {
  if (a.status === 'declined' || a.status === 'withdrawn') return 'closed'
  if (a.status !== 'signed') {
    return a.respond_by && daysBetweenDates(signingToday(now), a.respond_by) < 0
      ? 'expired'
      : 'unsigned'
  }
  const doc = a.document
  if (doc?.requiresCotenantConsent && !a.cotenant_consents_at) return 'conditional'
  return daysBetweenDates(signingToday(now), a.effective_date) > 0 ? 'pending' : 'in_force'
}

export const PHASE_META: Record<AmendmentPhase, { label: string; blurb: string }> = {
  unsigned:    { label: 'Not signed',   blurb: 'Nothing is in force until the tenant signs.' },
  expired:     { label: 'Offer expired', blurb: 'The signing deadline passed. Send a new one.' },
  conditional: { label: 'Signed — consents outstanding', blurb: 'Approval is not effective until the other tenants consent in writing.' },
  pending:     { label: 'Starts later', blurb: 'Signed, and takes effect on its effective date.' },
  in_force:    { label: 'In force',     blurb: 'Signed and part of the tenancy.' },
  closed:      { label: 'Closed',       blurb: 'The lease is unchanged.' },
}

/**
 * The one thing the landlord should do about this amendment next.
 *
 * The order is the order the document itself imposes. `consent` comes before
 * `bill`, because the contract says approval is not effective until the other
 * tenants have consented in writing — billing pet rent for an approval that has
 * not taken effect is charging for something not yet granted.
 *
 * `bill` is the step this feature could easily have hidden: a signed pet
 * addendum means $65 a month plus $400 up front that nobody is collecting until
 * somebody adds the line items. Signing does *not* create them — writing to a
 * tenant's ledger as a side effect of their own signature, against a payer the
 * server had to guess on a six-person lease, is the kind of surprise that costs
 * trust. So the signature produces a visible instruction instead, and
 * `billed_at` records that it was followed.
 */
export type AmendmentAction =
  | { kind: 'await'; label: string; detail: string }
  | { kind: 'expired'; label: string; detail: string }
  | { kind: 'consent'; label: string; detail: string }
  | { kind: 'bill'; label: string; detail: string }
  | { kind: 'none'; label: string; detail: string }

export function nextAction(a: LeaseAmendment, now = new Date()): AmendmentAction {
  const phase = amendmentPhase(a, now)

  if (phase === 'expired') {
    return {
      kind: 'expired',
      label: 'The signing deadline passed',
      detail:
        `This offer had to be signed by ${fmtLegalDate(a.respond_by)} and was not. By its own ` +
        'terms it is deemed withdrawn, so a signature now would be outside it — withdraw ' +
        'it and send a fresh one with a new date.',
    }
  }

  if (a.status === 'sent') {
    const days = daysBetweenDates(a.sent_at.slice(0, 10), signingToday(now))
    const left = a.respond_by ? daysBetweenDates(signingToday(now), a.respond_by) : null
    return {
      kind: 'await',
      label: 'Waiting on the tenant',
      detail:
        (days <= 0 ? 'Sent today.' : `Sent ${days} day${days === 1 ? '' : 's'} ago and not signed yet.`) +
        (left != null ? ` They have ${left} day${left === 1 ? '' : 's'} left to sign.` : '') +
        ' Nothing is in force until they sign.',
    }
  }

  if (phase === 'conditional') {
    return {
      kind: 'consent',
      label: 'Collect the other tenants’ written consent',
      detail:
        `${a.tenant_name || 'The tenant'} has signed, but the document says your approval is ` +
        'not effective until every other tenant at the property has consented in writing. ' +
        'Get those, then mark them received — and hold off billing until you have.',
    }
  }

  if (a.status === 'signed' && !a.billed_at) {
    const monthly = a.monthly_charge
    const upfront = (a.deposit_amount ?? 0) + (a.one_time_fee_amount ?? 0)
    if (monthly > 0 || upfront > 0) {
      const bits: string[] = []
      if (monthly > 0) bits.push(`${fmtDollars(monthly)}/mo from ${monthName(a.effective_date)}`)
      if (upfront > 0) bits.push(`${fmtDollars(upfront)} due now`)
      return {
        kind: 'bill',
        label: `Add ${joinList(bits)} to their ledger`,
        detail:
          'Signing does not charge anybody. Add these on ' +
          `${a.tenant_name || 'the tenant'}’s share in Financials — the monthly ` +
          'amount as a line item, anything due now as a one-off charge — or none of it ' +
          'will be collected.',
      }
    }
  }

  if (a.status === 'signed') {
    return { kind: 'none', label: PHASE_META[phase].label, detail: PHASE_META[phase].blurb }
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

/**
 * Has the offer's own deadline passed?
 *
 * The document says it is "deemed withdrawn" after this date, so accepting a
 * signature afterwards would record an agreement the document itself says does
 * not exist. Derived from `respondBy` every time, never from a stored flag —
 * an offer expires at midnight whether or not a cron was running.
 */
export function checkSignatureDeadline(
  respondBy: string | null | undefined,
  now = new Date()
): string | null {
  if (!respondBy || !DATE_RE.test(respondBy)) return null
  if (daysBetweenDates(signingToday(now), respondBy) >= 0) return null
  return (
    `This offer had to be signed by ${fmtLegalDate(respondBy)} and that date has passed, so ` +
    'by its own terms it is withdrawn. Ask your landlord to send a new one — nothing has ' +
    'changed about your lease.'
  )
}
