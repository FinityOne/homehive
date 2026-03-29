import type { Metadata } from 'next'
import './globals.css'
import PostHogProvider from '@/components/PostHogProvider'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

// Aerial of Tempe / ASU campus area (Unsplash, free to use).
// For best performance, host your own version at /public/og-default.jpg
// and replace this with `${SITE_URL}/og-default.jpg`.
const DEFAULT_OG_IMAGE = 'https://images.unsplash.com/photo-1562516155-e0c1ee44059b?w=1200&q=80'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe',
    template: '%s | HomeHive',
  },
  description:
    "Find off-campus housing near Arizona State University. Verified apartments, subleases & lease transfers in Tempe. No broker fees, ASU-proximity filtering, fast response from landlords.",
  keywords: [
    'ASU off campus housing',
    'off campus housing Arizona State University',
    'student housing Tempe AZ',
    'ASU student apartments',
    'apartments near ASU Tempe',
    'sublease ASU',
    'ASU sublease',
    'student housing near ASU',
    'rooms for rent near ASU',
    'Tempe student rentals',
    'off campus housing Tempe Arizona',
    'Arizona State University housing',
    'lease transfer ASU',
    'student apartments Tempe Arizona',
    'housing near ASU campus',
    'furnished rooms Tempe AZ',
    'roommates ASU Tempe',
    'short term housing ASU',
    'ASU approved off campus housing',
    'Sun Devil housing',
  ],
  authors: [{ name: 'HomeHive', url: SITE_URL }],
  creator: 'HomeHive',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'HomeHive',
    title: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe',
    description:
      'Verified apartments, subleases & lease transfers near Arizona State University. No broker fees, ASU-proximity filtering.',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Aerial view of Tempe, Arizona near ASU campus — HomeHive student housing',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@homehive',
    title: 'HomeHive — #1 Off-Campus Housing for ASU Students in Tempe',
    description:
      'Verified apartments, subleases & lease transfers near Arizona State University. No broker fees.',
    images: [DEFAULT_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'HomeHive',
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  description: 'The #1 off-campus housing platform for Arizona State University students in Tempe, AZ. Verified apartments, subleases, and lease transfers.',
  sameAs: [],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    url: `${SITE_URL}/contact`,
    availableLanguage: 'English',
  },
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  url: SITE_URL,
  name: 'HomeHive',
  description: 'Off-campus housing platform for ASU students in Tempe, Arizona.',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/homes`,
    },
    'query-input': 'required name=search_term_string',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f5f4f0' }}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  )
}
