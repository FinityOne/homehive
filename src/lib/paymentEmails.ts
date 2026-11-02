/**
 * How a sent email is described, everywhere it is described.
 *
 * `payment_emails` holds a send as one status plus five timestamps — accepted,
 * delivered, opened, clicked, bounced, complained — because those are not
 * alternatives: a message is delivered *and* opened, and a bounce can arrive
 * after an acceptance. Reading them is a judgement about precedence, and if the
 * API and the page each made that judgement themselves they would eventually
 * disagree. So it is made once, here, and both import it.
 *
 * Pure and dependency-free: the server route filters with it and the browser
 * renders with it.
 */

export type EmailOutcome =
  | 'complained'  // marked as spam — the worst thing a recipient can do
  | 'bounced'     // never reached the mailbox
  | 'failed'      // never left our end
  | 'opened'      // read by the recipient
  | 'delivered'   // reached the mail server, not known to be read
  | 'pending'     // accepted by the provider, nothing observed since

export type EmailSignals = {
  status: string
  delivered_at: string | null
  opened_at: string | null
  bounced_at: string | null
  complained_at: string | null
}

/**
 * The one honest summary of a send.
 *
 * Problems outrank successes: a complaint beats a bounce beats a failure,
 * because each is something the landlord has to act on and the worst one is the
 * one worth surfacing. Among the successes the stronger claim wins — "opened"
 * says more than "delivered", and "delivered" says more than "we sent it".
 */
export function outcomeOf(r: EmailSignals): EmailOutcome {
  if (r.complained_at) return 'complained'
  if (r.bounced_at) return 'bounced'
  if (r.status === 'failed') return 'failed'
  if (r.opened_at) return 'opened'
  if (r.delivered_at) return 'delivered'
  return 'pending'
}

export const OUTCOME_META: Record<EmailOutcome, { label: string; tone: 'good' | 'bad' | 'warn' | 'info' | 'quiet'; hint: string }> = {
  opened:     { label: 'Opened',     tone: 'good',  hint: 'The tenant opened it' },
  delivered:  { label: 'Delivered',  tone: 'info',  hint: 'It reached their mail server' },
  pending:    { label: 'Sent',       tone: 'quiet', hint: 'Accepted by the email provider — no delivery report yet' },
  failed:     { label: 'Not sent',   tone: 'bad',   hint: 'It never left our end' },
  bounced:    { label: 'Bounced',    tone: 'bad',   hint: 'The address rejected it — the tenant never saw this' },
  complained: { label: 'Spam',       tone: 'bad',   hint: 'The tenant marked it as spam. Stop emailing this address.' },
}

/** Does this outcome need the landlord to do something? */
export const isProblem = (o: EmailOutcome) => o === 'bounced' || o === 'failed' || o === 'complained'

/**
 * What kind of email this was, in the words a landlord would use.
 *
 * `kind` is a free-text column on purpose — new senders should not need a
 * migration — so this reads the prefix rather than switching on an exhaustive
 * list, and falls back to something sayable instead of leaking a slug.
 */
export function kindLabel(kind: string): string {
  if (kind.startsWith('rent_request')) return 'Rent request'
  // Before the `late_fee` test below, which this would otherwise match — and
  // calling a write-off a "reminder" would state the opposite of what was sent.
  if (kind.startsWith('late_fee_waived_receipt')) return 'Your copy of a waiver'
  if (kind.startsWith('late_fee_waived')) return 'Late fee waived'
  if (kind.startsWith('late_fee')) return 'Late fee reminder'
  if (kind.startsWith('upcoming_')) {
    const days = kind.match(/^upcoming_(\d+)d$/)?.[1]
    return days ? `Automatic notice — ${days} days ahead` : 'Automatic notice'
  }
  if (kind.startsWith('receipt_tenant_processing')) return 'Payment clearing'
  if (kind.startsWith('receipt_tenant_failed')) return 'Payment failed'
  if (kind.startsWith('receipt_tenant')) return 'Payment receipt'
  if (kind.startsWith('receipt_landlord')) return 'Your copy of a receipt'
  if (kind.startsWith('receipt')) return 'Receipt'
  // A kind nobody has taught this function yet: say the slug plainly rather
  // than inventing a category for it.
  return kind.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

/** The kinds the reminders page offers as filters, in reading order. */
export const KIND_FILTERS: { id: string; label: string }[] = [
  { id: '',                 label: 'Everything' },
  { id: 'upcoming_',        label: 'Automatic notices' },
  { id: 'rent_request',     label: 'Rent requests' },
  { id: 'late_fee_request', label: 'Late fee reminders' },
  { id: 'late_fee_waived',  label: 'Fees waived' },
  { id: 'receipt_tenant',   label: 'Receipts' },
]

export type EmailState = 'all' | 'delivered' | 'opened' | 'problem' | 'pending'

export const STATE_FILTERS: { id: EmailState; label: string; hint: string }[] = [
  { id: 'all',       label: 'All',          hint: 'Every email sent' },
  { id: 'problem',   label: 'Needs a look', hint: 'Bounced, refused, or marked as spam' },
  { id: 'opened',    label: 'Opened',       hint: 'The tenant opened it' },
  { id: 'delivered', label: 'Delivered',    hint: 'Reached the mail server' },
  { id: 'pending',   label: 'No report',    hint: 'Sent, but the provider has not reported back' },
]

/** Does an outcome belong behind a given filter tab? */
export function matchesState(outcome: EmailOutcome, state: EmailState): boolean {
  switch (state) {
    case 'all':       return true
    case 'delivered': return outcome === 'delivered' || outcome === 'opened'
    case 'opened':    return outcome === 'opened'
    case 'problem':   return isProblem(outcome)
    case 'pending':   return outcome === 'pending'
  }
}
