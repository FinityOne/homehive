'use client'

/**
 * My Lease & Rent — the tenant's own view of their tenancy: what they owe,
 * what they've paid, and how their share of the rent is made up. Everything is
 * scoped to them; a housemate's balance is none of their business.
 *
 * The money logic here is unchanged and deliberately so — `tenantCharges()` is
 * the one engine every tenant surface shares and matches what
 * `POST /api/tenant/pay` prices. What changed is everything around it:
 *
 *   • **It is in the portal's own language.** This page spoke the landlord
 *     admin's slate-and-emerald (`#0f172a` buttons with `#34d399` text) inside
 *     a maroon-and-cream shell, so the most important screen a renter has was
 *     visibly a different product from the one they navigated out of. It now
 *     uses `src/lib/tenantTheme.ts`, like every other tenant screen.
 *   • **One figure leads.** The balance was the first of four identical tiles,
 *     giving the question people open this page to answer the same weight as
 *     the lease end date. It is now a display figure on the dark panel, with
 *     the single action that clears it.
 *   • **The tabs are in the URL.** They were local state read once on mount,
 *     so the back button did nothing, a refresh dropped you on Overview, and
 *     the tab you were reading could not be linked to — which matters, because
 *     conversations about rent happen by sending somebody a link.
 *   • **Every settled payment opens a receipt.** See `ReceiptSheet`.
 *   • **Loading holds the layout** instead of printing "Loading your lease…"
 *     in the middle of an empty screen while two fetches run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { fmtMoney, METHOD_META, type SettledMethod } from '@/lib/rentPayments'
import { tenantCharges } from '@/lib/tenantCharges'
import type { Payable } from '@/components/tenant/PayRentModal'
import type { Receipt } from '@/components/tenant/ReceiptSheet'
import StripeModeBanner from '@/components/StripeModeBanner'
import Link from 'next/link'
import Icon from '@/components/NavIcons'
import {
  TenantStyles, Tabs, useUrlTab, Badge, Empty, PageSkeleton, Stat,
} from '@/components/tenant/TenantFrame'
import {
  fmtShortDate as fmtAmendDate, fmtDollars as fmtAmendDollars, amendmentPath,
} from '@/lib/leaseAmendments'
import {
  TENANT_STATUS_META, tenantKindLabel, type TenantWorkItem,
} from '@/lib/tenantMaintenance'

/** Just enough of an amendment to put it on this page and link to it. */
type MyAmendment = {
  id: string
  lease_id: string
  title: string
  effective_date: string
  monthly_charge: number
  monthly_charge_label: string | null
  deposit_amount: number
  one_time_fee_amount: number
  status: 'sent' | 'signed' | 'declined' | 'withdrawn'
  token: string
  signature_date: string | null
}

const PayRentModal = dynamic(() => import('@/components/tenant/PayRentModal'), { ssr: false })
const LateFeeDetailSheet = dynamic(
  () => import('@/components/tenant/LateFeeDetailSheet'), { ssr: false },
)
const ReceiptSheet = dynamic(
  () => import('@/components/tenant/ReceiptSheet'), { ssr: false },
)

type Scheduled = {
  id: string; due_date: string; amount: number; status: string
  paid_amount: number; paid_date: string | null
  /**
   * When the tenant submitted the payment through the platform.
   *
   * The date every late fee is judged against — see `lateFeeAsOf`. It has to
   * travel all the way to `explainLateFee` below: an ACH debit submitted on
   * the due date and still clearing has no `paid_date`, so without this the
   * fee is measured to *today* and the tenant watches a fee grow on rent they
   * already sent on time. The server charges the frozen figure, so dropping
   * this field also made the portal quote a number the card never took.
   */
  submitted_at: string | null
  /** Fee money that genuinely arrived on this row. */
  late_fee_paid: number
  /** Fee the landlord has written off on this row. */
  late_fee_waived: number
  /** The write-off itself, when there is one, so it can be shown as something
   *  that happened rather than as a charge that quietly disappeared. */
  late_fee_waiver?: { amount: number; waivedOn: string; note: string | null } | null
  payment_method: string | null; processing_fee: number; notes: string | null
}
type Special = {
  id: string; category: string; label: string; amount: number; due_date: string
  status: string; paid_date: string | null; payment_method: string | null; processing_fee: number
  /** What the landlord wrote about this charge, for the tenant to read. */
  notes: string | null
}
type Tenancy = {
  lease: {
    id: string; start_date: string; end_date: string; unit_number: string | null
    rent_amount: number | null
    /** A demo tenancy: no rent is collected on it and nothing here is payable. */
    is_demo?: boolean
    property: { id: string; name: string; address: string; slug: string } | null
  }
  plan: { id: string; due_day: number; name: string } | null
  lateFeeRule: { grace_period_days: number; fee_amount: number; frequency_days: number; max_total_fees: number | null } | null
  me: { id: string; name: string; monthly_total: number; status: string } | null
  housemateCount: number
  unmatchedPlan?: boolean
  lineItems: { id: string; category: string; label: string; amount: number; notes: string | null }[]
  scheduled: Scheduled[]
  specials: Special[]
}

const TABS = ['overview', 'payments', 'maintenance', 'lease'] as const
type Tab = typeof TABS[number]

/** One home's shared maintenance, as `/api/tenant/maintenance` returns it. */
type MaintenanceHome = {
  lease_id: string
  property_id: string
  property: { id: string; name: string; address: string } | null
  unit_number: string | null
  pending: TenantWorkItem[]
  completed: TenantWorkItem[]
  summary: { pendingCount: number; completedCount: number; scheduledNext: TenantWorkItem | null; headline: string }
}

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const fmtShort = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

/**
 * A timestamp on a progress update. Date and time, because two updates on the
 * same day are normal on a job that is moving and a bare date makes them look
 * like duplicates.
 */
const fmtStamp = (ts: string) =>
  new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

/** "June 2026" — how a tenant refers to a month's rent. */
const fmtMonthYear = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const isSettled = (s: string) => s === 'paid' || s === 'processing'
/**
 * Rent that was cancelled rather than paid.
 *
 * Written on every future month when a landlord terminates a tenancy early. It
 * is not owed, it is not upcoming, and it must never appear as something this
 * tenant can be charged for.
 */
const isVoided = (s: string) => s === 'voided'

