'use client'

/**
 * Find anything in the money area by typing — ⌘K / Ctrl-K.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The hierarchy fixed *why* a payment plan was impossible to find: it had no
 * parent and no address. It does not fix the last mile. A landlord with forty
 * tenancies still has to open a property, find the lease, and read down a list
 * of names — three clicks and a scan to reach something they already knew the
 * name of.
 *
 * So: type three letters of a tenant, a building, a lease or a plan, and go
 * straight there. This is the single biggest day-to-day difference between
 * software a professional tolerates and software they like, and it is the piece
 * that makes the rest of the hierarchy feel fast rather than deep.
 *
 * ── Decisions worth knowing ────────────────────────────────────────────────
 *
 *   • **Tenants rank above everything.** A landlord opening this is thinking
 *     of a person far more often than a building, and the thing they want is
 *     almost never the thing with the shortest name.
 *   • **Money is on the row.** If Aleeya owes $830, that shows in the result
 *     list — so the palette answers the question *and* often removes the need
 *     to navigate at all.
 *   • **Matching is substring, not fuzzy.** Fuzzy matching on names produces
 *     confident nonsense ("ash" → "Washington"), and a landlord who sees one
 *     wrong result stops trusting the feature. Every match is a run of
 *     characters they actually typed, and it is highlighted.
 *   • **Sections are destinations too.** With an empty query it offers the five
 *     tabs, so ⌘K is also just "go somewhere" and is useful before the
 *     landlord has learned it searches.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtCurrency } from '@/lib/payments'
import { leaseHref, planHref, type MoneyTree } from '@/lib/financialsTree'
import Glyph, { type GlyphName } from '@/components/finance/Glyph'

type Item = {
  id: string
  group: 'Tenants' | 'Leases' | 'Properties' | 'Payment plans' | 'Go to'
  name: string
  sub: string
  href: string
  icon: GlyphName
  /** Right-hand figure, when the row has money worth showing. */
  fig?: string
  owed?: boolean
  /** Lower sorts first within a group. */
  rank: number
}

const SECTIONS: Item[] = [
  { id: 'go-overview',    group: 'Go to', name: 'Overview',    sub: 'Collection, arrears, what is coming', href: '/landlord/financials',             icon: 'bolt',     rank: 0 },
  { id: 'go-portfolio',   group: 'Go to', name: 'Portfolio',   sub: 'Property → lease → plan → tenant',    href: '/landlord/financials/portfolio',   icon: 'building', rank: 1 },
  { id: 'go-collections', group: 'Go to', name: 'Collections', sub: 'Who is behind, and what to do',       href: '/landlord/financials/collections', icon: 'alert',    rank: 2 },
  { id: 'go-trends',      group: 'Go to', name: 'Trends',      sub: 'Health over time — arrears, on-time share', href: '/landlord/financials/trends', icon: 'trend-up', rank: 3 },
  { id: 'go-cashflow',    group: 'Go to', name: 'Cash flow',   sub: 'When money arrives, and how reliably', href: '/landlord/financials/cashflow',   icon: 'wallet',   rank: 4 },
  { id: 'go-insights',    group: 'Go to', name: 'Insights',    sub: 'What the figures add up to',           href: '/landlord/financials/insights',   icon: 'bolt',     rank: 5 },
  { id: 'go-schedule',    group: 'Go to', name: 'Schedule',    sub: 'What falls due, month by month',      href: '/landlord/financials/schedule',    icon: 'calendar', rank: 6 },
  { id: 'go-payments',    group: 'Go to', name: 'Payments',    sub: 'What actually arrived',                href: '/landlord/financials/payments',    icon: 'check',    rank: 7 },
  { id: 'go-statement',   group: 'Go to', name: 'Statement',   sub: 'A printable owner statement',         href: '/landlord/financials/statement',   icon: 'mail',     rank: 8 },
  { id: 'go-new',         group: 'Go to', name: 'New payment plan', sub: 'Schedule rent against a lease',  href: '/landlord/financials/new',         icon: 'search',   rank: 9 },
]

const GROUP_ORDER: Item['group'][] = ['Tenants', 'Leases', 'Properties', 'Payment plans', 'Go to']

