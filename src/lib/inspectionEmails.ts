// Per-tenant move-out statement email.
//
// Each tenant gets their own numbers, not the whole house's: what they were
// holding, what they're being charged, and the one figure they actually care
// about — money back or money owed. The full report (photos, every finding,
// signature lines) stays on the web; the email is the statement, not the file.

import { explainLateFee, fmtMoney, type Inspection, type PartyTotal } from './inspections'

export type TenantEmailInput = {
  inspection: Inspection
  partyTotal: PartyTotal
  reportUrl: string
  landlordName?: string | null
  landlordEmail?: string | null
}

export type BuiltEmail = { subject: string; html: string; text: string }

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One charge line as it appears on the tenant's statement. */
type Line = { label: string; note: string | null; amount: number }

function buildLines(input: TenantEmailInput): { damage: Line[]; lateFees: Line[] } {
  const { inspection, partyTotal } = input

  const damage: Line[] = partyTotal.charges.map(c => {
    const item = inspection.items.find(i => i.id === c.itemId)
    const area = item?.area?.trim()
    return {
      label: area ? `${area} — ${c.title}` : c.title,
      note: c.basis === 'shared'
        ? `Shared cost of ${fmtMoney(item?.cost ?? c.amount * c.sharedWith)}, split ${c.sharedWith} ways`
        : null,
      amount: c.amount,
    }
  })

  const lateFees: Line[] = partyTotal.lateFees
    .filter(f => f.included)
    .map(f => ({
      label: f.label,
      note: explainLateFee(f),
      amount: f.fee_amount,
    }))

  return { damage, lateFees }
}

