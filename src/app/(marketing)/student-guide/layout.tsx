import type { Metadata } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata: Metadata = {
  title: 'ASU Off-Campus Housing Guide — Everything Students Need to Know',
  description:
    'The complete guide to living off-campus near Arizona State University. Covers neighborhoods, budgeting, commuting, roommates, international students, and the Tempe move-in checklist.',
  keywords: [
    'ASU off campus housing guide',
    'student guide Tempe Arizona',
    'off campus living Arizona State University',
    'neighborhoods near ASU Tempe',
    'budgeting student housing ASU',
    'commuting to ASU from off campus',
    'international student housing ASU',
    'ASU move in checklist',
    'Tempe neighborhoods students',
    'how to find housing ASU student',
  ],
  openGraph: {
    title: 'The Complete ASU Off-Campus Housing Guide | HomeHive',
    description:
      'Neighborhoods, budgeting, commuting, roommates, and move-in checklist — everything ASU students need to know about living off-campus in Tempe.',
    url: `${SITE_URL}/student-guide`,
    siteName: 'HomeHive',
  },
  alternates: { canonical: `${SITE_URL}/student-guide` },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
