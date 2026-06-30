// Server-only helper to email the admin about noteworthy platform events
// (logins, signups, listings, etc.) in a consistent format. Fire-and-forget:
// callers should not let a failed admin email break the user-facing flow.
import { Resend } from 'resend'
import { getSiteUrl } from '@/lib/siteUrl'

const resend = new Resend(process.env.RESEND_API_KEY!)

export type AdminNotifyOpts = {
  event: string                                   // short badge, e.g. "Login", "New Listing"
  subject: string                                 // email subject
  headline?: string                               // one-line summary in the body
  rows?: { label: string; value: string }[]       // key/value details table
  ctaLabel?: string
  ctaPath?: string                                // relative path; resolved against the site URL
  accent?: string                                 // badge color (hex)
}

function nowMST(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Phoenix',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' MST'
}

export async function notifyAdmin(opts: AdminNotifyOpts): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) return // silently skip if not configured

  const { event, subject, headline, rows = [], ctaLabel, ctaPath, accent = '#8C1D40' } = opts
  const allRows = [...rows, { label: 'When', value: nowMST() }]
  const cta = ctaLabel && ctaPath
    ? `<div style="margin-top:22px;"><a href="${getSiteUrl()}${ctaPath}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;">${ctaLabel} →</a></div>`
    : ''

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:12px 12px 0 0;padding:18px 24px;">
    <span style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.2px;">Home<em style="color:#FFC627;font-style:italic;">Hive</em></span>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px;padding:28px 24px;">
    <div style="display:inline-block;background:${accent}14;border:1px solid ${accent}40;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px;">${event}</div>
    ${headline ? `<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#1a1a1a;">${headline}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${allRows.map(r => `<tr>
        <td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f5f4f0;width:110px;vertical-align:top;">${r.label}</td>
        <td style="padding:8px 0;color:#1a1a1a;font-weight:500;border-bottom:1px solid #f5f4f0;">${r.value}</td>
      </tr>`).join('')}
    </table>
    ${cta}
  </div>
</div>
</body></html>`

  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: adminEmail,
      subject,
      html,
    })
  } catch (e) {
    console.error('notifyAdmin failed:', event, e)
  }
}
