import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ARTICLES } from './(marketing)/blog/articles'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Featured listings get elevated priority — these are the two we want in sitelinks
const FEATURED_SLUGS = new Set(['palace-jacuzzi', 'delrio-house'])

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // Primary conversion page — students browse listings here
    {
      url: `${SITE_URL}/homes`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    // Key editorial pages — core for sitelinks
    {
      url: `${SITE_URL}/how-it-works`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${SITE_URL}/student-guide`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${SITE_URL}/for-landlords`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.80,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.75,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.75,
    },
    {
      url: `${SITE_URL}/roommates`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.65,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.40,
    },
  ]

  // Blog articles
  const blogRoutes: MetadataRoute.Sitemap = ARTICLES.map(article => ({
    url: `${SITE_URL}/blog/${article.slug}`,
    lastModified: new Date(article.dateIso),
    changeFrequency: 'monthly' as const,
    priority: article.featured ? 0.80 : 0.65,
  }))

  // Active property listings — featured ones get priority 0.95 to signal importance
  let propertyRoutes: MetadataRoute.Sitemap = []
  try {
    const { data } = await supabase
      .from('properties')
      .select('slug, created_at')
      .eq('is_active', true)
      .eq('is_test', false)
      .order('created_at', { ascending: false })

    if (data) {
      propertyRoutes = data.map(p => ({
        url: `${SITE_URL}/homes/${p.slug}`,
        lastModified: new Date(p.created_at),
        changeFrequency: FEATURED_SLUGS.has(p.slug) ? ('daily' as const) : ('weekly' as const),
        priority: FEATURED_SLUGS.has(p.slug) ? 0.95 : 0.80,
      }))
    }
  } catch {
    // Gracefully skip if DB unavailable at build time
  }

  return [...staticRoutes, ...blogRoutes, ...propertyRoutes]
}
