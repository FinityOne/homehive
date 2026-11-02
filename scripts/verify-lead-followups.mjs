/**
 * Proves the policy behind the automatic two-day lead follow-up (FIN-17).
 *
 * Worth a script rather than a reading, because every way of getting this wrong
 * is a wrong email to a stranger, and none of them raise an error:
 *
 *   • mailing a lead from last spring (the ceiling)
 *   • mailing one the landlord has already written off (the settled statuses)
 *   • offering a tour nobody invited them to, or one with no slots behind it
 *   • mailing the same student four times because they shopped around
 *   • sending the same nudge twice
 *
 * `chooseFollowup` is the only thing that decides, so proving it here proves
 * the cron. The render checks are narrower but just as load-bearing: they pin
 * the two claims the copy makes — that an invitation exists, and that there are
 * slots — to the facts that were passed in.
 *
 * Run: npm run verify:lead-followups
 */
const {
  chooseFollowup,
  renderFollowupEmail,
  MIN_AGE_DAYS,
  MAX_AGE_DAYS,
  ADDRESS_COOLDOWN_DAYS,
  FOLLOWUP_CATEGORY,
} = await import('../src/lib/leadFollowupEmails.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

/** A lead three days old who inquired and did nothing: the core prescreen case. */
const base = {
  ageDays: 3,
  status: 'new',
  email: 'student@asu.edu',
  deliverable: true,
  optedOut: false,
  hasPrescreen: false,
  tourInvited: false,
  hasLiveTour: false,
  toured: false,
  openTourSlots: 0,
  listingAcceptsLeads: true,
  alreadySent: [],
  addressMailedRecently: false,
}
const ctx = (over = {}) => ({ ...base, ...over })
const kindOf = (over = {}) => {
  const d = chooseFollowup(ctx(over))
  return d.send ? d.kind : `skip:${d.reason}`
}

// ── The two things it will send ───────────────────────────────────────────
check('no pre-screen → prescreen nudge', kindOf(), 'prescreen')
check(
  'pre-screened + invited + slots → tour nudge',
  kindOf({ hasPrescreen: true, tourInvited: true, openTourSlots: 4 }),
  'tour_booking',
)

// ── The window, at both edges ────────────────────────────────────────────
check('the ticket is two days, not one', kindOf({ ageDays: MIN_AGE_DAYS - 0.5 }), 'skip:too new')
check('exactly two days qualifies', kindOf({ ageDays: MIN_AGE_DAYS }), 'prescreen')
check('a week old still qualifies', kindOf({ ageDays: MAX_AGE_DAYS }), 'prescreen')
check(
  'a day past the week does not',
  kindOf({ ageDays: MAX_AGE_DAYS + 1 }),
  'skip:outside the follow-up window',
)
check(
  'and neither does the seven-month backlog this shipped into',
  kindOf({ ageDays: 210 }),
  'skip:outside the follow-up window',
)
check('a lead with no created_at is left alone', kindOf({ ageDays: null }), 'skip:no created_at')
check('the ceiling is a real ceiling', MAX_AGE_DAYS > MIN_AGE_DAYS && MAX_AGE_DAYS <= 14, true)

// ── Verdicts the landlord already reached ────────────────────────────────
check('cold is a human decision', kindOf({ status: 'cold' }), 'skip:status is cold')
check('closed is a human decision', kindOf({ status: 'closed' }), 'skip:status is closed')
// Everything still in play does get chased.
for (const status of ['new', 'contacted', 'follow_up', 'engaged']) {
  check(`${status} is still in play`, kindOf({ status }), 'prescreen')
}
for (const status of ['qualified', 'matching']) {
  check(
    `${status} with an invite gets the tour nudge`,
    kindOf({ status, hasPrescreen: true, tourInvited: true, openTourSlots: 1 }),
    'tour_booking',
  )
}

// ── Never claim a tour nobody offered, or one with nothing behind it ─────
check(
  'pre-screened but not invited: the landlord owns that step',
  kindOf({ hasPrescreen: true, tourInvited: false, openTourSlots: 9 }),
  'skip:pre-screened, not yet invited to tour',
)
check(
  'invited but the calendar is empty: no dead-end links',
  kindOf({ hasPrescreen: true, tourInvited: true, openTourSlots: 0 }),
  'skip:no open tour slots to offer',
)
check(
  'already booked',
  kindOf({ hasPrescreen: true, tourInvited: true, openTourSlots: 3, hasLiveTour: true }),
  'skip:tour already booked',
)
check(
  'already been round the place',
  kindOf({ hasPrescreen: true, tourInvited: true, openTourSlots: 3, toured: true }),
  'skip:already toured',
)

// ── Send-once, per lead and per person ───────────────────────────────────
check('the claim stops a second prescreen nudge', kindOf({ alreadySent: ['prescreen'] }), 'skip:already sent prescreen')
check(
  'a prescreen claim does not block the later tour nudge',
  kindOf({ hasPrescreen: true, tourInvited: true, openTourSlots: 2, alreadySent: ['prescreen'] }),
  'tour_booking',
)
check(
  'and the tour claim stops a second of those',
  kindOf({ hasPrescreen: true, tourInvited: true, openTourSlots: 2, alreadySent: ['prescreen', 'tour_booking'] }),
  'skip:already sent tour_booking',
)
check(
  'one email per person per week, however many places they asked about',
  kindOf({ addressMailedRecently: true }),
  'skip:address had a follow-up this week',
)
check('the cooldown is at least the window wide', ADDRESS_COOLDOWN_DAYS >= MAX_AGE_DAYS, true)

// ── Deliverability and consent come before everything ───────────────────
check('no address, no email', kindOf({ email: '' }), 'skip:no email address')
check('a dead domain is not mailed', kindOf({ deliverable: false }), 'skip:undeliverable address')
check('an opt-out is final', kindOf({ optedOut: true }), 'skip:opted out')
check(
  'consent is checked before the window, so a dry run names the real reason',
  kindOf({ optedOut: true, ageDays: 400 }),
  'skip:opted out',
)
check(
  'a rented or paused listing is not promoted',
  kindOf({ listingAcceptsLeads: false }),
  'skip:listing is not taking interest',
)
check('the opt-out category is the scoped one', FOLLOWUP_CATEGORY, 'lead_followup')

// ── The copy may only say what it was given ──────────────────────────────
const opts = {
  kind: 'prescreen',
  to: 'student@asu.edu',
  firstName: 'Maya',
  propertyName: 'Palm & Ash',
  propertyAddress: '101 E Apache Blvd',
  heroImage: 'https://img.example/hero.jpg',
  landlordFirstName: 'Sachin',
  hasFaqs: true,
  propertySlug: 'palm-ash-a1b2c',
  leadId: 'lead-123',
  openTourSlots: 0,
  site: 'https://homehive.live',
}

const pre = renderFollowupEmail(opts)
check('prescreen subject names the place', pre.subject.includes('Palm & Ash'), true)
check('prescreen CTA goes to that lead\'s pre-screen', pre.html.includes('/pre-screen/lead-123'), true)
// The pre-screen nudge must not reach for the tour gate: no booking link, and
// no suggestion an invitation exists. (The footer's "tour confirmations are
// unaffected" line is the shared unsubscribe wording, which is why this checks
// the two claims rather than the word.)
check('prescreen email offers no booking link', pre.html.includes('/book-tour'), false)
check('prescreen email claims no invitation', /invited/i.test(pre.html), false)
check('prescreen email carries the unsubscribe', pre.html.includes('/api/email/unsubscribe?'), true)
check('prescreen email signs the unsubscribe', pre.html.includes(`c=${FOLLOWUP_CATEGORY}`), true)
check('the hero photo is used when there is one', pre.html.includes('https://img.example/hero.jpg'), true)
check('the FAQ link appears only because hasFaqs was true', pre.html.includes('/homes/palm-ash-a1b2c/faq'), true)
check(
  'and not when it is false',
  renderFollowupEmail({ ...opts, hasFaqs: false }).html.includes('/faq'),
  false,
)
check(
  'an ampersand in a listing name is escaped, not injected',
  pre.html.includes('Palm &amp; Ash') && !pre.html.includes('Palm & Ash'),
  true,
)

const tour = renderFollowupEmail({ ...opts, kind: 'tour_booking', hasPrescreen: true, openTourSlots: 3 })
check('tour CTA goes to that lead\'s booking page', tour.html.includes('/book-tour/lead-123'), true)
check('the slot count in the copy is the one passed in', tour.html.includes('3 slots are'), true)
check(
  'one slot is singular, because "1 slots" is how a reader stops trusting you',
  renderFollowupEmail({ ...opts, kind: 'tour_booking', openTourSlots: 1 }).html.includes('1 slot is'),
  true,
)
check('the tour email attributes the invite to the landlord', tour.html.includes('Sachin invited you'), true)
check(
  'with no landlord name it stays vague rather than guessing',
  renderFollowupEmail({ ...opts, kind: 'tour_booking', landlordFirstName: null, openTourSlots: 2 })
    .html.includes('The landlord invited you'),
  true,
)

// A lead with no property attached still renders, and claims nothing about one.
const orphan = renderFollowupEmail({
  ...opts,
  propertyName: null,
  propertyAddress: null,
  heroImage: null,
  propertySlug: null,
  hasFaqs: false,
})
check('a lead with no listing still gets a sane subject', orphan.subject.includes('Maya'), true)
check('and no broken listing link', orphan.html.includes('/homes/null'), false)
check('and no empty image tag', orphan.html.includes('<img'), false)

// ── Report ───────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('✓ the two-day follow-up only mails who it should, and only says what it was given\n')
