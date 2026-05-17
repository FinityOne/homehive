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
      name: 'Why is HomeHive free for landlords through 2026?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "We're building our landlord community. We want you to experience the platform, fill rooms faster than you have before, and see the value before we ever talk about pricing. No risk on your end.",
      },
    },
    {
      '@type': 'Question',
      name: 'What happens to landlord pricing after 2026?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "We'll introduce a simple success fee model — a small percentage per room filled, only when we deliver results. No monthly subscriptions, no listing fees. You pay when you win.",
      },
    },
    {
      '@type': 'Question',
      name: 'How do landlords get early access to HomeHive?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Email landlord@homehive.live. We review every application within 48 hours. Early landlords get locked-in favorable pricing when we transition to paid.',
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
      'ASU students pay nothing — ever. Landlords list free through 2026. No broker fees, no hidden charges.',
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
