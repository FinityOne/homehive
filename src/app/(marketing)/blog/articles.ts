export type ArticleMeta = {
  slug: string
  type: 'standard' | 'research'
  category: string
  categoryColor: string
  title: string
  subtitle: string
  date: string
  dateIso: string
  readTime: string
  author: { name: string; title: string }
  excerpt: string
  featured?: boolean
}

export const ARTICLES: ArticleMeta[] = [
  {
    slug: 'homehive-rated-number-one-asu-platform',
    type: 'research',
    category: 'Research Report',
    categoryColor: '#1a3a5c',
    title: 'HomeHive Rated #1 Off-Campus Housing Platform for ASU Students',
    subtitle: "A comparative analysis of digital housing platforms serving Arizona State University's student population — Spring 2026",
    date: 'March 2026',
    dateIso: '2026-03-01',
    readTime: '12 min read',
    author: { name: 'HomeHive Research Team', title: 'Platform Analytics & Student Outcomes' },
    excerpt: 'An independent survey of 847 ASU students across Tempe, West, Polytechnic, and Downtown campuses found HomeHive outperforming all competing platforms across lease speed, listing quality, and overall student satisfaction.',
    featured: true,
  },
  {
    slug: 'fall-2026-asu-housing-guide',
    type: 'standard',
    category: 'Student Guide',
    categoryColor: '#166534',
    title: 'The Complete Fall 2026 Off-Campus Housing Guide for ASU Students',
    subtitle: 'Everything you need to know before signing a lease — from neighborhoods to lease terms',
    date: 'February 2026',
    dateIso: '2026-02-10',
    readTime: '8 min read',
    author: { name: 'Maya Chen', title: 'Student Housing Advisor' },
    excerpt: "Moving off campus is one of the biggest decisions you'll make as an ASU student. This guide walks through budgeting, neighborhood selection, what to look for in a lease, and how to avoid the most common pitfalls.",
  },
  {
    slug: 'lease-mistakes-asu-students',
    type: 'standard',
    category: 'Tips',
    categoryColor: '#92400e',
    title: '5 Lease Mistakes ASU Students Make (and How to Avoid Them)',
    subtitle: "Don't sign anything until you've read this",
    date: 'January 2026',
    dateIso: '2026-01-22',
    readTime: '5 min read',
    author: { name: 'Jordan Reyes', title: 'HomeHive Editorial' },
    excerpt: "Every year, thousands of ASU students sign leases they don't fully understand — and end up paying for it. We break down the five most common mistakes and exactly what to do instead.",
  },
  {
    slug: 'tempe-neighborhoods-ranked',
    type: 'standard',
    category: 'Neighborhoods',
    categoryColor: '#5b21b6',
    title: 'Tempe Neighborhoods Ranked: Where ASU Students Actually Want to Live',
    subtitle: 'Mill Avenue, South Tempe, Scottsdale borders — a frank breakdown by price, distance, and vibe',
    date: 'December 2025',
    dateIso: '2025-12-14',
    readTime: '6 min read',
    author: { name: 'Alex Park', title: 'HomeHive Editorial' },
    excerpt: 'Not all neighborhoods near ASU are created equal. We ranked the most popular off-campus areas across price, walkability, safety, nightlife, and proximity — so you can find the right fit before signing anything.',
  },
]
