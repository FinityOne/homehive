import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'How It Works — Find Off-Campus Housing Near ASU in 6 Steps | HomeHive',
  description:
    'Six simple steps from browsing to moved in. HomeHive connects ASU students with verified off-campus housing in Tempe — no cold calls, no broker fees, no surprises.',
  keywords: [
    'how to find housing near ASU',
    'ASU off campus housing process',
    'student housing Tempe steps',
    'find apartment near Arizona State University',
    'HomeHive how it works',
  ],
  openGraph: {
    title: 'How HomeHive Works — Off-Campus Housing for ASU Students',
    description:
      'Browse verified homes, submit interest in 2 minutes, tour on your schedule, and sign your lease. The simplest way to find off-campus housing near ASU.',
    url: `${SITE_URL}/how-it-works`,
    siteName: 'HomeHive',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How HomeHive Works — Off-Campus Housing for ASU Students',
    description: 'Six simple steps from browsing to moved in near ASU Tempe. No broker fees.',
  },
  alternates: { canonical: `${SITE_URL}/how-it-works` },
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'HomeHive', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'How It Works', item: `${SITE_URL}/how-it-works` },
  ],
}

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': `${SITE_URL}/how-it-works#webpage`,
  url: `${SITE_URL}/how-it-works`,
  name: 'How It Works — Find Off-Campus Housing Near ASU in 6 Steps | HomeHive',
  description: 'Six simple steps from browsing to moved in. HomeHive connects ASU students with verified off-campus housing in Tempe — no cold calls, no broker fees.',
  isPartOf: { '@id': `${SITE_URL}/#website` },
  breadcrumb: { '@id': `${SITE_URL}/how-it-works#breadcrumb` },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }} />
      {children}
    </>
  )
}
