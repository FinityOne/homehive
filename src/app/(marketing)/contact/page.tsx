export default function ContactPage() {
  return (
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
  )
}