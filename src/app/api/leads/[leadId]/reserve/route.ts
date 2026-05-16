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

  // Auth check
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    room_id,           // null = entire property (single-room compat)
    rooms: roomsInput, // [{ room_id, discount_amount, discount_type }] for multi-room
    discount_amount,   // collective discount amount (or single-room discount)
    discount_type,     // 'dollars' | 'percent' | null
    expires_at,        // ISO string
    send_email = true, // false = create without sending (preview flow)
  } = body

  // Fetch lead
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads').select('*').eq('id', leadId).single()
  if (leadErr || !lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

  // Fetch property (include rooms for by_room price summing)
  const { data: prop } = await supabaseAdmin
    .from('properties')
    .select('id, name, address, price, owner_id, rental_mode, property_images(url, position), property_rooms(id, name, price, is_available)')
    .eq('slug', lead.property)
    .single()
  if (!prop || prop.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  type RoomsRow = { id: string; name: string | null; price: number; is_available: boolean }
  const allPropRooms = (prop.property_rooms as RoomsRow[] | null) ?? []

  // ── Multi-room offer ─────────────────────────────────────────────────────────
  type RoomInput = { room_id: string; discount_amount?: number | null; discount_type?: 'dollars' | 'percent' | null }
  const isMultiRoom = Array.isArray(roomsInput) && roomsInput.length > 0

  type ReservationRoomEntry = {
    room_id: string; room_name: string; original_price: number
    discount_amount: number | null; discount_type: 'dollars' | 'percent' | null; discounted_price: number | null
  }

  let roomsJsonb: ReservationRoomEntry[] | null = null
  let roomName: string | null = null
  let basePrice = prop.price as number

  if (isMultiRoom) {
    const entries: ReservationRoomEntry[] = []
    for (const ri of (roomsInput as RoomInput[]).slice(0, 2)) {
      const propRoom = allPropRooms.find(r => r.id === ri.room_id)
      if (!propRoom) continue
      const rda = ri.discount_amount ?? null
      const rdt = ri.discount_type ?? null
      let rdp: number | null = null
      if (rda && rdt) {
        rdp = rdt === 'dollars' ? Math.max(0, propRoom.price - rda) : Math.round(propRoom.price * (1 - rda / 100))
      }
      entries.push({ room_id: ri.room_id, room_name: propRoom.name || `Room`, original_price: propRoom.price, discount_amount: rda, discount_type: rdt, discounted_price: rdp })
    }
    roomsJsonb = entries
    basePrice = entries.reduce((s, r) => s + r.original_price, 0)
  } else if (room_id) {
    // Single room
    const propRoom = allPropRooms.find(r => r.id === room_id)
    if (propRoom) {
      roomName = propRoom.name || null
      basePrice = propRoom.price
    } else {
      const { data: room } = await supabaseAdmin
        .from('property_rooms').select('name, price').eq('id', room_id).single()
      if (room) { roomName = room.name || null; basePrice = room.price }
    }
  } else if (prop.rental_mode === 'by_room') {
    // Sum all available room prices for the whole-property offer
    const available = allPropRooms.filter(r => r.is_available)
    if (available.length > 0) basePrice = available.reduce((s, r) => s + r.price, 0)
  }

  // ── Collective / single discount ─────────────────────────────────────────────
  let discountedPrice: number | null = null
  let savingsLabel = ''
  if (discount_amount && discount_type) {
    if (discount_type === 'dollars') {
      discountedPrice = Math.max(0, basePrice - discount_amount)
      savingsLabel = `$${discount_amount} off`
    } else {
      discountedPrice = Math.round(basePrice * (1 - discount_amount / 100))
      savingsLabel = `${discount_amount}% off`
    }
  }
  // For per-room discounts with no collective discount, compute combined discounted total for display
  if (isMultiRoom && !discount_amount && roomsJsonb) {
    const totalDiscounted = roomsJsonb.reduce((s, r) => s + (r.discounted_price ?? r.original_price), 0)
    if (totalDiscounted < basePrice) {
      discountedPrice = totalDiscounted
      const saved = basePrice - totalDiscounted
      savingsLabel = `$${saved} off`
    }
  }

  // Get landlord name
  let landlordFirstName = ''
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('first_name').eq('id', user.id).single()
    if (profile?.first_name) landlordFirstName = profile.first_name
  } catch (_) {}

  // Create reservation record
  const { data: reservation, error: resErr } = await supabaseAdmin
    .from('lead_reservations')
    .insert({
      lead_id: leadId,
      property_id: prop.id,
      room_id: isMultiRoom ? null : (room_id || null),
      landlord_id: user.id,
      discount_amount: discount_amount || null,
      discount_type: discount_type || null,
      original_price: basePrice,
      expires_at,
      room_name: isMultiRoom ? null : roomName,
      rooms: roomsJsonb ?? null,
      status: 'pending',
    })
    .select('id, accept_token')
    .single()

  if (resErr || !reservation) {
    console.error('Reservation insert error:', resErr)
    return Response.json({ error: 'Failed to create reservation' }, { status: 500 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const acceptUrl = `${siteUrl}/reserve/${reservation.accept_token}`

  if (!send_email) {
    return Response.json({ success: true, id: reservation.id, accept_token: reservation.accept_token, acceptUrl })
  }

  const tenantName = lead.first_name || 'there'
  const expiresDate = new Date(expires_at)
  const expiresFormatted = expiresDate.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/Phoenix',
  })

  const heroImage = ((prop.property_images as { url: string; position: number }[] | null) ?? [])
    .sort((a, b) => a.position - b.position)[0]?.url || ''

  const roomLabel = isMultiRoom
    ? (roomsJsonb!.map(r => r.room_name).join(' & '))
    : (roomName ? roomName : (room_id ? 'Your Room' : 'Entire Property'))
  const subject = `🔒 ${tenantName}, your spot at ${prop.name} is reserved!`

  const displayPrice = discountedPrice ?? basePrice
  const priceBlock = discountedPrice !== null
    ? `<div style="margin-bottom:6px;">
        <span style="font-size:15px;color:#9b9b9b;text-decoration:line-through;margin-right:8px;">$${basePrice.toLocaleString()}/mo</span>
        <span style="font-size:24px;font-weight:800;color:#8C1D40;">$${discountedPrice.toLocaleString()}/mo</span>
      </div>
      <div style="display:inline-block;background:#8C1D40;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.3px;">
        ${savingsLabel} — exclusive offer
      </div>`
    : `<div style="font-size:24px;font-weight:800;color:#1a1a1a;">$${basePrice.toLocaleString()}/mo</div>`

  // Per-room breakdown rows for multi-room email
  const multiRoomRows = isMultiRoom && roomsJsonb ? roomsJsonb.map(r => {
    const rFinal = r.discounted_price ?? r.original_price
    const rSaved = r.discounted_price !== null ? ` <span style="color:#8C1D40;font-weight:700;">(${r.discount_type === 'dollars' ? `$${r.discount_amount} off` : `${r.discount_amount}% off`})</span>` : ''
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f0ede6;">
      <div style="font-size:13px;color:#6b6b6b;">🛏 ${r.room_name}</div>
      <div style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">
        $${rFinal.toLocaleString()}/mo${rSaved}
      </div>
    </div>`
  }).join('') : ''

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
  <div style="background:#1a1a1a;border-radius:16px 16px 0 0;padding:22px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>

  ${heroImage ? `
  <div style="width:100%;height:200px;overflow:hidden;position:relative;">
    <img src="${heroImage}" alt="${prop.name}" style="width:100%;height:100%;object-fit:cover;" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 30%,rgba(0,0,0,0.7));"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:18px 28px;">
      <div style="font-size:17px;font-weight:700;color:#fff;">${prop.name}</div>
      ${prop.address ? `<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:2px;">📍 ${prop.address}</div>` : ''}
    </div>
  </div>` : ''}

  <!-- Main card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;">

    <!-- Urgency banner -->
    <div style="background:linear-gradient(135deg,#8C1D40,#a02050);padding:18px 32px;text-align:center;">
      <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Time-Sensitive Reservation</div>
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px;">🔒 Your spot is being held</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:6px;">Reserved exclusively for you until ${expiresFormatted}</div>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px 40px;text-align:center;">

      <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1a1a1a;letter-spacing:-0.4px;line-height:1.25;">
        ${tenantName}, you're our top pick.
      </h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b6b6b;line-height:1.75;">
        ${landlordFirstName ? `<strong>${landlordFirstName}</strong> has` : 'The landlord has'} personally reserved <strong>${roomLabel}</strong> at ${prop.name} for you. This offer is exclusive — we&apos;re not showing this spot to anyone else while it&apos;s held for you.
      </p>

      <!-- Reservation details box -->
      <div style="background:#faf9f6;border:1.5px solid #e8e5de;border-radius:14px;padding:24px 28px;margin-bottom:28px;text-align:left;">
        <div style="font-size:11px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:16px;">Your Reservation</div>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f0ede6;">
          <div style="font-size:13px;color:#9b9b9b;">Property</div>
          <div style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">${prop.name}</div>
        </div>
        ${isMultiRoom ? `
        <div style="font-size:11px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.6px;padding:6px 0 2px;">Rooms</div>
        ${multiRoomRows}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f0ede6;">
          <div style="font-size:13px;color:#9b9b9b;">Total / month</div>
          <div style="text-align:right;">${priceBlock}</div>
        </div>` : `
        ${roomLabel !== 'Entire Property' ? `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f0ede6;">
          <div style="font-size:13px;color:#9b9b9b;">Room</div>
          <div style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">${roomLabel}</div>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f0ede6;">
          <div style="font-size:13px;color:#9b9b9b;">Monthly Rent</div>
          <div style="text-align:right;">
            ${priceBlock}
          </div>
        </div>`}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;">
          <div style="font-size:13px;color:#9b9b9b;">Held Until</div>
          <div style="font-size:13px;font-weight:600;color:#ef4444;text-align:right;">${expiresFormatted}</div>
        </div>
      </div>

      <!-- CTA -->
      <a href="${acceptUrl}"
         style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;font-size:17px;font-weight:800;padding:20px 48px;border-radius:12px;letter-spacing:-0.2px;margin-bottom:14px;box-shadow:0 6px 28px rgba(140,29,64,0.35);">
        ✓ Accept My Reservation →
      </a>

      <div style="font-size:12px;color:#b0a898;margin-bottom:28px;line-height:1.7;">
        Accepting confirms your <strong>intent to move forward</strong> — it doesn&apos;t lock you into a lease.<br/>
        We&apos;ll follow up with next steps after you accept.
      </div>

      <!-- Urgency callout -->
      <div style="background:#fff8e6;border:1.5px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:4px;">
        <div style="font-size:13px;color:#4a3800;line-height:1.65;">
          ⏰ <strong>This reservation expires automatically.</strong> Once it expires, the spot opens back up and we may offer it to other interested renters.
        </div>
      </div>

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

    await logEmail(leadId, 'reservation_sent', subject, lead.email, {
      property: prop.name,
      room: roomLabel,
      expires_at,
      discount_type,
      discount_amount,
    })
  } catch (e) {
    console.error('Reservation email error:', e)
    return Response.json({ error: 'Failed to send reservation email' }, { status: 500 })
  }

  return Response.json({ success: true, id: reservation.id, accept_token: reservation.accept_token, acceptUrl })
}
