// Email builders for the listing auto-archive lifecycle:
//  • warning  — sent ~3 days before a stale listing is archived
//  • archived — sent when a listing has been archived for inactivity
// Both nudge the landlord to update / re-activate from their dashboard.

function shell(badge: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.55);font-weight:600;text-transform:uppercase;letter-spacing:1px;">${badge}</div>
  </div>
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">
    ${inner}
  </div>
  <div style="margin-top:20px;text-align:center;font-size:11px;color:#9b9b9b;line-height:1.7;">
    You're receiving this because you have a listing on HomeHive.
  </div>
</div>
</body>
</html>`
}

function ctaButton(url: string, label: string): string {
  return `<div style="text-align:center;margin:24px 0 8px;">
    <a href="${url}" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;padding:13px 30px;border-radius:10px;font-size:15px;font-weight:700;">${label}</a>
  </div>`
}

export function buildArchiveWarningEmail(params: {
  landlordName: string | null
  propertyName: string
  daysInactive: number
  manageUrl: string
}): { subject: string; html: string } {
  const { landlordName, propertyName, daysInactive, manageUrl } = params
  const greeting = landlordName ? `Hi ${landlordName},` : 'Hi there,'
  const subject = `Your listing "${propertyName}" will be archived in ~3 days`
  const html = shell('Listing Update', `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#1a1a1a;">${greeting}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      Your listing <strong>${propertyName}</strong> hasn't had any new leads or updates in <strong>${daysInactive} days</strong>. To keep HomeHive showing only fresh, available homes to students, listings inactive for 30 days are automatically archived.
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 8px;">
      <div style="font-size:14px;font-weight:700;color:#92400e;">⏳ Archiving in about 3 days</div>
      <div style="font-size:13px;color:#78350f;margin-top:4px;line-height:1.6;">Any edit — refresh the price, photos, or availability — keeps it live and resets the clock.</div>
    </div>
    ${ctaButton(manageUrl, 'Keep My Listing Live →')}
    <p style="margin:8px 0 0;font-size:12px;color:#9b9b9b;text-align:center;">Archived listings are easy to re-activate anytime from your dashboard.</p>
  `)
  return { subject, html }
}

export function buildArchivedEmail(params: {
  landlordName: string | null
  propertyName: string
  manageUrl: string
}): { subject: string; html: string } {
  const { landlordName, propertyName, manageUrl } = params
  const greeting = landlordName ? `Hi ${landlordName},` : 'Hi there,'
  const subject = `Your listing "${propertyName}" has been archived`
  const html = shell('Listing Archived', `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#1a1a1a;">${greeting}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      We've archived your listing <strong>${propertyName}</strong> after 30 days with no new leads or updates. It's no longer shown on the home or browse pages — this keeps students seeing only fresh, available homes.
    </p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      Still renting it out? Re-activating takes one click and puts it right back in front of students.
    </p>
    ${ctaButton(manageUrl, 'Re-activate Listing →')}
    <p style="margin:8px 0 0;font-size:12px;color:#9b9b9b;text-align:center;">Nothing was deleted — all your photos and details are saved.</p>
  `)
  return { subject, html }
}
