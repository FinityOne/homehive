import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string; reservationId: string }> }
) {
  const { leadId, reservationId } = await params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch reservation + related data
  const { data: res } = await supabaseAdmin
    .from('lead_reservations')
    .select(`
      id, accept_token, status, expires_at, original_price,
      discount_amount, discount_type, room_id, room_name, rooms, landlord_id,
      leads(first_name, email),
      properties(name, address, owner_id, property_images(url, position))
    `)
    .eq('id', reservationId)
    .eq('lead_id', leadId)
    .single()

  if (!res) return Response.json({ error: 'Not found' }, { status: 404 })

  const prop = res.properties as unknown as { name: string; address: string; owner_id: string; property_images: { url: string; position: number }[] } | null
  if (!prop || prop.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const lead = res.leads as unknown as { first_name: string | null; email: string } | null
  if (!lead?.email) return Response.json({ error: 'Lead email missing' }, { status: 400 })

  // Check not expired or accepted
  const isExpired = res.status === 'expired' || new Date(res.expires_at) < new Date()
  if (isExpired) return Response.json({ error: 'Cannot send email for an expired offer. Please edit the offer to extend the expiry first.' }, { status: 409 })
  if (res.status === 'accepted') return Response.json({ error: 'Offer already accepted' }, { status: 409 })

  // Get landlord name
  let landlordFirstName = ''
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('first_name').eq('id', user.id).single()
    if (profile?.first_name) landlordFirstName = profile.first_name
  } catch (_) {}

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const acceptUrl = `${siteUrl}/reserve/${res.accept_token}`
  const tenantName = lead.first_name || 'there'
  const basePrice = res.original_price as number
  const discount_amount = res.discount_amount as number | null
  const discount_type = res.discount_type as 'dollars' | 'percent' | null

  type ReservationRoomEntry = { room_id: string; room_name: string; original_price: number; discount_amount: number | null; discount_type: 'dollars' | 'percent' | null; discounted_price: number | null }
  const roomsJsonb = (Array.isArray(res.rooms) && res.rooms.length > 0) ? (res.rooms as ReservationRoomEntry[]) : null

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
  // Per-room discount total
  if (roomsJsonb && !discount_amount) {
    const totalDiscounted = roomsJsonb.reduce((s, r) => s + (r.discounted_price ?? r.original_price), 0)
    if (totalDiscounted < basePrice) {
      discountedPrice = totalDiscounted
      savingsLabel = `$${basePrice - totalDiscounted} off`
    }
  }

  const heroImage = (prop.property_images ?? []).sort((a, b) => a.position - b.position)[0]?.url || ''
  const roomLabel = roomsJsonb
    ? roomsJsonb.map(r => r.room_name).join(' & ')
    : (res.room_name ? res.room_name : (res.room_id ? 'Your Room' : 'Entire Property'))

  // Per-room breakdown rows for multi-room email
  const multiRoomRows = roomsJsonb ? roomsJsonb.map(r => {
    const rFinal = r.discounted_price ?? r.original_price
    const rSaved = r.discounted_price !== null && r.discount_amount && r.discount_type
      ? ` <span style="color:#8C1D40;font-weight:700;">(${r.discount_type === 'dollars' ? `$${r.discount_amount} off` : `${r.discount_amount}% off`})</span>`
      : ''
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #f0ede6;">
      <div style="font-size:13px;color:#6b6b6b;">🛏 ${r.room_name}</div>
      <div style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">$${rFinal.toLocaleString()}/mo${rSaved}</div>
    </div>`
  }).join('') : ''
  const subject = `🔒 ${tenantName}, your spot at ${prop.name} is reserved!`

  const expiresFormatted = new Date(res.expires_at).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: 'America/Phoenix',
  })

  const priceBlock = discountedPrice !== null
    ? `<div style="margin-bottom:6px;">
        <span style="font-size:15px;color:#9b9b9b;text-decoration:line-through;margin-right:8px;">$${basePrice.toLocaleString()}/mo</span>
        <span style="font-size:24px;font-weight:800;color:#8C1D40;">$${discountedPrice.toLocaleString()}/mo</span>
      </div>
      <div style="display:inline-block;background:#8C1D40;color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;letter-spacing:0.3px;">
        ${savingsLabel} — exclusive offer
      </div>`
    : `<div style="font-size:24px;font-weight:800;color:#1a1a1a;">$${basePrice.toLocaleString()}/mo</div>`

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

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#8C1D40,#a02050);padding:18px 32px;text-align:center;">
      <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Time-Sensitive Reservation</div>
      <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px;">🔒 Your spot is being held</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:6px;">Reserved exclusively for you until ${expiresFormatted}</div>
    </div>

    <div style="padding:36px 32px 40px;text-align:center;">
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#1a1a1a;letter-spacing:-0.4px;line-height:1.25;">
        ${tenantName}, you're our top pick.
      </h1>
      <p style="margin:0 0 28px;font-size:15px;color:#6b6b6b;line-height:1.75;">
        ${landlordFirstName ? `<strong>${landlordFirstName}</strong> has` : 'The landlord has'} personally reserved <strong>${roomLabel}</strong> at ${prop.name} for you. This offer is exclusive — we&apos;re not showing this spot to anyone else while it&apos;s held for you.
      </p>

      <div style="background:#faf9f6;border:1.5px solid #e8e5de;border-radius:14px;padding:24px 28px;margin-bottom:28px;text-align:left;">
        <div style="font-size:11px;font-weight:700;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:16px;">Your Reservation</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f0ede6;">
          <div style="font-size:13px;color:#9b9b9b;">Property</div>
          <div style="font-size:13px;font-weight:600;color:#1a1a1a;text-align:right;">${prop.name}</div>
        </div>
        ${roomsJsonb ? `
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
          <div style="text-align:right;">${priceBlock}</div>
        </div>`}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;">
          <div style="font-size:13px;color:#9b9b9b;">Held Until</div>
          <div style="font-size:13px;font-weight:600;color:#ef4444;text-align:right;">${expiresFormatted}</div>
        </div>
      </div>

      <a href="${acceptUrl}"
         style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;font-size:17px;font-weight:800;padding:20px 48px;border-radius:12px;letter-spacing:-0.2px;margin-bottom:14px;box-shadow:0 6px 28px rgba(140,29,64,0.35);">
        ✓ Accept My Reservation →
      </a>

      <div style="font-size:12px;color:#b0a898;margin-bottom:28px;line-height:1.7;">
        Accepting confirms your <strong>intent to move forward</strong> — it doesn&apos;t lock you into a lease.<br/>
        We&apos;ll follow up with next steps after you accept.
      </div>

      <div style="background:#fff8e6;border:1.5px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:4px;">
        <div style="font-size:13px;color:#4a3800;line-height:1.65;">
          ⏰ <strong>This reservation expires automatically.</strong> Once it expires, the spot opens back up and we may offer it to other interested renters.
        </div>
      </div>
    </div>
  </div>

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
      expires_at: res.expires_at,
      discount_type,
      discount_amount,
      reservation_id: reservationId,
    })
  } catch (e) {
    console.error('Reservation email error:', e)
    return Response.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return Response.json({ success: true })
}
