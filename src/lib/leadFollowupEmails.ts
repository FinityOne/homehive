/**
 * The automatic follow-up a renter gets two days after they inquire.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * A student fills in the inquiry form, gets the welcome email asking them to
 * pre-screen, and then life happens. Two days later the landlord has an inquiry
 * with no information attached and the student has forgotten which of the six
 * places they messaged this one was. One email fixes both, and nobody has to
 * remember to send it.
 *
 * ── What it will and will not say ─────────────────────────────────────────
 *
 * The hard rule here is that an automatic email may only ask for something the
 * recipient can actually do, and may never claim something on the landlord's
 * behalf. That rules out most of the funnel and leaves exactly two moments:
 *
 *   • `prescreen`    — they inquired and never filled the pre-screen in. The
 *                      pre-screen link is theirs, it works, and finishing it is
 *                      genuinely the thing that moves them up the pile.
 *   • `tour_booking` — they pre-screened, the landlord has already invited them
 *                      to tour, and they never picked a slot. We are chasing an
 *                      invitation that exists, not issuing one.
 *
 * Deliberately absent: a nudge to the lead who pre-screened and was never
 * invited. Only the landlord can extend that invitation — `/book-tour` is gated
 * on `tour_invite_sent_at` precisely so it cannot be self-served — and an email
 * that implied otherwise would be selling a tour nobody has offered. That gap
 * is the landlord's to close, and the Next Best Action engine already puts it
 * in front of them on the lead page.
 *
 * ── Why the ceiling matters as much as the floor ──────────────────────────
 *
 * "Two days after the lead is created" is a floor, and a floor on its own is
 * dangerous: on the day this ships, every lead ever created is more than two
 * days old. Without `MAX_AGE_DAYS` the first run would mail hundreds of people
 * about inquiries they made months ago, which is both useless to them and the
 * fastest way to lose a sending domain. The window closes at a week, so a
 * follow-up is either timely or it is never sent.
 *
 * `chooseFollowup` is pure and holds every one of those rules, so the cron
 * route is left doing nothing but fetching, mailing and claiming, and the rules
 * themselves can be tested without a database or a mail provider
 * (`npm run verify:lead-followups`).
 */
import { emailShell, emailButton, emailChecklist, esc } from '@/lib/emailShell'
import { unsubscribeUrl } from '@/lib/unsubscribeToken'
import type { Lead } from '@/lib/leads'

/** Which funnel gap this email speaks to. Not a sequence — one of each, ever. */
export type FollowupKind = 'prescreen' | 'tour_booking'

/** The opt-out category. Shared list, scoped key — see the migration. */
export const FOLLOWUP_CATEGORY = 'lead_followup'

/** The ticket: two days after the lead is created. */
export const MIN_AGE_DAYS = 2

/**
 * And no later than a week.
 *
 * Past this the email stops being a follow-up and becomes a cold email about a
 * decision the person has already made one way or the other.
 */
export const MAX_AGE_DAYS = 7

/**
 * One follow-up per address per week, across every lead and both kinds.
 *
 * Leads are per *listing*, and a student shopping seriously inquires about four
 * places in an evening. Claiming per lead alone would mail them four times in
 * one morning from the same sender, which reads as a mail loop rather than a
 * helpful nudge. The others stay eligible and get picked up on a later run if
 * they are still inside the window.
 */
export const ADDRESS_COOLDOWN_DAYS = 7

/**
 * Statuses where the landlord has already reached a verdict.
 *
 * `cold` and `closed` are explicit human judgements that this lead is not
 * happening. Re-opening that conversation automatically would undercut the
 * person who made the call — and at present these two are 69% of all leads.
 */
const SETTLED_STATUSES: ReadonlySet<Lead['status']> = new Set(['cold', 'closed'])

export type FollowupContext = {
  /** Days since the lead was created. Null when `created_at` is missing. */
  ageDays: number | null
  status: Lead['status']
  /** Lowercased. Empty or malformed means there is nobody to write to. */
  email: string
  /** Address is syntactically sendable and not a known-dead typo domain. */
  deliverable: boolean
  /** On the shared opt-out list for this category. */
  optedOut: boolean
  hasPrescreen: boolean
  /** The landlord has invited them to tour, so `/book-tour/[leadId]` will open. */
  tourInvited: boolean
  /** A tour that still stands — booked and not cancelled. */
  hasLiveTour: boolean
  /** They have already been round the place. */
  toured: boolean
  /** Unbooked slots in the next 7 days. A tour nudge with none would be a dead end. */
  openTourSlots: number
  /**
   * The listing can still take interest: live, accepting inquiries, not
   * archived, publicly visible. True when the lead has no property attached,
   * since then there is no listing to be wrong about.
   */
  listingAcceptsLeads: boolean
  /** Kinds already sent to this lead. The claim table, as far as this function cares. */
  alreadySent: readonly FollowupKind[]
  /** This address has had a follow-up inside `ADDRESS_COOLDOWN_DAYS`. */
  addressMailedRecently: boolean
}

