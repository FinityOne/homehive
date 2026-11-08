'use client'

/**
 * The landlord Overview — a deck, not a page.
 *
 * ── The constraint, and why it changes everything ──────────────────────────
 *
 * This screen must fit on the screen. No scrollbar, no fold, nothing below
 * it. That is not a styling note; it is the whole design, because the moment
 * a dashboard is allowed to be 2,500px tall it stops being a dashboard and
 * becomes a report that happens to open first. The previous version had seven
 * stacked bands and the landlord met four of them by scrolling — which means
 * the product decided, on their behalf, that arrears mattered more than
 * vacancy, because arrears was higher up.
 *
 * ── Switching instead of scrolling ─────────────────────────────────────────
 *
 * The content did not shrink; the navigation changed. The deck is:
 *
 *     ┌──────────────────────────────────────────────┬───────────────┐
 *     │ greeting · one-line state      scope  actions│               │
 *     ├──────────┬──────────┬──────────┬─────────────┤               │
 *     │   Rent   │ Occupancy│ Collected│    Leads    │   Needs your  │
 *     ├──────────┴──────────┴──────────┴─────────────┤   attention   │
 *     │                                              │               │
 *     │   one pane, filling the rest of the screen   │   (always on) │
 *     │                                              │               │
 *     └──────────────────────────────────────────────┴───────────────┘
 *
 * Five panes — Money, Demand, Properties, People, Traffic — hold exactly what
 * the seven bands held. Any one of them is one click away at all times, which
 * is strictly faster than scrolling to it was, and the chrome never moves.
 *
 * Three things make it work rather than merely fit:
 *
 *   • **The four figures are the navigation.** A stat tile is not a read-only
 *     tile with a link in its corner; it *is* the tab for the pane that
 *     explains it. Click the occupancy figure and you get the properties
 *     behind it. The selected tile is the filled green one, so the page
 *     always has exactly one focal point and that focal point is also a
 *     statement of where you are.
 *   • **Attention never moves.** The one band that must not be missed is a
 *     rail down the right-hand side, outside the switching. Whatever pane is
 *     open, the overdue rent and the invisible listing are still on screen.
 *   • **The panes are handed the leftover height, and the charts measure it.**
 *     Nothing is drawn at a fixed height and hoped for; see `useSize`. On a
 *     1080p laptop the collection chart is shorter than on a 27" monitor and
 *     both are correct, which is the thing a scrolling layout never has to
 *     solve and a deck cannot avoid.
 *
 * ── Where scrolling is still allowed ───────────────────────────────────────
 *
 * The *page* never scrolls. Two regions scroll inside themselves, and only
 * because their content is honestly a list with no natural end: the attention
 * rail, and the Traffic pane, which hosts the existing pulse report whole. A
 * chart or a summary that needed scrolling would be a layout bug.
 *
 * Below 1100px the deck unfolds back into a column and the page scrolls
 * normally. A phone cannot show five panes and a rail at once, and pretending
 * otherwise would mean five illegible ones.
 *
 * ── What is not here ───────────────────────────────────────────────────────
 *
 * The figures. They are all derived in `src/lib/overviewModel.ts`, which is
 * also what `npm run verify:overview` holds to account. This file lays them
 * out and nothing more.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/supabase'
import { getPropertiesByOwner, type Property } from '@/lib/properties'
import { getLeadsForOwner, type Lead } from '@/lib/leads'
import { getLeasesForOwner, formatLeaseDate, type Lease } from '@/lib/leases'
import { getPlansForOwner, fmtCurrency, type PaymentPlan } from '@/lib/payments'
import {
  buildOverview, overviewSignals, daysUntil, type Overview, type PropertyRow,
} from '@/lib/overviewModel'
import type { Signal } from '@/lib/financialsSignals'
import { FINANCE_THEME } from '@/lib/financeTheme'
import Glyph, { GLYPH_CSS, type GlyphName } from '@/components/finance/Glyph'
import { VIZ_CSS } from '@/components/finance/Charts'
import {
  TrendPill, StatusDot, GradientBars, PeriodSelect, PANEL_CSS, type BarPoint,
} from '@/components/finance/Panels'
import TrendArea, { TREND_AREA_CSS, type TrendPoint } from './TrendArea'
import { useSize } from './useSize'
import ListingPulse from './ListingPulse'

// ─── THE PANES ───────────────────────────────────────────────────────────────

type PaneId = 'money' | 'demand' | 'properties' | 'people' | 'traffic'

const PANES: { id: PaneId; label: string; sub: (o: Overview) => string }[] = [
  { id: 'money', label: 'Money',
    sub: () => 'Collected month by month, and what is still owed' },
  { id: 'demand', label: 'Demand',
    sub: () => 'Enquiries over time, and where they stall' },
  { id: 'properties', label: 'Properties',
    sub: o => `${o.properties.length} propert${o.properties.length !== 1 ? 'ies' : 'y'}, side by side` },
  { id: 'people', label: 'People',
    sub: () => 'The newest renters and the leases running now' },
  { id: 'traffic', label: 'Traffic',
    sub: () => 'Who is opening your listings, and what they do next' },
]

/** Which pane each stat tile opens. */
const TILE_PANE: Record<string, PaneId> = {
  rent: 'money', occupancy: 'properties', collected: 'money', leads: 'demand',
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '—'

const leadName = (l: Lead) =>
  [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email

/** Whole days since a timestamp, never negative. */
const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))

function greeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

/**
 * Enquiries bucketed for the chart: one point per day over 30, one per week
 * over 90.
 *
 * Ninety daily points on a 700px pane is seven pixels a point, which is noise
 * rather than a trend — the longer window is asking a coarser question and
 * gets a coarser bucket.
 */
