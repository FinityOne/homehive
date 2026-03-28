import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('full_name, avatar_url')
    .eq('id', userId)
    .single()

  if (error || !data) {
    return Response.json({ first_name: null, avatar_url: null })
  }

  const first_name = data.full_name
    ? data.full_name.trim().split(/\s+/)[0]
    : null

  return Response.json({ first_name, avatar_url: data.avatar_url ?? null })
}
