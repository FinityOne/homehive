'use client'

/**
 * Late fees the landlord has not been paid.
 *
 * Until now a late fee appeared only as a footnote: "includes $4,050 of late
 * fees" under an arrears tile, a small orange flag in a lease ledger. There was
 * no list of them and nothing to do about one, which is why the database shows
 * 32 fees assessed and zero collected.
 *
 * The panel is built around the distinction that actually governs what a
 * landlord should do, because it is not the distinction they expect:
 *
 *   • **Still growing** — the rent has not arrived. Urgent, uncontroversial,
 *     and collectable through the tenant portal, because the fee rides along
 *     with the rent payment.
 *   • **Never collected** — the rent arrived late and settled. The fee froze
 *     on the day the money landed and was never asked for. Nothing is urgent,
 *     nothing is growing, and the tenant *cannot* pay it through the portal.
 *     This is a decision — bill it or write it off — and on this database it is
 *     the entire population.
 *
 * So the panel leads with that split, states every fee's arithmetic on the row,
 * and puts waiving beside chasing as an equal action rather than a hidden
 * escape hatch. A landlord who cannot clear a row stops reading the list.
 */
import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fmtCurrency, fmtDate } from '@/lib/payments'
import {
  BUCKET_META, ruleSentence,
  type LateFeeLedger, type LateFeePayer, type PendingLateFee,
} from '@/lib/lateFees'

const C = {
  ink: '#0f172a', dim: '#64748b', faint: '#94a3b8', line: '#e2e8f0', wash: '#f8fafc',
  bad: '#b91c1c', badBg: '#fef2f2', badLine: '#fecaca',
  warn: '#b45309', warnBg: '#fffbeb', warnLine: '#fde68a',
  good: '#15803d', goodBg: '#f0fdf4',
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Days since a date, for saying how stale a frozen fee is. */
const daysAgo = (d: string) =>
  Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86_400_000))

