/**
 * Proves the lease-amendment engine's policy.
 *
 * Worth a script rather than a reading, because every way of getting this wrong
 * is silent and most of them are legally expensive:
 *
 *   • a document that lost the clause saying the rest of the lease is unchanged
 *     — a tenant signs a pet addendum and has arguably agreed to anything
 *   • a charge the document collects but never names, which is the failure the
 *     first version of this file would have shipped: it hard-coded "there are
 *     no other charges", which became false the moment a deposit was added
 *   • a backdated signature, which a free date field allows by accident
 *   • a signature accepted after the offer's own deadline, i.e. recording an
 *     agreement the document says is deemed withdrawn
 *   • a one-character "signature" that binds nobody
 *   • reporting a conditional approval as in force, when the document says it
 *     does not take effect until the housemates consent
 *   • a signed amendment whose money nobody is collecting, reported as done
 *   • "expired"/"in force" stored rather than derived — the mistake
 *     `late_fees_applied` already cost this codebase once
 *
 * Run: npm run verify:amendments
 */
const {
  buildPetAdditionDocument, verifyAmendmentDocument, renderAmendmentText,
  buildChargesClosingClause, chargesOf, dueOnExecution, monthlyTotal,
  describePet, dollarsInWords, fmtMoneyWithWords, fmtDollars, fmtLegalDate,
  monthName, amendmentPath, signingToday, daysBetweenDates,
  checkSignatureName, checkSignatureDate, checkSignatureDeadline,
  amendmentPhase, nextAction, sortAmendments, signatureOf,
  CLAUSE_NO_MODIFICATION, STATUS_META, PHASE_META,
} = await import('../src/lib/leaseAmendments.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// Noon UTC on 3 Nov 2026 is still 3 Nov in Phoenix, so "today" is unambiguous.
const NOW = new Date('2026-11-03T19:00:00Z')
const TODAY = '2026-11-03'

// Aleeya's real addendum, which is what this engine now has to be able to say.
const input = (over = {}) => ({
  propertyAddress: '820 W 9th Street, Tempe, AZ 85281',
  landlordName: 'Heran Maharaja',
  tenantName: 'Aleeya Cruz',
  leaseStartDate: '2026-08-03',
  leaseEndDate: '2027-07-31',
  effectiveDate: '2026-12-01',
  agreementDate: TODAY,
  monthlyPetRent: 65,
  petDeposit: 300,
  cleaningFee: 100,
  respondBy: '2026-11-17',
  requireCotenantConsent: true,
  pet: {
    name: 'Dewey', species: 'Dog', breed: 'Alaskan Husky', color: 'Brown',
    sex: 'Male', weight: '33 lbs 15 oz', dob: '2024-09-16',
    microchip: '985113014014128', recordNumber: 'A861983',
    sterilized: true, vaccinated: true,
  },
  ...over,
})

const doc = buildPetAdditionDocument(input())
const allText = [
  ...doc.recitals, ...doc.clauses.flatMap(c => c.paragraphs), ...doc.acceptance,
].join('\n')

// ── Dates and money ─────────────────────────────────────────────────────────

check('today is the Phoenix day, not UTC', signingToday(NOW), TODAY)
check('a contract names a date in full', fmtLegalDate('2026-11-03'), 'November 3, 2026')
check('a charge names its month', monthName('2026-12-01'), 'December 2026')
check('money is written to the cent', fmtDollars(65), '$65.00')
check('and spelled out beside the figure', fmtMoneyWithWords(65), '$65.00 (sixty-five dollars)')
check('words handle the awkward teens', dollarsInWords(17), 'seventeen dollars')
check('and the hundreds', dollarsInWords(300), 'three hundred dollars')
check('and the thousands', dollarsInWords(1250), 'one thousand two hundred fifty dollars')
check('one dollar is singular', dollarsInWords(1), 'one dollar')
check('a figure out of range omits the words rather than inventing them',
  dollarsInWords(1_000_000), null)
check('and the formatter falls back to the figure alone',
  fmtMoneyWithWords(1_000_000), '$1,000,000.00')

// ── The charge model ────────────────────────────────────────────────────────

check('all three charges are modelled', chargesOf(doc).map(c => c.kind),
  ['monthly', 'deposit', 'fee'])
check('the recurring part is the pet rent alone', monthlyTotal(doc), 65)
check('and what is due on signing is the deposit plus the fee, not the rent',
  dueOnExecution(doc), 400)
check('a zero charge is not modelled at all',
  chargesOf(buildPetAdditionDocument(input({ cleaningFee: 0 }))).map(c => c.kind),
  ['monthly', 'deposit'])

// ── The document says what it must ──────────────────────────────────────────

check('a well-formed document has no problems', verifyAmendmentDocument(doc), [])

check('it states that the rest of the lease is unchanged',
  allText.includes(CLAUSE_NO_MODIFICATION), true)
check('and that clause names rent, deposit and term explicitly',
  ['monthly rent', 'security deposit', 'lease term'].every(s => CLAUSE_NO_MODIFICATION.includes(s)),
  true)
check('the non-modification clause is the last word',
  doc.clauses[doc.clauses.length - 1].paragraphs.includes(CLAUSE_NO_MODIFICATION), true)

// The money clause, which is the one this rewrite exists for.
const closing = buildChargesClosingClause(doc.charges)
check('the closing clause is in the document', allText.includes(closing), true)
check('and it names every single charge',
  doc.charges.every(c => closing.includes(c.phrase)), true)
check('naming the pet rent', closing.includes('additional monthly pet rent of $65.00'), true)
check('naming the deposit as refundable',
  closing.includes('a refundable pet security deposit of $300.00'), true)
check('naming the cleaning fee as nonrefundable',
  closing.includes('a one-time, nonrefundable pet cleaning fee of $100.00'), true)
check('and then closing the list',
  closing.includes('are the complete list of charges arising under it'), true)
check('while preserving the existing damage obligation',
  closing.includes('actual damage'), true)
check('a no-charge amendment says so plainly rather than listing nothing',
  buildChargesClosingClause([]).includes('No charge of any kind arises'), true)

check('each amount appears in its own clause too',
  ['$65.00', '$300.00', '$100.00', '$400.00'].every(a => allText.includes(a)), true)
check('the amount due on signing is stated as one number',
  allText.includes('Upon execution of this Amendment, Tenant shall pay $400.00'), true)
check('the premises is named', doc.premises, '820 W 9th Street, Tempe, AZ 85281')
check('both parties are named', [doc.landlordName, doc.tenantName], ['Heran Maharaja', 'Aleeya Cruz'])
check('the lease it amends is named by its term',
  allText.includes('August 3, 2026') && allText.includes('July 31, 2027'), true)
check('the signature statement cites the Arizona act',
  doc.signatureStatement.includes('A.R.S. § 44-7001'), true)
check('and the federal one', doc.signatureStatement.includes('E-SIGN'), true)
check('the boxed notice survives into the document', !!doc.notice.trim(), true)

// ── The guard ───────────────────────────────────────────────────────────────

{
  const stripped = {
    ...doc,
    clauses: doc.clauses.filter(c => !c.paragraphs.includes(CLAUSE_NO_MODIFICATION)),
  }
  const problems = verifyAmendmentDocument(stripped)
  check('a document missing the non-modification clause is rejected', problems.length > 0, true)
  check('and says so in terms a landlord can act on',
    problems[0].includes('rest of the lease is unchanged'), true)
}
{
  const stripped = {
    ...doc,
    clauses: doc.clauses.map(c => ({ ...c, paragraphs: c.paragraphs.filter(p => p !== closing) })),
  }
  check('a document missing the closing money clause is rejected',
    verifyAmendmentDocument(stripped).some(p => p.includes('undisclosed amount')), true)
}
{
  // THE check. Somebody adds a charge to the model and forgets the prose; the
  // tenant would be signing an amount the document never mentions.
  const smuggled = {
    ...doc,
    charges: [...doc.charges,
      { kind: 'fee', label: 'Admin fee', amount: 75, phrase: 'an admin fee of $75.00' }],
  }
  const problems = verifyAmendmentDocument(smuggled)
  check('a charge not named in the closing clause is rejected', problems.length > 0, true)
  check('and the error says it would be an undisclosed amount',
    problems.some(p => p.includes('undisclosed amount')), true)
  check('and the smuggled figure is flagged as never stated',
    problems.some(p => p.includes('Admin fee of $75.00')), true)
}
{
  const free = buildPetAdditionDocument(input({ monthlyPetRent: 0, petDeposit: 0, cleaningFee: 0 }))
  check('a no-charge amendment still passes', verifyAmendmentDocument(free), [])
  check('and models no charges', chargesOf(free).length, 0)
  check('and does not recite a $0.00 deposit clause',
    free.clauses.some(c => c.heading === 'Pet security deposit'), false)
}
{
  check('a nameless tenant is refused',
    verifyAmendmentDocument({ ...doc, tenantName: '' }).some(p => p.includes('tenant')), true)
  check('and a nameless landlord',
    verifyAmendmentDocument({ ...doc, landlordName: '' }).some(p => p.includes('landlord')), true)
  check('and a signing deadline that is not a date',
    verifyAmendmentDocument({ ...doc, respondBy: 'soon' }).some(p => p.includes('deadline')), true)
}

// ── The pet is identified, which is what makes permission limited ───────────

check('the animal is described in full',
  describePet(input().pet),
  'one (1) male brown Alaskan Husky dog named “Dewey”, date of birth ' +
  'September 16, 2024, approximately 33 lbs 15 oz, spayed or neutered, ' +
  'microchip no. 985113014014128 and record no. A861983')
check('a bare description still identifies one animal',
  describePet({ name: 'Mo', species: 'Cat' }), 'one (1) cat named “Mo”')
check('the microchip reaches the document', allText.includes('985113014014128'), true)
check('permission does not extend to a second animal',
  allText.includes('does not constitute approval for any additional animal'), true)
check('nor to a replacement for this one', allText.includes('replacement for it'), true)

// ── Conditional approval ───────────────────────────────────────────────────

check('the housemate-consent clause is present', doc.requiresCotenantConsent, true)
check('and says approval is not effective without it',
  allText.includes('shall not become effective until such written consents have been received'),
  true)
{
  const solo = buildPetAdditionDocument(input({ requireCotenantConsent: false }))
  const t = solo.clauses.flatMap(c => c.paragraphs).join('\n')
  check('a single tenancy gets no consent clause at all',
    t.includes('written consents have been received'), false)
  check('and the flag says so', solo.requiresCotenantConsent, false)
}

// ── Acceptance terms ───────────────────────────────────────────────────────

check('the acceptance terms say who has already signed',
  doc.acceptance[0].includes('Landlord has signed and issued this Amendment'), true)
check('and name the signing deadline',
  doc.acceptance.join('\n').includes('November 17, 2026'), true)
check('and say the offer is deemed withdrawn after it',
  doc.acceptance.join('\n').includes('deemed withdrawn'), true)
{
  const open = buildPetAdditionDocument(input({ respondBy: null }))
  check('no deadline means no "deemed withdrawn" sentence',
    open.acceptance.join('\n').includes('deemed withdrawn'), false)
  check('and respondBy is null on the document', open.respondBy, null)
}

// ── Optional clauses appear only when claimed ──────────────────────────────

{
  const plain = buildPetAdditionDocument(input({
    pet: { name: 'Mo', species: 'Cat', sterilized: false, vaccinated: false },
  }))
  const t = plain.clauses.flatMap(c => c.paragraphs).join('\n')
  check('an unvaccinated pet gets no vaccination covenant', t.includes('vaccinated as required'), false)
  check('and no spay representation is invented', t.includes('spayed or neutered'), false)
  check('but the waste and nuisance duties are not optional',
    t.includes('pet waste') && t.includes('quiet enjoyment'), true)
  check('and the clauses speak of a cat, not a dog', t.includes('approved cat'), true)
}
{
  const extra = buildPetAdditionDocument(input({ additionalTerms: 'No pet in the jacuzzi area.' }))
  const headings = extra.clauses.map(c => c.heading)
  check('a free-text addition becomes its own clause',
    headings.includes('Additional terms'), true)
  check('and cannot be read as an exception to the non-modification clause',
    headings[headings.length - 1], 'The rest of the Lease is unchanged')
}

// ── The plain-text render ──────────────────────────────────────────────────

{
  const text = renderAmendmentText(doc, null)
  check('an unsigned render leaves the signature line blank',
    text.includes('Signed by:   ____________________________'), true)
  const signed = renderAmendmentText(doc, { name: 'Aleeya Cruz', date: TODAY })
  check('a signed render carries the name', signed.includes('Signed by:   Aleeya Cruz'), true)
  check('and the date it was signed', signed.includes('Date signed: November 3, 2026'), true)
  check('the text render says everything the clauses do',
    signed.includes('REST OF THE LEASE IS UNCHANGED'), true)
  check('it carries the acceptance terms too',
    signed.includes('TERMS OF ACCEPTANCE'), true)
  check('and every amount', ['$65.00', '$300.00', '$100.00'].every(a => signed.includes(a)), true)
  check('and wraps to a readable measure',
    signed.split('\n').every(l => l.length <= 80), true)
}

// ── The signature: name ────────────────────────────────────────────────────

check('a full name signs', checkSignatureName('Aleeya Cruz', 'Aleeya Cruz'), null)
check('a middle name is fine', checkSignatureName('Aleeya M. Cruz', 'Aleeya Cruz'), null)
check('so is a changed surname, since the first name still matches',
  checkSignatureName('Aleeya Rivera', 'Aleeya Cruz'), null)
check('case and spacing do not matter',
  checkSignatureName('  aleeya   cruz ', 'Aleeya Cruz'), null)
check('a single name is not a signature',
  checkSignatureName('Aleeya', 'Aleeya Cruz') !== null, true)
check('nor is an initial', checkSignatureName('x', 'Aleeya Cruz') !== null, true)
check('nor is "ok"', checkSignatureName('ok', 'Aleeya Cruz') !== null, true)
check('nor is a number', checkSignatureName('12 34', 'Aleeya Cruz') !== null, true)
check('a different person cannot sign for them',
  checkSignatureName('Brooklyn Buck', 'Aleeya Cruz') !== null, true)
check('and is told to fix the record rather than sign a wrong name',
  checkSignatureName('Brooklyn Buck', 'Aleeya Cruz').includes('contact your landlord'), true)
check('with no name on file, a plausible full name is accepted',
  checkSignatureName('Aleeya Cruz', null), null)

// ── The signature: date ────────────────────────────────────────────────────

check('today signs', checkSignatureDate(TODAY, NOW), null)
check('yesterday does not — backdating is the whole risk',
  checkSignatureDate('2026-11-02', NOW) !== null, true)
check('tomorrow does not either', checkSignatureDate('2026-11-04', NOW) !== null, true)
check('and the error names the only acceptable date',
  checkSignatureDate('2026-11-02', NOW).includes('November 3, 2026'), true)
check('a non-date is refused', checkSignatureDate('soon', NOW) !== null, true)

// ── The signature: the offer's own deadline ────────────────────────────────

check('an offer with no deadline never expires', checkSignatureDeadline(null, NOW), null)
check('one with a future deadline is open', checkSignatureDeadline('2026-11-17', NOW), null)
check('the last day is still open — the document says "by" that date',
  checkSignatureDeadline(TODAY, NOW), null)
check('the day after is not', checkSignatureDeadline('2026-11-02', NOW) !== null, true)
check('and the tenant is told their lease is untouched',
  checkSignatureDeadline('2026-11-02', NOW).includes('nothing has changed about your lease'), true)

// ── Status, derived rather than stored ─────────────────────────────────────

const row = (over = {}) => ({
  id: 'a1', lease_id: 'l1', owner_id: 'o1', property_id: 'p1',
  lease_tenant_id: 'lt1', kind: 'pet_addition', title: doc.title,
  effective_date: '2026-12-01', monthly_charge: 65, monthly_charge_label: 'Pet rent',
  deposit_amount: 300, one_time_fee_amount: 100, respond_by: '2026-11-17',
  document: doc, status: 'sent', tenant_name: 'Aleeya Cruz',
  tenant_email: 'cruzaleeya6@gmail.com', token: 'tok',
  sent_at: '2026-11-03T18:00:00Z',
  signed_at: null, signature_name: null, signature_date: null,
  signature_ip: null, signature_user_agent: null, signed_by_user_id: null,
  declined_at: null, decline_reason: null,
  cotenant_consents_at: null, billed_at: null,
  created_at: '2026-11-03T18:00:00Z', updated_at: '2026-11-03T18:00:00Z',
  ...over,
})

const signedRow = (over = {}) => row({
  status: 'signed', signed_at: '2026-11-03T19:00:00Z',
  signature_name: 'Aleeya Cruz', signature_date: TODAY, ...over,
})
/** Signed, and the housemates have consented. */
const clearedRow = (over = {}) =>
  signedRow({ cotenant_consents_at: '2026-11-04T10:00:00Z', ...over })

check('an unsigned amendment is in no phase at all', amendmentPhase(row(), NOW), 'unsigned')
check('past its deadline it is expired, with nobody having run anything',
  amendmentPhase(row(), new Date('2026-11-18T19:00:00Z')), 'expired')
check('signed but with consents outstanding is conditional, not in force',
  amendmentPhase(signedRow(), NOW), 'conditional')
check('once the consents land it is pending, because the date has not arrived',
  amendmentPhase(clearedRow(), NOW), 'pending')
check('and in force on the effective date',
  amendmentPhase(clearedRow(), new Date('2026-12-01T19:00:00Z')), 'in_force')
check('that flip is arithmetic, with no write',
  amendmentPhase(clearedRow(), new Date('2026-12-02T19:00:00Z')), 'in_force')
check('an amendment needing no consent is in force once its date arrives',
  amendmentPhase(
    signedRow({ document: buildPetAdditionDocument(input({ requireCotenantConsent: false })) }),
    new Date('2026-12-01T19:00:00Z')),
  'in_force')
check('a declined amendment is closed',
  amendmentPhase(row({ status: 'declined', declined_at: 'x' }), NOW), 'closed')
check('as is a withdrawn one', amendmentPhase(row({ status: 'withdrawn' }), NOW), 'closed')
check('a declined amendment does not become "expired" when its date passes',
  amendmentPhase(row({ status: 'declined', declined_at: 'x' }), new Date('2026-12-30T19:00:00Z')),
  'closed')

check('the four statuses are the only ones with meta',
  Object.keys(STATUS_META).sort(), ['declined', 'sent', 'signed', 'withdrawn'])
check('and every phase has a label',
  Object.keys(PHASE_META).sort(),
  ['closed', 'conditional', 'expired', 'in_force', 'pending', 'unsigned'])

check('a signature is only read off a signed row', signatureOf(row()), null)
check('and a signed row yields the name and date',
  signatureOf(signedRow()), { name: 'Aleeya Cruz', date: TODAY, signedAt: '2026-11-03T19:00:00Z' })
check('a row claiming signed with no name yields nothing rather than a blank signature',
  signatureOf(row({ status: 'signed' })), null)

// ── The next action, which is where the money is won or lost ───────────────

{
  const a = nextAction(row(), NOW)
  check('an unsigned amendment is waiting on the tenant', a.kind, 'await')
  check('and says nothing is in force yet', a.detail.includes('Nothing is in force'), true)
  check('and counts down the deadline', a.detail.includes('14 days left'), true)
}
{
  const a = nextAction(row({ sent_at: '2026-10-29T18:00:00Z' }), NOW)
  check('a stale one counts the days waited', a.detail.includes('5 days ago'), true)
}
{
  const a = nextAction(row(), new Date('2026-11-18T19:00:00Z'))
  check('a lapsed offer is its own action', a.kind, 'expired')
  check('that tells the landlord to send a fresh one',
    a.detail.includes('send a fresh one'), true)
}
{
  const a = nextAction(signedRow(), NOW)
  check('consents outstanding outranks billing', a.kind, 'consent')
  check('and says to hold off billing', a.detail.includes('hold off billing'), true)
}
{
  const a = nextAction(clearedRow(), NOW)
  check('once cleared, the money is the task', a.kind, 'bill')
  check('naming the recurring amount', a.label.includes('$65.00/mo'), true)
  check('and the amount due now', a.label.includes('$400.00 due now'), true)
  check('and warning it will otherwise not be collected',
    a.detail.includes('will be collected'), true)
  check('and naming the month the rent starts', a.label.includes('December 2026'), true)
}
check('once billed, it stops asking',
  nextAction(clearedRow({ billed_at: '2026-11-05T20:00:00Z' }), NOW).kind, 'none')
check('a signed amendment with no money never asks',
  nextAction(clearedRow({ monthly_charge: 0, deposit_amount: 0, one_time_fee_amount: 0 }), NOW).kind,
  'none')
check('a declined one is not a task either',
  nextAction(row({ status: 'declined', declined_at: 'x' }), NOW).kind, 'none')

// ── Ordering: the thing somebody is waiting on comes first ────────────────

{
  const ordered = sortAmendments([
    signedRow({ id: 'signed' }),
    row({ id: 'declined', status: 'declined', declined_at: 'x' }),
    row({ id: 'pending' }),
    row({ id: 'withdrawn', status: 'withdrawn' }),
  ]).map(a => a.id)
  check('unsigned first, then signed, then the dead ones',
    ordered, ['pending', 'signed', 'declined', 'withdrawn'])
}
{
  const ordered = sortAmendments([
    row({ id: 'old', sent_at: '2026-10-01T00:00:00Z' }),
    row({ id: 'new', sent_at: '2026-11-01T00:00:00Z' }),
  ]).map(a => a.id)
  check('within a status, newest first', ordered, ['new', 'old'])
}

// ── The link ──────────────────────────────────────────────────────────────

check('the tenant signs behind the login, not on a bare token page',
  amendmentPath('tok').startsWith('/dashboard/'), true)
check('day arithmetic is signed', daysBetweenDates('2026-11-03', '2026-11-17'), 14)

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '✓ an amendment names every charge it collects or refuses to send, says the ' +
  'rest of the lease is unchanged, cannot be backdated or signed late or signed ' +
  'with half a name, derives expiry and "in force" rather than storing them, holds ' +
  'a conditional approval short of in force, and keeps asking until the agreed ' +
  'money reaches the ledger\n'
)
