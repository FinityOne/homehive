// Landlord-controlled listing status.
//
// Three independent axes govern whether a listing is public:
//   • admin_status / is_active — HomeHive's moderation state (landlord can't set it)
//   • listing_status + flags   — the landlord's own market state (this file)
//   • owner_plan_active        — is the landlord's plan paid? (set by trigger)
//
// A listing is only ever public when ALL THREE agree. Everything here is pure
// so the landlord UI, the public queries and the API guards share one
// definition.
//
// The plan axis is the newest and the one most likely to surprise: a listing
// can be perfectly valid, approved and set to Live, and still be invisible
// because the card failed. The landlord UI has to say so plainly rather than
// leaving them to wonder why nobody is inquiring, which is what
// describeVisibility() is for.

export type ListingStatus = 'active' | 'rented' | 'inactive'

/** The subset of a property this module reasons about. */
export type StatusFields = {
  listing_status: ListingStatus
  marketing_enabled: boolean
  accepting_inquiries: boolean
  show_when_rented: boolean
  admin_status?: string
  archived_at?: string | null
  /**
   * Whether the owner's plan is paid. Optional so callers that genuinely do not
   * know (and only care about the landlord's own axis) can omit it — when it is
   * undefined the plan is assumed fine rather than assumed broken, so a missing
   * field never shows a landlord a paywall warning that is not real.
   */
  owner_plan_active?: boolean
}

export type StatusMeta = {
  label: string
  /** One-line answer to "what does this do?" — shown under the option. */
  blurb: string
  /** Longer tooltip copy for the ⓘ affordance. */
  tooltip: string
  icon: string
  color: string
  bg: string
  border: string
}

export const LISTING_STATUS_META: Record<ListingStatus, StatusMeta> = {
  active: {
    label: 'Live',
    blurb: 'Visible everywhere and taking inquiries.',
    tooltip:
      'Your listing shows on the HomeHive homepage and in student search results, and renters can send you inquiries. This is the only status that generates new leads.',
    icon: '●',
    color: '#065f46',
    bg: '#ecfdf5',
    border: '#6ee7b7',
  },
  rented: {
    label: 'Rented',
    blurb: 'Leased — pulled from search. Optional waitlist.',
    tooltip:
      'Marks the home as leased. It comes off the homepage and search results so you stop getting dead-end inquiries. You can keep the page live with a "Rented" badge to collect a waitlist for your next opening — students who ask early are your cheapest future leads.',
    icon: '✓',
    color: '#1e40af',
    bg: '#eff6ff',
    border: '#93c5fd',
  },
  inactive: {
    label: 'Inactive',
    blurb: 'Off-market — hidden from everyone.',
    tooltip:
      'Takes the listing fully off the market: hidden from the homepage, search, and its direct link. Nothing is deleted — your photos, leads and history are kept, and switching back to Live restores the listing instantly.',
    icon: '○',
    color: '#475569',
    bg: '#f8fafc',
    border: '#cbd5e1',
  },
}

export const LISTING_STATUS_ORDER: ListingStatus[] = ['active', 'rented', 'inactive']

export const MARKETING_TOOLTIP =
  'Promotion controls where HomeHive pushes your listing: the homepage, featured slots, and the sitemap search engines crawl. Turn it off to keep the listing quietly searchable — useful when you have enough interest and just want the page up.'

export const INQUIRIES_TOOLTIP =
  'Controls the "Request info" form on your listing page. Turn it off to keep the listing browsable while you work through the leads you already have. Existing conversations are unaffected.'

/** Is this status one a public visitor could ever see? */
export function isPublicStatus(p: Pick<StatusFields, 'listing_status' | 'show_when_rented'>): boolean {
  if (p.listing_status === 'active') return true
  if (p.listing_status === 'rented') return !!p.show_when_rented
  return false
}

/** Should this listing appear on promotional surfaces (homepage, sitemap)? */
export function isMarketable(p: Pick<StatusFields, 'listing_status' | 'show_when_rented' | 'marketing_enabled'>): boolean {
  return isPublicStatus(p) && !!p.marketing_enabled && p.listing_status === 'active'
}

