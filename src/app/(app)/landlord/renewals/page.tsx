'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, getCurrentUser } from '@/lib/supabase'
import {
  buildPipeline, summarisePipeline, defaultTerms, suggestRenewalRent, turnoverMath,
  daysUntil, fmtDate, fmtRent, addDays,
  STAGE_META, STATE_META, WINDOW_OPENS_DAYS,
  type Renewal, type RenewalLease, type RenewalRow,
} from '@/lib/renewals'
import { askedFromPerBed, type ListingReport } from '@/lib/listingPerformance'

/**
 * Renewals & turnover.
 *
 * The product used to end at a number on the Overview tile: "3 leases expiring
 * within 60 days". That number is a problem statement with no product behind
 * it, and in a market where every lease ends in the same six weeks it is the
 * most expensive gap the portal had. A student landlord's entire next year is
 * decided by whether the twelve rooms that are full in July are full in
 * September, and until this page the portal's whole contribution to that was
 * the count.
 *
 * Three things it is built to do, in order of how much money they are worth:
 *
 *   1. Make the ask happen. The window opens at four months because that is
 *      when ASU renters decide; a landlord who asks in July is saying goodbye.
 *   2. Make the ask cheap to answer. One tap, no login, no account — the
 *      tenant often does not have one.
 *   3. Make the arithmetic visible. The composer states, as the landlord types
 *      a rent, how many days of vacancy would erase the increase they are
 *      reaching for. Nobody does that sum in their head, and the ones who try
 *      feel the $40 and not the empty month.
 *
 * The suggested rent comes from the Performance page's comp engine, so the two
 * features agree about what this market pays rather than each having an
 * opinion.
 */

type Flash = { ok: boolean; text: string } | null

type Draft = {
  leaseId: string
  rent: string
  start: string
  end: string
  respondBy: string
  message: string
}

