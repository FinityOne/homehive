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
  hero_image: string
  is_active: boolean
  is_featured: boolean
  owner_id: string
  created_at: string
  // joined
  tags: string[]
  images: string[]
  nearby: { place: string; travel_time: string }[]
  asu_reasons: string[]
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
  updates: Partial<Pick<Property, 'name'|'address'|'description'|'price'|'total_rooms'|'available'|'beds'|'baths'|'sqft'|'asu_distance'|'lat'|'lng'|'map_embed_url'|'asu_score'|'hero_image'|'is_active'|'is_featured'>>
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