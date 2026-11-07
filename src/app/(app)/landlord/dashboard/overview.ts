'use client'

/**
 * The overview's data, loaded once and derived in one place.
 *
 * The overview, the portfolio-analytics page and the traffic page all need the
 * same four lists (properties, leads, leases, plans) and the same handful of
 * figures on top of them. Those figures were computed inline in the overview's
 * render, so a second page could only have them by copying the arithmetic —
 * and two copies of "what counts as overdue" is exactly the kind of drift that
 * makes two screens disagree about whether a landlord is owed money.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase'
import { getPropertiesByOwner, Property } from '@/lib/properties'
import { getLeadsForOwner, Lead } from '@/lib/leads'
import { getLeasesForOwner, getLeaseStatus, Lease } from '@/lib/leases'
import { getPlansForOwner, PaymentPlan } from '@/lib/payments'

export type Portfolio = {
  loading: boolean
  userName: string
  properties: Property[]
  leads: Lead[]
  leases: Lease[]
  plans: PaymentPlan[]
}

export function usePortfolio(): Portfolio {
  const router = useRouter()
  const [state, setState] = useState<Portfolio>({
    loading: true, userName: '', properties: [], leads: [], leases: [], plans: [],
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }
      const [properties, leads, leases, plans] = await Promise.all([
        getPropertiesByOwner(user.id),
        getLeadsForOwner(user.id),
        getLeasesForOwner(user.id),
        getPlansForOwner(user.id),
      ])
      if (cancelled) return
      setState({
        loading: false,
        userName: user.user_metadata?.full_name?.split(' ')[0] || 'there',
        properties, leads, leases, plans,
      })
    }
    load()
    return () => { cancelled = true }
  }, [router])

  return state
}

// ── Formatting and dates ─────────────────────────────────────────────────────

export const fmtCurrency = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
    : `$${n.toLocaleString()}`

export const fmtFull = (n: number) => `$${n.toLocaleString()}`

export function daysUntil(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

export function getGreeting(name: string) {
  const h = new Date().getHours()
  if (h < 12) return `Good morning, ${name}`
  if (h < 17) return `Good afternoon, ${name}`
  return `Good evening, ${name}`
}

export const LEAD_STAGES = ['new', 'contacted', 'engaged', 'qualified', 'tour_scheduled'] as const

export const STAGE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', engaged: 'Engaged',
  qualified: 'Qualified', tour_scheduled: 'Tour Sched.',
}

export const STAGE_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  new:            { color: '#1d4ed8', bg: '#eff6ff',  border: '#bfdbfe' },
  contacted:      { color: '#0891b2', bg: '#ecfeff',  border: '#a5f3fc' },
  engaged:        { color: '#d97706', bg: '#fffbeb',  border: '#fde68a' },
  qualified:      { color: '#16a34a', bg: '#f0fdf4',  border: '#bbf7d0' },
  tour_scheduled: { color: '#7c3aed', bg: '#f5f3ff',  border: '#ddd6fe' },
  closed:         { color: '#6b7280', bg: '#f9fafb',  border: '#e5e7eb' },
}

// ── Derived figures ──────────────────────────────────────────────────────────

export type OverdueSummary = { planId: string; propertyName: string; owed: number; count: number }

export function derive({ properties, leads, leases, plans }: Omit<Portfolio, 'loading' | 'userName'>) {
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // ── Leases ──
  const currentLeases  = leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'current')
  const upcomingLeases = leases.filter(l => getLeaseStatus(l.start_date, l.end_date) === 'upcoming')
  const monthlyRevenue = currentLeases.reduce((s, l) => s + (l.rent_amount || 0), 0)
  const annualRevenue  = monthlyRevenue * 12

  const expiringSoon = currentLeases
    .map(l => ({ lease: l, days: daysUntil(l.end_date) }))
    .filter(x => x.days >= 0 && x.days <= 60)
    .sort((a, b) => a.days - b.days)

  // ── Properties ──
  const totalRooms    = properties.reduce((s, p) => s + (p.total_rooms || 0), 0)
  const vacantRooms   = properties.reduce((s, p) => s + (p.available || 0), 0)
  const occupiedRooms = totalRooms - vacantRooms
  const occupancyPct  = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0

  // "Live" needs all three axes to agree: approved by HomeHive, switched on by
  // the landlord, and a plan we are being paid for. A listing missing the last
  // one is finished and invisible, which is the case worth surfacing loudly.
  const liveProps = properties.filter(p =>
    p.admin_status === 'active'
    && (p.listing_status ?? 'active') === 'active'
    && p.owner_plan_active !== false
  ).length
  const unpaidProps = properties.filter(p => p.owner_plan_active === false)

  // ── Payments ──
  const allSPs = plans.flatMap(p => p.scheduled_payments || [])
  const thisMonth = { y: today.getFullYear(), m: today.getMonth() }

  const thisMonthSPs = allSPs.filter(sp => {
    const d = new Date(sp.due_date + 'T00:00:00')
    return d.getFullYear() === thisMonth.y && d.getMonth() === thisMonth.m
  })
  const monthDue     = thisMonthSPs.reduce((s, sp) => s + sp.amount, 0)
  const monthPaid    = thisMonthSPs.reduce((s, sp) => s + sp.paid_amount, 0)
  const monthPending = monthDue - monthPaid
  const collectionRate = monthDue > 0 ? Math.round((monthPaid / monthDue) * 100) : null

  const overdueSPs = allSPs.filter(sp => {
    const d = new Date(sp.due_date + 'T00:00:00')
    return d < today && ['missed', 'late', 'partial', 'pending'].includes(sp.status) && sp.paid_amount < sp.amount
  })
  const overdueTotal = overdueSPs.reduce((s, sp) => s + (sp.amount - sp.paid_amount), 0)

  const overdueByPlan = new Map<string, OverdueSummary>()
  for (const sp of overdueSPs) {
    const plan = plans.find(p => p.id === sp.plan_id)
    if (!plan) continue
    const owed = sp.amount - sp.paid_amount
    const existing = overdueByPlan.get(sp.plan_id)
    if (existing) { existing.owed += owed; existing.count++ }
    else overdueByPlan.set(sp.plan_id, { planId: plan.id, propertyName: plan.property?.name || 'Unknown', owed, count: 1 })
  }
  const overdueList = Array.from(overdueByPlan.values()).sort((a, b) => b.owed - a.owed)

  // ── Leads ──
  const activeLeads    = leads.filter(l => l.status !== 'closed')
  const stageCounts    = LEAD_STAGES.map(s => ({ stage: s, count: leads.filter(l => l.status === s).length }))
  const newLeads       = leads.filter(l => l.status === 'new')
  const qualifiedCount = leads.filter(l => l.status === 'qualified' || l.status === 'tour_scheduled').length

  return {
    today,
    currentLeases, upcomingLeases, monthlyRevenue, annualRevenue, expiringSoon,
    totalRooms, vacantRooms, occupiedRooms, occupancyPct, liveProps, unpaidProps,
    allSPs, monthDue, monthPaid, monthPending, collectionRate,
    overdueSPs, overdueTotal, overdueList,
    activeLeads, stageCounts, newLeads, qualifiedCount,
    propNameBySlug: Object.fromEntries(properties.map(p => [p.slug, p.name])) as Record<string, string>,
  }
}

/** Per-property arrears, as the properties panel shows them. */
export function overdueForProperty(plans: PaymentPlan[], slug: string, today: Date) {
  const plan = plans.find(pl => pl.property?.slug === slug)
  if (!plan) return 0
  return (plan.scheduled_payments || [])
    .filter(sp => {
      const d = new Date(sp.due_date + 'T00:00:00')
      return d < today && sp.paid_amount < sp.amount && ['missed', 'late', 'partial', 'pending'].includes(sp.status)
    })
    .reduce((s, sp) => s + sp.amount - sp.paid_amount, 0)
}
