'use client'

/**
 * The landlord Overview — the portal's front door.
 *
 * ── What changed and why ───────────────────────────────────────────────────
 *
 * This screen used to be a 960px column of six identical stat tiles followed
 * by eight panels of the same weight, in a typeface and palette of its own.
 * Three things were wrong with that, and all three are the same mistake:
 * nothing on the page was louder than anything else.
 *
 *   1. **It was narrow.** The portal shell is full-bleed and the rest of the
 *      money area has been full-bleed since the admin shell landed. A
 *      dashboard rendered down the middle of a 2560px monitor with grey either
 *      side is a reading layout applied to an instrument.
 *   2. **Six equal tiles are not a summary.** Six figures at the same size is
 *      a list, and a list has to be read in full before it can be understood.
 *      Four cards, exactly one of them filled, can be understood in a glance
 *      and then read if the glance says to.
 *   3. **It spoke a second dialect.** Fraunces headings, `#8C1D40` maroon
 *      controls, slate borders — none of which exist anywhere else a landlord
 *      goes. Clicking from here into Financials changed the application.
 *
 * So the page now speaks the money area's language: `FINANCE_THEME` tokens,
 * the `Panels` glance kit, and the same `Signals` component Financials uses
 * for "what needs doing". Nothing here is styled locally that the theme
 * already has a name for.
 *
 * ── The shape ──────────────────────────────────────────────────────────────
 *
 *   1. A header that says how the portfolio is doing in one sentence.
 *   2. Four stat cards. Revenue is the filled one — it is the reason a
 *      landlord is here — and the other three are white.
 *   3. What needs attention, worst first, with the evidence folded under.
 *   4. Collection month by month, beside the properties as a grid of peers.
 *   5. Enquiries over time, beside the pipeline they feed.
 *   6. The traffic pulse — unchanged, and deliberately below the lead charts
 *      that can only answer "nobody enquired" when it can answer why.
 *   7. The newest leads as the familiar admin table, and a row of doors.
 *
 * ── On the scope toggle ────────────────────────────────────────────────────
 *
 * The toggle scopes everything *below the stat cards*. The cards stay
 * portfolio-wide on purpose: they are the answer to "how is the business", and
 * a landlord who has filtered to one property and then forgotten they did so
 * should never be able to read a single building's arrears as the whole of it.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/supabase'
import { getPropertiesByOwner, type Property } from '@/lib/properties'
import { getLeadsForOwner, type Lead } from '@/lib/leads'
import { getLeasesForOwner, formatLeaseDate, type Lease } from '@/lib/leases'
import { getPlansForOwner, fmtCurrency, type PaymentPlan } from '@/lib/payments'
import { buildOverview, overviewSignals, daysUntil } from '@/lib/overviewModel'
import { FINANCE_THEME } from '@/lib/financeTheme'
import Glyph, { GLYPH_CSS, type GlyphName } from '@/components/finance/Glyph'
import { VIZ_CSS } from '@/components/finance/Charts'
import Signals from '@/components/finance/Signals'
import {
  StatCard, MiniCard, TrendPill, StatusDot, GradientBars, PANEL_CSS, type BarPoint,
} from '@/components/finance/Panels'
import TrendArea, { TREND_AREA_CSS, type TrendPoint } from './TrendArea'
import ListingPulse from './ListingPulse'

/** Signals shown before the rest are deferred to the pages that own them. */
const SIGNALS_SHOWN = 3
/** Rows in the recent-leads table. One screenful, not a log. */
const LEAD_ROWS = 6
/** Properties shown as peers before the grid defers to Listings. */
const PEERS_SHOWN = 4

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '—'

