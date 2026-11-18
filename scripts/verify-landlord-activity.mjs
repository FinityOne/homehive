/**
 * Proves the activity feed is honest about what it is showing.
 *
 * Worth a script rather than a reading, because every way of getting a
 * notification centre wrong produces a badge that still looks fine:
 *
 *   • the kind list in TypeScript drifting from the check constraint in SQL,
 *     so a new event type renders as a blank row in production and passes
 *     every type check on the way there
 *   • a badge counting something different from the list underneath it, which
 *     is the one failure that teaches a landlord to stop trusting both
 *   • "unread" computed against a watermark with the comparison the wrong way
 *     round, so marking read hides nothing or hides everything
 *   • an email that bounced three weeks ago reading as ordinary history
 *     because the row's tone comes from the kind rather than the outcome
 *   • a payment at 7pm Phoenix on the 1st filed under the 2nd, because the day
 *     bucket was computed in UTC
 *   • a scoped feed on a tenant's page matching by a differently-cased email
 *     and showing them nothing
 *
 * Run: npm run verify:activity
 */
import { readFileSync } from 'node:fs'

const {
  ACTIVITY_KINDS, KIND_META, ACTIVITY_LANES, metaFor, toneFor, needsAttention,
  emailOutcome, isUnread, unreadCount, badgeLabel, BADGE_CAP,
  filterEvents, laneCounts, groupByDay, phoenixDay, relativeTime, money,
  scopeMatches, activityHref, subtitleFor,
} = await import('../src/lib/landlordActivity.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

let seq = 0
const ev = (over = {}) => ({
  id: `e${seq++}`,
  kind: 'rent.paid',
  occurred_at: '2026-11-06T18:00:00Z',
  title: 'Rent paid',
  detail: 'November 2026 rent',
  href: '/landlord/financials?plan=p1',
  actor_name: 'Aleeya Cruz',
  actor_email: 'aleeya@example.com',
  property_id: 'prop-1',
  plan_id: 'p1',
  amount: 870.66,
  meta: {},
  ...over,
})

// ── 1. The vocabulary matches the database ───────────────────────────────────
//
// The single highest-value check here. These two lists live in different
// languages in different files, and nothing but this script connects them.
{
  const sql = readFileSync(
    new URL('../supabase/migrations/20261118110000_activity_absorbs_notifications.sql', import.meta.url),
    'utf8',
  )
  const block = sql.slice(
    sql.indexOf('add constraint landlord_activity_kind_check'),
    sql.indexOf('-- The notifications source'),
  )
  const inSql = [...block.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map(m => m[1]).sort()
  check('every SQL kind exists in TypeScript', inSql, [...ACTIVITY_KINDS].sort())
  check('every TypeScript kind has metadata',
    ACTIVITY_KINDS.filter(k => !KIND_META[k]), [])
  check('every kind sits in a real lane',
    ACTIVITY_KINDS.filter(k => !ACTIVITY_LANES.includes(KIND_META[k].lane)), [])
}

// ── 2. An unknown kind renders, rather than vanishing ────────────────────────
{
  check('an unknown kind falls back', metaFor('something.new').label, 'Notice')
  check('a known kind does not', metaFor('payment.failed').label, 'Payment failed')
}

// ── 3. Unread is a watermark, and the comparison runs the right way ──────────
{
  const older = ev({ occurred_at: '2026-11-01T00:00:00Z' })
  const newer = ev({ occurred_at: '2026-11-10T00:00:00Z' })
  const mark = '2026-11-05T00:00:00Z'

  check('an event before the mark is read', isUnread(older, mark), false)
  check('an event after the mark is unread', isUnread(newer, mark), true)
  // The boundary: the mark is set to the newest row the landlord was SHOWN,
  // so that row itself must count as read or it never clears.
  check('an event exactly at the mark is read', isUnread(ev({ occurred_at: mark }), mark), false)
  check('no mark at all means everything is new', isUnread(older, null), true)
  check('the count agrees with the predicate', unreadCount([older, newer], mark), 1)
}

// ── 4. The badge is capped but never lies about direction ────────────────────
{
  check('nothing unread shows no badge', badgeLabel(0), '')
  check('a negative count shows no badge', badgeLabel(-3), '')
  check('a small count is exact', badgeLabel(7), '7')
  check('the cap itself is exact', badgeLabel(BADGE_CAP), String(BADGE_CAP))
  check('past the cap it is a floor, not a lie', badgeLabel(BADGE_CAP + 1), `${BADGE_CAP}+`)
}

// ── 5. An email's OUTCOME overrides its kind ─────────────────────────────────
//
// A bounce is not neutral history. If the tone came from the kind, a bounced
// rent reminder would be painted the same grey as a delivered receipt — and
// the landlord with a tenant who "never replies" would never find out why.
{
  const sent     = ev({ kind: 'email.sent', amount: null, meta: { outcome: 'sent' } })
  const opened   = ev({ kind: 'email.sent', amount: null, meta: { outcome: 'opened' } })
  const bounced  = ev({ kind: 'email.sent', amount: null, meta: { outcome: 'bounced' } })
  const spam     = ev({ kind: 'email.sent', amount: null, meta: { outcome: 'complained' } })

  check('a plain send is neutral', toneFor(sent), 'neutral')
  check('an opened send is good', toneFor(opened), 'good')
  check('a bounce is bad', toneFor(bounced), 'bad')
  check('a bounce needs attention', needsAttention(bounced), true)
  check('a spam complaint needs attention', needsAttention(spam), true)
  check('a delivered send does not', needsAttention(sent), false)
  check('a missing outcome reads as sent',
    emailOutcome(ev({ kind: 'email.sent', meta: {} })), 'sent')
  check('a non-email has no outcome', emailOutcome(ev()), null)

  // A failed payment is the other thing that needs a landlord today.
  check('a failed payment needs attention', needsAttention(ev({ kind: 'payment.failed' })), true)
  check('a successful one does not', needsAttention(ev({ kind: 'rent.paid' })), false)
}

// ── 6. The tabs and the list agree ───────────────────────────────────────────
//
// Counts are computed over the UNFILTERED list on purpose: a tab whose number
// changes when you click a different tab cannot be navigated by.
{
  const mark = '2026-11-05T00:00:00Z'
  const events = [
    ev({ occurred_at: '2026-11-10T00:00:00Z', kind: 'payment.failed' }),
    ev({ occurred_at: '2026-11-09T00:00:00Z', kind: 'email.sent', meta: { outcome: 'delivered' } }),
    ev({ occurred_at: '2026-11-02T00:00:00Z', kind: 'rent.paid' }),
    ev({ occurred_at: '2026-11-01T00:00:00Z', kind: 'tenant.login' }),
  ]
  const counts = laneCounts(events, mark)
  check('all counts everything', counts.all, 4)
  check('unread counts only what is past the mark', counts.unread, 2)
  check('attention counts the failure', counts.attention, 1)
  check('lanes partition the list',
    counts.money + counts.email + counts.residents + counts.leasing, 4)

  check('the unread tab returns exactly the unread count',
    filterEvents(events, { unreadOnly: true }, mark).length, counts.unread)
  check('the attention tab returns exactly the attention count',
    filterEvents(events, { attentionOnly: true }, mark).length, counts.attention)
  check('a lane filter returns exactly that lane',
    filterEvents(events, { lane: 'money' }, mark).length, counts.money)
  check('no filter returns everything', filterEvents(events, {}, mark).length, 4)
}

// ── 7. Search looks at the person, not just the title ────────────────────────
{
  const events = [
    ev({ actor_name: 'Aleeya Cruz',    actor_email: 'aleeya@example.com' }),
    ev({ actor_name: 'Gauge Berkhahn', actor_email: 'gauge@example.com' }),
  ]
  check('a name matches', filterEvents(events, { query: 'aleeya' }, null).length, 1)
  check('search is case-insensitive', filterEvents(events, { query: 'GAUGE' }, null).length, 1)
  check('an email domain matches both', filterEvents(events, { query: 'example.com' }, null).length, 2)
  check('a miss returns nothing', filterEvents(events, { query: 'zzz' }, null).length, 0)
}

// ── 8. Days are Phoenix days ─────────────────────────────────────────────────
//
// Rent paid at 7pm Phoenix on 1 November is 2 November in UTC. Filing it under
// the 2nd is how a feed quietly stops agreeing with the ledger beside it.
{
  check('evening Phoenix stays on its own day',
    phoenixDay('2026-11-02T02:30:00Z'), '2026-11-01')
  check('midday UTC is the same day either way',
    phoenixDay('2026-11-02T18:00:00Z'), '2026-11-02')

  const now = new Date('2026-11-10T20:00:00Z')  // 1pm Phoenix, Tue 10 Nov
  const days = groupByDay([
    ev({ occurred_at: '2026-11-10T19:00:00Z' }),
    ev({ occurred_at: '2026-11-10T16:00:00Z' }),
    ev({ occurred_at: '2026-11-09T19:00:00Z' }),
    ev({ occurred_at: '2026-11-02T02:30:00Z' }),
  ], now)

  check('one bucket per day', days.map(d => d.day),
    ['2026-11-10', '2026-11-09', '2026-11-01'])
  check('today and yesterday are named', days.slice(0, 2).map(d => d.label),
    ['Today', 'Yesterday'])
  check('older days get a date', days[2].label.startsWith('Sun'), true)
  check('buckets are newest first within a day',
    days[0].events.map(e => e.occurred_at),
    ['2026-11-10T19:00:00Z', '2026-11-10T16:00:00Z'])
  check('nothing is lost in grouping',
    days.reduce((n, d) => n + d.events.length, 0), 4)
}

// ── 9. Relative time degrades sensibly ───────────────────────────────────────
{
  const now = new Date('2026-11-10T20:00:00Z')
  check('under a minute', relativeTime('2026-11-10T19:59:40Z', now), 'just now')
  check('minutes', relativeTime('2026-11-10T19:45:00Z', now), '15m ago')
  check('earlier today is a clock time',
    /^\d{1,2}:\d{2}/.test(relativeTime('2026-11-10T15:00:00Z', now)), true)
  check('yesterday is hours', relativeTime('2026-11-09T20:00:00Z', now), '24h ago')
  check('last week is a date',
    relativeTime('2026-11-01T20:00:00Z', now).startsWith('Sun'), true)
}

// ── 10. Money is never a fake zero ───────────────────────────────────────────
{
  check('an amount formats', money(870.66), '$870.66')
  check('a real zero prints', money(0), '$0.00')
  // "no amount" and "$0.00" are different facts. A sign-in has no amount, and
  // printing $0.00 beside it would read as a payment of nothing.
  check('a missing amount is blank', money(null), '')
  check('an undefined amount is blank', money(undefined), '')
  check('a sign-in subtitle carries no money',
    subtitleFor(ev({ kind: 'tenant.login', amount: null, detail: null })), 'Aleeya Cruz')
  check('an email subtitle carries no money either',
    subtitleFor(ev({ kind: 'email.sent', detail: 'Receipt' })).includes('$'), false)
}

// ── 11. Scoping cannot leak another tenant's row ─────────────────────────────
{
  const e = ev()
  check('a matching property matches', scopeMatches(e, { propertyId: 'prop-1' }), true)
  check('another property does not', scopeMatches(e, { propertyId: 'prop-2' }), false)
  check('a matching plan matches', scopeMatches(e, { planId: 'p1' }), true)
  check('an empty scope matches everything', scopeMatches(e, {}), true)
  // Email is the only thing joining a tenant record to a payer, and addresses
  // arrive in whatever case the landlord typed them.
  check('email matching ignores case',
    scopeMatches(e, { email: 'ALEEYA@example.com' }), true)
  check('a different address does not match',
    scopeMatches(e, { email: 'someone@else.com' }), false)
  check('a null actor never matches an email scope',
    scopeMatches(ev({ actor_email: null }), { email: 'aleeya@example.com' }), false)
  // Every narrowing must hold at once, or a per-property feed would show a
  // tenant's rent from a different building.
  check('scopes are ANDed',
    scopeMatches(e, { propertyId: 'prop-1', email: 'someone@else.com' }), false)
}

// ── 12. The embedded feed links to the same thing it is showing ──────────────
{
  check('no scope is the plain page', activityHref(), '/landlord/activity')
  check('a property scope carries over',
    activityHref({ propertyId: 'prop-1' }), '/landlord/activity?property=prop-1')
  check('a lane carries over',
    activityHref({ planId: 'p1' }, 'money'), '/landlord/activity?plan=p1&lane=money')
  check('an email is encoded',
    activityHref({ email: 'a+b@example.com' }),
    '/landlord/activity?email=a%2Bb%40example.com')
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `✓ the kind list matches the check constraint, unread is a watermark that ` +
  `clears what it showed, a bounce outranks its kind, the tab counts match ` +
  `the lists they open, days bucket in Phoenix, and no scope can show one ` +
  `tenant another's row\n`
)
