import type { Metadata } from 'next'
import HomePageClient from './HomePageClient'
import { getHomeCardsServer } from '@/lib/homeData'
import type { Property } from '@/lib/properties'
import { PLANS, formatUsd } from '@/lib/landlordPlans'

// Re-render at most once a minute. Listings render in the initial HTML (no
// client round-trip) and stay fresh without a DB hit on every request.
export const revalidate = 60

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = `${SITE_URL}/opengraph-image`

const STARTER_PRICE = formatUsd(PLANS.starter.priceCents)

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

// ── LISTING SCHEMA, DERIVED FROM LIVE INVENTORY ──────────────────────────────
// These used to be hand-written entries for two specific slugs. One of them was
// marked Rented months later and the schema kept advertising it to Google at its
// old price, so everything listing-shaped is now generated from the same rows
// the page renders. `getHomeCardsServer({ marketingOnly: true })` has already
// restricted these to Live, promotable, paid listings — if a listing is in this
// array it is safe to publish.

/** How many listings to put in the structured data. */
const SCHEMA_LISTING_LIMIT = 6

const listingUrl = (slug: string) => `${SITE_URL}/homes/${slug}`

/**
 * Same ordering the page itself uses for its grid — editor's picks first, then
 * best ASU score — so the schema agrees with what a visitor actually sees.
 */
function schemaListings(properties: Property[]): Property[] {
  return [...properties]
    .sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) || (b.asu_score || 0) - (a.asu_score || 0))
    .slice(0, SCHEMA_LISTING_LIMIT)
}

/** Trim a landlord's free-text description to something schema-sized. */
function shortDescription(p: Property): string {
  const raw = (p.description || '').replace(/\s+/g, ' ').trim()
  const fallback = `${p.beds}-bedroom student housing near ASU in Tempe, AZ. No broker fees.`
  if (!raw) return fallback
  if (raw.length <= 200) return raw
  const cut = raw.slice(0, 200)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 120 ? lastSpace : 200).trimEnd()}…`
}

/**
 * `address` is free-form landlord input — anything from
 * "110 W Del Rio Dr, Tempe, AZ 85282" to just "Tempe, AZ". Only emit the parts
 * we can actually read off the string; a guessed streetAddress is worse than
 * none at all. Locality/region are safe: the platform is Tempe-only.
 */
function postalAddressFor(address: string) {
  const head = (address || '').split(',')[0]?.trim() ?? ''
  const hasStreetNumber = /^\d+\s+\S/.test(head)
  const zip = address?.match(/\bAZ\s+(\d{5})\b/)?.[1]
  return {
    '@type': 'PostalAddress',
    ...(hasStreetNumber ? { streetAddress: head } : {}),
    addressLocality: 'Tempe',
    addressRegion: 'AZ',
    ...(zip ? { postalCode: zip } : {}),
    addressCountry: 'US',
  }
}

function realEstateListingFor(p: Property) {
  return {
    '@type': 'RealEstateListing',
    name: p.name,
    description: shortDescription(p),
    url: listingUrl(p.slug),
    ...(p.images?.[0] ? { image: p.images[0] } : {}),
    address: postalAddressFor(p.address),
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: p.price,
        priceCurrency: 'USD',
        unitText: 'MONTH',
      },
    },
    ...(p.beds > 0 ? { numberOfRooms: p.beds } : {}),
    ...(p.baths > 0 ? { numberOfBathroomsTotal: p.baths } : {}),
  }
}

function listingNavElementFor(p: Property) {
  const dist = p.asu_distance ? `${Number(p.asu_distance).toFixed(1)} mi to ASU Tempe. ` : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': listingUrl(p.slug),
    name: `${p.name} — ASU Housing`,
    description: `${p.beds} bed / ${p.baths} bath near Arizona State University in Tempe. ${dist}From $${p.price.toLocaleString()}/mo — no broker fees.`,
    url: listingUrl(p.slug),
  }
}

// ── WebPage schema — signals this page's identity and key linked pages ──
function buildWebPageJsonLd(listings: Property[]) {
  return {
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
      ...listings.map(p => listingUrl(p.slug)),
      `${SITE_URL}/pricing`,
    ],
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'HomeHive', item: SITE_URL },
      ],
    },
  }
}

// ── SiteNavigationElement — the primary schema signal for Google Sitelinks ──
const STATIC_NAV_JSON_LD = [
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
    '@id': `${SITE_URL}/pricing`,
    name: 'Pricing',
    description: `100% free for ASU students — browse listings, find roommates, sign leases, and pay rent at no cost. Landlords pay a flat monthly plan starting at ${STARTER_PRICE}.`,
    url: `${SITE_URL}/pricing`,
  },
]

function buildSiteNavJsonLd(listings: Property[]) {
  return [...STATIC_NAV_JSON_LD, ...listings.map(listingNavElementFor)]
}

// ── ItemList — featured ASU housing listings ──
function buildFeaturedListingsJsonLd(listings: Property[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Featured Off-Campus Housing Near ASU Tempe',
    description: 'Verified student housing listings near Arizona State University in Tempe, AZ. No broker fees.',
    url: `${SITE_URL}/homes`,
    numberOfItems: listings.length,
    itemListElement: listings.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: listingUrl(p.slug),
      name: p.name,
      item: realEstateListingFor(p),
    })),
  }
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
        text: `Yes — HomeHive is completely free for students, now and always. There are no broker fees, no application fees, and no hidden charges. Landlords pay a flat monthly plan starting at ${STARTER_PRICE}.`,
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
  const schemaHomes = schemaListings(initialProperties)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildWebPageJsonLd(schemaHomes)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildSiteNavJsonLd(schemaHomes)) }} />
      {schemaHomes.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFeaturedListingsJsonLd(schemaHomes)) }} />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <HomePageClient initialProperties={initialProperties} />
    </>
  )
}
