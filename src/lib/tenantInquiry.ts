/**
 * An inquiry, worded for the person who made it.
 *
 * The tenant dashboard used to label every live inquiry "Pending Review" and
 * every dead one "Closed", from a status field that actually carries seven
 * distinct states. So a renter whose landlord had replied, screened them and
 * booked a tour saw the same five words as one whose form went nowhere — and
 * the one state they most need to recognise, "this one is finished", gave no
 * hint whether they got the place or lost it.
 *
 * The mapping is deliberately *not* the landlord's. The funnel labels in
 * `overviewModel.ts` are sales vocabulary about a person — "Qualified",
 * "Cold", "Engaged" — and none of it is sayable to that person's face. A
 * renter is told what has happened and, where there is one, what moves it on.
 *
 * `tour_scheduled` is a legacy status kept for existing records (see
 * `src/lib/leads.ts`), and it is the one status a tenant can read directly off
 * the lead row, so it survives here as its own case.
 */

export type InquiryStatus =
  | 'new' | 'contacted' | 'follow_up' | 'engaged' | 'qualified'
  | 'matching' | 'cold' | 'tour_scheduled' | 'closed'

export type InquiryTone = 'idle' | 'accent' | 'paid' | 'owed' | 'fee'

export type InquiryView = {
  /** What has happened, in the renter's own terms. */
  label: string
  tone: InquiryTone
  /** One sentence of context, or null when the label says it all. */
  detail: string | null
}

/**
 * `closed_reason` decides what "closed" means, and it means opposite things.
 * `leased` is the happy ending — in most cases it is *this* renter's lease —
 * and conflating it with `lost` tells someone who just signed that their
 * inquiry failed.
 */
export function inquiryView(
  status: InquiryStatus | string,
  closedReason?: 'leased' | 'lost' | null,
): InquiryView {
  switch (status) {
    case 'new':
      return {
        label: 'Sent',
        tone: 'accent',
        detail: 'The landlord has your inquiry and has not replied yet.',
      }
    case 'contacted':
    case 'follow_up':
      return {
        label: 'Landlord replied',
        tone: 'accent',
        detail: 'Check your email — replies come from the landlord directly.',
      }
    case 'engaged':
      return {
        label: 'In conversation',
        tone: 'accent',
        detail: null,
      }
    case 'qualified':
      return {
        label: 'Moving forward',
        tone: 'paid',
        detail: 'The landlord is treating this as a serious application.',
      }
    case 'tour_scheduled':
      return {
        label: 'Tour booked',
        tone: 'paid',
        detail: null,
      }
    case 'matching':
      return {
        label: 'Finding you a room',
        tone: 'accent',
        detail: 'This home is full, so the landlord is matching you to another.',
      }
    case 'cold':
      return {
        label: 'Gone quiet',
        tone: 'fee',
        detail: 'Nothing has moved in a while. Messaging again usually restarts it.',
      }
    case 'closed':
      if (closedReason === 'leased') {
        return { label: 'Leased', tone: 'paid', detail: 'This home has been let.' }
      }
      return {
        label: 'Closed',
        tone: 'idle',
        detail: 'This one is finished. Nothing more is needed from you.',
      }
    default:
      return { label: 'Sent', tone: 'accent', detail: null }
  }
}

/** True while the renter could still end up living there. */
export function isLiveInquiry(status: string): boolean {
  return status !== 'closed' && status !== 'cold'
}