export function buildTenantStatementEmail(input: TenantEmailInput): BuiltEmail {
  const { inspection, partyTotal, reportUrl, landlordName, landlordEmail } = input
  const party = partyTotal.party
  const property = inspection.property?.name ?? 'your home'
  const firstName = party.name.trim().split(/\s+/)[0] || 'there'
  const owed = partyTotal.balance < 0
  const headline = Math.abs(partyTotal.balance)

  const isRevision = (inspection.version ?? 0) > 1
  const prefix = isRevision ? `Revised statement (v${inspection.version})` : 'Your move-out statement'
  const subject = owed
    ? `${prefix} — ${fmtMoney(headline)} balance due (${property})`
    : `${prefix} — ${fmtMoney(headline)} deposit refund (${property})`

  const { damage, lateFees } = buildLines(input)
  const wearCount = inspection.items.filter(i => i.is_wear_and_tear).length

  // ── Plain-text fallback ────────────────────────────────────────────────────
  const text = [
    `Move-out statement — ${property}`,
    `Report #${inspection.id.slice(0, 8).toUpperCase()}`,
    ``,
    `Hi ${firstName},`,
    ``,
    `Your move-out inspection is complete. Here's your deposit statement.`,
    ``,
    `Security deposit held:      ${fmtMoney(partyTotal.depositHeld)}`,
    partyTotal.directTotal > 0 ? `Damage charged to you:     -${fmtMoney(partyTotal.directTotal)}` : null,
    partyTotal.sharedTotal > 0 ? `Your share of shared damage: -${fmtMoney(partyTotal.sharedTotal)}` : null,
    partyTotal.lateFeesTotal > 0 ? `Late payment charges:      -${fmtMoney(partyTotal.lateFeesTotal)}` : null,
    ``,
    owed ? `BALANCE DUE: ${fmtMoney(headline)}` : `REFUND DUE TO YOU: ${fmtMoney(headline)}`,
    ``,
    `Full report with photos: ${reportUrl}`,
  ].filter(Boolean).join('\n')

  // ── Line rows ──────────────────────────────────────────────────────────────
  const lineRows = (lines: Line[]) => lines.map(l => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;">
        <div style="font-size:13px;color:#0f172a;font-weight:600;">${esc(l.label)}</div>
        ${l.note ? `<div style="font-size:11px;color:#94a3b8;line-height:1.5;margin-top:2px;">${esc(l.note)}</div>` : ''}
      </td>
      <td style="padding:9px 0 9px 14px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;font-size:13px;font-weight:700;color:#0f172a;vertical-align:top;">
        ${fmtMoney(l.amount)}
      </td>
    </tr>`).join('')

  const section = (title: string, lines: Line[], total: number) => lines.length === 0 ? '' : `
    <div style="margin-top:26px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#64748b;padding-bottom:7px;border-bottom:2px solid #0f172a;">
        ${esc(title)}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${lineRows(lines)}
        <tr>
          <td style="padding:10px 0;font-size:12px;font-weight:700;color:#64748b;">Subtotal</td>
          <td style="padding:10px 0 10px 14px;text-align:right;font-size:14px;font-weight:700;color:#0f172a;">${fmtMoney(total)}</td>
        </tr>
      </table>
    </div>`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:26px 14px 44px;">

  <!-- Header -->
  <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:20px 26px;">
    <div style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#34d399;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:10.5px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:5px;">
      Move-out Inspection &amp; Deposit Statement
    </div>
  </div>

  <!-- Card -->
  <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px 26px 32px;">

    <div style="font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">${esc(property)}</div>
    <div style="font-size:12.5px;color:#64748b;margin-top:3px;line-height:1.6;">
      ${inspection.property?.address ? esc(inspection.property.address) + '<br />' : ''}
      Tenancy ${fmtDate(inspection.period_start)} – ${fmtDate(inspection.period_end)}<br />
      Inspected ${fmtDate(inspection.inspection_date)} · Report #${inspection.id.slice(0, 8).toUpperCase()}
    </div>

    <div style="font-size:14px;color:#334155;line-height:1.65;margin-top:22px;">
      Hi ${esc(firstName)}, ${isRevision
        ? 'your move-out statement has been revised. This replaces the version you received earlier.'
        : 'your move-out inspection is complete. Here is your deposit statement.'}
    </div>

    ${isRevision ? `
    <div style="margin-top:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:13px 15px;font-size:12.5px;color:#1e40af;line-height:1.6;">
      <strong>Revision ${inspection.version}</strong> — supersedes version ${(inspection.version ?? 2) - 1}.
      ${inspection.revision_note ? `What changed: ${esc(inspection.revision_note)}` : ''}
    </div>` : ''}

    <!-- The number that matters -->
    <div style="margin-top:20px;background:${owed ? '#fef2f2' : '#ecfdf5'};border:1px solid ${owed ? '#fecaca' : '#a7f3d0'};border-radius:12px;padding:20px 22px;text-align:center;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${owed ? '#991b1b' : '#065f46'};">
        ${owed ? 'Balance due from you' : 'Refund due to you'}
      </div>
      <div style="font-size:34px;font-weight:800;color:${owed ? '#dc2626' : '#059669'};margin-top:6px;letter-spacing:-1px;">
        ${fmtMoney(headline)}
      </div>
      ${inspection.response_due_date
        ? `<div style="font-size:12px;color:${owed ? '#b91c1c' : '#047857'};margin-top:6px;">To be settled by ${fmtDate(inspection.response_due_date)}</div>`
        : ''}
    </div>

    <!-- The arithmetic -->
    <div style="margin-top:26px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;color:#64748b;padding-bottom:7px;border-bottom:2px solid #0f172a;">
        How that was calculated
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">Security deposit held</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:#0f172a;">${fmtMoney(partyTotal.depositHeld)}</td>
        </tr>
        ${partyTotal.directTotal > 0 ? `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">Damage charged to you</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;color:#b45309;">− ${fmtMoney(partyTotal.directTotal)}</td>
        </tr>` : ''}
        ${partyTotal.sharedTotal > 0 ? `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">Your share of shared damage</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;color:#b45309;">− ${fmtMoney(partyTotal.sharedTotal)}</td>
        </tr>` : ''}
        ${partyTotal.lateFeesTotal > 0 ? `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">Late payment charges</td>
          <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;color:#b45309;">− ${fmtMoney(partyTotal.lateFeesTotal)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:13px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${owed ? 'Balance due' : 'Refund due'}</td>
          <td style="padding:13px 0 0;text-align:right;font-size:17px;font-weight:800;color:${owed ? '#dc2626' : '#059669'};">${fmtMoney(headline)}</td>
        </tr>
      </table>
    </div>

    ${section('Damage charged to you', damage, partyTotal.directTotal + partyTotal.sharedTotal)}
    ${section('Late payment charges', lateFees, partyTotal.lateFeesTotal)}

    ${damage.length === 0 && lateFees.length === 0 ? `
    <div style="margin-top:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;font-size:13px;color:#475569;line-height:1.6;">
      No charges were applied to you — your deposit is being returned in full.
    </div>` : ''}

    ${wearCount > 0 ? `
    <div style="margin-top:16px;font-size:11.5px;color:#94a3b8;line-height:1.6;">
      ${wearCount} item${wearCount !== 1 ? 's were' : ' was'} logged as normal wear and tear and ${wearCount !== 1 ? 'are' : 'is'} not charged to anyone.
    </div>` : ''}

    <!-- Full report -->
    <div style="margin-top:28px;text-align:center;">
      <a href="${reportUrl}" style="display:inline-block;background:#0f172a;color:#34d399;font-size:14px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;">
        View your full statement with photos →
      </a>
      <div style="font-size:11px;color:#94a3b8;margin-top:9px;">
        Every finding you're charged for, with photos. Printable.
      </div>
    </div>

    <!-- Dispute -->
    <div style="margin-top:26px;padding-top:18px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;line-height:1.7;">
      Charges reflect the cost of returning the home to its move-in condition, excluding normal wear
      and tear. If you disagree with any item, reply to this email quoting report
      #${inspection.id.slice(0, 8).toUpperCase()}${landlordName ? ` — ${esc(landlordName)} will follow up` : ''}.
      ${landlordEmail ? `<br />Contact: <a href="mailto:${esc(landlordEmail)}" style="color:#059669;text-decoration:none;">${esc(landlordEmail)}</a>` : ''}
    </div>
  </div>

  <div style="margin-top:16px;text-align:center;font-size:11px;color:#94a3b8;">
    Sent via HomeHive
  </div>
</div>
</body>
</html>`

  return { subject, html, text }
}
