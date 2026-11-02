'use client'

/**
 * The header every money screen wears.
 *
 * Financials, a single lease's ledger and the reminders log are one place in a
 * landlord's head — "the money" — but they used to be pages that each
 * restated their own identity, with the global sidebar as the only route
 * between them. So they now share this: the same title row, the same tabs, a
 * breadcrumb when you are deeper than the top, and exactly one primary action,
 * which is whatever that view most wants pressed.
 *
 * The tab badge is the quiet workhorse. A landlord has no reason to visit a log
 * of sent email on a normal day — but if three reminders bounced, the number
 * appears on the Reminders tab in red from wherever they happen to be standing,
 * which is the only way they would ever find out.
 */

import { type HubTab } from '@/lib/financeTheme'

export type Crumb = { label: string; href?: string }

export default function MoneyHub({
  tab, title, sub, crumbs, action, alarmCount, meta,
}: {
  /** Which money screen this is. Null hides the tabs — used by a form, where
   *  tabbing away mid-edit would lose what the landlord typed. */
  tab: HubTab | null
  title: string
  sub?: string
  /** Trail above the title. The last entry is the current place, so it carries
   *  no href. Omitted at the top level, where a trail of one says nothing. */
  crumbs?: Crumb[]
  /** The single thing this view wants pressed. */
  action?: { label: string; href?: string; onClick?: () => void }
  /** Reminders that bounced, were refused, or were marked as spam. */
  alarmCount?: number
  /** A short status line under the title — lease term, filter in force. */
  meta?: React.ReactNode
}) {
  return (
    <header className="hub">
      {crumbs && crumbs.length > 1 && (
        <nav className="hub-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="sep" aria-hidden="true">/</span>}{' '}
              {c.href ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}

      <div className="hub-top">
        <div className="hub-id">
          <h1 className="title">{title}</h1>
          {sub && <p className="sub">{sub}</p>}
          {meta}
        </div>
        {action && (
          <div className="hub-actions">
            {action.href
              ? <a className="btn-primary" href={action.href}>{action.label}</a>
              : <button className="btn-primary" onClick={action.onClick}>{action.label}</button>}
          </div>
        )}
      </div>

      {tab && (
        <nav className="hub-tabs" aria-label="Money">
          <a className={`hub-tab${tab === 'overview' ? ' on' : ''}`} href="/landlord/financials">
            Financials
          </a>
          <a
            className={`hub-tab${tab === 'payments' ? ' on' : ''}`}
            href="/landlord/financials/payments"
            title="Every payment collected: what cleared, what is still clearing, what bounced"
          >
            Payments
          </a>
          <a
            className={`hub-tab${tab === 'reminders' ? ' on' : ''}${alarmCount ? ' alarm' : ''}`}
            href="/landlord/reminders"
            title={alarmCount
              ? `${alarmCount} email${alarmCount !== 1 ? 's' : ''} never reached the tenant`
              : 'Every email sent to a tenant about money'}
          >
            Reminders
            {!!alarmCount && <span className="seg-badge">{alarmCount}</span>}
          </a>
        </nav>
      )}
    </header>
  )
}
