'use client'

/**
 * The tenant's home screen.
 *
 * It answers, in this order: is anything waiting on me, where do I live and
 * what do I owe, what happened to the places I asked about, and what else is
 * out there. That order is the whole redesign. The page used to open with a
 * greeting and "2 active inquiries", then a lease card, then a tour card, then
 * inquiries — a feed of things that exist rather than a list of things that
 * need doing. An unsigned lease amendment, the single most time-sensitive item
 * in the product, did not appear on this page at all; neither did open
 * maintenance. A tenant four days past due, with a document waiting for their
 * signature, landed on a page whose loudest element was a list of homes to
 * browse.
 *
 * So the top of the page is now `tenantActions()` — a ranked list of what is
 * actually waiting, each item naming its own next step — and everything below
 * it is context and browsing. See `src/lib/tenantActions.ts` for what may
 * appear there and the rule that nothing in it is ever estimated.
 */

import { useEffect, useState } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getProperties, type Property } from '@/lib/properties'
import {
  tenantCharges, type TenantScheduledRow, type TenantSpecialRow,
} from '@/lib/tenantCharges'
import { fmtMoney } from '@/lib/rentPayments'
import { tenantActions, type TenantAction } from '@/lib/tenantActions'
import { inquiryView } from '@/lib/tenantInquiry'
import Icon from '@/components/NavIcons'
import {
  TenantStyles, PageHead, Section, Badge, Empty, PageSkeleton,
} from '@/components/tenant/TenantFrame'

type Lead = {
  id: string
  first_name: string
  email: string
  phone: string | null
  move_in_date: string | null
  property: string | null
  status: string
  closed_reason: 'leased' | 'lost' | null
  created_at: string
}

type TourRecord = {
  id: string
  lead_id: string
  property_slug: string
  scheduled_date: string
  time_slot: string
  custom_note: string | null
  status: string
}

/** The tenancy summary this page shows, resolved server-side. */
type Tenancy = {
  property: string
  slug: string | null
  unit: string | null
  endDate: string
  rent: number
  owed: number
  lateFees: number
  nextDue: string | null
  nextDueAmount: number | null
  oldestDue: string | null
  isDemo: boolean
  unmatchedPlan: boolean
  leaseId: string | null
}

function greeting(name: string) {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return name ? `${part}, ${name}` : part
}

function greetingIcon() {
  const h = new Date().getHours()
  return h < 12 ? 'coffee' as const : h < 17 ? 'sun' as const : 'moon' as const
}

