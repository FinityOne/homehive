import { createClient } from '@supabase/supabase-js'

// Anon key — RLS allows public INSERT + identity backfill on site_visits only.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Cheap bot filter so the visitors table stays human.
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|preview|monitor|lighthouse|headless|curl|wget|python-requests|axios|go-http/i

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    null
  )
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const ua = req.headers.get('user-agent') || ''

    // ── Identity backfill: stamp an email onto every prior anon hit ──────────
    if (body.type === 'identify') {
      const { anonymous_id, email, full_name, identified_via } = body
      if (!anonymous_id || !email) {
        return Response.json({ error: 'anonymous_id and email required' }, { status: 400 })
      }
      await supabase
        .from('site_visits')
        .update({
          email,
          full_name: full_name || null,
          identified_via: identified_via || 'unknown',
          identified_at: new Date().toISOString(),
        })
        .eq('anonymous_id', anonymous_id)
        .is('email', null) // only backfill rows that aren't already identified
      return Response.json({ ok: true })
    }

    // ── Pageview hit ─────────────────────────────────────────────────────────
    if (BOT_RE.test(ua)) return Response.json({ ok: true, skipped: 'bot' })

    const {
      anonymous_id, session_id, path, property_slug, referrer,
      utm_source, utm_medium, utm_campaign, utm_content,
      device_type, email, full_name, identified_via,
    } = body

    await supabase.from('site_visits').insert([{
      anonymous_id:  anonymous_id  || null,
      session_id:    session_id    || null,
      path:          path          || null,
      property_slug: property_slug || null,
      referrer:      referrer      || null,
      utm_source:    utm_source    || null,
      utm_medium:    utm_medium    || null,
      utm_campaign:  utm_campaign  || null,
      utm_content:   utm_content   || null,
      ip:            clientIp(req),
      // Geo headers are populated for free by Vercel's edge network in production.
      ip_country:    req.headers.get('x-vercel-ip-country') || null,
      ip_region:     req.headers.get('x-vercel-ip-country-region') || null,
      ip_city:       decodeURIComponent(req.headers.get('x-vercel-ip-city') || '') || null,
      user_agent:    ua || null,
      device_type:   device_type || (/Mobi|Android/i.test(ua) ? 'mobile' : 'desktop'),
      email:         email || null,
      full_name:     full_name || null,
      identified_via: email ? (identified_via || 'unknown') : null,
      identified_at: email ? new Date().toISOString() : null,
    }])

    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false })
  }
}
