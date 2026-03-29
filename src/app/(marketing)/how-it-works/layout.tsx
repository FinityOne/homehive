import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'How It Works — Find Off-Campus Housing Near ASU',
  description:
    'Six simple steps from browsing to moved in. HomeHive connects ASU students with verified off-campus housing in Tempe — no cold calls, no surprises, no broker fees.',
  keywords: [
    'how to find housing near ASU',
    'ASU off campus housing process',
    'student housing Tempe steps',
    'find apartment near Arizona State University',
  ],
  openGraph: {
    title: 'How HomeHive Works — Off-Campus Housing for ASU Students',
    description:
      'Browse verified homes, submit interest in 2 minutes, tour on your schedule, and sign your lease. The simplest way to find off-campus housing near ASU.',
    url: `${SITE_URL}/how-it-works`,
    siteName: 'HomeHive',
  },
  alternates: { canonical: `${SITE_URL}/how-it-works` },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
