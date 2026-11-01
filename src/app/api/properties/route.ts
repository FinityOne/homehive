import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin, loadPlanState } from '@/lib/landlordPlanServer'
import { formatPropertyLimit, smallestTierFor, PLANS } from '@/lib/landlordPlans'
import { sendListingLiveEmail } from '@/lib/listingEmails'
import { getPlatformStats } from '@/lib/platformStats'

/**
 * Create a property. Free, up to a ceiling.
 *
 * Listing creation used to require a plan. It no longer does: building is the
 * work, publishing is the product, and asking for a card before any work is
 * done is asking at the one moment the landlord has nothing invested. They can
 * now build up to `FREE_PROPERTY_LIMIT` properties, finish them completely,
 * and publish by paying — the listing goes live on its own when the plan
 * starts, because `owner_plan_active` is trigger-maintained.
 *
 * Listing creation used to be a direct insert from the browser. The ceiling is
 * the whole business model, so the count and the insert have to happen in one
 * place the landlord cannot reach around — here, where the count is read and
 * the row is written under the service key in the same request.
 *
 * Listings are created `active`, not `pending`. The review queue used to stand
 * between a landlord and their own listing, which meant the worst wait on the
 * platform came immediately after the one moment they were most invested. The
 * paywall replaced it as the gate that matters: a listing only reaches students
 * while its landlord is paying, which `owner_plan_active` enforces in the
 * database. Moderation still exists — an admin can flag or reject any listing
 * afterwards — it just no longer makes everyone queue.
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

  // Building is free — no plan check here. The gate is the ceiling, and which
  // ceiling applies depends on whether they are paying (see landlordAccess.ts).
  if (!state.canAddProperty) {
    // Name the tier that would fix it. A landlord at their ceiling is the most
    // qualified upgrade prospect on the platform; telling them "limit reached"
    // and nothing else wastes the moment.
    const suggested = smallestTierFor(state.propertyCount + 1)
    const n = state.propertyAllowance
    return Response.json({
      error: state.hasAccess
        ? `Your plan covers ${formatPropertyLimit(n)} propert${n === 1 ? 'y' : 'ies'} ` +
          `and all of them are in use. Upgrade to ${PLANS[suggested].name} to add another.`
        : `You can build ${formatPropertyLimit(n)} propert${n === 1 ? 'y' : 'ies'} for free, ` +
          `and ${n === 1 ? 'it is' : 'they are'} all set up. ` +
          `Start a plan to publish ${n === 1 ? 'it' : 'them'} and add more.`,
      reason: state.hasAccess ? 'limit_reached' : 'free_limit_reached',
      propertyCount: state.propertyCount,
      propertyLimit: state.propertyAllowance,
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
      // Live the moment it is created. `owner_plan_active` is set by trigger
      // and is what actually decides whether students see it, so a landlord
      // between plans gets a finished listing that publishes itself on payment
      // rather than a listing stuck behind a queue.
      is_active: true,
      admin_status: 'active',
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

  // Confirm it in writing. The landlord has just done real work and the email
  // is the receipt — it says where the listing is, whether students can see it
  // yet, and what to do next. Awaited so a serverless invocation does not get
  // frozen mid-send, but never allowed to fail the creation: the listing
  // exists, and reporting an error now would send them back to re-create it.
  try {
    const email = user.email ?? ''
    if (email) {
      const stats = await getPlatformStats(db)
      await sendListingLiveEmail({
        to: email,
        propertyName: body.name.trim(),
        propertySlug: slug,
        // Free landlords get the `needs_plan` version: the listing is finished
        // and one payment away from students, which is the most persuasive
        // thing we can truthfully say at this exact moment.
        state: state.canPublish ? 'live' : 'needs_plan',
        stats,
      })
    }
  } catch (err) {
    console.error('[properties] confirmation email failed:', err)
  }

  return Response.json({ slug, id: row.id })
}
