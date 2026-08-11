'use client'

import { isLiveStripe } from '@/lib/stripeEnv'

/**
 * "You're on the Stripe sandbox" banner.
 *
 * Renders nothing in live mode — so it can be dropped onto any payment surface
 * without a conditional at the call site, and can never appear to a real
 * paying tenant. Shown on localhost and Vercel preview deploys, where a
 * convincing-looking payment form takes no real money.
 */
export default function StripeModeBanner({
  /** Include the test card numbers — worth it right at the point of payment. */
  detail = false,
  style,
}: {
  detail?: boolean
  style?: React.CSSProperties
}) {
  if (isLiveStripe()) return null

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9,
        background: '#fffbeb', border: '1px solid #fde68a',
        borderLeft: '4px solid #f59e0b', borderRadius: 9,
        padding: '10px 13px', fontSize: 12.5, lineHeight: 1.55,
        color: '#92400e', fontFamily: "'DM Sans', system-ui, sans-serif",
        ...style,
      }}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1.2 }}>🧪</span>
      <span>
        <strong>Stripe test mode</strong> — this is the sandbox account. No real money moves and no
        card is charged.
        {detail && (
          <>
            {' '}Use card <code style={CODE}>4242 4242 4242 4242</code>, any future expiry and any
            CVC. For bank transfer, pick <strong>Test Institution</strong>.
          </>
        )}
      </span>
    </div>
  )
}

const CODE: React.CSSProperties = {
  background: 'rgba(146,64,14,0.1)',
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: 11.5,
  fontFamily: "'Geist Mono', ui-monospace, monospace",
}
