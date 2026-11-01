// What a landlord can do before they pay.
//
// The portal used to be all-or-nothing: no plan, no portal. That put the
// paywall before any work was done, which is the worst possible place for it —
// a landlord who has typed nothing has nothing to lose by closing the tab.
//
// So the line moved. Building is free: add properties, write the listing,
// upload photos, set the rent, change the status, archive. Everything that
// *earns* from that work is paid — publishing to students, the leads it
// produces, screening, tours, leases, rent, maintenance, move-out.
//
// Two things make that honest rather than a tease:
//   • The work is kept. Nothing a free landlord builds is thrown away; the
//     listing publishes itself the moment a plan starts (`owner_plan_active`
//     is a trigger-maintained column — see listingStatus.ts).
//   • Locked pages say what they do and why they need a plan, rather than
//     bouncing to a pricing page that never names the thing they wanted.
//
// This file is the only place that decides which side of that line a path
// falls on. The portal gate, the sidebar locks and the paywall screen all read
// it, so they cannot disagree about what is free.

/**
 * Properties a landlord may build without paying.
 *
 * Not one: a landlord with three doors who can only draft one never sees what
 * the portal does with a portfolio, and the cap would read as a trial rather
 * than as the product. Not unlimited either — free rows nobody can see are
 * cost without a path to revenue, and a ceiling is a reason to subscribe that
 * arrives exactly when the work is already done.
 */
export const FREE_PROPERTY_LIMIT = 3

/** Where an unpaid landlord's portal starts: the one place they can work. */
export const FREE_LANDLORD_HOME = '/landlord/listings'

/** Does `pathname` sit at or under `base`? */
function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * The free portal: building listings, and the two pages that sell a plan.
 *
 * `/landlord/listings` covers the whole subtree deliberately — the editor,
 * media, location, availability, preview, FAQ and status all live under it and
 * all of them are "manage your property".
 */
export const FREE_LANDLORD_PATHS = [
  '/landlord/listings',
  '/landlord/subscribe',
  '/landlord/billing',
]

export type LockedFeature = {
  /** The nav label, so the screen names the thing they clicked. */
  title: string
  /** What the page does, in the landlord's terms. One sentence. */
  promise: string
  /** The three concrete things behind the lock. Specific, never adjectives. */
  points: string[]
}

/**
 * Paid sections, each with the copy its paywall screen shows.
 *
 * Longest prefix wins, so a more specific child can be given its own copy
 * later without reordering anything.
 */
