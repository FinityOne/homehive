// The three emails a renewal needs.
//
//   1. the offer, to the tenant        — the only one with a decision in it
//   2. their answer, to the landlord   — so a yes is never missed
//   3. the window nudge, to the landlord — "this lease ends in 90 days and you
//      have not asked them"
//
// All three are transactional in the sense that matters: each one is caused by
// something somebody did or by a term somebody signed, and none of them is
// marketing. The window nudge is the closest call, and it goes out only on a
// lease the landlord themselves created and is about to lose money on, at most
// once per lease — so it carries no unsubscribe, the same reasoning the rent
// reminders run on.
//
// The offer email is the load-bearing one. It is read on a phone by a
// nineteen-year-old who will decide in about eleven seconds, so the terms are
// stated before any prose, the rent change is named out loud rather than left
// to be worked out from two numbers, and there is exactly one thing to tap.
// Nothing in it should ever be a surprise when they open the page.

import { emailShell, emailButton, emailStatRow, esc } from './emailShell'
import { daysBetweenDates, fmtDate, fmtRent, type Renewal } from './renewals'

export type BuiltEmail = { subject: string; html: string; text: string }

const p = (s: string) =>
  `<p style="margin:0 0 14px;font-size:14px;color:#3a3a3a;line-height:1.65;">${s}</p>`

/** A label/value table — the terms, stated once and unambiguously. */
function terms(rows: Array<[string, string]>): string {
  const body = rows.map(([k, v], i) => (
    `<tr>` +
    `<td style="padding:9px 0;font-size:12.5px;color:#9b9b9b;${i ? 'border-top:1px solid #f0ece4;' : ''}">${esc(k)}</td>` +
    `<td style="padding:9px 0;font-size:13.5px;color:#1a1a1a;font-weight:600;text-align:right;${i ? 'border-top:1px solid #f0ece4;' : ''}">${esc(v)}</td>` +
    `</tr>`
  )).join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:6px 16px;margin-bottom:20px;">${body}</table>`
}

/** How the rent is changing, said in words rather than left as subtraction. */
function rentLine(current: number | null, proposed: number): string {
  if (!current || current <= 0) return `${fmtRent(proposed)} per month`
  if (proposed === current) return `${fmtRent(proposed)} per month — unchanged`
  const diff = proposed - current
  return `${fmtRent(proposed)} per month — ${diff > 0 ? 'up' : 'down'} ${fmtRent(Math.abs(diff))} from ${fmtRent(current)}`
}

// ── 1. The offer ─────────────────────────────────────────────────────────────

export function buildRenewalOfferEmail(input: {
  renewal: Pick<Renewal, 'new_rent' | 'new_start_date' | 'new_end_date' | 'respond_by' | 'message'>
  currentRent: number | null
  /** The last day of the lease being renewed — not the first day of the new one. */
  currentEndDate: string
  tenantName: string | null
  propertyName: string
  unitNumber: string | null
  landlordName: string | null
  respondUrl: string
  heroImage?: string | null
}): BuiltEmail {
  const { renewal, currentRent, currentEndDate, tenantName, propertyName, unitNumber, landlordName, respondUrl } = input
  const first = (tenantName || '').trim().split(/\s+/)[0] || 'there'
  const unchanged = currentRent != null && currentRent > 0 && renewal.new_rent === currentRent

  const subject = unchanged
    ? `Stay another year at ${propertyName} — same rent`
    : `Your renewal offer for ${propertyName}`

  const body = [
    p(`Hi ${esc(first)},`),
    p(
      `Your lease at <strong>${esc(propertyName)}</strong>${unitNumber ? ` (${esc(unitNumber)})` : ''} ends on ` +
      `<strong>${esc(fmtDate(currentEndDate))}</strong>, and ${landlordName ? esc(landlordName) : 'your landlord'} ` +
      `would like you to stay. Here are the terms on offer:`
    ),
    terms([
      ['Rent', rentLine(currentRent, renewal.new_rent)],
      ['New term', `${fmtDate(renewal.new_start_date)} — ${fmtDate(renewal.new_end_date)}`],
      ['Reply by', fmtDate(renewal.respond_by)],
    ]),
    ...(renewal.message?.trim()
      ? [`<div style="border-left:3px solid #e8e4db;padding:2px 0 2px 14px;margin:0 0 20px;font-size:13.5px;color:#3a3a3a;line-height:1.65;font-style:italic;">${esc(renewal.message.trim())}</div>`]
      : []),
    p(
      `Renewing means no deposit to find, no move, and no application. If you would rather not, ` +
      `saying so now gives everyone time — there is no penalty for a no.`
    ),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Accept or decline', url: respondUrl })}</div>`,
    p(`<span style="font-size:12.5px;color:#9b9b9b;">This link is just for you. Nothing is binding until you choose.</span>`),
  ].join('\n')

  const html = emailShell({
    banner: 'Renewal offer',
    bannerSubject: `${propertyName}${unitNumber ? ` · ${unitNumber}` : ''}`,
    tone: 'action',
    body,
    hero: input.heroImage || undefined,
    heroAlt: propertyName,
  })

  const text = [
    `Hi ${first},`,
    ``,
    `Your lease at ${propertyName}${unitNumber ? ` (${unitNumber})` : ''} ends on ${fmtDate(currentEndDate)}, and ${landlordName || 'your landlord'} would like you to stay.`,
    ``,
    `Rent: ${rentLine(currentRent, renewal.new_rent)}`,
    `New term: ${fmtDate(renewal.new_start_date)} — ${fmtDate(renewal.new_end_date)}`,
    `Reply by: ${fmtDate(renewal.respond_by)}`,
    ...(renewal.message?.trim() ? ['', renewal.message.trim()] : []),
    ``,
    `Accept or decline: ${respondUrl}`,
    ``,
    `There is no penalty for declining — saying so now just gives everyone time.`,
  ].join('\n')

  return { subject, html, text }
}

