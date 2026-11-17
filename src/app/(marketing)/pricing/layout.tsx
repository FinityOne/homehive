import type { Metadata } from 'next'
// Prices in the rich-result schema are derived from the price list, so a
// Google answer card can never quote a figure the checkout no longer charges.
import { PLANS, formatUsd } from '@/lib/landlordPlans'
import { FREE_PROPERTY_LIMIT } from '@/lib/landlordAccess'

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
        text: `Landlord plans are a flat monthly price based on how many properties you list: ${formatUsd(PLANS.starter.priceCents)}/month for one property, ${formatUsd(PLANS.growth.priceCents)}/month for up to ${PLANS.growth.propertyLimit}, and ${formatUsd(PLANS.unlimited.priceCents)}/month for unlimited properties. Every plan includes the full platform, and building a property is free until you publish it.`,
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
      name: 'Can landlords use HomeHive for free?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: `Yes, to start. You can create an account and build up to ${FREE_PROPERTY_LIMIT} properties at no cost, including photos, pricing and a preview of the live listing. A paid plan is what publishes those listings to students and opens leads, screening, leases and rent collection.`,
      },
    },
    {
      '@type': 'Question',
      name: 'How do landlords get started on HomeHive?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sign up at homehive.live, build your property for free, then choose a plan to publish it. Listings go live immediately once a plan is active — there is no review queue.',
      },
    },
  ],
}

export const metadata: Metadata = {
  title: `Pricing — Free for ASU Students, Landlord Plans from ${formatUsd(PLANS.starter.priceCents)}/mo`,
  description:
    `HomeHive is 100% free for ASU students — browse listings, find roommates, sign leases, and pay rent at no cost. Landlords build properties free and pay a flat monthly plan from ${formatUsd(PLANS.starter.priceCents)} to publish them.`,
  keywords: [
    'free student housing platform ASU',
    'no broker fee housing Tempe',
    'free apartment search near ASU',
    'student housing no fees Arizona State',
  ],
  openGraph: {
    title: `HomeHive Pricing — Free for Students, Plans from ${formatUsd(PLANS.starter.priceCents)}/mo for Landlords`,
    description:
      `ASU students pay nothing — ever. Landlord plans start at ${formatUsd(PLANS.starter.priceCents)}/month for one property. No broker fees, no per-lead charges, no commission.`,
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
