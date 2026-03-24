import type { Metadata } from 'next'
import HomePageClient from './HomePageClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = 'https://ap.rdcpix.com/a50c9b367ab46c455f0be93f27ad00bal-m2992129795rd-w960_h720.jpg'

export const metadata: Metadata = {
  title: 'HomeHive — Student Housing Near ASU in Tempe',
  description:
    "The easiest way to find student housing near Arizona State University. Browse furnished rooms, flexible leases, and no broker fees. Tempe's top student rentals.",
  openGraph: {
    title: 'HomeHive — Student Housing Near ASU in Tempe',
    description:
      "Browse furnished rooms near ASU with flexible leases and no broker fees. Tempe's top student housing platform.",
    url: SITE_URL,
    images: [{ url: DEFAULT_OG, width: 1200, height: 630, alt: 'HomeHive — Student Housing Near ASU' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HomeHive — Student Housing Near ASU in Tempe',
    description: "Browse furnished rooms near ASU with flexible leases and no broker fees.",
    images: [DEFAULT_OG],
  },
  alternates: { canonical: SITE_URL },
}

export default function HomePage() {
  return <HomePageClient />
}
