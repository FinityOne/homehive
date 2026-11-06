'use client'

/**
 * The header every money screen wears.
 *
 * Financials, the portfolio tree, collections, the schedule, a single lease's
 * ledger and the reminders log are one place in a landlord's head — "the money"
 * — but they used to be pages that each restated their own identity, with the
 * global sidebar as the only route between them. So they now share this: the
 * same title row, the same tabs, a breadcrumb when you are deeper than the top,
 * and exactly one primary action, which is whatever that view most wants
 * pressed.
 *
 * ── Why there are five tabs and not one page ───────────────────────────────
 *
 * Financials used to be a single scrolling page carrying all of this at once,
 * and it was unreadable for a reason that has nothing to do with styling: it
 * mixed altitudes. "Am I being paid" and "which of Aleeya's three charges is
 * the one from August" are not the same question, and a surface that answers
 * both answers neither well. So the tabs are the altitudes:
 *
 *   Overview     — is anything wrong? Numbers and charts, no tables.
 *   Portfolio    — property → lease → plan → tenant. The structure.
 *   Collections  — who owes what, aged, with the actions. The work.
 *   Schedule     — what falls due when. The calendar.
 *   Payments     — what actually arrived. The reconciliation log.
 *   Reminders    — what was emailed about it.
 *
 * Each tab is allowed to be dense, because its reader asked for that question.
 *
 * ── Why these are `Link` and not `<a>` ─────────────────────────────────────
 *
 * Every tab here is a client-side navigation. A raw `<a href>` re-downloads the
 * shell, re-runs the auth and plan checks and re-fetches the whole portfolio on
 * every tab press — the exact fault that made the portal feel slow before. With
 * `Link`, the money data loaded on the overview is still in memory when the
 * landlord lands on collections, so the tabs feel like tabs.
 *
 * ── The badges ─────────────────────────────────────────────────────────────
 *
 * The tab badges are the quiet workhorses. A landlord has no reason to visit a
 * log of sent email on a normal day — but if three reminders bounced, the
 * number appears on the Reminders tab in red from wherever they happen to be
 * standing, which is the only way they would ever find out. Collections carries
 * the same idea for the people who are behind.
 */

import Link from 'next/link'
import { type HubTab } from '@/lib/financeTheme'

export type Crumb = { label: string; href?: string }

type TabSpec = { id: HubTab; label: string; href: string; title: string }

/** The money area's sections, in the order a landlord descends through them. */
const TABS: TabSpec[] = [
  {
    id: 'overview', label: 'Overview', href: '/landlord/financials',
    title: 'Is anything wrong — collection, arrears, what is coming',
  },
  {
    id: 'portfolio', label: 'Portfolio', href: '/landlord/financials/portfolio',
    title: 'Every property, its leases, the plans on them and who pays',
  },
  {
    id: 'collections', label: 'Collections', href: '/landlord/financials/collections',
    title: 'Who is behind, how far behind, and what to do about it',
  },
  {
    id: 'schedule', label: 'Schedule', href: '/landlord/financials/schedule',
    title: 'What falls due, month by month, lease by lease',
  },
  {
    id: 'payments', label: 'Payments', href: '/landlord/financials/payments',
    title: 'Every payment collected: what cleared, what is still clearing, what bounced',
  },
]

export default function MoneyHub({
  tab, title, sub, crumbs, action, secondary, alarmCount, dueCount, meta, filters,
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
  /** A real alternative to it, when one exists. Never a third. */
  secondary?: { label: string; href?: string; onClick?: () => void }
  /** Reminders that bounced, were refused, or were marked as spam. */
  alarmCount?: number
  /** How many people are behind — carried on Collections from anywhere. */
  dueCount?: number
  /** A short status line under the title — lease term, filter in force. */
  meta?: React.ReactNode
  /** The view's own filter row, rendered under the tabs so every page in the
   *  area puts its controls in the same place. */
  filters?: React.ReactNode
}) {
  return (
    <header className="hub">
      {crumbs && crumbs.length > 1 && (
        <nav className="hub-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="sep" aria-hidden="true">/</span>}{' '}
              {c.href
                ? <Link href={c.href}>{c.label}</Link>
                : <span aria-current="page">{c.label}</span>}
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
        {(action || secondary) && (
          <div className="hub-actions">
            {secondary && (
              secondary.href
                ? <Link className="btn-secondary" href={secondary.href}>{secondary.label}</Link>
                : <button className="btn-secondary" onClick={secondary.onClick}>{secondary.label}</button>
            )}
            {action && (
              action.href
                ? <Link className="btn-primary" href={action.href}>{action.label}</Link>
                : <button className="btn-primary" onClick={action.onClick}>{action.label}</button>
            )}
          </div>
        )}
      </div>

      {tab && (
        <nav className="hub-tabs" aria-label="Money">
          {TABS.map(t => {
            const badge = t.id === 'collections' ? dueCount : undefined
            return (
              <Link
                key={t.id}
                className={`hub-tab${tab === t.id ? ' on' : ''}${badge ? ' alarm' : ''}`}
                href={t.href}
                title={badge
                  ? `${badge} ${badge === 1 ? 'person is' : 'people are'} behind on rent`
                  : t.title}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                {t.label}
                {!!badge && <span className="seg-badge">{badge}</span>}
              </Link>
            )
          })}
          <Link
            className={`hub-tab${tab === 'reminders' ? ' on' : ''}${alarmCount ? ' alarm' : ''}`}
            href="/landlord/reminders"
            title={alarmCount
              ? `${alarmCount} email${alarmCount !== 1 ? 's' : ''} never reached the tenant`
              : 'Every email sent to a tenant about money'}
            aria-current={tab === 'reminders' ? 'page' : undefined}
          >
            Reminders
            {!!alarmCount && <span className="seg-badge">{alarmCount}</span>}
          </Link>
        </nav>
      )}

      {filters && <div className="hub-filters">{filters}</div>}
    </header>
  )
}
