import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      property_slug,
      session_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      landing_page,
      referrer,
      device_type,
    } = body

    if (!property_slug) return Response.json({ error: 'property_slug required' }, { status: 400 })

    // Resolve property_id from slug
    const { data: prop } = await supabase
      .from('properties')
      .select('id')
      .eq('slug', property_slug)
      .single()

    await supabase.from('property_page_views').insert([{
      property_id:   prop?.id ?? null,
      property_slug,
      session_id:    session_id || null,
      utm_source:    utm_source || null,
      utm_medium:    utm_medium || null,
      utm_campaign:  utm_campaign || null,
      utm_content:   utm_content || null,
      landing_page:  landing_page || null,
      referrer:      referrer || null,
      device_type:   device_type || null,
    }])

    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false })
  }
}
