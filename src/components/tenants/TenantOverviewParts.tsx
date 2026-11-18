'use client'

import { useState } from 'react'
import Link from 'next/link'
import ActivityFeed, { ACTIVITY_CSS } from '@/components/activity/ActivityFeed'
import { useScopedActivity } from '@/lib/useLandlordActivity'
import { activityHref } from '@/lib/landlordActivity'
import { fmtMoney } from '@/lib/rentPayments'
import type { TenantRecord } from '@/lib/tenantRecord'
import type { Dossier, DossierLease, DossierPayer } from '@/lib/tenantDossierServer'

/**
 * The pieces that turn the tenant record into a dossier a landlord can work
 * from without leaving it.
 *
 * The page already answered "how is this person doing" better than anything
 * else in the portal. What it could not do was answer the questions that come
 * *next* — what is their number, which room are they in, who co-signed, what
 * have they actually paid of what they owe, and what has been happening on the
 * account. Every one of those was on file; every one of them was on a
 * different screen.
 *
 * Two rules these components keep:
 *
 *   • **Nothing is invented.** A field with no answer is left out rather than
 *     printed as a dash. A record full of em-dashes reads as broken software;
 *     one that simply does not mention what it does not know reads as
 *     finished.
 *   • **Tags and figures are derived, never stored.** A stored tag is a second
 *     source of truth about a tenancy, and it goes stale the moment an
 *     amendment is signed.
 */

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const fmtDay = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const ago = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** A contact line you can actually use: the value, and one tap to copy it. */
export function CopyLine({ icon, value, href }: { icon: string; value: string; href: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="tn-copy">
      <span aria-hidden="true" style={{ opacity: 0.55 }}>{icon}</span>
      <a href={href}>{value}</a>
      <button
        className="tn-copy-btn"
        onClick={() => {
          // Clipboard access is refused outright in some embedded contexts.
          // A refusal must not throw into the page — it just does not say
          // "copied", and the address is still selectable.
          navigator.clipboard?.writeText(value).then(
            () => { setDone(true); setTimeout(() => setDone(false), 1400) },
            () => {},
          )
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/**
 * The standing rail: who they are, where they live, who stands behind them.
 *
 * It is sticky because these are the facts that do not change while you read
 * the ones that do. A landlord who decides, halfway down the payment record,
 * to ring the tenant should not have to scroll back past six panels to find
 * the number that made them want to.
 */
export function IdentityRail({
  dossier, payer, lease,
}: { dossier: Dossier; payer: DossierPayer | null; lease: DossierLease | null }) {
  const t = dossier.tenant

  const tags: { label: string; tone?: 'good' | 'warn' | 'bad' }[] = []
  if (lease) tags.push({ label: 'On a lease', tone: 'good' })
  if (dossier.cosigners.length > 0) tags.push({ label: 'Co-signed', tone: 'good' })
  for (const am of dossier.amendments) {
    if (!am.signedAt) continue
    if (am.kind === 'assistance_animal') tags.push({ label: 'ESA approved', tone: 'good' })
    else if (am.kind === 'pet') tags.push({ label: 'Pet addendum' })
  }
  if (dossier.renewals.some(r => r.status === 'sent')) {
    tags.push({ label: 'Renewal offered', tone: 'warn' })
  }
  // The tag that changes what a landlord should do next: a tenant with no
  // account has been sent pay links they could never open.
  if (!dossier.account.exists) tags.push({ label: 'No portal account', tone: 'bad' })

  // The deposit is a real charge on the plan, not a field — so it reports
  // whatever actually became of it, including "waived".
  const deposit = payer?.specials.find(x => x.category === 'security_deposit') ?? null

  return (
    <aside className="tn-rail" aria-label="Tenant details">
      <div className="tn-card">
        <h4>Contact</h4>
        <CopyLine icon="✉" value={t.email} href={`mailto:${t.email}`} />
        {t.phone && <CopyLine icon="☎" value={t.phone} href={`tel:${t.phone}`} />}
      </div>

      <div className="tn-card">
        <h4>Tenant details</h4>
        <dl className="tn-dl">
          <dt>Status</dt><dd>{titleCase(t.status)}</dd>
          {lease && <><dt>Move-in</dt><dd>{fmtDay(lease.startDate)}</dd></>}
          {lease && lease.housemates.length > 1 && (
            <><dt>Household</dt><dd>{plural(lease.housemates.length, 'person')} on the lease</dd></>
          )}
          <dt>On file since</dt><dd>{fmtDay(t.created_at.slice(0, 10))}</dd>
          <dt>Last sign-in</dt>
          <dd>{dossier.account.lastSignInAt ? ago(dossier.account.lastSignInAt) : 'never'}</dd>
        </dl>
      </div>

      {lease && (
        <div className="tn-card">
          <h4>Property &amp; lease</h4>
          <dl className="tn-dl">
            <dt>Property</dt>
            <dd>
              {lease.propertySlug
                ? <Link href={`/homes/${lease.propertySlug}`} style={{ color: 'var(--accent)' }}>{lease.propertyName}</Link>
                : lease.propertyName}
            </dd>
            {lease.unitNumber && <><dt>Room</dt><dd>{lease.unitNumber}</dd></>}
            <dt>Term</dt><dd>{fmtDay(lease.startDate)} – {fmtDay(lease.endDate)}</dd>
            {lease.rentAmount != null && (
              <><dt>Rent (whole)</dt><dd>{fmtMoney(lease.rentAmount)} / month</dd></>
            )}
            {payer && <><dt>Rent (theirs)</dt><dd>{fmtMoney(payer.monthlyTotal)} / month</dd></>}
            {payer?.dueDay && <><dt>Due</dt><dd>the {ordinal(payer.dueDay)}</dd></>}
            {deposit && (
              <>
                <dt>Deposit</dt>
                <dd>{fmtMoney(deposit.amount)} ({deposit.status === 'waived' ? 'waived' : deposit.status})</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {dossier.cosigners.length > 0 && (
        <div className="tn-card">
          <h4>Co-signer{dossier.cosigners.length > 1 ? 's' : ''}</h4>
          {dossier.cosigners.map(c => (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                {c.name ?? 'Unnamed'}
                {c.relationship && <span className="muted sm"> ({c.relationship})</span>}
              </div>
              {c.email && <CopyLine icon="✉" value={c.email} href={`mailto:${c.email}`} />}
              {c.phone && <CopyLine icon="☎" value={c.phone} href={`tel:${c.phone}`} />}
            </div>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="tn-card">
          <h4>Tags</h4>
          <div className="tn-tags">
            {tags.map((tag, i) => (
              <span key={i} className={`tn-tag${tag.tone ? ` ${tag.tone}` : ''}`}>{tag.label}</span>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

/**
 * Collected against billed, for this tenancy so far.
 *
 * The denominator is what has actually come **due**, never the whole lease.
 * Filling the bar to 25% in month three of a twelve-month tenancy would make a
 * tenant who has never missed a day look three-quarters delinquent — the
 * single most misleading thing a progress bar can do with rent, and the
 * mistake most products make with this exact component.
 *
 * The fill colour is the standing, so the bar says the same thing as the badge
 * beside it: green when nothing is owed, red once something is actually past
 * due, amber for money owed that is not late yet.
 */
export function PaymentProgress({ record }: { record: TenantRecord }) {
  const { billed, collected } = record
  const pct = billed > 0 ? Math.min(100, Math.round((collected / billed) * 100)) : 0
  const outstanding = record.totalOwed
  const clear = outstanding <= 0
  const fill = clear ? 'var(--in)' : record.oldestOverdue ? 'var(--late)' : 'var(--fee)'
  const remaining = Math.max(0, billed - collected)

  return (
    <section className="panel">
      <div className="panel-hd">
        <div className="panel-title">Paid so far, this tenancy</div>
        <span className={`badge ${clear ? 'in' : 'late'}`}>
          {clear ? 'All paid up' : `${fmtMoney(outstanding)} outstanding`}
        </span>
      </div>
      <div className="panel-bd">
        <div className="tn-prog-top">
          <span className="tn-prog-big">{fmtMoney(collected)}</span>
          <span className="tn-prog-of">of {fmtMoney(billed)} billed to date</span>
        </div>
        <div
          className="tn-prog-track"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Rent collected against rent billed"
        >
          <div className="tn-prog-fill" style={{ width: `${pct}%`, background: fill }} />
        </div>
        <div className="tn-prog-legend">
          <span><span className="tn-dot" style={{ background: fill }} />Paid {pct}%</span>
          {remaining > 0 && (
            <span>
              <span className="tn-dot" style={{ background: 'var(--idle)' }} />
              Remaining {fmtMoney(remaining)}
            </span>
          )}
          <span className="right">
            {record.nextDue
              ? `Next due ${fmtDay(record.nextDue.dueDate)} · ${fmtMoney(record.nextDue.amount)}`
              : 'nothing scheduled ahead'}
          </span>
        </div>
      </div>
    </section>
  )
}

/**
 * This tenant's slice of the platform-wide activity log.
 *
 * The *same* feed as the bell and the Activity page — same rows, same read
 * watermark — narrowed to this person by email address, which is the only
 * thing joining a `tenants` row to a payer. That matters more than it sounds:
 * a per-tenant log built from its own queries would eventually disagree with
 * the one in the top bar, and then neither could be trusted.
 */
export function TenantActivity({
  email, limit = 8, title = 'Activity log',
}: { email: string; limit?: number; title?: string }) {
  const { events, lastReadAt, loaded } = useScopedActivity({ email }, limit)
  return (
    <section className="panel">
      <style>{ACTIVITY_CSS}</style>
      <div className="panel-hd">
        <div className="panel-title">{title}</div>
        <Link className="btn-quiet sm" href={activityHref({ email })}>View all →</Link>
      </div>
      <div className="panel-bd">
        {!loaded ? (
          <div className="muted">Loading…</div>
        ) : (
          <ActivityFeed
            events={events}
            lastReadAt={lastReadAt}
            dense
            // No day headings in a panel this short — they would outnumber the
            // rows. Each row carries its own timestamp instead.
            showDays={false}
            empty={{
              title: 'Nothing recorded yet',
              sub: 'Payments, the email we send them and portal sign-ins all land here.',
            }}
          />
        )}
      </div>
    </section>
  )
}
