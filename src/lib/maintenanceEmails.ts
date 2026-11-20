// The maintenance emails. Two audiences, and they are not the same email.
//
// `buildWorkItemAddedEmail` goes to the **landlord**: a durable record in their
// inbox of what they typed, the priority stated plainly, one link back to the
// list. Deliberately short — anything longer gets filtered out of habit. It is
// free to name the estimate and the vendor, because it is their own row.
//
// `buildWorkItemCompletedEmail` goes to the **residents**, and takes the
// tenant-shaped item rather than the landlord row so that no cost or vendor
// detail is even in scope. See the note above it.

import { KIND_META, PRIORITY_META, fmtMoney, type WorkItem } from './maintenance'
import { tenantKindLabel, type TenantWorkItem } from './tenantMaintenance'

export type BuiltEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fmtDate(d: string | null | undefined): string | null {
  if (!d) return null
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function buildWorkItemAddedEmail(input: {
  item: WorkItem
  propertyName: string
  listUrl: string
  landlordName?: string | null
}): BuiltEmail {
  const { item, propertyName, listUrl, landlordName } = input
  const kind = KIND_META[item.kind]
  const priority = PRIORITY_META[item.priority]
  const urgent = item.priority === 'emergency' || item.priority === 'high'

  const subject = `${urgent ? `[${priority.label}] ` : ''}${kind.label} added — ${item.title} (${propertyName})`

  const rows: [string, string][] = [
    ['Property', propertyName],
    ...(item.area ? [['Area', item.area] as [string, string]] : []),
    ['Type', kind.label],
    ['Priority', priority.label],
    ...(item.estimated_cost != null ? [['Estimated cost', fmtMoney(item.estimated_cost)] as [string, string]] : []),
    ...(fmtDate(item.target_date) ? [['Target date', fmtDate(item.target_date)!] as [string, string]] : []),
    ...(item.vendor_name ? [['Vendor', item.vendor_name] as [string, string]] : []),
    ...(item.reported_by ? [['Reported by', item.reported_by] as [string, string]] : []),
    // Stated on every item, both ways round. This email is the durable record
    // of what was created, and "did that go out to my tenants?" is the one
    // question about it that has a wrong answer worth an apology — so it is
    // answered here rather than left to be inferred from its absence.
    ['Shown to residents', item.tenant_visible ? 'Yes — on their tenant portal' : 'No — private to you'],
    ...(item.tenant_visible && item.tenant_note
      ? [['Note they see', item.tenant_note] as [string, string]]
      : []),
  ]

  const text = [
    `${kind.label} added to ${propertyName}`,
    ``,
    item.title,
    ...(item.description ? ['', item.description] : []),
    ``,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ``,
    `View the list: ${listUrl}`,
  ].join('\n')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:26px 14px 44px;">

  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
    <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:5px;">
      Maintenance &amp; Upgrades
    </div>
  </div>

  <div style="background:#fff;border-radius:0 0 14px 14px;padding:26px 24px 30px;">

    <div style="font-size:13.5px;color:#334155;line-height:1.6;">
      ${landlordName ? `Hi ${esc(landlordName.split(' ')[0])}, a` : 'A'}n item was added to your list for
      <strong>${esc(propertyName)}</strong>.
    </div>

    <div style="margin-top:18px;border:1px solid #e2e8f0;border-left:4px solid ${priority.color};border-radius:10px;padding:16px 18px;">
      <div style="display:inline-block;background:${kind.bg};color:${kind.color};font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:3px 9px;border-radius:20px;">
        ${kind.icon} ${kind.label}
      </div>
      <div style="display:inline-block;background:${priority.bg};color:${priority.color};font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:3px 9px;border-radius:20px;margin-left:5px;">
        ${priority.label}
      </div>
      <div style="font-size:17px;font-weight:700;color:#0f172a;margin-top:11px;line-height:1.35;">
        ${esc(item.title)}
      </div>
      ${item.description ? `<div style="font-size:13px;color:#475569;line-height:1.6;margin-top:6px;">${esc(item.description)}</div>` : ''}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;">
      ${rows.map(([k, v]) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#94a3b8;width:44%;">${esc(k)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(v)}</td>
      </tr>`).join('')}
    </table>

    <div style="margin-top:24px;text-align:center;">
      <a href="${listUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:13.5px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:9px;">
        Open the list →
      </a>
    </div>

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
      Record the actual cost on the item once the work is done — HomeHive tracks it against your
      estimate so you can see where the money really goes.
    </div>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}

// ── "This job is done" — to the residents ────────────────────────────────────

/**
 * Tell the people who live there that a shared job is finished.
 *
 * **It takes a `TenantWorkItem`, not a `WorkItem`, and that is the whole
 * safety design.** The landlord's row carries the estimate, the actual spend,
 * the vendor's phone number, the private description and the working notes. If
 * this function accepted that row, keeping those out of the email would be a
 * discipline — a list of fields somebody has to remember not to interpolate,
 * re-checked every time the template is edited. Taking the already-shaped
 * tenant object instead makes it a *type error* to mention a cost: there is no
 * `actual_cost` on the argument to reach for. `shapeForTenant` is the one gate,
 * and this template sits behind it like every other tenant-facing surface.
 *
 * So: no money, no vendor, no phone number, no landlord email. Not even a
 * `replyTo` — a reply header puts the landlord's address in six tenants' mail
 * clients, and the portal is where the conversation and the evidence live.
 *
 * `note` is the landlord's own sentence about the finished work, which the
 * route passes from the newest *shared* progress update. Deliberately not
 * `item.note` (`tenant_note`): that field says what a job *is* and is often
 * written before the work as an instruction — "the removal company comes
 * Friday, please be home" — which, quoted in a completion email, tells a
 * resident to be home for something that already happened.
 */
export function buildWorkItemCompletedEmail(input: {
  item: TenantWorkItem
  propertyName: string
  portalUrl: string
  /** The newest shared progress note, if the landlord wrote one. */
  note?: string | null
  /** Who the email greets. First name only; the full roster is never listed. */
  tenantName?: string | null
}): BuiltEmail {
  const { item, propertyName, portalUrl, note, tenantName } = input
  const kindLabel = tenantKindLabel(item.kind)
  const firstName = tenantName?.trim().split(/\s+/)[0] || null
  const finished = fmtDate(item.completed_at?.slice(0, 10) ?? null)
  const where = item.area ? `${item.area} · ${propertyName}` : propertyName

  const subject = `Completed: ${item.title} (${propertyName})`

  const text = [
    `${item.title} — completed`,
    where,
    ``,
    `${firstName ? `Hi ${firstName}, t` : 'T'}his ${kindLabel.toLowerCase()} at your home is now finished${finished ? ` (${finished})` : ''}.`,
    ...(note ? ['', note] : []),
    ``,
    `You can see this job, its status and any photos or updates on your tenant portal:`,
    portalUrl,
    ``,
    `If something about it still doesn't look right, reply to your landlord through the portal and they'll pick it up there.`,
  ].join('\n')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:26px 14px 44px;">

  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
    <div style="font-size:17px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:5px;">
      Maintenance update
    </div>
  </div>

  <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px 24px 30px;">

    <div style="display:inline-block;background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;padding:4px 10px;border-radius:20px;">
      ✓ Completed
    </div>

    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;margin-top:12px;line-height:1.35;">
      ${esc(item.title)}
    </div>
    <div style="font-size:13px;color:#64748b;margin-top:4px;">${esc(where)}</div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:20px;">
      ${firstName ? `Hi ${esc(firstName)}, t` : 'T'}his ${esc(kindLabel.toLowerCase())} at your home is
      now finished${finished ? ` — completed on <strong>${esc(finished)}</strong>` : ''}.
    </div>

    ${note ? `
    <div style="margin-top:16px;border-left:3px solid #34d399;background:#f0fdf4;border-radius:0 8px 8px 0;padding:13px 16px;font-size:13.5px;color:#334155;line-height:1.6;">
      ${esc(note)}
    </div>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:20px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#94a3b8;width:44%;">Type of work</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(kindLabel)}</td>
      </tr>
      ${item.area ? `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#94a3b8;">Area</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(item.area)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#94a3b8;">Status</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#065f46;font-weight:600;text-align:right;">Completed</td>
      </tr>
      ${finished ? `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#94a3b8;">Finished</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(finished)}</td>
      </tr>` : ''}
    </table>

    <div style="margin-top:24px;text-align:center;">
      <a href="${portalUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:14.5px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:9px;">
        View details &amp; updates →
      </a>
      <div style="font-size:11px;color:#94a3b8;margin-top:9px;">
        Every job shared with you, open and completed, is on your portal.
      </div>
    </div>

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      If something about this work still doesn&apos;t look right, say so on your portal and your
      landlord will see it there.
    </div>
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}
