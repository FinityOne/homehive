import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Require auth
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return Response.json({ error: 'Login required' }, { status: 401 })

  const userToken = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(userToken)
  if (!user) return Response.json({ error: 'Invalid session' }, { status: 401 })

  // Find the group by share token
  const { data: group, error: groupErr } = await supabaseAdmin
    .from('roommate_groups')
    .select('id, landlord_id, property_slug')
    .eq('share_token', token)
    .single()

  if (groupErr || !group) return Response.json({ error: 'Group not found' }, { status: 404 })

  // Don't allow landlord to join their own group
  if (group.landlord_id === user.id) {
    return Response.json({ error: 'You own this group' }, { status: 400 })
  }

  // Check if already in group
  const { data: existing } = await supabaseAdmin
    .from('roommate_group_members')
    .select('id')
    .eq('group_id', group.id)
    .eq('user_id', user.id)
    .single()

  if (existing) return Response.json({ already_member: true })

  // Find or create lead for this user
  let leadId: string | null = null
  const { data: existingLead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('email', user.email!)
    .limit(1)
    .single()

  if (existingLead) {
    leadId = existingLead.id
  } else {
    const profile = await supabaseAdmin
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .single()

    const fullName = profile.data?.full_name ?? ''
    const [firstName, ...rest] = fullName.split(' ')
    const { data: newLead } = await supabaseAdmin
      .from('leads')
      .insert([{
        email: user.email!,
        first_name: firstName || null,
        last_name: rest.join(' ') || null,
        phone: profile.data?.phone ?? null,
        property: group.property_slug ?? null,
        status: 'new',
      }])
      .select('id')
      .single()

    leadId = newLead?.id ?? null
  }

  if (!leadId) return Response.json({ error: 'Could not create lead record' }, { status: 500 })

  // Add to group
  const { error: insertErr } = await supabaseAdmin
    .from('roommate_group_members')
    .upsert(
      [{ group_id: group.id, lead_id: leadId, user_id: user.id }],
      { onConflict: 'group_id,lead_id' }
    )

  if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 })

  return Response.json({ success: true })
}
