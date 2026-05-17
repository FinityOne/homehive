const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

export const metadata = {
  title: 'Contact HomeHive — Get Help with ASU Student Housing',
  description: 'Have a question about a listing, roommate matching, or your account? Reach the HomeHive team at hello@homehive.live. We respond within hours.',
  keywords: [
    'contact HomeHive',
    'HomeHive support',
    'ASU housing help',
    'student housing contact',
    'Tempe rental help',
  ],
  openGraph: {
    title: 'Contact HomeHive — ASU Student Housing Support',
    description: 'Have a question about housing near ASU? Reach us at hello@homehive.live — we respond within hours.',
    url: `${SITE_URL}/contact`,
    siteName: 'HomeHive',
    type: 'website' as const,
  },
  twitter: {
    card: 'summary' as const,
    title: 'Contact HomeHive',
    description: 'Questions about ASU off-campus housing? Reach us at hello@homehive.live.',
  },
  alternates: { canonical: `${SITE_URL}/contact` },
}

const contactSchema = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  name: 'Contact HomeHive',
  description: 'Reach the HomeHive team for questions about ASU off-campus housing, listings, or your account.',
  url: `${SITE_URL}/contact`,
  mainEntity: {
    '@type': 'Organization',
    name: 'HomeHive',
    url: SITE_URL,
    email: 'hello@homehive.live',
    telephone: '+19498670499',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'hello@homehive.live',
      telephone: '+19498670499',
      contactType: 'customer support',
      areaServed: 'US',
      availableLanguage: 'English',
    },
  },
}

export default function ContactPage() {
  return (
    <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(contactSchema) }}
    />
    <div style={{ maxWidth: '600px', margin: '80px auto', padding: '0 24px', fontFamily: "'DM Sans', sans-serif", textAlign: 'center' }}>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '36px', fontWeight: 300, color: '#1a1a1a', marginBottom: '16px' }}>
        Get in touch
      </h1>
      <p style={{ fontSize: '16px', color: '#6b6b6b', lineHeight: 1.7, marginBottom: '32px' }}>
        Have a question about a listing, roommate matching, or anything else? We respond within hours.
      </p>
      <a 
        href="mailto:hello@homehive.live"
        style={{ background: '#8C1D40', color: '#fff', padding: '13px 28px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', fontFamily: "'DM Sans', sans-serif" }}
      >
        hello@homehive.live
      </a>
    </div>
    </>
  )
}