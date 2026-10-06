import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Is HomeHive actually free for students?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. No credit card, no trial period, no freemium catch. HomeHive is completely free for students — now and going forward. We make money from landlords, not tenants.',
      },
    },
    {
      '@type': 'Question',
      name: 'Will HomeHive ever charge students?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "No. That's our brand promise. The moment we charge students, we become just another rental platform. We exist to make finding housing easier for ASU students, not to extract money from them.",
      },
    },
    {
      '@type': 'Question',
      name: "What's the catch with free student housing on HomeHive?",
      acceptedAnswer: {
        '@type': 'Answer',
        text: "There isn't one. We're building the platform landlords want to use, and a marketplace only works if students show up. Keeping students free forever is how we grow.",
      },
    },
    {
      '@type': 'Question',
      name: 'Do I need an account to use HomeHive as a student?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'You can browse and submit interest without an account. Creating one unlocks messaging, tour scheduling, lease signing, and payment — all still free.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does HomeHive cost for landlords?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Landlord plans are a flat monthly price based on how many properties you list: $19.99/month for one property, $49.99/month for up to five, and $199.99/month for unlimited properties. Every plan includes the full platform.',
      },
    },
    {
      '@type': 'Question',
      name: 'Are there any other landlord fees on HomeHive?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. No per-lead charges, no commission on filled rooms, no listing fees and no setup fee. One flat monthly price based on how many properties you list.',
      },
    },
    {
      '@type': 'Question',
      name: 'How do landlords get started on HomeHive?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sign up at homehive.live, choose a plan, and your landlord portal opens immediately. Listings are quality-checked within 48 hours of going up.',
      },
    },
    {
      '@type': 'Question',
      name: 'What does the HomeHive landlord vetting process involve?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'We verify property ownership, review listing accuracy, confirm pricing transparency, and do a quality check on photos. It usually takes less than 48 hours.',
      },
    },
  ],
}

export const metadata: Metadata = {
  title: 'Pricing — Free for ASU Students, Free for Landlords in 2026',
  description:
    'HomeHive is 100% free for ASU students — browse listings, find roommates, sign leases, and pay rent at no cost. Landlords list free through end of 2026.',
  keywords: [
    'free student housing platform ASU',
    'no broker fee housing Tempe',
    'free apartment search near ASU',
    'student housing no fees Arizona State',
  ],
  openGraph: {
    title: 'HomeHive Pricing — Free for Students, Free for Landlords',
    description:
      'ASU students pay nothing — ever. Landlord plans start at $19.99/month for one property. No broker fees, no per-lead charges, no commission.',
    url: `${SITE_URL}/pricing`,
    siteName: 'HomeHive',
  },
  alternates: { canonical: `${SITE_URL}/pricing` },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {children}
    </>
  )
}
