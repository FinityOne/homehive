import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'Pricing — Free for ASU Students, Free for Landlords in 2026',
  description:
    'HomeHive is 100% free for ASU students — browse listings, find roommates, sign leases, and pay rent at no cost. Landlords list free through end of 2026.',
  keywords: [
    'free student housing platform ASU',
    'no broker fee housing Tempe',
    'free apartment search near ASU',
    'student housing no fees Arizona State',
  ],
  openGraph: {
    title: 'HomeHive Pricing — Free for Students, Free for Landlords',
    description:
      'ASU students pay nothing — ever. Landlords list free through 2026. No broker fees, no hidden charges.',
    url: `${SITE_URL}/pricing`,
    siteName: 'HomeHive',
  },
  alternates: { canonical: `${SITE_URL}/pricing` },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
