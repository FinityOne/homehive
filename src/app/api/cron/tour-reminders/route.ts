/**
 * GET /api/cron/tour-reminders
 * Vercel Cron Job — runs daily to send 24h-before tour reminders.
 *
 * To enable: add to vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/tour-reminders", "schedule": "0 15 * * *" }]
 * }
 * (Runs daily at 3pm UTC = 8am MST)
 *
 * Secure with CRON_SECRET env var in Vercel.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

function formatReadableDate(date: string, timeSlot: string): string {
  // Suffix -07:00 so the Date is parsed as MST (Phoenix = UTC-7, no DST)
  const d = new Date(`${date}T${timeSlot}:00-07:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' })
    + ' MST'
}

function toUtcStamp(date: string, timeSlot: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = timeSlot.split(':').map(Number)
  const utcHour = hour + 7
  return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}T${String(utcHour % 24).padStart(2,'0')}${String(minute).padStart(2,'0')}00Z`
}

function googleCalendarLink(title: string, startUtc: string, endUtc: string, location: string, details: string): string {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${startUtc}/${endUtc}`, location, details })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find tours scheduled for tomorrow (next ~24-28h window) that haven't been reminded
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDate = tomorrow.toISOString().split('T')[0]

  const { data: tours, error } = await supabaseAdmin
    .from('tours')
    .select('*')
    .eq('scheduled_date', tomorrowDate)
    .eq('status', 'confirmed')
    .eq('reminder_sent', false)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!tours || tours.length === 0) return Response.json({ sent: 0 })

  let sent = 0
  for (const tour of tours) {
    try {
      const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', tour.lead_id).single()
      const { data: prop } = await supabaseAdmin.from('properties').select('name, address').eq('slug', tour.property_slug).single()
      if (!lead || !prop) continue

      const readableDate = formatReadableDate(tour.scheduled_date, tour.time_slot)
      const tenantName = lead.first_name || lead.email
      const startUtc = toUtcStamp(tour.scheduled_date, tour.time_slot)
      const [sh, sm] = tour.time_slot.split(':').map(Number)
      const endMin = sm + 30; const endHour = sh + Math.floor(endMin / 60)
      const endSlot = `${String(endHour).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`
      const endUtc = toUtcStamp(tour.scheduled_date, endSlot)
      const tourTitle = `Property Tour — ${prop.name}`
      const gcalLink = googleCalendarLink(tourTitle, startUtc, endUtc, prop.address, `Tour reminder: ${prop.name}`)
      const subject = `⏰ Reminder: Your tour tomorrow — ${prop.name}`

      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: lead.email,
        subject,
        html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;text-align:center;">
    <div style="font-size:20px;font-weight:800;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:40px;margin-bottom:8px;">⏰</div>
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1a1a1a;">Your tour is tomorrow!</h1>
      <p style="margin:0;font-size:14px;color:#6b6b6b;">Hi <strong>${tenantName}</strong> — just a quick reminder!</p>
    </div>
    <div style="background:#faf9f6;border-radius:10px;padding:18px;margin-bottom:20px;font-size:14px;">
      <div><strong>${prop.name}</strong></div>
      <div style="color:#6b6b6b;margin-top:6px;">${readableDate}</div>
      <div style="color:#6b6b6b;margin-top:4px;">📍 ${prop.address}</div>
    </div>
    <div style="text-align:center;">
      <a href="${gcalLink}" style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:10px;">📅 View in Calendar</a>
    </div>
  </div>
</div>
</body></html>`,
      })

      await supabaseAdmin.from('tours').update({ reminder_sent: true }).eq('id', tour.id)
      await logEmail(tour.lead_id, 'tour_reminder', subject, lead.email, { property: prop.name, auto: true })
      sent++
    } catch (e) {
      console.error(`Reminder failed for tour ${tour.id}:`, e)
    }
  }

  return Response.json({ sent, total: tours.length })
}
