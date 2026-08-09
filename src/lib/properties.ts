import { createBrowserClient } from '@supabase/ssr'
import { computeIsActive, type ListingStatus } from './listingStatus'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type PropertyRoom = {
  id: string
  property_id: string
  name: string
  price: number
  is_available: boolean
  position: number
  images: string[]
}

export type Property = {
  id: string
  slug: string
  name: string
  address: string
  description: string
  price: number
  total_rooms: number
  available: number
  beds: number
  baths: number
  sqft: string
  asu_distance: number
  lat: number
  lng: number
  map_embed_url: string
  asu_score: number
  is_active: boolean
  is_featured: boolean
  owner_id: string
  created_at: string
  listing_type: 'standard_rental' | 'sublease' | 'lease_transfer'
  unit_type: 'room_in_house' | 'apartment' | 'condo' | 'studio' | null
  roommates_count: number | null
  sublease_end_date: string | null
  is_test: boolean
  admin_status: 'pending' | 'active' | 'inactive' | 'test' | 'flagged' | 'rejected'
  review_note: string | null
  security_deposit: number | null
  claim_token: string | null
  is_claimable: boolean
  sublease_start_date: string | null
  offer_amount: number | null
  offer_deadline: string | null
  offer_description: string | null
  utilities_included: boolean
  rental_mode: 'whole_home' | 'by_room'
  available_from: string | null
  // landlord-controlled market state (see src/lib/listingStatus.ts)
  listing_status: ListingStatus
  marketing_enabled: boolean
  accepting_inquiries: boolean
  show_when_rented: boolean
  rented_until: string | null
  status_changed_at: string | null
  // archive lifecycle (auto-archived after 30d of inactivity; NULL = live)
  archived_at: string | null
  archived_reason: string | null
  archive_warned_at: string | null
  // joined
  tags: string[]
  images: string[]
  nearby: { place: string; travel_time: string }[]
  asu_reasons: string[]
  rooms: PropertyRoom[]
}

