import type { Metadata } from 'next'
import HomePageClient from './HomePageClient'
import { getHomeCardsServer } from '@/lib/homeData'

// Re-render at most once a minute. Listings render in the initial HTML (no
// client round-trip) and stay fresh without a DB hit on every request.
export const revalidate = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = `${SITE_URL}/opengraph-image`

export const metadata: Metadata = {
  title: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe, AZ',
  description:
    "Find off-campus housing near Arizona State University — verified apartments, subleases, and lease transfers in Tempe. ASU-proximity filtering, no broker fees, free for students.",
  openGraph: {
    title: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe, AZ',
    description:
      "Browse verified apartments, subleases & lease transfers near ASU Tempe. No broker fees, free for students.",
    url: SITE_URL,
    siteName: 'HomeHive',
    type: 'website',
    locale: 'en_US',
    images: [{ url: DEFAULT_OG, width: 1200, height: 630, alt: 'HomeHive — Off-Campus Housing Near ASU Tempe' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HomeHive — #1 Off-Campus Housing for ASU Students',
    description: "Verified apartments, subleases & lease transfers near ASU Tempe. No broker fees.",
    images: [DEFAULT_OG],
  },
  alternates: { canonical: SITE_URL },
}

// ── WebPage schema — signals this page's identity and key linked pages ──
const webPageJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  '@id': `${SITE_URL}/#webpage`,
  url: SITE_URL,
  name: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe, AZ',
  description: 'The #1 platform for finding off-campus housing near Arizona State University. Verified apartments, subleases, and lease transfers in Tempe with no broker fees.',
  isPartOf: { '@id': `${SITE_URL}/#website` },
  about: {
    '@type': 'Thing',
    name: 'Off-campus student housing near ASU Tempe, Arizona',
  },
  significantLink: [
    `${SITE_URL}/homes`,
    `${SITE_URL}/how-it-works`,
    `${SITE_URL}/student-guide`,
    `${SITE_URL}/homes/palace-jacuzzi`,
    `${SITE_URL}/homes/delrio-house`,
    `${SITE_URL}/pricing`,
  ],
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'HomeHive', item: SITE_URL },
    ],
  },
}

// ── SiteNavigationElement — the primary schema signal for Google Sitelinks ──
const siteNavJsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/homes`,
    name: 'Browse Homes',
    description: 'Search verified off-campus apartments, subleases, and lease transfers near Arizona State University. Filter by price, beds, and distance to ASU campus.',
    url: `${SITE_URL}/homes`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/how-it-works`,
    name: 'How It Works',
    description: 'Six simple steps from browsing to moved in. HomeHive connects ASU students with verified housing in Tempe — no cold calls, no broker fees, no surprises.',
    url: `${SITE_URL}/how-it-works`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/student-guide`,
    name: 'ASU Student Housing Guide',
    description: 'The complete guide to off-campus living near Arizona State University. Covers neighborhoods, budgeting, commuting, roommates, and the Tempe move-in checklist.',
    url: `${SITE_URL}/student-guide`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/homes/palace-jacuzzi`,
    name: 'University Dr Palace w/ Jacuzzi — ASU Housing',
    description: '6-bedroom house one block from Mill Ave in Tempe. Private jacuzzi, 4 baths, flexible ASU move-in. From $699/mo per room — no broker fees.',
    url: `${SITE_URL}/homes/palace-jacuzzi`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/homes/delrio-house`,
    name: 'ASU Student Castle w/ Backyard — Tempe',
    description: '5-bedroom student house with large private backyard in Tempe. 2 baths, 2,500 sqft, ideal for groups. From $599/mo per room — no broker fees.',
    url: `${SITE_URL}/homes/delrio-house`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/pricing`,
    name: 'Pricing',
    description: '100% free for ASU students — browse listings, find roommates, sign leases, and pay rent at no cost. Landlords list free through end of 2026.',
    url: `${SITE_URL}/pricing`,
  },
]

// ── ItemList — featured ASU housing listings ──
const featuredListingsJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Featured Off-Campus Housing Near ASU Tempe',
  description: 'Verified student housing listings near Arizona State University in Tempe, AZ. No broker fees.',
  url: `${SITE_URL}/homes`,
  numberOfItems: 2,
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      url: `${SITE_URL}/homes/palace-jacuzzi`,
      name: 'University Dr Palace w/ Jacuzzi',
      item: {
        '@type': 'RealEstateListing',
        name: 'University Dr Palace w/ Jacuzzi',
        description: 'A fully-equipped 6-bedroom home one block from Mill Ave. Jacuzzi, 4 baths, flexible move-in around the ASU academic calendar. No broker fees.',
        url: `${SITE_URL}/homes/palace-jacuzzi`,
        address: {
          '@type': 'PostalAddress',
          streetAddress: '820 W 9th Street',
          addressLocality: 'Tempe',
          addressRegion: 'AZ',
          postalCode: '85281',
          addressCountry: 'US',
        },
        offers: {
          '@type': 'Offer',
          price: 699,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: 699,
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
        },
        numberOfRooms: 6,
        numberOfBathroomsTotal: 4,
      },
    },
    {
      '@type': 'ListItem',
      position: 2,
      url: `${SITE_URL}/homes/delrio-house`,
      name: 'ASU Student Castle w/ Backyard',
      item: {
        '@type': 'RealEstateListing',
        name: 'ASU Student Castle w/ Backyard',
        description: 'A cozy 5-bedroom on Del Rio with a large private backyard. Great for students who want space without breaking the budget. No broker fees.',
        url: `${SITE_URL}/homes/delrio-house`,
        address: {
          '@type': 'PostalAddress',
          streetAddress: '110 W Del Rio Dr',
          addressLocality: 'Tempe',
          addressRegion: 'AZ',
          postalCode: '85282',
          addressCountry: 'US',
        },
        offers: {
          '@type': 'Offer',
          price: 599,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: 599,
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
        },
        numberOfRooms: 5,
        numberOfBathroomsTotal: 2,
      },
    },
  ],
}

// ── LocalBusiness schema ──
const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['RealEstateAgent', 'LocalBusiness'],
  '@id': `${SITE_URL}/#organization`,
  name: 'HomeHive',
  description: 'The #1 off-campus housing platform for Arizona State University students. Find verified apartments, subleases, and lease transfers in Tempe, AZ.',
  url: SITE_URL,
  logo: `${SITE_URL}/hh-icon.png`,
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

// ── FAQ schema ──
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
      name: 'What neighborhoods near ASU are best for students?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The most popular neighborhoods for ASU students are the University/Mill Avenue area (most walkable), South Tempe (best value), and areas along the Tempe light rail line (best for transit riders). HomeHive listings cover all of these areas.',
      },
    },
  ],
}

export default async function HomePage() {
  // Fetch listings on the server so cards are in the initial HTML.
  // Homepage is a promotional surface — listings with marketing turned off,
  // or that aren't Live, stay out of it.
  const initialProperties = await getHomeCardsServer({ marketingOnly: true })

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteNavJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(featuredListingsJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <HomePageClient initialProperties={initialProperties} />
    </>
  )
}
