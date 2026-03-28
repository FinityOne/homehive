import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code  = requestUrl.searchParams.get('code')
  const role  = requestUrl.searchParams.get('role')  // 'landlord' when coming from signup
  const next  = requestUrl.searchParams.get('next')
  const error = requestUrl.searchParams.get('error')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin

  if (error) {
    return NextResponse.redirect(`${siteUrl}/login?error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${siteUrl}/login`)
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get:    (name)                => cookieStore.get(name)?.value,
        set:    (name, value, opts)   => { try { cookieStore.set({ name, value, ...opts }) } catch (_) {} },
        remove: (name, opts)          => { try { cookieStore.set({ name, value: '', ...opts }) } catch (_) {} },
      },
    }
  )

  const { data: { user }, error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

  if (sessionError || !user) {
    return NextResponse.redirect(`${siteUrl}/login?error=oauth_failed`)
  }

  // Fetch existing profile role
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  let userRole = profile?.role as string | undefined

  if (!userRole) {
    // New Google user — assign role and upsert profile
    const assignRole = role === 'landlord' ? 'landlord' : 'tenant'
    const fullName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      ''

    await supabaseAdmin
      .from('profiles')
      .upsert({ id: user.id, role: assignRole, full_name: fullName })

    userRole = assignRole

    // Notify admin of new OAuth signup (fire-and-forget)
    fetch(`${siteUrl}/api/auth/notify-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fullName, email: user.email, role: assignRole }),
    }).catch(() => {})
  }

  // Redirect to intended destination or role-based default
  if (next) return NextResponse.redirect(`${siteUrl}${next}`)
  if (userRole === 'admin')    return NextResponse.redirect(`${siteUrl}/admin`)
  if (userRole === 'landlord') return NextResponse.redirect(`${siteUrl}/landlord/dashboard`)
  return NextResponse.redirect(`${siteUrl}/dashboard`)
}
