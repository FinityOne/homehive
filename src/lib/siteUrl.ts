const PRODUCTION_URL = 'https://homehive.live'

/**
 * Returns the canonical site URL, always production-safe.
 * Never returns a localhost URL — prevents broken links in emails/SMS.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (!configured) return PRODUCTION_URL
  // Guard: never let a localhost URL escape into emails or shared links
  if (configured.includes('localhost') || configured.includes('127.0.0.1')) return PRODUCTION_URL
  return configured
}

export const SITE_URL = getSiteUrl()
