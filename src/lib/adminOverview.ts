// The admin overview, built from rows instead of from the whole database.
//
// The overview page used to run this arithmetic in the browser, over two
// downloads: every lead, and every property through the admin property select
// — which is `select *` plus five child tables (images, tags, nearby, ASU
// reasons, rooms). The page needed six columns out of all of that, and threw
// the rest away. Worse, it re-ran the pair on every realtime change to either
// table, so a busy afternoon of lead activity meant downloading the platform
// repeatedly to redraw four small charts.
//
// Moving the arithmetic here does two things: the route can ask for only the
// columns the charts consume, and the browser receives a few kilobytes of
// finished series rather than the raw rows.

export type LeadStatus =
  | 'new' | 'contacted' | 'follow_up' | 'engaged' | 'qualified'
  | 'matching' | 'cold' | 'tour_scheduled' | 'closed'

export type AdminPropertyStatus =
  'active' | 'pending' | 'inactive' | 'test' | 'flagged' | 'rejected'

/** The only lead columns the overview reads. */
export type OverviewLeadRow = {
  created_at: string | null
  status: LeadStatus | null
  closed_reason: string | null
}

/** The only property columns the overview reads. */
export type OverviewPropertyRow = {
  created_at: string | null
  admin_status: AdminPropertyStatus | null
  is_test: boolean | null
}

export type OverviewData = {
  stats: {
    totalLeads: number
    activeProperties: number
    pendingListings: number
    thisWeekLeads: number
    conversionRate: number
  }
  leadVolume: Array<{ day: string; count: number }>
  funnelData: Array<{ status: string; label: string; count: number; color: string }>
  statusDist: Array<{ status: string; label: string; count: number; color: string }>
  /**
   * Cumulative totals, one point per *day* rather than one per event. The old
   * series carried a point for every lead and every property ever created, in
   * a chart 160 pixels tall — hundreds of points that could not be told apart
   * on screen, and a payload that grew forever. `date` is an ISO day so the
   * series survives JSON; the chart parses it.
   */
  growthData: Array<{ date: string; properties: number; leads: number }>
}

export const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string }> = {
  new:            { label: 'New',            color: '#1d4ed8' },
  contacted:      { label: 'Contacted',      color: '#c9973a' },
  follow_up:      { label: 'Follow Up',      color: '#c2410c' },
  engaged:        { label: 'Engaged',        color: '#7c3aed' },
  qualified:      { label: 'Qualified',      color: '#166534' },
  matching:       { label: 'Matching',       color: '#8b5cf6' },
  cold:           { label: 'Cold',           color: '#64748b' },
  tour_scheduled: { label: 'Qualified',      color: '#166534' },
  closed:         { label: 'Closed',         color: '#8C1D40' },
}

export const ADMIN_STATUS_CFG: Record<AdminPropertyStatus, { label: string; color: string }> = {
  active:   { label: 'Active',   color: '#166534' },
  pending:  { label: 'Pending',  color: '#c9973a' },
  inactive: { label: 'Inactive', color: '#9b9b9b' },
  test:     { label: 'Test',     color: '#7c3aed' },
  flagged:  { label: 'Flagged',  color: '#dc2626' },
  rejected: { label: 'Rejected', color: '#9f1239' },
}

export function buildOverviewData(
  leads: OverviewLeadRow[],
  properties: OverviewPropertyRow[],
): OverviewData {
  const now = Date.now()
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000

  const activeProperties = properties.filter(p => p.admin_status === 'active' && !p.is_test).length
  const pendingListings = properties.filter(p => p.admin_status === 'pending').length
  const thisWeekLeads = leads.filter(l => l.created_at && new Date(l.created_at).getTime() > oneWeekAgo).length
  const closedLeads = leads.filter(l => l.status === 'closed' && l.closed_reason === 'leased').length
  const conversionRate = leads.length > 0 ? Math.round((closedLeads / leads.length) * 100) : 0

  // Lead volume — last 30 days by day. Seeded with zeroes so a quiet day reads
  // as a quiet day rather than as a missing bar.
  const volumeMap = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    volumeMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const l of leads) {
    if (!l.created_at) continue
    const day = l.created_at.slice(0, 10)
    if (volumeMap.has(day)) volumeMap.set(day, (volumeMap.get(day) ?? 0) + 1)
  }
  const leadVolume = Array.from(volumeMap.entries()).map(([day, count]) => ({ day, count }))

  const funnelData = (Object.keys(LEAD_STATUS_CONFIG) as LeadStatus[]).map(s => ({
    status: s,
    label: LEAD_STATUS_CONFIG[s].label,
    count: leads.filter(l => l.status === s).length,
    color: LEAD_STATUS_CONFIG[s].color,
  }))

  const statusDist = (Object.keys(ADMIN_STATUS_CFG) as AdminPropertyStatus[]).map(s => ({
    status: s,
    label: ADMIN_STATUS_CFG[s].label,
    count: properties.filter(p => p.admin_status === s).length,
    color: ADMIN_STATUS_CFG[s].color,
  })).filter(d => d.count > 0)

  // Platform growth — cumulative, collapsed to one point per day.
  const perDay = new Map<string, { properties: number; leads: number }>()
  const bump = (iso: string | null, key: 'properties' | 'leads') => {
    if (!iso) return
    const day = iso.slice(0, 10)
    const cur = perDay.get(day) ?? { properties: 0, leads: 0 }
    cur[key]++
    perDay.set(day, cur)
  }
  for (const p of properties) bump(p.created_at, 'properties')
  for (const l of leads) bump(l.created_at, 'leads')

  let cumProps = 0, cumLeads = 0
  const growthData: OverviewData['growthData'] = []
  for (const day of Array.from(perDay.keys()).sort()) {
    const d = perDay.get(day)!
    cumProps += d.properties
    cumLeads += d.leads
    growthData.push({ date: day, properties: cumProps, leads: cumLeads })
  }

  return {
    stats: { totalLeads: leads.length, activeProperties, pendingListings, thisWeekLeads, conversionRate },
    leadVolume,
    funnelData,
    statusDist,
    growthData,
  }
}