export default function RenewalsPage() {
  const router = useRouter()
  const [leases, setLeases] = useState<RenewalLease[]>([])
  const [renewals, setRenewals] = useState<Renewal[]>([])
  const [marketRent, setMarketRent] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [view, setView] = useState<'window' | 'all'>('window')

  const say = (ok: boolean, text: string) => {
    setFlash({ ok, text })
    if (ok) setTimeout(() => setFlash(null), 7000)
  }

  useEffect(() => { document.title = 'Renewals — Landlord | HomeHive' }, [])

  const load = useCallback(async (userId: string) => {
    const [leaseRes, renewalRes] = await Promise.all([
      supabase
        .from('leases')
        .select(`
          id, property_id, start_date, end_date, rent_amount, unit_number, is_demo,
          property:properties ( id, name, slug ),
          tenants:lease_tenants ( id, name, email )
        `)
        .eq('owner_id', userId)
        .order('end_date', { ascending: true }),
      supabase
        .from('lease_renewals')
        .select('*')
        .eq('owner_id', userId)
        .order('sent_at', { ascending: true }),
    ])
    setLeases((leaseRes.data ?? []) as unknown as RenewalLease[])
    setRenewals((renewalRes.data ?? []) as unknown as Renewal[])
  }, [])

  /**
   * Market rent per listing, borrowed from the Performance engine.
   *
   * Entirely optional — it fails quietly and the composer then suggests
   * holding the rent, which is the honest answer when nothing is known about
   * the market rather than a made-up increase.
   */
  const loadMarket = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/landlord/listing-performance', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const json = await res.json()
      const map: Record<string, number> = {}
      for (const r of (json.reports ?? []) as ListingReport[]) {
        if (r.comps.thin || r.comps.median == null) continue
        map[r.listing.slug] = askedFromPerBed(r.listing, r.comps.median)
      }
      setMarketRent(map)
    } catch {
      // No market data is a fine outcome; see the note above.
    }
  }, [])

  useEffect(() => {
    getCurrentUser().then(async user => {
      if (!user) { router.push('/login?next=/landlord/renewals'); return }
      await Promise.all([load(user.id), loadMarket()])
      setLoading(false)
    })
  }, [router, load, loadMarket])

  const reload = async () => {
    const user = await getCurrentUser()
    if (user) await load(user.id)
  }

  const rows = useMemo(() => buildPipeline(leases, renewals), [leases, renewals])
  const summary = useMemo(() => summarisePipeline(rows), [rows])

  const visible = useMemo(
    () => view === 'all' ? rows : rows.filter(r => r.stage !== 'early'),
    [rows, view]
  )

  // ── Actions ───────────────────────────────────────────────────────────────

  const openComposer = (row: RenewalRow) => {
    const terms = defaultTerms(row.lease)
    const market = row.lease.property?.slug ? marketRent[row.lease.property.slug] : undefined
    const suggestion = suggestRenewalRent(row.lease.rent_amount ?? 0, market ?? null)
    setDraft({
      leaseId: row.lease.id,
      rent: String(suggestion.rent || row.lease.rent_amount || ''),
      start: terms.start,
      end: terms.end,
      respondBy: terms.respondBy,
      message: '',
    })
    setFlash(null)
  }

  const send = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/renewals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          lease_id: draft.leaseId,
          new_rent: Number(draft.rent),
          new_start_date: draft.start,
          new_end_date: draft.end,
          respond_by: draft.respondBy,
          message: draft.message.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { say(false, json.error || 'Could not send the offer.'); return }
      setDraft(null)
      await reload()
      say(true, `Offer sent to ${json.sentTo}. They can accept or decline without logging in.`)
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (renewal: Renewal) => {
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/renewals', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: renewal.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { say(false, json.error || 'Could not withdraw the offer.'); return }
      await reload()
      say(true, 'Offer withdrawn. The tenant was not emailed — send a new one when you are ready.')
    } finally {
      setBusy(false)
    }
  }

  const convert = async (renewal: Renewal) => {
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/renewals/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: renewal.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { say(false, json.error || 'Could not create the lease.'); return }
      await reload()
      say(true, json.alreadyDone
        ? 'That renewal was already turned into a lease.'
        : 'Renewed lease created. Set up the rent for the new term in Financials.')
    } finally {
      setBusy(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rn-wrap">
        <style>{CSS}</style>
        <div className="rn-title">Renewals</div>
        <div className="empty big">Working out which leases are ending…</div>
      </div>
    )
  }

  const draftRow = draft ? rows.find(r => r.lease.id === draft.leaseId) : null

  return (
    <div className="rn-wrap">
      <style>{CSS}</style>

      <div className="rn-head">
        <div>
          <div className="rn-title">Renewals &amp; turnover</div>
          <p className="rn-sub">
            Every lease that is ending, and what to do about it. The window opens{' '}
            {WINDOW_OPENS_DAYS} days out — in this market students decide in spring for the fall,
            so asking early is the entire advantage.
          </p>
        </div>
      </div>

      {flash && <div className={`flash ${flash.ok ? 'ok' : 'bad'}`}>{flash.text}</div>}

      {leases.length === 0 ? (
        <div className="empty big">
          No leases yet. <Link href="/landlord/leases/new">Create one</Link> and its renewal will
          show up here four months before it ends.
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">In the window</div>
              <div className="kpi-val">{summary.inWindow}</div>
              <div className="kpi-sub">{summary.notAsked > 0 ? `${summary.notAsked} not asked yet` : 'all asked'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Rent at risk</div>
              <div className={`kpi-val ${summary.rentAtRisk > 0 ? 'warn' : ''}`}>{fmtRent(summary.rentAtRisk)}</div>
              <div className="kpi-sub">per month, with no answer yet</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Secured</div>
              <div className={`kpi-val ${summary.accepted > 0 ? 'good' : ''}`}>{fmtRent(summary.rentSecured)}</div>
              <div className="kpi-sub">
                {summary.accepted} renewed
                {summary.toConvert > 0 && <span className="pulse"> · {summary.toConvert} to sign</span>}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Leaving</div>
              <div className={`kpi-val ${summary.declined > 0 ? 'bad' : ''}`}>{fmtRent(summary.rentLeaving)}</div>
              <div className="kpi-sub">{summary.declined} declined — relist these</div>
            </div>
          </div>

          <div className="filters">
            <div className="seg">
              <button className={`seg-btn ${view === 'window' ? 'on' : ''}`} onClick={() => setView('window')}>
                Needs a decision ({rows.filter(r => r.stage !== 'early').length})
              </button>
              <button className={`seg-btn ${view === 'all' ? 'on' : ''}`} onClick={() => setView('all')}>
                All leases ({rows.length})
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="empty big">
              Nothing is ending within {WINDOW_OPENS_DAYS} days. That is the best possible state for
              this page to be in.
            </div>
          ) : (
            visible.map(row => (
              <RenewalCard
                key={row.lease.id}
                row={row}
                marketRent={row.lease.property?.slug ? marketRent[row.lease.property.slug] ?? null : null}
                busy={busy}
                onSend={() => openComposer(row)}
                onWithdraw={() => row.renewal && withdraw(row.renewal)}
                onConvert={() => row.renewal && convert(row.renewal)}
              />
            ))
          )}
        </>
      )}

      {draft && draftRow && (
        <Composer
          row={draftRow}
          draft={draft}
          setDraft={setDraft}
          marketRent={draftRow.lease.property?.slug ? marketRent[draftRow.lease.property.slug] ?? null : null}
          busy={busy}
          onCancel={() => setDraft(null)}
          onSend={send}
        />
      )}
    </div>
  )
}

