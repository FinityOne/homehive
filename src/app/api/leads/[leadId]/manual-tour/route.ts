/**
 * POST /api/leads/[leadId]/manual-tour
 * Landlord manually books a tour (override — no slot selection needed by tenant).
 * Sends confirmation email with ICS to both tenant and landlord.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'
import { notifyLandlord } from '@/lib/notifyLandlord'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

function buildIcs(params: {
  uid: string; title: string; description: string; location: string
  startUtc: string; endUtc: string; organizer: string
  attendeeEmail: string; attendeeName: string
}): string {
  const escape = (s: string) => s.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HomeHive//Tour//EN',
    'METHOD:REQUEST',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTART:${params.startUtc}`,
    `DTEND:${params.endUtc}`,
    `SUMMARY:${escape(params.title)}`,
    `DESCRIPTION:${escape(params.description)}`,
    `LOCATION:${escape(params.location)}`,
    `ORGANIZER;CN=HomeHive:mailto:${params.organizer}`,
    `ATTENDEE;RSVP=TRUE;CN=${escape(params.attendeeName)}:mailto:${params.attendeeEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Tour reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

function toUtcStamp(date: string, timeSlot: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = timeSlot.split(':').map(Number)
  const utcHour = hour + 7 // MST UTC-7
  return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}T${String(utcHour % 24).padStart(2,'0')}${String(minute).padStart(2,'0')}00Z`
}

function formatReadableDate(date: string, timeSlot: string): string {
  const d = new Date(`${date}T${timeSlot}:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' })
    + ' MST'
}

function googleCalendarLink(title: string, startUtc: string, endUtc: string, location: string, details: string): string {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${startUtc}/${endUtc}`, location, details })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { date, time_slot, custom_note } = body as {
    date: string      // "2026-04-15"
    time_slot: string // "14:00"
    custom_note?: string
  }

  if (!date || !time_slot) return Response.json({ error: 'date and time_slot required' }, { status: 400 })

  // Fetch lead
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', leadId).single()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Verify ownership
  const { data: prop } = await supabaseAdmin
    .from('properties').select('name, address, owner_id').eq('slug', lead.property).single()
  if (!prop || prop.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Cancel any existing tour for this lead
  await supabaseAdmin.from('tours').update({ status: 'cancelled' }).eq('lead_id', leadId).eq('status', 'confirmed')

  // Create tour
  const { data: tour, error: tourErr } = await supabaseAdmin
    .from('tours')
    .insert([{
      lead_id: leadId,
      property_slug: lead.property,
      landlord_id: user.id,
      scheduled_date: date,
      time_slot,
      booked_by: 'landlord',
      custom_note: custom_note || null,
    }])
    .select()
    .single()

  if (tourErr || !tour) return Response.json({ error: 'Failed to create tour' }, { status: 500 })

  // Update lead status
  await supabaseAdmin.from('leads').update({ status: 'tour_scheduled' }).eq('id', leadId)

  // Build calendar data
  const startUtc = toUtcStamp(date, time_slot)
  const [sh, sm] = time_slot.split(':').map(Number)
  const endMin = sm + 30
  const endHour = sh + Math.floor(endMin / 60)
  const endSlot = `${String(endHour).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`
  const endUtc = toUtcStamp(date, endSlot)
  const readableDate = formatReadableDate(date, time_slot)
  const tourTitle = `Property Tour — ${prop.name}`
  const address = prop.address || prop.name
  const tenantName = lead.first_name || lead.email

  // Get landlord details
  let landlordEmail = process.env.ADMIN_EMAIL!
  let landlordName = ''
  try {
    const { data: { user: lu } } = await supabaseAdmin.auth.admin.getUserById(user.id)
    if (lu?.email) landlordEmail = lu.email
  } catch (_) {}
  try {
    const { data: lp } = await supabaseAdmin.from('profiles').select('first_name').eq('id', user.id).single()
    if (lp?.first_name) landlordName = lp.first_name
  } catch (_) {}

  const noteSection = custom_note
    ? `\n\nNote from your host: ${custom_note}`
    : ''

  const tenantDesc = `Your 30-minute property tour has been scheduled!\n\nProperty: ${prop.name}\nAddress: ${address}\nDate & Time: ${readableDate}${noteSection}`
  const gcalTenant = googleCalendarLink(tourTitle, startUtc, endUtc, address, tenantDesc.replace(/\n/g, '\\n'))
  const icsTenant = buildIcs({
    uid: `tour-${tour.id}@homehive.live`,
    title: tourTitle,
    description: tenantDesc,
    location: address,
    startUtc, endUtc,
    organizer: 'hello@homehive.live',
    attendeeEmail: lead.email,
    attendeeName: tenantName,
  })

  // Send tenant email
  try {
    const subject = `📅 Your tour is scheduled — ${readableDate}`
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: buildTenantManualEmail({
        tenantName, propName: prop.name, address, readableDate,
        gcalLink: gcalTenant, customNote: custom_note || '', landlordName,
      }),
      attachments: [{ filename: 'tour.ics', content: Buffer.from(icsTenant).toString('base64') }],
    })
    await logEmail(leadId, 'tour_confirmation_tenant', subject, lead.email, { property: prop.name, date, time: time_slot, manual: true })
  } catch (e) { console.error('Tenant email error:', e) }

  // Send landlord email
  try {
    const landlordDesc = `Tour with ${tenantName} (${lead.email})\n\nProperty: ${prop.name}\nAddress: ${address}\nDate & Time: ${readableDate}${noteSection}`
    const gcalLandlord = googleCalendarLink(tourTitle, startUtc, endUtc, address, landlordDesc.replace(/\n/g, '\\n'))
    const icsLandlord = buildIcs({
      uid: `tour-${tour.id}-landlord@homehive.live`,
      title: tourTitle,
      description: landlordDesc,
      location: address,
      startUtc, endUtc,
      organizer: 'hello@homehive.live',
      attendeeEmail: landlordEmail,
      attendeeName: landlordName || 'Landlord',
    })
    const lSubject = `📅 Tour scheduled: ${tenantName} — ${readableDate}`
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: landlordEmail,
      subject: lSubject,
      html: buildLandlordManualEmail({ landlordName, tenantName, tenantEmail: lead.email, propName: prop.name, address, readableDate, gcalLink: gcalLandlord, customNote: custom_note || '' }),
      attachments: [{ filename: 'tour.ics', content: Buffer.from(icsLandlord).toString('base64') }],
    })
    await logEmail(leadId, 'tour_confirmation_landlord', lSubject, landlordEmail, { property: prop.name, tenant: tenantName })
  } catch (e) { console.error('Landlord email error:', e) }

  // Notify landlord of manually scheduled tour
  await notifyLandlord({
    landlordId: user.id,
    type: 'tour_booked',
    leadId,
    title: `Tour scheduled: ${tenantName}`,
    body: `Manually set for ${readableDate}`,
    href: `/landlord/leads/${leadId}`,
  }).catch(() => {})

  return Response.json({ success: true, tour, readableDate })
}

function buildTenantManualEmail(p: {
  tenantName: string; propName: string; address: string; readableDate: string
  gcalLink: string; customNote: string; landlordName: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;padding:36px 32px 40px;">

    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:44px;margin-bottom:12px;">🏠</div>
      <h1 style="margin:0 0 10px;font-size:23px;font-weight:800;color:#1a1a1a;letter-spacing:-0.4px;">Your tour is all set!</h1>
      <p style="margin:0;font-size:15px;color:#6b6b6b;line-height:1.6;">
        ${p.landlordName ? `<strong>${p.landlordName}</strong> has` : 'Your host has'} confirmed a time for your tour of <strong>${p.propName}</strong>.
      </p>
    </div>

    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:14px;padding:24px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:16px;">Confirmed Details</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;width:90px;">Property</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #f0ede6;">${p.propName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;">When</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #f0ede6;">${p.readableDate}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;">Duration</td><td style="padding:8px 0;border-bottom:1px solid #f0ede6;">30 minutes</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;">Address</td><td style="padding:8px 0;">📍 ${p.address}</td></tr>
      </table>
    </div>

    ${p.customNote ? `
    <div style="background:#fff8e6;border-left:4px solid #FFC627;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b07c00;margin-bottom:6px;">Note from your host</div>
      <p style="margin:0;font-size:14px;color:#4a3800;line-height:1.6;">${p.customNote}</p>
    </div>` : ''}

    <div style="text-align:center;margin-bottom:24px;">
      <a href="${p.gcalLink}" target="_blank"
         style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:15px;font-weight:700;padding:16px 36px;border-radius:12px;margin-bottom:10px;">
        📅 Add to Google Calendar
      </a>
      <div style="font-size:12px;color:#9b9b9b;">Or open the .ics file attached to this email</div>
    </div>

    <div style="border-top:1px solid #f0ede6;padding-top:18px;font-size:13px;color:#6b6b6b;line-height:1.7;text-align:center;">
      Questions? Reply to this email or reach us at <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
    </div>
  </div>

  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></div>
</div>
</body>
</html>`
}

function buildLandlordManualEmail(p: {
  landlordName: string; tenantName: string; tenantEmail: string; propName: string
  address: string; readableDate: string; gcalLink: string; customNote: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:5px 12px;border-radius:20px;border:1px solid rgba(255,198,39,0.3);">📅 Tour Scheduled</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="margin:0 0 20px;font-size:16px;color:#1a1a1a;font-weight:600;">Hey${p.landlordName ? ` ${p.landlordName}` : ''}! Here's your tour confirmation.</p>

    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;width:90px;">Tenant</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f0ede6;">${p.tenantName} — <a href="mailto:${p.tenantEmail}" style="color:#8C1D40;text-decoration:none;">${p.tenantEmail}</a></td></tr>
        <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;">Property</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f0ede6;">${p.propName}</td></tr>
        <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;">When</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f0ede6;">${p.readableDate}</td></tr>
        <tr><td style="padding:7px 0;color:#6b6b6b;">Address</td><td style="padding:7px 0;">📍 ${p.address}</td></tr>
      </table>
    </div>

    ${p.customNote ? `
    <div style="background:#fff8e6;border-left:3px solid #FFC627;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;font-size:13px;color:#4a3800;line-height:1.6;">
      <strong>Your note:</strong> ${p.customNote}
    </div>` : ''}

    <div style="text-align:center;">
      <a href="${p.gcalLink}" target="_blank"
         style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:10px;">
        📅 Add to Google Calendar
      </a>
      <div style="font-size:12px;color:#9b9b9b;margin-top:8px;">Or open the .ics attachment</div>
    </div>
  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></div>
</div>
</body>
</html>`
}
