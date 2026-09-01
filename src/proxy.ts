import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Route prefixes that require a signed-in user, and the roles allowed on them. */
const GUARDED: { prefix: string; roles?: string[] }[] = [
  { prefix: '/admin',        roles: ['admin'] },
  { prefix: '/landlord',     roles: ['landlord', 'admin'] },
  { prefix: '/dashboard' },
  { prefix: '/profile' },
  { prefix: '/applications' },
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // One response, created once and mutated. The previous version rebuilt it
  // inside every cookie `set` call, which threw away the cookies written by the
  // earlier calls — and Supabase writes the session as several chunked cookies.
  // Only the last chunk survived, so the very refresh that was meant to keep the
  // user signed in left a truncated cookie behind and signed them out instead.
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            // Update the request too, so anything later in this same pass reads
            // the refreshed token rather than the expired one it arrived with.
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          }
        },
      },
    }
  )

  // Runs on every matched request, public pages included. This is the only place
  // an expired access token gets exchanged for a fresh one when the user returns
  // to a cold tab, so skipping it on public routes is what used to make a
  // returning visitor land on the site logged out.
  const { data: { user } } = await supabase.auth.getUser()

  const guard = GUARDED.find(g => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`))
  if (!guard) return response

  if (!user) {
    const login = new URL('/login', request.url)
    login.searchParams.set('next', pathname + request.nextUrl.search)
    return redirectKeepingCookies(login, response)
  }

  if (guard.roles) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role || 'tenant'
    if (!guard.roles.includes(role)) {
      return redirectKeepingCookies(new URL('/dashboard', request.url), response)
    }
  }

  return response
}

/**
 * Redirect without dropping a refreshed session. A bare NextResponse.redirect
 * carries none of the Set-Cookie headers we just wrote, so the browser would
 * keep replaying the stale token and bounce through /login again next time.
 */
function redirectKeepingCookies(url: URL, carrying: NextResponse) {
  const redirect = NextResponse.redirect(url)
  for (const cookie of carrying.cookies.getAll()) redirect.cookies.set(cookie)
  return redirect
}

export const config = {
  // Every page the user can land on, so a returning visitor's expired access
  // token is refreshed wherever they re-enter the site — not just on the five
  // guarded prefixes the old matcher listed.
  //
  // Excluded: static assets, /api (route handlers hold their own Supabase client
  // and would otherwise fire a second, concurrent refresh of the same rotating
  // token alongside the page request) and /auth (the sign-in callback is mid-way
  // through establishing the session and must not be inspected here).
  matcher: [
    '/((?!api/|auth/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff2?|ttf|map)$).*)',
  ],
}
