// Shared helpers for the passwordless email-code (OTP) flow.
//
// The emailed code is minted by Supabase Auth, so its length is whatever the
// project's "Email OTP Length" setting says — we design for 6, but the login /
// signup inputs must never be *shorter* than the code that actually went out,
// or the user physically cannot type it in. /api/auth/send-code reports the
// real length back and the forms size themselves from it.

export const DEFAULT_CODE_LENGTH = 6
export const MAX_CODE_LENGTH = 10

/** Clamp a server-reported code length to something sane for an input field. */
export function normalizeCodeLength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CODE_LENGTH
  const n = Math.floor(value)
  if (n < DEFAULT_CODE_LENGTH || n > MAX_CODE_LENGTH) return DEFAULT_CODE_LENGTH
  return n
}

/** Keep only digits, capped at the expected code length. */
export function sanitizeCode(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length)
}
