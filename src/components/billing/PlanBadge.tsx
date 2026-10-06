'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { planDisplayName, isPlanTier } from '@/lib/landlordPlans'

/** A small, clickable "you are on X" chip that links to billing. */

interface PlanBadgeProps {
  plan: string | null
  status?: string | null
}

const STYLES: Record<string, { bg: string; color: string; border: string }> = {
  starter:   { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  growth:    { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  unlimited: { bg: '#faf5ff', color: '#6b21a8', border: '#e9d5ff' },
  legacy:    { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
  past_due:  { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
}

export function PlanBadge({ plan, status }: PlanBadgeProps) {
  if (!plan || plan === 'per_lead' || plan === 'free') return null

  const cfg = status === 'past_due'
    ? STYLES.past_due
    : isPlanTier(plan) ? STYLES[plan] : STYLES.legacy

  const text = status === 'past_due'
    ? `${planDisplayName(plan)} · payment due`
    : planDisplayName(plan)

  return (
    <Link href="/landlord/billing" style={{ textDecoration: 'none' }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 10px',
        fontFamily: "'DM Sans', sans-serif",
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}>
        {text}
      </span>
    </Link>
  )
}

/** Fetches the landlord's plan itself, for places that don't already have it. */
export function PlanBadgeAsync({ landlordId }: { landlordId?: string }) {
  const [plan, setPlan] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!landlordId) return
    import('@/lib/supabase').then(({ supabase }) => {
      supabase
        .from('landlord_plans')
        .select('plan_type, status')
        .eq('landlord_id', landlordId)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return
          if (data.status === 'cancelled') return
          setPlan(data.plan_type)
          setStatus(data.status)
        })
    })
  }, [landlordId])

  return <PlanBadge plan={plan} status={status} />
}
