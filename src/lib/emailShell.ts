/**
 * The HomeHive email chrome: dark header, status banner, white card.
 *
 * Every transactional email in the app renders this same shape, and until now
 * each one carried its own copy of the markup inline. New emails build on this
 * instead — the existing ones are left alone deliberately, since rewriting a
 * working email to share a helper risks a broken send for no visible gain.
 *
 * Table-free and inline-styled on purpose: it is what the existing emails do,
 * and it survives Gmail, Apple Mail and Outlook web, which is the whole
 * audience here.
 */

export type EmailButton = {
  label: string
  url: string
  /** A second, quieter action under the main one. */
  secondary?: boolean
}

export type EmailShellOpts = {
  /** Small uppercase line in the status banner, e.g. "Approved & Live". */
  banner: string
  /** Bold line under the banner — usually the listing or account name. */
  bannerSubject: string
  /** Banner accent. Green = good news, amber = action needed, red = declined. */
  tone?: 'good' | 'action' | 'bad'
  /** Pre-rendered HTML for the card body. */
  body: string
}

const TONES = {
  good:   { bg: '#f0fdf4', border: '#16a34a', text: '#166534' },
  action: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
  bad:    { bg: '#fff1f2', border: '#9f1239', text: '#9f1239' },
} as const

/** Escape interpolated text. Listing names and notes are user-supplied. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function emailButton(b: EmailButton): string {
  const bg = b.secondary
    ? 'background:#fff;border:1.5px solid #e8e4db;color:#1a1a1a;'
    : 'background:linear-gradient(135deg,#6c002a,#8c1d40);color:#fff;'
  return `<a href="${b.url}" style="display:inline-block;${bg}text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">${esc(b.label)}</a>`
}

/** A bulleted value list — the "what you get" block. */
export function emailChecklist(items: string[], accent = '#16a34a'): string {
  return items.map(s => (
    `<div style="font-size:13px;color:#3a3a3a;margin-bottom:9px;line-height:1.5;">` +
    `<span style="display:inline-block;width:17px;height:17px;border-radius:50%;background:${accent};color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:17px;margin-right:9px;vertical-align:middle;">&#10003;</span>` +
    `<span style="vertical-align:middle;">${s}</span></div>`
  )).join('')
}

/** A row of hard numbers. Keys are labels, values are already formatted. */
export function emailStatRow(stats: Array<[label: string, value: string]>): string {
  if (!stats.length) return ''
  const cells = stats.map(([label, value]) => (
    `<td style="padding:0 6px;text-align:center;vertical-align:top;">` +
    `<div style="font-size:21px;font-weight:800;color:#1a1a1a;letter-spacing:-0.5px;">${esc(value)}</div>` +
    `<div style="font-size:10.5px;color:#9b9b9b;line-height:1.35;margin-top:3px;">${esc(label)}</div></td>`
  )).join('')
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#faf9f6;border:1px solid #e8e4db;border-radius:10px;padding:16px 8px;margin-bottom:22px;">` +
    `<tr>${cells}</tr></table>`
  )
}

export function emailShell(opts: EmailShellOpts): string {
  const tone = TONES[opts.tone ?? 'good']
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>

  <div style="background:${tone.bg};border-left:4px solid ${tone.border};padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${tone.text};margin-bottom:4px;">${esc(opts.banner)}</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${esc(opts.bannerSubject)}</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
${opts.body}
    <p style="margin:22px 0 0;font-size:12.5px;color:#9b9b9b;line-height:1.6;">
      HomeHive &middot; built for ASU &amp; Tempe students &middot;
      <a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a>
    </p>
  </div>
</div>
</body>
</html>`
}
