/**
 * The weekly maintenance digest, rendered.
 *
 * Takes a `MaintenanceDigest` and nothing else that needs looking up — the
 * numbers are already decided by then, so this file only has opinions about
 * layout. Same dark-header shell as the "item added" mail in
 * `maintenanceEmails.ts`, so the two read as one product.
 *
 * Two rules worth keeping:
 *
 *   • Every bucket is capped at `MAX_LINES`. A digest that prints forty rows is
 *     a worse version of the page it links to; the cap plus "+N more" keeps the
 *     mail skimmable and sends the long tail to the list where it belongs.
 *   • No fabricated figures. Costs print only where the landlord entered one,
 *     and "—" is honest where an estimate is missing. A made-up total in an
 *     email is how a landlord learns not to trust the dashboard either.
 */
import { KIND_META, PRIORITY_META, fmtMoney } from './maintenance'
import { digestSubject, type MaintenanceDigest, type DigestLine } from './maintenanceDigest'
import type { BuiltEmail } from './maintenanceEmails'

/** Lines printed per bucket before it collapses into a count. */
const MAX_LINES = 6

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const fmtDay = (d: string): string =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const firstNameOf = (name: string | null | undefined): string | null => {
  const n = (name ?? '').trim()
  return n ? n.split(/\s+/)[0] : null
}

/** "3 days late", "due today", "in 2 days" — the phrase that gives a line urgency. */
function timing(l: DigestLine): string | null {
  if (l.daysLate != null) {
    return l.daysLate === 0 ? 'due today' : `${l.daysLate} day${l.daysLate === 1 ? '' : 's'} late`
  }
  if (l.daysUntil != null) {
    if (l.daysUntil === 0) return 'due today'
    if (l.daysUntil === 1) return 'due tomorrow'
    return `in ${l.daysUntil} days`
  }
  if (l.daysInStatus != null) {
    return l.status === 'blocked'
      ? `blocked ${l.daysInStatus} day${l.daysInStatus === 1 ? '' : 's'}`
      : `no movement in ${l.daysInStatus} days`
  }
  return null
}

type Section = {
  key: string
  heading: string
  /** One line saying why this section exists. Skipped when it is obvious. */
  blurb?: string
  accent: string
  bg: string
  lines: DigestLine[]
  /** Print the cost column as actual (completed) rather than estimated. */
  showActual?: boolean
}

function sectionsOf(d: MaintenanceDigest): Section[] {
  return [
    {
      key: 'overdue',
      heading: 'Overdue',
      blurb: 'Past the target date you set.',
      accent: '#991b1b',
      bg: '#fef2f2',
      lines: d.overdue,
    },
    {
      key: 'dueSoon',
      heading: 'Due in the next 7 days',
      accent: '#b45309',
      bg: '#fffbeb',
      lines: d.dueSoon,
    },
    {
      key: 'stalled',
      heading: 'Stalled',
      blurb: 'Blocked, or sitting in progress with nothing logged against it.',
      accent: '#6d28d9',
      bg: '#f5f3ff',
      lines: d.stalled,
    },
    {
      key: 'completed',
      heading: 'Finished this week',
      accent: '#065f46',
      bg: '#ecfdf5',
      lines: d.completed,
      showActual: true,
    },
  ].filter(s => s.lines.length > 0)
}

/** The opening sentence: the week in one line, never a greeting on its own. */
function leadSentence(d: MaintenanceDigest): string {
  const bits: string[] = []
  if (d.overdue.length > 0) bits.push(`${d.overdue.length} overdue`)
  if (d.dueSoon.length > 0) bits.push(`${d.dueSoon.length} due in the next 7 days`)
  if (d.stalled.length > 0) bits.push(`${d.stalled.length} stalled`)

  const doors = d.propertyCount === 1 ? '1 property' : `${d.propertyCount} properties`

  if (bits.length === 0) {
    return d.completed.length > 0
      ? `Nothing is overdue or due next week. You closed out ${d.completed.length} item${d.completed.length === 1 ? '' : 's'} since ${fmtDay(d.since)}.`
      : `Nothing is overdue or due next week — your list is clear for now.`
  }

  const last = bits.pop()!
  const joined = bits.length > 0 ? `${bits.join(', ')} and ${last}` : last
  return `Across ${doors} you have ${joined}.`
}

