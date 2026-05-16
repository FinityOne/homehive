import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const BOT_MESSAGES = [
  "Hey hey hey! 🎉 Welcome to your group chat! I'm Honeybee 🐝 — your friendly roommate matchmaker. This is your space to connect and get to know each other before move-in day. Don't be shy — introduce yourself below!",
  "Let's break the ice! ☀️ **Are you more of a morning person or a night owl?** Drop your answer — it helps a lot with setting house vibes from day one.",
  "Roommate quiz round 2 🍕 **What's your ideal Friday night?** Netflix marathon at home, hitting a restaurant, or heading to a campus event? No wrong answers!",
  "Real talk time 🏠 **What's one house rule that's non-negotiable for you?** No judgment — this is exactly how you build a home that works for everyone.",
  "Last one from me for now! 🎓 **What are you studying and what brings you to ASU?** You might have a future study buddy right here in this very chat!",
]

async function getUser(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(auth.replace('Bearer ', ''))
  return user ?? null
}

async function getGroupWithAccess(token: string, userId: string) {
  const { data: group } = await supabaseAdmin
    .from('roommate_groups')
    .select('id, landlord_id, name')
    .eq('share_token', token)
    .single()
  if (!group) return null

  if (group.landlord_id === userId) return group

  const { data: member } = await supabaseAdmin
    .from('roommate_group_members')
    .select('id')
    .eq('group_id', group.id)
    .eq('user_id', userId)
    .single()

  return member ? group : null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const group = await getGroupWithAccess(token, user.id)
  if (!group) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { data: messages } = await supabaseAdmin
    .from('group_messages')
    .select('id, sender_id, sender_name, content, is_bot, created_at')
    .eq('group_id', group.id)
    .order('created_at', { ascending: true })

  if ((messages ?? []).length === 0) {
    const now = Date.now()
    const seeds = BOT_MESSAGES.map((content, i) => ({
      group_id: group.id,
      sender_id: null,
      sender_name: 'Honeybee',
      content,
      is_bot: true,
      created_at: new Date(now - (BOT_MESSAGES.length - i) * 50000).toISOString(),
    }))
    await supabaseAdmin.from('group_messages').insert(seeds)

    const { data: seeded } = await supabaseAdmin
      .from('group_messages')
      .select('id, sender_id, sender_name, content, is_bot, created_at')
      .eq('group_id', group.id)
      .order('created_at', { ascending: true })

    return Response.json({ messages: seeded ?? [], group_id: group.id })
  }

  return Response.json({ messages: messages ?? [], group_id: group.id })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const user = await getUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const group = await getGroupWithAccess(token, user.id)
  if (!group) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const { content } = await req.json()
  if (!content?.trim()) return Response.json({ error: 'content required' }, { status: 400 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  const senderName = profile?.full_name?.trim() || user.email?.split('@')[0] || 'Member'

  const { data: msg, error } = await supabaseAdmin
    .from('group_messages')
    .insert([{ group_id: group.id, sender_id: user.id, sender_name: senderName, content: content.trim(), is_bot: false }])
    .select('id, sender_id, sender_name, content, is_bot, created_at')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ message: msg })
}