export type NewPropertyInput = {
  name: string
  address: string
  description?: string
  price: number
  listing_type: 'standard_rental' | 'sublease' | 'lease_transfer'
  unit_type?: 'room_in_house' | 'apartment' | 'condo' | 'studio' | null
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

const PROPERTY_SELECT = `
  *,
  property_tags ( tag ),
  property_images ( id, url, position, room_id ),
  property_nearby ( place, travel_time ),
  property_asu_reasons ( reason, position ),
  property_rooms ( id, property_id, name, price, is_available, position )
`

// Status columns default to "live" so rows written before the status feature —
// or by code paths that don't set them — never read as accidentally hidden.
function statusDefaults(p: any) {
  return {
    listing_status: (p.listing_status ?? 'active') as ListingStatus,
    marketing_enabled: p.marketing_enabled ?? true,
    accepting_inquiries: p.accepting_inquiries ?? true,
    show_when_rented: p.show_when_rented ?? false,
    rented_until: p.rented_until ?? null,
    status_changed_at: p.status_changed_at ?? null,
  }
}

function mapProperty(p: any): Property {
  // Sort all images by position
  const allImages: any[] = [...(p.property_images ?? [])].sort((a, b) => a.position - b.position)

  // Separate general images (no room) and room-specific images
  const generalImages = allImages.filter((i: any) => i.room_id == null)
  const roomImages = allImages.filter((i: any) => i.room_id != null)

  // Build a map: room_id -> string[]
  const roomImgMap: Record<string, string[]> = {}
  for (const img of roomImages) {
    if (!roomImgMap[img.room_id]) roomImgMap[img.room_id] = []
    roomImgMap[img.room_id].push(img.url)
  }

  // Map rooms with their images
  const rooms: PropertyRoom[] = (p.property_rooms ?? [])
    .sort((a: any, b: any) => a.position - b.position)
    .map((r: any) => ({
      id: r.id,
      property_id: p.id,
      name: r.name,
      price: r.price,
      is_available: r.is_available,
      position: r.position,
      images: roomImgMap[r.id] ?? [],
    }))

  // Flat list: general images first, then all room images in room/position order
  const allRoomUrls = rooms.flatMap(r => r.images)
  const images = [...generalImages.map((i: any) => i.url), ...allRoomUrls]

  return {
    ...p,
    ...statusDefaults(p),
    rental_mode: (p.rental_mode ?? 'whole_home') as 'whole_home' | 'by_room',
    tags: p.property_tags.map((t: any) => t.tag),
    images,
    nearby: p.property_nearby.map((n: any) => ({
      place: n.place,
      travel_time: n.travel_time,
    })),
    asu_reasons: p.property_asu_reasons
      .sort((a: any, b: any) => a.position - b.position)
      .map((r: any) => r.reason),
    rooms,
  }
}

// ── Home / browse card data ──────────────────────────────────────────────────
// The home & browse pages only render card fields (name, price, beds/baths,
// distance, tags, images). They never touch rooms / nearby / asu_reasons, so the
// card query skips those joins entirely — far less data + DB work per request.
export const PROPERTY_CARD_SELECT = `
  *,
  property_tags ( tag ),
  property_images ( url, position, room_id )
`

// Tolerant mapper for the lightweight card query: rooms/nearby/asu_reasons that
// weren't fetched come back as empty arrays so the Property type stays satisfied.
export function mapPropertyCard(p: any): Property {
  const generalImages = [...(p.property_images ?? [])]
    .filter((i: any) => i.room_id == null)
    .sort((a: any, b: any) => a.position - b.position)
    .map((i: any) => i.url)
  // Fall back to any image if there are no general (non-room) images
  const images = generalImages.length > 0
    ? generalImages
    : [...(p.property_images ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => i.url)

  return {
    ...p,
    ...statusDefaults(p),
    rental_mode: (p.rental_mode ?? 'whole_home') as 'whole_home' | 'by_room',
    tags: (p.property_tags ?? []).map((t: any) => t.tag),
    images,
    nearby: [],
    asu_reasons: [],
    rooms: [],
  }
}

export async function createProperty(
  ownerId: string,
  data: NewPropertyInput
): Promise<{ slug: string | null; id: string | null; error: any }> {
  const base = data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 7)
  const slug = `${base}-${suffix}`

  const { data: row, error } = await supabase
    .from('properties')
    .insert({
      slug,
      owner_id: ownerId,
      name: data.name,
      address: data.address,
      description: data.description || '',
      price: data.price,
      listing_type: data.listing_type,
      unit_type: data.unit_type ?? null,
      roommates_count: data.roommates_count ?? null,
      sublease_end_date: data.sublease_end_date ?? null,
      beds: data.beds ?? 1,
      baths: data.baths ?? 1,
      sqft: data.sqft ?? '',
      total_rooms: data.total_rooms ?? 1,
      available: data.available ?? 1,
      asu_distance: data.asu_distance ?? 0,
      security_deposit: data.security_deposit ?? null,
      utilities_included: data.utilities_included ?? false,
      rental_mode: data.rental_mode ?? 'whole_home',
      available_from: data.available_from ?? null,
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

  if (error) return { slug: null, id: null, error }
  return { slug, id: row?.id ?? null, error: null }
}

export type AdminStatus = 'pending' | 'active' | 'inactive' | 'test' | 'flagged' | 'rejected'

export async function getAllPropertiesForAdmin(): Promise<Property[]> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching all properties for admin:', error)
    return []
  }

  return data.map(mapProperty)
}

export async function getPropertyByIdForAdmin(id: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('id', id)
    .single()

  if (error || !data) return null
  return mapProperty(data)
}

export async function updatePropertyAdminStatus(
  id: string,
  adminStatus: AdminStatus,
  isTest: boolean,
  reviewNote?: string | null
): Promise<{ error: any }> {
  // Approving a listing must not override the landlord's own status — a home
  // they marked Rented or Inactive stays hidden once we approve it.
  const { data: current } = await supabase
    .from('properties')
    .select('listing_status, show_when_rented')
    .eq('id', id)
    .single()

  const { error } = await supabase
    .from('properties')
    .update({
      admin_status: adminStatus,
      is_test: isTest,
      is_active: computeIsActive({
        listing_status: (current?.listing_status ?? 'active') as ListingStatus,
        show_when_rented: current?.show_when_rented ?? false,
        admin_status: adminStatus,
      }),
      ...(reviewNote !== undefined ? { review_note: reviewNote } : {}),
    })
    .eq('id', id)
  return { error }
}

export async function getTotalPropertyCount(): Promise<number> {
  const { count } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
  return count ?? 0
}

// PostgREST filter for the landlord's status axis: Live listings, plus Rented
// ones the landlord chose to keep up for waitlist interest. Inactive listings
// never match. Kept as a string so every public query applies the same rule.
export const PUBLIC_STATUS_FILTER =
  'listing_status.eq.active,and(listing_status.eq.rented,show_when_rented.is.true)'

// Public listing feed for the home + browse pages. Uses the lightweight card
// query and excludes archived listings so only fresh inventory shows.
// `marketingOnly` narrows it to promotional surfaces (homepage / featured).
export async function getProperties(opts: { marketingOnly?: boolean } = {}): Promise<Property[]> {
  let query = supabase
    .from('properties')
    .select(PROPERTY_CARD_SELECT)
    .eq('is_active', true)
    .eq('admin_status', 'active')
    .eq('is_test', false)
    .is('archived_at', null)
    .or(PUBLIC_STATUS_FILTER)

  if (opts.marketingOnly) {
    query = query.eq('marketing_enabled', true).eq('listing_status', 'active')
  }

  const { data, error } = await query.order('created_at', { ascending: true })

  if (error || !data) {
    console.error('Error fetching properties:', error)
    return []
  }

  return data.map(mapPropertyCard)
}

// Fetch a specific set of live listings by slug (used by the Shortlist page).
// Preserves the caller's slug order so a shared shortlist keeps its ordering.
export async function getPropertiesBySlugs(slugs: string[]): Promise<Property[]> {
  if (!slugs.length) return []
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_CARD_SELECT)
    .in('slug', slugs)
    .eq('is_active', true)
    .eq('admin_status', 'active')
    .eq('is_test', false)
    .is('archived_at', null)
    .or(PUBLIC_STATUS_FILTER)

  if (error || !data) {
    console.error('Error fetching properties by slug:', error)
    return []
  }

  const mapped = data.map(mapPropertyCard)
  const order = new Map(slugs.map((s, i) => [s, i]))
  return mapped.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0))
}

