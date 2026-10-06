/**
 * The email a landlord gets when their listing clears review.
 *
 * There are two versions of this news and sending the wrong one is a lie the
 * landlord will catch within a minute:
 *
 *   • `live`       — approved AND their plan is paid, so students can see it.
 *   • `needs_plan` — approved, but nothing is published until they subscribe.
 *
 * The old copy only had the first version and said "now visible to students"
 * unconditionally. Under the paywall that is false for anyone without a plan,
 * and a landlord who gets that email, clicks through, and finds their listing
 * hidden has been told something untrue by us on day one.
 *
 * The `needs_plan` version is also the single best conversion moment on the
 * platform — the landlord has already done the work of writing the listing, so
 * the ask is "publish what you already built", not "buy something". It carries
 * the real demand numbers because at that moment they are the argument.
 */
import { Resend } from 'resend'
import { getSiteUrl } from '@/lib/siteUrl'
import { logEmail } from '@/lib/emailLog'
import {
  emailShell,
  emailButton,
  emailChecklist,
  emailStatRow,
  esc,
} from '@/lib/emailShell'
import { formatCount, formatFloor, type PlatformStats } from '@/lib/platformStats'
import { PLANS, formatMonthly } from '@/lib/landlordPlans'

export type ListingEmailState = 'live' | 'needs_plan'

export type ListingLiveEmailOpts = {
  to: string
  propertyName: string
  propertySlug: string
  state: ListingEmailState
  /** Real platform demand, for the persuasion block. Omit to skip it. */
  stats?: PlatformStats
}

/**
 * The demand block. Three numbers, each one literally true and checkable.
 *
 * `topListingLeads` is labelled as the best a single listing has done, never as
 * what this landlord should expect — the distinction is the difference between
 * a real number and a false promise, and it is also more persuasive, because a
 * specific verifiable claim survives scepticism that an average does not.
 */
function demandBlock(stats: PlatformStats): string {
  const cells: Array<[string, string]> = []
  if (stats.topListingLeads > 0) cells.push(['Most inquiries one listing has received', formatCount(stats.topListingLeads)])
  if (stats.distinctRenters > 0) cells.push(['ASU & Tempe renters who have inquired', formatFloor(stats.distinctRenters)])
  if (stats.siteVisits > 0)      cells.push(['Listing views on HomeHive', formatFloor(stats.siteVisits)])
  return emailStatRow(cells)
}

export function renderListingLiveEmail(opts: ListingLiveEmailOpts): { subject: string; html: string } {
  const site = getSiteUrl()
  const name = esc(opts.propertyName)
  const portalUrl = `${site}/landlord/listings/${opts.propertySlug}`
  const publicUrl = `${site}/homes/${opts.propertySlug}`
  const stats = opts.stats

  if (opts.state === 'live') {
    return {
      subject: `"${opts.propertyName}" is live on HomeHive 🎉`,
      html: emailShell({
        banner: 'Approved & Live',
        bannerSubject: opts.propertyName,
        tone: 'good',
        body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your listing is live.</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      <strong>${name}</strong> is approved and visible to students browsing HomeHive right now.
      Inquiries land straight in your portal — you will get an email for each one.
    </p>
    ${stats ? demandBlock(stats) : ''}
    <div style="background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:16px 20px;margin-bottom:22px;">
      <div style="font-size:12px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:11px;">Worth doing in the first week</div>
      ${emailChecklist([
        'Add six or more photos — listings with photos get noticeably more inquiries',
        'Set your tour availability so students can book themselves in',
        'Answer the FAQ section — it cuts the back-and-forth before a tour',
      ])}
    </div>
    <div style="margin-bottom:10px;">${emailButton({ label: 'Open your listing', url: portalUrl })}</div>
    <div>${emailButton({ label: 'See the public page', url: publicUrl, secondary: true })}</div>`,
      }),
    }
  }

  // needs_plan
  const starter = PLANS.starter
  return {
    subject: `"${opts.propertyName}" is approved — one step from going live`,
    html: emailShell({
      banner: 'Approved — ready to publish',
      bannerSubject: opts.propertyName,
      tone: 'action',
      body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your listing is approved. It is not published yet.</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      <strong>${name}</strong> has cleared review and is ready to go out to students.
      Publishing it needs an active plan — from ${esc(formatMonthly(starter.priceCents))} — and
      it goes live the moment you have one. Nothing else is left to do.
    </p>
    ${stats ? demandBlock(stats) : ''}
    <p style="font-size:13.5px;color:#4a4a4a;line-height:1.7;margin:0 0 8px;">
      <strong>HomeHive is ASU and Tempe only.</strong> Every renter on the platform is
      looking for housing near campus, so your listing is not competing for attention
      with the whole metro — it reaches the students who can actually sign.
    </p>
    <div style="background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:16px 20px;margin:20px 0 22px;">
      <div style="font-size:12px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:11px;">What your plan covers</div>
      ${emailChecklist([
        'Your listing live to every student browsing HomeHive',
        'Unlimited inquiries — no per-lead charges, ever',
        'Tenant screening, background and reference checks',
        'Tours, leases, e-signature and online rent collection',
      ])}
    </div>
    <div style="margin-bottom:10px;">${emailButton({ label: 'Publish my listing', url: `${site}/landlord/subscribe` })}</div>
    <div>${emailButton({ label: 'Review my listing first', url: portalUrl, secondary: true })}</div>
    <p style="margin:18px 0 0;font-size:12.5px;color:#9b9b9b;line-height:1.6;">
      Month to month, cancel any time. Students never pay to use HomeHive.
    </p>`,
    }),
  }
}

/** Send it, and record it in the email log. Never throws. */
export async function sendListingLiveEmail(opts: ListingLiveEmailOpts): Promise<void> {
  if (!opts.to) return
  if (!process.env.RESEND_API_KEY) {
    console.warn('[listingEmails] RESEND_API_KEY missing — not sending')
    return
  }

  const { subject, html } = renderListingLiveEmail(opts)

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: opts.to,
      subject,
      html,
    })
    await logEmail(
      '',
      opts.state === 'live' ? 'listing_approved' : 'listing_awaiting_plan',
      subject,
      opts.to,
      { propertySlug: opts.propertySlug, state: opts.state },
    )
  } catch (err) {
    // A listing going live must not fail because an email bounced.
    console.error('[listingEmails] send failed:', err)
  }
}
