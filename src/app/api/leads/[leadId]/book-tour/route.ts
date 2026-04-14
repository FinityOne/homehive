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
  uid: string
  title: string
  description: string
  location: string
  startUtc: string // e.g. "20260413T140000Z"
  endUtc: string
  organizer: string
  attendeeEmail: string
  attendeeName: string
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
  // date: "2026-04-13", timeSlot: "14:00" — treat as America/Phoenix (UTC-7, no DST)
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = timeSlot.split(':').map(Number)
  const utcHour = hour + 7 // MST is UTC-7
  return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}T${String(utcHour).padStart(2,'0')}${String(minute).padStart(2,'0')}00Z`
}

function formatReadableDate(date: string, timeSlot: string): string {
  const d = new Date(`${date}T${timeSlot}:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' })
    + ' MST'
}

function googleCalendarLink(title: string, startUtc: string, endUtc: string, location: string, details: string): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startUtc}/${endUtc}`,
    location,
    details,
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  // Auth check
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { availability_id } = body as { availability_id: string }

  // Fetch lead
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', leadId).single()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Verify the authenticated user's email matches the lead (tenant must match)
  if (user.email?.toLowerCase() !== lead.email?.toLowerCase()) {
    return Response.json({ error: 'Email mismatch' }, { status: 403 })
  }

  // Fetch the availability slot
  const { data: slot } = await supabaseAdmin
    .from('tour_availabilities').select('*').eq('id', availability_id).single()
  if (!slot) return Response.json({ error: 'Slot not found' }, { status: 404 })
  if (slot.is_booked) return Response.json({ error: 'Slot already taken — please choose another.' }, { status: 409 })

  // Fetch property
  const { data: prop } = await supabaseAdmin
    .from('properties').select('name, address, owner_id').eq('slug', lead.property).single()
  if (!prop) return Response.json({ error: 'Property not found' }, { status: 404 })

  // Link user to lead
  await supabaseAdmin.from('leads').update({ user_id: user.id }).eq('id', leadId)

  // Mark slot as booked
  await supabaseAdmin.from('tour_availabilities').update({ is_booked: true }).eq('id', availability_id)

  // Create tour record
  const { data: tour, error: tourErr } = await supabaseAdmin
    .from('tours')
    .insert([{
      lead_id: leadId,
      property_slug: lead.property,
      landlord_id: prop.owner_id,
      availability_id,
      scheduled_date: slot.date,
      time_slot: slot.time_slot,
      booked_by: 'tenant',
    }])
    .select()
    .single()

  if (tourErr || !tour) return Response.json({ error: 'Failed to book tour' }, { status: 500 })

  // Update lead status
  await supabaseAdmin.from('leads').update({ status: 'tour_scheduled' }).eq('id', leadId)

  // Build calendar data
  const startUtc = toUtcStamp(slot.date, slot.time_slot)
  const [sh, sm] = slot.time_slot.split(':').map(Number)
  const endMinutes = sm + 30
  const endHour = sh + Math.floor(endMinutes / 60)
  const endMin = endMinutes % 60
  const endSlot = `${String(endHour).padStart(2,'0')}:${String(endMin).padStart(2,'0')}`
  const endUtc = toUtcStamp(slot.date, endSlot)
  const readableDate = formatReadableDate(slot.date, slot.time_slot)
  const tourTitle = `Property Tour — ${prop.name}`
  const address = prop.address || prop.name
  const tenantName = lead.first_name || lead.email

  const gcalLink = googleCalendarLink(
    tourTitle,
    startUtc, endUtc,
    address,
    `Your tour of ${prop.name} is confirmed!\\n\\nAddress: ${address}\\n\\nSee you there!`
  )

  const ics = buildIcs({
    uid: `tour-${tour.id}@homehive.live`,
    title: tourTitle,
    description: `Your 30-minute tour of ${prop.name} is confirmed.\n\nAddress: ${address}\n\nSee you there!`,
    location: address,
    startUtc,
    endUtc,
    organizer: 'hello@homehive.live',
    attendeeEmail: lead.email,
    attendeeName: tenantName,
  })

  // Email to tenant
  try {
    const subject = `✅ Your tour is confirmed — ${readableDate}`
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: buildTenantConfirmationEmail({ tenantName, propName: prop.name, address, readableDate, gcalLink, tourTitle }),
      attachments: [{ filename: 'tour.ics', content: Buffer.from(ics).toString('base64') }],
    })
    await logEmail(leadId, 'tour_confirmation_tenant', subject, lead.email, { property: prop.name, date: slot.date, time: slot.time_slot })
  } catch (e) { console.error('Tenant confirmation email error:', e) }

  // Get landlord email
  let landlordEmail = process.env.ADMIN_EMAIL!
  let landlordName = ''
  try {
    const { data: { user: lu } } = await supabaseAdmin.auth.admin.getUserById(prop.owner_id)
    if (lu?.email) landlordEmail = lu.email
  } catch (_) {}
  try {
    const { data: lp } = await supabaseAdmin.from('profiles').select('first_name').eq('id', prop.owner_id).single()
    if (lp?.first_name) landlordName = lp.first_name
  } catch (_) {}

  // Email to landlord
  try {
    const landlordGcal = googleCalendarLink(
      tourTitle,
      startUtc, endUtc,
      address,
      `Tour with ${tenantName} (${lead.email})\\n\\nProperty: ${prop.name}\\nAddress: ${address}`
    )
    const landlordIcs = buildIcs({
      uid: `tour-${tour.id}-landlord@homehive.live`,
      title: tourTitle,
      description: `Tour with ${tenantName} (${lead.email})\n\nProperty: ${prop.name}\nAddress: ${address}`,
      location: address,
      startUtc, endUtc,
      organizer: 'hello@homehive.live',
      attendeeEmail: landlordEmail,
      attendeeName: landlordName || 'Landlord',
    })
    const lSubject = `📅 Tour booked: ${tenantName} — ${readableDate}`
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: landlordEmail,
      subject: lSubject,
      html: buildLandlordConfirmationEmail({ landlordName, tenantName, tenantEmail: lead.email, propName: prop.name, address, readableDate, gcalLink: landlordGcal }),
      attachments: [{ filename: 'tour.ics', content: Buffer.from(landlordIcs).toString('base64') }],
    })
    await logEmail(leadId, 'tour_confirmation_landlord', lSubject, landlordEmail, { property: prop.name, tenant: tenantName })
  } catch (e) { console.error('Landlord confirmation email error:', e) }

  // Notify landlord of tour booking
  if (prop.owner_id) {
    await notifyLandlord({
      landlordId: prop.owner_id,
      type: 'tour_booked',
      leadId,
      title: `Tour booked: ${tenantName}`,
      body: `Scheduled for ${readableDate} at ${prop.name}`,
      href: `/landlord/leads/${leadId}`,
    }).catch(() => {})
  }

  return Response.json({ success: true, tour })
}

function buildTenantConfirmationEmail(p: {
  tenantName: string; propName: string; address: string
  readableDate: string; gcalLink: string; tourTitle: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;padding:36px 32px 40px;">

    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:48px;margin-bottom:12px;">🎊</div>
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1a1a1a;letter-spacing:-0.4px;">Your tour is confirmed!</h1>
      <p style="margin:0;font-size:15px;color:#6b6b6b;line-height:1.6;">Can't wait to see you there, <strong>${p.tenantName}</strong>.</p>
    </div>

    <!-- Details card -->
    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:14px;padding:24px;margin-bottom:28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:16px;">Tour Details</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;width:100px;vertical-align:top;">Property</td><td style="padding:8px 0;font-weight:700;color:#1a1a1a;border-bottom:1px solid #f0ede6;">${p.propName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;vertical-align:top;">When</td><td style="padding:8px 0;font-weight:600;color:#1a1a1a;border-bottom:1px solid #f0ede6;">${p.readableDate}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;border-bottom:1px solid #f0ede6;vertical-align:top;">Duration</td><td style="padding:8px 0;color:#1a1a1a;border-bottom:1px solid #f0ede6;">30 minutes</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b;vertical-align:top;">Address</td><td style="padding:8px 0;color:#1a1a1a;">📍 ${p.address}</td></tr>
      </table>
    </div>

    <!-- Add to calendar CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${p.gcalLink}" target="_blank"
         style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:15px;font-weight:700;padding:16px 36px;border-radius:12px;margin-bottom:12px;">
        📅 Add to Google Calendar
      </a>
      <div style="font-size:12px;color:#9b9b9b;">Or open the attached .ics file to add to any calendar app</div>
    </div>

    <div style="border-top:1px solid #f0ede6;padding-top:20px;font-size:13px;color:#6b6b6b;line-height:1.7;text-align:center;">
      Have questions? Reply to this email or reach us at <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
    </div>
  </div>

  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a></div>
</div>
</body>
</html>`
}

