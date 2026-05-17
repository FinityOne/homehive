import type { Metadata } from 'next'
import GroupPageClient from './GroupPageClient'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
const DEFAULT_OG = `${SITE_URL}/og-default.jpg`

type Props = { params: Promise<{ token: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params

  let title = 'Join Our Roommate Group — HomeHive'
  let description = 'View the roommate group and join for free on HomeHive.'
  let ogImage = DEFAULT_OG

  try {
    const res = await fetch(`${SITE_URL}/api/groups/share/${token}`, { cache: 'no-store' })
    if (res.ok) {
      const { group, property, members } = await res.json()
      const propertyName = property?.name ?? 'this home'
      const memberCount = (members ?? []).length

      const prefixLabel =
        group.gender_preference === 'girls_only' ? 'All-girls group' :
        group.gender_preference === 'boys_only' ? 'All-guys group' :
        'Roommate group'

      title = `${group.emoji} ${group.name} — ${prefixLabel} forming for ${propertyName} | HomeHive`
      description = [
        `${memberCount} ${memberCount === 1 ? 'person' : 'people'} already in`,
        property?.address ? `📍 ${property.address}` : null,
        property?.price ? `From $${property.price.toLocaleString()}/mo` : null,
        'Join free · No commitment',
      ].filter(Boolean).join(' · ')

      if (property?.hero_image) ogImage = property.hero_image
    }
  } catch { /* fall back to defaults */ }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/groups/${token}`,
      siteName: 'HomeHive',
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  }
}

export default function GroupPage({ params }: Props) {
  return <GroupPageClient params={params} />
}
