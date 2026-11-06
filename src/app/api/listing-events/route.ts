/**
 * POST /api/listing-events
 *
 * Batched funnel events from the public pages: impressions, card clicks,
 * gallery opens, form starts and abandons, saves, tour clicks, shares.
 *
 * The anon key, deliberately: these arrive from logged-out students, and the
 * `Allow public inserts on listing_events` policy is the thing that should be
 * deciding whether the write is allowed. The table's SELECT is service-role
 * only, so nothing here can read anything back.
 *
 * It answers 202 and never an error a browser could act on. This endpoint
 * exists on the critical path of someone looking for somewhere to live; a
 * failed analytics write must cost them nothing.
 */
import { createClient } from '@supabase/supabase-js'
import { LISTING_EVENT_KINDS } from '@/lib/listingEvents'
import type { ListingEventKind } from '@/lib/listingEvents'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/** One page's worth of cards, with room to spare. Anything beyond is a bug or a bot. */
const MAX_EVENTS = 60

const KINDS = new Set<string>(LISTING_EVENT_KINDS)
const SURFACES = new Set(['search', 'listing', 'saved', 'home'])

type Incoming = { property_slug?: unknown; event_type?: unknown; surface?: unknown; position?: unknown }

/** Trust nothing from the wire: this row is insertable by anyone on the internet. */
function clean(e: Incoming) {
  const slug = typeof e.property_slug === 'string' ? e.property_slug.slice(0, 200) : null
  const type = typeof e.event_type === 'string' && KINDS.has(e.event_type) ? (e.event_type as ListingEventKind) : null
  if (!slug || !type) return null
  const pos = Number(e.position)
  return {
    property_slug: slug,
    event_type: type,
    surface: typeof e.surface === 'string' && SURFACES.has(e.surface) ? e.surface : null,
    position: Number.isFinite(pos) && pos > 0 && pos < 1000 ? Math.round(pos) : null,
  }
}

const str = (v: unknown, max = 500) => (typeof v === 'string' && v ? v.slice(0, max) : null)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const incoming: Incoming[] = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : []
    const rows = incoming.map(clean).filter(Boolean) as NonNullable<ReturnType<typeof clean>>[]
    if (!rows.length) return new Response(null, { status: 202 })

    const anonymous_id = str(body?.anonymous_id, 100)
    const session_id = str(body?.session_id, 100)
    const device_type = str(body?.device_type, 40)
    const referrer = str(body?.referrer)
    const utm_source = str(body?.utm_source, 100)

    // One id lookup for the whole batch rather than one per event: a scroll
    // down the search page is thirty events for up to thirty listings, and
    // thirty round trips on a student's page load is not worth a foreign key.
    //
    // It is best-effort by design. This runs on the anon key, so a listing the
    // public cannot see resolves to no row and the event is stored with a null
    // `property_id` — which is correct: the slug is the key every read in this
    // feature uses, and widening the lookup to the service role would mean
    // confirming the existence of private listings to anyone who guesses a slug.
    const slugs = [...new Set(rows.map(r => r.property_slug))]
    const { data: props } = await supabase.from('properties').select('id, slug').in('slug', slugs)
    const idBySlug = new Map((props ?? []).map(p => [p.slug as string, p.id as string]))

    await supabase.from('listing_events').insert(
      rows.map(r => ({
        ...r,
        property_id: idBySlug.get(r.property_slug) ?? null,
        anonymous_id,
        session_id,
        device_type,
        referrer,
        utm_source,
      }))
    )

    return new Response(null, { status: 202 })
  } catch {
    return new Response(null, { status: 202 })
  }
}
