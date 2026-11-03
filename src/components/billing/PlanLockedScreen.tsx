'use client'

import Link from 'next/link'
import { PLANS, PLAN_ORDER, formatMonthly } from '@/lib/landlordPlans'
import type { LockedFeature } from '@/lib/landlordAccess'

/**
 * What a free landlord sees instead of a paid page.
 *
 * It replaces a redirect to the pricing page, and the difference matters. A
 * redirect answers a question the landlord did not ask ("here are three
 * tiers") and loses the one they did ("what is in Screening?"). This screen
 * names the thing they clicked, says what it does, and only then asks for
 * money — which is the order the decision actually happens in.
 *
 * It is also deliberately not a dead end. Two exits are always offered: the
 * plan, and back to the work they can still do for free. A paywall with one
 * door reads as a hostage situation; a landlord who leaves and comes back to
 * finish a listing is worth more than one who bounces off a wall.
 */

export default function PlanLockedScreen({
  feature,
  propertyCount = 0,
}: {
  feature: LockedFeature
  /** Used to make the ask concrete: "publish the 2 you have built". */
  propertyCount?: number
}) {
  const cheapest = PLANS[PLAN_ORDER[0]]
  const built =
    propertyCount > 0
      ? `Publish the ${propertyCount === 1 ? 'property' : `${propertyCount} properties`} you have already built, and this comes with it.`
      : 'Add a property first — building is free — then start a plan to put it in front of students.'

  return (
    <div style={{
      fontFamily: "'DM Sans', sans-serif",
      maxWidth: 680, margin: '0 auto', padding: '48px 20px 80px',
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e8e4db', borderRadius: 16,
        padding: '32px 30px', boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: '#fdf2f5', color: '#8C1D40', borderRadius: 20,
          padding: '4px 12px', fontSize: 11.5, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>
          <span aria-hidden="true">🔒</span> Included with a plan
        </div>

        <h1 style={{
          fontFamily: "'Fraunces', serif", fontStyle: 'italic', fontWeight: 600,
          fontSize: 28, color: '#1a1a1a', letterSpacing: '-0.5px',
          marginTop: 16, lineHeight: 1.2,
        }}>
          {feature.title}
        </h1>
        <p style={{ fontSize: 15, color: '#4b5563', lineHeight: 1.6, marginTop: 10 }}>
          {feature.promise}
        </p>

        <ul style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'grid', gap: 10 }}>
          {feature.points.map(point => (
            <li key={point} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              fontSize: 13.5, color: '#1a1a1a', lineHeight: 1.5,
            }}>
              <span aria-hidden="true" style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
              {point}
            </li>
          ))}
        </ul>

        <div style={{
          marginTop: 24, padding: '16px 18px', background: '#faf9f6',
          border: '1px solid #e8e4db', borderRadius: 12,
          fontSize: 13, color: '#4b5563', lineHeight: 1.6,
        }}>
          <strong style={{ color: '#1a1a1a' }}>
            Building your listings stays free.
          </strong>{' '}
          {built} Plans start at {formatMonthly(cheapest.priceCents)} and cover every feature —
          paying more only covers more properties.
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
          <Link href="/landlord/subscribe" style={{
            background: '#8C1D40', color: '#fff', textDecoration: 'none',
            fontSize: 13.5, fontWeight: 700, padding: '12px 22px', borderRadius: 9,
          }}>
            See plans →
          </Link>
          <Link href="/landlord/listings" style={{
            background: '#fff', color: '#1a1a1a', textDecoration: 'none',
            border: '1px solid #e8e4db',
            fontSize: 13.5, fontWeight: 600, padding: '12px 22px', borderRadius: 9,
          }}>
            Back to my listings
          </Link>
        </div>

        <div style={{ fontSize: 12, color: '#9b9b9b', marginTop: 14, lineHeight: 1.6 }}>
          Cancel any time. Nothing you have built is deleted if you don&apos;t —
          your listings, photos and settings stay exactly as they are.
        </div>
      </div>
    </div>
  )
}
