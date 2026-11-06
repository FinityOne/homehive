'use client'

/**
 * Traffic per listing, and the whole diagnosis for any one of them.
 *
 * A portfolio average hides the only thing a multi-listing landlord needs:
 * which home is the problem. Two listings at 50% occupancy can be one home
 * nobody has heard of and one home everybody rejects, and the portfolio
 * numbers are identical in both cases.
 *
 * Each row expands into that listing's own funnel and its own pace, because
 * the fix is always per-home — you do not re-shoot the photos for a portfolio.
 */

import { useState } from 'react'
import Link from 'next/link'
import type { PulseListingRow } from '@/lib/listingPulse'
import type { ListingDetail } from '@/lib/pulsePayload'
import { C, TONE } from './theme'
import FunnelStrip from './FunnelStrip'

export default function ListingBreakdown({ rows, detail, windowDays }: {
  rows: PulseListingRow[]
  detail: Record<string, ListingDetail>
  windowDays: number
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (!rows.length) {
    return <div style={{ fontSize: 13, color: C.muted }}>No live listings to measure yet.</div>
  }

  return (
    <div>
      {rows.map((l, i) => {
        const d = detail[l.slug]
        const expanded = open === l.slug
        const bottleneck = d?.funnel.bottleneck ?? null
        const pace = d?.pace

        return (
          <div
            key={l.slug}
            style={{
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${C.faint}`,
              padding: i === 0 ? '0 0 10px' : '10px 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <button
                onClick={() => setOpen(expanded ? null : l.slug)}
                aria-expanded={expanded}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  fontFamily: "'DM Sans', sans-serif", textAlign: 'left',
                  fontSize: 13, fontWeight: 600, color: C.ink,
                  display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                }}
              >
                <span style={{
                  display: 'inline-block', width: 9, color: C.muted, fontSize: 10,
                  transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                }}>▶</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
              </button>
              <span style={{ fontSize: 12, color: C.ink2, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <strong style={{ color: C.ink }}>{l.visitors}</strong> {l.visitors === 1 ? 'person' : 'people'}
                {' · '}{l.views} view{l.views !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="prog-bar" style={{ marginTop: 6 }}>
              <div className="prog-fill" style={{ width: `${l.sharePct}%`, background: C.views }} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 5 }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                {l.isUnpublished
                  ? 'not published — students cannot see this one'
                  : l.views === 0
                    ? `live, but nobody opened it in ${windowDays} days`
                    : `${l.inquiries} inquir${l.inquiries === 1 ? 'y' : 'ies'}${l.conversionPct != null ? ` · ${l.conversionPct}% of visitors` : ''}${l.tours ? ` · ${l.tours} tour${l.tours !== 1 ? 's' : ''}` : ''}`}
              </span>
              {bottleneck && !expanded && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: TONE.warn.fg, background: TONE.warn.bg,
                  border: `1px solid ${TONE.warn.border}`, borderRadius: 4, padding: '1px 5px',
                }}>
                  ! {bottleneck.label.toLowerCase()}
                </span>
              )}
              {pace && pace.verdict === 'behind' && !expanded && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: TONE.bad.fg, background: TONE.bad.bg,
                  border: `1px solid ${TONE.bad.border}`, borderRadius: 4, padding: '1px 5px',
                }}>
                  ! behind pace
                </span>
              )}
            </div>

            {expanded && d && (
              <div style={{
                marginTop: 12, padding: '12px 14px', background: '#fcfcfd',
                border: `1px solid ${C.line}`, borderRadius: 10,
              }}>
                {pace && pace.verdict !== 'no_vacancy' && (
                  <div style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.6, marginBottom: 12 }}>
                    <strong style={{ color: C.ink }}>{pace.headline}.</strong> {pace.detail}
                  </div>
                )}
                <FunnelStrip funnel={d.funnel} windowDays={windowDays} compact />
                <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
                  <Link href={`/homes/${l.slug}`} className="panel-link">See the live listing →</Link>
                  <Link href="/landlord/performance" className="panel-link">Price &amp; comps →</Link>
                </div>
                {d.funnel.engagement.formStarts > 0 && (
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>
                    {d.funnel.engagement.formStarts} inquiry form{d.funnel.engagement.formStarts === 1 ? '' : 's'} started
                    {d.funnel.engagement.formAbandons > 0 && `, ${d.funnel.engagement.formAbandons} abandoned`}
                    {d.funnel.engagement.saves > 0 && ` · ${d.funnel.engagement.saves} shortlisted`}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
