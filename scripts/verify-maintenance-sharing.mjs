/**
 * Proves who may see a maintenance item, and what of it.
 *
 * Worth a script rather than a careful reading, because every way of getting
 * this wrong is silent and most of them are a privacy incident rather than a
 * bug:
 *
 *   • an item shared by default — the flag has to fail closed, so a landlord
 *     who never touches this control never publishes anything
 *   • a tenant seeing the estimate, the actual spend, the vendor's number or
 *     the landlord's private description. `shapeForTenant` is checked against
 *     an *exhaustive key list*, not "does it still have a title": a spread with
 *     a few deletes passes a happy-path test and leaks the next column added
 *   • an ex-tenant still watching the work on the home they moved out of, and
 *     a tenant whose lease starts in August reading July's work
 *   • a tenant in unit 2 reading work scoped to unit 3's tenancy
 *   • the last day of a tenancy judged in UTC, which in Phoenix ends it at 5pm
 *     and locks a resident out while they still live there
 *   • `cancelled` reaching a tenant as a half-event
 *   • a cost or a vendor's phone number reaching a resident's *inbox* — the
 *     API response is shaped, but an email template that reads the landlord
 *     row instead leaks the same data and cannot be un-sent
 *
 * Run: npm run verify:maintenance
 */
const {
  shapeForTenant, leaseIsActive, visibleToTenant, splitForTenant, summarise,
  shareAudience, describeAudience, visibleUpdates,
  TENANT_STATUS_META, tenantKindLabel,
} = await import('../src/lib/tenantMaintenance.ts')
const { computeTotals } = await import('../src/lib/maintenance.ts')
const { updateReach, isEmptyUpdate, photoCount, sharedCount } =
  await import('../src/lib/workItemUpdates.ts')
const { buildWorkItemCompletedEmail } = await import('../src/lib/maintenanceEmails.ts')

