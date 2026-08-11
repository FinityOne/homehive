// "Added to your list" email for a new maintenance / upgrade item.
//
// Deliberately short: the landlord already knows what they typed. The job here
// is a durable record in their inbox, the priority stated plainly, and one link
// back to the list. Anything longer gets filtered out of habit.

import { KIND_META, PRIORITY_META, fmtMoney, type WorkItem } from './maintenance'

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