export default function LateFeesPanel({
  ledger, onReload, onOpenLease,
}: {
  ledger: LateFeeLedger
  /** Re-fetch plans and waivers after a send or a waiver changes anything. */
  onReload: () => void
  onOpenLease: (planId: string) => void
}) {
  const [remindPayer, setRemindPayer] = useState<LateFeePayer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    }
  }

  async function waive(fee: PendingLateFee, undo: boolean) {
    setBusyId(fee.scheduledPaymentId)
    try {
      const res = await fetch('/api/landlord/late-fees/waive', {
        method: undo ? 'DELETE' : 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ scheduledPaymentId: fee.scheduledPaymentId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'That did not work.')
      setFlash({
        tone: 'good',
        text: undo
          ? 'Fee restored — it is owed again.'
          : `Wrote off ${fmtCurrency(fee.amount)} on ${fee.label}.`,
      })
      onReload()
    } catch (e) {
      setFlash({ tone: 'bad', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  if (ledger.empty) {
    return (
      <section style={{ marginBottom: 30 }} aria-label="Late fees">
        <Header ledger={ledger} />
        <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 13, padding: '26px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>No late fees outstanding</div>
          <p style={{ fontSize: 13, color: C.dim, margin: '6px auto 0', maxWidth: 440, lineHeight: 1.6 }}>
            {ledger.collected > 0 || ledger.waived > 0
              ? <>Every fee assessed has been settled or written off
                  {ledger.collected > 0 && <> — {fmtCurrency(ledger.collected)} collected</>}
                  {ledger.waived > 0 && <>, {fmtCurrency(ledger.waived)} waived</>}.</>
              : <>Either rent is arriving on time, or no lease here has a late-fee rule.</>}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section style={{ marginBottom: 30 }} aria-label="Late fees">
      <Header ledger={ledger} />

      {flash && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: flash.tone === 'good' ? C.goodBg : C.badBg,
          color: flash.tone === 'good' ? C.good : C.bad,
          border: `1px solid ${flash.tone === 'good' ? '#bbf7d0' : C.badLine}`,
        }}>
          {flash.text}
        </div>
      )}

      {/* An uncapped rule is the reason these numbers are the size they are.
          Saying so here turns an alarming total into an explicable one. */}
      {ledger.uncappedRules.length > 0 && (
        <div style={{
          marginBottom: 12, padding: '11px 14px', borderRadius: 10, background: C.warnBg,
          border: `1px solid ${C.warnLine}`, fontSize: 12.5, color: C.warn, lineHeight: 1.6,
        }}>
          <b>
            {ledger.uncappedRules.length === 1
              ? 'One lease has a late-fee rule with no maximum.'
              : `${ledger.uncappedRules.length} leases have late-fee rules with no maximum.`}
          </b>{' '}
          {ledger.uncappedRules[0].note} Fees on those leases are held to the size of the rent charge
          they sit on, so nothing here bills a tenant more than a month&apos;s rent — but setting a
          maximum on the rule is what makes these figures predictable.
        </div>
      )}

      {ledger.properties.map(prop => (
        <div key={prop.propertyName} style={{ marginBottom: 14 }}>
          {ledger.properties.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 2px 7px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{prop.propertyName}</span>
              <span style={{ fontSize: 11.5, color: C.faint }}>
                {fmtCurrency(prop.total)} in fees
              </span>
            </div>
          )}
          {prop.payers.map(payer => (
            <PayerCard
              key={payer.key}
              payer={payer}
              busyId={busyId}
              onWaive={waive}
              onRemind={() => setRemindPayer(payer)}
              onOpenLease={onOpenLease}
            />
          ))}
        </div>
      ))}

      {remindPayer && (
        <RemindModal
          payer={remindPayer}
          onClose={() => setRemindPayer(null)}
          onSent={msg => { setRemindPayer(null); setFlash({ tone: 'good', text: msg }); onReload() }}
          authHeaders={authHeaders}
        />
      )}
    </section>
  )
}

// ─── HEADER ───────────────────────────────────────────────────────────────────

function Header({ ledger }: { ledger: LateFeeLedger }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.ink, margin: 0, letterSpacing: '-0.3px' }}>
          Late fees due
        </h2>
        <span style={{ fontSize: 12, color: C.faint }}>
          Fees the lease has assessed and nobody has paid
        </span>
      </div>

      {!ledger.empty && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 9, marginBottom: 12 }}>
          <Tile
            label="Outstanding in fees"
            value={fmtCurrency(ledger.total)}
            tone="bad"
            meta={`${plural(ledger.feeCount, 'charge')} · ${plural(ledger.payerCount, 'tenant')}`}
          />
          <Tile
            label={BUCKET_META.accruing.label}
            value={ledger.accruing > 0 ? fmtCurrency(ledger.accruing) : 'Nothing'}
            tone={ledger.accruing > 0 ? 'bad' : 'quiet'}
            meta={ledger.accruing > 0
              ? `growing ${fmtCurrency(ledger.perDay)} a day`
              : 'no unpaid rent is accruing a fee'}
          />
          <Tile
            label={BUCKET_META.uncollected.label}
            value={ledger.uncollected > 0 ? fmtCurrency(ledger.uncollected) : 'Nothing'}
            tone={ledger.uncollected > 0 ? 'warn' : 'quiet'}
            meta={ledger.uncollected > 0
              ? 'rent settled late, fee never asked for'
              : 'nothing left behind on settled rent'}
          />
          <Tile
            label="Fees settled"
            value={fmtCurrency(ledger.collected)}
            tone="quiet"
            meta={ledger.waived > 0 ? `${fmtCurrency(ledger.waived)} written off` : 'nothing written off'}
          />
        </div>
      )}
    </div>
  )
}

function Tile({
  label, value, meta, tone,
}: {
  label: string; value: string; meta: string; tone: 'bad' | 'warn' | 'quiet'
}) {
  const color = tone === 'bad' ? C.bad : tone === 'warn' ? C.warn : C.ink
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 11, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: C.faint }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 4, letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 3, lineHeight: 1.45 }}>{meta}</div>
    </div>
  )
}

// ─── ONE TENANT ───────────────────────────────────────────────────────────────