/** Everything in the portfolio, as searchable rows. */
function index(tree: MoneyTree): Item[] {
  const out: Item[] = []

  for (const p of tree.properties) {
    out.push({
      id: `prop-${p.propertyId}`,
      group: 'Properties',
      name: p.propertyName,
      sub: `${p.leases.length} lease${p.leases.length !== 1 ? 's' : ''} · ${
        p.payerCount} payer${p.payerCount !== 1 ? 's' : ''} · ${fmtCurrency(p.monthly)}/mo`,
      href: `/landlord/financials/portfolio#p-${p.propertyId}`,
      icon: 'building',
      fig: p.owed > 0 ? fmtCurrency(p.owed) : undefined,
      owed: p.owed > 0,
      rank: -p.owed,
    })
  }

  for (const l of tree.leases) {
    out.push({
      id: `lease-${l.key}`,
      group: 'Leases',
      name: `${l.propertyName} — ${l.label}`,
      sub: `${l.stageLabel} · ${l.activePayers} tenant${l.activePayers !== 1 ? 's' : ''} · ${
        fmtCurrency(l.monthly)}/mo${l.splitBilling ? ` · ${l.plans.length} plans` : ''}`,
      href: leaseHref(l.key),
      icon: 'calendar',
      fig: l.owed > 0 ? fmtCurrency(l.owed) : undefined,
      owed: l.owed > 0,
      rank: -l.owed,
    })

    // Plans are offered by name only when the tenancy has more than one —
    // otherwise the plan and the lease are the same thing and listing both is
    // two results for one object.
    if (l.splitBilling) {
      for (const pl of l.plans) {
        out.push({
          id: `plan-${pl.planId}`,
          group: 'Payment plans',
          name: `${pl.name} — ${pl.payers.map(x => x.name).join(', ')}`,
          sub: `${l.propertyName} · ${fmtCurrency(pl.monthly)}/mo · rent ledger`,
          href: planHref(pl.planId),
          icon: 'wallet',
          fig: pl.owed > 0 ? fmtCurrency(pl.owed) : undefined,
          owed: pl.owed > 0,
          rank: -pl.owed,
        })
      }
    }
  }

  const leaseOfPlan = new Map<string, string>()
  for (const l of tree.leases) for (const p of l.plans) leaseOfPlan.set(p.planId, l.key)

  for (const t of tree.payers) {
    const key = leaseOfPlan.get(t.planId)
    out.push({
      id: `payer-${t.planId}-${t.id}`,
      group: 'Tenants',
      name: t.name,
      sub: [
        t.email ?? 'no email',
        `${fmtCurrency(t.monthly)}/mo`,
        t.status !== 'active' ? (t.status === 'terminated' ? 'moved out' : 'finished') : null,
      ].filter(Boolean).join(' · '),
      href: key ? `${leaseHref(key)}?payer=${t.id}` : planHref(t.planId),
      icon: 'users',
      fig: t.owed > 0 ? fmtCurrency(t.owed) : undefined,
      owed: t.owed > 0,
      // Someone who owes money sorts above someone who does not; an ex-tenant
      // sorts below everyone.
      rank: (t.status === 'active' ? 0 : 1000) - t.owed,
    })
  }

  return out
}

/** The matched run, so the reader can see *why* a row matched. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/** How many rows the list shows. Beyond this, typing another letter is faster
 *  than scrolling, and the footer says so. */
const LIMIT = 24

/**
 * The palette is mounted only while it is open.
 *
 * That is the whole reason for the split: the query and the cursor reset
 * because the component is *new*, not because an effect reached in and cleared
 * them. A palette that remembers last week's query is one you have to clear
 * before you can use it, and resetting it from an effect means rendering the
 * stale state once first.
 */
export default function CommandPalette({
  tree, open, onClose,
}: {
  tree: MoneyTree
  open: boolean
  onClose: () => void
}) {
  if (!open) return null
  return <Palette tree={tree} onClose={onClose} />
}

