import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  // Auth check — must be landlord
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch lead
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads').select('*').eq('id', leadId).single()
  if (leadErr || !lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Verify landlord owns the property
  const { data: prop } = await supabaseAdmin
    .from('properties')
    .select('name, address, owner_id, property_images(url, position)')
    .eq('slug', lead.property)
    .single()
  if (!prop || prop.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Check that availability slots exist for next 7 days
  const today = new Date()
  const in7Days = new Date(today); in7Days.setDate(in7Days.getDate() + 7)
  const { data: slots } = await supabaseAdmin
    .from('tour_availabilities')
    .select('id')
    .eq('property_slug', lead.property)
    .eq('is_booked', false)
    .gte('date', today.toISOString().split('T')[0])
    .lte('date', in7Days.toISOString().split('T')[0])
    .limit(1)

  if (!slots || slots.length === 0) {
    return Response.json({ error: 'No availability set. Please add time slots in the Calendar tab first.' }, { status: 400 })
  }

  // Mark tour_invite_sent_at
  await supabaseAdmin.from('leads').update({ tour_invite_sent_at: new Date().toISOString() }).eq('id', leadId)

  // Get property hero image
  const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
  const heroImage = imgs.sort((a, b) => a.position - b.position)[0]?.url || ''

  // Get landlord first name
  let landlordFirstName = ''
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('first_name').eq('id', user.id).single()
    if (profile?.first_name) landlordFirstName = profile.first_name
  } catch (_) {}

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const bookingUrl = `${siteUrl}/book-tour/${leadId}`
  const tenantFirstName = lead.first_name || 'there'

  // Send celebratory invitation email
  const subject = `🎉 ${tenantFirstName}, you're invited to tour ${prop.name}!`
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>

  ${heroImage ? `
  <div style="width:100%;height:220px;overflow:hidden;position:relative;">
    <img src="${heroImage}" alt="${prop.name}" style="width:100%;height:100%;object-fit:cover;" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 30%,rgba(0,0,0,0.65));"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:20px 28px;">
      <div style="font-size:18px;font-weight:700;color:#fff;">${prop.name}</div>
      ${prop.address ? `<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:3px;">📍 ${prop.address}</div>` : ''}
    </div>
  </div>` : ''}

  <!-- Celebration card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;padding:36px 32px 40px;text-align:center;">

    <!-- Confetti badge -->
    <div style="display:inline-block;background:linear-gradient(135deg,#FFC627,#ffab00);border-radius:50px;padding:10px 24px;margin-bottom:24px;box-shadow:0 4px 20px rgba(255,198,39,0.4);">
      <span style="font-size:14px;font-weight:800;color:#1a1a1a;letter-spacing:0.3px;">🎉 You're invited to tour!</span>
    </div>

    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#1a1a1a;letter-spacing:-0.5px;line-height:1.2;">
      Congratulations, ${tenantFirstName}!
    </h1>

    <p style="margin:0 0 8px;font-size:16px;color:#4a4a4a;line-height:1.7;">
      ${landlordFirstName ? `<strong>${landlordFirstName}</strong> has` : 'The landlord has'} reviewed your interest and would love to show you around <strong>${prop.name}</strong>.
    </p>

    <p style="margin:0 0 28px;font-size:15px;color:#6b6b6b;line-height:1.7;">
      You stood out from the crowd — we can't wait to show you your potential new home. Pick a time that works for you below.
    </p>

    <!-- Divider -->
    <div style="border-top:1px solid #f0ede6;margin:0 0 28px;"></div>

    <!-- What to expect -->
    <div style="text-align:left;margin-bottom:28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:14px;">What to expect</div>
      ${[
        ['📍', 'A 30-minute walkthrough of the property'],
        ['📅', 'You choose a time that works for you — below'],
        ['🏠', `${prop.address || prop.name}`],
      ].map(([icon, text]) => `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div style="width:36px;height:36px;border-radius:10px;background:#faf9f6;border:1px solid #e8e5de;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">${icon}</div>
        <div style="font-size:14px;color:#3a3a3a;line-height:1.5;">${text}</div>
      </div>`).join('')}
    </div>

    <!-- CTA -->
    <a href="${bookingUrl}"
       style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:16px;font-weight:800;padding:18px 44px;border-radius:12px;letter-spacing:-0.2px;margin-bottom:16px;box-shadow:0 4px 24px rgba(26,26,26,0.25);">
      Choose Your Tour Time →
    </a>

    <div style="font-size:12px;color:#b0a898;margin-bottom:28px;line-height:1.6;">
      Pick a 30-minute slot from the available times below.<br/>Your spot is not confirmed until you select a time.
    </div>


  </div>

  <!-- Footer -->
  <div style="margin-top:28px;text-align:center;font-size:12px;color:#9b9b9b;line-height:1.8;">
    Sent with care by the HomeHive Team<br/>
    <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>

</div>
</body>
</html>`,
    })
    await logEmail(leadId, 'tour_invitation', subject, lead.email, { property: prop.name })
  } catch (e) {
    console.error('Tour invitation email error:', e)
    return Response.json({ error: 'Failed to send invitation email' }, { status: 500 })
  }

  return Response.json({ success: true, bookingUrl })
}