const PAID_SECTIONS: Array<{ base: string; feature: LockedFeature }> = [
  {
    base: '/landlord/dashboard',
    feature: {
      title: 'Overview',
      promise: 'Your whole portfolio on one screen once your listings are live.',
      points: [
        'Views, inquiries and conversion per property',
        'What needs doing today, ranked',
        'Rent collected, owed and overdue at a glance',
      ],
    },
  },
  {
    base: '/landlord/leads',
    feature: {
      title: 'Leads',
      promise: 'Every student who asks about your place, with full contact details.',
      points: [
        'Name, email, phone and move-in date on every inquiry',
        'Funnel stages with the next follow-up chosen for you',
        'No per-lead charge — however many ask, they are all yours',
      ],
    },
  },
  {
    base: '/landlord/comments',
    feature: {
      title: 'Comments',
      promise: 'Questions students leave on your listing, answered in one place.',
      points: [
        'Public Q&A on each listing',
        'Reply once, every future renter sees the answer',
        'Email alerts when a new question lands',
      ],
    },
  },
  {
    base: '/landlord/calendar',
    feature: {
      title: 'Tours & Calendar',
      promise: 'Students book their own viewings from your real availability.',
      points: [
        'Publish slots; students pick one without messaging you',
        'Calendar invites and reminders sent automatically',
        'Reschedules and no-shows tracked per property',
      ],
    },
  },
  {
    base: '/landlord/roommates',
    feature: {
      title: 'Roommates',
      promise: 'Fill a house by the room without losing track of who goes where.',
      points: [
        'Group applications kept together',
        'Per-room pricing and availability',
        'Rent split worked out for the group',
      ],
    },
  },
  {
    base: '/landlord/background-checks',
    feature: {
      title: 'Screening',
      promise: 'Know who you are signing before you sign.',
      points: [
        'Credit and background checks on every applicant',
        'Employment and previous-landlord reference emails',
        'Income-to-rent scoring, with co-signers handled',
      ],
    },
  },
  {
    base: '/landlord/leases',
    feature: {
      title: 'Leases',
      promise: 'The tenancy record: who lives there, signed documents, move-out.',
      points: [
        'Generate a lease and send it for e-signature',
        'Every document kept on the tenancy',
        'Move-out and deposit return run from the same place',
      ],
    },
  },
  {
    base: '/landlord/tenants',
    feature: {
      title: 'Tenants',
      promise: 'Everyone currently in your properties, in one list.',
      points: [
        'Contact details and lease dates per tenant',
        'Who is paid up and who is behind',
        'Their own portal for rent and documents',
      ],
    },
  },
  {
    base: '/landlord/financials',
    feature: {
      title: 'Financials',
      promise: 'Collect rent online and see exactly what you are owed.',
      points: [
        'Card and bank payments with automatic receipts',
        'Late-fee rules applied and explained to the tenant',
        'Arrears by property and by lease, month by month',
      ],
    },
  },
  {
    base: '/landlord/reminders',
    feature: {
      title: 'Reminders',
      promise: 'Rent reminders and chasers that go out without you.',
      points: [
        'Before-due and overdue emails on a schedule',
        'Delivery, open and bounce state per tenant',
        'One-off nudges when you want to push',
      ],
    },
  },
  {
    base: '/landlord/maintenance',
    feature: {
      title: 'Maintenance',
      promise: 'One work list per property, with what it actually cost.',
      points: [
        'Repairs and upgrades by priority and status',
        'Estimated against actual spend',
        'A per-property history you can hand to an accountant',
      ],
    },
  },
  {
    base: '/landlord/inspections',
    feature: {
      title: 'Move-out',
      promise: 'Move-out reports that make the deposit maths uncontestable.',
      points: [
        'Room-by-room condition with photos',
        'Charges split per tenant, to the cent',
        'A shareable report the tenant can read and print',
      ],
    },
  },
  {
    base: '/landlord/automations',
    feature: {
      title: 'Automations',
      promise: 'The follow-ups and reminders run themselves.',
      points: [
        'Auto-reply to new inquiries',
        'Tour and rent reminder sequences',
        'Triggers on lead stage changes',
      ],
    },
  },
  {
    base: '/landlord/customizations',
    feature: {
      title: 'Customizations',
      promise: 'Make the pages students see look like yours.',
      points: [
        'Branding on your listing pages',
        'Your own copy on inquiry and tour emails',
        'Custom fields on the inquiry form',
      ],
    },
  },
]

/**
 * Paid pages that happen to live inside a free subtree.
 *
 * `/landlord/listings/<slug>/calendar` is the same tour scheduling as
 * `/landlord/calendar`; it would be incoherent for one to be locked and the
 * other open just because of where the route sits. Matched by pattern because
 * the slug is in the middle.
 */
const PAID_WITHIN_FREE: Array<{ test: RegExp; base: string }> = [
  { test: /^\/landlord\/listings\/[^/]+\/calendar(\/|$)/, base: '/landlord/calendar' },
]

/** True when a landlord with no plan may use this path. */
export function isFreeLandlordPath(pathname: string): boolean {
  if (PAID_WITHIN_FREE.some(p => p.test.test(pathname))) return false
  return FREE_LANDLORD_PATHS.some(p => under(pathname, p))
}

/**
 * The paywall copy for a path, or null when the path is free.
 *
 * Unknown `/landlord/*` paths are treated as paid and fall back to generic
 * copy: a page added later should default to the safe side of the line.
 */
export function lockedFeature(pathname: string): LockedFeature | null {
  if (isFreeLandlordPath(pathname)) return null

  // A paid page inside a free subtree borrows the copy of its real section.
  const aliased = PAID_WITHIN_FREE.find(p => p.test.test(pathname))
  const target = aliased?.base ?? pathname

  const match = PAID_SECTIONS
    .filter(s => under(target, s.base))
    .sort((a, b) => b.base.length - a.base.length)[0]
  if (match) return match.feature

  return {
    title: 'This part of the portal',
    promise: 'Building your listings is free. Everything that runs the tenancy needs a plan.',
    points: [
      'Leads, screening and tours',
      'Leases, rent collection and reminders',
      'Maintenance and move-out',
    ],
  }
}

/** For the sidebar: does this nav item need a plan? */
export function navItemLocked(href: string): boolean {
  return !isFreeLandlordPath(href)
}
