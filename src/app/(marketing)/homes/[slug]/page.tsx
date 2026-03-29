import type { Metadata } from 'next'
import { getPropertyBySlug } from '@/lib/properties'
import PropertyPageClient from './PropertyPageClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = `${SITE_URL}/og-default.jpg`

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ name?: string; msg?: string; from?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const property = await getPropertyBySlug(slug)

  if (!property) {
    return {
      title: 'Home Not Found — HomeHive',
      description: 'This listing is no longer available.',
    }
  }

  const title = `${property.name} — Student Housing Near ASU | HomeHive`
  const description = [
    property.description?.slice(0, 120),
    property.address ? `📍 ${property.address}` : null,
    property.price ? `$${property.price.toLocaleString()}/mo per room` : null,
    property.beds ? `${property.beds} bed · ${property.baths} bath` : null,
  ].filter(Boolean).join(' · ')

  const ogImage = property.images?.[0] || DEFAULT_OG
  const url = `${SITE_URL}/homes/${slug}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'HomeHive',
      type: 'website',
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: property.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    alternates: {
      canonical: url,
    },
  }
}

export default async function PropertyPage(props: Props) {
  const { slug } = await props.params
  const property = await getPropertyBySlug(slug)

  const jsonLd = property
    ? {
        '@context': 'https://schema.org',
        '@type': 'RealEstateListing',
        name: property.name,
        description: property.description || `${property.beds}-bed, ${property.baths}-bath student housing near ASU in Tempe, AZ.`,
        url: `${SITE_URL}/homes/${slug}`,
        image: property.images?.length ? property.images : undefined,
        address: {
          '@type': 'PostalAddress',
          streetAddress: property.address,
          addressLocality: 'Tempe',
          addressRegion: 'AZ',
          addressCountry: 'US',
        },
        offers: {
          '@type': 'Offer',
          price: property.price,
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: property.price,
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
        },
        numberOfRooms: property.beds,
        numberOfBathroomsTotal: property.baths,
        floorSize: property.sqft
          ? { '@type': 'QuantitativeValue', value: property.sqft, unitCode: 'FTK' }
          : undefined,
        amenityFeature: property.tags?.map(tag => ({
          '@type': 'LocationFeatureSpecification',
          name: tag,
          value: true,
        })),
        additionalProperty: [
          {
            '@type': 'PropertyValue',
            name: 'Distance to ASU Tempe campus',
            value: property.asu_distance ? `${property.asu_distance} miles` : 'Near campus',
          },
          {
            '@type': 'PropertyValue',
            name: 'Listing type',
            value: property.listing_type === 'sublease' ? 'Sublease' :
                   property.listing_type === 'lease_transfer' ? 'Lease Transfer' : 'Standard Rental',
          },
        ],
      }
    : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PropertyPageClient {...props} />
    </>
  )
}