export async function getPropertiesByOwner(userId: string): Promise<Property[]> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })

  if (error || !data) {
    console.error('Error fetching owner properties:', error)
    return []
  }

  return data.map(mapProperty)
}

export async function updatePropertyOffer(
  id: string,
  offer: { offer_amount: number | null; offer_deadline: string | null; offer_description: string | null }
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('properties')
    .update(offer)
    .eq('id', id)
  return { error }
}

export async function updatePropertyCore(
  id: string,
  updates: Partial<Pick<Property, 'name'|'address'|'description'|'price'|'total_rooms'|'available'|'beds'|'baths'|'sqft'|'asu_distance'|'lat'|'lng'|'map_embed_url'|'asu_score'|'is_active'|'is_featured'|'security_deposit'|'utilities_included'|'rental_mode'|'available_from'>>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', id)
  return { error }
}

export type ListingStatusPatch = {
  listing_status: ListingStatus
  marketing_enabled: boolean
  accepting_inquiries: boolean
  show_when_rented: boolean
  rented_until: string | null
}

/**
 * Write the landlord's status settings. `is_active` — the column the public RLS
 * policy and every legacy query read — is recomputed here from both the
 * landlord's choice and HomeHive's approval state, so the two can never drift.
 * A listing awaiting review stays hidden no matter what the landlord picks.
 */
export async function updateListingStatus(
  id: string,
  patch: ListingStatusPatch,
  adminStatus: string
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('properties')
    .update({
      ...patch,
      // Room counts are deliberately left alone — they're the landlord's data
      // and must survive a Rented → Live round trip intact.
      is_active: computeIsActive({ ...patch, admin_status: adminStatus }),
      status_changed_at: new Date().toISOString(),
    })
    .eq('id', id)
  return { error }
}

