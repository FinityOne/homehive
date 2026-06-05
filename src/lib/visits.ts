// Server-only data access for the visitor-tracking system.
// site_visits has RLS that blocks anon reads, so every read here goes through
// the service-role key. Never import this into a client component.

import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type SiteVisit = {
  id: string
  created_at: string
  anonymous_id: string | null
  session_id: string | null
  path: string | null
  property_slug: string | null
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  ip: string | null
  ip_country: string | null
  ip_region: string | null
  ip_city: string | null
  user_agent: string | null
  device_type: string | null
  email: string | null
  full_name: string | null
  identified_via: string | null
  identified_at: string | null
}

// A visitor = all hits sharing one anonymous_id (falls back to ip when cookie absent).
export type Visitor = {
  key: string
  anonymous_id: string | null
  email: string | null
  full_name: string | null
  identified_via: string | null
  ip: string | null
  ip_location: string | null
  device_type: string | null
  first_seen: string
  last_seen: string
  visit_count: number
  utm_source: string | null
  utm_campaign: string | null
  paths: string[]
  visits: SiteVisit[]
}

export async function getRecentVisits(limit = 1000): Promise<SiteVisit[]> {
  const { data, error } = await admin
    .from('site_visits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    console.error('Error fetching site_visits:', error)
    return []
  }
  return data as SiteVisit[]
}

// Group raw hits into per-visitor journeys (most recently active first).
export function groupVisitors(visits: SiteVisit[]): Visitor[] {
  const map = new Map<string, Visitor>()

  // Oldest → newest so first_seen / utm-first-touch land correctly.
  const ordered = [...visits].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  for (const v of ordered) {
    const key = v.anonymous_id || `ip:${v.ip ?? 'unknown'}`
    const loc = [v.ip_city, v.ip_region, v.ip_country].filter(Boolean).join(', ') || null
    const existing = map.get(key)

    if (!existing) {
      map.set(key, {
        key,
        anonymous_id: v.anonymous_id,
        email: v.email,
        full_name: v.full_name,
        identified_via: v.identified_via,
        ip: v.ip,
        ip_location: loc,
        device_type: v.device_type,
        first_seen: v.created_at,
        last_seen: v.created_at,
        visit_count: 1,
        utm_source: v.utm_source,
        utm_campaign: v.utm_campaign,
        paths: v.path ? [v.path] : [],
        visits: [v],
      })
    } else {
      existing.last_seen = v.created_at
      existing.visit_count += 1
      existing.visits.push(v)
      if (v.path) existing.paths.push(v.path)
      // Keep the freshest known identity / IP / device.
      if (v.email) {
        existing.email = v.email
        existing.full_name = v.full_name ?? existing.full_name
        existing.identified_via = v.identified_via ?? existing.identified_via
      }
      if (v.ip) existing.ip = v.ip
      if (loc) existing.ip_location = loc
      if (v.device_type) existing.device_type = v.device_type
    }
  }

  return [...map.values()].sort(
    (a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime()
  )
}