function leadBuckets(leads: Lead[], range: 30 | 90): TrendPoint[] {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const stamps = leads
    .map(l => (l.created_at ? new Date(l.created_at).getTime() : null))
    .filter((t): t is number => t !== null)
  const between = (from: Date, to: Date) =>
    stamps.filter(t => t >= from.getTime() && t < to.getTime()).length

  const out: TrendPoint[] = []
  if (range === 30) {
    for (let i = 29; i >= 0; i--) {
      const day = new Date(start); day.setDate(day.getDate() - i)
      const next = new Date(day);  next.setDate(next.getDate() + 1)
      out.push({
        label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        longLabel: day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        value: between(day, next),
      })
    }
  } else {
    for (let i = 12; i >= 0; i--) {
      const from = new Date(start); from.setDate(from.getDate() - i * 7 - 6)
      const to   = new Date(start); to.setDate(to.getDate() - i * 7 + 1)
      out.push({
        label: from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        longLabel: `Week of ${from.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
        value: between(from, to),
      })
    }
  }
  return out
}

// ─── THE SCREEN ──────────────────────────────────────────────────────────────

export default function LandlordOverview() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [properties, setProperties] = useState<Property[]>([])
  const [leads, setLeads]   = useState<Lead[]>([])
  const [leases, setLeases] = useState<Lease[]>([])
  const [plans, setPlans]   = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)

  const [pane, setPane]   = useState<PaneId>('money')
  /**
   * Which tile is lit.
   *
   * Not derived from the pane: two tiles open Money, and deriving it lit them
   * both, which left the screen with two focal points and no answer to "where
   * am I". Picking a tile sets both; picking a pane from the switch sets the
   * tile that belongs to it, or none when the pane has no tile of its own.
   */
  const [tile, setTile]   = useState<string | null>('rent')

  const pickTile = useCallback((id: string) => {
    setTile(id)
    setPane(TILE_PANE[id])
  }, [])

  const pickPane = useCallback((p: PaneId) => {
    setPane(p)
    setTile(Object.keys(TILE_PANE).find(k => TILE_PANE[k] === p) ?? null)
  }, [])
  const [scope, setScope] = useState('all')
  const [span, setSpan]   = useState<'6m' | '12m'>('6m')
  const [range, setRange] = useState<30 | 90>(30)

  useEffect(() => { document.title = 'Overview — Landlord | HomeHive' }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }
      const [props, lds, lss, pls] = await Promise.all([
        getPropertiesByOwner(user.id),
        getLeadsForOwner(user.id),
        getLeasesForOwner(user.id),
        getPlansForOwner(user.id),
      ])
      if (cancelled) return
      setName(user.user_metadata?.full_name?.split(' ')[0] || 'there')
      setProperties(props)
      setLeads(lds)
      setLeases(lss)
      setPlans(pls)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [router])

  /**
   * 1–5 jump straight to a pane.
   *
   * A deck's whole promise is that nothing is more than one move away, and on
   * a keyboard a number key is a shorter move than finding the tab. Ignored
   * while a field has focus, so typing "3" into the leads search does not
   * throw the page to Properties.
   */
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = document.activeElement
    if (el instanceof HTMLElement &&
        (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
    const i = Number(e.key) - 1
    if (Number.isInteger(i) && i >= 0 && i < PANES.length) pickPane(PANES[i].id)
  }, [pickPane])
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  // The portfolio-wide answer, for the header and the stat tiles.
  const o = useMemo(
    () => buildOverview(properties, leads, leases, plans),
    [properties, leads, leases, plans],
  )

  // The same model again, narrowed — so a scoped pane is computed by exactly
  // the code that computes the unscoped one, rather than by a second filter
  // that drifts away from it.
  const s = useMemo(() => {
    if (scope === 'all') return o
    return buildOverview(
      properties.filter(p => p.slug === scope),
      leads.filter(l => l.property === scope),
      leases.filter(l => l.property?.slug === scope),
      plans.filter(p => p.property?.slug === scope),
    )
  }, [o, scope, properties, leads, leases, plans])

  const sigs = useMemo(() => overviewSignals(o), [o])

  const bars = useMemo<BarPoint[]>(() => {
    const take = span === '6m' ? 6 : 12
    return s.history.slice(-take).map(m => ({
      key: m.key,
      label: m.label,
      longLabel: m.longLabel,
      value: m.collected,
      rows: [
        { label: 'Collected', value: fmtCurrency(m.collected) },
        { label: 'Billed', value: fmtCurrency(m.billed) },
        ...(m.billed > m.collected
          ? [{ label: 'Still out', value: fmtCurrency(m.billed - m.collected) }] : []),
        ...(m.rate !== null ? [{ label: 'Rate', value: `${m.rate}%` }] : []),
      ],
    }))
  }, [s.history, span])

  const trend = useMemo(() => leadBuckets(s.leads, range), [s.leads, range])
  const trendTotal = trend.reduce((n, p) => n + p.value, 0)

  const scopeOptions = useMemo(
    () => [{ id: 'all', label: 'All properties' },
           ...properties.map(p => ({ id: p.slug, label: p.name }))],
    [properties],
  )

  const CSS_ALL = `${FINANCE_THEME}${GLYPH_CSS}${VIZ_CSS}${PANEL_CSS}${TREND_AREA_CSS}${LEGACY_CSS}${CSS}`
  const current = PANES.find(p => p.id === pane)!

  if (loading) {
    return (
      <>
        <style>{CSS_ALL}</style>
        <div className="fin deck">
          <div className="deck-top"><div className="skeleton" style={{ height: 38, width: 320 }} /></div>
          <div className="deck-kpis">
            {[0, 1, 2, 3].map(i => <div key={i} className="kpi-t"><div className="skeleton" style={{ height: 74 }} /></div>)}
          </div>
          <div className="deck-body"><div className="skeleton" style={{ height: '100%' }} /></div>
        </div>
      </>
    )
  }

  if (o.empty) {
    return (
      <>
        <style>{CSS_ALL}</style>
        <div className="fin deck deck-empty">
          <div className="empty">
            <div className="empty-title">{greeting(name)}.</div>
            <p className="empty-sub">
              It takes about five minutes to go live. Once a listing is up, this screen fills in
              on its own: who is looking at it, who enquired, who signed, and who has paid.
            </p>
            <Link href="/landlord/listings/new" className="btn-primary">Create your first listing</Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{CSS_ALL}</style>
      <div className="fin deck">

        {/* ══ HEADER ══ */}
        <header className="deck-top">
          <div className="deck-id">
            <h1 className="deck-title">{greeting(name)}.</h1>
            <p className="deck-line">
              {o.liveCount} live propert{o.liveCount !== 1 ? 'ies' : 'y'}
              {o.occupancyPct !== null && <> · {o.occupancyPct}% occupied</>}
              {' '}· {fmtCurrency(o.monthlyRevenue)} contracted a month
              {o.owed > 0 && <> · <span className="deck-flag">{fmtCurrency(o.owed)} past due</span></>}
            </p>
          </div>
          <div className="deck-act">
            {properties.length > 1 && (
              <PeriodSelect
                value={scope}
                options={scopeOptions}
                onChange={setScope}
                label="Property"
              />
            )}
            <Link className="btn-secondary" href="/landlord/financials">Financials</Link>
            <Link className="btn-primary" href="/landlord/listings/new">
              <Glyph name="building" size={15} />
              New listing
            </Link>
          </div>
        </header>

        {/* ══ THE FOUR FIGURES, WHICH ARE ALSO THE TABS ══ */}
        <div className="deck-kpis" role="tablist" aria-label="Overview">
          <KpiTile
            id="rent" active={tile} onPick={pickTile}
            icon="wallet"
            label="Contracted rent"
            value={fmtCurrency(o.monthlyRevenue)}
            sub={`${o.currentLeases.length} lease${o.currentLeases.length !== 1 ? 's' : ''} running`}
          />
          <KpiTile
            id="occupancy" active={tile} onPick={pickTile}
            icon="users"
            label="Occupancy"
            value={o.occupancyPct !== null ? `${o.occupancyPct}%` : '—'}
            sub={o.totalRooms > 0
              ? `${o.occupiedRooms} of ${o.totalRooms} rooms filled`
              : 'No rooms configured'}
            tone={o.occupancyPct !== null && o.occupancyPct < 60 ? 'warn' : undefined}
          />
          <KpiTile
            id="collected" active={tile} onPick={pickTile}
            icon="check"
            label={`Collected in ${o.monthLabel}`}
            value={fmtCurrency(o.pace.toDate)}
            sub={o.owed > 0
              ? `${fmtCurrency(o.owed)} past due`
              : o.collectionRate !== null
                ? `${o.collectionRate}% of ${fmtCurrency(o.monthBilled)} billed`
                : 'Nothing billed this month'}
            subTone={o.owed > 0 ? 'bad' : undefined}
            pill={o.pace.comparable
              ? <TrendPill pct={o.pace.deltaPct} basis={o.pace.basis} goodWhen="up" />
              : undefined}
          />
          <KpiTile
            id="leads" active={tile} onPick={pickTile}
            icon="bolt"
            label="Open leads"
            value={String(o.activeLeads)}
            sub={o.newLeads > 0
              ? `${o.newLeads} not contacted yet`
              : `${o.leadDelta.recent} in the last 30 days`}
            subTone={o.newLeads > 0 ? 'warn' : undefined}
            pill={<TrendPill pct={o.leadDelta.pct} basis={o.leadDelta.basis} goodWhen="up" />}
          />
        </div>

        {/* ══ PANE + RAIL ══ */}
        <div className="deck-body">
          <section className="pane" aria-live="polite">
            <div className="pane-hd">
              <div className="pane-id">
                <h2 className="pane-title">{current.label}</h2>
                <p className="pane-sub">{current.sub(s)}</p>
              </div>

              <div className="pane-tools">
                {pane === 'money' && (
                  <div className="seg sm pill" role="tablist" aria-label="Span">
                    {(['6m', '12m'] as const).map(v => (
                      <button
                        key={v} role="tab" aria-selected={span === v}
                        className={`seg-btn${span === v ? ' on' : ''}`}
                        onClick={() => setSpan(v)}
                      >{v === '6m' ? '6 months' : '12 months'}</button>
                    ))}
                  </div>
                )}
                {pane === 'demand' && (
                  <div className="seg sm pill" role="tablist" aria-label="Range">
                    {([30, 90] as const).map(r => (
                      <button
                        key={r} role="tab" aria-selected={range === r}
                        className={`seg-btn${range === r ? ' on' : ''}`}
                        onClick={() => setRange(r)}
                      >{r} days</button>
                    ))}
                  </div>
                )}

                <nav className="pane-switch" role="tablist" aria-label="Pane">
                  {PANES.map((p, i) => (
                    <button
                      key={p.id}
                      role="tab"
                      aria-selected={pane === p.id}
                      className={`pane-tab${pane === p.id ? ' on' : ''}`}
                      onClick={() => pickPane(p.id)}
                      title={`${p.label} — press ${i + 1}`}
                    >
                      {p.label}
                      <kbd>{i + 1}</kbd>
                    </button>
                  ))}
                </nav>
              </div>
            </div>

            <div className="pane-body">
              {pane === 'money'      && <MoneyPane o={s} bars={bars} span={span} router={router} />}
              {pane === 'demand'     && <DemandPane o={s} trend={trend} total={trendTotal} range={range} />}
              {pane === 'properties' && <PropertiesPane o={s} />}
              {pane === 'people'     && <PeoplePane o={s} properties={properties} router={router} />}
              {pane === 'traffic'    && (
                <div className="pane-scroll">
                  <ListingPulse slug={scope === 'all' ? null : scope} />
                </div>
              )}
            </div>
          </section>

          <aside className="rail">
            <div className="rail-hd">
              <h2 className="rail-title">Needs your attention</h2>
              <span className="rail-count">{sigs.length}</span>
            </div>

            <div className="rail-list">
              {sigs.length === 0 ? (
                <p className="rail-clear">
                  <Glyph name="check" size={16} />
                  Nothing is wrong. Every room is let, every charge is paid, and every
                  listing is live.
                </p>
              ) : sigs.map(sig => <RailSignal key={sig.id} sig={sig} />)}
            </div>

            <div className="rail-ft">
              <RailGo icon="calendar" label="Leases" stat={String(o.currentLeases.length)}
                href="/landlord/leases" />
              <RailGo icon="clock" label="Renewals"
                stat={o.expiring.length > 0 ? `${daysUntil(o.expiring[0].lease.end_date)}d` : '—'}
                href="/landlord/renewals" />
              <RailGo icon="building" label="Listings" stat={`${o.liveCount}/${o.properties.length}`}
                href="/landlord/listings" />
              <RailGo icon="trend-up" label="Insights"
                stat={o.collectionRate !== null ? `${o.collectionRate}%` : '—'}
                href="/landlord/performance" />
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

// ─── PANES ───────────────────────────────────────────────────────────────────

function MoneyPane({
  o, bars, span, router,
}: {
  o: Overview
  bars: BarPoint[]
  span: '6m' | '12m'
  router: ReturnType<typeof useRouter>
}) {
  // The bar chart is HTML rather than SVG, but it still has to be told a pixel
  // height — it has no intrinsic one, and a percentage height inside a flex
  // child resolves against nothing.
  const [box, { h }] = useSize<HTMLDivElement>()
  const collected = bars.reduce((n, b) => n + b.value, 0)

  return (
    <div className="split">
      <div className="split-main">
        <div className="figrow">
          <Fig label={`Collected over ${bars.length} months`} value={fmtCurrency(collected)} />
          <Fig label="Billed this month" value={fmtCurrency(o.monthBilled)} />
          <Fig label="Outstanding now" value={fmtCurrency(o.owed)} tone={o.owed > 0 ? 'bad' : undefined} />
        </div>
        <div className="chartbox" ref={box}>
          {collected === 0 ? (
            <p className="muted">
              No rent has been collected on these leases yet. Money a tenant pays online lands
              here the moment it settles, and anything you record by hand appears too.
            </p>
          ) : h > 60 && (
            <GradientBars
              points={bars}
              height={h}
              onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
            />
          )}
        </div>
      </div>

      <div className="split-side">
        <h3 className="side-title">
          {o.arrears.length > 0 ? 'Who is behind' : 'Nobody is behind'}
        </h3>
        <div className="side-list">
          {o.arrears.length === 0 ? (
            <p className="muted sm">
              Every charge that has come due has been settled. The chart shows the {span === '6m' ? 'six' : 'twelve'} months
              behind that.
            </p>
          ) : o.arrears.map(a => (
            <Link key={a.planId} className="srow" href={`/landlord/financials/plan/${a.planId}`}>
              <span className="srow-badge">{initials(a.who)}</span>
              <span className="srow-main">
                <span className="srow-name">{a.who}</span>
                <span className="srow-sub">{a.propertyName} · {a.count} charge{a.count !== 1 ? 's' : ''}</span>
              </span>
              <span className="srow-fig bad">{fmtCurrency(a.owed)}</span>
            </Link>
          ))}
        </div>
        <Link className="btn-secondary sm full" href="/landlord/financials/collections">
          Work collections
        </Link>
      </div>
    </div>
  )
}

function DemandPane({
  o, trend, total, range,
}: {
  o: Overview
  trend: TrendPoint[]
  total: number
  range: 30 | 90
}) {
  const widest = Math.max(1, ...o.funnel.map(f => f.count))
  const read = useMemo(() => readShape(trend, range), [trend, range])
  // Oldest first: the enquiry that has been sitting longest is the one about
  // to go cold, and a list sorted newest-first hides it at the bottom.
  const waiting = useMemo(
    () => o.leads
      .filter(l => l.status === 'new')
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
      .slice(0, 3),
    [o.leads],
  )

  return (
    <div className="split">
      <div className="split-main">
        <div className="figrow">
          <Fig label={`Enquiries in ${range} days`} value={String(total)} />
          <Fig label="Not yet contacted" value={String(o.newLeads)}
            tone={o.newLeads > 0 ? 'warn' : undefined} />
          <Fig label="Qualified" value={String(o.qualifiedLeads)} />
        </div>
        {total === 0 ? (
          <p className="muted">
            No enquiries in this window. Traffic says whether anyone is reaching the listing at
            all — a flat line here with views there is a listing problem, and a flat line in
            both is a reach problem.
          </p>
        ) : (
          <>
            {/* Daily counts are bars; the 90-day window is weekly totals,
                which is a rate and gets the curve. See TrendArea's note. */}
            <TrendArea points={trend} unit="lead" shape={range === 30 ? 'bars' : 'area'} />
            {/* What the shape cannot say on its own. A run of empty columns
                reads as "quiet"; only a number says whether quiet means three
                days or three weeks, which is the difference between patience
                and a problem. */}
            <div className="figrow bot">
              <Fig label="Busiest" value={read.busiest} />
              <Fig label="Since the last one" value={read.sinceLast}
                tone={read.staleDays >= 7 ? 'warn' : undefined} />
              <Fig label="Longest quiet run" value={read.quietRun} />
            </div>

            {/* The leftover height goes to the one thing a demand screen can
                actually be acted on: the renters who have written in and not
                been answered. A chart tells a landlord how they are doing; a
                name and a phone number is what changes it. Absent when the
                queue is empty, so the chart takes the room back. */}
            {waiting.length > 0 && (
              <div className="waiting">
                <h4 className="waiting-hd">
                  Waiting on you
                  <span className="waiting-n">{o.newLeads}</span>
                </h4>
                <div className="waiting-list">
                  {waiting.map(l => (
                    <Link key={l.id} className="srow" href={`/landlord/leads/${l.id}`}>
                      <span className="srow-badge">{initials(leadName(l))}</span>
                      <span className="srow-main">
                        <span className="srow-name">{leadName(l)}</span>
                        <span className="srow-sub">
                          {l.email}
                          {l.move_in_date && ` · moving in ${formatLeaseDate(l.move_in_date)}`}
                        </span>
                      </span>
                      <span className="srow-fig warn">
                        {l.created_at ? `${daysSince(l.created_at)}d` : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="split-side">
        <h3 className="side-title">Where they stall</h3>
        <div className="fnl">
          {o.funnel.map(f => (
            <div key={f.stage} className="fnl-row">
              <span className="fnl-lbl">{f.label}</span>
              <span className="fnl-track">
                <span
                  className={`fnl-fill${f.count === 0 ? ' empty' : ''}`}
                  style={{ width: `${f.count === 0 ? 0 : Math.max(3, (f.count / widest) * 100)}%` }}
                />
              </span>
              <span className="fnl-n">{f.count}</span>
            </div>
          ))}
        </div>

        <div className="mix">
          {o.statusMix.map(m => (
            <span key={m.label} className="mix-item">
              <i style={{ background: m.color }} aria-hidden="true" />
              {m.label}
              <em>{m.count}</em>
            </span>
          ))}
        </div>

        <Link className="btn-secondary sm full" href="/landlord/leads/list">Open the pipeline</Link>
      </div>
    </div>
  )
}

/**
 * The three facts a bar chart of arrivals does not show.
 *
 * All three are counted in *buckets*, not days, so they stay true when the
 * 90-day window switches the bucket to a week — "3 weeks" is the honest
 * reading of three empty weekly columns, and calling it "21 days" would be
 * claiming a precision the bucketing threw away.
 */
function readShape(points: TrendPoint[], range: 30 | 90) {
  const unit = range === 30 ? 'day' : 'week'
  const plural = (n: number) => `${n} ${unit}${n !== 1 ? 's' : ''}`

  const peak = Math.max(0, ...points.map(p => p.value))
  const busiestAt = points.findLast?.(p => p.value === peak) ?? null

  let sinceLast = -1
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value > 0) { sinceLast = points.length - 1 - i; break }
  }

  let run = 0, longest = 0
  for (const p of points) {
    run = p.value > 0 ? 0 : run + 1
    longest = Math.max(longest, run)
  }

  return {
    busiest: peak > 0 && busiestAt
      ? `${busiestAt.label} · ${peak}`
      : '—',
    sinceLast: sinceLast < 0 ? 'None yet' : sinceLast === 0 ? `Today` : plural(sinceLast),
    staleDays: sinceLast < 0 ? 999 : range === 30 ? sinceLast : sinceLast * 7,
    quietRun: longest === 0 ? 'None' : plural(longest),
  }
}

function PropertiesPane({ o }: { o: Overview }) {
  return (
    <div className="pane-scroll">
      <div className="peers">
        {o.properties.map(p => <Peer key={p.id} p={p} />)}
      </div>
    </div>
  )
}

function Peer({ p }: { p: PropertyRow }) {
  const filled = p.totalRooms - p.vacantRooms
  const pct = p.occupancyPct
  return (
    <Link className="peer" href={`/landlord/listings/${p.slug}`}>
      <div className="peer-hd">
        <span className="peer-badge">{initials(p.name)}</span>
        <span className="peer-name">{p.name}</span>
      </div>
      <div className="peer-fig">{p.monthly > 0 ? `${fmtCurrency(p.monthly)}/mo` : fmtCurrency(p.price)}</div>
      <div className="peer-cap">
        {p.totalRooms > 0 ? `${filled} of ${p.totalRooms} rooms filled` : 'No rooms configured'}
      </div>
      {pct !== null && (
        <span className="peer-bar">
          <span
            className={`peer-fill${pct >= 80 ? ' good' : pct >= 50 ? ' warn' : ' bad'}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
      <StatusDot tone={peerTone(p)}>{PEER_STATUS[p.state](p)}</StatusDot>
    </Link>
  )
}

function PeoplePane({
  o, properties, router,
}: {
  o: Overview
  properties: Property[]
  router: ReturnType<typeof useRouter>
}) {
  return (
    <div className="split">
      <div className="split-main pane-scroll">
        <table className="tbl roomy">
          <thead>
            <tr>
              <th>Renter</th>
              <th>Property</th>
              <th>Enquired</th>
              <th>Moving in</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {o.leads.length === 0 ? (
              <tr><td colSpan={5} className="muted">No leads on this scope yet.</td></tr>
            ) : o.leads.slice(0, 40).map(l => {
              const prop = properties.find(p => p.slug === l.property)
              const stage = STAGE_VIEW[l.status] ?? { label: l.status, tone: 'idle' as const }
              return (
                <tr key={l.id} className="click" onClick={() => router.push(`/landlord/leads/${l.id}`)}>
                  <td>
                    <span className="at-who">
                      <span className="at-avatar">{initials(leadName(l))}</span>
                      <span>
                        <span className="at-name">{leadName(l)}</span>
                        <span className="at-sub">{l.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>{prop?.name ?? l.property ?? '—'}</td>
                  <td>{l.created_at
                    ? new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '—'}</td>
                  <td>{l.move_in_date ? formatLeaseDate(l.move_in_date) : '—'}</td>
                  <td><StatusDot tone={stage.tone}>{stage.label}</StatusDot></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="split-side">
        <h3 className="side-title">Leases running now</h3>
        <div className="side-list">
          {o.currentLeases.length === 0 ? (
            <p className="muted sm">No lease is running on this scope.</p>
          ) : o.currentLeases.slice(0, 8).map(l => {
            const days = daysUntil(l.end_date)
            const who = l.tenants.map(t => t.name).filter(Boolean).join(', ') || 'No tenant'
            return (
              <Link key={l.id} className="srow" href={`/landlord/leases/${l.id}`}>
                <span className="srow-badge">{initials(who)}</span>
                <span className="srow-main">
                  <span className="srow-name">{who}</span>
                  <span className="srow-sub">{l.property?.name} · ends {formatLeaseDate(l.end_date)}</span>
                </span>
                <span className={`srow-fig${days <= 60 ? ' warn' : ''}`}>{days}d</span>
              </Link>
            )
          })}
        </div>
        <Link className="btn-secondary sm full" href="/landlord/renewals">Send renewals</Link>
      </div>
    </div>
  )
}

// ─── PIECES ──────────────────────────────────────────────────────────────────

function KpiTile({
  id, active, onPick, icon, label, value, sub, subTone, pill, tone,
}: {
  id: string
  active: string | null
  onPick: (id: string) => void
  icon: GlyphName
  label: string
  value: string
  sub: string
  subTone?: 'bad' | 'warn'
  pill?: React.ReactNode
  tone?: 'warn'
}) {
  const on = active === id
  return (
    <button
      role="tab"
      aria-selected={on}
      className={`kpi-t${on ? ' on' : ''}${tone && !on ? ' ' + tone : ''}`}
      onClick={() => onPick(id)}
    >
      <span className="kpi-t-top">
        <span className="kpi-t-icon"><Glyph name={icon} size={16} /></span>
        <span className="kpi-t-label">{label}</span>
      </span>
      <span className="kpi-t-fig">
        <span className="kpi-t-value">{value}</span>
        {pill}
      </span>
      <span className={`kpi-t-sub${subTone && !on ? ' ' + subTone : ''}`}>{sub}</span>
    </button>
  )
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <span className="fig">
      <span className="fig-label">{label}</span>
      <span className={`fig-value${tone ? ' ' + tone : ''}`}>{value}</span>
    </span>
  )
}

/**
 * A signal on the rail.
 *
 * Deliberately not the money area's `Signals` component: that one is an
 * expanding list built for a full-width card, and the rail is 300px with a
 * fixed height. The claim, one line of why, and the way to act on it are what
 * survive the narrowing — the evidence list is what Insights is for.
 */
function RailSignal({ sig }: { sig: Signal }) {
  return (
    <Link className={`rsig ${sig.severity}`} href={sig.action.href}>
      <span className="gl-plate"><Glyph name={sig.icon} size={14} /></span>
      <span className="rsig-main">
        <span className="rsig-title">{sig.title}</span>
        <span className="rsig-detail">{sig.detail}</span>
        <span className="rsig-go">{sig.action.label} →</span>
      </span>
    </Link>
  )
}

function RailGo({
  icon, label, stat, href,
}: {
  icon: GlyphName
  label: string
  stat: string
  href: string
}) {
  return (
    <Link className="rgo" href={href}>
      <Glyph name={icon} size={14} />
      <span className="rgo-label">{label}</span>
      <span className="rgo-stat">{stat}</span>
    </Link>
  )
}

/** A peer card's one-line state. Money owed outranks everything else. */
const PEER_STATUS: Record<string, (p: PropertyRow) => string> = {
  live:     p => p.owed > 0 ? `${fmtCurrency(p.owed)} overdue`
              : p.vacantRooms > 0 ? `${p.vacantRooms} room${p.vacantRooms !== 1 ? 's' : ''} empty`
              : 'Full and current',
  unpaid:   () => 'Not published',
  rented:   p => p.owed > 0 ? `${fmtCurrency(p.owed)} overdue` : 'Rented out',
  inactive: () => 'Switched off',
  pending:  () => 'Awaiting review',
  rejected: () => 'Rejected',
}

const PEER_STATE_TONE: Record<string, 'good' | 'bad' | 'warn' | 'idle'> = {
  live: 'good', unpaid: 'warn', rented: 'idle',
  inactive: 'idle', pending: 'warn', rejected: 'bad',
}

/**
 * The tone has to follow the *words*, not the listing state.
 *
 * Keyed on the state alone, a live property owing $1,700 printed "overdue" in
 * green, because live is a healthy state. Colour and label disagreeing is the
 * one thing the area's palette rule forbids — and on the row where it
 * happened, it told a landlord that money they are owed is fine.
 */
function peerTone(p: PropertyRow): 'good' | 'bad' | 'warn' | 'idle' {
  if (p.owed > 0) return 'bad'
  if (p.state === 'live' && p.vacantRooms > 0) return 'warn'
  return PEER_STATE_TONE[p.state]
}

/** A lead status as the table shows it. Colour never carries it alone. */
const STAGE_VIEW: Record<string, { label: string; tone: 'good' | 'bad' | 'warn' | 'idle' }> = {
  new:            { label: 'New',            tone: 'warn' },
  contacted:      { label: 'Contacted',      tone: 'idle' },
  follow_up:      { label: 'Follow-up',      tone: 'warn' },
  engaged:        { label: 'Engaged',        tone: 'good' },
  qualified:      { label: 'Qualified',      tone: 'good' },
  tour_scheduled: { label: 'Qualified',      tone: 'good' },
  matching:       { label: 'Roommate match', tone: 'good' },
  cold:           { label: 'Cold',           tone: 'idle' },
  closed:         { label: 'Closed',         tone: 'idle' },
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

  /* ── The deck ─────────────────────────────────────────────────────────────
     One screen, three rows, the last one taking whatever is left. 56px is the
     app's top bar; dvh rather than vh so an iPad's collapsing browser chrome
     does not leave the last row cut off. */
  .fin.deck {
    height: calc(100dvh - 56px);
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 12px;
    padding: 16px 20px 18px;
    overflow: hidden;
  }
  .fin.deck.deck-empty { display: grid; place-items: center; }

  /* ── Header ───────────────────────────────────────────────────────────── */
  .fin .deck-top {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; flex-wrap: wrap;
  }
  .fin .deck-id { min-width: 0; }
  .fin .deck-title { font-size: 21px; font-weight: 600; letter-spacing: -0.028em; line-height: 1.2; }
  .fin .deck-line { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; letter-spacing: -0.01em; }
  .fin .deck-flag { color: var(--late); font-weight: 500; }
  .fin .deck-act { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }

  /* ── The four figures, which are the tabs ─────────────────────────────── */
  .fin .deck-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .fin .kpi-t {
    display: flex; flex-direction: column; align-items: stretch; gap: 7px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 13px 15px; text-align: left; cursor: pointer; font-family: inherit;
    color: inherit; min-width: 0;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease),
                background 0.15s var(--ease);
  }
  .fin .kpi-t:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  /* The selected tile is the one filled card on the screen: it is both the
     focal point and the statement of which pane is open. */
  .fin .kpi-t.on {
    background: linear-gradient(152deg, #15854a 0%, #0f7a43 46%, #0c6a3a 100%);
    border-color: transparent; color: #fff;
  }
  .fin .kpi-t.on:hover { box-shadow: 0 10px 30px rgba(15,122,67,0.26); }
  .fin .kpi-t-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .fin .kpi-t-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0;
    background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line-2);
  }
  .fin .kpi-t.on .kpi-t-icon {
    background: rgba(255,255,255,0.18); color: #fff; border-color: rgba(255,255,255,0.22);
  }
  .fin .kpi-t.warn .kpi-t-icon { background: var(--fee-bg); color: var(--fee); border-color: var(--fee-line); }
  .fin .kpi-t-label {
    font-size: 12.5px; font-weight: 500; letter-spacing: -0.012em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .kpi-t-fig { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
  .fin .kpi-t-value {
    font-size: 25px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .fin .kpi-t-sub {
    font-size: 11.5px; color: var(--ink-3); letter-spacing: -0.005em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .kpi-t-sub.bad  { color: var(--late); }
  .fin .kpi-t-sub.warn { color: var(--fee); }
  .fin .kpi-t.on .kpi-t-sub { color: rgba(255,255,255,0.76); }

  /* ── Pane and rail ────────────────────────────────────────────────────── */
  .fin .deck-body {
    display: grid; grid-template-columns: minmax(0, 1fr) 312px; gap: 12px;
    min-height: 0;
  }
  .fin .pane {
    display: flex; flex-direction: column; min-height: 0; min-width: 0;
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 15px 18px 16px;
  }
  .fin .pane-hd {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 14px; flex-wrap: wrap; margin-bottom: 13px; flex-shrink: 0;
  }
  .fin .pane-title { font-size: 16px; font-weight: 600; letter-spacing: -0.018em; }
  .fin .pane-sub { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
  .fin .pane-tools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

  .fin .pane-switch {
    display: inline-flex; background: var(--line-2); border-radius: 980px; padding: 2px; gap: 2px;
  }
  .fin .pane-tab {
    display: inline-flex; align-items: center; gap: 6px;
    border: none; background: none; cursor: pointer; font-family: inherit;
    font-size: 12.5px; color: var(--ink-2); padding: 6px 11px; border-radius: 980px;
    letter-spacing: -0.01em; transition: background 0.14s, color 0.14s;
  }
  .fin .pane-tab:hover { color: var(--ink); }
  .fin .pane-tab.on { background: var(--surface); color: var(--ink); font-weight: 500; }
  /* The shortcut is a hint, not a control: visible enough to be learned,
     quiet enough to ignore, and gone on a touch screen where it is a lie. */
  .fin .pane-tab kbd {
    font: inherit; font-size: 10px; color: var(--ink-3);
    border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; line-height: 15px;
    background: var(--surface);
  }
  .fin .pane-tab.on kbd { border-color: var(--line-2); }
  @media (hover: none) { .fin .pane-tab kbd { display: none; } }

  .fin .pane-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* The two regions allowed to scroll inside themselves — a list with no
     natural end, never a chart. */
  .fin .pane-scroll { flex: 1; min-height: 0; overflow-y: auto; }

  /* ── A pane's main/side split ─────────────────────────────────────────── */
  .fin .split {
    flex: 1; min-height: 0;
    display: grid; grid-template-columns: minmax(0, 1fr) 286px; gap: 18px;
  }
  .fin .split-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .fin .split-side {
    display: flex; flex-direction: column; min-height: 0; gap: 10px;
    border-left: 1px solid var(--line-2); padding-left: 18px;
  }
  .fin .side-title { font-size: 12.5px; font-weight: 600; letter-spacing: -0.012em; }
  .fin .side-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .fin .btn-secondary.full { justify-content: center; width: 100%; flex-shrink: 0; }

  .fin .chartbox { flex: 1; min-height: 0; }
  /* GradientBars divides its width evenly between the columns, which is right
     in the money area's narrower panels and wrong on a full-bleed pane: six
     months across 800px gives 130px slabs that read as blocks of colour
     rather than as measurements. Capping the column and centring the group
     keeps a bar a bar at any width, and at twelve months the cap never binds
     so the chart still fills the pane. */
  .fin .gb-cols { justify-content: center; }
  .fin .gb-col { max-width: 84px; }

  /* ── The figure strip above a chart ───────────────────────────────────── */
  .fin .figrow {
    display: flex; gap: 26px; flex-wrap: wrap; margin-bottom: 10px; flex-shrink: 0;
  }
  .fin .figrow.bot {
    margin: 0; padding-top: 12px; border-top: 1px solid var(--line-2);
  }

  /* Takes the height the chart's cap left behind, and gives it back when
     there is nobody waiting. */
  .fin .waiting {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-2);
  }
  .fin .waiting-hd {
    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    font-size: 12.5px; font-weight: 600; letter-spacing: -0.012em; margin-bottom: 6px;
  }
  .fin .waiting-n {
    font-size: 11px; font-weight: 600; color: var(--fee); background: var(--fee-bg);
    border-radius: 980px; padding: 1px 7px; font-variant-numeric: tabular-nums;
  }
  .fin .waiting-list { flex: 1; min-height: 0; overflow-y: auto; }
  .fin .fig { display: flex; flex-direction: column; gap: 1px; }
  .fin .fig-label { font-size: 11.5px; color: var(--ink-3); letter-spacing: -0.005em; }
  .fin .fig-value {
    font-size: 19px; font-weight: 600; letter-spacing: -0.024em;
    font-variant-numeric: tabular-nums;
  }
  .fin .fig-value.bad  { color: var(--late); }
  .fin .fig-value.warn { color: var(--fee); }

  /* ── A row in a side list ─────────────────────────────────────────────── */
  .fin .srow {
    display: flex; align-items: center; gap: 10px; padding: 8px 9px;
    border-radius: 11px; text-decoration: none; color: inherit; min-width: 0;
    transition: background 0.13s;
  }
  .fin .srow:hover { background: var(--surface-2); }
  .fin .srow-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink);
    font-size: 10px; font-weight: 700;
  }
  .fin .srow-main { flex: 1; min-width: 0; }
  .fin .srow-name {
    display: block; font-size: 12.5px; font-weight: 500; letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .srow-sub {
    display: block; font-size: 11px; color: var(--ink-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .srow-fig {
    font-size: 12.5px; font-weight: 600; flex-shrink: 0;
    font-variant-numeric: tabular-nums; color: var(--ink-2);
  }
  .fin .srow-fig.bad  { color: var(--late); }
  .fin .srow-fig.warn { color: var(--fee); }

  /* ── The funnel, as rows ──────────────────────────────────────────────── */
  .fin .fnl { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
  .fin .fnl-row { display: flex; align-items: center; gap: 10px; }
  .fin .fnl-lbl { width: 70px; flex-shrink: 0; font-size: 12px; color: var(--ink-2); }
  .fin .fnl-track {
    flex: 1; min-width: 0; height: 20px; border-radius: 7px;
    background: var(--surface-2); border: 1px solid var(--line-2); overflow: hidden;
  }
  .fin .fnl-fill {
    display: block; height: 100%; border-radius: 6px;
    background: linear-gradient(90deg, #178d4e 0%, #0f7a43 100%);
    transition: width 0.4s var(--ease);
  }
  .fin .fnl-fill.empty { background: none; }
  .fin .fnl-n {
    width: 26px; flex-shrink: 0; text-align: right; font-size: 13px; font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .fin .mix {
    display: flex; flex-wrap: wrap; gap: 6px 14px; padding-top: 11px;
    border-top: 1px solid var(--line-2); flex: 1; align-content: flex-start;
    overflow-y: auto; min-height: 0;
  }
  .fin .mix-item { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-2); }
  .fin .mix-item i { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .fin .mix-item em { font-style: normal; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }

  /* ── Properties as peers ──────────────────────────────────────────────── */
  .fin .peers {
    display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(226px, 1fr));
    align-content: start;
  }
  .fin .peer {
    display: flex; flex-direction: column; gap: 5px;
    background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 14px;
    padding: 13px 14px; text-decoration: none; color: inherit; min-width: 0;
    transition: border-color 0.15s, background 0.15s;
  }
  .fin .peer:hover { border-color: var(--line); background: var(--surface); }
  .fin .peer-hd { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .fin .peer-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent-bg); color: var(--accent-ink); font-size: 10px; font-weight: 700;
  }
  .fin .peer-name {
    flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fin .peer-fig {
    font-size: 19px; font-weight: 600; letter-spacing: -0.024em; margin-top: 4px;
    font-variant-numeric: tabular-nums;
  }
  .fin .peer-cap { font-size: 11px; color: var(--ink-3); }
  .fin .peer-bar {
    display: block; height: 6px; border-radius: 99px; background: var(--line-2);
    overflow: hidden; margin: 3px 0 2px;
  }
  .fin .peer-fill { display: block; height: 100%; border-radius: 99px; }
  .fin .peer-fill.good { background: var(--in); }
  .fin .peer-fill.warn { background: var(--fee); }
  .fin .peer-fill.bad  { background: var(--late); }

  /* ── The attention rail ───────────────────────────────────────────────── */
  .fin .rail {
    display: flex; flex-direction: column; min-height: 0; gap: 10px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    padding: 15px 14px 14px;
  }
  .fin .rail-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-shrink: 0; }
  .fin .rail-title { font-size: 14px; font-weight: 600; letter-spacing: -0.015em; }
  .fin .rail-count {
    font-size: 11.5px; color: var(--ink-2); background: var(--line-2);
    border-radius: 980px; padding: 1px 8px; font-variant-numeric: tabular-nums;
  }
  .fin .rail-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .fin .rail-clear {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 12.5px; color: var(--in); line-height: 1.55; padding: 6px 2px;
  }

  .fin .rsig {
    display: flex; align-items: flex-start; gap: 10px; padding: 10px 10px 11px;
    border-radius: 13px; text-decoration: none; color: inherit;
    background: var(--surface-2); border: 1px solid var(--line-2);
    transition: border-color 0.14s, background 0.14s;
  }
  .fin .rsig:hover { background: var(--surface); border-color: var(--line); }
  /* The severity lives on the left edge, so three stacked signals read as a
     ranked list without three competing tinted backgrounds. */
  .fin .rsig.critical { border-left: 3px solid var(--late); }
  .fin .rsig.warning  { border-left: 3px solid var(--fee); }
  .fin .rsig.watch    { border-left: 3px solid var(--line); }
  .fin .rsig.good     { border-left: 3px solid var(--in); }
  .fin .rsig-main { min-width: 0; }
  .fin .rsig-title { display: block; font-size: 12.5px; font-weight: 600; letter-spacing: -0.012em; line-height: 1.35; }
  .fin .rsig-detail {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    font-size: 11.5px; color: var(--ink-2); line-height: 1.5; margin-top: 3px;
  }
  .fin .rsig-go { display: block; font-size: 11.5px; color: var(--accent); font-weight: 500; margin-top: 5px; }

  .fin .rail-ft {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex-shrink: 0;
    padding-top: 11px; border-top: 1px solid var(--line-2);
  }
  .fin .rgo {
    display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 10px;
    text-decoration: none; color: var(--ink-2); font-size: 11.5px; min-width: 0;
    transition: background 0.13s, color 0.13s;
  }
  .fin .rgo:hover { background: var(--surface-2); color: var(--ink); }
  .fin .rgo-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fin .rgo-stat {
    font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums;
    flex-shrink: 0; font-size: 11.5px;
  }

  /* ── Narrower screens ─────────────────────────────────────────────────── */
  /* A laptop still fits the deck, but the rail and the side columns have to
     give up their width before the charts do. */
  @media (max-width: 1400px) {
    .fin .deck-body { grid-template-columns: minmax(0, 1fr) 272px; }
    .fin .split { grid-template-columns: minmax(0, 1fr) 244px; gap: 14px; }
    .fin .split-side { padding-left: 14px; }
    .fin .pane-tab kbd { display: none; }
  }

  /* Below this the deck stops being honest: five panes, a rail and four tiles
     cannot share a phone. It unfolds into a column and the page scrolls like
     any other, with every pane stacked and nothing hidden behind a tab. */
  @media (max-width: 1100px) {
    .fin.deck {
      height: auto; overflow: visible; padding: 18px 15px 80px;
      grid-template-rows: none;
    }
    .fin .deck-kpis { grid-template-columns: repeat(2, 1fr); }
    .fin .deck-body { grid-template-columns: 1fr; }
    .fin .pane { min-height: 440px; }
    .fin .split { grid-template-columns: 1fr; }
    .fin .split-side { border-left: none; padding-left: 0; border-top: 1px solid var(--line-2); padding-top: 14px; }
    /* The page unfolds and scrolls vertically, but a wide table must still
       scroll inside its own box — letting it push the document sideways is
       what puts a horizontal scrollbar under a phone layout. */
    .fin .pane-scroll, .fin .side-list, .fin .rail-list { overflow: visible; }
    .fin .split-main.pane-scroll { overflow-x: auto; }
    .fin .rail { max-height: none; }
  }
  @media (max-width: 620px) {
    .fin .deck-kpis { grid-template-columns: 1fr; }
    .fin .deck-act { width: 100%; }
    .fin .pane-switch { width: 100%; overflow-x: auto; }
  }
`

/**
 * The traffic pulse's furniture.
 *
 * `ListingPulse` and its sub-panels draw themselves with `.panel`, `.db-row`
 * and friends — classes this page used to define in a slate-and-maroon dialect
 * of its own. Rather than rewrite that section, the same names are redefined
 * here in the money area's tokens, so the pulse inherits the surface, radius
 * and ink without a line of its own changing.
 *
 * This block is the seam between the old section and the new deck, and it is
 * meant to be deleted: when the pulse is rebuilt as a pane in its own right,
 * this goes with it. Nothing new is built on it.
 */
const LEGACY_CSS = `
  .fin .panel {
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    overflow: hidden; min-width: 0;
  }
  .fin .panel-hd {
    padding: 14px 16px 11px; border-bottom: 1px solid var(--line-2);
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .fin .panel-title { font-size: 12.5px; font-weight: 600; color: var(--ink); letter-spacing: -0.012em; }
  .fin .panel-link {
    font-size: 12px; color: var(--accent); font-weight: 500; text-decoration: none; white-space: nowrap;
  }
  .fin .panel-link:hover { text-decoration: underline; }
  .fin .panel-body { padding: 14px 16px 16px; }

  .fin .db-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .fin .db-row-full { margin-bottom: 12px; }
  .fin .db-section-title { font-size: 14px; font-weight: 600; letter-spacing: -0.015em; }

  .fin .row-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 9px 0; border-bottom: 1px solid var(--line-2);
  }
  .fin .row-item:last-child { border-bottom: none; padding-bottom: 0; }
  .fin .row-item-first { padding-top: 0; }

  .fin .prog-bar { height: 7px; background: var(--line-2); border-radius: 99px; overflow: hidden; margin-top: 4px; }
  .fin .prog-fill { height: 100%; border-radius: 99px; transition: width 0.4s var(--ease); }

  @media (max-width: 1100px) { .fin .db-row { grid-template-columns: 1fr; } }
`
