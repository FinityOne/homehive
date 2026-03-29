import type { Metadata } from 'next'
import HomesPageClient from './HomesPageClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = 'https://images.unsplash.com/photo-1562516155-e0c1ee44059b?w=1200&q=80'

export const metadata: Metadata = {
  title: 'Off-Campus Housing Near ASU — Apartments, Subleases & Lease Transfers in Tempe',
  description:
    'Browse verified off-campus housing near Arizona State University. Apartments, subleases, and lease transfers in Tempe, AZ. Filter by distance to ASU, price, and beds. No broker fees.',
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
      'Verified off-campus apartments, subleases, and lease transfers near ASU in Tempe. Filter by distance to campus. No broker fees.',
    url: `${SITE_URL}/homes`,
    images: [{ url: DEFAULT_OG, width: 1200, height: 630, alt: 'Off-campus housing listings near ASU Tempe — HomeHive' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Off-Campus Housing Near ASU — Apartments & Subleases',
    description: 'Verified apartments, subleases & lease transfers near ASU in Tempe. No broker fees.',
    images: [DEFAULT_OG],
  },
  alternates: { canonical: `${SITE_URL}/homes` },
}

export default function HomesPage() {
  return <HomesPageClient />
}