// ── One lease ────────────────────────────────────────────────────────────────

function RenewalCard({
  row, marketRent, busy, onSend, onWithdraw, onConvert,
}: {
  row: RenewalRow
  marketRent: number | null
  busy: boolean
  onSend: () => void
  onWithdraw: () => void
  onConvert: () => void
}) {
  const stage = STAGE_META[row.stage]
  const state = STATE_META[row.state]
  const r = row.renewal
  const tenant = row.lease.tenants.find(t => t.email) ?? row.lease.tenants[0]
  const slug = row.lease.property?.slug

  return (
    <div className="rcard" style={{ borderLeftColor: row.action.urgent ? '#dc2626' : stage.border }}>
      <div className="rc-main">
        <div className="rc-pills">
          <span className="pill" style={{ background: stage.bg, color: stage.color }}>{stage.label}</span>
          <span className="pill" style={{ background: state.bg, color: state.color }}>{state.label}</span>
          {row.lease.unit_number && <span className="pill ghost">{row.lease.unit_number}</span>}
        </div>

        <div className="rc-name">
          {slug
            ? <Link href={`/landlord/leases/${row.lease.id}`}>{row.lease.property?.name ?? 'Lease'}</Link>
            : (row.lease.property?.name ?? 'Lease')}
        </div>

        <div className="rc-meta">
          {tenant?.name || tenant?.email || 'no tenant on file'}
          {' · '}
          ends {fmtDate(row.lease.end_date)}
          {' · '}
          <span className={row.daysLeft <= 45 ? 'hot' : undefined}>
            {row.daysLeft < 0 ? `${Math.abs(row.daysLeft)} days ago` : `${row.daysLeft} days`}
          </span>
          {row.lease.rent_amount ? ` · ${fmtRent(row.lease.rent_amount)}/mo` : ''}
        </div>

        <div className="rc-why">{row.action.why}</div>

        {r && (
          <div className="rc-offer">
            <span><b>{fmtRent(r.new_rent)}</b>/mo</span>
            <span>{fmtDate(r.new_start_date)} — {fmtDate(r.new_end_date)}</span>
            <span>
              {row.state === 'awaiting'
                ? `reply by ${fmtDate(r.respond_by)}`
                : row.state === 'expired'
                  ? `lapsed ${fmtDate(r.respond_by)}`
                  : `sent ${fmtDate(r.sent_at.slice(0, 10))}`}
            </span>
            {r.renewal_lease_id && (
              <Link href={`/landlord/leases/${r.renewal_lease_id}`} className="rc-link">open the new lease →</Link>
            )}
          </div>
        )}

        {r?.response_note && <div className="rc-note">“{r.response_note}”</div>}

        {marketRent != null && row.lease.rent_amount ? (
          <div className="rc-market">
            Comparable listings: <b>{fmtRent(marketRent)}</b>/mo
            {marketRent > row.lease.rent_amount
              ? ` — ${fmtRent(marketRent - row.lease.rent_amount)} above what they pay now`
              : marketRent < row.lease.rent_amount
                ? ` — ${fmtRent(row.lease.rent_amount - marketRent)} below what they pay now`
                : ' — the same as they pay now'}
          </div>
        ) : null}
      </div>

      <div className="rc-acts">
        {row.action.kind === 'send' || row.action.kind === 'resend' ? (
          <button className="btn primary" disabled={busy} onClick={onSend}>{row.action.label}</button>
        ) : row.action.kind === 'convert' ? (
          <button className="btn primary" disabled={busy} onClick={onConvert}>Create the lease</button>
        ) : row.action.kind === 'relist' ? (
          slug
            ? <Link href={`/landlord/listings/${slug}`} className="btn primary">Relist the room</Link>
            : <span className="btn disabled">No listing linked</span>
        ) : row.action.kind === 'chase' || row.action.kind === 'wait' ? (
          <>
            <span className="btn disabled">{row.action.label}</span>
            {r && <button className="btn ghost" disabled={busy} onClick={onWithdraw}>Withdraw</button>}
          </>
        ) : (
          <span className="btn disabled">{row.action.label}</span>
        )}
      </div>
    </div>
  )
}

