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
    default: 'HomeHive — Student Housing Near ASU in Tempe',
    template: '%s | HomeHive',
  },
  description:
    "Find your perfect student home near Arizona State University. Fully furnished rooms, flexible move-in, no broker fees. Tempe's top-rated student housing.",
  keywords: [
    'ASU student housing',
    'student apartments Tempe',
    'rooms near Arizona State University',
    'Tempe student rentals',
    'off-campus housing ASU',
    'furnished rooms Tempe AZ',
  ],
  authors: [{ name: 'HomeHive', url: SITE_URL }],
  creator: 'HomeHive',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'HomeHive',
    title: 'HomeHive — Student Housing Near ASU in Tempe',
    description:
      'Find your perfect student home near Arizona State University. Fully furnished rooms, flexible move-in, no broker fees.',
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
    title: 'HomeHive — Student Housing Near ASU in Tempe',
    description:
      'Find your perfect student home near Arizona State University. Fully furnished rooms, flexible move-in, no broker fees.',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f5f4f0' }}>
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  )
}