export type FollowupDecision =
  | { send: true; kind: FollowupKind }
  | { send: false; reason: string }

/**
 * The whole policy, in order.
 *
 * Ordered so the reason reported for a skip is the most informative one: the
 * facts that disqualify a lead outright come before the ones that merely mean
 * "not yet", so a dry run reads as a diagnosis rather than a list of timing
 * misses.
 */
export function chooseFollowup(ctx: FollowupContext): FollowupDecision {
  if (!ctx.email) return { send: false, reason: 'no email address' }
  if (!ctx.deliverable) return { send: false, reason: 'undeliverable address' }
  if (ctx.optedOut) return { send: false, reason: 'opted out' }

  if (ctx.ageDays === null) return { send: false, reason: 'no created_at' }
  if (ctx.ageDays < MIN_AGE_DAYS) return { send: false, reason: 'too new' }
  if (ctx.ageDays > MAX_AGE_DAYS) return { send: false, reason: 'outside the follow-up window' }

  if (SETTLED_STATUSES.has(ctx.status)) return { send: false, reason: `status is ${ctx.status}` }
  if (!ctx.listingAcceptsLeads) return { send: false, reason: 'listing is not taking interest' }

  // A viewing already happened or is on the books: they are past anything this
  // email could usefully ask for, and the tour reminders cron owns the rest.
  if (ctx.toured) return { send: false, reason: 'already toured' }
  if (ctx.hasLiveTour) return { send: false, reason: 'tour already booked' }

  const kind: FollowupKind = ctx.hasPrescreen ? 'tour_booking' : 'prescreen'

  // Only chase an invitation that exists, and only to a page that has slots on
  // it. Both conditions are about the email telling the truth.
  if (kind === 'tour_booking') {
    if (!ctx.tourInvited) return { send: false, reason: 'pre-screened, not yet invited to tour' }
    if (ctx.openTourSlots < 1) return { send: false, reason: 'no open tour slots to offer' }
  }

  if (ctx.alreadySent.includes(kind)) return { send: false, reason: `already sent ${kind}` }
  if (ctx.addressMailedRecently) return { send: false, reason: 'address had a follow-up this week' }

  return { send: true, kind }
}

export type FollowupEmailOpts = {
  kind: FollowupKind
  /** Recipient, used for the signed unsubscribe link. */
  to: string
  firstName: string
  propertyName: string | null
  propertyAddress: string | null
  heroImage: string | null
  landlordFirstName: string | null
  /** Does this listing have answered FAQs worth linking? */
  hasFaqs: boolean
  propertySlug: string | null
  leadId: string
  openTourSlots: number
  site: string
}

/** The footer. The unsubscribe link is the point of it. */
function footer(opts: FollowupEmailOpts): string {
  const unsub = unsubscribeUrl(opts.site, opts.to, FOLLOWUP_CATEGORY)
  return `<p style="margin:22px 0 0;font-size:12px;color:#9b9b9b;line-height:1.65;border-top:1px solid #eee;padding-top:14px;">
      You're getting this because you asked about a home on HomeHive a couple of days ago.
      It's the only reminder we'll send about this one —
      <a href="${unsub}" style="color:#6a6a6a;text-decoration:underline;">unsubscribe</a>
      to stop these entirely. Tour confirmations, lease documents and anything to do with a
      tenancy are unaffected.
    </p>`
}

