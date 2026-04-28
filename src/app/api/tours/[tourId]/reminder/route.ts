/**
 * POST /api/tours/[tourId]/reminder
 * Sends a 24-hour tour reminder email to the tenant.
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ tourId: string }> }) {
  const { tourId } = await params

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch tour
  const { data: tour } = await supabaseAdmin.from('tours').select('*').eq('id', tourId).single()
  if (!tour) return Response.json({ error: 'Tour not found' }, { status: 404 })
  if (tour.landlord_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch lead
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', tour.lead_id).single()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Fetch property
  const { data: prop } = await supabaseAdmin
    .from('properties').select('name, address').eq('slug', tour.property_slug).single()

  const readableDate = formatReadableDate(tour.scheduled_date, tour.time_slot)
  const propName = prop?.name || tour.property_slug
  const address = prop?.address || ''
  const tenantName = lead.first_name || lead.email

  const startUtc = toUtcStamp(tour.scheduled_date, tour.time_slot)
  const [sh, sm] = tour.time_slot.split(':').map(Number)
  const endMin = sm + 30
  const endHour = sh + Math.floor(endMin / 60)
  const endSlot = `${String(endHour).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`
  const endUtc = toUtcStamp(tour.scheduled_date, endSlot)
  const tourTitle = `Property Tour — ${propName}`
  const gcalLink = googleCalendarLink(tourTitle, startUtc, endUtc, address, `Tour reminder: ${propName} at ${address}`)

  const subject = `⏰ Tour reminder: ${propName} — ${readableDate}`
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;padding:32px;">

    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:44px;margin-bottom:10px;">⏰</div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;">Tour reminder!</h1>
      <p style="margin:0;font-size:15px;color:#6b6b6b;line-height:1.6;">Just a friendly reminder, <strong>${tenantName}</strong>.</p>
    </div>

    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;width:90px;">Property</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #f0ede6;">${propName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;">When</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0ede6;">${readableDate}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;">Address</td><td style="padding:8px 0;">📍 ${address}</td></tr>
      </table>
    </div>

    ${tour.custom_note ? `
    <div style="background:#fff8e6;border-left:4px solid #FFC627;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:24px;font-size:14px;color:#4a3800;line-height:1.6;">
      <strong>Note from host:</strong> ${tour.custom_note}
    </div>` : ''}

    <div style="text-align:center;margin-bottom:20px;">
      <a href="${gcalLink}" target="_blank"
         style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;">
        📅 View in Google Calendar
      </a>
    </div>

    <div style="border-top:1px solid #f0ede6;padding-top:16px;font-size:13px;color:#6b6b6b;text-align:center;line-height:1.7;">
      Questions? Reply to this email or reach us at <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
    </div>
  </div>

  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></div>
</div>
</body>
</html>`,
    })
    await supabaseAdmin.from('tours').update({ reminder_sent: true }).eq('id', tourId)
    await logEmail(tour.lead_id, 'tour_reminder', subject, lead.email, { property: propName, tourId })
  } catch (e) {
    console.error('Reminder email error:', e)
    return Response.json({ error: 'Failed to send reminder' }, { status: 500 })
  }

  return Response.json({ success: true })
}