function buildLandlordConfirmationEmail(p: {
  landlordName: string; tenantName: string; tenantEmail: string
  propName: string; address: string; readableDate: string; gcalLink: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:5px 12px;border-radius:20px;border:1px solid rgba(255,198,39,0.3);">📅 Tour Booked</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="margin:0 0 20px;font-size:16px;color:#1a1a1a;font-weight:600;">
      Hey${p.landlordName ? ` ${p.landlordName}` : ''}! A tour has been booked.
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#059669;margin-bottom:14px;">Booking Confirmed</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:7px 0;color:#4b5563;border-bottom:1px solid #d1fae5;width:90px;">Tenant</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #d1fae5;">${p.tenantName} — <a href="mailto:${p.tenantEmail}" style="color:#059669;text-decoration:none;">${p.tenantEmail}</a></td></tr>
        <tr><td style="padding:7px 0;color:#4b5563;border-bottom:1px solid #d1fae5;">Property</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #d1fae5;">${p.propName}</td></tr>
        <tr><td style="padding:7px 0;color:#4b5563;border-bottom:1px solid #d1fae5;">When</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #d1fae5;">${p.readableDate}</td></tr>
        <tr><td style="padding:7px 0;color:#4b5563;">Address</td><td style="padding:7px 0;">📍 ${p.address}</td></tr>
      </table>
    </div>

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
