import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
  // joined
  tags: string[]
  images: string[]
  nearby: { place: string; travel_time: string }[]
  asu_reasons: string[]
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
}

export async function createProperty(
  ownerId: string,
  data: NewPropertyInput
): Promise<{ slug: string | null; id: string | null; error: any }> {
  // Generate a slug from the name + random suffix
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
    .select(`
      *,
      property_tags ( tag ),
      property_images ( url, position ),
      property_nearby ( place, travel_time ),
      property_asu_reasons ( reason, position )
    `)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching all properties for admin:', error)
    return []
  }

  return data.map(p => ({
    ...p,
    tags:       p.property_tags.map((t: any) => t.tag),
    images:     p.property_images
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((i: any) => i.url),
    nearby:     p.property_nearby.map((n: any) => ({
                  place: n.place,
                  travel_time: n.travel_time,
                })),
    asu_reasons: p.property_asu_reasons
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((r: any) => r.reason),
  }))
}

export async function getPropertyByIdForAdmin(id: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(`
      *,
      property_tags ( tag ),
      property_images ( url, position ),
      property_nearby ( place, travel_time ),
      property_asu_reasons ( reason, position )
    `)
    .eq('id', id)
    .single()

  if (error || !data) return null

  return {
    ...data,
    tags: data.property_tags.map((t: any) => t.tag),
    images: data.property_images
              .sort((a: any, b: any) => a.position - b.position)
              .map((i: any) => i.url),
    nearby: data.property_nearby.map((n: any) => ({ place: n.place, travel_time: n.travel_time })),
    asu_reasons: data.property_asu_reasons
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((r: any) => r.reason),
  }
}

export async function updatePropertyAdminStatus(
  id: string,
  adminStatus: AdminStatus,
  isTest: boolean,
  reviewNote?: string | null
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('properties')
    .update({
      admin_status: adminStatus,
      is_test: isTest,
      is_active: adminStatus === 'active',
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

export async function getProperties(): Promise<Property[]> {
  const { data, error } = await supabase
    .from('properties')
    .select(`
      *,
      property_tags ( tag ),
      property_images ( url, position ),
      property_nearby ( place, travel_time ),
      property_asu_reasons ( reason, position )
    `)
    .eq('is_active', true)
    .eq('is_test', false)
    .order('created_at', { ascending: true })

  if (error || !data) {
    console.error('Error fetching properties:', error)
    return []
  }

  return data.map(p => ({
    ...p,
    tags:       p.property_tags.map((t: any) => t.tag),
    images:     p.property_images
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((i: any) => i.url),
    nearby:     p.property_nearby.map((n: any) => ({
                  place: n.place,
                  travel_time: n.travel_time,
                })),
    asu_reasons: p.property_asu_reasons
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((r: any) => r.reason),
  }))
}

export async function getPropertiesByOwner(userId: string): Promise<Property[]> {
  const { data, error } = await supabase
    .from('properties')
    .select(`
      *,
      property_tags ( tag ),
      property_images ( url, position ),
      property_nearby ( place, travel_time ),
      property_asu_reasons ( reason, position )
    `)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })

  if (error || !data) {
    console.error('Error fetching owner properties:', error)
    return []
  }

  return data.map(p => ({
    ...p,
    tags:       p.property_tags.map((t: any) => t.tag),
    images:     p.property_images
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((i: any) => i.url),
    nearby:     p.property_nearby.map((n: any) => ({
                  place: n.place,
                  travel_time: n.travel_time,
                })),
    asu_reasons: p.property_asu_reasons
                  .sort((a: any, b: any) => a.position - b.position)
                  .map((r: any) => r.reason),
  }))
}

export async function updatePropertyCore(
  id: string,
  updates: Partial<Pick<Property, 'name'|'address'|'description'|'price'|'total_rooms'|'available'|'beds'|'baths'|'sqft'|'asu_distance'|'lat'|'lng'|'map_embed_url'|'asu_score'|'is_active'|'is_featured'|'security_deposit'>>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', id)
  return { error }
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

export async function deletePropertyImage(propertyId: string, url: string): Promise<{ error: any }> {
  const { error: delError } = await supabase
    .from('property_images')
    .delete()
    .eq('property_id', propertyId)
    .eq('url', url)
  if (delError) return { error: delError }
  // Re-sequence positions
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
    .select(`
      *,
      property_tags ( tag ),
      property_images ( url, position ),
      property_nearby ( place, travel_time ),
      property_asu_reasons ( reason, position )
    `)
    .eq('claim_token', token)
    .single()

  if (error || !data) return null

  return {
    ...data,
    tags:        data.property_tags.map((t: any) => t.tag),
    images:      data.property_images
                   .sort((a: any, b: any) => a.position - b.position)
                   .map((i: any) => i.url),
    nearby:      data.property_nearby.map((n: any) => ({
                   place: n.place,
                   travel_time: n.travel_time,
                 })),
    asu_reasons: data.property_asu_reasons
                   .sort((a: any, b: any) => a.position - b.position)
                   .map((r: any) => r.reason),
  }
}

export async function getPropertyBySlug(slug: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(`
      *,
      property_tags ( tag ),
      property_images ( url, position ),
      property_nearby ( place, travel_time ),
      property_asu_reasons ( reason, position )
    `)
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('is_test', false)
    .single()

  if (error || !data) return null

  return {
    ...data,
    tags:        data.property_tags.map((t: any) => t.tag),
    images:      data.property_images
                   .sort((a: any, b: any) => a.position - b.position)
                   .map((i: any) => i.url),
    nearby:      data.property_nearby.map((n: any) => ({
                   place: n.place,
                   travel_time: n.travel_time,
                 })),
    asu_reasons: data.property_asu_reasons
                   .sort((a: any, b: any) => a.position - b.position)
                   .map((r: any) => r.reason),
  }
}