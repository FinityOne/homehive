'use client'

/**
 * Are these rooms going to be full in time?
 *
 * This sits at the top of the traffic section, above every count, because it
 * is the only thing on the page with a deadline attached. Student housing
 * empties and refills on one calendar, and a landlord who reads "traffic is
 * down 12%" in June and "traffic is down 12%" in February is reading two
 * completely different emergencies.
 *
 * The bar is a progress bar against what is needed, not against what has
 * happened — projected inquiries over required inquiries — so a landlord sees
 * the gap rather than a number they have to hold the target in their head to
 * interpret.
 */

import Link from 'next/link'
import type { LeasingPace } from '@/lib/leasingPace'
import { C, TONE } from './theme'

const VERDICT: Record<LeasingPace['verdict'], { tone: keyof typeof TONE; label: string }> = {
  on_track:    { tone: 'good', label: 'On pace' },
  tight:       { tone: 'warn', label: 'Tight' },
  behind:      { tone: 'bad',  label: 'Behind' },
  no_vacancy:  { tone: 'good', label: 'Full' },
  unknown:     { tone: 'info', label: 'Not enough to say' },
}

function prettyDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export default function PaceCard({ pace }: { pace: LeasingPace }) {
  const v = VERDICT[pace.verdict]
  const t = TONE[v.tone]

  const progress = pace.inquiriesNeeded && pace.projectedInquiries != null
    ? Math.min(100, Math.round((pace.projectedInquiries / pace.inquiriesNeeded) * 100))
    : null

  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderLeft: `4px solid ${t.fg}`,
      borderRadius: 12, padding: '15px 17px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: t.fg, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>
            Leasing pace
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: t.fg, marginBottom: 4 }}>
            {pace.headline}
          </div>
          <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.65 }}>{pace.detail}</div>
        </div>
        <span style={{
          flexShrink: 0, background: t.fg, color: '#fff', borderRadius: 20,
          padding: '3px 11px', fontSize: 11, fontWeight: 700,
        }}>
          {v.label}
        </span>
      </div>

      {progress != null && pace.deadline && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            height: 8, background: 'rgba(15,23,42,0.07)', borderRadius: 99, overflow: 'hidden',
          }}>
            <div style={{ height: '100%', width: `${progress}%`, background: t.fg, borderRadius: 99, transition: 'width .4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 5, fontSize: 11, color: C.ink2 }}>
            <span>
              {/* A comfortable landlord gets time-to-fill, not a projection:
                  "346 projected against the 8 you need" is true and useless. */}
              {pace.verdict === 'on_track' && pace.weeksToFill != null
                ? <>At this rate, filled in <strong style={{ color: C.ink }}>
                    {pace.weeksToFill < 1 ? 'under a week' : `~${Math.round(pace.weeksToFill)} week${Math.round(pace.weeksToFill) === 1 ? '' : 's'}`}
                  </strong></>
                : <><strong style={{ color: C.ink }}>{pace.projectedInquiries}</strong> inquiries projected by {prettyDate(pace.deadline)}</>}
            </span>
            <span>
              <strong style={{ color: C.ink }}>~{pace.inquiriesNeeded}</strong> needed for {pace.roomsOpen} room{pace.roomsOpen === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}

      {pace.verdict !== 'no_vacancy' && (
        <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href="/landlord/performance" style={{ fontSize: 12.5, fontWeight: 600, color: t.fg, textDecoration: 'none', borderBottom: `1px solid ${t.border}` }}>
            Check the price against comps →
          </Link>
          {pace.assumed && (
            // Said out loud, because a pace built on a borrowed ratio is a
            // different claim from one built on this landlord's own history.
            <span style={{ fontSize: 11, color: C.muted }}>
              Based on the platform average of {pace.inquiriesPerRoom} inquiries per signed room —
              this sharpens once you have signed a few through HomeHive.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
