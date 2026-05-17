import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(req: Request) {
  // Auth
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '').trim()
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch all memberships for this user
  const { data: memberships, error: memError } = await supabaseAdmin
    .from('roommate_group_members')
    .select('id, group_id, room_id, added_at')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false })

  if (memError) return Response.json({ error: 'Failed to fetch memberships' }, { status: 500 })
  if (!memberships || memberships.length === 0) return Response.json({ groups: [] })

  const groupIds = memberships.map((m: { group_id: string }) => m.group_id)

  // Fetch group details
  const { data: groups } = await supabaseAdmin
    .from('roommate_groups')
    .select('id, name, emoji, description, gender_preference, share_token, property_slug')
    .in('id', groupIds)

  if (!groups || groups.length === 0) return Response.json({ groups: [] })

  // Fetch member counts per group
  const { data: memberCounts } = await supabaseAdmin
    .from('roommate_group_members')
    .select('group_id')
    .in('group_id', groupIds)

  const countMap: Record<string, number> = {}
  for (const row of memberCounts || []) {
    countMap[row.group_id] = (countMap[row.group_id] || 0) + 1
  }

  // Fetch property names for each unique property_slug
  const slugs = [...new Set(groups.map((g: { property_slug: string | null }) => g.property_slug).filter(Boolean))] as string[]
  let propertyMap: Record<string, { name: string; slug: string }> = {}
  if (slugs.length > 0) {
    const { data: props } = await supabaseAdmin
      .from('properties')
      .select('slug, name')
      .in('slug', slugs)
    for (const p of props || []) {
      propertyMap[p.slug] = { name: p.name, slug: p.slug }
    }
  }

  // Fetch room details for room_ids found in memberships
  const roomIds = memberships.map((m: { room_id: string | null }) => m.room_id).filter(Boolean) as string[]
  let roomMap: Record<string, { id: string; name: string }> = {}
  if (roomIds.length > 0) {
    const { data: rooms } = await supabaseAdmin
      .from('property_rooms')
      .select('id, name')
      .in('id', roomIds)
    for (const r of rooms || []) {
      roomMap[r.id] = { id: r.id, name: r.name }
    }
  }

  // Fetch last message per group
  const lastMessageMap: Record<string, { content: string; sender_name: string; created_at: string; is_bot: boolean } | null> = {}
  await Promise.all(
    groupIds.map(async (gid: string) => {
      const { data: msgs } = await supabaseAdmin
        .from('group_messages')
        .select('content, sender_name, created_at, is_bot')
        .eq('group_id', gid)
        .order('created_at', { ascending: false })
        .limit(1)
      lastMessageMap[gid] = msgs?.[0] ?? null
    })
  )

  // Build membership lookup
  const membershipByGroup: Record<string, { id: string; room_id: string | null; added_at: string }> = {}
  for (const m of memberships) {
    membershipByGroup[m.group_id] = m
  }

  const result = groups.map((g: {
    id: string; name: string; emoji: string; description: string | null
    gender_preference: string; share_token: string; property_slug: string | null
  }) => {
    const membership = membershipByGroup[g.id]
    const prop = g.property_slug ? propertyMap[g.property_slug] : null
    const room = membership?.room_id ? roomMap[membership.room_id] : null
    return {
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      description: g.description,
      gender_preference: g.gender_preference,
      share_token: g.share_token,
      property_slug: g.property_slug,
      property_name: prop?.name ?? null,
      member_count: countMap[g.id] ?? 0,
      joined_at: membership?.added_at ?? null,
      room_id: room?.id ?? null,
      room_name: room?.name ?? null,
      last_message: lastMessageMap[g.id] ?? null,
    }
  })

  return Response.json({ groups: result })
}