export default function MyLeasePage() {
  const router = useRouter()
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useUrlTab<Tab>('tab', TABS, 'overview')
  const [active, setActive] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [paying, setPaying] = useState<Payable[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<{ tone: 'good' | 'warn' | 'bad' | 'flight'; text: string } | null>(null)
  /**
   * Lease changes addressed to this tenant.
   *
   * On this page and not only in the email, because an email gets buried and a
   * tenant who half-remembers being asked to sign something has nowhere else to
   * look. Loaded separately from the tenancy so a failure here cannot stop them
   * seeing their rent.
   */
  const [amendments, setAmendments] = useState<MyAmendment[]>([])
  /**
   * Maintenance the landlord has chosen to share on the homes this tenant
   * currently rents. Loaded after the rent, like the amendments: a tenant who
   * came here to pay must never wait on a repair list, and a failure fetching
   * it must not blank the page.
   */
  const [maintenance, setMaintenance] = useState<MaintenanceHome[] | null>(null)
  /**
   * Tracked separately from an empty result, because the two mean opposite
   * things to a tenant: "nothing is shared on your home" is information, and
   * "we couldn't load it" is a reason to refresh. Collapsing them tells someone
   * their tenancy looks inactive when in fact a fetch failed.
   */
  const [maintenanceFailed, setMaintenanceFailed] = useState(false)
  /** The fee whose detail sheet is open, keyed by its charge id. */
  const [openFee, setOpenFee] = useState<string | null>(null)
  /** The settled payment whose receipt is open. */
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null)
  // Set from the URL on mount, cleared once acted on — a ref, not state, so
  // arriving with `pay=1` doesn't cost an extra render.
  const autoPay = useRef(false)

  useEffect(() => { document.title = 'My Lease & Rent — HomeHive' }, [])

  /**
   * The "Pay rent" button in a reminder email links to `?tab=payments&pay=1`.
   * The tab itself is handled by `useUrlTab`; this only picks up the intent to
   * open the pay sheet, and does it in an effect rather than in initial state
   * so the server-rendered markup and the first client render agree.
   */
  useEffect(() => {
    autoPay.current = new URLSearchParams(window.location.search).get('pay') === '1'
  }, [])

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // A rent reminder deep-links here. Losing that destination at the login
      // wall is how a tenant ends up on the generic dashboard wondering where
      // the payment they clicked through to pay went.
      const dest = window.location.pathname + window.location.search
      router.push(`/login?next=${encodeURIComponent(dest)}`)
      return
    }
    setToken(session.access_token)
    const res = await fetch('/api/tenant/lease', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const json = await res.json().catch(() => ({}))
    setTenancies(json.tenancies ?? [])
    setLoading(false)

    // After the page is usable, not before it.
    fetch('/api/tenant/amendments', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => (r.ok ? r.json() : { amendments: [] }))
      .then(j => setAmendments(j.amendments ?? []))
      .catch(() => {})

    fetch('/api/tenant/maintenance', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status))
        const j = await r.json()
        setMaintenance(j.homes ?? [])
      })
      .catch(() => { setMaintenanceFailed(true); setMaintenance([]) })
  }, [router])

  useEffect(() => { load() }, [load])

  /**
   * A card that needed 3-D Secure leaves Stripe's page and comes back here with
   * the intent in the URL. There's no in-memory payment state left at that
   * point, so settle it on arrival and clear the query string — otherwise the
   * tenant returns to a page that still says they owe the rent they just paid.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const secret = params.get('payment_intent_client_secret')
    if (!secret) return
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/tenant/pay/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ clientSecret: secret }),
      })
      const json = await res.json().catch(() => ({}))
      // Keep the tab the tenant was on; drop only the payment parameters.
      const url = new URL(window.location.href)
      for (const k of ['payment_intent', 'payment_intent_client_secret', 'redirect_status', 'pay']) {
        url.searchParams.delete(k)
      }
      window.history.replaceState({}, '', url.pathname + (url.search || ''))
      if (json.status === 'duplicate') setFlash({ tone: 'warn', text: json.message })
      else if (json.status === 'paid') setFlash({ tone: 'good', text: 'Payment received. Thank you!' })
      else if (json.status === 'processing') setFlash({ tone: 'flight', text: 'Payment submitted — it shows as clearing until it settles.' })
      else if (json.status === 'failed') setFlash({ tone: 'bad', text: 'That payment didn’t go through. Please try again — nothing has been taken.' })
      load()
      setTimeout(() => setFlash(null), 9000)
    })()
  }, [load])

  const t = tenancies[active]

  /**
   * The shared maintenance for the tenancy currently being viewed.
   *
   * Matched on the lease, not the property: two tenancies can sit in the same
   * building, and the route already scoped each group to one active lease.
   * `null` while it is still loading, so the tab can hold its count back rather
   * than flash a confident "0".
   */
  const myMaintenance = useMemo(
    () => (maintenance === null || !t ? null : maintenance.find(h => h.lease_id === t.lease.id) ?? null),
    [maintenance, t],
  )

  /**
   * A lease schedules every month up front, so most rows sit unsettled for
   * months. Only what has actually reached its due date is *owed* — billing the
   * whole remaining lease would ask a tenant to prepay a year of rent.
   * Future months are shown separately and can be paid early by choice.
   */
  const { owed, upcoming, lateFees, waived, explanations } = useMemo(
    // One calculation, shared with the dashboard's balance tile and matching
    // what `POST /api/tenant/pay` prices — see src/lib/tenantCharges.ts for
    // the five rules it applies and why each one exists.
    () => tenantCharges(t?.scheduled ?? [], t?.specials ?? [], t?.lateFeeRule ?? null),
    [t],
  )

  /**
   * The landlord's explanation of a one-off charge, by charge id.
   *
   * `tenantCharges` deliberately carries only what pricing needs, so the note
   * is looked up here rather than threaded through the engine — a sentence of
   * presentation has no business in the money maths.
   */
  const specialNotes = useMemo(() => {
    const m = new Map<string, string>()
    for (const sp of t?.specials ?? []) if (sp.notes) m.set(sp.id, sp.notes)
    return m
  }, [t])
  const specialNote = (r: { kind: string; id: string }) =>
    r.kind === 'special' ? specialNotes.get(r.id) ?? null : null

  /**
   * What a set of charges actually comes to.
   *
   * Rent and late fees are summed together because that is what the tenant is
   * asked for. Quoting rent alone put a figure on the Pay button that the
   * payment sheet then disagreed with — the sheet has always charged the fee,
   * so the button was simply understating the bill.
   */
  const sumOf = (rows: Payable[]) => {
    const rent = rows.reduce((s, r) => s + r.amount, 0)
    const fees = rows.reduce((s, r) => s + (r.lateFee ?? 0), 0)
    return {
      rent: Math.round(rent * 100) / 100,
      fees: Math.round(fees * 100) / 100,
      total: Math.round((rent + fees) * 100) / 100,
    }
  }

  /**
   * "Which months was I behind?", answered in one sentence.
   *
   * A list of eleven rows is data; "you were late on 11 months, from August
   * 2025 to June 2026" is the thing a person actually wants to know before
   * they start reading the rows.
   */
  const feeSpan = (() => {
    if (lateFees.length === 0) return null
    const months = lateFees
      .map(r => explanations.get(r.id)?.dueDate)
      .filter((d): d is string => !!d)
      .sort()
    if (months.length === 0) return null
    const first = fmtMonthYear(months[0])
    const last = fmtMonthYear(months[months.length - 1])
    return { count: lateFees.length, first, last, same: first === last }
  })()

  const owedSum = sumOf(owed)
  const feeSum = sumOf(lateFees)
  /** Everything that would bring the account up to date: rent due now + every outstanding fee. */
  const upToDate = [...owed, ...lateFees]
  const totalOwed = Math.round((owedSum.total + feeSum.total) * 100) / 100
  const totalUpcoming = sumOf(upcoming).total
  // Paying ahead is allowed, but only ever by explicit choice.
  const selectedRows = [...owed, ...lateFees, ...upcoming].filter(r => selected.has(`${r.kind}-${r.id}`))
  const selectedTotal = sumOf(selectedRows).total

  /** The oldest unpaid due date — what "past due" is measured from. */
  const oldestOwed = useMemo(() => {
    if (!t) return null
    return owed
      .map(r => t.scheduled.find(s => s.id === r.id)?.due_date ?? t.specials.find(s => s.id === r.id)?.due_date)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null
  }, [owed, t])

  /**
   * Arriving from a reminder with `pay=1`: open the sheet on what is actually
   * owed, once that has loaded. If the rent turns out to be settled already we
   * simply land on the Payments tab — never an empty payment sheet.
   */
  useEffect(() => {
    if (!autoPay.current || loading) return
    autoPay.current = false
    // Rent *and* fees: arriving from a reminder, "pay" means bring the account
    // up to date, not pay the rent and leave the fee behind.
    const everything = [...owed, ...lateFees]
    if (everything.length === 0) return
    setSelected(new Set(everything.map(r => `${r.kind}-${r.id}`)))
    setPaying(everything)
  }, [loading, owed, lateFees])

  const history = useMemo(() => {
    if (!t) return []
    const property = t.lease.property?.name ?? 'Your home'
    const unit = t.lease.unit_number
    return [
      ...t.scheduled.filter(s => isSettled(s.status)).map((s): Receipt & { sortDate: string | null } => ({
        id: s.id, kind: 'Rent', label: `Rent — ${fmtDate(s.due_date)}`,
        // Rent received plus any late fee received: what actually left the
        // tenant's account, so the row reconciles against their statement.
        amount: Math.round(((s.paid_amount || s.amount) + s.late_fee_paid) * 100) / 100,
        lateFee: s.late_fee_paid,
        processingFee: s.processing_fee,
        date: s.paid_date, status: s.status,
        method: s.payment_method as SettledMethod | null,
        property, unit, note: s.notes, sortDate: s.paid_date,
      })),
      ...t.specials.filter(s => isSettled(s.status)).map((s): Receipt & { sortDate: string | null } => ({
        id: s.id, kind: s.category === 'security_deposit' ? 'Deposit' : 'Charge', label: s.label,
        amount: s.amount, lateFee: 0, processingFee: s.processing_fee,
        date: s.paid_date, status: s.status,
        method: s.payment_method as SettledMethod | null,
        property, unit, note: s.notes, sortDate: s.paid_date,
      })),
    ].sort((a, b) => (b.sortDate ?? '').localeCompare(a.sortDate ?? ''))
  }, [t])

  /** What they have actually paid on this tenancy, for the Payments header. */
  const paidToDate = useMemo(
    () => Math.round(history.reduce((n, h) => n + h.amount, 0) * 100) / 100,
    [history],
  )

  const toggle = (r: Payable) => {
    const key = `${r.kind}-${r.id}`
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const payAll = () => {
    setSelected(new Set(upToDate.map(r => `${r.kind}-${r.id}`)))
    setPaying(upToDate)
  }

  if (loading) return <><TenantStyles css={CSS} /><PageSkeleton cards={3} /></>

  if (!t) {
    return (
      <>
        <TenantStyles css={CSS} />
        <div className="tp tp-wrap">
          <Empty
            icon="fileText"
            title="No active lease yet"
            action={<Link href="/homes" className="tp-btn tp-btn-primary">Browse homes near ASU</Link>}
          >
            Once your landlord adds you to a lease it appears here, with your rent, your payment
            history, your receipts and the option to pay online.
          </Empty>
        </div>
      </>
    )
  }

  const nextDue = t.scheduled.find(s => !isSettled(s.status) && !isVoided(s.status))
  const myAmendments = amendments.filter(a => a.lease_id === t.lease.id)
  const pendingAmendments = myAmendments.filter(a => a.status === 'sent')
  const payable = !t.lease.is_demo

  return (
    <>
      <TenantStyles css={CSS} />
      <div className="tp tp-wrap">

        {tenancies.length > 1 && (
          <div className="tl-switch" role="tablist" aria-label="Your tenancies">
            {tenancies.map((x, i) => (
              <button
                key={x.lease.id}
                role="tab"
                aria-selected={i === active}
                className={`tl-sw${i === active ? ' on' : ''}`}
                onClick={() => { setActive(i); setSelected(new Set()) }}
              >
                {x.lease.property?.name ?? 'Lease'}
              </button>
            ))}
          </div>
        )}

        {/* ── THE BALANCE ──────────────────────────────────────────────────
            One figure, display size, with the one action that clears it. This
            was the first of four identical 17px tiles. ── */}
        <div className="tp-panel">
          <div className="tp-panel-eyebrow">
            {totalOwed > 0 ? 'Balance due' : 'Your balance'}
          </div>
          <div className="tl-home">
            <div style={{ minWidth: 0 }}>
              <div className="tl-home-name">{t.lease.property?.name ?? 'My lease'}</div>
              <div className="tp-panel-sub">
                {t.lease.property?.address}
                {t.lease.unit_number ? ` · ${t.lease.unit_number}` : ''}
              </div>
            </div>
          </div>
          <div className="tp-panel-fig tp-money">
            {totalOwed > 0 ? fmtMoney(totalOwed) : 'Paid up'}
          </div>
          <div className="tp-panel-sub">
            {totalOwed > 0
              ? <>
                  {oldestOwed
                    ? <>Oldest charge was due <strong>{fmtShort(oldestOwed)}</strong>. </>
                    : null}
                  {feeSum.total > 0 && (
                    <>Includes <strong>{fmtMoney(feeSum.total)}</strong> in late fees.</>
                  )}
                </>
              : nextDue
                ? <>Nothing is outstanding. Your next rent of{' '}
                   <strong>{fmtMoney(nextDue.amount)}</strong> is due {fmtShort(nextDue.due_date)}.</>
                : 'Nothing is outstanding on this lease.'}
          </div>
          {totalOwed > 0 && payable && (
            <div className="tp-panel-actions">
              <button className="tp-btn tp-btn-accent lg" onClick={payAll}>
                {/* One button that clears everything. When fees are in play,
                    say so — "Pay $2,931.96" with no explanation of why it is
                    more than the rent is how a tenant decides not to. */}
                {feeSum.total > 0 && owedSum.total > 0
                  ? `Bring account up to date · ${fmtMoney(totalOwed)}`
                  : `Pay ${fmtMoney(totalOwed)}`}
              </button>
            </div>
          )}
          <div className="tp-panel-grid">
            <div>
              <div className="tp-panel-l">Your rent</div>
              <div className="tp-panel-v">{t.me ? `${fmtMoney(t.me.monthly_total)}/mo` : '—'}</div>
            </div>
            <div>
              <div className="tp-panel-l">Next due</div>
              <div className="tp-panel-v">{nextDue ? fmtShort(nextDue.due_date) : 'Nothing due'}</div>
            </div>
            <div>
              <div className="tp-panel-l">Lease ends</div>
              <div className="tp-panel-v">{fmtShort(t.lease.end_date)}</div>
            </div>
          </div>
        </div>

        <StripeModeBanner style={{ marginBottom: 14 }} />

        {/* A demo lease carries no schedule at all, so the page would otherwise
            show a tenancy with an unexplained blank ledger. */}
        {t.lease.is_demo && (
          <div className="tp-note info">
            <strong>This is a demo lease.</strong> No rent is collected on it — nothing here is
            due, and nothing can be charged to you.
          </div>
        )}

        {/* The lease exists and has payers on it, but none of them is
            recognisably this tenant. Saying "no lease" would be a lie, and
            silently showing zeros would be worse — name the problem and give
            them the one action that fixes it. */}
        {!t.lease.is_demo && t.unmatchedPlan && (
          <div className="tp-note warn">
            <strong>We can&apos;t match your account to this lease.</strong> Your landlord has a rent
            schedule for this home, but none of the payers on it is recorded under{' '}
            <strong>your email address</strong>. Ask them to add it to your payer record and this
            page will fill in.
          </div>
        )}

        {flash && (
          <div className={`tp-note ${flash.tone}`} role="status" aria-live="polite">
            {flash.text}
          </div>
        )}

        {/* ── Lease changes ───────────────────────────────────────────────────
            Unsigned ones are the loudest thing on the page bar an overdue
            balance: a document waiting on a signature is a thing the tenant has
            to do, and it is their landlord waiting. Signed ones stay visible as
            a quiet row — this is where their copy lives. */}
        <AmendmentNotices amendments={myAmendments} />

        <Tabs<Tab>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'payments', label: 'Payments', badge: owed.length + lateFees.length },
            { id: 'maintenance', label: 'Maintenance', badge: myMaintenance?.pending.length },
            { id: 'lease', label: 'Lease details', badge: pendingAmendments.length },
          ]}
        />

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <>
            {/* ── Late fees ────────────────────────────────────────────────
                First, and above the rent, because for most tenants here the
                rent is already paid and this is the only thing they owe.
                Folded into "Due now" it would read as a rent charge they had
                already settled, which is the fastest way to a support email. */}
            {lateFees.length > 0 && (
              <div className="tp-card fee">
                <div className="tp-card-hd">
                  <span className="tp-card-title">
                    Late fees owed <span className="tp-card-count">{lateFees.length}</span>
                  </span>
                  <span className="tp-card-note fee tp-money">{fmtMoney(feeSum.total)}</span>
                </div>
                <div className="tp-card-bd">
                  <div className="tp-note warn" style={{ marginBottom: 14 }}>
                    {feeSpan && (
                      <strong style={{ display: 'block', marginBottom: 2 }}>
                        {feeSpan.same
                          ? `Your ${feeSpan.first} rent arrived late.`
                          : `You were late on ${feeSpan.count} ${feeSpan.count === 1 ? 'month' : 'months'}, from ${feeSpan.first} to ${feeSpan.last}.`}
                      </strong>
                    )}
                    {lateFees.every(r => r.rentSettled)
                      ? <>Your rent is paid in full — these fees were charged at the time because
                         it arrived after the due date, and were never collected. Tap any month to
                         see exactly how its fee was worked out.</>
                      : <>These were charged because rent arrived, or is still arriving, after its
                         due date. Tap any month to see how its fee was worked out.</>}
                  </div>
                  {lateFees.map(r => {
                    const x = explanations.get(r.id)
                    return (
                      <button
                        key={`${r.kind}-${r.id}`}
                        className="tp-row-link"
                        onClick={() => setOpenFee(r.id)}
                        aria-label={`How the late fee for ${r.label} was worked out`}
                      >
                        <span className="tp-row-main">
                          <span className="tp-row-label">{r.label}</span>
                          <em className="tp-row-sub">
                            {x
                              ? `Paid ${x.rentSettled ? fmtShort(x.paidDate) : 'not yet'} · ${x.daysPastDue} ${x.daysPastDue === 1 ? 'day' : 'days'} late · ${x.periods} × ${fmtMoney(x.perPeriod)}`
                              : `${r.daysLate} days late`}
                          </em>
                        </span>
                        <span className="tl-row-right">
                          <span className="tp-row-amt tp-money">{fmtMoney(r.lateFee ?? 0)}</span>
                          <Icon name="chevronRight" size={16} style={{ color: 'var(--ink-4)' }} />
                        </span>
                      </button>
                    )
                  })}
                </div>
                {payable && (
                  <div className="tp-card-ft tl-ft">
                    <button
                      className="tp-btn tp-btn-primary"
                      onClick={() => { setSelected(new Set(lateFees.map(x => `${x.kind}-${x.id}`))); setPaying(lateFees) }}
                    >
                      Pay late fees · {fmtMoney(feeSum.total)}
                    </button>
                    {owedSum.total > 0 && (
                      <button className="tp-btn tp-btn-secondary" onClick={payAll}>
                        Pay everything · {fmtMoney(totalOwed)}
                      </button>
                    )}
                    <span className="tp-hint" style={{ flexBasis: '100%' }}>
                      You can pay these on their own, one at a time from the Payments tab, or
                      together with your rent. Questions about a fee? Contact your landlord — they
                      can waive it.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Due now ─────────────────────────────────────────────────── */}
            {owed.length > 0 && (
              <div className="tp-card">
                <div className="tp-card-hd">
                  <span className="tp-card-title">
                    Due now <span className="tp-card-count">{owed.length}</span>
                  </span>
                  <span className="tp-card-note owed tp-money">{fmtMoney(owedSum.total)}</span>
                </div>
                {/* Only what has reached its due date — never the whole lease. */}
                <div className="tp-card-bd">
                  {owed.map(r => (
                    <div key={`${r.kind}-${r.id}`} className="tp-row">
                      <span>
                        {r.label}
                        {/* The fee is named on its own, never folded into the
                            rent figure — a larger rent line is indistinguishable
                            from a rent increase. */}
                        {(r.lateFee ?? 0) > 0 && (
                          <em className="tl-lf"> + {fmtMoney(r.lateFee!)} late fee</em>
                        )}
                        {specialNote(r) && <em className="tp-row-note">{specialNote(r)}</em>}
                      </span>
                      <span className="tp-row-amt tp-money">{fmtMoney(r.amount + (r.lateFee ?? 0))}</span>
                    </div>
                  ))}
                </div>
                {payable && (
                  <div className="tp-card-ft">
                    <button
                      className="tp-btn tp-btn-primary"
                      onClick={() => { setSelected(new Set(owed.map(x => `${x.kind}-${x.id}`))); setPaying(owed) }}
                    >
                      Pay {fmtMoney(owedSum.total)}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── What the rent covers ───────────────────────────────────── */}
            <div className="tp-card">
              <div className="tp-card-hd">
                <span className="tp-card-title">What your rent covers</span>
                <span className="tp-card-note tp-money">
                  {t.me ? `${fmtMoney(t.me.monthly_total)}/mo` : '—'}
                </span>
              </div>
              <div className="tp-card-bd">
                {t.lineItems.length === 0 ? (
                  <div className="tp-muted">
                    Your rent is {t.me ? fmtMoney(t.me.monthly_total) : '—'} a month, charged as a
                    single amount — your landlord hasn&apos;t broken it into separate items.
                  </div>
                ) : (
                  <>
                    {t.lineItems.map(li => (
                      <div key={li.id} className="tp-row">
                        <span>
                          {li.label}
                          {/* The explanation sits with the charge, not in an
                              email the tenant has to go and find. A line they
                              cannot account for is the one that gets disputed. */}
                          {li.notes && <em className="tp-row-note">{li.notes}</em>}
                        </span>
                        <span className="tp-row-amt tp-money">{fmtMoney(li.amount)}</span>
                      </div>
                    ))}
                    <div className="tp-row total">
                      <span>Your monthly total</span>
                      <span className="tp-row-amt tp-money">{fmtMoney(t.me?.monthly_total ?? 0)}</span>
                    </div>
                  </>
                )}
                {t.housemateCount > 0 && (
                  <div className="tp-hint" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <Icon name="users" size={15} style={{ marginTop: 1 }} />
                    <span>
                      You share this home with {t.housemateCount} other{t.housemateCount !== 1 ? 's' : ''}.
                      You only ever see and pay your own share.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Fees that were forgiven ─────────────────────────────────
                Kept as a standing record rather than a disappearance. A tenant
                who was chased for a $105 fee and then saw it vanish has no way
                to know whether it was cancelled or is merely not being shown
                this week, and the landlord gets no credit for a decision that
                cost them real money. Stated plainly, with the date and their
                landlord's own words, it is the most trust-building thing on
                this screen — and it is the tenant's receipt if it is ever
                raised again. */}
            {waived.length > 0 && (
              <div className="tp-card paid">
                <div className="tp-card-hd">
                  <span className="tp-card-title">
                    Late fees waived <span className="tp-card-count">{waived.length}</span>
                  </span>
                  <span className="tp-card-note paid tp-money">
                    {fmtMoney(waived.reduce((n, w) => n + w.amount, 0))} cleared
                  </span>
                </div>
                <div className="tp-card-bd">
                  <div className="tp-note good" style={{ marginBottom: 12 }}>
                    Your landlord cancelled {waived.length === 1 ? 'this late fee' : 'these late fees'}.
                    You owe nothing on {waived.length === 1 ? 'it' : 'them'} — this is your record of
                    the change, kept here in case it ever comes up again.
                  </div>
                  {waived.map(w => (
                    <div key={w.id} className="tp-row">
                      <span className="tp-row-main">
                        <span className="tp-row-label">{w.label}</span>
                        <em className="tp-row-sub">Waived {fmtDate(w.waivedOn.slice(0, 10))}</em>
                        {w.note && <em className="tl-quote">&ldquo;{w.note}&rdquo;</em>}
                      </span>
                      <span className="tl-waived tp-money">{fmtMoney(w.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming rent belongs on the page a tenant actually lands on.
                Hiding it behind the Payments tab is why "when is my next rent
                due, and how much" read as unanswerable. */}
            {upcoming.length > 0 && (
              <div className="tp-card">
                <div className="tp-card-hd">
                  <span className="tp-card-title">
                    Upcoming <span className="tp-card-count">{upcoming.length}</span>
                  </span>
                  <span className="tp-card-note tp-money">{fmtMoney(totalUpcoming)}</span>
                </div>
                <div className="tp-card-bd">
                  {upcoming.slice(0, 4).map(r => (
                    <div key={`${r.kind}-${r.id}`} className="tp-row">
                      <span>
                        {r.label}
                        {specialNote(r) && <em className="tp-row-note">{specialNote(r)}</em>}
                      </span>
                      <span className="tp-row-amt tp-money">{fmtMoney(r.amount)}</span>
                    </div>
                  ))}
                  <div className="tp-hint" style={{ marginTop: 12 }}>
                    {upcoming.length > 4 ? `And ${upcoming.length - 4} more. ` : ''}
                    Not due yet — you don&apos;t need to pay these now.
                  </div>
                </div>
                <div className="tp-card-ft">
                  <button className="tp-btn tp-btn-secondary" onClick={() => setTab('payments')}>
                    {owed.length > 0 ? 'See all payments' : 'Pay ahead'}
                  </button>
                </div>
              </div>
            )}

            {totalOwed === 0 && upcoming.length === 0 && history.length > 0 && (
              <div className="tp-note good">
                <strong>Nothing is outstanding and nothing is scheduled.</strong> Every charge on
                this lease has been settled. Your receipts are on the Payments tab.
              </div>
            )}
          </>
        )}

        {/* ══ PAYMENTS ══ */}
        {tab === 'payments' && (
          <>
            <div className="tp-stats">
              <Stat label="Due now" tone={totalOwed > 0 ? 'owed' : 'paid'}
                value={<span className="tp-money">{fmtMoney(totalOwed)}</span>} />
              <Stat label="Paid to date"
                value={<span className="tp-money">{fmtMoney(paidToDate)}</span>} />
              <Stat label="Scheduled ahead"
                value={<span className="tp-money">{fmtMoney(totalUpcoming)}</span>} />
            </div>

            <div className="tp-card">
              <div className="tp-card-hd">
                <span className="tp-card-title">Due now</span>
                <span className="tl-hd-actions">
                  {upToDate.length > 1 && selectedRows.length < upToDate.length && (
                    <button
                      className="tp-btn tp-btn-ghost sm"
                      onClick={() => setSelected(new Set(upToDate.map(r => `${r.kind}-${r.id}`)))}
                    >
                      Select all
                    </button>
                  )}
                  {selectedRows.length > 0 && payable && (
                    <button className="tp-btn tp-btn-primary sm" onClick={() => setPaying(selectedRows)}>
                      Pay {fmtMoney(selectedTotal)}
                    </button>
                  )}
                </span>
              </div>
              <div className="tp-card-bd">
                {/* Fees first, individually tickable — "separate or all
                    together" is only true if a tenant can pick one. */}
                {lateFees.map(r => {
                  const key = `${r.kind}-${r.id}`
                  const x = explanations.get(r.id)
                  return (
                    <div key={key} className="tl-pickfee">
                      <label className="tp-pick">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(r)}
                          aria-label={`Pay the ${r.label} late fee of ${fmtMoney(r.lateFee ?? 0)}`}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="tp-row-label">Late fee · {r.label}</span>
                          <em className="tp-row-sub">
                            {x ? `${x.daysPastDue} ${x.daysPastDue === 1 ? 'day' : 'days'} late · ${x.periods} × ${fmtMoney(x.perPeriod)}` : ''}
                            {r.rentSettled ? ' · rent paid' : ''}
                          </em>
                        </span>
                        <span className="tp-row-amt tp-money">{fmtMoney(r.lateFee ?? 0)}</span>
                      </label>
                      {/* Outside the label, so opening the details cannot tick
                          the box by accident. */}
                      <button className="tl-why" onClick={() => setOpenFee(r.id)}>
                        Why this amount?
                      </button>
                    </div>
                  )
                })}
                {owed.length === 0 && lateFees.length === 0 ? (
                  <div className="tl-allpaid">
                    <Icon name="checkCircle" size={18} style={{ color: 'var(--paid)' }} />
                    <span>
                      <strong>You&apos;re all paid up</strong> — nothing is due right now.
                      {upcoming.length > 0 && ' Your next rent is listed below.'}
                    </span>
                  </div>
                ) : owed.map(r => {
                  const key = `${r.kind}-${r.id}`
                  return (
                    <label key={key} className="tp-pick">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggle(r)}
                        aria-label={`Pay ${r.label}, ${fmtMoney(r.amount + (r.lateFee ?? 0))}`}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {r.label}
                        {(r.lateFee ?? 0) > 0 && (
                          <em className="tl-lf"> + {fmtMoney(r.lateFee!)} late fee</em>
                        )}
                      </span>
                      <span className="tp-row-amt tp-money">{fmtMoney(r.amount + (r.lateFee ?? 0))}</span>
                    </label>
                  )
                })}
              </div>
              {totalOwed > 0 && payable && (
                <div className="tp-card-ft">
                  <button className="tp-btn tp-btn-primary" onClick={payAll}>
                    Pay everything due · {fmtMoney(totalOwed)}
                  </button>
                </div>
              )}
            </div>

            {/* Scheduled ahead — visible for planning, never billed by default. */}
            {upcoming.length > 0 && (
              <div className="tp-card">
                <div className="tp-card-hd">
                  <span className="tp-card-title">
                    Upcoming <span className="tp-card-count">{upcoming.length}</span>
                  </span>
                  <span className="tp-card-note tp-money">{fmtMoney(totalUpcoming)}</span>
                </div>
                <div className="tp-card-bd">
                  <div className="tp-hint" style={{ marginBottom: 12 }}>
                    Not due yet — you don&apos;t need to pay these now. Tick any month to pay ahead.
                  </div>
                  {upcoming.map(r => {
                    const key = `${r.kind}-${r.id}`
                    return (
                      <label key={key} className="tp-pick upcoming">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(r)}
                          aria-label={`Pay ${r.label} early, ${fmtMoney(r.amount)}`}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>{r.label}</span>
                        <span className="tp-row-amt tp-money">{fmtMoney(r.amount)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="tp-card">
              <div className="tp-card-hd">
                <span className="tp-card-title">
                  Payment history <span className="tp-card-count">{history.length}</span>
                </span>
                {history.length > 0 && (
                  <span className="tp-card-note paid tp-money">{fmtMoney(paidToDate)}</span>
                )}
              </div>
              <div className="tp-card-bd">
                {history.length === 0 ? (
                  <div className="tp-muted">
                    No payments recorded yet. Anything you pay here — or that your landlord records
                    by hand — appears as a receipt you can print.
                  </div>
                ) : (
                  <>
                    <div className="tp-hint" style={{ marginBottom: 10 }}>
                      Tap any payment for a printable receipt.
                    </div>
                    {history.map(h => {
                      const m = h.method ? METHOD_META[h.method] : null
                      return (
                        <button
                          key={`${h.kind}-${h.id}`}
                          className="tp-row-link"
                          onClick={() => setOpenReceipt(h)}
                          aria-label={`Receipt for ${h.label}, ${fmtMoney(h.amount)}`}
                        >
                          <span className="tp-row-main">
                            <span className="tl-hist-l">
                              <span className="tl-kind">{h.kind}</span>
                              {h.label}
                            </span>
                            <em className="tp-row-sub">
                              {h.status === 'processing' ? 'Bank transfer clearing' : `Paid ${fmtShort(h.date)}`}
                              {m ? ` · ${m.label}` : ' · recorded by your landlord'}
                              {h.lateFee > 0 ? ` · incl. ${fmtMoney(h.lateFee)} late fee` : ''}
                            </em>
                          </span>
                          <span className="tl-row-right">
                            <span className="tl-hist-amt">
                              <span className="tp-row-amt tp-money">{fmtMoney(h.amount)}</span>
                              {h.status === 'processing' && <Badge tone="clearing">Clearing</Badge>}
                            </span>
                            <Icon name="chevronRight" size={16} style={{ color: 'var(--ink-4)' }} />
                          </span>
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* ══ MAINTENANCE ══
            What is being done to the home they live in. Shown only where the
            landlord shared the item and only to an active lease holder — the
            route decides both; this just draws what it was handed. No costs,
            no vendor numbers: that is the landlord's ledger, not the tenant's
            business, and the engine never sends it. */}
        {tab === 'maintenance' && (
          <MaintenancePanel
            home={myMaintenance}
            loading={maintenance === null}
            failed={maintenanceFailed}
          />
        )}

        {/* ══ LEASE DETAILS ══ */}
        {tab === 'lease' && (
          <>
            <div className="tp-card">
              <div className="tp-card-hd"><span className="tp-card-title">Your tenancy</span></div>
              <div className="tp-card-bd">
                <div className="tp-row"><span>Property</span><span className="tp-row-amt">{t.lease.property?.name ?? '—'}</span></div>
                <div className="tp-row"><span>Address</span><span className="tp-row-amt">{t.lease.property?.address ?? '—'}</span></div>
                {t.lease.unit_number && <div className="tp-row"><span>Room / unit</span><span className="tp-row-amt">{t.lease.unit_number}</span></div>}
                <div className="tp-row"><span>Term</span><span className="tp-row-amt">{fmtDate(t.lease.start_date)} – {fmtDate(t.lease.end_date)}</span></div>
                <div className="tp-row"><span>Your monthly rent</span><span className="tp-row-amt tp-money">{t.me ? fmtMoney(t.me.monthly_total) : '—'}</span></div>
                {t.plan && <div className="tp-row"><span>Rent due</span><span className="tp-row-amt">{t.plan.due_day}{ord(t.plan.due_day)} of each month</span></div>}
                {t.housemateCount > 0 && (
                  <div className="tp-row"><span>Housemates</span><span className="tp-row-amt">{t.housemateCount}</span></div>
                )}
              </div>
            </div>

            {/* The late-fee rule, stated before it ever costs anybody anything.
                It was one row in a table of eight; a tenant who has never been
                charged a fee has no idea what the rule is until the day they
                are, which is the worst moment to learn it. */}
            <div className="tp-card">
              <div className="tp-card-hd"><span className="tp-card-title">If rent is late</span></div>
              <div className="tp-card-bd">
                {t.lateFeeRule ? (
                  <>
                    <div className="tp-row">
                      <span>Late fee</span>
                      <span className="tp-row-amt tp-money">
                        {fmtMoney(t.lateFeeRule.fee_amount)} per{' '}
                        {t.lateFeeRule.frequency_days === 1 ? 'day' : `${t.lateFeeRule.frequency_days} days`}
                      </span>
                    </div>
                    <div className="tp-row">
                      <span>Grace period</span>
                      <span className="tp-row-amt">
                        {t.lateFeeRule.grace_period_days > 0
                          ? `${t.lateFeeRule.grace_period_days} ${t.lateFeeRule.grace_period_days === 1 ? 'day' : 'days'} after the due date`
                          : 'None — the fee starts the day after rent is due'}
                      </span>
                    </div>
                    {t.lateFeeRule.max_total_fees != null && (
                      <div className="tp-row">
                        <span>Most it can reach</span>
                        <span className="tp-row-amt tp-money">{fmtMoney(t.lateFeeRule.max_total_fees)}</span>
                      </div>
                    )}
                    <div className="tp-hint" style={{ marginTop: 12 }}>
                      A fee stops growing the moment you submit the payment, not when it clears —
                      so a bank transfer sent on the due date is on time even though it takes a few
                      days to arrive.
                    </div>
                  </>
                ) : (
                  <div className="tp-muted">
                    Your landlord hasn&apos;t set a late fee on this lease. Rent is still due on
                    the date shown above.
                  </div>
                )}
              </div>
            </div>

            {/* Their copy of every change to the lease, including the ones they
                said no to. */}
            {myAmendments.length > 0 && (
              <div className="tp-card">
                <div className="tp-card-hd">
                  <span className="tp-card-title">
                    Changes to your lease <span className="tp-card-count">{myAmendments.length}</span>
                  </span>
                </div>
                <div className="tp-card-bd">
                  {myAmendments.map(a => (
                    <Link key={a.id} href={amendmentPath(a.token)} className="tp-row-link">
                      <span className="tp-row-main">
                        <span className="tp-row-label">{a.title}</span>
                        <em className="tp-row-sub">
                          {a.status === 'signed' ? `Signed ${fmtAmendDate(a.signature_date)}`
                            : a.status === 'declined' ? 'You declined this'
                            : a.status === 'withdrawn' ? 'Withdrawn by your landlord'
                            : 'Waiting for your signature'}
                          {' · effective '}{fmtAmendDate(a.effective_date)}
                        </em>
                      </span>
                      <span className="tl-row-right">
                        <Badge tone={
                          a.status === 'signed' ? 'paid'
                            : a.status === 'declined' ? 'owed'
                            : a.status === 'withdrawn' ? 'idle' : 'fee'
                        }>
                          {a.status === 'sent' ? 'Sign' : a.status}
                        </Badge>
                        <Icon name="chevronRight" size={16} style={{ color: 'var(--ink-4)' }} />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="tp-card">
              <div className="tp-card-hd"><span className="tp-card-title">Something not right?</span></div>
              <div className="tp-card-bd">
                <div className="tp-muted">
                  HomeHive shows what your landlord has recorded. If a figure, a date or a charge
                  on this page looks wrong, they are the ones who can change it — and a fee they
                  charged is theirs to waive.
                </div>
                <div className="tp-hint" style={{ marginTop: 10 }}>
                  Problems with the site itself, rather than with your tenancy:{' '}
                  <a href="mailto:hello@homehive.live" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                    hello@homehive.live
                  </a>.
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {openFee && explanations.get(openFee) && (
        <LateFeeDetailSheet
          explanation={explanations.get(openFee)!}
          onClose={() => setOpenFee(null)}
          onPay={payable ? () => {
            const row = lateFees.find(r => r.id === openFee)
            setOpenFee(null)
            if (!row) return
            setSelected(new Set([`${row.kind}-${row.id}`]))
            setPaying([row])
          } : undefined}
        />
      )}

      {openReceipt && (
        <ReceiptSheet receipt={openReceipt} onClose={() => setOpenReceipt(null)} />
      )}

      {paying && (
        <PayRentModal
          payables={paying}
          authToken={token}
          onClose={() => setPaying(null)}
          onPaid={(_m, ach) => {
            setPaying(null)
            setSelected(new Set())
            setFlash(ach
              ? { tone: 'flight', text: 'Payment submitted. Bank transfers take 2–5 business days to clear — it shows as clearing until then.' }
              : { tone: 'good', text: 'Payment received. Thank you! Your receipt is in payment history.' })
            setTimeout(() => { load(); setFlash(null) }, 6000)
            load()
          }}
        />
      )}
    </>
  )
}

/**
 * The tenant's maintenance panel: what's open on their home, and what's done.
 *
 * Two lists, because that is the whole question — "is anyone dealing with my
 * thing" and "did the stuff they promised actually happen". The completed list
 * is not filler: it is the only evidence a tenant has that reporting something
 * here leads anywhere, and it is what makes them report the next thing instead
 * of waiting for it to become an emergency.
 *
 * Deliberately read-only. A "report an issue" button belongs here eventually,
 * but half a reporting flow — a form with no routing, no acknowledgement and no
 * SLA — is worse than an honest "contact your landlord", which is what the
 * footer says.
 */
function MaintenancePanel({
  home, loading, failed,
}: {
  home: MaintenanceHome | null; loading: boolean; failed: boolean
}) {
  if (loading) {
    return (
      <>
        <div className="tp-sk tp-sk-line" style={{ width: '55%', height: 16, marginBottom: 16 }} />
        <div className="tp-sk tp-sk-card" />
        <div className="tp-sk tp-sk-card" />
      </>
    )
  }

  // Said before the "no active tenancy" message below, because a failed fetch
  // must never be reported as a fact about this person's lease.
  if (failed) {
    return (
      <div className="tp-note warn">
        <strong>We couldn&apos;t load your maintenance updates.</strong> Refresh the page to try
        again — your rent, payment history and receipts are unaffected.
      </div>
    )
  }

  // No group at all means this tenancy isn't active (ended, or not started) —
  // the route only builds groups for live leases. Say that plainly rather than
  // showing an empty list that looks broken.
  if (!home) {
    return (
      <Empty icon="wrench" title="No maintenance to show">
        Updates are shown while your tenancy is active. If you think that&apos;s wrong, check the
        dates on the Lease details tab or contact your landlord.
      </Empty>
    )
  }

  const { pending, completed, summary } = home

  return (
    <>
      <div className="tp-card">
        <div className="tp-card-bd">
          <div className="tl-mx-headline">{summary.headline}</div>
          {summary.scheduledNext && (
            <div className="tp-muted" style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <Icon name="calendar" size={15} style={{ marginTop: 2, color: 'var(--primary)' }} />
              <span>
                Next date booked: <strong>
                  {fmtDate(summary.scheduledNext.scheduled_for || summary.scheduledNext.target_date)}
                </strong> — {summary.scheduledNext.title}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="tp-card">
        <div className="tp-card-hd">
          <span className="tp-card-title">
            Open{pending.length > 0 && <span className="tp-card-count">{pending.length}</span>}
          </span>
        </div>
        <div className="tp-card-bd">
          {pending.length === 0 ? (
            <div className="tp-muted">Nothing is open on this home right now.</div>
          ) : (
            pending.map(i => <MxRow key={i.id} item={i} />)
          )}
        </div>
      </div>

      {completed.length > 0 && (
        <div className="tp-card">
          <div className="tp-card-hd">
            <span className="tp-card-title">
              Completed <span className="tp-card-count">{completed.length}</span>
            </span>
          </div>
          <div className="tp-card-bd">
            {completed.map(i => <MxRow key={i.id} item={i} />)}
          </div>
        </div>
      )}

      <div className="tp-hint" style={{ marginTop: 4 }}>
        This is the work your landlord has chosen to share with you — it may not be everything
        they have planned for the building. Something urgent or unlisted? Contact them directly.
      </div>
    </>
  )
}

/** One maintenance item as a tenant reads it. No money, ever. */
function MxRow({ item }: { item: TenantWorkItem }) {
  // `cancelled` is filtered out upstream in both the route and the engine, so
  // the lookup is always a hit; the fallback keeps a hand-written status from
  // throwing in a tenant's face.
  const s = TENANT_STATUS_META[item.status as keyof typeof TENANT_STATUS_META]
    ?? { label: item.status, blurb: '', color: '#6E5B59', bg: '#F6F2EF', done: false }

  // One date line, and it says what the date *means*. "Nov 20" alone next to an
  // open job is ambiguous in the worst direction — the tenant reads it as a
  // promise whichever kind of date it actually was.
  const when = item.status === 'completed' && item.completed_at
    ? `Completed ${fmtDate(item.completed_at.slice(0, 10))}`
    : item.scheduled_for
      ? `Booked for ${fmtDate(item.scheduled_for)}`
      : item.target_date
        ? `Aiming for ${fmtDate(item.target_date)}`
        : null

  return (
    <div className={`tl-mx${s.done ? ' done' : ''}`}>
      <div style={{ minWidth: 0 }}>
        <div className="tp-row-label">{item.title}</div>
        <div className="tp-row-sub">
          {tenantKindLabel(item.kind)}
          {item.area ? ` · ${item.area}` : ''}
          {when ? ` · ${when}` : ''}
        </div>
        {/* The landlord's own `description` is never sent here — only the note
            they wrote to the tenant. See shapeForTenant. */}
        {item.note && <div className="tl-mx-note">{item.note}</div>}

        {/* The progress log. This is the part that answers "is anything
            actually happening", which the status pill alone never does — and
            the photos are what make a "completed" believable. */}
        {item.updates.length > 0 && (
          <div className="tl-log">
            {item.updates.map(u => (
              <div key={u.id}>
                <div className="tl-log-when">{fmtStamp(u.created_at)}</div>
                {u.body && <div className="tl-log-body">{u.body}</div>}
                {u.photos.length > 0 && (
                  <div className="tl-shots">
                    {u.photos.map(p => (
                      // A plain link, not a lightbox: opening the real image in
                      // a new tab lets a tenant zoom, save and forward it with
                      // their own tools, which is what they do with a photo of
                      // their own home anyway.
                      <a
                        key={p.id}
                        className="tl-shot"
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        title={p.caption ?? 'Open photo'}
                      >
                        <img src={p.url} alt={p.caption ?? 'Maintenance photo'} loading="lazy" />
                        {p.caption && <span className="tl-shot-cap">{p.caption}</span>}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="tp-badge" style={{ background: s.bg, color: s.color }} title={s.blurb}>
        {s.label}
      </span>
    </div>
  )
}

/**
 * The tenant's amendments, above the tabs.
 *
 * Two shapes, because they are two different things. An unsigned amendment is a
 * task with a deadline-shaped feeling and gets a full card with the terms on
 * it; a signed one is a receipt and lives on the Lease details tab, where their
 * copies are kept. Declined and withdrawn amendments are deliberately kept
 * there too — a tenant who said no should be able to see that they said no,
 * rather than wonder whether they imagined being asked.
 */
function AmendmentNotices({ amendments }: { amendments: MyAmendment[] }) {
  const pending = amendments.filter(a => a.status === 'sent')
  if (pending.length === 0) return null

  return (
    <>
      {pending.map(a => (
        <div key={a.id} className="tp-card act">
          <div className="tp-card-bd">
            <div className="tl-am-k">
              <Icon name="signature" size={15} />Signature needed
            </div>
            <div className="tl-am-t">{a.title}</div>
            <div className="tp-muted" style={{ marginTop: 5 }}>
              {/* The money, read off the row rather than summarised. A card that
                  says "and nothing else to pay" beside a document carrying a
                  $300 deposit is worse than a card that says nothing at all. */}
              {a.monthly_charge + a.deposit_amount + a.one_time_fee_amount > 0 ? (
                <>
                  {a.monthly_charge > 0 && (
                    <><strong>{fmtAmendDollars(a.monthly_charge)}/month</strong> from{' '}
                    {fmtAmendDate(a.effective_date)}
                    {a.deposit_amount + a.one_time_fee_amount > 0 ? ', plus ' : '. '}</>
                  )}
                  {a.deposit_amount + a.one_time_fee_amount > 0 && (
                    <><strong>{fmtAmendDollars(a.deposit_amount + a.one_time_fee_amount)}</strong>
                    {' '}due when you sign
                    {a.deposit_amount > 0 && ` (${fmtAmendDollars(a.deposit_amount)} of it refundable)`}. </>
                  )}
                </>
              ) : (
                <>Takes effect {fmtAmendDate(a.effective_date)}. </>
              )}
              Your rent, your existing deposit and your move-out date don&apos;t change.
            </div>
          </div>
          <div className="tp-card-ft">
            <Link href={amendmentPath(a.token)} className="tp-btn tp-btn-primary">
              Read and sign it
            </Link>
          </div>
        </div>
      ))}
    </>
  )
}

function ord(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

const CSS = `
  /* ── Tenancy switcher, for a renter on more than one lease ── */
  .tl-switch { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .tl-sw { background: var(--surface); border: 1.5px solid var(--line); border-radius: 20px;
    padding: 7px 15px; font-family: var(--sans); font-size: 12.5px; font-weight: 600;
    color: var(--ink-3); cursor: pointer; }
  .tl-sw.on { background: var(--primary); color: #fff; border-color: var(--primary); }

  .tl-home { margin-top: 7px; }
  .tl-home-name { font-family: var(--display); font-size: 21px; font-weight: 400; color: #fff;
    letter-spacing: -0.3px; }

  .tl-row-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .tl-hd-actions { display: flex; align-items: center; gap: 6px; }
  .tl-ft { display: flex; flex-wrap: wrap; gap: 9px; }

  /* A late fee named inside a rent row. Amber, never folded into the figure. */
  .tl-lf { font-style: normal; font-size: 11.5px; font-weight: 600; color: var(--fee); }

  /* A waived fee: struck through, in the colour of good news. */
  .tl-waived { font-size: 13.5px; font-weight: 700; color: var(--paid); white-space: nowrap;
    text-decoration: line-through; text-decoration-color: var(--paid-line); }
  .tl-quote { display: block; font-style: italic; font-size: 12px; color: var(--ink-3);
    margin-top: 4px; line-height: 1.5; }

  /* A fee row on the Payments tab: the tick box and the explanation link are
     separate targets, so opening one cannot toggle the other. */
  .tl-pickfee { border-bottom: 1px solid var(--line-2); padding-bottom: 8px; }
  .tl-pickfee .tp-pick { border-bottom: none; }
  .tl-why { background: none; border: none; padding: 0 0 0 30px; font-family: var(--sans);
    font-size: 11.5px; font-weight: 600; color: var(--fee); cursor: pointer;
    text-decoration: underline; }

  .tl-allpaid { display: flex; align-items: flex-start; gap: 10px; font-size: 13.5px;
    color: var(--ink-2); line-height: 1.55; }
  .tl-allpaid strong { color: var(--ink); }

  /* ── Payment history ── */
  .tl-hist-l { display: flex; align-items: center; gap: 8px; font-size: 13.5px;
    font-weight: 600; color: var(--ink); }
  .tl-kind { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
    background: var(--idle-wash); color: var(--ink-3); padding: 2px 7px; border-radius: 5px; }
  .tl-hist-amt { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

  /* ── Maintenance ── */
  .tl-mx-headline { font-size: 14.5px; font-weight: 600; color: var(--ink); line-height: 1.5; }
  .tl-mx { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
    padding: 13px 0; border-bottom: 1px solid var(--line-2); }
  .tl-mx:last-child { border-bottom: none; padding-bottom: 0; }
  .tl-mx:first-child { padding-top: 0; }
  .tl-mx.done { opacity: .76; }
  .tl-mx-note { font-size: 12.5px; color: var(--ink-2); margin-top: 7px; line-height: 1.55; }

  /* The progress log. Indented behind a rule so it reads as "things that
     happened to the job above", not as more jobs. */
  .tl-log { margin-top: 11px; padding-left: 13px; border-left: 2px solid var(--line);
    display: flex; flex-direction: column; gap: 12px; }
  .tl-log-when { font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .5px; color: var(--ink-4); }
  .tl-log-body { font-size: 12.5px; color: var(--ink-2); line-height: 1.55; margin-top: 3px;
    white-space: pre-wrap; }
  .tl-shots { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .tl-shot { display: block; width: 100px; border-radius: 9px; overflow: hidden;
    border: 1px solid var(--line); text-decoration: none; background: var(--surface-2); }
  .tl-shot img { display: block; width: 100%; height: 74px; object-fit: cover; }
  .tl-shot-cap { display: block; padding: 4px 6px; font-size: 10px; color: var(--ink-3);
    line-height: 1.35; }
  .tl-shot:hover { border-color: var(--primary); }

  /* ── An amendment waiting on a signature ── */
  .tl-am-k { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px;
    font-weight: 700; text-transform: uppercase; letter-spacing: .9px; color: var(--fee);
    margin-bottom: 7px; }
  .tl-am-t { font-size: 16px; font-weight: 600; color: var(--ink); letter-spacing: -0.2px; }

  @media (max-width: 720px) {
    .tp-stats { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tp-stat { padding: 11px 12px; }
    .tp-stat-v { font-size: 14px; }
    .tl-ft .tp-btn, .tp-card-ft .tp-btn { width: 100%; }
    .tl-hd-actions .tp-btn { width: auto; }
  }
`
