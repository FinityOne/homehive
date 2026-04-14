/**
 * POST /api/tours/[tourId]/cancel
 * Landlord cancels a confirmed tour. Sends METHOD:CANCEL ICS emails to both parties.
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

function toUtcStamp(date: string, timeSlot: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = timeSlot.split(':').map(Number)
  const utcHour = hour + 7 // MST = UTC-7
  return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}T${String(utcHour % 24).padStart(2,'0')}${String(minute).padStart(2,'0')}00Z`
}

function formatReadableDate(date: string, timeSlot: string): string {
  const d = new Date(`${date}T${timeSlot}:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' })
    + ' MST'
}

function buildCancelIcs(params: {
  uid: string
  title: string
  startUtc: string
  endUtc: string
  organizerEmail: string
  attendeeEmail: string
  attendeeName: string
}): string {
  const escape = (s: string) => s.replace(/[\\;,]/g, m => `\\${m}`).replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HomeHive//Tour//EN',
    'METHOD:CANCEL',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTART:${params.startUtc}`,
    `DTEND:${params.endUtc}`,
    `SUMMARY:${escape(params.title)}`,
    'STATUS:CANCELLED',
    'SEQUENCE:1',
    `ORGANIZER;CN=HomeHive:mailto:${params.organizerEmail}`,
    `ATTENDEE;RSVP=TRUE;CN=${escape(params.attendeeName)}:mailto:${params.attendeeEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tourId: string }> }) {
  const { tourId } = await params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { reason, notes } = body as { reason: string; notes?: string }
  if (!reason) return Response.json({ error: 'Cancellation reason is required' }, { status: 400 })

  // Fetch tour
  const { data: tour } = await supabaseAdmin.from('tours').select('*').eq('id', tourId).single()
  if (!tour) return Response.json({ error: 'Tour not found' }, { status: 404 })
  if (tour.landlord_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (tour.status === 'cancelled') return Response.json({ error: 'Tour already cancelled' }, { status: 400 })

  // Fetch lead
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', tour.lead_id).single()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Fetch property
  const { data: prop } = await supabaseAdmin
    .from('properties').select('name, address, owner_id').eq('slug', tour.property_slug).single()
  if (!prop) return Response.json({ error: 'Property not found' }, { status: 404 })

  // Cancel tour
  await supabaseAdmin.from('tours').update({
    status: 'cancelled',
    cancellation_reason: reason,
    cancellation_notes: notes || null,
    cancelled_at: new Date().toISOString(),
  }).eq('id', tourId)

  // Free availability slot if linked
  if (tour.availability_id) {
    await supabaseAdmin.from('tour_availabilities')
      .update({ is_booked: false })
      .eq('id', tour.availability_id)
  }

  // Revert lead status — back to qualified if prescreen exists, otherwise engaged
  const { data: prescreen } = await supabaseAdmin
    .from('pre_screens').select('id').eq('lead_id', tour.lead_id).maybeSingle()
  const revertStatus = prescreen ? 'qualified' : 'engaged'
  await supabaseAdmin.from('leads').update({ status: revertStatus }).eq('id', tour.lead_id)

  // Build calendar data for ICS cancellation
  const startUtc = toUtcStamp(tour.scheduled_date, tour.time_slot)
  const [sh, sm] = tour.time_slot.split(':').map(Number)
  const endMin = sm + 30
  const endHour = sh + Math.floor(endMin / 60)
  const endUtc = toUtcStamp(tour.scheduled_date, `${String(endHour).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`)
  const readableDate = formatReadableDate(tour.scheduled_date, tour.time_slot)
  const propName = prop.name
  const address = prop.address || propName
  const tenantName = lead.first_name || lead.email
  const tourTitle = `Property Tour — ${propName}`

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

  // Build cancel ICS for tenant
  const icsTenant = buildCancelIcs({
    uid: `tour-${tourId}@homehive.live`,
    title: tourTitle,
    startUtc, endUtc,
    organizerEmail: 'hello@homehive.live',
    attendeeEmail: lead.email,
    attendeeName: tenantName,
  })

  // Build cancel ICS for landlord
  const icsLandlord = buildCancelIcs({
    uid: `tour-${tourId}-landlord@homehive.live`,
    title: tourTitle,
    startUtc, endUtc,
    organizerEmail: 'hello@homehive.live',
    attendeeEmail: landlordEmail,
    attendeeName: landlordName || 'Landlord',
  })

  // Email tenant
  try {
    const subject = `Your tour of ${propName} has been cancelled`
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: buildTenantCancelEmail({ tenantName, propName, address, readableDate, reason, notes: notes || null, landlordName }),
      attachments: [{ filename: 'cancel-tour.ics', content: Buffer.from(icsTenant).toString('base64') }],
    })
    await logEmail(tour.lead_id, 'tour_cancellation_tenant', subject, lead.email, { property: propName, reason })
  } catch (e) { console.error('Tenant cancel email error:', e) }

  // Email landlord
  try {
    const subject = `Tour cancelled: ${tenantName} — ${readableDate}`
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: landlordEmail,
      subject,
      html: buildLandlordCancelEmail({ landlordName, tenantName, tenantEmail: lead.email, propName, address, readableDate, reason, notes: notes || null }),
      attachments: [{ filename: 'cancel-tour.ics', content: Buffer.from(icsLandlord).toString('base64') }],
    })
    await logEmail(tour.lead_id, 'tour_cancellation_landlord', subject, landlordEmail, { property: propName, tenant: tenantName, reason })
  } catch (e) { console.error('Landlord cancel email error:', e) }

  return Response.json({ success: true, revertStatus })
}

function buildTenantCancelEmail(d: {
  tenantName: string
  propName: string
  address: string
  readableDate: string
  reason: string
  notes: string | null
  landlordName: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;padding:36px 32px 40px;">

    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:52px;height:52px;border-radius:50%;background:#fef2f2;border:2px solid #fecaca;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 14px;">✕</div>
      <h1 style="margin:0 0 8px;font-size:21px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;">Tour Cancelled</h1>
      <p style="margin:0;font-size:15px;color:#6b6b6b;line-height:1.6;">
        Hi <strong>${d.tenantName}</strong>, we're sorry to let you know that your upcoming tour has been cancelled.
      </p>
    </div>

    <!-- Tour details (crossed out) -->
    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:18px 20px;margin-bottom:24px;opacity:0.7;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:12px;text-decoration:line-through;">Cancelled Tour</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b6b6b;width:90px;text-decoration:line-through;">Property</td><td style="padding:6px 0;font-weight:600;text-decoration:line-through;">${d.propName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b6b;text-decoration:line-through;">When</td><td style="padding:6px 0;font-weight:600;text-decoration:line-through;">${d.readableDate}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b6b;text-decoration:line-through;">Address</td><td style="padding:6px 0;text-decoration:line-through;">📍 ${d.address}</td></tr>
      </table>
    </div>

    <!-- Reason -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#dc2626;margin-bottom:8px;">Reason for Cancellation</div>
      <div style="font-size:14px;color:#1a1a1a;font-weight:600;margin-bottom:${d.notes ? '8px' : '0'};">${d.reason}</div>
      ${d.notes ? `<div style="font-size:13px;color:#4b5563;line-height:1.6;border-top:1px solid #fecaca;padding-top:8px;margin-top:4px;">${d.notes}</div>` : ''}
    </div>

    <!-- Calendar note -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:24px;font-size:13px;color:#1e40af;line-height:1.6;">
      📅 <strong>A calendar cancellation is attached.</strong> Open the .ics file to automatically remove this event from your calendar.
    </div>

    <!-- What's next -->
    <div style="border-top:1px solid #f0ede6;padding-top:20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:12px;">What's next?</div>
      <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0;">
        We hope to reschedule soon. If you have any questions, reach out directly at
        <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
        or browse other available listings.
      </p>
    </div>

  </div>

  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>
</div>
</body>
</html>`
}

function buildLandlordCancelEmail(d: {
  landlordName: string
  tenantName: string
  tenantEmail: string
  propName: string
  address: string
  readableDate: string
  reason: string
  notes: string | null
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#fca5a5;background:rgba(239,68,68,0.15);padding:5px 12px;border-radius:20px;border:1px solid rgba(239,68,68,0.3);">✕ Tour Cancelled</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="margin:0 0 20px;font-size:15px;color:#1a1a1a;">
      Hey${d.landlordName ? ` <strong>${d.landlordName}</strong>` : ''}! Your tour with <strong>${d.tenantName}</strong> has been cancelled.
    </p>

    <!-- Tour summary -->
    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:18px;margin-bottom:20px;opacity:0.7;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b6b6b;width:90px;text-decoration:line-through;">Tenant</td><td style="padding:6px 0;font-weight:600;text-decoration:line-through;">${d.tenantName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b6b;text-decoration:line-through;">Property</td><td style="padding:6px 0;font-weight:600;text-decoration:line-through;">${d.propName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b6b6b;text-decoration:line-through;">When</td><td style="padding:6px 0;font-weight:600;text-decoration:line-through;">${d.readableDate}</td></tr>
      </table>
    </div>

    <!-- Reason -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#dc2626;margin-bottom:6px;">Cancellation Reason</div>
      <div style="font-size:14px;color:#1a1a1a;font-weight:600;margin-bottom:${d.notes ? '8px' : '0'};">${d.reason}</div>
      ${d.notes ? `<div style="font-size:13px;color:#4b5563;line-height:1.6;border-top:1px solid #fecaca;padding-top:8px;">${d.notes}</div>` : ''}
    </div>

    <!-- Calendar note -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;font-size:13px;color:#1e40af;line-height:1.6;">
      📅 Open the attached .ics file to remove this event from your calendar.
    </div>
  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>
</div>
</body>
</html>`
}
