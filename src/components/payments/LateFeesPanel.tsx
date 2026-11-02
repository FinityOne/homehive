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
import type { WaivedLedger, WaivedPayerGroup, WaivedLateFee } from '@/lib/lateFeeWaivers'

const C = {
  ink: '#1d1d1f', dim: '#6e6e73', faint: '#8e8e93', line: '#e5e5ea', wash: '#fafafb',
  bad: '#d13b30', badBg: '#fdeceb', badLine: '#f3c6c2',
  warn: '#b25000', warnBg: '#fdf1e3', warnLine: '#f6dcc0',
  good: '#1d8a4e', goodBg: '#e8f5ed',
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Days since a date, for saying how stale a frozen fee is. */
const daysAgo = (d: string) =>
  Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86_400_000))

export default function LateFeesPanel({
  ledger, waived, onReload, onOpenLease,
}: {
  ledger: LateFeeLedger
  /** What has already been written off — the other half of this story. */
  waived: WaivedLedger
  /** Re-fetch plans and waivers after a send or a waiver changes anything. */
  onReload: () => void
  onOpenLease: (planId: string) => void
}) {
  const [remindPayer, setRemindPayer] = useState<LateFeePayer | null>(null)
  /** The write-off being composed: a payer and the fees of theirs it covers. */
  const [waiving, setWaiving] = useState<{ payer: LateFeePayer; fees: PendingLateFee[] } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    }
  }

  /** Put a waived fee back. Deliberately undoable, and deliberately silent —
   *  see the DELETE handler: a tenant told a fee was forgiven should hear about
   *  its return from their landlord, not from an automated reversal notice. */
  async function restore(fee: WaivedLateFee) {
    setBusyId(fee.scheduledPaymentId)
    try {
      const res = await fetch('/api/landlord/late-fees/waive', {
        method: 'DELETE',
        headers: await authHeaders(),
        body: JSON.stringify({ scheduledPaymentId: fee.scheduledPaymentId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'That did not work.')
      setFlash({
        tone: 'good',
        text: `${fee.label} is owed again — ${fee.payerName} has not been told, so tell them yourself if they were.`,
      })
      onReload()
    } catch (e) {
      setFlash({ tone: 'bad', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  /** Announce a write-off that was recorded without telling the tenant. */
  async function announce(group: WaivedPayerGroup) {
    const silent = group.fees.filter(f => !f.tenantNotifiedAt)
    setBusyId(group.key)
    try {
      const res = await fetch('/api/landlord/late-fees/waive', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          scheduledPaymentIds: silent.map(f => f.scheduledPaymentId),
          // Carry the notes forward so re-announcing does not blank the record
          // the landlord already wrote against these waivers.
          reason: silent.find(f => f.reason)?.reason ?? undefined,
          tenantNote: silent.find(f => f.tenantNote)?.tenantNote ?? undefined,
          notifyTenant: true,
          notifyLandlord: false,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'That did not work.')
      const failed = (json.notNotified ?? []) as { name: string; why: string }[]
      setFlash(failed.length > 0
        ? { tone: 'bad', text: `Not sent — ${failed[0].why}.` }
        : { tone: 'good', text: `Told ${group.name} that ${fmtCurrency(group.unannouncedTotal)} was written off.` })
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
        {flash && <Flash flash={flash} />}
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

        {/* Still shown when nothing is owed: a landlord at zero needs to know
            whether that is because fees were collected or forgiven. */}
        <WrittenOff
          waived={waived}
          busyId={busyId}
          onRestore={restore}
          onAnnounce={announce}
          onOpenLease={onOpenLease}
        />
      </section>
    )
  }

  return (
    <section style={{ marginBottom: 30 }} aria-label="Late fees">
      <Header ledger={ledger} />

      {flash && <Flash flash={flash} />}

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
              onWaive={fees => setWaiving({ payer, fees })}
              onRemind={() => setRemindPayer(payer)}
              onOpenLease={onOpenLease}
            />
          ))}
        </div>
      ))}

      <WrittenOff
        waived={waived}
        busyId={busyId}
        onRestore={restore}
        onAnnounce={announce}
        onOpenLease={onOpenLease}
      />

      {remindPayer && (
        <RemindModal
          payer={remindPayer}
          onClose={() => setRemindPayer(null)}
          onSent={msg => { setRemindPayer(null); setFlash({ tone: 'good', text: msg }); onReload() }}
          authHeaders={authHeaders}
        />
      )}

      {waiving && (
        <WaiveModal
          payer={waiving.payer}
          fees={waiving.fees}
          onClose={() => setWaiving(null)}
          onDone={msg => { setWaiving(null); setFlash(msg); onReload() }}
          authHeaders={authHeaders}
        />
      )}
    </section>
  )
}

