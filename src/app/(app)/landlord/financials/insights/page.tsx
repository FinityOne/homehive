'use client'

/**
 * Insights — every signal, in full.
 *
 * ── Why this is a page and not a panel ─────────────────────────────────────
 *
 * The judgement layer can produce eleven signals, and on a portfolio with a
 * few problems it usually does. Eleven of them on the landing screen is a
 * wall, which is the exact fault this whole area has been working against: a
 * landlord arriving to find out whether anything is wrong should not have to
 * read a page to answer it.
 *
 * So the overview shows the worst three and nothing more. The rest live here,
 * and here they can be read properly — grouped by what they demand, each one
 * open, with the evidence visible rather than folded away.
 *
 * ── The grouping is the point ──────────────────────────────────────────────
 *
 * Severity in this product means money *and irreversibility*, not loudness. A
 * closing deposit window outranks a larger debt that is three days old because
 * one of them stops being fixable. Grouping by that makes the distinction
 * legible: the first group is what to do today, the second is this week, and
 * the third is a list of things that are merely true — uncollected fees, money
 * in flight, a property with no live lease — which a landlord should see
 * occasionally and never be nagged by.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMoney } from '@/lib/useMoney'
import { buildDashboard } from '@/lib/financialsDashboard'
import { signals, pulse, type Severity } from '@/lib/financialsSignals'
import MoneyHub from '@/components/finance/MoneyHub'
import Signals from '@/components/finance/Signals'
import Glyph, { GLYPH_CSS } from '@/components/finance/Glyph'
import CommandPalette, { usePaletteShortcut } from '@/components/finance/CommandPalette'
import { VIZ_CSS } from '@/components/finance/Charts'
import { FINANCE_THEME } from '@/lib/financeTheme'

/** The groups, in the order a manager works them. */
const GROUPS: {
  id: Severity
  title: string
  blurb: string
  icon: 'alert' | 'clock' | 'bolt' | 'check'
}[] = [
  {
    id: 'critical',
    title: 'Act today',
    blurb: 'Money at risk of becoming uncollectable, or a window that is closing.',
    icon: 'alert',
  },
  {
    id: 'warning',
    title: 'This week',
    blurb: 'Real problems with no deadline attached — the sooner the cheaper.',
    icon: 'clock',
  },
  {
    id: 'watch',
    title: 'Worth knowing',
    blurb: 'True, useful, and not urgent. Read these occasionally, not daily.',
    icon: 'bolt',
  },
  {
    id: 'good',
    title: 'Holding up',
    blurb: 'What is working, so the list is not only ever bad news.',
    icon: 'check',
  },
]

export default function InsightsPage() {
  const { plans, waivers, bounced, loading } = useMoney()
  const [find, setFind] = useState(false)
  usePaletteShortcut(useCallback(() => setFind(true), []))

  useEffect(() => { document.title = 'Insights — Financials | HomeHive' }, [])

  const d = useMemo(() => buildDashboard(plans, waivers), [plans, waivers])
  const all = useMemo(() => signals(d), [d])
  const p = useMemo(() => pulse(d, all), [d, all])

  const grouped = GROUPS
    .map(g => ({ ...g, items: all.filter(s => s.severity === g.id) }))
    .filter(g => g.items.length > 0)

  const acting = all.filter(s => s.severity === 'critical' || s.severity === 'warning').length

  return (
    <>
      <style>{FINANCE_THEME}{GLYPH_CSS}{VIZ_CSS}{CSS}</style>
      <div className="fin fin-wrap narrow">
        <MoneyHub
          tab="overview"
          crumbs={[
            { label: 'Financials', href: '/landlord/financials' },
            { label: 'Insights' },
          ]}
          title="Insights"
          sub="Everything the figures add up to, ranked by what it costs to ignore."
          onFind={() => setFind(true)}
          alarmCount={bounced}
          dueCount={d.owedPayers}
        />

        {loading ? (
          <div className="skeleton-hero" />
        ) : d.empty ? (
          <div className="empty">
            <div className="empty-title">Nothing to read yet</div>
            <p className="empty-sub">
              Insights are derived from the charges on your payment plans. Create one and this page
              starts telling you what the numbers mean.
            </p>
            <Link href="/landlord/financials/new" className="btn-primary">Create a payment plan</Link>
          </div>
        ) : (
          <>
            <section className={`pulse rise ${p.tone}`}>
              <div className="pulse-main">
                <div className="pulse-eyebrow">
                  <Glyph name={p.tone === 'critical' ? 'alert' : p.tone === 'warning' ? 'clock' : 'check'} size={13} />
                  {acting > 0
                    ? `${acting} thing${acting !== 1 ? 's' : ''} to act on`
                    : 'nothing demanding action'}
                </div>
                <h2 className="pulse-head">{p.headline}</h2>
                <p className="pulse-line">{p.line}</p>
              </div>
              {p.action && (
                <div className="pulse-act">
                  <Link className="btn-primary" href={p.action.href}>
                    {p.action.label}
                    <Glyph name="arrow-right" size={15} />
                  </Link>
                </div>
              )}
            </section>

            {grouped.map(g => (
              <div key={g.id} className="ins-group">
                <div className="ins-hd">
                  <span className={`gl-plate ${g.id}`}><Glyph name={g.icon} size={15} /></span>
                  <div>
                    <h2 className="ins-title">
                      {g.title}
                      <span className="ins-n">{g.items.length}</span>
                    </h2>
                    <p className="muted sm">{g.blurb}</p>
                  </div>
                </div>
                <Signals signals={g.items} title={g.title} />
              </div>
            ))}

            {/* How the ranking works, said once. A landlord who does not know
                why one row is above another cannot trust the order. */}
            <p className="ins-note">
              Ranked by money <strong>and</strong> irreversibility, not by size. A lease ending in
              three weeks with rent owed against a deposit you are still holding outranks a larger
              debt that is three days old — because one of them stops being fixable and the other
              does not. Every claim here is drawn from the charges on your own plans, and names the
              leases and people behind it.
            </p>
          </>
        )}
      </div>

      <CommandPalette tree={d.tree} open={find} onClose={() => setFind(false)} />
    </>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  .fin .ins-group { margin-bottom: 26px; }
  .fin .ins-hd {
    display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; padding: 0 2px;
  }
  .fin .ins-title {
    font-size: 16px; font-weight: 600; letter-spacing: -0.016em;
    display: flex; align-items: center; gap: 8px;
  }
  .fin .ins-n {
    font-size: 11.5px; font-weight: 600; background: var(--line-2); color: var(--ink-2);
    border-radius: 980px; padding: 1px 8px;
  }
  .fin .ins-group .card-hd { display: none; }
  .fin .ins-note {
    font-size: 12.5px; color: var(--ink-3); line-height: 1.7; max-width: 80ch;
    padding-top: 18px; border-top: 1px solid var(--line-2);
  }
  .fin .ins-note strong { color: var(--ink-2); }
`
