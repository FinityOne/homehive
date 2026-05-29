import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function makeClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(toSet) {
          try { toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )
}

// GET /api/comments?property=slug — public, returns visible comments
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('property')
  if (!slug) return NextResponse.json({ error: 'Missing property' }, { status: 400 })

  const supabase = await makeClient()
  const { data, error } = await supabase
    .from('listing_comments')
    .select('id, author_name, avatar_url, content, created_at')
    .eq('property_slug', slug)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/comments — authenticated users post a comment
export async function POST(req: NextRequest) {
  const supabase = await makeClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json()
  const { property_slug, content } = body

  if (!property_slug || typeof property_slug !== 'string')
    return NextResponse.json({ error: 'Missing property_slug' }, { status: 400 })
  if (!content || typeof content !== 'string' || content.trim().length < 1)
    return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
  if (content.length > 1000)
    return NextResponse.json({ error: 'Comment too long' }, { status: 400 })

  // Get author name + avatar from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, avatar_url')
    .eq('id', user.id)
    .single()

  const first = profile?.first_name || ''
  const last = profile?.last_name || ''
  const author_name = [first, last].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'Anonymous'
  const avatar_url = profile?.avatar_url || null

  const { data, error } = await supabase
    .from('listing_comments')
    .insert({ property_slug, user_id: user.id, author_name, avatar_url, content: content.trim() })
    .select('id, author_name, avatar_url, content, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
