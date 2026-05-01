import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getAuthedUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null
  return user
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string; reservationId: string }> }
) {
  const { leadId, reservationId } = await params
  const user = await getAuthedUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: res, error } = await supabaseAdmin
    .from('lead_reservations')
    .select(`
      id, accept_token, status, expires_at, original_price,
      discount_amount, discount_type, room_id, room_name,
      created_at, accepted_at, landlord_id,
      leads(first_name, last_name, email),
      properties(id, name, address, owner_id, property_images(url, position))
    `)
    .eq('id', reservationId)
    .eq('lead_id', leadId)
    .single()

  if (error || !res) return Response.json({ error: 'Not found' }, { status: 404 })

  const prop = res.properties as unknown as { id: string; name: string; address: string; owner_id: string; property_images: { url: string; position: number }[] } | null
  if (!prop || prop.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const heroImage = (prop.property_images ?? []).sort((a, b) => a.position - b.position)[0]?.url || ''

  // If whole-property offer, fetch individual room prices for the breakdown
  let rooms: { name: string; price: number }[] = []
  if (!res.room_id) {
    const { data: roomData } = await supabaseAdmin
      .from('property_rooms')
      .select('name, price, is_available, position')
      .eq('property_id', prop.id)
      .eq('is_available', true)
      .order('position', { ascending: true })
    if (roomData && roomData.length > 0) {
      rooms = (roomData as { name: string | null; price: number; position: number }[])
        .map((r, i) => ({ name: r.name || `Room ${i + 1}`, price: r.price }))
    }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

  return Response.json({
    id: res.id,
    accept_token: res.accept_token,
    status: res.status,
    expires_at: res.expires_at,
    original_price: res.original_price,
    discount_amount: res.discount_amount,
    discount_type: res.discount_type,
    room_id: res.room_id,
    room_name: res.room_name,
    created_at: res.created_at,
    accepted_at: res.accepted_at,
    lead: res.leads,
    property: {
      name: prop.name,
      address: prop.address,
      heroImage,
    },
    rooms, // populated when room_id is null and property has by-room pricing
    acceptUrl: `${siteUrl}/reserve/${res.accept_token}`,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string; reservationId: string }> }
) {
  const { leadId, reservationId } = await params
  const user = await getAuthedUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: existing } = await supabaseAdmin
    .from('lead_reservations')
    .select('id, landlord_id, original_price, accepted_at')
    .eq('id', reservationId)
    .eq('lead_id', leadId)
    .single()

  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (existing.landlord_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (existing.accepted_at) return Response.json({ error: 'Cannot edit an accepted offer' }, { status: 409 })

  const body = await req.json()
  const { discount_amount, discount_type, expires_at } = body

  const updates: Record<string, unknown> = {}
  if (discount_amount !== undefined) updates.discount_amount = discount_amount || null
  if (discount_type !== undefined) updates.discount_type = discount_type || null
  if (expires_at !== undefined) {
    updates.expires_at = expires_at
    // Reset to pending if new expiry is in the future
    if (new Date(expires_at) > new Date()) {
      updates.status = 'pending'
    }
  }

  const { error } = await supabaseAdmin
    .from('lead_reservations')
    .update(updates)
    .eq('id', reservationId)

  if (error) return Response.json({ error: 'Failed to update' }, { status: 500 })

  return Response.json({ success: true })
}