const pass = []
const fail = []
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ;(ok ? pass : fail).push(`${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// Noon UTC on 17 Nov 2026 is still 17 Nov in Phoenix, so "today" is unambiguous.
const NOW = new Date('2026-11-17T19:00:00Z')
// 00:30 UTC on 18 Nov is still *17* Nov in Phoenix — the hour that breaks a
// naive `new Date().toISOString().slice(0,10)`.
const LATE = new Date('2026-11-18T00:30:00Z')

const row = (over = {}) => ({
  id: 'w1',
  property_id: 'p1',
  lease_id: null,
  title: 'Replace bedroom 2 flooring',
  kind: 'repair',
  status: 'scheduled',
  tenant_visible: true,
  tenant_note: 'The fitters are booked for Thursday morning.',
  area: 'Bedroom 2',
  target_date: '2026-11-25',
  scheduled_for: '2026-11-20',
  completed_at: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-02T10:00:00Z',
  // Everything below this line is the landlord's and must never cross.
  owner_id: 'o1',
  description: 'Carpet is trashed, cheapest LVP will do',
  priority: 'low',
  estimated_cost: 1200,
  actual_cost: 980,
  vendor_name: 'Tempe Flooring Co.',
  vendor_contact: '480-555-0134',
  assigned_to: 'Marco',
  reported_by: 'housemate complained again',
  notes: 'Do not tell them we are using the cheap stuff',
  inspection_item_id: 'i1',
  position: 0,
  ...over,
})

const lease = (over = {}) => ({
  id: 'l1', property_id: 'p1',
  start_date: '2026-08-01', end_date: '2027-07-31',
  ...over,
})

// ── 1. What crosses the line ─────────────────────────────────────────────────

// The whole allow-list, spelled out. If a key is added to the tenant shape it
// has to be added here too — which is the point: the diff makes somebody look.
check('shaped item exposes exactly these keys',
  Object.keys(shapeForTenant(row())).sort(),
  ['area', 'completed_at', 'created_at', 'id', 'kind', 'note', 'property_id',
   'scheduled_for', 'status', 'target_date', 'title', 'updated_at', 'updates'])

// `updates` is read as `item.updates.length` all over the UI, so it has to be
// an array on an item nobody has ever updated — not undefined.
check('updates is always an array', Array.isArray(shapeForTenant(row()).updates), true)

// Named individually as well, because the list above is easy to update without
// reading, and each of these has its own reason for being a secret.
for (const leaked of [
  'estimated_cost', 'actual_cost', 'description', 'vendor_name', 'vendor_contact',
  'assigned_to', 'reported_by', 'notes', 'priority', 'owner_id', 'inspection_item_id',
]) {
  check(`shaped item hides ${leaked}`, leaked in shapeForTenant(row()), false)
}

check('tenant note is the shared sentence, not the private description',
  shapeForTenant(row()).note, 'The fitters are booked for Thursday morning.')
check('no tenant note reads as absent, never as the description',
  shapeForTenant(row({ tenant_note: null })).note, null)

// ── 2. Who may see it ────────────────────────────────────────────────────────

check('a private item is invisible even to a current tenant',
  visibleToTenant([row({ tenant_visible: false })], [lease()], NOW).length, 0)

check('a shared item reaches a current tenant',
  visibleToTenant([row()], [lease()], NOW).map(i => i.id), ['w1'])

check('an ex-tenant sees nothing',
  visibleToTenant([row()], [lease({ start_date: '2025-08-01', end_date: '2026-07-31' })], NOW).length, 0)

check('a tenant whose lease has not started sees nothing',
  visibleToTenant([row()], [lease({ start_date: '2026-12-01', end_date: '2027-11-30' })], NOW).length, 0)

check('no lease at all means nothing',
  visibleToTenant([row()], [], NOW).length, 0)

check('an open-ended tenancy counts as running',
  visibleToTenant([row()], [lease({ end_date: null })], NOW).length, 1)

check('a lease with no start date is a draft, not a tenancy',
  leaseIsActive(lease({ start_date: null }), NOW), false)

// The Phoenix rule. Both of these are the *last day* of the tenancy, and the
// second one is after midnight UTC — the moment a naive implementation evicts
// someone from their own portal.
check('the last day of the tenancy still counts (noon UTC)',
  leaseIsActive(lease({ end_date: '2026-11-17' }), NOW), true)
check('the last day of the tenancy still counts (00:30 UTC next day)',
  leaseIsActive(lease({ end_date: '2026-11-17' }), LATE), true)
check('the day after the tenancy does not',
  leaseIsActive(lease({ end_date: '2026-11-16' }), NOW), false)
check('the first day of the tenancy counts',
  leaseIsActive(lease({ start_date: '2026-11-17' }), NOW), true)

// Per-lease scoping: same building, different tenancy.
check('work scoped to another lease is invisible',
  visibleToTenant([row({ lease_id: 'l9' })], [lease()], NOW).length, 0)
check('work scoped to my own lease is visible',
  visibleToTenant([row({ lease_id: 'l1' })], [lease()], NOW).length, 1)
check('building-wide work (no lease) is visible to the building',
  visibleToTenant([row({ lease_id: null })], [lease()], NOW).length, 1)

check('another property\'s work is invisible',
  visibleToTenant([row({ property_id: 'p9' })], [lease()], NOW).length, 0)

// An active lease and an ended one at once: the ended one must not act as a key.
check('an ended tenancy does not unlock its property',
  visibleToTenant(
    [row({ property_id: 'p2' })],
    [lease(), lease({ id: 'l2', property_id: 'p2', start_date: '2024-01-01', end_date: '2025-12-31' })],
    NOW,
  ).length, 0)

// ── 2b. Progress updates and photos ──────────────────────────────────────────

const upd = (over = {}) => ({
  id: 'u1',
  work_item_id: 'w1',
  body: 'The fitters are coming Thursday.',
  tenant_visible: true,
  created_at: '2026-11-10T10:00:00Z',
  photos: [{
    id: 'ph1', url: 'https://cdn/x.jpg', caption: 'Before', position: 0,
    // Must not cross:
    storage_path: 'owner/updates/u1/x.jpg', owner_id: 'o1', update_id: 'u1',
    created_at: '2026-11-10T10:00:00Z',
  }],
  ...over,
})

// THE gate that is easy to miss. An update shared against a job that is still
// private must stay invisible, or publishing the update reveals the job — "the
// plumber comes Thursday" tells a tenant about work they were never told about.
check('a shared update on a PRIVATE job reaches nobody',
  visibleUpdates({ id: 'w1', tenant_visible: false }, [upd()]).length, 0)
check('a private update on a shared job reaches nobody',
  visibleUpdates({ id: 'w1', tenant_visible: true }, [upd({ tenant_visible: false })]).length, 0)
check('both shared → visible',
  visibleUpdates({ id: 'w1', tenant_visible: true }, [upd()]).map(u => u.id), ['u1'])

// And the same rule through the real entry point, not just the helper.
check('the item gate applies through shapeForTenant too',
  shapeForTenant(row({ tenant_visible: false }), [upd()]).updates.length, 0)
check('a shared item carries its shared updates',
  shapeForTenant(row(), [upd()]).updates.length, 1)

check('an update belonging to another item is not mixed in',
  visibleUpdates({ id: 'w1', tenant_visible: true }, [upd({ work_item_id: 'w9' })]).length, 0)

// A row with no note and no photo renders as a timestamped bubble saying
// nothing, which reads as a bug rather than as an update.
check('an empty update is dropped',
  visibleUpdates({ id: 'w1', tenant_visible: true },
    [upd({ body: '   ', photos: [] })]).length, 0)
// `rows.map(shapeForTenant)` is the natural way to call the shaper, and
// Array.map hands it the index as a second argument. That used to throw.
check('shapeForTenant survives being passed straight to Array.map',
  [row(), row({ id: 'w2' })].map(shapeForTenant).map(i => i.updates.length), [0, 0])

check('a photo-only update is kept',
  visibleUpdates({ id: 'w1', tenant_visible: true },
    [upd({ body: null })]).length, 1)
check('a note-only update is kept',
  visibleUpdates({ id: 'w1', tenant_visible: true },
    [upd({ photos: [] })]).length, 1)

const shapedUpdate = visibleUpdates({ id: 'w1', tenant_visible: true }, [upd()])[0]
check('a tenant update exposes exactly these keys',
  Object.keys(shapedUpdate).sort(), ['body', 'created_at', 'id', 'photos'])
// No `tenant_visible`: by the time one of these exists it has passed both
// gates, and shipping the flag invites a client to re-decide it.
check('the update does not carry its own visibility flag',
  'tenant_visible' in shapedUpdate, false)
check('a tenant photo exposes exactly these keys',
  Object.keys(shapedUpdate.photos[0]).sort(), ['caption', 'id', 'url'])
for (const leaked of ['storage_path', 'owner_id', 'update_id', 'position', 'created_at']) {
  check(`tenant photo hides ${leaked}`, leaked in shapedUpdate.photos[0], false)
}

check('photos follow their position, not their insertion order',
  visibleUpdates({ id: 'w1', tenant_visible: true }, [upd({
    photos: [
      { id: 'b', url: 'u/b', caption: null, position: 2 },
      { id: 'a', url: 'u/a', caption: null, position: 1 },
      { id: 'c', url: 'u/c', caption: null, position: 3 },
    ],
  })])[0].photos.map(p => p.id), ['a', 'b', 'c'])

// Newest first: the tenant's live question is "where is this now".
check('updates read newest first',
  visibleUpdates({ id: 'w1', tenant_visible: true }, [
    upd({ id: 'old', created_at: '2026-11-01T10:00:00Z' }),
    upd({ id: 'new', created_at: '2026-11-15T10:00:00Z' }),
    upd({ id: 'mid', created_at: '2026-11-08T10:00:00Z' }),
  ]).map(u => u.id), ['new', 'mid', 'old'])

// The landlord's own reading of reach. Three states, and the third is the one
// a two-state label would lie about.
check('reach: private update', updateReach({ tenant_visible: false }, { tenant_visible: true }).label, 'Private')
check('reach: shared update on a shared job', updateReach({ tenant_visible: true }, { tenant_visible: true }).label, 'Shared')
check('reach: shared update on a private job is NOT reported as shared',
  updateReach({ tenant_visible: true }, { tenant_visible: false }).label, 'Not shown yet')
check('…and it says why',
  !!updateReach({ tenant_visible: true }, { tenant_visible: false }).why, true)
check('…and it is not shown',
  updateReach({ tenant_visible: true }, { tenant_visible: false }).shown, false)
check('a private update needs no explanation',
  updateReach({ tenant_visible: false }, { tenant_visible: true }).why, null)

check('an update with nothing in it is empty',
  isEmptyUpdate({ body: '  ', photos: [] }), true)
check('photos alone are not empty', isEmptyUpdate({ body: null, photos: [{ id: 'p' }] }), false)
check('photoCount sums across updates',
  photoCount([{ photos: [{}, {}] }, { photos: [{}] }, { photos: [] }]), 3)
check('sharedCount counts shared updates',
  sharedCount([{ tenant_visible: true }, { tenant_visible: false }, { tenant_visible: true }]), 2)

// ── 3. How it reads ──────────────────────────────────────────────────────────

const many = [
  row({ id: 'a', status: 'completed', completed_at: '2026-10-02T10:00:00Z', scheduled_for: null, target_date: null }),
  row({ id: 'b', status: 'completed', completed_at: '2026-11-05T10:00:00Z', scheduled_for: null, target_date: null }),
  row({ id: 'c', status: 'todo', scheduled_for: null, target_date: null, created_at: '2026-11-10T10:00:00Z' }),
  row({ id: 'd', status: 'scheduled', scheduled_for: '2026-11-19', target_date: null }),
  row({ id: 'e', status: 'in_progress', scheduled_for: null, target_date: '2026-11-18' }),
  row({ id: 'f', status: 'cancelled', scheduled_for: null, target_date: null }),
].map(shapeForTenant)

const split = splitForTenant(many)
check('cancelled work never reaches a tenant',
  [...split.pending, ...split.completed].some(i => i.status === 'cancelled'), false)
check('pending is soonest-committed-date first, undated last',
  split.pending.map(i => i.id), ['e', 'd', 'c'])
check('completed is most-recently-finished first',
  split.completed.map(i => i.id), ['b', 'a'])

check('the next booked date skips dates already past',
  summarise(many, NOW).scheduledNext?.id, 'e')
check('pending/completed counts',
  [summarise(many, NOW).pendingCount, summarise(many, NOW).completedCount], [3, 2])

// "Nothing outstanding" has to be said in words — an empty list reads as a
// page that failed to load, and this is genuinely good news.
check('all-done says so', summarise([split.completed[0]], NOW).headline,
  'Nothing outstanding — every shared job here is done.')
check('nothing shared says that instead', summarise([], NOW).headline,
  'No maintenance has been shared with you for this home yet.')
check('one open job is singular', summarise([split.pending[0]], NOW).headline,
  '1 job is open on this home.')

// Tenant-facing wording. `todo` as "To do" reads to a resident as "nobody has
// looked at this"; `blocked` as "Blocked" reads as abandoned.
check('todo is not called "to do"', TENANT_STATUS_META.todo.label, 'Reported')
check('blocked is not called "blocked"', TENANT_STATUS_META.blocked.label, 'On hold')
check('cancelled has no tenant wording at all', 'cancelled' in TENANT_STATUS_META, false)
check('tenant_issue is not landlord jargon', tenantKindLabel('tenant_issue'), 'Reported issue')

// ── 4. What the landlord is told about reach ─────────────────────────────────

const leases = [
  lease({ id: 'l1', property_id: 'p1', tenants: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }),
  lease({ id: 'l2', property_id: 'p2', start_date: '2024-01-01', end_date: '2025-01-01', tenants: [{ id: 't4' }] }),
]
check('audience counts residents on active leases only',
  shareAudience('p1', leases, NOW), { leases: 1, residents: 3 })
check('a vacant property has no audience',
  shareAudience('p2', leases, NOW), { leases: 0, residents: 0 })
check('a vacant property says so rather than claiming 0 readers',
  describeAudience(shareAudience('p2', leases, NOW)),
  'No active tenancy here — nobody can see shared items yet')
check('an occupied property names the number',
  describeAudience(shareAudience('p1', leases, NOW)), '3 residents can see shared items')
check('an active lease with nobody on it is not a silent zero',
  describeAudience(shareAudience('p3', [lease({ id: 'l3', property_id: 'p3', tenants: [] })], NOW)),
  'Active tenancy, but no residents are recorded on it yet')

// ── 5. The landlord's "shared" count ─────────────────────────────────────────

// Open work only: "3 shared" is a statement about what residents are watching
// now, and a job finished in March is not something they are waiting on.
const work = (over = {}) => ({
  status: 'todo', priority: 'medium', estimated_cost: null, actual_cost: null,
  target_date: null, tenant_visible: false, ...over,
})
check('shared counts open shared items',
  computeTotals([
    work({ tenant_visible: true }),
    work({ tenant_visible: true, status: 'in_progress' }),
    work({ tenant_visible: true, status: 'completed' }),
    work({ tenant_visible: true, status: 'cancelled' }),
    work({ tenant_visible: false }),
  ], NOW).shared, 2)
check('nothing shared counts zero', computeTotals([work(), work()], NOW).shared, 0)

// ── 6. The "it's done" email to residents ────────────────────────────────────

// The same privacy question as section 1, asked of the thing that leaves the
// building. `shapeForTenant` keeping a cost out of the API response is no
// comfort if the email template reaches for the landlord row instead, and an
// email cannot be un-sent — so the rendered subject, html and text are searched
// for every private value on the fixture.
const doneRow = row({
  status: 'completed',
  completed_at: '2026-11-20T19:45:05Z',
  title: 'Haul away old fridge and garage junk',
  area: 'Garage',
  tenant_note: 'The removal company comes Friday at 11:30 — please be home to let them in.',
})

const built = buildWorkItemCompletedEmail({
  item: shapeForTenant(doneRow),
  propertyName: 'University Dr Palace',
  portalUrl: 'https://homehive.live/dashboard/lease?tab=maintenance',
  note: 'All gone — the fridge and the boxes went this morning.',
  tenantName: 'Aleeya Cruz',
})

const whole = `${built.subject}\n${built.html}\n${built.text}`
const PRIVATE = [
  ['the estimate', '1200'],
  ['the actual spend', '980'],
  ['the vendor', 'Tempe Flooring Co.'],
  ["the vendor's number", '480-555-0134'],
  ['the private description', 'cheapest LVP'],
  ['the landlord notes', 'cheap stuff'],
  ['who it was assigned to', 'Marco'],
  ['who reported it', 'housemate complained'],
]
for (const [label, needle] of PRIVATE) {
  check(`completion email never mentions ${label}`, whole.includes(needle), false)
}

check('completion email says completed in the subject',
  built.subject, 'Completed: Haul away old fridge and garage junk (University Dr Palace)')
check('completion email greets by first name only', built.text.includes('Hi Aleeya,'), true)
check('completion email carries the shared note',
  built.text.includes('All gone — the fridge and the boxes went this morning.'), true)
check('completion email links the portal',
  built.text.includes('https://homehive.live/dashboard/lease?tab=maintenance'), true)
check('completion email names the day it finished',
  built.text.includes('November 20, 2026'), true)

// `tenant_note` is written *before* the work and is routinely an instruction.
// Quoting it in a completion email tells a resident to be home for something
// that already happened, so the template takes the progress note instead.
check('completion email does not quote the pre-work instruction',
  whole.includes('please be home'), false)

// No reply-to is set by the route, and the body must not hand out an address
// either — the portal is the channel.
check('completion email prints no email address', built.text.includes('@'), false)

// A job with no shared progress note still reads as a finished sentence.
const bare = buildWorkItemCompletedEmail({
  item: shapeForTenant(doneRow),
  propertyName: 'University Dr Palace',
  portalUrl: 'https://homehive.live/dashboard/lease?tab=maintenance',
})
check('completion email works with no note and no name',
  bare.text.includes('This repair at your home is now finished'), true)

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`\n  Maintenance sharing — ${pass.length} passed, ${fail.length} failed\n`)
for (const f of fail) console.log(`  ✗ ${f}`)
if (fail.length === 0) console.log('  ✓ all good\n')
else { console.log(''); process.exit(1) }