const leadName = (l: Lead) =>
  [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email

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
 * Ninety daily points on a 700px panel is four pixels a point, which is noise
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

export default function LandlordOverview() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [properties, setProperties] = useState<Property[]>([])
  const [leads, setLeads]   = useState<Lead[]>([])
  const [leases, setLeases] = useState<Lease[]>([])
  const [plans, setPlans]   = useState<PaymentPlan[]>([])
  const [loading, setLoading] = useState(true)

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

  // The portfolio-wide answer, for the header and the stat cards.
  const o = useMemo(
    () => buildOverview(properties, leads, leases, plans),
    [properties, leads, leases, plans],
  )

  // The same model again, narrowed — so a scoped panel is computed by exactly
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

  const collectedInSpan = bars.reduce((n, b) => n + b.value, 0)
  const trend = useMemo(() => leadBuckets(s.leads, range), [s.leads, range])
  const trendTotal = trend.reduce((n, p) => n + p.value, 0)
  const recentLeads = s.leads.slice(0, LEAD_ROWS)
  /* The funnel bars are relative to the widest stage, not to the total: the
     question is where the pipeline narrows, and scaling to the total leaves
     every bar a sliver as soon as one stage dominates. */
  const widest = Math.max(1, ...s.funnel.map(f => f.count))

  const CSS_ALL = `${FINANCE_THEME}${GLYPH_CSS}${VIZ_CSS}${PANEL_CSS}${TREND_AREA_CSS}${LEGACY_CSS}${CSS}`

  if (loading) {
    return (
      <>
        <style>{CSS_ALL}</style>
        <div className="fin fin-wrap">
          <div className="skeleton" style={{ height: 54, maxWidth: 420, marginBottom: 22 }} />
          <div className="stats">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="statc"><div className="skeleton" style={{ height: 128 }} /></div>
            ))}
          </div>
          <div className="skeleton-hero" />
        </div>
      </>
    )
  }

  if (o.empty) {
    return (
      <>
        <style>{CSS_ALL}</style>
        <div className="fin fin-wrap">
          <h1 className="ov-title">{greeting(name)}.</h1>
          <p className="sub">Your portfolio lives here once there is something in it.</p>
          <div className="empty" style={{ marginTop: 22 }}>
            <div className="empty-title">No listings yet</div>
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
      <div className="fin fin-wrap">

        {/* ══ HEADER ══ */}
        <header className="ov-hd">
          <div className="ov-hd-id">
            <h1 className="ov-title">{greeting(name)}.</h1>
            <p className="sub">
              {o.liveCount} live propert{o.liveCount !== 1 ? 'ies' : 'y'}
              {o.occupancyPct !== null && <> · {o.occupancyPct}% occupied</>}
              {' '}· {fmtCurrency(o.monthlyRevenue)} contracted a month
              {o.owed > 0 && <> · <span className="ov-flag">{fmtCurrency(o.owed)} past due</span></>}
            </p>
          </div>
          <div className="ov-hd-act">
            <Link className="btn-secondary" href="/landlord/financials">Financials</Link>
            <Link className="btn-primary" href="/landlord/listings/new">
              <Glyph name="building" size={15} />
              New listing
            </Link>
          </div>
        </header>

        {/* ══ 1. THE FOUR FIGURES ══ */}
        <div className="stats">
          <StatCard
            primary
            icon="wallet"
            title="Contracted rent"
            sub={`From ${o.currentLeases.length} lease${o.currentLeases.length !== 1 ? 's' : ''} running now`}
            value={fmtCurrency(o.monthlyRevenue)}
            foot={o.monthlyRevenue > 0
              ? `${fmtCurrency(o.annualRevenue)} a year at today's leases`
              : 'No lease is running yet'}
            href="/landlord/leases"
            footLabel="See leases"
          />

          <StatCard
            icon="users"
            tone={o.occupancyPct !== null && o.occupancyPct < 60 ? 'warn' : undefined}
            title="Occupancy"
            sub={o.totalRooms > 0
              ? `${o.occupiedRooms} of ${o.totalRooms} rooms filled`
              : 'No rooms configured yet'}
            value={o.occupancyPct !== null ? `${o.occupancyPct}%` : '—'}
            foot={o.vacantRooms > 0
              ? `${o.vacantRooms} room${o.vacantRooms !== 1 ? 's' : ''} earning nothing right now`
              : 'Every room is filled'}
            href="/landlord/performance"
            footLabel="Listing performance"
          />

          <StatCard
            icon="check"
            // Deliberately untoned, however bad the arrears are. This figure
            // is money that *arrived*, and the area's one rule about colour is
            // that green means received and red means late. Painting a
            // collection figure red because a different figure is overdue
            // breaks that for the one number on the screen a landlord is
            // pleased to see. The arrears live in the footer, in words.
            title={`Collected in ${o.monthLabel}`}
            sub={o.collectionRate !== null
              ? `${o.collectionRate}% of ${fmtCurrency(o.monthBilled)} billed`
              : 'Nothing is billed this month'}
            value={fmtCurrency(o.pace.toDate)}
            pill={o.pace.comparable
              ? <TrendPill pct={o.pace.deltaPct} basis={o.pace.basis} goodWhen="up" />
              : undefined}
            foot={o.owed > 0
              ? `${fmtCurrency(o.owed)} past due across ${o.owedCount} charge${o.owedCount !== 1 ? 's' : ''}`
              : o.pace.lastToSame !== null
                ? `${fmtCurrency(o.pace.lastToSame)} by the same point of last month`
                : 'Everyone is up to date'}
            href={o.owed > 0 ? '/landlord/financials/collections' : '/landlord/financials'}
            footLabel={o.owed > 0 ? 'Work collections' : 'Open financials'}
          />

          <StatCard
            icon="bolt"
            title="Open leads"
            sub={o.newLeads > 0
              ? `${o.newLeads} not contacted yet`
              : `${o.qualifiedLeads} qualified`}
            value={String(o.activeLeads)}
            pill={<TrendPill pct={o.leadDelta.pct} basis={o.leadDelta.basis} goodWhen="up" />}
            foot={`${o.leadDelta.recent} enquir${o.leadDelta.recent !== 1 ? 'ies' : 'y'} in the last 30 days`}
            href="/landlord/leads/list"
            footLabel="Open the pipeline"
          />
        </div>

        {/* ══ 2. WHAT NEEDS DOING ══ */}
        <Signals
          signals={sigs}
          limit={SIGNALS_SHOWN}
          moreHref="/landlord/financials/insights"
          title="Needs your attention"
        />

        {/* ══ SCOPE ══
            One toggle for everything below it. The traffic pulse, the charts
            and the lead table all answer to it, because a landlord asking "how
            is Maple Street doing" means the whole answer, not half of it. */}
        {properties.length > 1 && (
          <div className="ov-scope">
            <span className="ov-scope-lbl">Showing</span>
            <div className="seg" role="tablist" aria-label="Property">
              {[{ slug: 'all', name: 'All properties' }, ...properties].map(p => (
                <button
                  key={p.slug}
                  role="tab"
                  aria-selected={scope === p.slug}
                  className={`seg-btn${scope === p.slug ? ' on' : ''}`}
                  onClick={() => setScope(p.slug)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══ 3. MONEY IN, AND THE PROPERTIES IT CAME FROM ══ */}
        <div className="grid-2">
          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Rent collected</h2>
                <div className="card-big">{fmtCurrency(collectedInSpan)}</div>
                <p className="card-sub">received over the last {bars.length} months</p>
              </div>
              <div className="seg sm pill" role="tablist" aria-label="Span">
                <button
                  role="tab" aria-selected={span === '6m'}
                  className={`seg-btn${span === '6m' ? ' on' : ''}`}
                  onClick={() => setSpan('6m')}
                >6 months</button>
                <button
                  role="tab" aria-selected={span === '12m'}
                  className={`seg-btn${span === '12m' ? ' on' : ''}`}
                  onClick={() => setSpan('12m')}
                >12 months</button>
              </div>
            </div>

            {collectedInSpan === 0 ? (
              <p className="muted">
                No rent has been collected on these leases yet. Money a tenant pays online lands
                here the moment it settles, and anything you record by hand appears too.
              </p>
            ) : (
              <>
                <GradientBars
                  points={bars}
                  onSelect={key => router.push(`/landlord/financials/schedule?month=${key}`)}
                />
                <div className="card-ft">
                  <span>Hover a month for the detail; click to open it.</span>
                  <Link className="btn-quiet sm" href="/landlord/financials/trends">
                    Health over time →
                  </Link>
                </div>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Your properties</h2>
                <p className="card-sub">
                  {s.properties.length} propert{s.properties.length !== 1 ? 'ies' : 'y'} ·
                  {' '}{fmtCurrency(s.monthlyRevenue)}/mo contracted
                </p>
              </div>
              <Link className="btn-secondary sm" href="/landlord/listings">Manage all</Link>
            </div>

            <div className="minis">
              {s.properties.slice(0, PEERS_SHOWN).map(p => (
                <MiniCard
                  key={p.id}
                  badge={initials(p.name)}
                  label={p.name}
                  value={p.monthly > 0 ? `${fmtCurrency(p.monthly)}/mo` : fmtCurrency(p.price)}
                  caption={p.totalRooms > 0
                    ? `${p.totalRooms - p.vacantRooms} of ${p.totalRooms} rooms filled`
                    : `${p.activeLeases} lease${p.activeLeases !== 1 ? 's' : ''}`}
                  status={PEER_STATUS[p.state](p)}
                  statusTone={PEER_TONE[p.state]}
                  href={`/landlord/listings/${p.slug}`}
                />
              ))}
            </div>

            {s.properties.length > PEERS_SHOWN && (
              <p className="card-more">
                and {s.properties.length - PEERS_SHOWN} more —{' '}
                <Link className="lnk" href="/landlord/listings">open your listings</Link>
              </p>
            )}
          </section>
        </div>

        {/* ══ 4. ENQUIRIES, AND THE PIPELINE THEY FEED ══ */}
        <div className="grid-2">
          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Enquiries over time</h2>
                <div className="card-big">{trendTotal}</div>
                <p className="card-sub">
                  new lead{trendTotal !== 1 ? 's' : ''} in the last {range} days
                </p>
              </div>
              <div className="seg sm pill" role="tablist" aria-label="Range">
                {([30, 90] as const).map(r => (
                  <button
                    key={r}
                    role="tab" aria-selected={range === r}
                    className={`seg-btn${range === r ? ' on' : ''}`}
                    onClick={() => setRange(r)}
                  >{r} days</button>
                ))}
              </div>
            </div>

            {trendTotal === 0 ? (
              <p className="muted">
                No enquiries in this window. The traffic pulse below says whether anyone is
                reaching the listing at all — a flat line here with views there is a listing
                problem, and a flat line in both is a reach problem.
              </p>
            ) : (
              <TrendArea points={trend} unit="lead" />
            )}
          </section>

          <section className="card">
            <div className="card-hd top">
              <div>
                <h2 className="card-title">Pipeline</h2>
                <p className="card-sub">Where the {s.leads.length} lead{s.leads.length !== 1 ? 's' : ''} on this scope stand</p>
              </div>
              <Link className="btn-secondary sm" href="/landlord/leads">Full pipeline</Link>
            </div>

            {s.leads.length === 0 ? (
              <p className="muted">
                Nobody has enquired yet. Leads appear the moment a student asks about a listing.
              </p>
            ) : (
              <>
                {/* The funnel as rows rather than columns: a stage's name and
                    its count sit on the same line as its bar, so the shape and
                    the numbers are read in one pass instead of two. */}
                <div className="fnl">
                  {s.funnel.map(f => {
                    return (
                      <div key={f.stage} className="fnl-row">
                        <span className="fnl-lbl">{f.label}</span>
                        <span className="fnl-track">
                          <span
                            className={`fnl-fill${f.count === 0 ? ' empty' : ''}`}
                            style={{ width: `${Math.max(f.count === 0 ? 0 : 3, (f.count / widest) * 100)}%` }}
                          />
                        </span>
                        <span className="fnl-n">{f.count}</span>
                      </div>
                    )
                  })}
                </div>

                <div className="mix">
                  {s.statusMix.map(m => (
                    <span key={m.label} className="mix-item">
                      <i style={{ background: m.color }} aria-hidden="true" />
                      {m.label}
                      <em>{m.count}</em>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ══ 5. THE TRAFFIC PULSE ══
            Below the lead charts, because those can only ever say "nobody
            enquired" and this is the band that says why. */}
        <ListingPulse slug={scope === 'all' ? null : scope} />

        {/* ══ 6. THE NEWEST LEADS ══ */}
        <section className="card flush">
          <div className="card-hd top">
            <div>
              <h2 className="card-title">Newest leads</h2>
              <p className="card-sub">The last {recentLeads.length} to come in</p>
            </div>
            <Link className="btn-secondary sm" href="/landlord/leads/list">
              <Glyph name="search" size={14} />
              All leads
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <p className="muted card-prose">
              No leads on this scope yet. They land here the moment a student asks about a listing.
            </p>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl roomy">
                <thead>
                  <tr>
                    <th>Renter</th>
                    <th>Property</th>
                    <th>Enquired</th>
                    <th>Moving in</th>
                    <th>Stage</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.map(l => {
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
                        <td className="at-more" aria-hidden="true">⋮</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ══ WHERE ELSE TO GO ══ */}
        <div className="dests">
          <Dest icon="calendar" title="Leases"
            stat={String(o.currentLeases.length)}
            line={o.expiring.length > 0
              ? `${o.expiring.length} ending within 60 days`
              : `${o.upcomingLeases.length} starting soon`}
            href="/landlord/leases" />
          <Dest icon="wallet" title="Financials"
            stat={o.collectionRate !== null ? `${o.collectionRate}%` : '—'}
            line="Collected, overdue, and what is coming"
            href="/landlord/financials" />
          <Dest icon="building" title="Listings"
            stat={`${o.liveCount} / ${o.properties.length}`}
            line="Live, rented, and not yet published"
            href="/landlord/listings" />
          <Dest icon="clock" title="Renewals"
            stat={String(o.expiring.length)}
            line={o.expiring.length > 0
              ? `Soonest in ${daysUntil(o.expiring[0].lease.end_date)} days`
              : 'Nothing ending yet'}
            href="/landlord/renewals" />
        </div>

      </div>
    </>
  )
}

// ─── SMALL PIECES ────────────────────────────────────────────────────────────

function Dest({
  icon, title, stat, line, href,
}: {
  icon: GlyphName
  title: string
  stat: string
  line: string
  href: string
}) {
  return (
    <Link className="dest" href={href}>
      <span className="gl-plate"><Glyph name={icon} size={15} /></span>
      <span className="dest-main">
        <span className="dest-title">{title}</span>
        <span className="dest-stat">{stat}</span>
        <span className="dest-line">{line}</span>
      </span>
      <span className="row-chev" aria-hidden="true" />
    </Link>
  )
}

/** A peer card's one-line state. Money owed outranks everything else. */
const PEER_STATUS: Record<
  string,
  (p: { owed: number; vacantRooms: number; activeLeases: number }) => string
> = {
  live:     p => p.owed > 0 ? `${fmtCurrency(p.owed)} overdue`
                : p.vacantRooms > 0 ? `${p.vacantRooms} room${p.vacantRooms !== 1 ? 's' : ''} empty`
                : 'Full and current',
  unpaid:   () => 'Not published',
  rented:   p => p.owed > 0 ? `${fmtCurrency(p.owed)} overdue` : 'Rented out',
  inactive: () => 'Switched off',
  pending:  () => 'Awaiting review',
  rejected: () => 'Rejected',
}

const PEER_TONE: Record<string, 'good' | 'bad' | 'warn' | 'idle'> = {
  live: 'good', unpaid: 'warn', rented: 'idle',
  inactive: 'idle', pending: 'warn', rejected: 'bad',
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

  .fin .ov-hd {
    display: flex; align-items: flex-end; justify-content: space-between;
    gap: 18px; flex-wrap: wrap; margin-bottom: 22px;
  }
  .fin .ov-hd-id { min-width: 0; }
  .fin .ov-title {
    font-size: 27px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.15;
  }
  .fin .ov-flag { color: var(--late); font-weight: 500; }
  .fin .ov-hd-act { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

  .fin .ov-scope {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 20px 0 16px;
  }
  /* Sentence case, like every other label in the area. The uppercase
     micro-caps went when the money screens were restyled: a label is a name,
     not a column head, and small caps at 11px are the first thing to turn to
     mush on a laptop screen. */
  .fin .ov-scope-lbl {
    font-size: 12px; font-weight: 500; color: var(--ink-3); letter-spacing: -0.01em;
  }

  /* The two-up band. Uneven on purpose — a pair of exactly equal panels reads
     as indecision, and in both bands one side is the chart. */
  .fin .grid-2 {
    display: grid; grid-template-columns: minmax(0, 1.16fr) minmax(0, 0.84fr);
    gap: 16px; margin-bottom: 18px;
  }
  /* A card standing on its own in the page's flow — the signals panel, the
     leads table — carries the band rhythm. A card inside the two-up grid does
     not: the grid's own gap spaces it, and a margin there would hang off the
     bottom of the shorter column. */
  .fin-wrap > .card { margin-bottom: 18px; }

  /* The bar chart, capped.
     GradientBars divides its width evenly between the columns, which is
     right in the money area's narrower panels and wrong here: six months
     across a full-bleed panel gives 125px slabs that read as blocks of colour
     rather than as measurements. Capping the column and centring the group
     keeps a bar a bar at any width, and at twelve months the cap never binds
     so the chart still fills the panel. */
  .fin .gb-cols { justify-content: center; }
  .fin .gb-col { max-width: 92px; }

  /* ── The funnel, as rows ──────────────────────────────────────────────── */
  .fin .fnl { display: flex; flex-direction: column; gap: 9px; }
  .fin .fnl-row { display: flex; align-items: center; gap: 12px; }
  .fin .fnl-lbl {
    width: 78px; flex-shrink: 0; font-size: 12.5px; color: var(--ink-2);
    letter-spacing: -0.01em;
  }
  .fin .fnl-track {
    flex: 1; min-width: 0; height: 22px; border-radius: 7px;
    background: var(--surface-2); border: 1px solid var(--line-2); overflow: hidden;
  }
  .fin .fnl-fill {
    display: block; height: 100%; border-radius: 6px;
    background: linear-gradient(90deg, #178d4e 0%, #0f7a43 100%);
    transition: width 0.4s var(--ease);
  }
  .fin .fnl-fill.empty { background: none; }
  .fin .fnl-n {
    width: 34px; flex-shrink: 0; text-align: right; font-size: 13.5px; font-weight: 600;
    font-variant-numeric: tabular-nums; letter-spacing: -0.015em;
  }

  .fin .mix {
    display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 16px;
    padding-top: 14px; border-top: 1px solid var(--line-2);
  }
  .fin .mix-item {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 11.5px; color: var(--ink-2);
  }
  .fin .mix-item i { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .fin .mix-item em {
    font-style: normal; font-weight: 600; color: var(--ink);
    font-variant-numeric: tabular-nums;
  }

  /* ── Destinations ─────────────────────────────────────────────────────── */
  .fin .dests {
    display: grid; gap: 12px; margin-bottom: 20px;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }
  .fin .dest {
    display: flex; align-items: flex-start; gap: 12px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
    padding: 15px 16px; text-decoration: none; color: inherit; min-width: 0;
    transition: border-color 0.15s var(--ease), box-shadow 0.15s var(--ease);
  }
  .fin .dest:hover { border-color: #d9d9de; box-shadow: var(--lift-1); }
  .fin .dest .row-chev { margin-top: 9px; }
  .fin .dest-main { flex: 1; min-width: 0; }
  .fin .dest-title {
    display: block; font-size: 12px; font-weight: 500;
    letter-spacing: -0.01em; color: var(--ink-2);
  }
  .fin .dest-stat {
    display: block; font-size: 19px; font-weight: 600; letter-spacing: -0.022em;
    margin-top: 4px; font-variant-numeric: tabular-nums; line-height: 1.15;
  }
  .fin .dest-line {
    display: block; font-size: 11.5px; color: var(--ink-2); line-height: 1.45; margin-top: 4px;
  }

  @media (max-width: 1100px) {
    .fin .grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .fin .ov-title { font-size: 23px; }
    .fin .ov-hd-act { width: 100%; }
    .fin .ov-hd-act > a { flex: 1; justify-content: center; }
    .fin .fnl-lbl { width: 66px; font-size: 12px; }
  }
`

/**
 * The traffic pulse's furniture.
 *
 * `ListingPulse` and its four sub-panels are a large, well-tested section that
 * draws itself with `.panel`, `.db-row` and friends — classes this page used
 * to define in a slate-and-maroon dialect of its own. Rather than rewrite that
 * section to restyle it, the same class names are redefined here in the money
 * area's tokens, so the pulse inherits the new surface, radius and ink without
 * a line of its own changing.
 *
 * This block is the seam between the old section and the new page, and it is
 * meant to be deleted: when the pulse is rebuilt on `card`, this goes with
 * it. It is kept to one screen and nothing new is built on it.
 */
const LEGACY_CSS = `
  .fin .panel {
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    overflow: hidden; min-width: 0;
  }
  .fin .panel-hd {
    padding: 16px 20px 13px; border-bottom: 1px solid var(--line-2);
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .fin .panel-title {
    font-size: 13px; font-weight: 600; color: var(--ink); letter-spacing: -0.012em;
    text-transform: none;
  }
  .fin .panel-link {
    font-size: 12.5px; color: var(--accent); font-weight: 500; text-decoration: none;
    white-space: nowrap;
  }
  .fin .panel-link:hover { text-decoration: underline; }
  .fin .panel-body { padding: 16px 20px 18px; }

  .fin .db-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; }
  .fin .db-row-full { margin-bottom: 14px; }
  .fin .db-section-title { font-size: 16px; font-weight: 600; letter-spacing: -0.018em; }

  .fin .row-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 0; border-bottom: 1px solid var(--line-2);
  }
  .fin .row-item:last-child { border-bottom: none; padding-bottom: 0; }
  .fin .row-item-first { padding-top: 0; }

  .fin .prog-bar {
    height: 7px; background: var(--line-2); border-radius: 99px; overflow: hidden; margin-top: 4px;
  }
  .fin .prog-fill { height: 100%; border-radius: 99px; transition: width 0.4s var(--ease); }

  @media (max-width: 1100px) { .fin .db-row { grid-template-columns: 1fr; } }
`
