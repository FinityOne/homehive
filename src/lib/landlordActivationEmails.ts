/**
 * The emails that go to a landlord who signed up and then stopped.
 *
 * ── Who these are for ──────────────────────────────────────────────────────
 *
 * Two groups, and conflating them would waste the better one:
 *
 *   • `dormant_listing` — they added a property and it is sitting invisible,
 *     because public visibility is gated on an active plan. These are the hot
 *     ones. They have already done the work; the only thing between their place
 *     and the students browsing for it is a plan they have not picked. The
 *     email's job is to tell them that, because most of them do not know it —
 *     a listing that looks finished in the portal does not announce that it is
 *     hidden from the site.
 *
 *   • `no_property` — they signed up and never added anything. Nothing to
 *     rescue, so the email has to make the case from demand instead.
 *
 * ── Why the numbers are counted, never written ─────────────────────────────
 *
 * Every figure comes from `getPlatformStats`. A landlord deciding whether to
 * spend money is owed the real demand, and "hundreds of students!" is both
 * unfalsifiable and the kind of claim that makes a careful person close the
 * tab. The honest version is stronger anyway: on this platform one listing has
 * taken 126 inquiries, and only a handful of places are live to absorb them.
 * That is a genuinely good reason to list, and it needs no inflation.
 *
 * Where a figure is missing or zero the line is dropped rather than shown as a
 * zero — `emailStatRow` of nothing renders nothing. The pitch gets quieter in a
 * quiet month, which is the only version of it we can defend.
 *
 * ── Why three steps and then silence ──────────────────────────────────────
 *
 * One email gets missed. Five is harassment. Three, a fortnight apart, each
 * saying something the last one did not, is the most that can be sent to
 * someone who has not asked to hear from us — and after step 3 the sequence
 * ends permanently rather than looping. Every one carries a working
 * one-click unsubscribe, which is not decoration: this is the only
 * non-transactional mail the app sends.
 */
import {
  emailShell,
  emailButton,
  emailChecklist,
  emailStatRow,
  esc,
} from '@/lib/emailShell'
import { formatCount, formatFloor, type PlatformStats } from '@/lib/platformStats'
import { PLANS, formatMonthly, smallestTierFor } from '@/lib/landlordPlans'
import { unsubscribeUrl } from '@/lib/unsubscribeToken'

/** Which conversation this landlord is in. */
export type ActivationKind = 'no_property' | 'dormant_listing'

/** How far through the sequence. 3 is the last they will ever get. */
export type ActivationStep = 1 | 2 | 3

export const ACTIVATION_CATEGORY = 'landlord_activation'

/** Days between steps. A fortnight: long enough not to nag, short enough to land in the same season. */
export const STEP_GAP_DAYS = 14

/** The last step in the sequence. Nothing is sent after it. */
export const FINAL_STEP: ActivationStep = 3

export type ActivationEmailOpts = {
  to: string
  firstName: string
  kind: ActivationKind
  step: ActivationStep
  site: string
  stats: PlatformStats
  /** `dormant_listing` only: the place that is sitting hidden. */
  propertyName?: string | null
  /** `dormant_listing` only: how many properties of theirs are invisible. */
  hiddenCount?: number
  /** Inquiries their own listings have already taken, if any. Nothing invented. */
  ownLeads?: number
}

/**
 * Trim to fit a subject line, at a word boundary where there is one.
 *
 * An ellipsis mid-word reads as a bug; cutting at the last space before the
 * limit reads as a name that happens to be long.
 */
