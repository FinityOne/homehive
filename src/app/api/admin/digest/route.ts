import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

export async function GET(req: Request) {
  // Verify cron secret to prevent unauthorized triggers
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) return Response.json({ error: 'ADMIN_EMAIL not configured' }, { status: 500 })

  // "Today" in PST — the 24-hour window that just ended at 6 PM PST
  // We use UTC midnight-to-midnight of the current UTC day since cron fires at 02:00 UTC = 6 PM PST
  const nowUtc = new Date()
  const todayStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 1, 8, 0, 0)) // yesterday 08:00 UTC = midnight PST
  const todayEnd = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 8, 0, 0))       // today 08:00 UTC = midnight PST
  const todayStartIso = todayStart.toISOString()
  const todayEndIso = todayEnd.toISOString()

  const dateLabel = todayStart.toLocaleDateString('en-US', {
    timeZone: 'America/Phoenix', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  try {
    // ── Signups ──────────────────────────────────────────────────────────────
    const [{ count: signupsToday }, { count: signupsTotal }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true })
        .gte('created_at', todayStartIso).lt('created_at', todayEndIso),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
    ])

    // Breakdown by role today
    const [{ count: landlordsToday }, { count: landlordsTotal }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'landlord')
        .gte('created_at', todayStartIso).lt('created_at', todayEndIso),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'landlord'),
    ])

    // ── Active listings ──────────────────────────────────────────────────────
    const [{ count: listingsToday }, { count: listingsTotal }] = await Promise.all([
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .eq('admin_status', 'active').eq('is_test', false)
        .gte('created_at', todayStartIso).lt('created_at', todayEndIso),
      supabase.from('properties').select('*', { count: 'exact', head: true })
        .eq('admin_status', 'active').eq('is_test', false),
    ])

    // Pending review
    const { count: listingsPending } = await supabase.from('properties')
      .select('*', { count: 'exact', head: true }).eq('admin_status', 'pending')

    // ── Leads ────────────────────────────────────────────────────────────────
    const [{ count: leadsToday }, { count: leadsTotal }] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true })
        .gte('created_at', todayStartIso).lt('created_at', todayEndIso),
      supabase.from('leads').select('*', { count: 'exact', head: true }),
    ])

    // ── Pre-screens ──────────────────────────────────────────────────────────
    const [{ count: prescreensToday }, { count: prescreensTotal }] = await Promise.all([
      supabase.from('pre_screens').select('*', { count: 'exact', head: true })
        .gte('created_at', todayStartIso).lt('created_at', todayEndIso),
      supabase.from('pre_screens').select('*', { count: 'exact', head: true }),
    ])

    // ── Claims ───────────────────────────────────────────────────────────────
    const [{ count: claimsToday }, { count: claimsTotal }] = await Promise.all([
      supabase.from('email_logs').select('*', { count: 'exact', head: true })
        .eq('type', 'admin_claim_notify')
        .gte('created_at', todayStartIso).lt('created_at', todayEndIso),
      supabase.from('email_logs').select('*', { count: 'exact', head: true })
        .eq('type', 'admin_claim_notify'),
    ])

    // ── Pre-screen conversion rate ────────────────────────────────────────────
    const convRate = leadsTotal && leadsTotal > 0
      ? Math.round(((prescreensTotal ?? 0) / leadsTotal) * 100)
      : 0

    // ── Helper ────────────────────────────────────────────────────────────────
    const fmt = (n: number | null) => (n ?? 0).toLocaleString()
    const delta = (n: number | null) => {
      const v = n ?? 0
      return v > 0 ? `<span style="color:#16a34a;font-weight:700;">+${v}</span>` : `<span style="color:#9b9b9b;">—</span>`
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

    // ── Build email ───────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:22px 28px;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">Home<em style="color:#FFC627;font-style:italic;">Hive</em></span>
    <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#FFC627;background:rgba(255,198,39,0.15);padding:4px 12px;border-radius:12px;border:1px solid rgba(255,198,39,0.3);">Daily Digest</span>
  </div>

  <!-- Date bar -->
  <div style="background:#8C1D40;padding:12px 28px;">
    <div style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.9);">${dateLabel}</div>
  </div>

  <!-- Body -->
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">

    <p style="margin:0 0 24px;font-size:14px;color:#6b6b6b;line-height:1.6;">
      Here's your daily snapshot of HomeHive activity. Numbers in green represent activity in the last 24 hours.
    </p>

    <!-- Stats grid -->
    <table style="width:100%;border-collapse:collapse;">

      <!-- Section: Users -->
      <tr>
        <td colspan="3" style="padding:8px 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9b9b9b;border-bottom:2px solid #f4f1eb;">Users</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;width:50%;">Total accounts</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(signupsTotal)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;width:60px;">${delta(signupsToday)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;">Landlords</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(landlordsTotal)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;">${delta(landlordsToday)}</td>
      </tr>

      <!-- Section: Listings -->
      <tr>
        <td colspan="3" style="padding:18px 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9b9b9b;border-bottom:2px solid #f4f1eb;">Listings</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;">Active listings</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(listingsTotal)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;">${delta(listingsToday)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;">Pending review</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:${(listingsPending ?? 0) > 0 ? '#f59e0b' : '#1a1a1a'};border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(listingsPending)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;">
          ${(listingsPending ?? 0) > 0 ? `<a href="${siteUrl}/admin/properties?status=pending" style="font-size:11px;font-weight:600;color:#f59e0b;text-decoration:none;">Review →</a>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;">Claimed listings</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(claimsTotal)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;">${delta(claimsToday)}</td>
      </tr>

      <!-- Section: Leads -->
      <tr>
        <td colspan="3" style="padding:18px 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9b9b9b;border-bottom:2px solid #f4f1eb;">Leads & Pipeline</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;">Total leads</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(leadsTotal)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;">${delta(leadsToday)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;border-bottom:1px solid #f4f1eb;">Pre-screens completed</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f4f1eb;text-align:right;">${fmt(prescreensTotal)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f4f1eb;text-align:right;">${delta(prescreensToday)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:14px;color:#1a1a1a;">Pre-screen rate</td>
        <td style="padding:10px 0;font-size:18px;font-weight:700;color:${convRate >= 50 ? '#16a34a' : convRate >= 25 ? '#f59e0b' : '#8C1D40'};text-align:right;">${convRate}%</td>
        <td style="padding:10px 0 10px 12px;text-align:right;font-size:11px;color:#9b9b9b;">of leads</td>
      </tr>

    </table>

    <!-- CTA -->
    <div style="margin-top:28px;display:flex;gap:10px;flex-wrap:wrap;">
      <a href="${siteUrl}/admin" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:9px;">Open admin →</a>
      <a href="${siteUrl}/admin/leads" style="display:inline-block;background:#fff;color:#1a1a1a;border:1.5px solid #e8e4db;text-decoration:none;font-size:13px;font-weight:500;padding:11px 20px;border-radius:9px;">View leads</a>
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Daily Digest · Sent at 6 PM PST · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>
</div>
</body>
</html>`

    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: adminEmail,
      subject: `HomeHive digest · ${dateLabel}`,
      html,
    })

    await logEmail('', 'admin_daily_digest', `HomeHive digest · ${dateLabel}`, adminEmail, {
      signupsToday, signupsTotal, leadsToday, leadsTotal, listingsToday, listingsTotal, prescreensToday, claimsToday,
    })

    return Response.json({ ok: true, date: dateLabel })
  } catch (err) {
    console.error('[digest] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
