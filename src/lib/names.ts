// `profiles` stores one `full_name` and nothing else.
//
// Much of the app wants to greet someone by their first name, and for a long
// time it asked PostgREST for a `profiles.first_name` column that has never
// existed. That is not a null field: the request fails outright and the *whole
// row* comes back null, so the greeting and — far worse — the email address
// selected alongside it both vanish without an error anyone sees.
//
// Derive the first name here instead, and never select a column `profiles`
// doesn't have.

/** The first word of a full name, or null when there's nothing to greet. */
export function firstNameFrom(fullName?: string | null): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0]
  return first || null
}
