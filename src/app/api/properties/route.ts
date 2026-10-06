import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin, loadPlanState } from '@/lib/landlordPlanServer'
import { formatPropertyLimit, smallestTierFor, PLANS } from '@/lib/landlordPlans'

/**
 * Create a property, inside the landlord's plan.
 *
 * Listing creation used to be a direct insert from the browser. The plan cap
 * is the whole business model, so the count and the insert have to happen in
 * one place the landlord cannot reach around — here, where the count is read
 * and the row is written under the service key in the same request.
 */

type Body = {
  name?: string
  address?: string
  description?: string
  price?: number
  listing_type?: 'standard_rental' | 'sublease' | 'lease_transfer'
  unit_type?: string | null
  roommates_count?: number | null
  sublease_end_date?: string | null
  beds?: number
  baths?: number
  sqft?: string
  total_rooms?: number
  available?: number
  asu_distance?: number
  security_deposit?: number | null
  utilities_included?: boolean
  rental_mode?: 'whole_home' | 'by_room'
  available_from?: string | null
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 7)
  return `${base || 'listing'}-${suffix}`
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (!body.name?.trim() || !body.address?.trim() || !body.listing_type) {
    return Response.json({ error: 'Name, address and listing type are required.' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const state = await loadPlanState(db, user.id)

  if (!state.hasAccess) {
    return Response.json({
      error: 'Choose a plan to start listing properties.',
      reason: 'no_plan',
    }, { status: 402 })
  }

  if (!state.canAddProperty) {
    // Name the tier that would fix it. A landlord at their cap is the most
    // qualified upgrade prospect on the platform; telling them "limit reached"
    // and nothing else wastes the moment.
    const suggested = smallestTierFor(state.propertyCount + 1)
    return Response.json({
      error:
        `Your plan covers ${formatPropertyLimit(state.propertyLimit)} ` +
        `propert${state.propertyLimit === 1 ? 'y' : 'ies'} and all of them are in use. ` +
        `Upgrade to ${PLANS[suggested].name} to add another.`,
      reason: 'limit_reached',
      propertyCount: state.propertyCount,
      propertyLimit: state.propertyLimit,
      suggestedPlan: suggested,
    }, { status: 402 })
  }

  const slug = slugify(body.name.trim())

  const { data: row, error } = await db
    .from('properties')
    .insert({
      slug,
      owner_id: user.id,
      name: body.name.trim(),
      address: body.address.trim(),
      description: body.description?.trim() || '',
      price: body.price ?? 0,
      listing_type: body.listing_type,
      unit_type: body.unit_type ?? null,
      roommates_count: body.roommates_count ?? null,
      sublease_end_date: body.sublease_end_date ?? null,
      beds: body.beds ?? 1,
      baths: body.baths ?? 1,
      sqft: body.sqft ?? '',
      total_rooms: body.total_rooms ?? 1,
      available: body.available ?? 1,
      asu_distance: body.asu_distance ?? 0,
      security_deposit: body.security_deposit ?? null,
      utilities_included: body.utilities_included ?? false,
      rental_mode: body.rental_mode ?? 'whole_home',
      available_from: body.available_from ?? null,
      is_active: false,
      admin_status: 'pending',
      is_featured: false,
      lat: 0,
      lng: 0,
      map_embed_url: '',
      asu_score: 7,
    })
    .select('id')
    .single()

  if (error || !row) {
    console.error('[properties] insert failed:', error)
    return Response.json({ error: 'Could not create the listing. Please try again.' }, { status: 500 })
  }

  return Response.json({ slug, id: row.id })
}
