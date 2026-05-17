import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'ASU Off-Campus Housing Guide — Everything Students Need to Know | HomeHive',
  description:
    'The complete guide to living off-campus near Arizona State University. Covers neighborhoods, budgeting, commuting, roommates, and the Tempe move-in checklist — free resource for ASU students.',
  keywords: [
    'ASU off campus housing guide',
    'student guide Tempe Arizona',
    'off campus living Arizona State University',
    'neighborhoods near ASU Tempe',
    'budgeting student housing ASU',
    'commuting to ASU from off campus',
    'international student housing ASU',
    'ASU move in checklist',
    'Tempe neighborhoods students',
    'how to find housing ASU student',
  ],
  openGraph: {
    title: 'The Complete ASU Off-Campus Housing Guide | HomeHive',
    description:
      'Neighborhoods, budgeting, commuting, roommates, and move-in checklist — everything ASU students need to know about living off-campus in Tempe.',
    url: `${SITE_URL}/student-guide`,
    siteName: 'HomeHive',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ASU Off-Campus Housing Guide | HomeHive',
    description: 'Neighborhoods, budgeting, roommates, and the Tempe move-in checklist for ASU students.',
  },
  alternates: { canonical: `${SITE_URL}/student-guide` },
}

const breadcrumbJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'HomeHive', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'ASU Student Housing Guide', item: `${SITE_URL}/student-guide` },
  ],
}

const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['WebPage', 'Article'],
  '@id': `${SITE_URL}/student-guide#webpage`,
  url: `${SITE_URL}/student-guide`,
  name: 'ASU Off-Campus Housing Guide — Everything Students Need to Know',
  description: 'The complete guide to living off-campus near Arizona State University. Covers neighborhoods, budgeting, commuting, roommates, and the Tempe move-in checklist.',
  isPartOf: { '@id': `${SITE_URL}/#website` },
  about: { '@type': 'Thing', name: 'Off-campus student housing near Arizona State University' },
  audience: { '@type': 'Audience', audienceType: 'Students', name: 'ASU Students' },
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