// Archive / re-activate a listing. Re-activating bumps updated_at so the
// freshness clock resets and clears any pending archive warning.
export async function setPropertyArchived(
  id: string,
  archived: boolean,
  reason: string | null = archived ? 'manual' : null,
): Promise<{ error: any }> {
  const updates = archived
    ? { archived_at: new Date().toISOString(), archived_reason: reason }
    : { archived_at: null, archived_reason: null, archive_warned_at: null, updated_at: new Date().toISOString() }
  const { error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', id)
  return { error }
}

export async function replacePropertyRooms(
  propertyId: string,
  rooms: { name: string; price: number; is_available: boolean }[],
  syncProperty: boolean = true
): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_rooms')
    .delete()
    .eq('property_id', propertyId)
  if (delError) return { error: delError }

  if (rooms.length > 0) {
    const { error: insError } = await supabase
      .from('property_rooms')
      .insert(
        rooms.map((r, i) => ({
          property_id: propertyId,
          name: r.name,
          price: r.price,
          is_available: r.is_available,
          position: i,
        }))
      )
    if (insError) return { error: insError }
  }

  if (syncProperty && rooms.length > 0) {
    const availableCount = rooms.filter(r => r.is_available).length
    const minPrice = Math.min(...rooms.map(r => r.price))
    const { error: syncErr } = await supabase
      .from('properties')
      .update({
        price: minPrice,
        total_rooms: rooms.length,
        available: availableCount,
      })
      .eq('id', propertyId)
    return { error: syncErr }
  }

  return { error: null }
}

export async function replacePropertyTags(propertyId: string, tags: string[]): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_tags')
    .delete()
    .eq('property_id', propertyId)
  if (delError) return { error: delError }

  if (tags.length === 0) return { error: null }

  const { error: insError } = await supabase
    .from('property_tags')
    .insert(tags.map(tag => ({ property_id: propertyId, tag })))
  return { error: insError }
}

export async function replacePropertyNearby(
  propertyId: string,
  nearby: { place: string; travel_time: string }[]
): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_nearby')
    .delete()
    .eq('property_id', propertyId)
  if (delError) return { error: delError }

  if (nearby.length === 0) return { error: null }

  const { error: insError } = await supabase
    .from('property_nearby')
    .insert(nearby.map(n => ({ property_id: propertyId, place: n.place, travel_time: n.travel_time })))
  return { error: insError }
}

export async function replacePropertyAsuReasons(propertyId: string, reasons: string[]): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_asu_reasons')
    .delete()
    .eq('property_id', propertyId)
  if (delError) return { error: delError }

  if (reasons.length === 0) return { error: null }

  const { error: insError } = await supabase
    .from('property_asu_reasons')
    .insert(reasons.map((reason, position) => ({ property_id: propertyId, reason, position })))
  return { error: insError }
}

export async function replacePropertyImages(propertyId: string, images: string[]): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_images')
    .delete()
    .eq('property_id', propertyId)
  if (delError) return { error: delError }

  if (images.length === 0) return { error: null }

  const { error: insError } = await supabase
    .from('property_images')
    .insert(images.map((url, position) => ({ property_id: propertyId, url, position })))
  return { error: insError }
}

export async function uploadPropertyImage(
  file: File,
  userId: string,
  propertyId: string
): Promise<{ url: string | null; error: any }> {
  const path = `${userId}/${propertyId}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

export async function uploadRoomImage(
  file: File,
  userId: string,
  propertyId: string,
  roomId: string
): Promise<{ url: string | null; error: any }> {
  const path = `${userId}/${propertyId}/rooms/${roomId}/${Date.now()}-${file.name}`
  const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

export async function deletePropertyImage(propertyId: string, url: string): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_images')
    .delete()
    .eq('property_id', propertyId)
    .eq('url', url)
  if (delError) return { error: delError }
  const { data } = await supabase
    .from('property_images')
    .select('id')
    .eq('property_id', propertyId)
    .order('position')
  if (data) {
    for (let i = 0; i < data.length; i++) {
      await supabase.from('property_images').update({ position: i }).eq('id', data[i].id)
    }
  }
  return { error: null }
}

export async function getPropertyByClaimToken(token: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('claim_token', token)
    .single()

  if (error || !data) return null
  return mapProperty(data)
}

export async function getPropertyBySlug(slug: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('is_test', false)
    .or(PUBLIC_STATUS_FILTER)
    .single()

  if (error || !data) return null
  return mapProperty(data)
}