function Flash({ flash }: { flash: { tone: 'good' | 'bad'; text: string } }) {
  return (
    <div
      role="status"
      style={{
        marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
        background: flash.tone === 'good' ? C.goodBg : C.badBg,
        color: flash.tone === 'good' ? C.good : C.bad,
        border: `1px solid ${flash.tone === 'good' ? '#e8f5ed' : C.badLine}`,
      }}
    >
      {flash.text}
    </div>
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
  /** Open the write-off step for these fees of this payer's. */
  onWaive: (fees: PendingLateFee[]) => void
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
          {/* Waiving sits beside chasing as an equal action, not a per-row
              escape hatch: for most of these fees it is the right answer, and
              the decision is about the tenant rather than one month. */}
          <button
            onClick={() => onWaive(payer.fees)}
            style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: 'pointer', background: '#fff', color: C.dim, border: `1px solid ${C.line}` }}
          >
            Waive{payer.fees.length > 1 ? ' fees' : ''}…
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
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#b25000', lineHeight: 1.6 }}>
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
              onWaive={() => onWaive([fee])}
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
  onWaive: () => void
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
        {/* Opens the step rather than writing the fee off on the spot. Giving
            up money on one click, with no chance to say why and no chance to
            tell the tenant, is how the feature became invisible to both. */}
        <button
          onClick={onWaive}
          disabled={busy}
          style={{
            marginTop: 4, fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6,
            background: '#fff', color: C.dim, border: `1px solid ${C.line}`,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? '…' : 'Waive…'}
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
          border: `1px solid ${payable ? '#e8f5ed' : C.line}`,
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
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#b25000', lineHeight: 1.6 }}>
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

// ─── WAIVING IT ───────────────────────────────────────────────────────────────

/**
 * The write-off step.
 *
 * Waiving used to be one unlabelled click per row, and that is why it was both
 * under-used and under-valued. Giving up money deserves the same care as asking
 * for it, so this step does three things the click could not:
 *
 *   • **Lets the landlord pick which months.** The decision is usually "clear
 *     this tenant's old frozen fees but keep the one still accruing" — which is
 *     unreachable if the only unit is one row at a time, and unreachable if the
 *     only unit is the whole tenant.
 *   • **Separates the two notes.** `reason` is the landlord's own record and
 *     never leaves the building. `tenantNote` is the sentence the tenant reads.
 *     Collapsing them means either the tenant sees "not worth chasing" or the
 *     books record nothing at all.
 *   • **Makes telling the tenant the default, and visible.** A waiver the
 *     tenant never hears about is money spent on nothing: it buys no goodwill,
 *     and from their side a charge simply stopped being displayed.
 */
function WaiveModal({
  payer, fees, onClose, onDone, authHeaders,
}: {
  payer: LateFeePayer
  fees: PendingLateFee[]
  onClose: () => void
  onDone: (flash: { tone: 'good' | 'bad'; text: string }) => void
  authHeaders: () => Promise<Record<string, string>>
}) {
  const [picked, setPicked] = useState<string[]>(fees.map(f => f.scheduledPaymentId))
  const [reason, setReason] = useState('')
  const [tenantNote, setTenantNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(
    () => fees.filter(f => picked.includes(f.scheduledPaymentId)),
    [fees, picked],
  )
  const total = useMemo(() => chosen.reduce((s, f) => s + f.amount, 0), [chosen])
  const stillGrowing = chosen.filter(f => f.bucket === 'accruing')
  const alreadyAsked = chosen.filter(f => f.reminderCount > 0)
  const canSend = Boolean(payer.email)

  function toggle(id: string) {
    setPicked(v => (v.includes(id) ? v.filter(x => x !== id) : [...v, id]))
  }

  async function submit() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/landlord/late-fees/waive', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          scheduledPaymentIds: chosen.map(f => f.scheduledPaymentId),
          reason: reason.trim() || undefined,
          tenantNote: tenantNote.trim() || undefined,
          notifyTenant: notify && canSend,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'The write-off could not be recorded.')

      const waived = fmtCurrency(Number(json.waived ?? total))
      const failed = (json.notNotified ?? []) as { name: string; why: string }[]
      // The waiver is recorded either way, so a failed notice is reported as
      // exactly that rather than as a failure of the whole action.
      onDone(notify && canSend && failed.length > 0
        ? { tone: 'bad', text: `Wrote off ${waived}, but ${payer.name} was not emailed — ${failed[0].why}.` }
        : { tone: 'good', text: notify && canSend
            ? `Wrote off ${waived} and told ${payer.name}.`
            : `Wrote off ${waived}. ${payer.name} has not been told.` })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Waive late fees for ${payer.name}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{ background: '#fff', borderRadius: 15, maxWidth: 540, width: '100%', maxHeight: '88vh', overflowY: 'auto', padding: '22px 22px 20px' }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: C.ink, letterSpacing: '-0.3px' }}>
          Waive {fmtCurrency(total)} for {payer.name}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>
          {payer.leaseName}. A waived fee is recorded as written off, never as collected, so your
          fee totals stay reconcilable — and it can be restored later.
        </div>

        {/* Which months. Defaulted to everything the landlord clicked from. */}
        <div style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
          {fees.map(f => {
            const on = picked.includes(f.scheduledPaymentId)
            return (
              <label
                key={f.scheduledPaymentId}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 13px',
                  borderBottom: `1px solid ${C.line}`, cursor: 'pointer',
                  background: on ? '#fff' : C.wash,
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(f.scheduledPaymentId)}
                  style={{ marginTop: 2, accentColor: C.ink }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? C.ink : C.faint }}>
                      {f.label}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: on ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCurrency(f.amount)}
                    </span>
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: C.faint, marginTop: 2, lineHeight: 1.5 }}>
                    {f.bucket === 'accruing'
                      ? `still growing ${fmtCurrency(f.perDay)} a day — rent unpaid ${plural(f.daysLate, 'day')}`
                      : `frozen${f.frozenOn ? ` ${daysAgo(f.frozenOn)} days ago` : ''} — rent settled, fee never collected`}
                    {f.reminderCount > 0 && ` · asked ${plural(f.reminderCount, 'time')}`}
                  </span>
                </span>
              </label>
            )
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 13px', fontSize: 12.5, fontWeight: 800, color: C.ink, background: C.wash }}>
            <span>Writing off</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmtCurrency(total)} · {plural(chosen.length, 'charge')}
            </span>
          </div>
        </div>

        {/* A fee still accruing comes back tomorrow unless the rent is dealt
            with. Saying so prevents a landlord waiving the same fee weekly. */}
        {stillGrowing.length > 0 && (
          <div style={{ marginTop: 11, background: C.warnBg, border: `1px solid ${C.warnLine}`, borderRadius: 10, padding: '10px 13px', fontSize: 12, color: C.warn, lineHeight: 1.6 }}>
            <b>{stillGrowing.length === 1 ? 'One of these is still growing.' : `${stillGrowing.length} of these are still growing.`}</b>{' '}
            The rent underneath is unpaid, so the rule starts charging again tomorrow. Waiving clears
            what has built up so far — to stop it for good, collect the rent or change the lease&apos;s
            late-fee rule.
          </div>
        )}

        {alreadyAsked.length > 0 && (
          <div style={{ marginTop: 11, background: C.goodBg, border: '1px solid #e8f5ed', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: C.good, lineHeight: 1.6 }}>
            {payer.name} was already asked to pay {alreadyAsked.length === 1 ? 'one of these' : `${alreadyAsked.length} of these`}.
            The email below tells them to disregard that request — worth sending.
          </div>
        )}

        <label style={{ display: 'block', marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.dim }}>
            Why, for your own records
          </span>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={300}
            placeholder="Rent settled months ago — not worth pursuing"
            style={{ width: '100%', marginTop: 5, padding: '9px 11px', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 9, fontFamily: 'inherit', color: C.ink }}
          />
          <span style={{ fontSize: 11, color: C.faint }}>
            Private. Kept with the waiver and never shown to {payer.name}.
          </span>
        </label>

        {/* Telling them. On by default — see the note at the top of this file. */}
        <div style={{ marginTop: 14, border: `1px solid ${notify && canSend ? '#cfe8da' : C.line}`, borderRadius: 11, padding: '12px 13px', background: notify && canSend ? C.goodBg : C.wash }}>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: canSend ? 'pointer' : 'not-allowed' }}>
            <input
              type="checkbox"
              checked={notify && canSend}
              disabled={!canSend}
              onChange={e => setNotify(e.target.checked)}
              style={{ marginTop: 2, accentColor: C.good }}
            />
            <span>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: canSend ? C.ink : C.faint }}>
                Email {payer.name} that {chosen.length > 1 ? 'these fees are' : 'this fee is'} cancelled
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: canSend ? C.dim : C.faint, marginTop: 2, lineHeight: 1.55 }}>
                {canSend
                  ? <>One email to {payer.email}, naming each month and the amount. It asks for nothing
                      — a forgiveness email carrying a demand reads as a demand. You get a copy for
                      your records.</>
                  : <>No email address on file for this payer, so the write-off can only be recorded
                      in your books.</>}
              </span>
            </span>
          </label>

          {notify && canSend && (
            <label style={{ display: 'block', marginTop: 11 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: C.dim }}>
                Add a line for them (optional)
              </span>
              <textarea
                value={tenantNote}
                onChange={e => setTenantNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="You've been on time all year — this one's on us."
                style={{ width: '100%', marginTop: 5, padding: '9px 11px', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 9, resize: 'vertical', fontFamily: 'inherit', color: C.ink, background: '#fff' }}
              />
              <span style={{ fontSize: 11, color: C.faint }}>
                This is the single most relationship-repairing email a landlord sends. One sentence
                makes it a gesture rather than an adjustment.
              </span>
            </label>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 11, padding: '9px 12px', borderRadius: 9, background: C.badBg, border: `1px solid ${C.badLine}`, fontSize: 12.5, color: C.bad }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ fontSize: 13, fontWeight: 700, padding: '9px 15px', borderRadius: 9, background: '#fff', color: C.dim, border: `1px solid ${C.line}`, cursor: busy ? 'wait' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || chosen.length === 0}
            style={{
              fontSize: 13, fontWeight: 700, padding: '9px 17px', borderRadius: 9,
              background: chosen.length === 0 ? C.wash : C.ink,
              color: chosen.length === 0 ? C.faint : '#fff',
              border: `1px solid ${chosen.length === 0 ? C.line : C.ink}`,
              cursor: busy ? 'wait' : chosen.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {busy
              ? 'Writing off…'
              : notify && canSend ? `Waive ${fmtCurrency(total)} and tell them` : `Waive ${fmtCurrency(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── WHAT WAS WRITTEN OFF ─────────────────────────────────────────────────────

/**
 * The waiver history, below the fees still owed.
 *
 * Two readers need this. The landlord at the end of the year, reconciling fees
 * assessed against fees collected, needs the gap to have names and reasons
 * attached. And the landlord who wrote a fee off last week without telling
 * anyone needs that stranded goodwill surfaced while it is still worth
 * spending — which is why unannounced waivers sort to the top and carry the
 * only action in the section.
 */
function WrittenOff({
  waived, busyId, onRestore, onAnnounce, onOpenLease,
}: {
  waived: WaivedLedger
  busyId: string | null
  onRestore: (fee: WaivedLateFee) => void
  onAnnounce: (group: WaivedPayerGroup) => void
  onOpenLease: (planId: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (waived.empty) return null

  return (
    <div style={{ marginTop: 16, border: `1px solid ${C.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: '13px 15px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: C.ink }}>
            Written off
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: C.faint, marginTop: 1 }}>
            {fmtCurrency(waived.total)} forgiven across {plural(waived.feeCount, 'charge')} ·{' '}
            {plural(waived.payerCount, 'tenant')}
            {waived.unannouncedCount > 0 && ` · ${waived.unannouncedCount} never announced`}
          </span>
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.dim }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {/* The one thing in here that is still actionable. */}
      {waived.unannouncedCount > 0 && (
        <div style={{ margin: '0 15px 12px', background: C.warnBg, border: `1px solid ${C.warnLine}`, borderRadius: 9, padding: '10px 12px', fontSize: 12, color: C.warn, lineHeight: 1.6 }}>
          <b>{fmtCurrency(waived.unannouncedTotal)} was forgiven without telling the tenant.</b>{' '}
          From their side a charge simply stopped appearing, which buys no goodwill and looks like a
          bug. Telling them now still counts.
        </div>
      )}

      {open && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: C.wash }}>
          {waived.groups.map(g => (
            <div key={g.key} style={{ borderBottom: `1px solid ${C.line}`, padding: '11px 15px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{g.name}</span>
                <span style={{ fontSize: 11.5, color: C.faint, flex: 1, minWidth: 0 }}>
                  {g.leaseName} · {fmtCurrency(g.total)} across {plural(g.fees.length, 'charge')}
                </span>
                {g.unannounced > 0 && (
                  <button
                    onClick={() => onAnnounce(g)}
                    disabled={busyId === g.key || !g.email}
                    title={g.email ? undefined : 'No email address on file for this payer'}
                    style={{
                      fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 7,
                      background: g.email ? C.ink : C.wash, color: g.email ? '#fff' : C.faint,
                      border: `1px solid ${g.email ? C.ink : C.line}`,
                      cursor: busyId === g.key ? 'wait' : g.email ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {busyId === g.key ? 'Sending…' : `Tell them (${fmtCurrency(g.unannouncedTotal)})`}
                  </button>
                )}
                <button
                  onClick={() => onOpenLease(g.planId)}
                  style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 7, background: '#fff', color: C.dim, border: `1px solid ${C.line}`, cursor: 'pointer' }}
                >
                  Ledger
                </button>
              </div>

              {g.fees.map(f => (
                <div
                  key={f.scheduledPaymentId}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.line}` }}
                >
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>
                      {f.label}
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 6px', borderRadius: 5, background: f.tenantNotifiedAt ? C.goodBg : C.warnBg, color: f.tenantNotifiedAt ? C.good : C.warn }}>
                        {f.tenantNotifiedAt ? 'tenant told' : 'not announced'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 2, lineHeight: 1.55 }}>
                      Waived {fmtDate(f.waivedOn.slice(0, 10))} · rent due {fmtDate(f.dueDate)}
                      {f.tenantNotifiedAt && ` · emailed ${fmtDate(f.tenantNotifiedAt.slice(0, 10))}${f.tenantNotifiedEmail ? ` to ${f.tenantNotifiedEmail}` : ''}`}
                    </div>
                    {f.reason && (
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 1.55 }}>
                        Your note: {f.reason}
                      </div>
                    )}
                    {f.tenantNote && (
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 1.55 }}>
                        Told them: &ldquo;{f.tenantNote}&rdquo;
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.dim, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCurrency(f.amount)}
                    </div>
                    <button
                      onClick={() => onRestore(f)}
                      disabled={busyId === f.scheduledPaymentId}
                      style={{ marginTop: 4, fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6, background: '#fff', color: C.dim, border: `1px solid ${C.line}`, cursor: busyId === f.scheduledPaymentId ? 'wait' : 'pointer' }}
                    >
                      {busyId === f.scheduledPaymentId ? '…' : 'Restore'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