// ── 2. Their answer ──────────────────────────────────────────────────────────

export function buildRenewalResponseEmail(input: {
  accepted: boolean
  renewal: Pick<Renewal, 'new_rent' | 'new_start_date' | 'new_end_date' | 'response_note'>
  currentRent: number | null
  tenantName: string | null
  propertyName: string
  unitNumber: string | null
  /** Where the landlord goes to act on it. */
  pipelineUrl: string
  /** Days from the answer to the end of the current lease. */
  daysToTurnover: number
}): BuiltEmail {
  const { accepted, renewal, currentRent, tenantName, propertyName, unitNumber, daysToTurnover } = input
  const who = tenantName?.trim() || 'Your tenant'

  const subject = accepted
    ? `${who} is renewing — ${propertyName}`
    : `${who} is not renewing — ${propertyName}`

  const stats: Array<[string, string]> = accepted
    ? [
        ['New rent', fmtRent(renewal.new_rent)],
        ['Term starts', fmtDate(renewal.new_start_date)],
        ['Secured for', `${Math.max(1, Math.round(daysBetweenDates(renewal.new_start_date, renewal.new_end_date) / 30.44))} mo`],
      ]
    : [
        ['Rent leaving', currentRent ? `${fmtRent(currentRent)}/mo` : '—'],
        ['Days to fill', daysToTurnover >= 0 ? String(daysToTurnover) : 'past due'],
        ['Vacancy cost', currentRent ? `${fmtRent(currentRent)}/mo` : '—'],
      ]

  const body = [
    p(accepted
      ? `<strong>${esc(who)}</strong> accepted the renewal on <strong>${esc(propertyName)}</strong>${unitNumber ? ` (${esc(unitNumber)})` : ''}.`
      : `<strong>${esc(who)}</strong> declined the renewal on <strong>${esc(propertyName)}</strong>${unitNumber ? ` (${esc(unitNumber)})` : ''}.`),
    emailStatRow(stats),
    ...(renewal.response_note?.trim()
      ? [`<div style="border-left:3px solid #e8e4db;padding:2px 0 2px 14px;margin:0 0 20px;font-size:13.5px;color:#3a3a3a;line-height:1.65;font-style:italic;">${esc(renewal.response_note.trim())}</div>`]
      : []),
    p(accepted
      ? `Nothing is signed yet. Create the renewed lease and it carries over to the new term with the rent above.`
      : daysToTurnover >= 0
        ? `You have ${daysToTurnover} day${daysToTurnover === 1 ? '' : 's'} before the room is empty. Relisting today is worth more than any rent you could have negotiated — in this market a listing that goes up now sees the renters who plan ahead, and one that goes up in six weeks does not.`
        : `The lease has already ended. Every day this room stays unlisted costs you rent.`),
    `<div style="margin:22px 0 6px;">${emailButton({ label: accepted ? 'Create the renewed lease' : 'Relist the room', url: input.pipelineUrl })}</div>`,
  ].join('\n')

  const html = emailShell({
    banner: accepted ? 'Renewal accepted' : 'Renewal declined',
    bannerSubject: `${propertyName}${unitNumber ? ` · ${unitNumber}` : ''}`,
    tone: accepted ? 'good' : 'bad',
    body,
  })

  const text = [
    accepted ? `${who} accepted the renewal on ${propertyName}.` : `${who} declined the renewal on ${propertyName}.`,
    ``,
    ...stats.map(([k, v]) => `${k}: ${v}`),
    ...(renewal.response_note?.trim() ? ['', `Their note: ${renewal.response_note.trim()}`] : []),
    ``,
    accepted
      ? `Nothing is signed yet — create the renewed lease: ${input.pipelineUrl}`
      : `Relist the room: ${input.pipelineUrl}`,
  ].join('\n')

  return { subject, html, text }
}

