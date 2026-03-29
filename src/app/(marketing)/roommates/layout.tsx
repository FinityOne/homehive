import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'Find Roommates Near ASU — Roommate Matching for Sun Devils',
  description:
    'Find compatible roommates near Arizona State University in Tempe. Solo or group — HomeHive matches ASU students by lifestyle, budget, and move-in date. Free, no commitment.',
  keywords: [
    'roommates near ASU',
    'ASU roommate matching',
    'find roommates Tempe AZ',
    'student roommates Arizona State University',
    'off campus roommates ASU',
    'roommate finder Tempe',
    'ASU student roommate search',
  ],
  openGraph: {
    title: 'Find Roommates Near ASU — HomeHive Roommate Matching',
    description:
      "Match with ASU students by lifestyle, budget, and move-in date. Whether you're flying solo or have a group — we'll find the right fit.",
    url: `${SITE_URL}/roommates`,
    siteName: 'HomeHive',
  },
  alternates: { canonical: `${SITE_URL}/roommates` },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