/** Subject + HTML for one lead's follow-up. */
export function renderFollowupEmail(opts: FollowupEmailOpts): { subject: string; html: string } {
  const first = esc(opts.firstName || 'there')
  const place = opts.propertyName ? esc(opts.propertyName) : 'the place you asked about'
  const bannerSubject = opts.propertyName
    ? [opts.propertyName, opts.propertyAddress].filter(Boolean).join(' · ')
    : 'Your HomeHive inquiry'
  const hero = opts.heroImage ?? undefined
  const heroAlt = opts.propertyName ?? 'The home you asked about'

  // ── They never finished the pre-screen ──────────────────────────────────
  if (opts.kind === 'prescreen') {
    const prescreenUrl = `${opts.site}/pre-screen/${opts.leadId}`
    const listingUrl = opts.propertySlug ? `${opts.site}/homes/${opts.propertySlug}` : null

    return {
      // A question, because it is one. We genuinely do not know, and the honest
      // version gets opened by the people it is for and ignored by the rest.
      subject: opts.propertyName
        ? `Still interested in ${opts.propertyName}, ${opts.firstName || 'there'}?`
        : `${opts.firstName || 'Hi'} — still looking for a place?`,
      html: emailShell({
        banner: 'One step left',
        bannerSubject,
        tone: 'action',
        hero,
        heroAlt,
        body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${first},</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 18px;">
      You asked about <strong>${place}</strong> a couple of days ago${
        opts.landlordFirstName ? ` and ${esc(opts.landlordFirstName)} has your inquiry` : ''
      }. It's still sitting there without your pre-screen, which is the part that actually
      tells ${opts.landlordFirstName ? esc(opts.landlordFirstName) : 'the landlord'} whether
      you're a fit — budget, move-in date, how many of you there are.
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:13px 16px;margin-bottom:20px;font-size:13px;color:#92400e;line-height:1.6;">
      Pre-screened applicants get looked at first, because they're the only ones a landlord
      can say yes to without a phone call. It takes about two minutes.
    </div>
    <div style="margin-bottom:18px;">
      ${emailChecklist([
        'A little about you',
        'Your move-in date and group size',
        'Budget and lifestyle fit',
      ], '#FFC627')}
    </div>
    <div style="margin-bottom:10px;">${emailButton({ label: 'Finish my pre-screen', url: prescreenUrl })}</div>
    ${listingUrl ? `<div>${emailButton({ label: 'See the home again', url: listingUrl, secondary: true })}</div>` : ''}
    ${
      opts.hasFaqs && opts.propertySlug
        ? `<p style="margin:18px 0 0;font-size:13px;color:#4a4a4a;line-height:1.6;">
      Questions first? <a href="${opts.site}/homes/${opts.propertySlug}/faq" style="color:#8C1D40;font-weight:600;">The FAQ</a>
      covers utilities, parking, lease terms and what's included.
    </p>`
        : ''
    }
    <p style="margin:18px 0 0;font-size:13px;color:#9b9b9b;line-height:1.6;">
      Already found somewhere else? That's genuinely fine — ignore this and we'll leave you be.
    </p>
    ${footer(opts)}`,
      }),
    }
  }

  // ── Invited to tour, never picked a time ────────────────────────────────
  const bookingUrl = `${opts.site}/book-tour/${opts.leadId}`
  const slots = opts.openTourSlots
  const inviter = opts.landlordFirstName ? esc(opts.landlordFirstName) : 'The landlord'

  return {
    subject: opts.propertyName
      ? `${opts.firstName || 'Hi'} — your tour of ${opts.propertyName} isn't booked yet`
      : `${opts.firstName || 'Hi'} — your tour isn't booked yet`,
    html: emailShell({
      banner: 'Tour invitation open',
      bannerSubject,
      tone: 'action',
      hero,
      heroAlt,
      body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${first},</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 18px;">
      ${inviter} invited you to come and see <strong>${place}</strong>, and the invitation is
      still open — you just haven't picked a time. Nothing is held for you until you do.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:13px 16px;margin-bottom:20px;font-size:13px;color:#166534;line-height:1.6;">
      <strong>${slots === 1 ? '1 slot is' : `${slots} slots are`} open in the next week.</strong>
      They're first-come, and whoever books is who gets seen.
    </div>
    <div style="margin-bottom:10px;">${emailButton({ label: 'Choose my tour time', url: bookingUrl })}</div>
    <p style="margin:18px 0 0;font-size:13px;color:#9b9b9b;line-height:1.6;">
      None of the times work, or you've changed your mind? Reply to this email and tell us —
      ${opts.landlordFirstName ? `${esc(opts.landlordFirstName)} would far rather know` : 'the landlord would far rather know'}
      than hold a slot for someone who isn't coming.
    </p>
    ${footer(opts)}`,
    }),
  }
}
