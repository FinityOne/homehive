import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Load group by share token (public — no auth required)
  const { data: group, error } = await supabaseAdmin
    .from('roommate_groups')
    .select('id, name, description, emoji, gender_preference, property_slug, created_at')
    .eq('share_token', token)
    .single()

  if (error || !group) return Response.json({ error: 'Group not found' }, { status: 404 })

  // Load property details + rooms + hero image
  let property = null
  let rooms: Record<string, unknown>[] = []
  if (group.property_slug) {
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('id, slug, name, address, description, price, beds, baths, sqft')
      .eq('slug', group.property_slug)
      .single()

    if (prop) {
      const { data: imgs } = await supabaseAdmin
        .from('property_images')
        .select('url, position')
        .eq('property_id', prop.id)
        .is('room_id', null)
        .order('position', { ascending: true })
        .limit(1)

      const { data: propRooms } = await supabaseAdmin
        .from('property_rooms')
        .select('id, name, price, is_available, position')
        .eq('property_id', prop.id)
        .order('position', { ascending: true })

      const roomIds = (propRooms || []).map((r: Record<string, unknown>) => r.id as string)
      let roomImages: Record<string, string[]> = {}
      if (roomIds.length > 0) {
        const { data: roomImgs } = await supabaseAdmin
          .from('property_images')
          .select('room_id, url, position')
          .in('room_id', roomIds)
          .order('position', { ascending: true })
        for (const img of roomImgs || []) {
          const rid = img.room_id as string
          if (!roomImages[rid]) roomImages[rid] = []
          roomImages[rid].push(img.url as string)
        }
      }

      property = {
        ...prop,
        hero_image: imgs?.[0]?.url ?? null,
      }
      rooms = (propRooms || []).map((r: Record<string, unknown>) => ({
        ...r,
        images: roomImages[r.id as string] ?? [],
      }))
    }
  }

  // Load members with prescreen bios
  const { data: members } = await supabaseAdmin
    .from('roommate_group_members')
    .select('id, lead_id, room_id, added_at, leads(id, first_name, last_name, status)')
    .eq('group_id', group.id)
    .order('added_at', { ascending: true })

  const leadIds = (members || [])
    .map((m: Record<string, unknown>) => (m.leads as { id: string } | null)?.id)
    .filter(Boolean) as string[]

  let prescreens: Record<string, Record<string, unknown>> = {}
  if (leadIds.length > 0) {
    const { data: ps } = await supabaseAdmin
      .from('pre_screens')
      .select('lead_id, about, lifestyle, occupation, university, gender')
      .in('lead_id', leadIds)
    prescreens = Object.fromEntries(
      (ps || []).map((p: Record<string, unknown>) => [p.lead_id as string, p])
    )
  }

  const enrichedMembers = (members || []).map((m: Record<string, unknown>) => {
    const lead = m.leads as { id: string; first_name: string | null; last_name: string | null; status: string } | null
    const ps = lead ? prescreens[lead.id] : null
    return {
      id: m.id,
      room_id: m.room_id,
      added_at: m.added_at,
      first_name: lead?.first_name ?? null,
      last_name: lead?.last_name ? lead.last_name[0] + '.' : null, // only initial for privacy
      has_prescreen: !!ps,
      about: ps?.about ?? null,
      lifestyle: ps?.lifestyle ?? null,
      occupation: ps?.occupation ?? null,
      university: ps?.university ?? null,
      gender: ps?.gender ?? null,
    }
  })

  return Response.json({ group, property, rooms, members: enrichedMembers })
}
