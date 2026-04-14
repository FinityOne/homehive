import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Params = { params: Promise<{ propertyId: string }> }

// GET — fetch availability for a property (public, for booking page)
export async function GET(req: NextRequest, { params }: Params) {
  const { propertyId: slug } = await params
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const landlordOnly = searchParams.get('all') === 'true'

  let query = supabaseAdmin
    .from('tour_availabilities')
    .select('*')
    .eq('property_slug', slug)
    .order('date', { ascending: true })
    .order('time_slot', { ascending: true })

  if (!landlordOnly) query = query.eq('is_booked', false)
  if (from) query = query.gte('date', from)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ slots: data || [] })
}

// POST — replace slots for dates (landlord sets availability)
export async function POST(req: NextRequest, { params }: Params) {
  const { propertyId: slug } = await params

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: prop } = await supabaseAdmin.from('properties').select('owner_id').eq('slug', slug).single()
  if (!prop || prop.owner_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { slots = [], clearDates = [] } = body as {
    slots: { date: string; time_slot: string }[]
    clearDates: string[]
  }

  if (clearDates.length > 0) {
    await supabaseAdmin
      .from('tour_availabilities')
      .delete()
      .eq('property_slug', slug)
      .in('date', clearDates)
      .eq('is_booked', false)
  }

  if (slots.length > 0) {
    const rows = slots.map(s => ({
      property_slug: slug,
      landlord_id: user.id,
      date: s.date,
      time_slot: s.time_slot,
    }))
    const { error: upsertErr } = await supabaseAdmin
      .from('tour_availabilities')
      .upsert(rows, { onConflict: 'property_slug,date,time_slot', ignoreDuplicates: true })
    if (upsertErr) return Response.json({ error: upsertErr.message }, { status: 500 })
  }

  return Response.json({ success: true })
}

// DELETE — remove specific slots
export async function DELETE(req: NextRequest, { params }: Params) {
  const { propertyId: slug } = await params

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { slot_ids } = body as { slot_ids: string[] }

  await supabaseAdmin
    .from('tour_availabilities')
    .delete()
    .eq('property_slug', slug)
    .eq('landlord_id', user.id)
    .in('id', slot_ids)
    .eq('is_booked', false)

  return Response.json({ success: true })
}