function Palette({ tree, onClose }: { tree: MoneyTree; onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const all = useMemo(() => index(tree), [tree])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return SECTIONS
    const hits = [...all, ...SECTIONS].filter(i =>
      i.name.toLowerCase().includes(needle) || i.sub.toLowerCase().includes(needle))
    return hits
      .sort((a, b) => {
        // A match at the start of the name beats one in the middle, which beats
        // one that only matched the subtitle.
        const score = (i: Item) =>
          i.name.toLowerCase().startsWith(needle) ? 0
          : i.name.toLowerCase().includes(needle) ? 1
          : 2
        return score(a) - score(b)
          || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
          || a.rank - b.rank
          || a.name.localeCompare(b.name)
      })
      .slice(0, LIMIT)
  }, [q, all])

  // Focus the field, and stop the page behind from scrolling. Both are DOM
  // side effects on mount, which is what an effect is actually for.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [])

  // Keep the cursor row in view when it is driven by the keyboard.
  useEffect(() => {
    listRef.current?.querySelector('.fin-cmdk-item.on')
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Clamped at use rather than corrected by an effect: narrowing the list must
  // never leave the cursor pointing past the end of it, and the fix belongs in
  // the render that noticed, not in a second one.
  const active = Math.min(cursor, Math.max(0, results.length - 1))

  const go = (item: Item) => {
    onClose()
    router.push(item.href)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(results.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[active]
      if (item) go(item)
    }
  }

  // Grouped for display, but the cursor walks the flat list — so Down always
  // moves exactly one row regardless of where the headings fall.
  const grouped = GROUP_ORDER
    .map(g => ({ group: g, items: results.filter(r => r.group === g) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="fin fin-cmdk-wrap" role="dialog" aria-modal="true" aria-label="Find anything">
      <div className="fin-cmdk-scrim" onClick={onClose} />
      <div className="fin-cmdk" onKeyDown={onKey}>
        <div className="fin-cmdk-top">
          <Glyph name="search" size={17} />
          <input
            ref={inputRef}
            className="fin-cmdk-input"
            placeholder="Find a tenant, lease, property or plan…"
            value={q}
            onChange={e => { setQ(e.target.value); setCursor(0) }}
            aria-label="Search the portfolio"
            aria-controls="cmdk-results"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="fin-cmdk-esc" onClick={onClose}>esc</button>
        </div>

        <div className="fin-cmdk-list" id="cmdk-results" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="fin-cmdk-empty">
              Nothing matches &ldquo;{q.trim()}&rdquo;.<br />
              <span className="muted sm">
                Searching looks at tenant names and emails, lease and plan names, and properties.
              </span>
            </div>
          ) : grouped.map(g => (
            <div key={g.group}>
              <div className="fin-cmdk-group">{g.group}</div>
              {g.items.map(item => {
                const i = results.indexOf(item)
                return (
                  <button
                    key={item.id}
                    className={`fin-cmdk-item${i === active ? ' on' : ''}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(item)}
                  >
                    <span className="gl-plate sm"><Glyph name={item.icon} size={14} /></span>
                    <span className="ci-main">
                      <span className="ci-name"><Highlight text={item.name} q={q.trim()} /></span>
                      <span className="ci-sub">{item.sub}</span>
                    </span>
                    {item.fig && (
                      <span className={`ci-fig${item.owed ? ' owed' : ''}`}>
                        {item.fig}{item.owed ? ' overdue' : ''}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="fin-cmdk-foot">
          <span><kbd>↑↓</kbd>move</span>
          <span><kbd>↵</kbd>open</span>
          <span><kbd>esc</kbd>close</span>
          {results.length >= LIMIT && (
            <span style={{ marginLeft: 'auto' }}>
              showing the first {LIMIT} — keep typing to narrow
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The ⌘K listener, as a hook, so every money page opens the same palette.
 *
 * Deliberately ignores the shortcut while the landlord is typing in a field —
 * ⌘K inside a search box should not yank them out of it — and leaves the
 * browser's own ⌘K alone on pages that have not opted in.
 */
export function usePaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'k' || !(e.metaKey || e.ctrlKey)) return
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement
        || el instanceof HTMLTextAreaElement
        || (el instanceof HTMLElement && el.isContentEditable)
      if (typing) return
      e.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpen])
}
