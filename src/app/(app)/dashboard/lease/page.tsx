'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { fmtMoney, METHOD_META, type SettledMethod } from '@/lib/rentPayments'
import { tenantCharges } from '@/lib/tenantCharges'
import type { Payable } from '@/components/tenant/PayRentModal'
import StripeModeBanner from '@/components/StripeModeBanner'
import Link from 'next/link'
import {
  fmtShortDate as fmtAmendDate, fmtDollars as fmtAmendDollars, amendmentPath,
} from '@/lib/leaseAmendments'

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

type Tab = 'overview' | 'payments' | 'lease'

const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

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

/**
 * The tenant's own view of their tenancy: what they owe, what they've paid, and
 * how their share of the rent is made up. Everything is scoped to them — a
 * housemate's balance is none of their business.
 */
export default function MyLeasePage() {
  const router = useRouter()
  const [tenancies, setTenancies] = useState<Tenancy[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [active, setActive] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [paying, setPaying] = useState<Payable[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)
  /**
   * Lease changes addressed to this tenant.
   *
   * On this page and not only in the email, because an email gets buried and a
   * tenant who half-remembers being asked to sign something has nowhere else to
   * look. Loaded separately from the tenancy so a failure here cannot stop them
   * seeing their rent.
   */
  const [amendments, setAmendments] = useState<MyAmendment[]>([])
  /** The fee whose detail sheet is open, keyed by its charge id. */
  const [openFee, setOpenFee] = useState<string | null>(null)
  // Set from the URL on mount, cleared once acted on — a ref, not state, so
  // arriving with `pay=1` doesn't cost an extra render.
  const autoPay = useRef(false)

  useEffect(() => { document.title = 'My Lease — HomeHive' }, [])

  /**
   * The "Pay rent" button in a reminder email links to `?tab=payments&pay=1`.
   * Read on mount rather than in the initial state so the server-rendered
   * markup and the first client render agree.
   */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const q = p.get('tab')
    if (q === 'payments' || q === 'lease' || q === 'overview') setTab(q)
    autoPay.current = p.get('pay') === '1'
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
      window.history.replaceState({}, '', window.location.pathname)
      if (json.status === 'duplicate') setFlash(json.message)
      else if (json.status === 'paid') setFlash('Payment received. Thank you!')
      else if (json.status === 'processing') setFlash('Payment submitted — it shows as clearing until it settles.')
      else if (json.status === 'failed') setFlash('That payment didn\u2019t go through. Please try again.')
      load()
      setTimeout(() => setFlash(null), 8000)
    })()
  }, [load])

  const t = tenancies[active]

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

  const history = useMemo(() => {
    if (!t) return []
    return [
      ...t.scheduled.filter(s => isSettled(s.status)).map(s => ({
        id: s.id, kind: 'Rent', label: `Rent — ${fmtDate(s.due_date)}`,
        // Rent received plus any late fee received: what actually left the
        // tenant's account, so the row reconciles against their statement.
        amount: Math.round(((s.paid_amount || s.amount) + s.late_fee_paid) * 100) / 100,
        lateFee: s.late_fee_paid,
        date: s.paid_date, status: s.status,
        method: s.payment_method as SettledMethod | null, fee: s.processing_fee,
      })),
      ...t.specials.filter(s => isSettled(s.status)).map(s => ({
        id: s.id, kind: s.category === 'security_deposit' ? 'Deposit' : 'Charge', label: s.label,
        amount: s.amount, lateFee: 0, date: s.paid_date, status: s.status,
        method: s.payment_method as SettledMethod | null, fee: s.processing_fee,
      })),
    ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }, [t])

  const toggle = (r: Payable) => {
    const key = `${r.kind}-${r.id}`
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (loading) {
    return <div className="tl-loading">Loading your lease…</div>
  }

  if (!t) {
    return (
      <>
        <style>{CSS}</style>
        <div className="tl-wrap">
          <div className="empty">
            <div className="empty-title">No active lease yet</div>
            <div className="empty-sub">
              Once your landlord adds you to a lease, it appears here with your rent, your payment
              history and the option to pay online.
            </div>
            <a href="/homes" className="btn-dark">Browse homes →</a>
          </div>
        </div>
      </>
    )
  }

  const nextDue = t.scheduled.find(s => !isSettled(s.status) && !isVoided(s.status))

  return (
    <>
      <style>{CSS}</style>
      <div className="tl-wrap">
        {tenancies.length > 1 && (
          <div className="switcher">
            {tenancies.map((x, i) => (
              <button key={x.lease.id} className={`sw${i === active ? ' on' : ''}`} onClick={() => { setActive(i); setSelected(new Set()) }}>
                {x.lease.property?.name ?? 'Lease'}
              </button>
            ))}
          </div>
        )}

        <div className="head">
          <div>
            <h1 className="title">{t.lease.property?.name ?? 'My lease'}</h1>
            <div className="sub">
              {t.lease.property?.address}
              {t.lease.unit_number ? ` · ${t.lease.unit_number}` : ''}
            </div>
          </div>
          {totalOwed > 0 && (
            <button className="btn-dark lg" onClick={() => { setSelected(new Set(upToDate.map(r => `${r.kind}-${r.id}`))); setPaying(upToDate) }}>
              {/* One button that clears everything. When fees are in play,
                  say so — "Pay $2,931.96" with no explanation of why it is
                  more than the rent is how a tenant decides not to. */}
              {feeSum.total > 0 && owedSum.total > 0
                ? `Bring account up to date · ${fmtMoney(totalOwed)}`
                : `Pay ${fmtMoney(totalOwed)}`}
            </button>
          )}
        </div>

        <StripeModeBanner style={{ marginBottom: 16 }} />

        {/* The lease exists and has payers on it, but none of them is
            recognisably this tenant. Saying "no lease" would be a lie, and
            silently showing zeros would be worse — name the problem and give
            them the one action that fixes it. */}
        {/* A demo lease carries no schedule at all, so the page would otherwise
            show a tenancy with an unexplained blank ledger. */}
        {t.lease.is_demo && (
          <div className="info-note">
            <strong>This is a demo lease.</strong> No rent is collected on it — nothing here is
            due, and nothing can be charged to you.
          </div>
        )}

        {!t.lease.is_demo && t.unmatchedPlan && (
          <div className="warn">
            <strong>We can&apos;t match your account to this lease.</strong> Your landlord has a rent
            schedule for this home, but none of the payers on it is recorded under{' '}
            <strong>your email address</strong>. Ask them to add it to your payer record and this
            page will fill in.
          </div>
        )}

        {flash && <div className="ok">{flash}</div>}

        {/* ── Lease changes ───────────────────────────────────────────────────
            Unsigned ones are the loudest thing on the page bar an overdue
            balance: a document waiting on a signature is a thing the tenant has
            to do, and it is their landlord waiting. Signed ones stay visible as
            a quiet row — this is where their copy lives. */}
        <AmendmentNotices amendments={amendments.filter(a => a.lease_id === t.lease.id)} />

        <div className="figs">
          <Fig label="Balance due" value={fmtMoney(totalOwed)} tone={totalOwed > 0 ? 'bad' : 'good'} />
          <Fig label="Your rent" value={t.me ? `${fmtMoney(t.me.monthly_total)}/mo` : '—'} />
          <Fig label="Next due" value={nextDue ? fmtDate(nextDue.due_date) : 'Nothing due'} />
          <Fig label="Lease ends" value={fmtDate(t.lease.end_date)} />
        </div>

        <div className="tabs">
          {(['overview', 'payments', 'lease'] as Tab[]).map(x => (
            <button key={x} className={`tab${tab === x ? ' on' : ''}`} onClick={() => setTab(x)}>
              {x === 'overview' ? 'Overview' : x === 'payments' ? 'Payments' : 'Lease details'}
            </button>
          ))}
        </div>

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && (
          <>
            <div className="card">
              <div className="card-hd"><span className="card-title">What your rent covers</span></div>
              <div className="card-bd">
                {t.lineItems.length === 0 ? (
                  <div className="muted">
                    Your rent is {t.me ? fmtMoney(t.me.monthly_total) : '—'} a month.
                  </div>
                ) : (
                  <>
                    {t.lineItems.map(li => (
                      <div key={li.id} className="row">
                        <span>
                          {li.label}
                          {/* The explanation sits with the charge, not in an
                              email the tenant has to go and find. A line they
                              cannot account for is the one that gets disputed. */}
                          {li.notes && <em className="row-note">{li.notes}</em>}
                        </span>
                        <span className="row-amt">{fmtMoney(li.amount)}</span>
                      </div>
                    ))}
                    <div className="row total">
                      <span>Your monthly total</span>
                      <span className="row-amt">{fmtMoney(t.me?.monthly_total ?? 0)}</span>
                    </div>
                  </>
                )}
                {t.housemateCount > 0 && (
                  <div className="hint" style={{ marginTop: 10 }}>
                    You share this home with {t.housemateCount} other{t.housemateCount !== 1 ? 's' : ''}.
                    You only ever see and pay your own share.
                  </div>
                )}
              </div>
            </div>

            {/* ── Late fees ────────────────────────────────────────────────
                Its own card, above the rent, because for most tenants here
                the rent is already paid and this is the only thing they owe.
                Folded into "Due now" it would read as a rent charge they had
                already settled, which is the fastest way to a support email. */}
            {lateFees.length > 0 && (
              <div className="card fee-card">
                <div className="card-hd">
                  <span className="card-title">Late fees owed ({lateFees.length})</span>
                  <span className="card-note bad">{fmtMoney(feeSum.total)}</span>
                </div>
                <div className="card-bd">
                  <div className="fee-why">
                    {feeSpan && (
                      <strong>
                        {feeSpan.same
                          ? `Your ${feeSpan.first} rent arrived late.`
                          : `You were late on ${feeSpan.count} ${feeSpan.count === 1 ? 'month' : 'months'}, from ${feeSpan.first} to ${feeSpan.last}.`}
                      </strong>
                    )}
                    {lateFees.every(r => r.rentSettled)
                      ? <> Your rent is paid in full — these fees were charged at the time because
                         it arrived after the due date, and were never collected. Tap any month to
                         see exactly how its fee was worked out.</>
                      : <> These were charged because rent arrived, or is still arriving, after its
                         due date. Tap any month to see how its fee was worked out.</>}
                  </div>
                  {lateFees.map(r => {
                    const x = explanations.get(r.id)
                    return (
                      <button
                        key={`${r.kind}-${r.id}`}
                        className="fee-row"
                        onClick={() => setOpenFee(r.id)}
                        aria-label={`Details of the late fee for ${r.label}`}
                      >
                        <span className="fee-row-main">
                          <span className="fee-row-label">{r.label}</span>
                          <em className="fee-sub">
                            {x
                              ? `Paid ${x.rentSettled ? fmtDate(x.paidDate) : 'not yet'} · ${x.daysPastDue} ${x.daysPastDue === 1 ? 'day' : 'days'} late · ${x.periods} × ${fmtMoney(x.perPeriod)}`
                              : `${r.daysLate} days late`}
                          </em>
                        </span>
                        <span className="fee-row-right">
                          <span className="row-amt">{fmtMoney(r.lateFee ?? 0)}</span>
                          <span className="fee-chev" aria-hidden="true">›</span>
                        </span>
                      </button>
                    )
                  })}
                  <div className="fee-actions">
                    <button className="btn-dark" onClick={() => { setSelected(new Set(lateFees.map(x => `${x.kind}-${x.id}`))); setPaying(lateFees) }}>
                      Pay late fees · {fmtMoney(feeSum.total)}
                    </button>
                    {owedSum.total > 0 && (
                      <button className="btn-ghost" onClick={() => { setSelected(new Set(upToDate.map(x => `${x.kind}-${x.id}`))); setPaying(upToDate) }}>
                        Pay everything · {fmtMoney(totalOwed)}
                      </button>
                    )}
                  </div>
                  <div className="hint" style={{ marginTop: 10 }}>
                    You can pay these on their own, one at a time from the Payments tab, or together
                    with your rent. Questions about a fee? Contact your landlord — they can waive it.
                  </div>
                </div>
              </div>
            )}

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
              <div className="card waived-card">
                <div className="card-hd">
                  <span className="card-title">Late fees waived ({waived.length})</span>
                  <span className="card-note good">
                    {fmtMoney(waived.reduce((n, w) => n + w.amount, 0))} cleared
                  </span>
                </div>
                <div className="card-bd">
                  <div className="waived-why">
                    Your landlord cancelled {waived.length === 1 ? 'this late fee' : 'these late fees'}.
                    You owe nothing on {waived.length === 1 ? 'it' : 'them'} — this is your record of
                    the change, kept here in case it ever comes up again.
                  </div>
                  {waived.map(w => (
                    <div key={w.id} className="waived-row">
                      <span className="waived-main">
                        <span className="waived-label">{w.label}</span>
                        <em className="waived-sub">Waived {fmtDate(w.waivedOn.slice(0, 10))}</em>
                        {w.note && <em className="waived-note">&ldquo;{w.note}&rdquo;</em>}
                      </span>
                      <span className="waived-amt">{fmtMoney(w.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {owed.length > 0 && (
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Due now ({owed.length})</span>
                  <span className="card-note">{fmtMoney(totalOwed)}</span>
                </div>
                {/* Only what has reached its due date — never the whole lease. */}
                <div className="card-bd">
                  {owed.map(r => (
                    <div key={`${r.kind}-${r.id}`} className="row">
                      <span>
                        {r.label}
                        {/* The fee is named on its own, never folded into the
                            rent figure — a larger rent line is indistinguishable
                            from a rent increase. */}
                        {(r.lateFee ?? 0) > 0 && (
                          <em className="lf"> + {fmtMoney(r.lateFee!)} late fee</em>
                        )}
                        {specialNote(r) && <em className="row-note">{specialNote(r)}</em>}
                      </span>
                      <span className="row-amt">{fmtMoney(r.amount + (r.lateFee ?? 0))}</span>
                    </div>
                  ))}
                  <button className="btn-dark" style={{ marginTop: 14 }}
                    onClick={() => { setSelected(new Set(owed.map(x => `${x.kind}-${x.id}`))); setPaying(owed) }}>
                    Pay now
                  </button>
                </div>
              </div>
            )}

            {/* Upcoming rent belongs on the page a tenant actually lands on.
                Hiding it behind the Payments tab is why "when is my next rent
                due, and how much" read as unanswerable. */}
            {upcoming.length > 0 && (
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Upcoming ({upcoming.length})</span>
                  <span className="card-note">{fmtMoney(totalUpcoming)}</span>
                </div>
                <div className="card-bd">
                  {upcoming.slice(0, 4).map(r => (
                    <div key={`${r.kind}-${r.id}`} className="row">
                      <span>
                        {r.label}
                        {specialNote(r) && <em className="row-note">{specialNote(r)}</em>}
                      </span>
                      <span className="row-amt">{fmtMoney(r.amount)}</span>
                    </div>
                  ))}
                  <div className="hint" style={{ marginTop: 10 }}>
                    {upcoming.length > 4 ? `And ${upcoming.length - 4} more. ` : ''}
                    Not due yet — you don&apos;t need to pay these now.
                  </div>
                  <button className="btn-dark" style={{ marginTop: 12 }} onClick={() => setTab('payments')}>
                    {owed.length > 0 ? 'See all payments' : 'Pay ahead'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ PAYMENTS ══ */}
        {tab === 'payments' && (
          <>
            <div className="card">
              <div className="card-hd">
                <span className="card-title">Due now</span>
                <span className="hd-actions">
                  {upToDate.length > 0 && selectedRows.length < upToDate.length && (
                    <button className="btn-ghost sm" onClick={() => setSelected(new Set(upToDate.map(r => `${r.kind}-${r.id}`)))}>
                      Select all
                    </button>
                  )}
                  {selectedRows.length > 0 && (
                    <button className="btn-dark sm" onClick={() => setPaying(selectedRows)}>
                      Pay {fmtMoney(selectedTotal)}
                    </button>
                  )}
                </span>
              </div>
              <div className="card-bd">
                {/* Fees first, individually tickable — "separate or all
                    together" is only true if a tenant can pick one. */}
                {lateFees.map(r => {
                  const key = `${r.kind}-${r.id}`
                  const x = explanations.get(r.id)
                  return (
                    <div key={key} className="pick fee">
                      <label className="pick-hit">
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(r)} />
                        <span style={{ flex: 1 }}>
                          <span className="fee-row-label">Late fee · {r.label}</span>
                          <em className="fee-sub">
                            {x ? `${x.daysPastDue} ${x.daysPastDue === 1 ? 'day' : 'days'} late · ${x.periods} × ${fmtMoney(x.perPeriod)}` : ''}
                            {r.rentSettled ? ' · rent paid' : ''}
                          </em>
                        </span>
                        <span className="row-amt">{fmtMoney(r.lateFee ?? 0)}</span>
                      </label>
                      {/* Outside the label, so opening the details cannot tick
                          the box by accident. */}
                      <button className="fee-why-btn" onClick={() => setOpenFee(r.id)}>
                        Why this amount?
                      </button>
                    </div>
                  )
                })}
                {owed.length === 0 && lateFees.length === 0 ? (
                  <div className="muted">
                    You&apos;re all paid up — nothing is due right now.
                    {upcoming.length > 0 && ' Your next rent is listed below.'}
                  </div>
                ) : owed.map(r => {
                  const key = `${r.kind}-${r.id}`
                  return (
                    <label key={key} className="pick">
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(r)} />
                      <span style={{ flex: 1 }}>
                        {r.label}
                        {(r.lateFee ?? 0) > 0 && (
                          <em className="lf"> + {fmtMoney(r.lateFee!)} late fee</em>
                        )}
                      </span>
                      <span className="row-amt">{fmtMoney(r.amount + (r.lateFee ?? 0))}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Scheduled ahead — visible for planning, never billed by default. */}
            {upcoming.length > 0 && (
              <div className="card">
                <div className="card-hd">
                  <span className="card-title">Upcoming ({upcoming.length})</span>
                  <span className="card-note">{fmtMoney(totalUpcoming)}</span>
                </div>
                <div className="card-bd">
                  <div className="hint" style={{ marginBottom: 10 }}>
                    Not due yet — you don&apos;t need to pay these now. Tick any month to pay ahead.
                  </div>
                  {upcoming.map(r => {
                    const key = `${r.kind}-${r.id}`
                    return (
                      <label key={key} className="pick upcoming">
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(r)} />
                        <span style={{ flex: 1 }}>{r.label}</span>
                        <span className="row-amt">{fmtMoney(r.amount)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-hd">
                <span className="card-title">Payment history ({history.length})</span>
              </div>
              <div className="card-bd">
                {history.length === 0 ? (
                  <div className="muted">No payments recorded yet.</div>
                ) : history.map(h => {
                  const m = h.method ? METHOD_META[h.method] : null
                  return (
                    <div key={`${h.kind}-${h.id}`} className="hist">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="hist-label">
                          <span className="kind">{h.kind}</span>
                          {h.label}
                        </div>
                        <div className="hist-sub">
                          {h.status === 'processing' ? 'Clearing — bank transfer in progress' : `Paid ${fmtDate(h.date)}`}
                          {m ? ` · ${m.label}` : ''}
                          {h.lateFee > 0 ? ` · incl. ${fmtMoney(h.lateFee)} late fee` : ''}
                          {h.fee > 0 ? ` · incl. ${fmtMoney(h.fee)} processing fee` : ''}
                        </div>
                      </div>
                      <div className="hist-amt">
                        {fmtMoney(h.amount)}
                        {h.status === 'processing' && <span className="clearing">Clearing</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ══ LEASE DETAILS ══ */}
        {tab === 'lease' && (
          <div className="card">
            <div className="card-hd"><span className="card-title">Lease details</span></div>
            <div className="card-bd">
              <div className="row"><span>Property</span><span className="row-amt">{t.lease.property?.name ?? '—'}</span></div>
              <div className="row"><span>Address</span><span className="row-amt">{t.lease.property?.address ?? '—'}</span></div>
              {t.lease.unit_number && <div className="row"><span>Room / unit</span><span className="row-amt">{t.lease.unit_number}</span></div>}
              <div className="row"><span>Term</span><span className="row-amt">{fmtDate(t.lease.start_date)} – {fmtDate(t.lease.end_date)}</span></div>
              <div className="row"><span>Your monthly rent</span><span className="row-amt">{t.me ? fmtMoney(t.me.monthly_total) : '—'}</span></div>
              {t.plan && <div className="row"><span>Rent due</span><span className="row-amt">{t.plan.due_day}{ord(t.plan.due_day)} of each month</span></div>}
              {t.lateFeeRule && (
                <div className="row">
                  <span>Late fees</span>
                  <span className="row-amt">
                    {fmtMoney(t.lateFeeRule.fee_amount)} per {t.lateFeeRule.frequency_days === 1 ? 'day' : `${t.lateFeeRule.frequency_days} days`}
                    {t.lateFeeRule.grace_period_days > 0 ? `, after ${t.lateFeeRule.grace_period_days} days` : ''}
                  </span>
                </div>
              )}
              <div className="hint" style={{ marginTop: 12 }}>
                Questions about your lease? Contact your landlord directly — HomeHive shows what
                they&apos;ve recorded.
              </div>
            </div>
          </div>
        )}
      </div>

      {openFee && explanations.get(openFee) && (
        <LateFeeDetailSheet
          explanation={explanations.get(openFee)!}
          onClose={() => setOpenFee(null)}
          onPay={() => {
            const row = lateFees.find(r => r.id === openFee)
            setOpenFee(null)
            if (!row) return
            setSelected(new Set([`${row.kind}-${row.id}`]))
            setPaying([row])
          }}
        />
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
              ? 'Payment submitted. Bank transfers take 2–5 business days to clear — it shows as clearing until then.'
              : 'Payment received. Thank you!')
            setTimeout(() => { load(); setFlash(null) }, 6000)
            load()
          }}
        />
      )}
    </>
  )
}

/**
 * The tenant's amendments, on their lease page.
 *
 * Two shapes, because they are two different things. An unsigned amendment is a
 * task with a deadline-shaped feeling and gets a full card with the terms on
 * it; a signed one is a receipt and gets one line. Declined and withdrawn
 * amendments are deliberately kept — a tenant who said no should be able to see
 * that they said no, rather than wonder whether they imagined being asked.
 */
function AmendmentNotices({ amendments }: { amendments: MyAmendment[] }) {
  if (amendments.length === 0) return null
  const pending = amendments.filter(a => a.status === 'sent')
  const settled = amendments.filter(a => a.status !== 'sent')

  return (
    <>
      {pending.map(a => (
        <div key={a.id} className="am-notice">
          <div className="am-notice-k">Signature needed</div>
          <div className="am-notice-t">{a.title}</div>
          <div className="am-notice-b">
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
          <Link href={amendmentPath(a.token)} className="am-notice-btn">
            Read and sign it →
          </Link>
        </div>
      ))}
      {settled.length > 0 && (
        <div className="am-settled">
          {settled.map(a => (
            <Link key={a.id} href={amendmentPath(a.token)} className="am-settled-row">
              <span className={`am-dot ${a.status}`} />
              <span className="am-settled-t">{a.title}</span>
              <span className="am-settled-m">
                {a.status === 'signed'
                  ? `Signed ${fmtAmendDate(a.signature_date)}`
                  : a.status === 'declined' ? 'You declined' : 'Withdrawn'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="fig">
      <div className="fig-l">{label}</div>
      <div className={`fig-v${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  )
}

function ord(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

const CSS = `
  .info-note { background: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 9px; padding: 12px 15px; font-size: 13px; line-height: 1.6; margin-bottom: 16px; }
  .info-note strong { color: #0f172a; }
  .warn { background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; color: #92400e; border-radius: 9px; padding: 12px 15px; font-size: 13px; line-height: 1.6; margin-bottom: 16px; }

  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .tl-loading { min-height: 60vh; display: flex; align-items: center; justify-content: center; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #9b9b9b; }
  .tl-wrap { max-width: 780px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }

  .switcher { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
  .sw { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 20px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; font-family: inherit; }
  .sw.on { background: #0f172a; color: #fff; border-color: #0f172a; }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
  .title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .sub { font-size: 13px; color: #64748b; margin-top: 3px; }

  .figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .fig { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 15px; }
  .fig-l { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 4px; }
  .fig-v { font-size: 17px; font-weight: 700; color: #0f172a; }
  .fig-v.bad { color: #dc2626; }
  .fig-v.good { color: #059669; }

  .tabs { display: flex; gap: 2px; border-bottom: 1px solid #e2e8f0; margin-bottom: 18px; }
  .tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 11px 16px; font-size: 13.5px; font-weight: 500; color: #64748b; cursor: pointer; font-family: inherit; }
  .tab.on { color: #0f172a; font-weight: 700; border-bottom-color: #0f172a; }

  .card { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; }
  .card-hd { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 17px; border-bottom: 1px solid #f1f5f9; }
  .card-title { font-size: 12px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.6px; }
  .card-note { font-size: 13px; font-weight: 700; color: #0f172a; }
  .card-bd { padding: 15px 17px; }

  .row { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid #f8fafc; font-size: 13.5px; color: #475569; }
  .row:last-child { border-bottom: none; }
  .row.total { border-top: 1.5px solid #e2e8f0; border-bottom: none; margin-top: 4px; padding-top: 11px; font-weight: 700; color: #0f172a; }
  .row-amt { font-weight: 600; color: #0f172a; text-align: right; }

  .pick { display: flex; align-items: center; gap: 11px; padding: 11px 0; border-bottom: 1px solid #f8fafc; font-size: 13.5px; color: #334155; cursor: pointer; }
  .pick:last-child { border-bottom: none; }
  .pick input { accent-color: #0f172a; width: 16px; height: 16px; cursor: pointer; }
  .lf { font-style: normal; font-size: 11.5px; font-weight: 600; color: #b45309; }
  .fee-card { border-color: #fcd9b6; }
  .fee-card .card-hd { background: #fffbf5; }
  .card-note.bad { color: #b45309; }
  .fee-why { font-size: 12.5px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 13px; line-height: 1.55; margin-bottom: 12px; }
  .fee-sub { display: block; font-style: normal; font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .fee-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .pick.fee { background: #fffdf8; display: block; padding: 4px 0 9px; }
  .pick-hit { display: flex; align-items: center; gap: 11px; padding: 8px 0 4px; cursor: pointer; }
  .fee-why-btn { background: none; border: none; padding: 0 0 0 27px; font-family: inherit;
    font-size: 11.5px; font-weight: 700; color: #b45309; cursor: pointer; text-decoration: underline; }

  .fee-row { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    width: 100%; background: none; border: none; border-bottom: 1px solid #f8fafc;
    padding: 11px 2px; font-family: inherit; text-align: left; cursor: pointer; }
  .fee-row:last-of-type { border-bottom: none; }
  .fee-row:hover { background: #fffdf8; }
  .fee-row-main { min-width: 0; }
  /* Secondary to the charge it explains: present on a glance down the
     amounts, never competing with them. */
  .row-note { display: block; margin-top: 3px; font-size: 12px; font-style: normal; color: #6e6e73; line-height: 1.45; max-width: 46ch; }
  .fee-row-label { font-size: 13.5px; font-weight: 600; color: #0f172a; }
  .fee-row-right { display: flex; align-items: center; gap: 9px; white-space: nowrap; }
  .fee-chev { font-size: 19px; color: #cbd5e1; line-height: 1; }

  /* Forgiven fees. Green, and not styled like the orange fee card above it:
     this is the one money card on the page that is good news. */
  .waived-card { border-color: #bbf7d0; }
  .waived-card .card-hd { background: #f6fef9; }
  .card-note.good { color: #047857; }
  .waived-why { font-size: 12.5px; color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0;
    border-radius: 8px; padding: 10px 13px; line-height: 1.55; margin-bottom: 12px; }
  .waived-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    padding: 10px 2px; border-bottom: 1px solid #f8fafc; }
  .waived-row:last-of-type { border-bottom: none; }
  .waived-main { min-width: 0; }
  .waived-label { font-size: 13.5px; font-weight: 600; color: #0f172a; }
  .waived-sub { display: block; font-style: normal; font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .waived-note { display: block; font-style: italic; font-size: 11.5px; color: #475569;
    margin-top: 4px; line-height: 1.5; }
  .waived-amt { font-size: 13.5px; font-weight: 700; color: #047857; white-space: nowrap;
    text-decoration: line-through; text-decoration-color: #a7f3d0; }
  .hd-actions { display: flex; align-items: center; gap: 8px; }
  .btn-ghost { background: #fff; color: #0f172a; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 11px 18px; font-size: 13.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
  .btn-ghost.sm { padding: 6px 12px; font-size: 12.5px; }
  .btn-ghost:hover { border-color: #cbd5e1; }
  .pick.upcoming { color: #94a3b8; }
  .pick.upcoming .row-amt { color: #64748b; font-weight: 500; }

  .hist { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid #f8fafc; }
  .hist:last-child { border-bottom: none; }
  .hist-label { font-size: 13.5px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 8px; }
  .kind { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #f1f5f9; color: #64748b; padding: 2px 7px; border-radius: 5px; }
  .hist-sub { font-size: 11.5px; color: #94a3b8; margin-top: 2px; }
  .hist-amt { font-size: 14px; font-weight: 700; color: #0f172a; white-space: nowrap; text-align: right; }
  .clearing { display: block; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #b45309; background: #fef3c7; padding: 2px 7px; border-radius: 20px; margin-top: 3px; }

  .btn-dark { background: #0f172a; color: #34d399; border: none; border-radius: 10px; padding: 11px 20px; font-size: 13.5px; font-weight: 700; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
  .btn-dark.lg { padding: 13px 24px; font-size: 15px; }
  .btn-dark.sm { padding: 7px 14px; font-size: 12.5px; }

  .ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; border-radius: 10px; padding: 12px 15px; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }

  /* Lease amendments. The unsigned card borrows the dark border the pay sheet
     uses — on this page that outline means "this one is yours to act on". */
  .am-notice { background: #fff; border: 2px solid #0f172a; border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
  .am-notice-k { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.9px; color: #b45309; margin-bottom: 6px; }
  .am-notice-t { font-size: 15.5px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; }
  .am-notice-b { font-size: 13px; color: #475569; line-height: 1.6; margin-top: 5px; }
  .am-notice-btn { display: inline-block; margin-top: 13px; background: #0f172a; color: #34d399; border-radius: 8px; padding: 10px 19px; font-size: 13px; font-weight: 600; text-decoration: none; }

  .am-settled { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 11px; margin-bottom: 16px; overflow: hidden; }
  .am-settled-row { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid #f1f5f9; text-decoration: none; }
  .am-settled-row:last-child { border-bottom: none; }
  .am-settled-row:hover { background: #f8fafc; }
  .am-settled-t { font-size: 13px; font-weight: 600; color: #0f172a; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .am-settled-m { font-size: 11.5px; color: #94a3b8; white-space: nowrap; }
  .am-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: #cbd5e1; }
  .am-dot.signed { background: #10b981; }
  .am-dot.declined { background: #ef4444; }
  .muted { font-size: 13px; color: #94a3b8; }
  .hint { font-size: 11.5px; color: #94a3b8; line-height: 1.55; }

  .empty { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 48px 34px; text-align: center; }
  .empty-title { font-size: 18px; font-weight: 600; color: #0f172a; margin-bottom: 8px; }
  .empty-sub { font-size: 13.5px; color: #64748b; line-height: 1.6; max-width: 400px; margin: 0 auto 20px; }

  @media (max-width: 700px) {
    .figs { grid-template-columns: repeat(2, 1fr); }
  }
`
