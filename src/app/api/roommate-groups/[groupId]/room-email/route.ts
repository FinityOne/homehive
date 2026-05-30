import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

async function getLandlordId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(auth.replace('Bearer ', ''))
  return user?.id ?? null
}

function buildEmailHtml({
  tenantName,
  roomName,
  roomPrice,
  groupName,
  groupEmoji,
  propertyName,
  propertyAddress,
  heroImage,
  groupUrl,
  shareUrl,
  siteUrl,
}: {
  tenantName: string
  roomName: string
  roomPrice: number | null
  groupName: string
  groupEmoji: string
  propertyName: string
  propertyAddress: string | null
  heroImage: string | null
  groupUrl: string
  shareUrl: string
  siteUrl: string
}) {
  const priceLine = roomPrice ? `$${roomPrice.toLocaleString()}/mo` : null

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Your Room at ${propertyName} — HomeHive</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:28px 16px 48px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:18px 28px;display:flex;align-items:center;gap:12px;">
    <img src="${siteUrl}/hh-logo.png" alt="HomeHive" style="height:26px;width:auto;" />
  </div>

  ${heroImage ? `
  <div style="width:100%;height:180px;overflow:hidden;position:relative;">
    <img src="${heroImage}" alt="${propertyName}" style="width:100%;height:100%;object-fit:cover;" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 20%,rgba(0,0,0,0.72));"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:16px 24px;">
      <div style="font-size:16px;font-weight:700;color:#fff;">${propertyName}</div>
      ${propertyAddress ? `<div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:2px;">📍 ${propertyAddress}</div>` : ''}
    </div>
  </div>` : ''}

  <!-- Main card -->
  <div style="background:#fff;border:1px solid #e8e5de;${heroImage ? 'border-top:none;' : ''}border-radius:${heroImage ? '0 0 14px 14px' : '0 0 14px 14px'};overflow:hidden;">

    <!-- Maroon accent bar -->
    <div style="background:linear-gradient(135deg,#8C1D40,#a0234d);padding:22px 28px;text-align:center;">
      <div style="font-size:32px;margin-bottom:6px;">🛏</div>
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px;">Room Confirmed</div>
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px;">Your room has been reserved!</div>
    </div>

    <div style="padding:32px 28px;">

      <!-- Greeting -->
      <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1a1a1a;">Hey ${tenantName} 👋</p>
      <p style="margin:0 0 28px;font-size:14px;color:#6b6b6b;line-height:1.75;">
        Great news — your landlord has officially reserved a room for you at <strong>${propertyName}</strong>.
        You're part of a roommate group and we can't wait to help you connect with your future housemates before move-in day!
      </p>

      <!-- Room details box -->
      <div style="background:#faf9f6;border:1.5px solid #e8e5de;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:14px;">Your Room Details</div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0ede6;">
          <span style="font-size:13px;color:#6b6b6b;">Property</span>
          <span style="font-size:13px;font-weight:600;color:#1a1a1a;">${propertyName}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${priceLine ? 'border-bottom:1px solid #f0ede6;' : ''}">
          <span style="font-size:13px;color:#6b6b6b;">Room</span>
          <span style="font-size:13px;font-weight:700;color:#8C1D40;">🛏 ${roomName}</span>
        </div>
        ${priceLine ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
          <span style="font-size:13px;color:#6b6b6b;">Monthly Rent</span>
          <span style="font-size:15px;font-weight:800;color:#1a1a1a;">${priceLine}</span>
        </div>` : ''}
      </div>

      <!-- Group chat section -->
      <div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);border-radius:14px;padding:22px 24px;margin-bottom:28px;text-align:center;">
        <div style="font-size:28px;margin-bottom:8px;">🐝</div>
        <div style="font-size:15px;font-weight:700;color:#FFC627;margin-bottom:10px;">Meet Your Roommates — The Group Chat is Live!</div>
        <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.7;">
          You've been added to <strong style="color:#fff;">${groupEmoji} ${groupName}</strong> — a private roommate group just for your house.
          Inside, you'll find <strong style="color:#FFC627;">Honeybee 🐝</strong>, your AI-powered roommate matchmaker, ready to kick off introductions and help everyone bond before move-in day.
        </p>
        <p style="margin:0 0 18px;font-size:13px;color:rgba(255,255,255,0.6);line-height:1.7;">
          Honeybee breaks the ice with fun conversation starters, reminds everyone to share house rules, and helps coordinate move-in logistics — all in one cozy group chat.
        </p>
        <a href="${groupUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#FFC627,#f5a623);color:#1a1a1a;text-decoration:none;font-size:15px;font-weight:800;padding:14px 32px;border-radius:10px;letter-spacing:-0.2px;">
          Open Group Chat →
        </a>
      </div>

      <!-- Invite friends section -->
      <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:15px;font-weight:700;color:#0369a1;margin-bottom:8px;">👥 Know someone looking for a room?</div>
        <p style="margin:0 0 14px;font-size:13px;color:#0369a1;line-height:1.7;">
          There are still rooms available in your house! Share the group invite link and let your friends reserve a spot — living with people you already know makes everything easier.
        </p>
        <div style="background:#fff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;font-size:12px;color:#0369a1;word-break:break-all;margin-bottom:12px;">
          ${shareUrl}
        </div>
        <a href="${shareUrl}"
           style="display:inline-block;background:#0369a1;color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;">
          Share Invite Link →
        </a>
      </div>

      <!-- Next steps -->
      <div style="border-left:3px solid #8C1D40;padding-left:16px;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:6px;">What's next?</div>
        <ul style="margin:0;padding-left:16px;font-size:13px;color:#6b6b6b;line-height:2;">
          <li>Open the group chat and introduce yourself</li>
          <li>Say hi to Honeybee — she'll get the conversation going</li>
          <li>Share the link with friends who might want a room</li>
          <li>Your landlord will be in touch with lease details soon</li>
        </ul>
      </div>

    </div>
  </div>

  <!-- Footer -->
  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;line-height:1.9;">
    Sent with care by the HomeHive Team<br/>
    <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
    &nbsp;·&nbsp;
    <a href="${siteUrl}" style="color:#9b9b9b;text-decoration:none;">homehive.live</a>
  </div>