/** Can a visitor inquire about moving in now? */
export function acceptsInquiries(p: Pick<StatusFields, 'listing_status' | 'accepting_inquiries'>): boolean {
  return p.listing_status === 'active' && !!p.accepting_inquiries
}

/** Rented, but kept public to gather interest for the next opening. */
export function acceptsWaitlist(p: Pick<StatusFields, 'listing_status' | 'show_when_rented'>): boolean {
  return p.listing_status === 'rented' && !!p.show_when_rented
}

/** Whether /api/leads should accept a submission for this listing at all. */
export function canReceiveLeads(
  p: Pick<StatusFields, 'listing_status' | 'accepting_inquiries' | 'show_when_rented'>
): boolean {
  return acceptsInquiries(p) || acceptsWaitlist(p)
}

/** Is the owner's plan paid? Unknown (undefined) is treated as fine, not broken. */
export function hasActivePlan(p: Pick<StatusFields, 'owner_plan_active'>): boolean {
  return p.owner_plan_active === undefined || p.owner_plan_active === true
}

/**
 * `is_active` is the column the public RLS policy and every legacy query keys
 * off, so it must stay derived from both of the axes a *write* can know about:
 * approved by HomeHive AND live per the landlord. Recomputed on every landlord
 * status write.
 *
 * The plan axis is deliberately NOT folded in here. A plan lapses without
 * anybody writing to the property row, so a value computed at write time would
 * be wrong the moment it mattered most. `owner_plan_active` is maintained by
 * trigger and filtered separately by the public queries for exactly that
 * reason — see PUBLIC_STATUS_FILTER in properties.ts.
 */
export function computeIsActive(
  p: Pick<StatusFields, 'listing_status' | 'show_when_rented'> & { admin_status?: string }
): boolean {
  return p.admin_status === 'active' && isPublicStatus(p)
}

/**
 * The three surfaces a landlord actually cares about, resolved for the current
 * settings. Drives the "Where it shows" summary in the portal.
 */
export type VisibilityRow = { surface: string; visible: boolean; note: string }

export function describeVisibility(p: StatusFields): VisibilityRow[] {
  const approved = p.admin_status === undefined || p.admin_status === 'active'
  const archived = !!p.archived_at
  const unpaid = !hasActivePlan(p)
  const gated = !approved || archived || unpaid

  // Order matters: the plan is named last but checked first in the message,
  // because it is the only one of the three the landlord can fix in a minute,
  // and telling them "under review" when the real problem is an expired card
  // sends them to wait for us instead of to their billing page.
  const gateNote = unpaid
    ? 'Add a plan to publish — your listing is ready'
    : archived
      ? 'Archived for inactivity — re-activate to restore'
      : approved
        ? ''
        : p.admin_status === 'rejected'
          ? 'Not approved — contact us to resolve'
          : 'Under HomeHive review'

  const publicPage = isPublicStatus(p)
  const inSearch = p.listing_status === 'active' || (p.listing_status === 'rented' && p.show_when_rented)
  const onHome = isMarketable(p)

  return [
    {
      surface: 'Homepage',
      visible: !gated && onHome,
      note: gated
        ? gateNote
        : onHome
          ? 'Featured in the student browsing feed'
          : p.listing_status !== 'active'
            ? 'Only Live listings are promoted'
            : 'Promotion is off',
    },
    {
      surface: 'Search results',
      visible: !gated && inSearch,
      note: gated
        ? gateNote
        : inSearch
          ? p.listing_status === 'rented'
            ? 'Shown with a Rented badge'
            : 'Students can find it by browsing and filtering'
          : 'Hidden from browse and filters',
    },
    {
      surface: 'Direct link',
      visible: !gated && publicPage,
      note: gated
        ? gateNote
        : publicPage
          ? acceptsInquiries(p)
            ? 'Page opens and accepts inquiries'
            : acceptsWaitlist(p)
              ? 'Page opens and collects waitlist interest'
              : 'Page opens, inquiry form hidden'
          : 'Link shows "no longer available"',
    },
  ]
}
