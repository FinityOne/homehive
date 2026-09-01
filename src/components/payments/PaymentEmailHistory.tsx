'use client'

import { fmtCurrency } from '@/lib/payments'

/** One payment request, as /api/payments/[planId]/emails returns it. */
export type PlanEmail = {
  id: string
  plan_tenant_id: string | null
  recipient_email: string
  recipient_name: string | null
  subject: string
  kind: string
  trigger: 'manual' | 'auto'
  status: 'sent' | 'failed'
  error: string | null
  custom_message: string | null
  amount_total: number
  created_at: string
  items: {
    id: string
    scheduled_payment_id: string | null
    special_payment_id: string | null
    label: string
    due_date: string
    amount: number
    kind: 'rent' | 'charge'
  }[]
}

/** Every request that mentioned one specific charge, newest first. */
export function emailsForCharge(
  emails: PlanEmail[],
  opts: { scheduledId?: string; specialId?: string }
): PlanEmail[] {
  return emails.filter(e => e.items.some(i =>
    (opts.scheduledId && i.scheduled_payment_id === opts.scheduledId) ||
    (opts.specialId   && i.special_payment_id   === opts.specialId)
  ))
}

export function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/**
 * The request history for a single charge, shown inside its row.
 *
 * A count ("reminded 2x") tells a landlord they did something; it does not tell
 * them when, to whom, or whether it arrived. Those are the questions actually
 * asked when rent is late, so they get answered in place rather than in a
 * separate log the landlord has to go and correlate by hand.
 */
export default function PaymentEmailHistory({
  emails, priorCount = 0, empty = 'No requests sent for this charge yet.',
}: {
  emails: PlanEmail[]
  /**
   * Sends counted on the charge itself. Anything above the number of logged
   * emails happened before this history existed, and saying so is better than
   * showing a blank panel next to a button that reads "Remind again (3)".
   */
  priorCount?: number
  empty?: string
}) {
  const untracked = Math.max(0, priorCount - emails.length)

  if (emails.length === 0) {
    return (
      <div style={S.empty}>
        {untracked > 0
          ? `Requested ${untracked} time${untracked !== 1 ? 's' : ''} before request history was recorded.`
          : empty}
      </div>
    )
  }
  return (
    <div style={S.wrap}>
      {emails.map(e => {
        // What this email covered beyond the row being viewed — worth showing,
        // because one request often settles several months at once.
        const others = e.items.length - 1
        return (
          <div key={e.id} style={S.item}>
            <span style={{ ...S.dot, background: e.status === 'failed' ? '#d13b30' : '#1d8a4e' }} />
            <div style={S.body}>
              <div style={S.line}>
                <strong style={S.strong}>{e.status === 'failed' ? 'Failed' : 'Sent'}</strong>
                {' · '}{fmtWhen(e.created_at)}
                {' · '}{e.recipient_name || e.recipient_email}
              </div>
              <div style={S.meta}>
                {fmtCurrency(e.amount_total)} requested
                {others > 0 && ` · with ${others} other charge${others !== 1 ? 's' : ''}`}
                {e.trigger === 'auto' && ' · automatic'}
              </div>
              {e.status === 'failed' && e.error && <div style={S.err}>{e.error}</div>}
              {e.custom_message && <div style={S.note}>“{e.custom_message}”</div>}
            </div>
          </div>
        )
      })}
      {untracked > 0 && (
        <div style={S.empty}>
          + {untracked} earlier request{untracked !== 1 ? 's' : ''}, sent before this history was recorded.
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:   { display: 'flex', flexDirection: 'column', gap: 10 },
  item:   { display: 'flex', gap: 9, alignItems: 'flex-start' },
  dot:    { width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0 },
  body:   { minWidth: 0 },
  line:   { fontSize: '12.5px', color: '#1d1d1f', letterSpacing: '-0.01em' },
  strong: { fontWeight: 600 },
  meta:   { fontSize: '11.5px', color: '#6e6e73', marginTop: 2 },
  err:    { fontSize: '11.5px', color: '#d13b30', marginTop: 2 },
  note:   { fontSize: '11.5px', color: '#6e6e73', marginTop: 3, fontStyle: 'italic' },
  empty:  { fontSize: '12px', color: '#8e8e93' },
}