function PayerCard({
  payer, busyId, onWaive, onRemind, onOpenLease,
}: {
  payer: LateFeePayer
  busyId: string | null
  onWaive: (fee: PendingLateFee, undo: boolean) => void
  onRemind: () => void
  onOpenLease: (planId: string) => void
}) {
  const [open, setOpen] = useState(payer.accruing > 0)
  const growing = payer.accruing > 0

  return (
    <div style={{
      background: '#fff', border: `1px solid ${growing ? C.badLine : C.line}`,
      borderRadius: 12, marginBottom: 8, overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', flex: '1 1 220px', minWidth: 0 }}
        >
          <span style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            background: growing ? C.badBg : C.wash, color: growing ? C.bad : C.dim,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
          }}>
            {payer.name[0].toUpperCase()}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.ink }}>
              {payer.name}
              {payer.payerStatus && payer.payerStatus !== 'active' && (
                <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {payer.payerStatus}
                </span>
              )}
            </span>
            <span style={{ display: 'block', fontSize: 11.5, color: C.faint, marginTop: 1 }}>
              {payer.leaseName} · {plural(payer.fees.length, 'charge')}
              {growing
                ? ` · growing ${fmtCurrency(payer.perDay)}/day`
                : payer.fees[0]?.frozenOn
                  ? ` · frozen ${daysAgo(payer.fees[0].frozenOn)} days ago`
                  : ''}
            </span>
          </span>
        </button>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: growing ? C.bad : C.warn, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.4px' }}>
            {fmtCurrency(payer.total)}
          </div>
          <div style={{ fontSize: 10.5, color: C.faint }}>
            {growing ? BUCKET_META.accruing.label.toLowerCase() : BUCKET_META.uncollected.label.toLowerCase()}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
          <button
            onClick={onRemind}
            disabled={!payer.email}
            title={payer.email ? undefined : 'No email address on file for this payer'}
            style={{
              fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: payer.email ? 'pointer' : 'not-allowed',
              background: payer.email ? C.ink : C.wash, color: payer.email ? '#fff' : C.faint,
              border: `1px solid ${payer.email ? C.ink : C.line}`,
            }}
          >
            Ask for it
          </button>
          <button
            onClick={() => onOpenLease(payer.planId)}
            style={{ fontSize: 12, fontWeight: 700, padding: '7px 11px', borderRadius: 8, cursor: 'pointer', background: '#fff', color: C.dim, border: `1px solid ${C.line}` }}
          >
            Ledger
          </button>
        </div>
      </div>

      {/* Why sending might be a bad idea — stated before the send, not after. */}
      {payer.cautions.length > 0 && (
        <div style={{ padding: '0 15px 12px' }}>
          <div style={{ background: C.warnBg, border: `1px solid ${C.warnLine}`, borderRadius: 9, padding: '9px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: C.warn, marginBottom: 4 }}>
              Before you send
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
              {payer.cautions.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        </div>
      )}

      {open && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: C.wash }}>
          <div style={{ padding: '9px 15px 4px', fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
            This lease charges {ruleSentence(payer.rule)}
          </div>
          {payer.fees.map(fee => (
            <FeeRow
              key={fee.scheduledPaymentId}
              fee={fee}
              busy={busyId === fee.scheduledPaymentId}
              onWaive={onWaive}
            />
          ))}
          {payer.rentOutstanding > 0 && (
            <div style={{ padding: '9px 15px 12px', fontSize: 12, color: C.bad, lineHeight: 1.55 }}>
              <b>{fmtCurrency(payer.rentOutstanding)}</b> of rent is also unpaid. Collecting the rent is
              what stops these fees growing — chase it from the lease ledger.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ONE FEE ──────────────────────────────────────────────────────────────────

function FeeRow({
  fee, busy, onWaive,
}: {
  fee: PendingLateFee
  busy: boolean
  onWaive: (fee: PendingLateFee, undo: boolean) => void
}) {
  const growing = fee.bucket === 'accruing'
  return (
    <div style={{ padding: '10px 15px', borderTop: `1px solid ${C.line}`, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{fee.label}</span>
          <span style={{
            fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px',
            padding: '2px 6px', borderRadius: 5,
            background: growing ? C.badBg : C.warnBg,
            color: growing ? C.bad : C.warn,
          }}>
            {BUCKET_META[fee.bucket].label}
          </span>
          {fee.reminderCount > 0 && (
            <span style={{ fontSize: 10.5, color: C.faint }}>
              asked {plural(fee.reminderCount, 'time')}
            </span>
          )}
        </div>

        {/* The arithmetic. This line is the difference between a fee a tenant
            disputes and one they pay. */}
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 3, lineHeight: 1.55 }}>
          {fmtCurrency(fee.rentAmount)} rent due {fmtDate(fee.dueDate)} ·{' '}
          {growing
            ? <>still unpaid, {plural(fee.daysLate, 'day')} past due</>
            : <>paid {fee.frozenOn ? fmtDate(fee.frozenOn) : 'late'}, {plural(fee.daysLate, 'day')} late</>}
          {' · '}
          {fmtCurrency(fee.rule.fee_amount)} per {fee.rule.frequency_days === 1 ? 'day' : `${fee.rule.frequency_days} days`}
          {fee.collected > 0 && <> · {fmtCurrency(fee.collected)} already paid toward it</>}
        </div>

        {fee.capped && (
          <div style={{ fontSize: 11, color: C.warn, marginTop: 3 }}>
            Trimmed to the size of the rent charge — the rule has no maximum, so it would otherwise be higher.
          </div>
        )}
        {growing && !fee.capped && (
          <div style={{ fontSize: 11, color: C.bad, marginTop: 3 }}>
            {fmtCurrency(fee.in30Days)} if the rent is still unpaid in 30 days.
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: growing ? C.bad : C.warn, fontVariantNumeric: 'tabular-nums' }}>
          {fmtCurrency(fee.amount)}
        </div>
        <button
          onClick={() => onWaive(fee, false)}
          disabled={busy}
          style={{
            marginTop: 4, fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6,
            background: '#fff', color: C.dim, border: `1px solid ${C.line}`,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? '…' : 'Write off'}
        </button>
      </div>
    </div>
  )
}

// ─── SENDING IT ───────────────────────────────────────────────────────────────

/**
 * The send step, with the cautions repeated inside it.
 *
 * A confirmation dialog that only says "are you sure" teaches people to click
 * through it. This one restates what the tenant will receive, whether they can
 * actually pay it online, and why they might object — so the click is a
 * decision rather than a reflex.
 */
function RemindModal({
  payer, onClose, onSent, authHeaders,
}: {
  payer: LateFeePayer
  onClose: () => void
  onSent: (msg: string) => void
  authHeaders: () => Promise<Record<string, string>>
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payable = useMemo(() => payer.fees.some(f => f.rentOutstanding > 0), [payer.fees])

  async function send() {
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/landlord/late-fees/remind', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          planId: payer.planId,
          planTenantId: payer.payerId,
          scheduledPaymentIds: payer.fees.map(f => f.scheduledPaymentId),
          message: message.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'The email could not be sent.')
      onSent(`Asked ${payer.name} for ${fmtCurrency(json.total ?? payer.total)} in late fees.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSending(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ask ${payer.name} for late fees`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60 }}
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose() }}
    >
      <div style={{ background: '#fff', borderRadius: 15, maxWidth: 520, width: '100%', maxHeight: '88vh', overflowY: 'auto', padding: '22px 22px 20px' }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: C.ink, letterSpacing: '-0.3px' }}>
          Ask {payer.name} for {fmtCurrency(payer.total)}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>
          One email to {payer.email}, covering {plural(payer.fees.length, 'late fee')} on {payer.leaseName}.
          It shows how each fee was worked out, so the figures can be checked rather than argued about.
        </div>

        <div style={{ marginTop: 14, background: C.wash, border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 13px' }}>
          {payer.fees.map(f => (
            <div key={f.scheduledPaymentId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
              <span style={{ color: C.dim }}>{f.label}</span>
              <span style={{ fontWeight: 700, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(f.amount)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, fontWeight: 800, color: C.ink, borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 6 }}>
            <span>Total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(payer.total)}</span>
          </div>
        </div>

        {/* Whether the email can offer a working payment button. A fee on rent
            that already settled has nothing to attach to in the pay flow, so
            promising one would send the tenant to a dead end. */}
        <div style={{
          marginTop: 11, borderRadius: 10, padding: '10px 13px', fontSize: 12, lineHeight: 1.6,
          background: payable ? C.goodBg : C.wash,
          border: `1px solid ${payable ? '#bbf7d0' : C.line}`,
          color: payable ? C.good : C.dim,
        }}>
          {payable
            ? <>The rent underneath is still unpaid, so the email carries a working payment link and the fee is collected along with the rent.</>
            : <><b>No payment link.</b> The rent is already settled, so there is nothing for the fee to ride on in the payment page — the email asks {payer.name} to reply and arrange it instead.</>}
        </div>

        {payer.cautions.length > 0 && (
          <div style={{ marginTop: 11, background: C.warnBg, border: `1px solid ${C.warnLine}`, borderRadius: 10, padding: '10px 13px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: C.warn, marginBottom: 4 }}>
              Worth weighing first
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
              {payer.cautions.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        <label style={{ display: 'block', marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.dim }}>
            Add a note (optional)
          </span>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Happy to split this over two months if that helps."
            style={{ width: '100%', marginTop: 5, padding: '9px 11px', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 9, resize: 'vertical', fontFamily: 'inherit', color: C.ink }}
          />
          <span style={{ fontSize: 11, color: C.faint }}>
            A sentence of explanation does more for collection than the demand itself.
          </span>
        </label>

        {error && (
          <div style={{ marginTop: 11, padding: '9px 12px', borderRadius: 9, background: C.badBg, border: `1px solid ${C.badLine}`, fontSize: 12.5, color: C.bad }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={sending}
            style={{ fontSize: 13, fontWeight: 700, padding: '9px 15px', borderRadius: 9, background: '#fff', color: C.dim, border: `1px solid ${C.line}`, cursor: sending ? 'wait' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending}
            style={{ fontSize: 13, fontWeight: 700, padding: '9px 17px', borderRadius: 9, background: C.ink, color: '#fff', border: `1px solid ${C.ink}`, cursor: sending ? 'wait' : 'pointer' }}
          >
            {sending ? 'Sending…' : 'Send the email'}
          </button>
        </div>
      </div>
    </div>
  )
}