// ── The composer ─────────────────────────────────────────────────────────────

/**
 * The offer form, with the trade-off computed as the landlord types.
 *
 * The breakeven line is the only part of this page that is likely to change a
 * decision, so it updates on every keystroke rather than on submit.
 */
function Composer({
  row, draft, setDraft, marketRent, busy, onCancel, onSend,
}: {
  row: RenewalRow
  draft: Draft
  setDraft: (d: Draft) => void
  marketRent: number | null
  busy: boolean
  onCancel: () => void
  onSend: () => void
}) {
  const current = row.lease.rent_amount ?? 0
  const proposed = Number(draft.rent) || 0
  const suggestion = suggestRenewalRent(current, marketRent)
  const math = turnoverMath({
    currentRent: current,
    proposedRent: proposed,
    termStart: draft.start,
    termEnd: draft.end,
    marketRent,
  })
  const tenant = row.lease.tenants.find(t => t.email)
  const respondDays = daysUntil(draft.respondBy)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  const valid = proposed >= 0 && draft.start && draft.end && draft.end > draft.start && !!tenant?.email

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Send a renewal offer">
      <div className="sheet">
        <div className="sheet-hd">
          <div>
            <div className="sheet-t">Renewal offer</div>
            <div className="sheet-s">
              {row.lease.property?.name}
              {row.lease.unit_number ? ` · ${row.lease.unit_number}` : ''}
              {' → '}
              {tenant?.name || tenant?.email || 'no tenant email on file'}
            </div>
          </div>
          <button className="x" onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className="sheet-bd">
          {!tenant?.email && (
            <div className="warn">
              This lease has no tenant email, so there is nobody to send to.{' '}
              <Link href={`/landlord/leases/${row.lease.id}/edit`}>Add one to the lease</Link> first.
            </div>
          )}

          <div className="row2">
            <div className="field">
              <label className="lbl" htmlFor="rn-rent">New monthly rent</label>
              <input
                id="rn-rent" className="inp" type="number" min="0" step="1"
                value={draft.rent}
                onChange={e => set({ rent: e.target.value })}
              />
              <div className="hint">
                They pay {current ? fmtRent(current) : 'no rent on file'} now
                {marketRent ? ` · market ${fmtRent(marketRent)}` : ' · no comps available'}
              </div>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="rn-reply">Reply by</label>
              <input
                id="rn-reply" className="inp" type="date"
                value={draft.respondBy}
                min={addDays(new Date().toISOString().slice(0, 10), 1)}
                onChange={e => set({ respondBy: e.target.value })}
              />
              <div className="hint">
                {respondDays > 0 ? `${respondDays} days to decide` : 'today — that is a lot of pressure'}
              </div>
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label className="lbl" htmlFor="rn-start">New term starts</label>
              <input id="rn-start" className="inp" type="date" value={draft.start}
                     onChange={e => set({ start: e.target.value })} />
              <div className="hint">The day after the current lease ends</div>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="rn-end">and ends</label>
              <input id="rn-end" className="inp" type="date" value={draft.end}
                     onChange={e => set({ end: e.target.value })} />
              <div className="hint">{math.termMonths} months</div>
            </div>
          </div>

          {suggestion.rent !== proposed && (
            <button className="suggest" onClick={() => set({ rent: String(suggestion.rent) })}>
              Suggested: {fmtRent(suggestion.rent)}
              {suggestion.changePct !== 0 && ` (${suggestion.changePct > 0 ? '+' : ''}${suggestion.changePct}%)`}
              <span>{suggestion.reasoning}</span>
            </button>
          )}

          <div className={`math ${math.termGain > 0 ? 'gain' : 'flat'}`}>
            <div className="math-h">
              {math.termGain > 0
                ? `+${fmtRent(math.termGain)} over the ${math.termMonths}-month term`
                : math.termGain < 0
                  ? `${fmtRent(math.termGain)} over the ${math.termMonths}-month term`
                  : `Same rent for ${math.termMonths} months`}
            </div>
            {math.breakevenVacancyDays != null && (
              <div className="math-bar">
                <div className="math-bar-k">
                  Wiped out by <b>{math.breakevenVacancyDays} days</b> empty
                </div>
                <div className="math-track">
                  <i style={{ width: `${Math.min(100, (math.breakevenVacancyDays / 60) * 100)}%` }} />
                </div>
                <div className="math-scale"><span>0</span><span>30 days</span><span>60+</span></div>
              </div>
            )}
            <p>{math.verdict}</p>
          </div>

          <div className="field">
            <label className="lbl" htmlFor="rn-msg">A note to them (optional)</label>
            <textarea
              id="rn-msg" className="inp" rows={3} value={draft.message}
              onChange={e => set({ message: e.target.value })}
              placeholder="You&rsquo;ve been great tenants and I&rsquo;d love to keep you another year."
            />
            <div className="hint">Shown above the terms in their email and on the page they answer from.</div>
          </div>
        </div>

        <div className="sheet-ft">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={onSend} disabled={busy || !valid}>
            {busy ? 'Sending…' : `Send to ${tenant?.email ?? '—'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .rn-wrap { max-width: 1040px; margin: 0 auto; padding: 28px 20px 90px; font-family: 'DM Sans', sans-serif; }
  .rn-head { margin-bottom: 20px; }
  .rn-title { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; }
  .rn-sub { font-size: 13px; color: #64748b; margin-top: 4px; max-width: 600px; line-height: 1.55; }

  .flash { border-radius: 10px; padding: 12px 15px; font-size: 13px; line-height: 1.55; margin-bottom: 16px; border: 1.5px solid; }
  .flash.ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
  .flash.bad { background: #fef2f2; border-color: #fecaca; color: #991b1b; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .kpi { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 5px; }
  .kpi-val { font-size: 20px; font-weight: 700; color: #0f172a; }
  .kpi-val.bad { color: #dc2626; }
  .kpi-val.warn { color: #b45309; }
  .kpi-val.good { color: #059669; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; line-height: 1.45; }
  .pulse { color: #b45309; font-weight: 700; }

  .filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .seg { display: inline-flex; background: #f1f5f9; border-radius: 9px; padding: 3px; }
  .seg-btn { background: none; border: none; border-radius: 7px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: #64748b; cursor: pointer; font-family: inherit; }
  .seg-btn.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }

  .rcard { display: flex; gap: 16px; align-items: flex-start; background: #fff; border: 1.5px solid #e2e8f0; border-left-width: 4px; border-radius: 12px; padding: 15px 17px; margin-bottom: 10px; }
  .rc-main { flex: 1; min-width: 0; }
  .rc-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 7px; }
  .pill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 3px 9px; border-radius: 20px; }
  .pill.ghost { background: #f1f5f9; color: #64748b; }
  .rc-name { font-size: 15.5px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; }
  .rc-name a { color: inherit; text-decoration: none; }
  .rc-name a:hover { text-decoration: underline; }
  .rc-meta { font-size: 12px; color: #94a3b8; margin-top: 3px; }
  .rc-meta .hot { color: #b45309; font-weight: 700; }
  .rc-why { font-size: 12.5px; color: #475569; margin-top: 7px; line-height: 1.55; max-width: 620px; }

  .rc-offer { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; background: #f8fafc; border: 1px solid #eef2f6; border-radius: 8px; padding: 8px 11px; margin-top: 9px; font-size: 12px; color: #475569; }
  .rc-offer b { color: #0f172a; font-size: 13px; }
  .rc-link { color: #1d4ed8; font-weight: 600; text-decoration: none; }
  .rc-note { font-size: 12.5px; color: #475569; font-style: italic; margin-top: 8px; border-left: 3px solid #e2e8f0; padding-left: 11px; line-height: 1.55; }
  .rc-market { font-size: 11.5px; color: #64748b; margin-top: 8px; }
  .rc-market b { color: #0f172a; }

  .rc-acts { display: flex; flex-direction: column; gap: 7px; align-items: stretch; flex-shrink: 0; width: 164px; }

  .btn { display: inline-block; text-align: center; font-family: inherit; font-size: 12.5px; font-weight: 600; border-radius: 8px; padding: 9px 13px; cursor: pointer; border: 1.5px solid transparent; text-decoration: none; }
  .btn.primary { background: #0f172a; color: #fff; }
  .btn.primary:hover:not(:disabled) { background: #1e293b; }
  .btn.ghost { background: #fff; border-color: #e2e8f0; color: #64748b; }
  .btn.ghost:hover:not(:disabled) { border-color: #cbd5e1; color: #0f172a; }
  .btn.disabled { background: #f8fafc; color: #94a3b8; border-color: #eef2f6; cursor: default; }
  .btn:disabled { opacity: 0.55; cursor: default; }

  .empty { font-size: 12.5px; color: #94a3b8; line-height: 1.6; }
  .empty.big { background: #fff; border: 1.5px dashed #e2e8f0; border-radius: 12px; padding: 36px 24px; text-align: center; font-size: 13.5px; }
  .empty a { color: #10b981; font-weight: 600; }

  .modal { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: flex-start; justify-content: center; padding: 28px 16px; overflow-y: auto; z-index: 90; }
  .sheet { background: #fff; border-radius: 14px; width: 100%; max-width: 540px; box-shadow: 0 18px 48px rgba(15,23,42,0.22); }
  .sheet-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 17px 19px; border-bottom: 1px solid #f1f5f9; }
  .sheet-t { font-size: 16px; font-weight: 700; color: #0f172a; }
  .sheet-s { font-size: 12px; color: #94a3b8; margin-top: 2px; line-height: 1.45; }
  .x { background: none; border: none; font-size: 24px; line-height: 1; color: #cbd5e1; cursor: pointer; padding: 0 2px; }
  .x:hover { color: #64748b; }
  .sheet-bd { padding: 18px 19px; }
  .sheet-ft { display: flex; gap: 9px; justify-content: flex-end; padding: 14px 19px; border-top: 1px solid #f1f5f9; }

  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .field { margin-bottom: 14px; }
  .lbl { display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
  .inp { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; color: #0f172a; font-family: inherit; background: #fff; outline: none; }
  .inp:focus { border-color: #10b981; }
  textarea.inp { resize: vertical; line-height: 1.5; }
  .hint { font-size: 11px; color: #94a3b8; margin-top: 4px; line-height: 1.45; }
  .warn { background: #fffbeb; border: 1.5px solid #fde68a; color: #92400e; border-radius: 9px; padding: 11px 13px; font-size: 12.5px; line-height: 1.55; margin-bottom: 15px; }
  .warn a { color: #92400e; font-weight: 700; }

  .suggest { display: block; width: 100%; text-align: left; background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 9px; padding: 11px 13px; margin-bottom: 15px; font-family: inherit; font-size: 13px; font-weight: 700; color: #075985; cursor: pointer; }
  .suggest:hover { border-color: #7dd3fc; }
  .suggest span { display: block; font-weight: 400; font-size: 11.5px; color: #0c4a6e; margin-top: 4px; line-height: 1.55; }

  .math { border-radius: 10px; padding: 13px 15px; margin-bottom: 16px; border: 1.5px solid; }
  .math.gain { background: #fffbeb; border-color: #fde68a; }
  .math.flat { background: #f8fafc; border-color: #e2e8f0; }
  .math-h { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 9px; }
  .math-bar { margin-bottom: 9px; }
  .math-bar-k { font-size: 12px; color: #475569; margin-bottom: 5px; }
  .math-bar-k b { color: #9f1239; }
  .math-track { height: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 5px; overflow: hidden; }
  .math-track i { display: block; height: 100%; background: linear-gradient(90deg,#dc2626,#f59e0b); }
  .math-scale { display: flex; justify-content: space-between; font-size: 10px; color: #cbd5e1; margin-top: 3px; }
  .math p { font-size: 12px; color: #475569; line-height: 1.6; }

  @media (max-width: 760px) {
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .rcard { flex-direction: column; }
    .rc-acts { width: 100%; flex-direction: row; }
    .rc-acts .btn { flex: 1; }
    .row2 { grid-template-columns: 1fr; }
  }
`
