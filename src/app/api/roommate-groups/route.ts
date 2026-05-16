/*
 * SQL — run once in Supabase dashboard:
 *
 * CREATE TABLE roommate_groups (
 *   id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   landlord_id   uuid NOT NULL,
 *   name          text NOT NULL,
 *   description   text,
 *   property_slug text,
 *   emoji         text DEFAULT '🏠',
 *   created_at    timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE roommate_group_members (
 *   id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   group_id   uuid REFERENCES roommate_groups(id) ON DELETE CASCADE NOT NULL,
 *   lead_id    uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
 *   notes      text,
 *   added_at   timestamptz DEFAULT now(),
 *   UNIQUE(group_id, lead_id)
 * );
 *
 * ALTER TABLE roommate_groups ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE roommate_group_members ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "landlord_own_groups" ON roommate_groups
 *   FOR ALL USING (landlord_id = auth.uid());
 *
 * CREATE POLICY "landlord_group_members" ON roommate_group_members
 *   FOR ALL USING (
 *     group_id IN (SELECT id FROM roommate_groups WHERE landlord_id = auth.uid())
 *   );
 */

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getLandlordId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const token = auth.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user?.id ?? null
}

export async function GET(req: Request) {
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: groups, error } = await supabaseAdmin
    .from('roommate_groups')
    .select('*, roommate_group_members(count)')
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Flatten count
  const result = (groups || []).map((g: Record<string, unknown>) => ({
    ...g,
    member_count: (g.roommate_group_members as { count: number }[])?.[0]?.count ?? 0,
    roommate_group_members: undefined,
  }))

  return Response.json({ groups: result })
}

export async function POST(req: Request) {
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, description, property_slug, emoji } = body

  if (!name?.trim()) return Response.json({ error: 'name is required' }, { status: 400 })

  const { gender_preference } = body
  const { data, error } = await supabaseAdmin
    .from('roommate_groups')
    .insert([{
      landlord_id: landlordId,
      name: name.trim(),
      description: description || null,
      property_slug: property_slug || null,
      emoji: emoji || '🏠',
      gender_preference: ['any', 'girls_only', 'boys_only'].includes(gender_preference) ? gender_preference : 'any',
    }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ group: data })
}
