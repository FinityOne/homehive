import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import { ARTICLES } from './(marketing)/blog/articles'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static marketing pages
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/homes`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/how-it-works`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/for-landlords`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/roommates`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/student-guide`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.4,
    },
  ]

  // Blog articles (hardcoded)
  const blogRoutes: MetadataRoute.Sitemap = ARTICLES.map(article => ({
    url: `${SITE_URL}/blog/${article.slug}`,
    lastModified: new Date(article.dateIso),
    changeFrequency: 'monthly' as const,
    priority: article.featured ? 0.85 : 0.7,
  }))

  // Active property listings (dynamic from Supabase)
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
        changeFrequency: 'weekly' as const,
        priority: 0.85,
      }))
    }
  } catch {
    // Gracefully skip if DB unavailable at build time
  }

  return [...staticRoutes, ...blogRoutes, ...propertyRoutes]
}
