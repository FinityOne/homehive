import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import PostHogProvider from '@/components/PostHogProvider'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph-image`

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  verification: {
    other: {
      'facebook-domain-verification': '7xp9ywf5qg271z0wfjjmiha96ug8mb',
    },
  },
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
  '@id': `${SITE_URL}/#organization`,
  name: 'HomeHive',
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/hh-icon.png`,
    width: 32,
    height: 32,
  },
  description: 'The #1 off-campus housing platform for Arizona State University students in Tempe, AZ. Verified apartments, subleases, and lease transfers.',
  sameAs: [],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    url: `${SITE_URL}/contact`,
    availableLanguage: 'English',
  },
}

// WebSite with @id — all sub-pages reference this via isPartOf
// potentialAction enables the Google Sitelinks Search Box
const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  url: SITE_URL,
  name: 'HomeHive',
  description: 'The #1 off-campus housing platform for ASU students in Tempe, Arizona. Verified apartments, subleases, and lease transfers. Free for students.',
  publisher: { '@id': `${SITE_URL}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/homes?q={search_term_string}`,
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

        {/* Meta Pixel */}
        <Script id="meta-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window,document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','2402699450238930');
          fbq('track','PageView');
        `}</Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img height="1" width="1" style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=2402699450238930&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
      </body>
    </html>
  )
}
