/**
 * POST /api/page-views
 *
 * Records one listing page view, and answers with what the page may say about
 * everyone else looking at it.
 *
 * Both halves live in one request on purpose: the view has just been written,
 * so the counts returned include the person reading them, and the listing page
 * gets its social proof without a second round trip on an already image-heavy
 * page.
 *
 * Two clients, for two different reasons:
 *   • the insert goes through the anon key, so it keeps exercising the
 *     `Allow public inserts on property_page_views` policy rather than
 *     bypassing RLS from a surface a logged-out visitor reaches;
 *   • the counts go through the service role, because SELECT on that table is
 *     granted to the service role only. Only two integers come back, both of
 *     which the page is about to show to everyone anyway.
 */
import { createClient } from '@supabase/supabase-js'
import { describeSocialProof, SOCIAL_PROOF_DAYS, windowDayKeys } from '@/lib/listingPulse'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = serviceKey
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } })
  : null

/** Midnight Phoenix, `SOCIAL_PROOF_DAYS` ago. Phoenix is UTC−7 all year. */
function windowStart(now: Date): string {
  return `${windowDayKeys(now, SOCIAL_PROOF_DAYS)[0]}T07:00:00.000Z`
}

/**
 * Distinct people who opened this listing in the window, and how many wrote in.
 *
 * Counted on `anonymous_id` with `session_id` as the fallback, the same
 * identity rule the landlord overview uses, so a renter and the landlord are
 * never shown two different numbers for the same week.
 */
async function socialProofFor(slug: string, availableRooms: number, now: Date) {
  if (!admin) return null
  const from = windowStart(now)

  const [viewRes, leadRes] = await Promise.all([
    admin
      .from('property_page_views')
      .select('anonymous_id, session_id')
      .eq('property_slug', slug)
      .gte('created_at', from),
    admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('property', slug)
      .gte('created_at', from),
  ])

  if (viewRes.error) {
    console.error('page-views: social proof read failed', viewRes.error)
    return null
  }

  const people = new Set<string>()
  for (const [i, row] of (viewRes.data ?? []).entries()) {
    people.add(row.anonymous_id ? `a:${row.anonymous_id}` : row.session_id ? `s:${row.session_id}` : `r:${i}`)
  }

  const proof = describeSocialProof({
    viewers: people.size,
    inquiries: leadRes.count ?? 0,
    availableRooms,
  })
  return proof ? { ...proof, viewers: people.size, inquiries: leadRes.count ?? 0 } : null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      property_slug,
      session_id,
      anonymous_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      landing_page,
      referrer,
      device_type,
    } = body

    if (!property_slug) return Response.json({ error: 'property_slug required' }, { status: 400 })

    // Resolve property_id from slug
    const { data: prop } = await supabase
      .from('properties')
      .select('id, available')
      .eq('slug', property_slug)
      .single()

    await supabase.from('property_page_views').insert([{
      property_id:   prop?.id ?? null,
      property_slug,
      session_id:    session_id || null,
      anonymous_id:  anonymous_id || null,
      utm_source:    utm_source || null,
      utm_medium:    utm_medium || null,
      utm_campaign:  utm_campaign || null,
      utm_content:   utm_content || null,
      landing_page:  landing_page || null,
      referrer:      referrer || null,
      device_type:   device_type || null,
    }])

    const proof = await socialProofFor(property_slug, Number(prop?.available) || 0, new Date())

    return Response.json({ ok: true, proof })
  } catch {
    return Response.json({ ok: false })
  }
}
