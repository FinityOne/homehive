import type { Metadata } from 'next'
import HomesPageClient from './HomesPageClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = 'https://images.unsplash.com/photo-1562516155-e0c1ee44059b?w=1200&q=80'

export const metadata: Metadata = {
  title: 'Browse Student Homes Near ASU — HomeHive',
  description:
    'Browse available student housing near Arizona State University in Tempe. Furnished rooms, private bathrooms, flexible move-in. Find your perfect home today.',
  openGraph: {
    title: 'Browse Student Homes Near ASU — HomeHive',
    description:
      'Furnished student rooms near ASU in Tempe, AZ. Flexible leases, no broker fees, easy move-in.',
    url: `${SITE_URL}/homes`,
    images: [{ url: DEFAULT_OG, width: 1200, height: 630, alt: 'Student homes near ASU — HomeHive' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Browse Student Homes Near ASU — HomeHive',
    description: 'Furnished student rooms near ASU in Tempe, AZ. Flexible leases, no broker fees.',
    images: [DEFAULT_OG],
  },
  alternates: { canonical: `${SITE_URL}/homes` },
}

export default function HomesPage() {
  return <HomesPageClient />
}
