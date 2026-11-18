'use client'

import Link from 'next/link'
import ActivityFeed, { ACTIVITY_CSS } from './ActivityFeed'
import { activityHref, type ActivityLane } from '@/lib/landlordActivity'
import { useScopedActivity } from '@/lib/useLandlordActivity'

/**
 * The feed, embedded where the thing it is about lives.
 *
 * A central inbox has one weakness: it answers "what happened" and never
 * "what happened *to this*". A landlord standing on a property, a lease or a
 * tenant has already told us what they are asking about, and making them
 * retype it into a search box on another page is the step at which they stop
 * bothering.
 *
 * So the same feed appears in place, scoped and short. It is explicitly not a
 * different feature: the rows are the same component, the read state is the
 * same watermark, and the "View all" link lands on the Activity page with this
 * exact scope applied — so the embedded feed is the beginning of the trail
 * rather than a summary that has to be complete.
 *
 * Scoped by email for a person, by plan for a lease, by property for a
 * property. Email, because that is the only thing joining a `tenants` row to
 * a payer — `payment_plan_tenants` has no `tenant_id`.
 */

export default function ActivityInline({
  propertyId, planId, email,
  title = 'Recent activity',
  limit = 6,
  lane,
  emptyHint,
}: {
  propertyId?: string | null
  planId?: string | null
  email?: string | null
  title?: string
  limit?: number
  /** Deep-links the "View all" into one lane, when the host page is about one. */
  lane?: ActivityLane | null
  emptyHint?: string
}) {
  const { events, lastReadAt, loaded } = useScopedActivity({ propertyId, planId, email }, limit)
  const scope = { propertyId, planId, email }

  // Nothing to scope by means nothing to show. Rendering an unscoped feed here
  // would quietly put another tenant's rent on this tenant's page.
  if (!propertyId && !planId && !email) return null

  return (
    <div className="aci-card">
      <style>{CSS}{ACTIVITY_CSS}</style>
      <div className="aci-hd">
        <span className="aci-ttl">{title}</span>
        <Link className="aci-all" href={activityHref(scope, lane)}>View all →</Link>
      </div>
      <div className="aci-bd">
        {!loaded ? (
          <div className="aci-loading">Loading…</div>
        ) : (
          <ActivityFeed
            events={events}
            lastReadAt={lastReadAt}
            dense
            // No day headings: in a six-row card they would outnumber the rows.
            // Each row carries its own timestamp instead.
            showDays={false}
            empty={{
              title: 'Nothing recorded yet',
              sub: emptyHint ?? 'Payments, email and portal sign-ins will show up here.',
            }}
          />
        )}
      </div>
    </div>
  )
}

const CSS = `
  .aci-card {
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px;
    margin-bottom: 16px; font-family: 'DM Sans', sans-serif;
  }
  .aci-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    padding: 12px 16px 10px; border-bottom: 1px solid #f1f5f9;
  }
  .aci-ttl {
    font-size: 12px; font-weight: 700; color: #0f172a;
    text-transform: uppercase; letter-spacing: 0.6px;
  }
  .aci-all { font-size: 11.5px; font-weight: 700; color: #2563eb; text-decoration: none; white-space: nowrap; }
  .aci-all:hover { text-decoration: underline; }
  .aci-bd { padding: 6px 8px 8px; }
  .aci-loading { padding: 22px 16px; text-align: center; font-size: 12.5px; color: #94a3b8; }
`
