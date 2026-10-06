/**
 * The email a tenant gets when their request for landlord access is approved.
 *
 * This is the handover from "renter who owns a place" to "landlord", and it has
 * one job: tell them exactly what to do next. Previously it said they could
 * "create and list your property for free", which stopped being true when the
 * portal went paid — so the email now names the plan up front rather than
 * letting them discover the paywall after logging in. Being told the price in
 * the approval email is a far better experience than finding it behind a door
 * you were just handed the key to.
 *
 * It leads with demand rather than features, because the question they are
 * actually asking is "will anyone see my place", not "what buttons do I get".
 */
import { Resend } from 'resend'
import { getSiteUrl } from '@/lib/siteUrl'
import {
  emailShell,
  emailButton,
  emailChecklist,
  emailStatRow,
  esc,
} from '@/lib/emailShell'
import { formatCount, formatFloor, type PlatformStats } from '@/lib/platformStats'
import { PLANS, formatMonthly } from '@/lib/landlordPlans'

export type UpgradeApprovedEmailOpts = {
  to: string
  /** Their first name, or "there". */
  firstName: string
  /** Optional note the reviewing admin left. */
  note?: string | null
  /** True when they already have a paid plan — then there is nothing to sell. */
  hasPlan?: boolean
  stats?: PlatformStats
}

export function renderUpgradeApprovedEmail(opts: UpgradeApprovedEmailOpts): { subject: string; html: string } {
  const site = getSiteUrl()
  const first = esc(opts.firstName || 'there')
  const starter = PLANS.starter
  const stats = opts.stats

  const cells: Array<[string, string]> = []
  if (stats?.topListingLeads) cells.push(['Most inquiries one listing has received', formatCount(stats.topListingLeads)])
  if (stats?.distinctRenters) cells.push(['ASU & Tempe renters who have inquired', formatFloor(stats.distinctRenters)])
  if (stats?.siteVisits)      cells.push(['Listing views on HomeHive', formatFloor(stats.siteVisits)])

  const note = opts.note?.trim()
  const noteBlock = note
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#166534;line-height:1.55;"><strong>Note from our team:</strong> ${esc(note)}</div>`
    : ''

  // Already paying — send them straight to the listing form, sell nothing.
  if (opts.hasPlan) {
    return {
      subject: `You're approved to list on HomeHive 🎉`,
      html: emailShell({
        banner: 'Landlord access approved',
        bannerSubject: 'You can list your place',
        tone: 'good',
        body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${first}, you're in.</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      Your landlord access is approved and your plan is active, so you can log in and
      publish your place right now — it goes live to students as soon as you submit it.
      No review queue, no waiting.
    </p>
    ${emailStatRow(cells)}
    ${noteBlock}
    <div style="margin-bottom:10px;">${emailButton({ label: 'List my place', url: `${site}/landlord/listings/new` })}</div>
    <div>${emailButton({ label: 'Open my dashboard', url: `${site}/landlord/dashboard`, secondary: true })}</div>`,
      }),
    }
  }

  return {
    subject: `You're approved as a landlord on HomeHive — here's how to go live`,
    html: emailShell({
      banner: 'Landlord access approved',
      bannerSubject: 'One step left to go live',
      tone: 'good',
      body: `
    <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Hey ${first}, you're approved.</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 20px;">
      You can log in to the landlord portal, add your place, and start marketing it to
      students. Publishing a listing needs an active plan — from
      ${esc(formatMonthly(starter.priceCents))}, month to month — and once you have one
      your listing goes live immediately, with no review queue to wait on.
    </p>
    ${emailStatRow(cells)}
    <p style="font-size:13.5px;color:#4a4a4a;line-height:1.7;margin:0 0 18px;">
      <strong>HomeHive is ASU and Tempe only, on purpose.</strong> Everyone searching here
      is looking for housing near campus this year, so your place reaches the students
      who can actually sign a lease — not a general rental audience.
    </p>
    <div style="background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:16px 20px;margin-bottom:22px;">
      <div style="font-size:12px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:11px;">What you get for it</div>
      ${emailChecklist([
        'Your listing live to every student browsing HomeHive',
        'Unlimited inquiries — no per-lead fees, no unlock charges',
        'Tenant screening with background and reference checks',
        'Tours and a booking calendar students schedule themselves',
        'Leases, e-signature, and online rent collection',
        'Maintenance, move-out inspections and deposit reconciliation',
      ])}
    </div>
    ${noteBlock}
    <div style="margin-bottom:10px;">${emailButton({ label: 'Choose a plan & list my place', url: `${site}/landlord/subscribe` })}</div>
    <div>${emailButton({ label: 'Look around the portal first', url: `${site}/landlord/dashboard`, secondary: true })}</div>
    <p style="margin:18px 0 0;font-size:12.5px;color:#9b9b9b;line-height:1.6;">
      Cancel any time from your billing page. Students never pay to use HomeHive.
    </p>`,
    }),
  }
}

/** Send it. Never throws — approval must not depend on the mail going out. */
export async function sendUpgradeApprovedEmail(opts: UpgradeApprovedEmailOpts): Promise<void> {
  if (!opts.to) return
  if (!process.env.RESEND_API_KEY) {
    console.warn('[landlordAccessEmails] RESEND_API_KEY missing — not sending')
    return
  }

  const { subject, html } = renderUpgradeApprovedEmail(opts)
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: opts.to,
      subject,
      html,
    })
  } catch (err) {
    console.error('[landlordAccessEmails] send failed:', err)
  }
}