</div>
</body>
</html>`
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { lead_id, preview } = body as { lead_id: string; preview?: boolean }
  if (!lead_id) return Response.json({ error: 'lead_id required' }, { status: 400 })

  // Fetch group (verify ownership)
  const { data: group } = await supabaseAdmin
    .from('roommate_groups')
    .select('id, name, emoji, share_token, property_slug, landlord_id')
    .eq('id', groupId)
    .eq('landlord_id', landlordId)
    .single()
  if (!group) return Response.json({ error: 'Group not found' }, { status: 404 })

  // Fetch member with room
  const { data: member } = await supabaseAdmin
    .from('roommate_group_members')
    .select('id, room_id, leads(id, first_name, last_name, email)')
    .eq('group_id', groupId)
    .eq('lead_id', lead_id)
    .single()
  if (!member) return Response.json({ error: 'Member not found' }, { status: 404 })

  const lead = member.leads as unknown as { id: string; first_name: string | null; last_name: string | null; email: string } | null
  if (!lead?.email) return Response.json({ error: 'Lead has no email' }, { status: 400 })
  if (!member.room_id) return Response.json({ error: 'No room assigned to this member' }, { status: 400 })

  // Fetch room details
  const { data: room } = await supabaseAdmin
    .from('property_rooms')
    .select('name, price')
    .eq('id', member.room_id)
    .single()
  if (!room) return Response.json({ error: 'Room not found' }, { status: 404 })

  // Fetch property details
  let propertyName = 'your new home'
  let propertyAddress: string | null = null
  let heroImage: string | null = null
  if (group.property_slug) {
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('name, address, property_images(url, position)')
      .eq('slug', group.property_slug)
      .single()
    if (prop) {
      propertyName = prop.name
      propertyAddress = prop.address ?? null
      const imgs = (prop.property_images as { url: string; position: number }[] ?? [])
        .sort((a, b) => a.position - b.position)
      heroImage = imgs[0]?.url ?? null
    }
  }

  const siteUrl = getSiteUrl()
  const tenantName = lead.first_name || 'there'
  const groupUrl = `${siteUrl}/groups/${group.share_token}`
  const shareUrl = groupUrl

  const html = buildEmailHtml({
    tenantName,
    roomName: room.name,
    roomPrice: room.price ?? null,
    groupName: group.name,
    groupEmoji: group.emoji,
    propertyName,
    propertyAddress,
    heroImage,
    groupUrl,
    shareUrl,
    siteUrl,
  })

  // Preview mode — return HTML without sending
  if (preview) {
    return Response.json({ html, subject: `🛏 ${tenantName}, your room at ${propertyName} is confirmed!` })
  }

  // Send email
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject: `🛏 ${tenantName}, your room at ${propertyName} is confirmed!`,
      html,
    })
  } catch (e) {
    console.error('Room email send error:', e)
    return Response.json({ error: 'Failed to send email' }, { status: 500 })
  }

  // Log the send
  await supabaseAdmin.from('group_email_logs').insert([{
    group_id: groupId,
    lead_id: lead.id,
    sent_by: landlordId,
    email_type: 'room_confirmation',
    recipient_email: lead.email,
    recipient_name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || null,
    room_name: room.name,
    group_name: group.name,
  }])

  return Response.json({ success: true })
}
