import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // Get the authenticated user from the session cookie
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find property by claim token
  const { data: property, error: fetchErr } = await supabaseAdmin
    .from('properties')
    .select('id, slug, name, owner_id, is_claimable, claim_token')
    .eq('claim_token', token)
    .single()

  if (fetchErr || !property) {
    return Response.json({ error: 'Claim link not found' }, { status: 404 })
  }

  if (!property.is_claimable || property.owner_id !== null) {
    return Response.json({ error: 'This listing has already been claimed' }, { status: 409 })
  }

  // Assign the listing to this user
  const { error: updateErr } = await supabaseAdmin
    .from('properties')
    .update({
      owner_id: user.id,
      is_claimable: false,
      claim_token: null,
    })
    .eq('id', property.id)

  if (updateErr) {
    return Response.json({ error: 'Failed to claim listing' }, { status: 500 })
  }

  // Upgrade user profile to landlord role if not already
  await supabaseAdmin
    .from('profiles')
    .update({ role: 'landlord' })
    .eq('id', user.id)

  return Response.json({ ok: true, slug: property.slug, name: property.name })
}