function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.\/-]+$/, '')}…`
}

/**
 * The demand figures, as a stat row.
 *
 * Framed per-listing rather than per-platform wherever possible. A landlord
 * does not care how many renters we have; they care what one place like theirs
 * can pull, which is what `topListingLeads` answers.
 */
function demandCells(stats: PlatformStats): Array<[string, string]> {
  const cells: Array<[string, string]> = []
  if (stats.topListingLeads) cells.push(['Inquiries one HomeHive listing has taken', formatCount(stats.topListingLeads)])
  if (stats.distinctRenters) cells.push(['ASU & Tempe renters who have inquired', formatFloor(stats.distinctRenters)])
  if (stats.siteVisits) cells.push(['Listing views so far', formatFloor(stats.siteVisits)])
  return cells
}

/**
 * The supply line — and the one claim here that needs care.
 *
 * Thin supply is the real opportunity on this platform and worth saying plainly,
 * but only while it is true. Above a dozen live listings it stops being
 * "hardly any competition" and the sentence is dropped rather than stretched.
 */
function scarcityLine(stats: PlatformStats): string {
  const n = stats.liveListings
  if (!n || n > 12) return ''
  const places = n === 1 ? 'one place' : `only ${formatCount(n)} places`
  return `<p style="font-size:13.5px;color:#4a4a4a;line-height:1.7;margin:0 0 18px;">
      There ${n === 1 ? 'is' : 'are'} <strong>${places}</strong> live on HomeHive right now. Every student
      searching for housing near campus is looking at that short list — which is a far better
      place to be than page four of a national rental site.
    </p>`
}

/**
 * The cheapest plan that actually fits them — not always the cheapest plan.
 *
 * Starter covers one property. Pitching it at a landlord with two in the portal
 * quotes a price that cannot do what the email is asking them to do, and they
 * find that out at the checkout. `smallestTierFor` picks the real floor, so the
 * figure in the email is the figure they will pay.
 */
function planBlock(propertyCount: number): string {
  const starter = PLANS[smallestTierFor(Math.max(1, propertyCount))]
  return `<div style="background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:16px 20px;margin-bottom:22px;">
      <div style="font-size:12px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${propertyCount > 1 ? 'The cheapest plan that fits' : 'The cheapest way on'}</div>
      <div style="font-size:19px;font-weight:800;color:#1a1a1a;letter-spacing:-0.4px;margin-bottom:3px;">${esc(starter.name)} — ${esc(formatMonthly(starter.priceCents))}</div>
      <div style="font-size:12.5px;color:#6a6a6a;margin-bottom:13px;">${esc(starter.tagline)} Month to month, cancel any time.</div>
      ${emailChecklist([
        'Your place live to every student browsing HomeHive',
        '<strong>Unlimited inquiries</strong> — no per-lead fees, nothing to unlock',
        'Tenant screening, background and reference checks',
        'Tours students book themselves, straight into your calendar',
        'Leases, e-signature and online rent collection',
      ])}
    </div>`
}

/** The footer. The unsubscribe link is the point of it. */
function footer(opts: ActivationEmailOpts): string {
  const unsub = unsubscribeUrl(opts.site, opts.to, ACTIVATION_CATEGORY)
  return `<p style="margin:20px 0 0;font-size:12px;color:#9b9b9b;line-height:1.65;border-top:1px solid #eee;padding-top:14px;">
      You're getting this because you created a landlord account on HomeHive.
      ${opts.step === FINAL_STEP
        ? `This is the last email we'll send about getting listed.`
        : `Not planning to list?`}
      <a href="${unsub}" style="color:#6a6a6a;text-decoration:underline;">Unsubscribe</a>
      and we'll stop. Rent receipts, leases and anything to do with a tenancy are unaffected.
    </p>`
}

/** Subject + HTML for one landlord at one step. */
export function renderActivationEmail(opts: ActivationEmailOpts): { subject: string; html: string } {
  const first = esc(opts.firstName || 'there')
  const site = opts.site
  const stats = opts.stats
  const cells = demandCells(stats)
  const subscribe = `${site}/landlord/subscribe`

  // ── The listing exists and nobody can see it ──────────────────────────────
  if (opts.kind === 'dormant_listing') {
    const name = opts.propertyName ? esc(opts.propertyName) : 'Your property'
    const many = (opts.hiddenCount ?? 1) > 1
    // A subject line is plain text, so it takes the raw name — escaping here
    // would put a literal "&amp;" in the inbox for "Palm & Ash".
    //
    // And it takes a *short* one. These names run long ("Spacious 1 Bed/ 1 Bath
    // Apartment Near Arizona State University"), and an inbox shows about sixty
    // characters, so the un-truncated version pushes the actual point of the
    // subject off the end of the line. With more than one hidden property the
    // name is the wrong subject anyway — the count is.
    const subjectName = many
      ? `your ${opts.hiddenCount} listings`
      : shorten(opts.propertyName?.trim() || 'your listing', 26)

    const isAre = many ? 'are' : 'is'
    // The hook goes first. An inbox shows roughly sixty characters and a phone
    // far fewer, so a subject that opens with a long property name spends its
    // whole visible width on something the recipient already knows, and the
    // part that would make them open it — that nobody can see the place — gets
    // truncated away. Name second, news first.
    const subject =
      opts.step === 1
        ? `Students can't see ${subjectName} yet`
      // Never let a zero into a subject line — "0 renters are searching" is the
      // worst sentence we could send a landlord we are asking for money.
      : opts.step === 2 ? (stats.distinctRenters
          ? `${formatFloor(stats.distinctRenters)} renters searching — ${subjectName} ${isAre} still hidden`
          : `${subjectName} ${isAre} still hidden from students`)
      : `Last note about ${subjectName}`

    const lede =
      opts.step === 1
        ? `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      You've already done the hard part — ${many ? 'your properties are' : `<strong>${name}</strong> is`}
      set up in your portal, details and all. There's one thing left that you may not realise:
      <strong>${many ? 'they aren\'t' : 'it isn\'t'} visible on the public site.</strong>
      Listings go live to students once there's an active plan on the account, so right now
      ${many ? 'they\'re' : 'it\'s'} finished but private.
    </p>`
        : opts.step === 2
        ? `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      Quick follow-up, because this one is a shame: <strong>${name}</strong> is sitting complete in
      your portal and still isn't showing to anyone searching. Meanwhile the inquiries below are
      going to the handful of places that are live. Nothing about your listing needs more work —
      it just needs switching on.
    </p>`
        : `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      I won't keep emailing about this. <strong>${name}</strong> is still set up and still hidden,
      and if the timing isn't right — place already let, plans changed — that's completely fair and
      this is the last you'll hear about it. If it is just that nobody switched it on,
      it's ${esc(formatMonthly(PLANS[smallestTierFor(Math.max(1, opts.hiddenCount ?? 1))].priceCents))} and about a minute's work.
    </p>`

    const ownLeadsLine =
      opts.ownLeads && opts.ownLeads > 0
        ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:13px 16px;margin-bottom:20px;font-size:13px;color:#92400e;line-height:1.6;">
      <strong>${formatCount(opts.ownLeads)} ${opts.ownLeads === 1 ? 'student has' : 'students have'} already inquired about your place</strong>
      through HomeHive. Those inquiries are waiting in your portal.
    </div>`
        : ''

    return {
      subject,
      html: emailShell({
        banner: 'Your listing is hidden',
        bannerSubject: many ? `${opts.hiddenCount} properties not visible to students` : name,
        tone: 'action',
        body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${first},</p>
    ${lede}
    ${ownLeadsLine}
    ${emailStatRow(cells)}
    ${opts.step === 1 ? scarcityLine(stats) : ''}
    ${planBlock(opts.hiddenCount ?? 0)}
    <div style="margin-bottom:10px;">${emailButton({ label: many ? 'Make my listings visible' : 'Make my listing visible', url: subscribe })}</div>
    <div>${emailButton({ label: 'Open my portal', url: `${site}/landlord/dashboard`, secondary: true })}</div>
    ${footer(opts)}`,
      }),
    }
  }

  // ── Signed up, never listed anything ─────────────────────────────────────
  const subject =
    opts.step === 1
      ? stats.distinctRenters
        ? `${formatFloor(stats.distinctRenters)} ASU renters are looking — your place isn't listed`
        : `Your place isn't listed on HomeHive yet`
      : opts.step === 2
      ? stats.topListingLeads
        ? `One HomeHive listing took ${formatCount(stats.topListingLeads)} inquiries`
        : `Still worth listing your place near campus`
      : `Last note — listing your place on HomeHive`

  const lede =
    opts.step === 1
      ? `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      You made a landlord account on HomeHive but haven't put a place up yet, so I wanted to
      show you what you're sitting out of. These are our real numbers, not a projection —
      every one of them is counted from the platform as it stands today. Building the
      listing costs nothing, so it is worth the ten minutes either way.
    </p>`
      : opts.step === 2
      ? (stats.topListingLeads
        ? `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      One thing worth knowing if you're weighing this up: the best-performing listing on
      HomeHive has taken <strong>${formatCount(stats.topListingLeads)} inquiries</strong>.
      Not the platform total — one property. Students near campus search a short list of places
      and inquire on most of them, so being on that list is most of the battle.
    </p>`
        // No listing has taken an inquiry yet, so there is no hero number to
        // quote. Make the honest argument instead of a hollow one.
        : `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      One thing worth knowing if you're weighing this up: students near campus search a short
      list of places and inquire on most of them. Being on that list is most of the battle,
      and right now the list is short.
    </p>`)
      : `<p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      This is the last one of these I'll send. If you're not renting out a place near ASU right
      now, ignore it with my blessing. If you are, and the only thing stopping you was
      not getting round to it: building the listing is free and takes a few minutes. It is
      only ${esc(formatMonthly(PLANS.starter.priceCents))} a month when you want students
      to see it, cancelled whenever you like.
    </p>`

  return {
    subject,
    html: emailShell({
      banner: opts.step === FINAL_STEP ? 'Last reminder' : 'Your place isn\'t listed yet',
      bannerSubject: 'Students are searching near ASU',
      tone: 'action',
      body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${first},</p>
    ${lede}
    ${emailStatRow(cells)}
    ${scarcityLine(stats)}
    <p style="font-size:13.5px;color:#4a4a4a;line-height:1.7;margin:0 0 18px;">
      <strong>HomeHive is ASU and Tempe only, on purpose.</strong> Everyone searching here wants
      housing near campus this year, so your place reaches students who can actually sign a
      lease — not a general rental audience three states away.
    </p>
    ${planBlock(0)}
    <div style="margin-bottom:10px;">${emailButton({ label: 'Add my place — free', url: `${site}/landlord/listings/new` })}</div>
    <div>${emailButton({ label: 'See the plans', url: subscribe, secondary: true })}</div>
    ${footer(opts)}`,
    }),
  }
}