// ── 3. The window nudge ──────────────────────────────────────────────────────

export function buildRenewalWindowEmail(input: {
  landlordName: string | null
  /** One entry per lease that has entered the window unasked. */
  leases: Array<{
    propertyName: string
    unitNumber: string | null
    tenantName: string | null
    endDate: string
    daysLeft: number
    rent: number | null
  }>
  pipelineUrl: string
}): BuiltEmail {
  const { leases, pipelineUrl } = input
  const first = (input.landlordName || '').trim().split(/\s+/)[0]
  const atRisk = leases.reduce((s, l) => s + (l.rent ?? 0), 0)
  const soonest = Math.min(...leases.map(l => l.daysLeft))

  const subject = leases.length === 1
    ? `${leases[0].propertyName} — lease ends in ${leases[0].daysLeft} days`
    : `${leases.length} leases ending — ${atRisk > 0 ? `${fmtRent(atRisk)}/mo` : 'renewals'} to confirm`

  const rows = leases.map(l => (
    `<tr>` +
    `<td style="padding:10px 0;border-top:1px solid #f0ece4;">` +
    `<div style="font-size:13.5px;font-weight:600;color:#1a1a1a;">${esc(l.propertyName)}${l.unitNumber ? ` <span style="color:#9b9b9b;font-weight:400;">${esc(l.unitNumber)}</span>` : ''}</div>` +
    `<div style="font-size:12px;color:#9b9b9b;margin-top:2px;">${esc(l.tenantName || 'tenant')} · ends ${esc(fmtDate(l.endDate))}</div>` +
    `</td>` +
    `<td style="padding:10px 0;border-top:1px solid #f0ece4;text-align:right;white-space:nowrap;">` +
    `<div style="font-size:13.5px;font-weight:700;color:${l.daysLeft <= 45 ? '#9f1239' : '#1a1a1a'};">${l.daysLeft} days</div>` +
    `${l.rent ? `<div style="font-size:12px;color:#9b9b9b;margin-top:2px;">${esc(fmtRent(l.rent))}/mo</div>` : ''}` +
    `</td></tr>`
  )).join('')

  const body = [
    p(`${first ? `${esc(first)}, ` : ''}${leases.length === 1 ? 'one of your leases has' : `${leases.length} of your leases have`} entered the renewal window and nobody has asked the tenant yet.`),
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:20px;">${rows}</table>`,
    p(
      `Renewing a tenant you already have costs nothing: no vacancy, no make-ready, no marketing, no screening. ` +
      `Re-letting the same room costs all four${atRisk > 0 ? `, plus ${fmtRent(atRisk)} for every month it sits empty` : ''}.`
    ),
    p(
      soonest <= 45
        ? `<strong>The soonest ends in ${soonest} days.</strong> In Tempe the renters who plan ahead have already signed by that point, so a decline this late is usually a vacancy rather than a replacement.`
        : `Asking now is the whole advantage — students decide in spring for the fall, and the answer still leaves time to re-let if it is a no.`
    ),
    `<div style="margin:22px 0 6px;">${emailButton({ label: 'Send the renewal offers', url: pipelineUrl })}</div>`,
  ].join('\n')

  const html = emailShell({
    banner: 'Renewal window open',
    bannerSubject: leases.length === 1
      ? `${leases[0].propertyName} ends ${fmtDate(leases[0].endDate)}`
      : `${leases.length} leases ending soon`,
    tone: soonest <= 45 ? 'bad' : 'action',
    body,
  })

  const text = [
    `${leases.length === 1 ? 'One of your leases has' : `${leases.length} of your leases have`} entered the renewal window with no offer sent.`,
    ``,
    ...leases.map(l => `${l.propertyName}${l.unitNumber ? ` (${l.unitNumber})` : ''} — ${l.tenantName || 'tenant'} — ends ${fmtDate(l.endDate)} (${l.daysLeft} days)${l.rent ? ` — ${fmtRent(l.rent)}/mo` : ''}`),
    ``,
    `Renewing costs nothing. Re-letting costs a vacancy, a make-ready, marketing and screening.`,
    ``,
    `Send the offers: ${pipelineUrl}`,
  ].join('\n')

  return { subject, html, text }
}
