'use client'

/**
 * The parts every tenant screen is built from.
 *
 * Each of the five tenant screens used to declare its own page wrapper, its own
 * heading sizes, its own "Loading…" state and its own idea of what a stat tile
 * looks like — which is how the portal ended up with two column widths, three
 * display faces and a loading state that told the tenant nothing. These are the
 * shared pieces; the theme in `src/lib/tenantTheme.ts` is their stylesheet.
 */

import { useCallback, useSyncExternalStore } from 'react'
import Link from 'next/link'
import Icon, { type IconName } from '@/components/NavIcons'
import { TENANT_THEME, type TenantTone } from '@/lib/tenantTheme'

/**
 * The theme, injected before the page's own sheet.
 *
 * Rendered as a plain `<style>` because that is how every page in this app
 * ships its CSS, and because the cascade order has to be *theme first, page
 * second* — a page rule that overrides a token is the point.
 */
export function TenantStyles({ css }: { css?: string }) {
  return <style>{TENANT_THEME + (css ?? '')}</style>
}

/** Page title, one line of context, and at most one primary action. */
export function PageHead({
  title, lede, action, back,
}: {
  title: React.ReactNode
  lede?: React.ReactNode
  action?: React.ReactNode
  /** `{ href, label }` — the way back, when this screen is a drill-down. */
  back?: { href: string; label: string }
}) {
  return (
    <>
      {back && (
        <Link className="tp-back" href={back.href}>
          <Icon name="arrowLeft" size={15} />{back.label}
        </Link>
      )}
      <div className="tp-head">
        <div className="tp-head-main">
          <h1 className="tp-h1">{title}</h1>
          {lede && <div className="tp-lede">{lede}</div>}
        </div>
        {action}
      </div>
    </>
  )
}

/** A labelled run of content. The heading is a real `h2`. */
export function Section({
  title, link, children,
}: {
  title: string
  link?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <>
      <div className="tp-sec">
        <h2 className="tp-h2">{title}</h2>
        {link && <Link className="tp-sec-link" href={link.href}>{link.label} →</Link>}
      </div>
      {children}
    </>
  )
}

/** A supporting figure. Never the leading one — that is `.tp-panel`. */
export function Stat({
  label, value, sub, tone,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  tone?: 'owed' | 'paid'
}) {
  return (
    <div className="tp-stat">
      <div className="tp-stat-l">{label}</div>
      <div className={`tp-stat-v${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="tp-stat-s">{sub}</div>}
    </div>
  )
}

/**
 * A state, as a tone *and* a word. The word is not optional: colour alone is
 * not a label, and these screens get screenshotted into text messages.
 */
export function Badge({ tone, children }: { tone: TenantTone; children: React.ReactNode }) {
  return <span className={`tp-badge ${tone}`}>{children}</span>
}

/** An empty state that names the one thing to do next. */
export function Empty({
  icon = 'home', title, children, action,
}: {
  icon?: IconName
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="tp-empty">
      <div className="tp-empty-ic"><Icon name={icon} size={21} /></div>
      <div className="tp-empty-t">{title}</div>
      <div className="tp-empty-s">{children}</div>
      {action}
    </div>
  )
}

/**
 * The shape of what is coming, while it comes.
 *
 * Every tenant screen previously rendered the string "Loading..." centred in
 * 60vh. That both tells the tenant nothing and guarantees a layout jump, and on
 * the lease page it meant the most anxious question in the product ("how much
 * do I owe?") was answered by a blank screen for as long as two fetches took.
 */
export function PageSkeleton({ panel = true, cards = 3 }: { panel?: boolean; cards?: number }) {
  return (
    <div className="tp-wrap" aria-busy="true" aria-live="polite">
      <span style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
      }}>Loading your details</span>
      <div className="tp-sk tp-sk-line" style={{ width: '42%', height: 26, marginBottom: 20 }} />
      {panel && <div className="tp-sk tp-sk-panel" />}
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="tp-sk tp-sk-card" />
      ))}
    </div>
  )
}

/**
 * A tab whose state lives in the URL.
 *
 * The lease page's tabs were component state read from the query string once,
 * on mount. So the back button did nothing, a refresh dropped the tenant back
 * on Overview, and the tab they were reading could not be linked to — which
 * matters because support conversations about rent are conducted by sending
 * someone a link. `replaceState` rather than `push` for the write, so a tab
 * change does not pile history entries up between the tenant and the page they
 * arrived from; a `popstate` listener keeps the component in step when the
 * browser moves instead.
 */
export function useUrlTab<T extends string>(key: string, tabs: readonly T[], fallback: T) {
  /**
   * The query string is external state, so it is subscribed to rather than
   * copied into an effect. `replaceState` fires no event of its own, so our
   * own writes notify the same subscribers the browser's `popstate` does —
   * which is what keeps a tab press, a back press and a pasted link all
   * arriving at the component by one path.
   */
  const raw = useSyncExternalStore(
    subscribeToUrl,
    () => new URLSearchParams(window.location.search).get(key),
    // On the server there is no URL to read, so the first client render must
    // agree with the markup and correct itself on hydration.
    () => null,
  )
  const tab: T = tabs.includes(raw as T) ? (raw as T) : fallback

  const setTab = useCallback((next: T) => {
    const url = new URL(window.location.href)
    if (next === fallback) url.searchParams.delete(key)
    else url.searchParams.set(key, next)
    // Payment query params are consumed on arrival and must not be re-shared.
    url.searchParams.delete('pay')
    window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash)
    notifyUrlChanged()
  }, [key, fallback])

  return [tab, setTab] as const
}

/** Everything currently watching the query string. */
const urlWatchers = new Set<() => void>()

function subscribeToUrl(onChange: () => void) {
  urlWatchers.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    urlWatchers.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function notifyUrlChanged() {
  for (const w of urlWatchers) w()
}

/** The tab strip itself. Real buttons in a tablist, so arrow keys work. */
export function Tabs<T extends string>({
  tabs, active, onChange,
}: {
  tabs: { id: T; label: string; badge?: number }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="tp-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tp-tab${active === t.id ? ' on' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const i = tabs.findIndex(x => x.id === active)
            const next = e.key === 'ArrowRight'
              ? tabs[(i + 1) % tabs.length]
              : tabs[(i - 1 + tabs.length) % tabs.length]
            onChange(next.id)
          }}
        >
          {t.label}
          {/* Held back until the count is actually known — a "0" that becomes
              a "2" is worse than a tab that is briefly just a word. */}
          {t.badge != null && t.badge > 0 && <span className="tp-tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}
