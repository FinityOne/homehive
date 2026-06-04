import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPropertyBySlug } from '@/lib/properties'
import { getFaqsByPropertyId, FAQ_CATEGORIES, PropertyFaq } from '@/lib/faqs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

type Props = { params: Promise<{ slug: string }> }

function sortCategories(cats: string[]): string[] {
  const preset = FAQ_CATEGORIES as readonly string[]
  return [...cats].sort((a, b) => {
    const ia = preset.indexOf(a), ib = preset.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
}

function groupByCategory(faqs: PropertyFaq[]) {
  const map: Record<string, PropertyFaq[]> = {}
  for (const f of faqs) { (map[f.category || 'General'] ??= []).push(f) }
  return sortCategories(Object.keys(map)).map(cat => ({ cat, items: map[cat] }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const property = await getPropertyBySlug(slug)
  if (!property) return { title: 'FAQ Not Found — HomeHive' }

  const title = `${property.name} — Frequently Asked Questions | HomeHive`
  const description = `Answers about ${property.name} near ASU: utilities, parking, lease terms, tours, amenities and more.`
  const url = `${SITE_URL}/homes/${slug}/faq`

  return {
    title,
    description,
    openGraph: { title, description, url, siteName: 'HomeHive', type: 'website', images: property.images?.[0] ? [{ url: property.images[0] }] : undefined },
    alternates: { canonical: url },
  }
}

export default async function PropertyFaqPage({ params }: Props) {
  const { slug } = await params
  const property = await getPropertyBySlug(slug)
  if (!property) notFound()

  const faqs = await getFaqsByPropertyId(property.id)
  const answered = faqs.filter(f => f.answer.trim())
  const groups = groupByCategory(answered)
  const hero = property.images?.[0] || ''

  // FAQPage structured data — only answered questions.
  const faqJsonLd = answered.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: answered.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  } : null

  return (
    <>
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      )}
      <style>{FAQ_PAGE_CSS}</style>

      <div className="faqp-wrap">
        <div className="faqp-breadcrumb">
          <Link href="/homes">Homes</Link> › <Link href={`/homes/${slug}`}>{property.name}</Link> › FAQ
        </div>

        {/* Listing summary header */}
        <div className="faqp-hero">
          {hero && <img src={hero} alt={property.name} className="faqp-hero-img" />}
          <div className="faqp-hero-body">
            <div className="faqp-eyebrow">Frequently Asked Questions</div>
            <h1 className="faqp-title">{property.name}</h1>
            {property.address && <div className="faqp-addr">📍 {property.address}</div>}
            <div className="faqp-meta">
              <span className="faqp-price">{property.rental_mode === 'by_room' ? 'from ' : ''}${property.price?.toLocaleString()}/mo</span>
              <span className="faqp-dot">·</span>
              <span>{property.beds} bd · {property.baths} ba</span>
              {property.asu_distance ? <><span className="faqp-dot">·</span><span>{property.asu_distance} mi to ASU</span></> : null}
            </div>
            <div className="faqp-hero-actions">
              <Link href={`/homes/${slug}`} className="faqp-btn faqp-btn-primary">← Back to listing</Link>
              <Link href={`/homes/${slug}#inquiry`} className="faqp-btn faqp-btn-ghost">Register interest</Link>
            </div>
          </div>
        </div>

        {/* FAQ content */}
        {answered.length === 0 ? (
          <div className="faqp-empty">
            <div className="faqp-empty-emoji">💬</div>
            <div className="faqp-empty-title">No questions answered yet</div>
            <p>Have a question about {property.name}? Register your interest and the landlord will get back to you.</p>
            <Link href={`/homes/${slug}#inquiry`} className="faqp-btn faqp-btn-primary" style={{ marginTop: 14 }}>Ask about this home →</Link>
          </div>
        ) : (
          <div className="faqp-content">
            {groups.map(({ cat, items }) => (
              <section key={cat} className="faqp-group">
                <h2 className="faqp-cat">{cat}</h2>
                {items.map(f => (
                  <details key={f.id} className="faqp-item">
                    <summary>{f.question}</summary>
                    <div className="faqp-answer">{f.answer}</div>
                  </details>
                ))}
              </section>
            ))}

            {/* Bottom CTA */}
            <div className="faqp-cta">
              <div className="faqp-cta-title">Still have questions?</div>
              <p className="faqp-cta-sub">Register your interest and we’ll connect you with the landlord directly.</p>
              <Link href={`/homes/${slug}#inquiry`} className="faqp-btn faqp-btn-primary">Register interest in {property.name} →</Link>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const FAQ_PAGE_CSS = `
  .faqp-wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 80px; font-family: 'DM Sans', -apple-system, sans-serif; }
  .faqp-breadcrumb { font-size: 13px; color: #9b9b9b; margin-bottom: 18px; }
  .faqp-breadcrumb a { color: #8C1D40; text-decoration: none; }
  .faqp-breadcrumb a:hover { text-decoration: underline; }

  .faqp-hero { display: flex; gap: 18px; background: #fff; border: 1px solid #e8e5de; border-radius: 16px; overflow: hidden; margin-bottom: 28px; }
  .faqp-hero-img { width: 200px; height: auto; object-fit: cover; flex-shrink: 0; align-self: stretch; }
  .faqp-hero-body { padding: 20px 22px; flex: 1; min-width: 0; }
  .faqp-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #8C1D40; margin-bottom: 6px; }
  .faqp-title { font-size: 22px; font-weight: 700; color: #1a1a1a; margin: 0 0 5px; line-height: 1.2; }
  .faqp-addr { font-size: 13px; color: #9b9b9b; margin-bottom: 10px; }
  .faqp-meta { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; font-size: 13px; color: #4a4a4a; }
  .faqp-price { font-weight: 700; color: #1a1a1a; }
  .faqp-dot { color: #d0ccc2; }
  .faqp-hero-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }

  .faqp-btn { display: inline-block; text-decoration: none; font-size: 13px; font-weight: 600; padding: 9px 18px; border-radius: 9px; cursor: pointer; }
  .faqp-btn-primary { background: #1a1a1a; color: #FFC627; }
  .faqp-btn-primary:hover { background: #2a2a2a; }
  .faqp-btn-ghost { background: #fff; color: #1a1a1a; border: 1.5px solid #e8e5de; }
  .faqp-btn-ghost:hover { border-color: #8C1D40; color: #8C1D40; }

  .faqp-group { margin-bottom: 26px; }
  .faqp-cat { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #8C1D40; margin: 0 0 12px; }
  .faqp-item { border: 1px solid #e8e5de; border-radius: 12px; margin-bottom: 10px; overflow: hidden; background: #fff; transition: box-shadow 0.15s; }
  .faqp-item[open] { box-shadow: 0 4px 16px rgba(0,0,0,0.05); }
  .faqp-item summary { list-style: none; cursor: pointer; padding: 16px 18px; font-size: 15px; font-weight: 600; color: #1a1a1a; display: flex; justify-content: space-between; align-items: center; gap: 14px; }
  .faqp-item summary::-webkit-details-marker { display: none; }
  .faqp-item summary::after { content: '+'; font-size: 22px; color: #8C1D40; font-weight: 300; flex-shrink: 0; line-height: 1; }
  .faqp-item[open] summary::after { content: '−'; }
  .faqp-answer { padding: 0 18px 18px; font-size: 14.5px; color: #4a4a4a; line-height: 1.7; white-space: pre-wrap; }

  .faqp-cta { text-align: center; background: #fdf2f5; border: 1px solid #f3d6df; border-radius: 16px; padding: 28px 24px; margin-top: 32px; }
  .faqp-cta-title { font-size: 18px; font-weight: 700; color: #8C1D40; margin-bottom: 6px; }
  .faqp-cta-sub { font-size: 14px; color: #6b5560; margin: 0 0 16px; line-height: 1.6; }

  .faqp-empty { text-align: center; padding: 48px 24px; }
  .faqp-empty-emoji { font-size: 40px; margin-bottom: 12px; }
  .faqp-empty-title { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
  .faqp-empty p { font-size: 14px; color: #6b6b6b; line-height: 1.6; max-width: 420px; margin: 0 auto; }

  @media (max-width: 560px) {
    .faqp-hero { flex-direction: column; }
    .faqp-hero-img { width: 100%; height: 180px; }
  }
`