export function buildMaintenanceDigestEmail(input: {
  digest: MaintenanceDigest
  landlordName?: string | null
  /** Named in the subject when a landlord has exactly one property. */
  subjectLabel?: string | null
  listUrl: string
  unsubscribeUrl: string
}): BuiltEmail {
  const { digest: d, landlordName, subjectLabel, listUrl, unsubscribeUrl } = input
  const subject = digestSubject(d, subjectLabel)
  const name = firstNameOf(landlordName)
  const sections = sectionsOf(d)

  // ── Plain text ───────────────────────────────────────────────────────────
  const textLines: string[] = [
    `Maintenance — week of ${fmtDay(d.since)} to ${fmtDay(d.asOf)}`,
    ``,
    leadSentence(d),
    ``,
    `Open: ${d.totals.open}   Overdue: ${d.totals.overdue}   Due next 7 days: ${d.dueSoon.length}`,
    `Estimated cost of open work: ${fmtMoney(d.totals.estimatedOpen)}`,
    ...(d.completed.length > 0 ? [`Spent on work finished this week: ${fmtMoney(d.spentInWindow)}`] : []),
  ]

  for (const s of sections) {
    textLines.push('', `${s.heading.toUpperCase()} (${s.lines.length})`)
    for (const l of s.lines.slice(0, MAX_LINES)) {
      const t = timing(l)
      const cost = s.showActual ? l.actualCost : l.estimatedCost
      textLines.push(
        `  • ${l.title} — ${l.propertyName}${l.area ? ` / ${l.area}` : ''}` +
        `${t ? ` (${t})` : ''}${cost != null ? ` — ${fmtMoney(cost)}` : ''}`
      )
    }
    if (s.lines.length > MAX_LINES) {
      textLines.push(`  …and ${s.lines.length - MAX_LINES} more`)
    }
  }

  if (d.undatedCount > 0) {
    textLines.push(
      ``,
      `${d.undatedCount} open item${d.undatedCount === 1 ? ' has' : 's have'} no target date, so ` +
      `${d.undatedCount === 1 ? 'it' : 'they'} will never show up here as due.`
    )
  }

  textLines.push(``, `Open your list: ${listUrl}`, ``, `Stop these weekly summaries: ${unsubscribeUrl}`)

  // ── HTML ─────────────────────────────────────────────────────────────────
  const stat = (label: string, value: string, color = '#0f172a') => `
    <td style="padding:0 6px;width:25%;vertical-align:top;">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:11px 12px;text-align:center;">
        <div style="font-size:21px;font-weight:800;color:${color};letter-spacing:-0.5px;line-height:1.1;">${value}</div>
        <div style="font-size:9.5px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#94a3b8;margin-top:5px;line-height:1.3;">${label}</div>
      </div>
    </td>`

  const lineHtml = (l: DigestLine, s: Section) => {
    const kind = KIND_META[l.kind]
    const priority = PRIORITY_META[l.priority]
    const t = timing(l)
    const cost = s.showActual ? l.actualCost : l.estimatedCost
    return `
      <div style="border-top:1px solid #f1f5f9;padding:10px 0 9px;">
        <div style="font-size:13.5px;font-weight:700;color:#0f172a;line-height:1.35;">
          ${esc(l.title)}
          ${t ? `<span style="font-size:11px;font-weight:700;color:${s.accent};"> · ${esc(t)}</span>` : ''}
        </div>
        <div style="font-size:11.5px;color:#64748b;margin-top:3px;line-height:1.5;">
          ${esc(l.propertyName)}${l.area ? ` · ${esc(l.area)}` : ''}
          · <span style="color:${kind.color};">${kind.label}</span>
          · <span style="color:${priority.color};">${priority.label}</span>
          ${cost != null ? ` · ${esc(fmtMoney(cost))}` : ''}
          ${l.tenantVisible ? ` · <span style="color:#0e7490;">shared with residents</span>` : ''}
        </div>
      </div>`
  }

  const sectionHtml = (s: Section) => `
    <div style="margin-top:20px;">
      <div style="background:${s.bg};border-left:3px solid ${s.accent};border-radius:0 8px 8px 0;padding:8px 12px;">
        <span style="font-size:11.5px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:${s.accent};">
          ${esc(s.heading)} · ${s.lines.length}
        </span>
        ${s.blurb ? `<div style="font-size:11px;color:#64748b;margin-top:3px;line-height:1.5;">${esc(s.blurb)}</div>` : ''}
      </div>
      ${s.lines.slice(0, MAX_LINES).map(l => lineHtml(l, s)).join('')}
      ${s.lines.length > MAX_LINES ? `
      <div style="border-top:1px solid #f1f5f9;padding:9px 0 0;font-size:12px;color:#64748b;">
        and ${s.lines.length - MAX_LINES} more on your list →
      </div>` : ''}
    </div>`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:26px 14px 44px;">

  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
    <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:5px;">
      Maintenance — week of ${esc(fmtDay(d.since))} to ${esc(fmtDay(d.asOf))}
    </div>
  </div>

  <div style="background:#fff;border-radius:0 0 14px 14px;padding:24px 24px 30px;">

    <div style="font-size:13.5px;color:#334155;line-height:1.6;">
      ${name ? `Hi ${esc(name)} — h` : 'H'}ere is where your maintenance list stands.
      ${esc(leadSentence(d))}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;margin:18px -6px 0;">
      <tr>
        ${stat('Open', String(d.totals.open))}
        ${stat('Overdue', String(d.totals.overdue), d.totals.overdue > 0 ? '#991b1b' : '#0f172a')}
        ${stat('Due in 7 days', String(d.dueSoon.length), d.dueSoon.length > 0 ? '#b45309' : '#0f172a')}
        ${stat('Open est. cost', fmtMoney(d.totals.estimatedOpen))}
      </tr>
    </table>

    ${sections.map(sectionHtml).join('')}

    ${d.completed.length > 0 ? `
    <div style="margin-top:18px;background:#f8fafc;border-radius:9px;padding:11px 14px;font-size:12px;color:#475569;line-height:1.6;">
      Spent on work finished this week: <strong style="color:#0f172a;">${esc(fmtMoney(d.spentInWindow))}</strong>
    </div>` : ''}

    ${d.undatedCount > 0 ? `
    <div style="margin-top:12px;border:1px dashed #cbd5e1;border-radius:9px;padding:11px 14px;font-size:12px;color:#475569;line-height:1.6;">
      <strong style="color:#0f172a;">${d.undatedCount} open item${d.undatedCount === 1 ? '' : 's'}</strong>
      ${d.undatedCount === 1 ? 'has' : 'have'} no target date, so
      ${d.undatedCount === 1 ? 'it' : 'they'} will never appear here as due. Adding one is what puts
      ${d.undatedCount === 1 ? 'it' : 'them'} on this list.
    </div>` : ''}

    <div style="margin-top:24px;text-align:center;">
      <a href="${listUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:13.5px;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:9px;">
        Open your maintenance list →
      </a>
    </div>

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
      You get this every Friday because you have work tracked in HomeHive.
      <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Stop these weekly summaries</a>
      — it will not affect rent, lease or tenant emails.
    </div>
  </div>
</div>
</body>
</html>`

  return { subject, html, text: textLines.join('\n') }
}