function matchProperty(lead: Lead, properties: Property[]): Property | undefined {
  if (!lead.property) return undefined
  const q = lead.property.toLowerCase()
  return properties.find(p =>
    p.slug.toLowerCase() === q ||
    p.name.toLowerCase() === q ||
    p.name.toLowerCase().includes(q) ||
    q.includes(p.name.toLowerCase())
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const fmtDay = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const fmtMonthYear = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

export default function TenantDashboard() {
  const router = useRouter()

  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('tenant')
  const [leads, setLeads] = useState<Lead[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [tenancy, setTenancy] = useState<Tenancy | null>(null)
  const [actions, setActions] = useState<TenantAction[]>([])

  useEffect(() => { document.title = 'Home — My Portal | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }

      const [profileRes, leadsRes, propsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, role').eq('id', user.id).single(),
        supabase.from('leads').select('*').eq('email', user.email!).order('created_at', { ascending: false }),
        getProperties(),
      ])

      const fullName = profileRes.data?.full_name || user.user_metadata?.full_name || ''
      setUserName(fullName.split(' ')[0] || '')
      setUserRole(profileRes.data?.role || 'tenant')
      const fetchedLeads = (leadsRes.data as Lead[]) || []
      setLeads(fetchedLeads)
      setProperties(propsRes)

      const tourLead = fetchedLeads.find(l => l.status === 'tour_scheduled')
      let tourRow: TourRecord | null = null
      if (tourLead) {
        const { data } = await supabase
          .from('tours')
          .select('*')
          .eq('lead_id', tourLead.id)
          .eq('status', 'confirmed')
          .maybeSingle()
        // Only ever read through the action stack below, which is the one
        // place a tour is shown now — it used to also have a card of its own
        // on this page, repeating the same date twice.
        if (data) tourRow = data as TourRecord
      }

      // The page is usable from here. The tenancy, the amendments and the
      // maintenance count all load behind it — a renter with no lease must
      // never wait on three fetches that will return nothing.
      setLoading(false)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const auth = { Authorization: `Bearer ${session.access_token}` }

      /**
       * Everything the action stack needs, fetched together.
       *
       * Each one is allowed to fail on its own: an action stack missing its
       * maintenance line is a smaller problem than a home page that shows
       * nothing because one of three endpoints was slow.
       */
      const [leaseJson, amendJson, maintJson] = await Promise.all([
        fetch('/api/tenant/lease', { headers: auth })
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/tenant/amendments', { headers: auth })
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/tenant/maintenance', { headers: auth })
          .then(r => (r.ok ? r.json() : null)).catch(() => null),
      ])

      let next: Tenancy | null = null
      const t = (leaseJson?.tenancies ?? [])[0]
      if (t?.lease) {
        // The one calculation every tenant surface shares — including the late
        // fees, which sit on rent that is already settled and so are invisible
        // to any `status` filter. See src/lib/tenantCharges.ts.
        const rows = (t.scheduled ?? []) as TenantScheduledRow[]
        const charges = tenantCharges(
          rows, (t.specials ?? []) as TenantSpecialRow[], t.lateFeeRule,
        )
        const feesOwed = charges.lateFees.reduce((s, r) => s + (r.lateFee ?? 0), 0)
        const rentOwed = charges.owed.reduce((s, r) => s + r.amount + (r.lateFee ?? 0), 0)
        // The oldest thing actually owed, which is the date "past due" is
        // judged against — not the next date on the schedule.
        const oldest = [...charges.owed]
          .map(r => rows.find(s => s.id === r.id)?.due_date)
          .filter((d): d is string => !!d)
          .sort()[0] ?? null
        const upNext = charges.upcoming.find(r => r.kind === 'scheduled')
        const upNextRow = upNext ? rows.find(s => s.id === upNext.id) : undefined

        next = {
          property: t.lease.property?.name ?? 'Your home',
          slug: t.lease.property?.slug ?? null,
          unit: t.lease.unit_number,
          endDate: t.lease.end_date,
          rent: t.me?.monthly_total ?? t.lease.rent_amount ?? 0,
          owed: Math.round(rentOwed * 100) / 100,
          lateFees: Math.round(feesOwed * 100) / 100,
          nextDue: upNextRow?.due_date ?? null,
          nextDueAmount: upNext?.amount ?? null,
          oldestDue: oldest,
          isDemo: t.lease.is_demo === true,
          unmatchedPlan: t.unmatchedPlan === true,
          leaseId: t.lease.id ?? null,
        }
        setTenancy(next)
      }

      const pending = ((amendJson?.amendments ?? []) as {
        id: string; title: string; token: string; respond_by: string | null; status: string
        lease_id: string
      }[])
        .filter(a => a.status === 'sent')
        .filter(a => !next?.leaseId || a.lease_id === next.leaseId)

      const openWork = ((maintJson?.homes ?? []) as { pending: unknown[] }[])
        .reduce((n, h) => n + (h.pending?.length ?? 0), 0)

      setActions(tenantActions({
        owed: next ? next.owed : 0,
        lateFeesOwed: next ? next.lateFees : 0,
        oldestDueDate: next?.oldestDue ?? null,
        nextDueDate: next?.nextDue ?? null,
        nextDueAmount: next?.nextDueAmount ?? null,
        pendingAmendments: pending.map(a => ({
          id: a.id, title: a.title, token: a.token, respondBy: a.respond_by,
        })),
        tour: tourRow
          ? {
              date: tourRow.scheduled_date,
              propertySlug: tourRow.property_slug,
              propertyName: tourLead?.property ?? null,
              timeSlot: tourRow.time_slot,
              note: tourRow.custom_note,
            }
          : null,
        openMaintenance: openWork,
        leaseEnd: next?.endDate ?? null,
        unmatchedPlan: next?.unmatchedPlan,
        isDemo: next?.isDemo,
      }))
    }
    load()
  }, [router])

  if (loading) return <><TenantStyles css={CSS} /><PageSkeleton cards={2} /></>

  const inquiredSlugs = new Set(leads.map(l => l.property?.toLowerCase()).filter(Boolean))
  const recommendations = properties.filter(p =>
    p.is_active && p.available > 0 &&
    !inquiredSlugs.has(p.name.toLowerCase()) &&
    !inquiredSlugs.has(p.slug.toLowerCase())
  ).slice(0, 3)

  const live = leads.filter(l => l.status !== 'closed')
  const totalOwed = tenancy ? Math.round((tenancy.owed + tenancy.lateFees) * 100) / 100 : 0

  /**
   * The line under the greeting. It describes the tenant's actual situation
   * rather than counting inquiries at a housed tenant — "2 active inquiries"
   * was shown to someone who had already moved in and was looking at their own
   * rent balance.
   */
  const lede = tenancy
    ? totalOwed > 0
      ? <>You owe <strong>{fmtMoney(totalOwed)}</strong> at {tenancy.property}.</>
      : <>You&apos;re all paid up at {tenancy.property}.</>
    : live.length > 0
      ? `${live.length} ${live.length === 1 ? 'inquiry' : 'inquiries'} in progress`
      : 'Find your next place near ASU'

  return (
    <>
      <TenantStyles css={CSS} />
      <div className="tp tp-wrap">
        <PageHead
          title={
            <span className="db-greet">
              <Icon name={greetingIcon()} size={20} />
              {greeting(userName)}
            </span>
          }
          lede={lede}
        />

        {/* ── WHAT NEEDS YOU ───────────────────────────────────────────────
            The ranked stack. Nothing in it is decorative: if it is here, it
            has a deadline or somebody is waiting. An empty stack is itself
            information, so it says so rather than rendering nothing. ── */}
        {actions.length > 0 ? (
          <div className="db-actions">
            <div className="tp-eyebrow" style={{ marginBottom: 10 }}>Needs you</div>
            {actions.map(a => (
              <Link key={a.id} href={a.cta.href} className={`db-act ${a.urgency}`}>
                <span className="db-act-ic"><Icon name={a.icon} size={18} /></span>
                <span className="db-act-body">
                  <span className="db-act-t">{a.title}</span>
                  <span className="db-act-b">{a.body}</span>
                  <span className="db-act-cta">{a.cta.label} →</span>
                </span>
              </Link>
            ))}
          </div>
        ) : tenancy && (
          <div className="tp-note good" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="checkCircle" size={17} style={{ marginTop: 1 }} />
            <span>
              <strong>Nothing needs you right now.</strong> Your rent is up to date and there is
              no document waiting on your signature.
            </span>
          </div>
        )}

        {/* ── YOUR HOME ────────────────────────────────────────────────────
            The dark panel: the one place on this page a figure gets display
            size, because the balance is the question people open the portal
            to answer. ── */}
        {tenancy && (
          <div className="tp-panel">
            <div className="tp-panel-eyebrow">Your home</div>
            <div className="db-panel-head">
              <div style={{ minWidth: 0 }}>
                <div className="db-panel-name">{tenancy.property}</div>
                <div className="tp-panel-sub">
                  {tenancy.unit ? `${tenancy.unit} · ` : ''}
                  Lease to {fmtMonthYear(tenancy.endDate)}
                  {tenancy.isDemo && ' · demo lease, nothing is charged'}
                </div>
              </div>
            </div>
            <div className="tp-panel-fig tp-money">
              {totalOwed > 0 ? fmtMoney(totalOwed) : 'Paid up'}
            </div>
            <div className="tp-panel-sub">
              {totalOwed > 0
                ? tenancy.lateFees > 0
                  ? <>Balance due, including <strong>{fmtMoney(tenancy.lateFees)}</strong> in late fees.</>
                  : 'Balance due now.'
                : tenancy.nextDue
                  ? <>Next rent of <strong>{fmtMoney(tenancy.nextDueAmount ?? tenancy.rent)}</strong> is due {fmtDay(tenancy.nextDue)}.</>
                  : 'Nothing is outstanding.'}
            </div>
            <div className="tp-panel-actions">
              {totalOwed > 0 && !tenancy.isDemo && (
                <Link href="/dashboard/lease?tab=payments&pay=1" className="tp-btn tp-btn-accent">
                  Pay {fmtMoney(totalOwed)}
                </Link>
              )}
              <Link href="/dashboard/lease" className="tp-btn tp-btn-outline">
                My lease &amp; rent
              </Link>
            </div>
            <div className="tp-panel-grid">
              <div>
                <div className="tp-panel-l">Your rent</div>
                <div className="tp-panel-v">{fmtMoney(tenancy.rent)}/mo</div>
              </div>
              <div>
                <div className="tp-panel-l">Next due</div>
                <div className="tp-panel-v">{tenancy.nextDue ? fmtDay(tenancy.nextDue) : '—'}</div>
              </div>
              <div>
                <div className="tp-panel-l">Lease ends</div>
                <div className="tp-panel-v">{fmtMonthYear(tenancy.endDate)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── LANDLORD ────────────────────────────────────────────────────── */}
        {userRole === 'landlord' && (
          <div className="db-landlord">
            <span className="db-act-ic"><Icon name="building" size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="db-act-t">You&apos;re approved as a landlord</div>
              <div className="db-act-b">List properties and manage leads from your own portal.</div>
            </div>
            <Link href="/landlord/dashboard" className="tp-btn tp-btn-primary sm">Go to portal</Link>
          </div>
        )}

        {/* ── INQUIRIES ───────────────────────────────────────────────────── */}
        <Section
          title={tenancy ? 'Other places you asked about' : 'Your inquiries'}
          link={{ href: '/homes', label: 'Browse more' }}
        >
          {leads.length === 0 ? (
            <Empty
              icon="search"
              title="No inquiries yet"
              action={<Link href="/homes" className="tp-btn tp-btn-primary">Browse homes near ASU</Link>}
            >
              Ask about a listing and it appears here, with the landlord&apos;s replies and your
              tour dates as they happen.
            </Empty>
          ) : (
            <div className="tp-card" style={{ overflow: 'hidden' }}>
              {leads.map(lead => {
                const prop = matchProperty(lead, properties)
                const view = inquiryView(lead.status, lead.closed_reason)
                const href = prop ? `/homes/${prop.slug}` : '/homes'
                const thumb = prop?.images?.[0] ?? null
                return (
                  <a key={lead.id} href={href} className="db-inq">
                    {thumb
                      ? <img src={thumb} alt="" className="db-inq-img" loading="lazy" />
                      : <span className="db-inq-img ph"><Icon name="home" size={18} /></span>}
                    <span className="db-inq-body">
                      <span className="db-inq-name">
                        {prop?.name || lead.property || 'Property inquiry'}
                      </span>
                      <span className="db-inq-addr">
                        {prop?.address || lead.property || ''}
                      </span>
                      <span className="db-inq-state">
                        <Badge tone={view.tone}>{view.label}</Badge>
                        {view.detail && <em className="db-inq-detail">{view.detail}</em>}
                      </span>
                    </span>
                    <span className="db-inq-right">
                      {prop && <span className="db-inq-price tp-money">${prop.price}<em>/mo</em></span>}
                      <span className="db-inq-when">{timeAgo(lead.created_at)}</span>
                    </span>
                  </a>
                )
              })}
            </div>
          )}
        </Section>

        {/* ── RECOMMENDED ─────────────────────────────────────────────────── */}
        {recommendations.length > 0 && (
          <Section title="Still available near campus" link={{ href: '/homes', label: 'See all' }}>
            <div className="db-recs">
              {recommendations.map(home => (
                <a key={home.slug} href={`/homes/${home.slug}`} className="db-rec">
                  {home.images?.[0]
                    ? <img src={home.images[0]} alt="" className="db-rec-img" loading="lazy" />
                    : <span className="db-rec-img ph"><Icon name="home" size={20} /></span>}
                  <span className="db-rec-bd">
                    <span className="db-rec-name">{home.name}</span>
                    <span className="db-rec-meta">
                      {home.beds}bd · {home.baths}ba
                      {home.asu_distance > 0 ? ` · ${home.asu_distance}mi to ASU` : ''}
                    </span>
                    <span className="db-rec-price tp-money">${home.price}<em>/mo</em></span>
                  </span>
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* ── LIST YOUR PLACE ─────────────────────────────────────────────── */}
        {userRole !== 'landlord' && (
          <Link href="/dashboard/list" className="db-list">
            <span className="db-list-bd">
              <span className="db-list-t">Have a place to list?</span>
              <span className="db-list-s">Free to build · no broker fees · pre-screened ASU renters</span>
            </span>
            <span className="tp-btn tp-btn-accent sm">Get started</span>
          </Link>
        )}
      </div>
    </>
  )
}

const CSS = `
  .db-greet { display: inline-flex; align-items: center; gap: 10px; }
  .db-greet svg { color: var(--accent-text); flex-shrink: 0; }

  /* ── The action stack ─────────────────────────────────────────────────────
     Urgency is carried by the left edge and the icon tint, not by a wash
     across the whole card: three red cards in a row stop meaning urgent, and
     the text has to stay at full contrast because it holds the figures. ── */
  .db-actions { margin-bottom: 20px; }
  .db-act { display: flex; gap: 13px; align-items: flex-start; text-decoration: none;
    background: var(--surface); border: 1px solid var(--line);
    border-left: 3px solid var(--idle); border-radius: var(--r);
    box-shadow: var(--shadow); padding: 15px 17px; margin-bottom: 9px;
    transition: border-color .14s ease, transform .1s ease; }
  .db-act:hover { transform: translateY(-1px); }
  .db-act.now  { border-left-color: var(--owed); }
  .db-act.soon { border-left-color: var(--fee); }
  .db-act.info { border-left-color: var(--primary); }
  .db-act-ic { flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; }
  .db-act.now  .db-act-ic { background: var(--owed-wash); color: var(--owed); }
  .db-act.soon .db-act-ic { background: var(--fee-wash); color: var(--fee); }
  .db-act.info .db-act-ic { background: var(--primary-wash); color: var(--primary); }
  .db-act-body { min-width: 0; }
  .db-act-t { display: block; font-size: 14.5px; font-weight: 600; color: var(--ink);
    letter-spacing: -0.15px; }
  .db-act-b { display: block; font-size: 12.5px; color: var(--ink-3); line-height: 1.55;
    margin-top: 3px; }
  .db-act-cta { display: inline-block; font-size: 12.5px; font-weight: 600;
    color: var(--primary); margin-top: 8px; }

  .db-landlord { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
    padding: 13px 16px; margin-bottom: 18px; box-shadow: var(--shadow); }
  .db-landlord .db-act-ic { background: var(--primary-wash); color: var(--primary); }

  .db-panel-head { display: flex; justify-content: space-between; gap: 14px;
    margin-top: 7px; }
  .db-panel-name { font-family: var(--display); font-size: 21px; font-weight: 400;
    color: #fff; letter-spacing: -0.3px; }

  /* ── Inquiry rows ──────────────────────────────────────────────────────── */
  .db-inq { display: flex; gap: 13px; align-items: center; padding: 13px 16px;
    text-decoration: none; border-bottom: 1px solid var(--line-2); }
  .db-inq:last-child { border-bottom: none; }
  .db-inq:hover { background: var(--surface-2); }
  .db-inq-img { width: 58px; height: 58px; flex-shrink: 0; border-radius: 10px;
    object-fit: cover; display: block; }
  .db-inq-img.ph { background: var(--primary-wash); color: var(--primary);
    display: flex; align-items: center; justify-content: center; }
  .db-inq-body { flex: 1; min-width: 0; }
  .db-inq-name { display: block; font-size: 14px; font-weight: 600; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .db-inq-addr { display: block; font-size: 11.5px; color: var(--ink-4); margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .db-inq-state { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-top: 6px; }
  .db-inq-detail { font-style: normal; font-size: 11.5px; color: var(--ink-3);
    line-height: 1.4; }
  .db-inq-right { flex-shrink: 0; text-align: right; }
  .db-inq-price { display: block; font-size: 13.5px; font-weight: 700; color: var(--ink); }
  .db-inq-price em { font-style: normal; font-size: 10.5px; font-weight: 500;
    color: var(--ink-4); }
  .db-inq-when { display: block; font-size: 10.5px; color: var(--ink-4); margin-top: 3px; }

  /* ── Recommendations ───────────────────────────────────────────────────── */
  .db-recs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; }
  .db-rec { display: block; background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--r); overflow: hidden; text-decoration: none;
    box-shadow: var(--shadow); transition: transform .12s ease; }
  .db-rec:hover { transform: translateY(-2px); }
  .db-rec-img { display: block; width: 100%; height: 96px; object-fit: cover; }
  .db-rec-img.ph { background: var(--primary-wash); color: var(--primary);
    display: flex; align-items: center; justify-content: center; }
  .db-rec-bd { display: block; padding: 11px 12px 13px; }
  .db-rec-name { display: block; font-size: 13px; font-weight: 600; color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .db-rec-meta { display: block; font-size: 11px; color: var(--ink-4); margin-top: 2px; }
  .db-rec-price { display: block; font-size: 14px; font-weight: 700; color: var(--ink);
    margin-top: 5px; }
  .db-rec-price em { font-style: normal; font-size: 10.5px; font-weight: 500;
    color: var(--ink-4); }

  /* ── List your place. The one gold fill on this page sits on the dark
     band, which is the only place gold is legible. ── */
  .db-list { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    text-decoration: none; margin-top: 26px; padding: 16px 18px;
    border-radius: var(--r-lg);
    background: linear-gradient(145deg, var(--dark) 0%, var(--dark-2) 100%); }
  .db-list-bd { flex: 1; min-width: 180px; }
  .db-list-t { display: block; font-size: 14.5px; font-weight: 600; color: #fff; }
  .db-list-s { display: block; font-size: 12px; color: var(--on-dark-2); margin-top: 2px; }

  @media (max-width: 720px) {
    .db-recs { grid-template-columns: repeat(2, 1fr); }
    .db-inq-img { width: 50px; height: 50px; }
    .db-list .tp-btn { width: auto; }
  }
  @media (max-width: 420px) {
    .db-recs { grid-template-columns: 1fr; }
    .db-rec-img { height: 140px; }
  }
`
