import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Verify admin auth
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name: string
    address: string
    description?: string
    price: number
    security_deposit?: number | null
    listing_type: string
    unit_type?: string | null
    beds?: number
    baths?: number
    sqft?: string
    total_rooms?: number
    available?: number
    asu_distance?: number
    sublease_start_date?: string | null
    sublease_end_date?: string | null
    map_embed_url?: string
    lat?: number
    lng?: number
    owner_id?: string | null
    is_claimable?: boolean
    tags?: string[]
    asu_reasons?: string[]
    nearby?: { place: string; travel_time: string }[]
    images?: string[]
  }

  // Update the properties row
  const { error: updateErr } = await supabaseAdmin
    .from('properties')
    .update({
      name: body.name,
      address: body.address,
      description: body.description || '',
      price: body.price,
      security_deposit: body.security_deposit ?? null,
      listing_type: body.listing_type || 'standard_rental',
      unit_type: body.unit_type ?? null,
      beds: body.beds ?? 1,
      baths: body.baths ?? 1,
      sqft: body.sqft ?? '',
      total_rooms: body.total_rooms ?? 1,
      available: body.available ?? 1,
      asu_distance: body.asu_distance ?? 0,
      sublease_start_date: body.sublease_start_date ?? null,
      sublease_end_date: body.sublease_end_date ?? null,
      map_embed_url: body.map_embed_url ?? '',
      lat: body.lat ?? 0,
      lng: body.lng ?? 0,
      owner_id: body.owner_id ?? null,
      is_claimable: body.is_claimable ?? false,
    })
    .eq('id', id)

  if (updateErr) {
    return Response.json({ error: 'Failed to update property' }, { status: 500 })
  }

  // Replace tags
  await supabaseAdmin.from('property_tags').delete().eq('property_id', id)
  if (body.tags && body.tags.length > 0) {
    await supabaseAdmin.from('property_tags')
      .insert(body.tags.map(tag => ({ property_id: id, tag })))
  }

  // Replace nearby places
  await supabaseAdmin.from('property_nearby').delete().eq('property_id', id)
  const nearby = (body.nearby || []).filter(r => r.place.trim() && r.travel_time.trim())
  if (nearby.length > 0) {
    await supabaseAdmin.from('property_nearby')
      .insert(nearby.map(n => ({ property_id: id, place: n.place, travel_time: n.travel_time })))
  }

  // Replace ASU reasons
  await supabaseAdmin.from('property_asu_reasons').delete().eq('property_id', id)
  if (body.asu_reasons && body.asu_reasons.length > 0) {
    await supabaseAdmin.from('property_asu_reasons')
      .insert(body.asu_reasons.map((reason, i) => ({ property_id: id, reason, position: i })))
  }

  // Replace images
  await supabaseAdmin.from('property_images').delete().eq('property_id', id)
  if (body.images && body.images.length > 0) {
    await supabaseAdmin.from('property_images')
      .insert(body.images.map((url, i) => ({ property_id: id, url, position: i })))
  }

  return Response.json({ ok: true })
}
