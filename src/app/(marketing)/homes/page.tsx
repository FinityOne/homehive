import type { Metadata } from 'next'
import HomesPageClient from './HomesPageClient'
import { getHomeCardsServer } from '@/lib/homeData'

export const revalidate = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = `${SITE_URL}/opengraph-image`

export const metadata: Metadata = {
  title: 'Off-Campus Housing Near ASU — Apartments, Subleases & Lease Transfers in Tempe | HomeHive',
  description:
    'Browse verified off-campus housing near Arizona State University. Apartments, subleases, and lease transfers in Tempe, AZ. Filter by distance to ASU, price, and beds. No broker fees, free for students.',
  keywords: [
    'apartments near ASU Tempe',
    'ASU off campus housing listings',
    'sublease near Arizona State University',
    'lease transfer ASU Tempe',
    'student apartments Tempe AZ',
    'housing near ASU campus',
    'rooms for rent ASU Tempe',
    'off campus apartments Tempe Arizona',
  ],
  openGraph: {
    title: 'Off-Campus Housing Near ASU — Apartments, Subleases & Lease Transfers',
    description:
      'Verified off-campus apartments, subleases, and lease transfers near ASU in Tempe, AZ. Filter by distance to campus, price, and beds. No broker fees.',
    url: `${SITE_URL}/homes`,
    siteName: 'HomeHive',
    type: 'website',
    images: [{ url: DEFAULT_OG, width: 1200, height: 630, alt: 'Off-campus housing listings near ASU Tempe — HomeHive' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Off-Campus Housing Near ASU — Apartments & Subleases in Tempe',
    description: 'Verified apartments, subleases & lease transfers near ASU in Tempe. No broker fees.',
    images: [DEFAULT_OG],
  },
  alternates: { canonical: `${SITE_URL}/homes` },
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'HomeHive', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Homes Near ASU', item: `${SITE_URL}/homes` },
  ],
}

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': `${SITE_URL}/homes#webpage`,
  url: `${SITE_URL}/homes`,
  name: 'Off-Campus Housing Near ASU — Apartments, Subleases & Lease Transfers in Tempe',
  description: 'Browse verified off-campus housing near Arizona State University. Apartments, subleases, and lease transfers in Tempe, AZ.',
  isPartOf: { '@id': `${SITE_URL}/#website` },
  about: { '@type': 'Thing', name: 'Off-campus student housing listings near ASU Tempe' },
}

export default async function HomesPage() {
  const initialProperties = await getHomeCardsServer()
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }} />
      <HomesPageClient initialProperties={initialProperties} />
    </>
  )
}
