import type { Metadata } from 'next'
import HomePageClient from './HomePageClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = 'https://ap.rdcpix.com/a50c9b367ab46c455f0be93f27ad00bal-m2992129795rd-w960_h720.jpg'

export const metadata: Metadata = {
  title: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe, AZ',
  description:
    "Find off-campus housing near Arizona State University — apartments, subleases, and lease transfers in Tempe. Verified listings, ASU-proximity filtering, no broker fees. Rated #1 by ASU students.",
  openGraph: {
    title: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe, AZ',
    description:
      "Find apartments, subleases & lease transfers near ASU. Verified Tempe listings, no broker fees. Rated #1 by ASU students.",
    url: SITE_URL,
    images: [{ url: DEFAULT_OG, width: 1200, height: 630, alt: 'HomeHive — Off-Campus Housing Near ASU Tempe' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HomeHive — #1 Off-Campus Housing for ASU Students',
    description: "Find apartments, subleases & lease transfers near ASU Tempe. No broker fees.",
    images: [DEFAULT_OG],
  },
  alternates: { canonical: SITE_URL },
}

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['RealEstateAgent', 'LocalBusiness'],
  name: 'HomeHive',
  description: 'The #1 off-campus housing platform for Arizona State University students. Find verified apartments, subleases, and lease transfers in Tempe, AZ.',
  url: SITE_URL,
  image: DEFAULT_OG,
  priceRange: '$500–$2,000/mo',
  areaServed: [
    { '@type': 'City', name: 'Tempe', containedInPlace: { '@type': 'State', name: 'Arizona' } },
    { '@type': 'City', name: 'Mesa', containedInPlace: { '@type': 'State', name: 'Arizona' } },
    { '@type': 'City', name: 'Scottsdale', containedInPlace: { '@type': 'State', name: 'Arizona' } },
  ],
  serviceType: ['Off-campus student housing', 'Sublease listings', 'Lease transfers', 'Roommate matching'],
  audience: {
    '@type': 'Audience',
    audienceType: 'Students',
    name: 'Arizona State University Students',
  },
  knowsAbout: [
    'ASU off-campus housing',
    'Student subleases Tempe AZ',
    'Apartments near Arizona State University',
    'Student lease transfers',
    'Roommate matching ASU',
  ],
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How do I find off-campus housing near ASU?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'HomeHive is the easiest way to find off-campus housing near Arizona State University. Browse verified listings filtered by distance to ASU Tempe campus, submit your interest, and connect directly with landlords — all for free.',
      },
    },
    {
      '@type': 'Question',
      name: 'Are there sublease options available near ASU?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. HomeHive features sublease and lease transfer listings specifically for ASU students. These are ideal for students leaving Tempe for an internship, study abroad, or semester break who need to sublease their apartment.',
      },
    },
    {
      '@type': 'Question',
      name: 'How far are HomeHive listings from ASU campus?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Every HomeHive listing includes a verified distance-to-ASU-Tempe measurement. Most listings are within 0.2 to 3 miles of the main Tempe campus, with many within walking or biking distance.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is HomeHive free for ASU students?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes — HomeHive is completely free for students, now and always. There are no broker fees, no application fees, and no hidden charges. Landlords pay a small success fee only after a room is filled.',
      },
    },
    {
      '@type': 'Question',
      name: 'What types of housing are available near ASU on HomeHive?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'HomeHive offers standard rentals, subleases, and lease transfers near ASU. Listing types include private rooms in shared houses, studio apartments, 1-bedroom and 2-bedroom units, and condos — all within the Tempe area.',
      },
    },
    {
      '@type': 'Question',
      name: "What neighborhoods near ASU are best for students?",
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The most popular neighborhoods for ASU students are the University/Mill Avenue area (most walkable), South Tempe (best value), and areas along the Tempe light rail line (best for transit riders). HomeHive listings cover all of these areas.',
      },
    },
  ],
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <HomePageClient />
    </>
  )
}
