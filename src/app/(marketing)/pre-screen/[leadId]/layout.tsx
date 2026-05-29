import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'Quick Pre-Screen — HomeHive',
  description: 'Complete your 2-minute pre-screen to move forward with your housing application on HomeHive.',
  openGraph: {
    title: 'Your Housing Application — HomeHive',
    description: 'You\'re one step away. Complete your quick pre-screen to move forward with your housing application.',
    siteName: 'HomeHive',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/opengraph-image`,
        width: 1200,
        height: 630,
        alt: 'HomeHive — Off-Campus Housing Near ASU Tempe',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Your Housing Application — HomeHive',
    description: 'Complete your quick pre-screen to move forward with your housing application.',
    images: [`${SITE_URL}/opengraph-image`],
  },
  robots: { index: false, follow: false },
}

export default function PreScreenLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
