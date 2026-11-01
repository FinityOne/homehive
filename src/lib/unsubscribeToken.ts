/**
 * Signed unsubscribe links.
 *
 * An unsubscribe link has to work from inside a mail client: no session, no
 * login, one click. That means the address being unsubscribed travels in the
 * URL, and the only thing stopping anyone from unsubscribing anyone else is
 * that the link is signed.
 *
 * An HMAC rather than a stored token on purpose — there is no row to create
 * before sending, nothing to clean up afterwards, and a link stays valid for as
 * long as the secret does, which matters because people unsubscribe from mail
 * that has sat in an inbox for months. Deliberately *not* expiring: an
 * unsubscribe link that has gone stale is a complaint waiting to happen.
 */
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Keyed on its own secret, falling back to the service role key.
 *
 * The fallback keeps this working in environments nobody has added a new
 * variable to yet. It is not a weakening: the signature only guards "may this
 * address be unsubscribed", and leaking it would let someone stop our own
 * marketing mail, which is the least damaging capability in the codebase.
 */
function secret(): string {
  const s =
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.CRON_SECRET
  if (!s) throw new Error('No secret available to sign unsubscribe links')
  return s
}

/** Addresses are compared case-insensitively everywhere else; sign them that way too. */
const normalise = (email: string) => email.trim().toLowerCase()

export function signUnsubscribe(email: string, category: string): string {
  return createHmac('sha256', secret())
    .update(`${normalise(email)}|${category}`)
    .digest('base64url')
}

export function verifyUnsubscribe(email: string, category: string, token: string): boolean {
  if (!email || !token) return false
  let expected: string
  try {
    expected = signUnsubscribe(email, category)
  } catch {
    return false
  }
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a wrong-length token is wrong either way.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The link that goes in the email footer. */
export function unsubscribeUrl(site: string, email: string, category: string): string {
  const q = new URLSearchParams({
    email: normalise(email),
    c: category,
    t: signUnsubscribe(email, category),
  })
  return `${site}/api/email/unsubscribe?${q.toString()}`
}
