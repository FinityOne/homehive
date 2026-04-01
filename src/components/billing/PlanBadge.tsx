'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type PlanType = 'per_lead' | 'single_listing' | 'two_listing' | 'lifetime' | null

interface PlanBadgeProps {
  plan: PlanType
}

export function PlanBadge({ plan }: PlanBadgeProps) {
  if (!plan || plan === 'per_lead') return null

  const config: Record<NonNullable<Exclude<PlanType, 'per_lead'>>, { label: string; bg: string; color: string; border: string }> = {
    single_listing: { label: '1 Listing', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    two_listing:    { label: '2 Listings', bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
    lifetime:       { label: 'Founding Member ⭐', bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
  }

  const cfg = config[plan as keyof typeof config]
  if (!cfg) return null

  return (
    <Link href="/landlord/billing" style={{ textDecoration: 'none' }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        borderRadius: '20px',
        fontSize: '11px',
        fontWeight: 600,
        padding: '3px 10px',
        fontFamily: "'DM Sans', sans-serif",
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>
        {cfg.label}
      </span>
    </Link>
  )
}

// Async version that fetches plan status
export function PlanBadgeAsync({ landlordId }: { landlordId?: string }) {
  const [plan, setPlan] = useState<PlanType>(null)

  useEffect(() => {
    if (!landlordId) return
    import('@/lib/supabase').then(({ supabase }) => {
      supabase
        .from('landlord_plans')
        .select('plan_type, status')
        .eq('landlord_id', landlordId)
        .eq('status', 'active')
        .maybeSingle()
        .then(({ data }) => {
          if (data) setPlan(data.plan_type as PlanType)
        })
    })
  }, [landlordId])

  return <PlanBadge plan={plan} />
}
