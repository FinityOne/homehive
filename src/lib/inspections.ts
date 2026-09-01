import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type InspectionStatus = 'draft' | 'finalized' | 'settled'

/**
 * Who a finding is charged to.
 * `tenants` — one or more named people, split evenly between them.
 * `tenant`  — legacy single-person mode, still read for older rows.
 */
export type Allocation = 'all' | 'lease' | 'tenant' | 'tenants'

/**
 * Where each person's money ended up.
 * `settled` means nothing had to move — charges exactly consumed the deposit.
 */
export type SettlementStatus = 'pending' | 'returned' | 'collected' | 'settled'

export type InspectionParty = {
  id: string
  inspection_id: string
  lease_id: string | null
  tenant_id: string | null
  name: string
  email: string | null
  room_label: string | null
  deposit_held: number
  deposit_source: 'manual' | 'payments'
  settlement_status: SettlementStatus
  settled_amount: number | null
  settled_on: string | null
  settlement_method: string | null
  settlement_note: string | null
  /** When this tenant was last emailed their statement. */
  report_sent_at: string | null
  report_sent_to: string | null
  /** Token for this tenant's own personalised report link. */
  share_token: string
  position: number
}

export type InspectionPhoto = {
  id: string
  item_id: string
  url: string
  storage_path: string | null
  caption: string | null
  position: number
}

export type InspectionItem = {
  id: string
  inspection_id: string
  area: string | null
  title: string
  description: string | null
  notes: string | null
  cost: number
  is_wear_and_tear: boolean
  allocation: Allocation
  allocated_lease_id: string | null
  /** @deprecated superseded by `party_ids`; still read for pre-migration rows. */
  allocated_party_id: string | null
  /** Parties this finding is charged to when allocation is 'tenants'. */
  party_ids: string[]
  position: number
  photos: InspectionPhoto[]
}

/** One issued version of the report. Rows are append-only history. */
export type InspectionRevision = {
  id: string
  inspection_id: string
  version: number
  issued_at: string
  note: string | null
  snapshot: {
    parties: { id: string; name: string; charges: number; deposit: number; balance: number }[]
    chargeable: number
  } | null
}

export type InspectionLeaseLink = {
  id: string
  inspection_id: string
  lease_id: string
  lease?: {
    id: string
    start_date: string
    end_date: string
    unit_number: string | null
    rent_amount: number | null
  }
}

export type Inspection = {
  id: string
  owner_id: string
  property_id: string
  title: string | null
  status: InspectionStatus
  period_start: string | null
  period_end: string | null
  inspection_date: string | null
  inspected_by: string | null
  tenant_present: boolean
  summary: string | null
  response_due_date: string | null
  share_token: string
  finalized_at: string | null
  settled_at: string | null
  /** Issued version. 0 = never issued. */
  version: number
  revision_note: string | null
  revisions: InspectionRevision[]
  created_at: string
  updated_at: string
  property?: { id: string; name: string; address: string; slug: string }
  leases: InspectionLeaseLink[]
  parties: InspectionParty[]
  items: InspectionItem[]
  lateFees: InspectionLateFee[]
}

// Areas most move-out findings land in — offered as a datalist, never enforced.
export const AREA_SUGGESTIONS = [
  'Front door / entry', 'Living room', 'Kitchen', 'Dining room', 'Hallway',
  'Bathroom', 'Bedroom', 'Laundry', 'Garage', 'Yard / exterior',
  'Common area', 'Appliances', 'Keys & remotes', 'Cleaning', 'Utilities',
]

const INSPECTION_SELECT = `
  *,
  property:properties ( id, name, address, slug ),
  leases:checkout_inspection_leases ( id, inspection_id, lease_id, lease:leases ( id, start_date, end_date, unit_number, rent_amount ) ),
  parties:checkout_inspection_parties ( * ),
  items:checkout_inspection_items ( *, photos:checkout_inspection_photos ( * ), itemParties:checkout_inspection_item_parties ( party_id ) ),
  lateFees:checkout_inspection_late_fees ( * ),
  revisions:checkout_inspection_revisions ( * )
`

function mapInspection(row: any): Inspection {
  const parties: InspectionParty[] = [...(row.parties ?? [])]
    .sort((a: any, b: any) => a.position - b.position)
    .map((p: any) => ({
      ...p,
      deposit_held: Number(p.deposit_held ?? 0),
      settled_amount: p.settled_amount == null ? null : Number(p.settled_amount),
    }))

  const items: InspectionItem[] = [...(row.items ?? [])]
    .sort((a: any, b: any) => a.position - b.position)
    .map((i: any) => ({
      ...i,
      cost: Number(i.cost ?? 0),
      // Fall back to the legacy single-party column for rows written before
      // multi-tenant allocation existed.
      party_ids: (i.itemParties ?? []).length > 0
        ? (i.itemParties ?? []).map((ip: any) => ip.party_id)
        : (i.allocated_party_id ? [i.allocated_party_id] : []),
      photos: [...(i.photos ?? [])].sort((a: any, b: any) => a.position - b.position),
    }))

  const lateFees: InspectionLateFee[] = [...(row.lateFees ?? [])]
    .sort((a: any, b: any) => a.position - b.position)
    .map((f: any) => ({
      ...f,
      amount_due: Number(f.amount_due ?? 0),
      fee_amount: Number(f.fee_amount ?? 0),
      ledger_fee_amount: f.ledger_fee_amount == null ? null : Number(f.ledger_fee_amount),
      rule_fee_amount: f.rule_fee_amount == null ? null : Number(f.rule_fee_amount),
      rule_max_total: f.rule_max_total == null ? null : Number(f.rule_max_total),
    }))

  const revisions: InspectionRevision[] = [...(row.revisions ?? [])]
    .sort((a: any, b: any) => b.version - a.version)

  return { ...row, leases: row.leases ?? [], parties, items, lateFees, revisions }
}

// ── Money helpers ────────────────────────────────────────────────────────────
// All splitting happens in integer cents. Floats would drift a few pennies
// across a dozen findings, and a report that doesn't add up is worthless in a
// deposit dispute.

const toCents = (n: number) => Math.round(n * 100)
const fromCents = (c: number) => c / 100

export function fmtMoney(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * Split `cents` evenly across `n` shares, giving the remainder pennies to the
 * earliest shares so the parts always sum back to the whole.
 */
function splitEvenly(cents: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(cents / n)
  let rem = cents - base * n
  return Array.from({ length: n }, () => {
    const extra = rem > 0 ? 1 : 0
    rem -= extra
    return base + extra
  })
}

export type PartyCharge = {
  itemId: string
  title: string
  area: string | null
  /** This party's share of the item, in dollars. */
  amount: number
  /** How the item reached them — drives the "shared" label on the report. */
  basis: 'direct' | 'shared'
  sharedWith: number
}

export type PartyTotal = {
  party: InspectionParty
  charges: PartyCharge[]
  /** Damage charged to this person alone. */
  directTotal: number
  /** This person's slice of common-area / shared findings. */
  sharedTotal: number
  /** Late-payment fees carried over from the rent ledger. */
  lateFeesTotal: number
  lateFees: InspectionLateFee[]
  total: number
  depositHeld: number
  /** Positive = money back to the tenant, negative = tenant still owes. */
  balance: number
  /** What the landlord still has to do for this person. */
  action: 'refund' | 'collect' | 'none'
  /** True once the money has moved (or never needed to). */
  isSettled: boolean
}

export type InspectionTotals = {
  /** Everything coming out of deposits: damage + late fees. */
  chargeable: number
  damageTotal: number
  lateFeeTotal: number
  wearAndTear: number
  unassigned: number
  perParty: PartyTotal[]
  totalDeposits: number
  totalRefunds: number
  totalOwed: number
  /** People whose money still has to move. */
  outstandingCount: number
  outstandingRefunds: number
  allSettled: boolean
}

/**
 * Resolve every finding into per-tenant charges.
 *
 * - `all`    → split across every party on the report
 * - `lease`  → split across the parties on that lease
 * - `tenant` → charged wholly to one party
 *
 * Wear-and-tear items are documented at $0 and never charged. An item whose
 * target no longer resolves (party removed, lease unlinked) is surfaced as
 * `unassigned` rather than silently vanishing from the totals.
 */
export function computeTotals(inspection: Inspection): InspectionTotals {
  const parties = inspection.parties
  const byParty = new Map<string, PartyCharge[]>(parties.map(p => [p.id, []]))

  let chargeableCents = 0
  let wearCents = 0
  let unassignedCents = 0

  for (const item of inspection.items) {
    const cents = toCents(item.cost)
    if (item.is_wear_and_tear || cents <= 0) {
      wearCents += item.is_wear_and_tear ? cents : 0
      continue
    }

    let targets: InspectionParty[] = []
    if (item.allocation === 'tenants' || item.allocation === 'tenant') {
      // Named people — split evenly between however many were picked.
      const ids = item.party_ids?.length
        ? item.party_ids
        : (item.allocated_party_id ? [item.allocated_party_id] : [])
      targets = parties.filter(p => ids.includes(p.id))
    } else if (item.allocation === 'lease') {
      targets = parties.filter(x => x.lease_id && x.lease_id === item.allocated_lease_id)
    } else {
      targets = parties
    }

    if (targets.length === 0) {
      unassignedCents += cents
      chargeableCents += cents
      continue
    }

    chargeableCents += cents
    const shares = splitEvenly(cents, targets.length)
    targets.forEach((p, idx) => {
      byParty.get(p.id)?.push({
        itemId: item.id,
        title: item.title,
        area: item.area,
        amount: fromCents(shares[idx]),
        basis: targets.length === 1 ? 'direct' : 'shared',
        sharedWith: targets.length,
      })
    })
  }

  const perParty: PartyTotal[] = parties.map(party => {
    const charges = byParty.get(party.id) ?? []
    const directCents = charges.filter(c => c.basis === 'direct').reduce((s, c) => s + toCents(c.amount), 0)
    const sharedCents = charges.filter(c => c.basis === 'shared').reduce((s, c) => s + toCents(c.amount), 0)
    // Late fees ride alongside damage: both come out of the same deposit, but
    // they're kept distinct everywhere so the tenant can see what's what.
    const partyLateFees = (inspection.lateFees ?? []).filter(f => f.party_id === party.id)
    const lateCents = partyLateFees
      .filter(f => f.included)
      .reduce((s, f) => s + toCents(f.fee_amount), 0)
    const totalCents = directCents + sharedCents + lateCents
    const depositCents = toCents(party.deposit_held)
    const balanceCents = depositCents - totalCents
    return {
      party,
      charges,
      directTotal: fromCents(directCents),
      sharedTotal: fromCents(sharedCents),
      lateFeesTotal: fromCents(lateCents),
      lateFees: partyLateFees,
      total: fromCents(totalCents),
      depositHeld: party.deposit_held,
      balance: fromCents(balanceCents),
      action: balanceCents > 0 ? 'refund' : balanceCents < 0 ? 'collect' : 'none',
      isSettled: balanceCents === 0 || party.settlement_status !== 'pending',
    }
  })

  const outstanding = perParty.filter(p => !p.isSettled)

  const lateFeeTotalCents = perParty.reduce((s, p) => s + toCents(p.lateFeesTotal), 0)

  return {
    chargeable: fromCents(chargeableCents + lateFeeTotalCents),
    damageTotal: fromCents(chargeableCents),
    lateFeeTotal: fromCents(lateFeeTotalCents),
    wearAndTear: fromCents(wearCents),
    unassigned: fromCents(unassignedCents),
    perParty,
    totalDeposits: fromCents(perParty.reduce((s, p) => s + toCents(p.depositHeld), 0)),
    totalRefunds: fromCents(perParty.reduce((s, p) => s + Math.max(0, toCents(p.balance)), 0)),
    totalOwed: fromCents(perParty.reduce((s, p) => s + Math.max(0, -toCents(p.balance)), 0)),
    outstandingCount: outstanding.length,
    outstandingRefunds: fromCents(outstanding.reduce((s, p) => s + Math.max(0, toCents(p.balance)), 0)),
    allSettled: parties.length > 0 && outstanding.length === 0,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getInspection(id: string): Promise<Inspection | null> {
  const { data, error } = await supabase
    .from('checkout_inspections')
    .select(INSPECTION_SELECT)
    .eq('id', id)
    .single()
  if (error || !data) return null
  return mapInspection(data)
}

export async function getInspectionsForOwner(ownerId: string): Promise<Inspection[]> {
  const { data, error } = await supabase
    .from('checkout_inspections')
    .select(INSPECTION_SELECT)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map(mapInspection)
}

/**
 * Inspections that already cover a given lease — shown on the lease page.
 * Resolved in two steps: embedding the full inspection tree underneath the join
 * table would nest checkout_inspection_leases inside itself.
 */
export async function getInspectionsForLease(leaseId: string): Promise<Inspection[]> {
  const { data: links, error: linkErr } = await supabase
    .from('checkout_inspection_leases')
    .select('inspection_id')
    .eq('lease_id', leaseId)
  if (linkErr || !links || links.length === 0) return []

  const { data, error } = await supabase
    .from('checkout_inspections')
    .select(INSPECTION_SELECT)
    .in('id', links.map(l => l.inspection_id))
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map(mapInspection)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Start a report from a lease: copies the property, the lease dates as the
 * occupancy period, and every tenant on the lease as a chargeable party.
 */
export async function createInspectionFromLease(
  ownerId: string,
  lease: {
    id: string
    property_id: string
    start_date: string
    end_date: string
    unit_number: string | null
    tenants: { tenant_id: string | null; name: string | null; email: string | null }[]
  },
  propertyName?: string
): Promise<{ id: string | null; error: any }> {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('checkout_inspections')
    .insert({
      owner_id: ownerId,
      property_id: lease.property_id,
      title: propertyName ? `Move-out inspection — ${propertyName}` : 'Move-out inspection',
      period_start: lease.start_date,
      period_end: lease.end_date,
      inspection_date: today,
      status: 'draft',
    })
    .select('id')
    .single()

  if (error || !data) return { id: null, error }
  const inspectionId = data.id

  const { error: linkErr } = await supabase
    .from('checkout_inspection_leases')
    .insert({ inspection_id: inspectionId, lease_id: lease.id })
  if (linkErr) return { id: inspectionId, error: linkErr }

  const partyRows = lease.tenants
    .filter(t => (t.name || t.email))
    .map((t, i) => ({
      inspection_id: inspectionId,
      lease_id: lease.id,
      tenant_id: t.tenant_id,
      name: t.name || t.email || 'Tenant',
      email: t.email,
      room_label: lease.unit_number,
      position: i,
    }))

  if (partyRows.length > 0) {
    const { error: partyErr } = await supabase.from('checkout_inspection_parties').insert(partyRows)
    if (partyErr) return { id: inspectionId, error: partyErr }
  }

  // Seed deposits from the payments ledger so the landlord opens the report
  // with real numbers rather than a column of zeroes. Best-effort: a lease with
  // no payment plan simply leaves them at 0 to fill in by hand.
  const fresh = await getInspection(inspectionId)
  if (fresh) {
    const matches = await findDepositsOnFile(fresh)
    if (matches.length > 0) await applyDepositMatches(matches)
  }

  return { id: inspectionId, error: null }
}

export type InspectionPatch = Partial<Pick<Inspection,
  'title' | 'period_start' | 'period_end' | 'inspection_date' | 'inspected_by' |
  'tenant_present' | 'summary' | 'response_due_date' | 'status'
>>

export async function updateInspection(id: string, patch: InspectionPatch): Promise<{ error: any }> {
  const { error } = await supabase
    .from('checkout_inspections')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error }
}

export async function setInspectionStatus(
  id: string,
  status: InspectionStatus,
  /** Existing issue date, so re-opening and re-issuing doesn't lose it. */
  finalizedAt?: string | null
): Promise<{ error: any }> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('checkout_inspections')
    .update({
      status,
      finalized_at: status === 'draft' ? finalizedAt ?? null : (finalizedAt ?? now),
      settled_at: status === 'settled' ? now : null,
      updated_at: now,
    })
    .eq('id', id)
  return { error }
}

/**
 * Issue the report — version 1 the first time, a superseding revision after.
 *
 * Each issue freezes the per-tenant figures into the revision row, so an
 * earlier version can still be explained once later edits move the live
 * numbers. A revision always carries a reason; that's the whole point of
 * re-issuing rather than quietly editing something tenants already hold.
 */
export async function issueInspection(
  inspection: Inspection,
  note?: string | null
): Promise<{ version: number; error: any }> {
  const nextVersion = (inspection.version ?? 0) + 1
  const now = new Date().toISOString()
  const totals = computeTotals(inspection)

  const snapshot = {
    chargeable: totals.chargeable,
    parties: totals.perParty.map(pt => ({
      id: pt.party.id,
      name: pt.party.name,
      charges: pt.total,
      deposit: pt.depositHeld,
      balance: pt.balance,
    })),
  }

  const { error: revErr } = await supabase
    .from('checkout_inspection_revisions')
    .insert({
      inspection_id: inspection.id,
      version: nextVersion,
      issued_at: now,
      note: note?.trim() || (nextVersion === 1 ? 'Initial issue' : null),
      snapshot,
    })
  if (revErr) return { version: inspection.version ?? 0, error: revErr }

  const { error } = await supabase
    .from('checkout_inspections')
    .update({
      status: 'finalized',
      version: nextVersion,
      revision_note: nextVersion > 1 ? (note?.trim() || null) : null,
      finalized_at: now,
      settled_at: null,
      updated_at: now,
    })
    .eq('id', inspection.id)

  return { version: nextVersion, error }
}

/** Put an issued report back into edit mode so a revision can be prepared. */
export async function reopenForRevision(id: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('checkout_inspections')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error }
}

/**
 * A tenant's copy is stale when their statement went out before the current
 * version was issued — they're holding figures that have since changed.
 */
export function needsResend(inspection: Inspection, party: InspectionParty): boolean {
  if (!party.report_sent_at || !inspection.finalized_at) return false
  return new Date(party.report_sent_at) < new Date(inspection.finalized_at)
}

export async function deleteInspection(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('checkout_inspections').delete().eq('id', id)
  return { error }
}

// ── Leases on the report ─────────────────────────────────────────────────────

/** Link another lease and pull its tenants in as parties in one step. */
export async function addLeaseToInspection(
  inspectionId: string,
  lease: {
    id: string
    unit_number: string | null
    tenants: { tenant_id: string | null; name: string | null; email: string | null }[]
  },
  startPosition: number
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('checkout_inspection_leases')
    .insert({ inspection_id: inspectionId, lease_id: lease.id })
  if (error) return { error }

  const rows = lease.tenants
    .filter(t => (t.name || t.email))
    .map((t, i) => ({
      inspection_id: inspectionId,
      lease_id: lease.id,
      tenant_id: t.tenant_id,
      name: t.name || t.email || 'Tenant',
      email: t.email,
      room_label: lease.unit_number,
      position: startPosition + i,
    }))

  if (rows.length === 0) return { error: null }
  const { error: partyErr } = await supabase.from('checkout_inspection_parties').insert(rows)
  if (partyErr) return { error: partyErr }

  // Pull the newly added tenants' deposits in the same step — scoped to this
  // lease so a deposit the landlord typed by hand elsewhere isn't overwritten.
  const fresh = await getInspection(inspectionId)
  if (fresh) {
    const newPartyIds = new Set(
      fresh.parties.filter(p => p.lease_id === lease.id).map(p => p.id)
    )
    const matches = (await findDepositsOnFile(fresh)).filter(m => newPartyIds.has(m.partyId))
    if (matches.length > 0) await applyDepositMatches(matches)
  }
  return { error: null }
}

export async function removeLeaseFromInspection(
  inspectionId: string,
  leaseId: string
): Promise<{ error: any }> {
  // Drop the lease's parties too — leaving them behind would silently keep
  // charging people whose lease is no longer part of the report.
  await supabase
    .from('checkout_inspection_parties')
    .delete()
    .eq('inspection_id', inspectionId)
    .eq('lease_id', leaseId)
  const { error } = await supabase
    .from('checkout_inspection_leases')
    .delete()
    .eq('inspection_id', inspectionId)
    .eq('lease_id', leaseId)
  return { error }
}

// ── Parties ──────────────────────────────────────────────────────────────────

export async function addParty(
  inspectionId: string,
  party: { name: string; email?: string | null; room_label?: string | null; lease_id?: string | null; deposit_held?: number },
  position: number
): Promise<{ party: InspectionParty | null; error: any }> {
  const { data, error } = await supabase
    .from('checkout_inspection_parties')
    .insert({
      inspection_id: inspectionId,
      name: party.name,
      email: party.email ?? null,
      room_label: party.room_label ?? null,
      lease_id: party.lease_id ?? null,
      deposit_held: party.deposit_held ?? 0,
      position,
    })
    .select()
    .single()
  if (error || !data) return { party: null, error }
  return { party: { ...data, deposit_held: Number(data.deposit_held ?? 0) }, error: null }
}

// ── Live contact details ─────────────────────────────────────────────────────

export type ContactUpdate = {
  partyId: string
  name: string
  from: string | null
  to: string
  source: 'tenant record' | 'lease'
}

/**
 * Find parties whose email has drifted from the live contact record.
 *
 * Names are snapshotted on purpose — an issued statement should keep naming the
 * person it was issued to. An email is not a historical fact though, it's where
 * the statement has to land, so it always follows the current record. The
 * tenant record wins over the lease row, since that's the one landlords keep
 * up to date.
 */
export async function findLiveContacts(inspection: Inspection): Promise<ContactUpdate[]> {
  const parties = inspection.parties
  if (parties.length === 0) return []

  const tenantIds = parties.map(p => p.tenant_id).filter(Boolean) as string[]
  const leaseIds = [...new Set(parties.map(p => p.lease_id).filter(Boolean))] as string[]

  const [tenantsRes, leaseTenantsRes] = await Promise.all([
    tenantIds.length
      ? supabase.from('tenants').select('id, email').in('id', tenantIds)
      : Promise.resolve({ data: [] as any[] }),
    leaseIds.length
      ? supabase.from('lease_tenants').select('lease_id, tenant_id, name, email').in('lease_id', leaseIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const tenantEmail = new Map<string, string>()
  for (const t of tenantsRes.data ?? []) {
    if (t.email?.trim()) tenantEmail.set(t.id, t.email.trim())
  }

  const updates: ContactUpdate[] = []
  for (const p of parties) {
    let live: string | null = null
    let source: ContactUpdate['source'] = 'tenant record'

    if (p.tenant_id && tenantEmail.has(p.tenant_id)) {
      live = tenantEmail.get(p.tenant_id)!
    } else {
      const lt = (leaseTenantsRes.data ?? []).find((r: any) =>
        r.lease_id === p.lease_id &&
        (
          (p.tenant_id && r.tenant_id === p.tenant_id) ||
          norm(r.name) === norm(p.name) ||
          (norm(r.email) && norm(r.email) === norm(p.email))
        )
      )
      if (lt?.email?.trim()) { live = lt.email.trim(); source = 'lease' }
    }

    if (live && norm(live) !== norm(p.email)) {
      updates.push({ partyId: p.id, name: p.name, from: p.email, to: live, source })
    }
  }
  return updates
}

export async function applyContactUpdates(updates: ContactUpdate[]): Promise<{ error: any }> {
  for (const u of updates) {
    const { error } = await supabase
      .from('checkout_inspection_parties')
      .update({ email: u.to })
      .eq('id', u.partyId)
    if (error) return { error }
  }
  return { error: null }
}

// ── Deposits on file (from the payments ledger) ───────────────────────────────

export type DepositMatch = {
  partyId: string
  partyName: string
  amount: number
  /** How the money was traced to this person — shown so the number is trusted. */
  basis: 'tenant' | 'lease-split'
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const firstName = (s: string | null | undefined) => norm(s).split(/\s+/)[0] ?? ''

export type DepositPlan = { id: string; lease_id: string; tenants: { id: string; name: string; email: string | null }[] }
export type DepositRow = { id: string; plan_id: string; plan_tenant_id: string | null; amount: number }

/**
 * Identify which person on the report a payment-plan tenant is.
 *
 * Payments and leases are filled in separately, so the same person is often
 * "Tyler Williams" in one and "Tyler" in the other, and plan emails are often
 * blank. Walk from strongest evidence to weakest — email, full name, then an
 * *unambiguous* first name — and give up rather than guess when two people on
 * the lease share a first name.
 */
function matchPartyToPlanTenant(
  leaseParties: InspectionParty[],
  planTenant: { name: string; email: string | null } | undefined
): InspectionParty | undefined {
  if (!planTenant) return undefined
  const byEmail = leaseParties.find(
    p => norm(p.email) && norm(p.email) === norm(planTenant.email)
  )
  if (byEmail) return byEmail
  const byName = leaseParties.find(p => norm(p.name) === norm(planTenant.name))
  if (byName) return byName
  const firstMatches = leaseParties.filter(
    p => firstName(p.name) && firstName(p.name) === firstName(planTenant.name)
  )
  return firstMatches.length === 1 ? firstMatches[0] : undefined
}

/**
 * Pure matcher: attribute each paid deposit to a party on the report.
 *
 * Payments and leases are entered separately, so the same person is often
 * "Tyler Williams" in one and "Tyler" in the other. Matching walks from
 * strongest evidence to weakest — email, then full name, then an *unambiguous*
 * first name — and only falls back to splitting across the lease when no single
 * person can be identified. Two tenants sharing a first name never get
 * mis-attributed; the deposit splits instead.
 */
export function matchDeposits(
  parties: InspectionParty[],
  plans: DepositPlan[],
  deposits: DepositRow[]
): DepositMatch[] {
  const planById = new Map(plans.map(p => [p.id, p]))
  const totals = new Map<string, { amount: number; basis: DepositMatch['basis'] }>()

  const credit = (partyId: string, amount: number, basis: DepositMatch['basis']) => {
    const cur = totals.get(partyId)
    totals.set(partyId, {
      amount: (cur?.amount ?? 0) + amount,
      // A person-level match is the stronger claim; keep it if we ever saw one.
      basis: cur?.basis === 'tenant' ? 'tenant' : basis,
    })
  }

  for (const dep of deposits) {
    const plan = planById.get(dep.plan_id)
    if (!plan) continue
    const leaseParties = parties.filter(p => p.lease_id === plan.lease_id)
    if (leaseParties.length === 0) continue

    const planTenant = dep.plan_tenant_id
      ? plan.tenants.find(t => t.id === dep.plan_tenant_id)
      : undefined

    const match = matchPartyToPlanTenant(leaseParties, planTenant)
    if (match) { credit(match.id, Number(dep.amount), 'tenant'); continue }

    // Plan-level deposit (or an unidentifiable payer): spread across the lease.
    const cents = Math.round(Number(dep.amount) * 100)
    const base = Math.floor(cents / leaseParties.length)
    let rem = cents - base * leaseParties.length
    leaseParties.forEach(p => {
      const extra = rem > 0 ? 1 : 0
      rem -= extra
      credit(p.id, (base + extra) / 100, 'lease-split')
    })
  }

  return [...totals.entries()].map(([partyId, v]) => ({
    partyId,
    partyName: parties.find(p => p.id === partyId)?.name ?? 'Tenant',
    amount: Math.round(v.amount * 100) / 100,
    basis: v.basis,
  }))
}

/**
 * Find what each party actually paid as a security deposit, by walking
 * lease → payment_plans → special_payments (category 'security_deposit').
 *
 * Only deposits marked paid count — a pending one was never collected, so it
 * isn't money the landlord is holding. A deposit recorded against the plan
 * rather than a person is split evenly across that lease's parties.
 */
export async function findDepositsOnFile(inspection: Inspection): Promise<DepositMatch[]> {
  const leaseIds = inspection.leases.map(l => l.lease_id)
  if (leaseIds.length === 0) return []

  const { data: plans } = await supabase
    .from('payment_plans')
    .select('id, lease_id, tenants:payment_plan_tenants ( id, name, email )')
    .in('lease_id', leaseIds)
  if (!plans || plans.length === 0) return []

  const { data: deposits } = await supabase
    .from('special_payments')
    .select('id, plan_id, plan_tenant_id, amount, status')
    .in('plan_id', plans.map((p: any) => p.id))
    .eq('category', 'security_deposit')
    .eq('status', 'paid')
  if (!deposits || deposits.length === 0) return []

  return matchDeposits(
    inspection.parties,
    (plans as any[]).map(p => ({ id: p.id, lease_id: p.lease_id, tenants: p.tenants ?? [] })),
    (deposits as any[]).map(d => ({
      id: d.id, plan_id: d.plan_id, plan_tenant_id: d.plan_tenant_id, amount: Number(d.amount),
    }))
  )
}

/** Write matched deposits onto the report, stamping them as ledger-sourced. */
export async function applyDepositMatches(matches: DepositMatch[]): Promise<{ error: any }> {
  for (const m of matches) {
    const { error } = await supabase
      .from('checkout_inspection_parties')
      .update({ deposit_held: m.amount, deposit_source: 'payments' })
      .eq('id', m.partyId)
    if (error) return { error }
  }
  return { error: null }
}

// ── Late payment charges ─────────────────────────────────────────────────────

export type LateFeeRuleSnapshot = {
  grace_period_days: number
  fee_amount: number
  frequency_days: number
  max_total_fees: number | null
}

export type InspectionLateFee = {
  id: string
  inspection_id: string
  party_id: string
  scheduled_payment_id: string | null
  label: string
  due_date: string
  paid_date: string | null
  amount_due: number
  is_paid: boolean
  days_late: number
  fee_amount: number
  /** What the rent ledger had recorded — reference only, see buildLateFees. */
  ledger_fee_amount: number | null
  rule_grace_days: number | null
  rule_fee_amount: number | null
  rule_frequency_days: number | null
  rule_max_total: number | null
  basis: 'ledger' | 'computed'
  included: boolean
  position: number
}

const DAY_MS = 86_400_000
const dayCount = (from: string, to: string) =>
  Math.floor((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / DAY_MS)

/**
 * Plain-English justification for a late fee, printed on the tenant's report.
 * Charges a tenant can't follow are charges a tenant disputes.
 */
export function explainLateFee(fee: InspectionLateFee): string {
  const paidPart = fee.paid_date
    ? `paid ${fee.paid_date}`
    : 'still unpaid at the time of this report'
  const base = `Due ${fee.due_date}, ${paidPart} — ${fee.days_late} day${fee.days_late !== 1 ? 's' : ''} late.`

  if (fee.basis === 'ledger') {
    return `${base} Late fee as charged to the account.`
  }
  if (fee.rule_fee_amount == null) return base

  const grace = fee.rule_grace_days ?? 0
  const every = fee.rule_frequency_days ?? 1
  const chargeableDays = Math.max(0, fee.days_late - grace)
  const periods = every > 0 ? Math.floor(chargeableDays / every) : 0
  const capped =
    fee.rule_max_total != null && periods * fee.rule_fee_amount > fee.rule_max_total

  const rule =
    `${grace}-day grace, then ${fmtMoney(fee.rule_fee_amount)}` +
    (every > 1 ? ` per ${every} days` : ' per day')

  return `${base} Lease terms: ${rule}. ` +
    `${chargeableDays} chargeable day${chargeableDays !== 1 ? 's' : ''} after grace ` +
    `= ${periods} × ${fmtMoney(fee.rule_fee_amount)}` +
    (capped ? `, capped at ${fmtMoney(fee.rule_max_total!)}` : '') +
    ` = ${fmtMoney(fee.fee_amount)}.`
}

export type LateFeeDraft = Omit<InspectionLateFee, 'id' | 'inspection_id'>

/**
 * Turn a tenant's payment history into chargeable late fees.
 *
 * The charge is always derived from the facts — due date, the date the tenant
 * actually paid, and the plan's late-fee rule — never copied from
 * `scheduled_payments.late_fees_applied`. That column is a running accrual that
 * does not account for `paid_date`: in live data it shows four figures for the
 * same due date across four tenants, including one who paid three days early.
 * Billing it would charge people for paying on time.
 *
 * The ledger figure is still captured on each row so a landlord who wants to
 * reconcile the two can see both. A payment settled on or before its due date
 * is never charged, whatever the ledger says. Rent still unpaid keeps accruing
 * to the report date.
 */
export function buildLateFees(
  payments: {
    id: string
    plan_tenant_id: string
    due_date: string
    amount: number
    status: string
    paid_date: string | null
    late_fees_applied: number
  }[],
  partyByPlanTenant: Map<string, string>,
  rule: LateFeeRuleSnapshot | null,
  asOf: string,
  startPosition = 0
): LateFeeDraft[] {
  const out: LateFeeDraft[] = []
  let pos = startPosition

  for (const p of payments) {
    if (p.status === 'voided') continue
    const partyId = partyByPlanTenant.get(p.plan_tenant_id)
    if (!partyId) continue

    const isPaid = p.status === 'paid'
    // Paid → count to the day it landed. Unpaid → it's still accruing today.
    const endDate = isPaid && p.paid_date ? p.paid_date : asOf
    const daysLate = Math.max(0, dayCount(p.due_date, endDate))
    if (daysLate === 0) continue // on time (or early) — never chargeable

    const ledgerFee = Number(p.late_fees_applied ?? 0)
    let feeAmount = 0
    let basis: 'ledger' | 'computed' = 'computed'

    if (rule) {
      const chargeable = Math.max(0, daysLate - rule.grace_period_days)
      const periods = rule.frequency_days > 0 ? Math.floor(chargeable / rule.frequency_days) : 0
      const total = periods * rule.fee_amount
      feeAmount = rule.max_total_fees != null ? Math.min(total, rule.max_total_fees) : total
    } else if (ledgerFee > 0) {
      // No rule on file, but the account was charged something — fall back to
      // it so a real, genuinely-late fee isn't dropped.
      feeAmount = ledgerFee
      basis = 'ledger'
    }

    if (feeAmount <= 0) continue // late, but inside the grace period

    out.push({
      party_id: partyId,
      scheduled_payment_id: p.id,
      label: `Rent due ${p.due_date}`,
      due_date: p.due_date,
      paid_date: isPaid ? p.paid_date : null,
      amount_due: Number(p.amount ?? 0),
      is_paid: isPaid,
      days_late: daysLate,
      fee_amount: Math.round(feeAmount * 100) / 100,
      ledger_fee_amount: ledgerFee > 0 ? Math.round(ledgerFee * 100) / 100 : null,
      rule_grace_days: rule?.grace_period_days ?? null,
      rule_fee_amount: rule?.fee_amount ?? null,
      rule_frequency_days: rule?.frequency_days ?? null,
      rule_max_total: rule?.max_total_fees ?? null,
      basis,
      included: true,
      position: pos++,
    })
  }

  return out
}

/** Pull every linked lease's late payments into the report. */
export async function syncLateFees(
  inspection: Inspection
): Promise<{ added: number; error: any }> {
  const leaseIds = inspection.leases.map(l => l.lease_id)
  if (leaseIds.length === 0) return { added: 0, error: null }

  const { data: plans } = await supabase
    .from('payment_plans')
    .select('id, lease_id, tenants:payment_plan_tenants ( id, name, email ), rule:late_fee_rules ( grace_period_days, fee_amount, frequency_days, max_total_fees )')
    .in('lease_id', leaseIds)
  if (!plans || plans.length === 0) return { added: 0, error: null }

  // Don't duplicate charges already on the report.
  const { data: existing } = await supabase
    .from('checkout_inspection_late_fees')
    .select('scheduled_payment_id')
    .eq('inspection_id', inspection.id)
  const seen = new Set((existing ?? []).map((r: any) => r.scheduled_payment_id).filter(Boolean))

  const asOf = inspection.inspection_date || new Date().toISOString().split('T')[0]
  let position = 0
  const drafts: LateFeeDraft[] = []

  for (const plan of plans as any[]) {
    const leaseParties = inspection.parties.filter(p => p.lease_id === plan.lease_id)
    if (leaseParties.length === 0) continue

    const partyByPlanTenant = new Map<string, string>()
    for (const pt of plan.tenants ?? []) {
      const match = matchPartyToPlanTenant(leaseParties, pt)
      if (match) partyByPlanTenant.set(pt.id, match.id)
    }
    if (partyByPlanTenant.size === 0) continue

    const { data: payments } = await supabase
      .from('scheduled_payments')
      .select('id, plan_tenant_id, due_date, amount, status, paid_date, late_fees_applied')
      .eq('plan_id', plan.id)
      .order('due_date')
    if (!payments || payments.length === 0) continue

    const rawRule = Array.isArray(plan.rule) ? plan.rule[0] : plan.rule
    const rule: LateFeeRuleSnapshot | null = rawRule
      ? {
          grace_period_days: rawRule.grace_period_days,
          fee_amount: Number(rawRule.fee_amount),
          frequency_days: rawRule.frequency_days,
          max_total_fees: rawRule.max_total_fees == null ? null : Number(rawRule.max_total_fees),
        }
      : null

    const fresh = (payments as any[]).filter(p => !seen.has(p.id))
    const built = buildLateFees(fresh, partyByPlanTenant, rule, asOf, position)
    position += built.length
    drafts.push(...built)
  }

  if (drafts.length === 0) return { added: 0, error: null }

  const { error } = await supabase
    .from('checkout_inspection_late_fees')
    .insert(drafts.map(d => ({ ...d, inspection_id: inspection.id })))
  return { added: drafts.length, error }
}

export async function setLateFeeIncluded(id: string, included: boolean): Promise<{ error: any }> {
  const { error } = await supabase
    .from('checkout_inspection_late_fees')
    .update({ included })
    .eq('id', id)
  return { error }
}

export async function removeLateFee(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('checkout_inspection_late_fees').delete().eq('id', id)
  return { error }
}

// ── Settlement ───────────────────────────────────────────────────────────────

export type SettlementInput = {
  settlement_status: SettlementStatus
  settled_amount: number | null
  settled_on: string | null
  settlement_method: string | null
  settlement_note: string | null
}

export async function recordSettlement(
  partyId: string,
  input: SettlementInput
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('checkout_inspection_parties')
    .update(input)
    .eq('id', partyId)
  return { error }
}

/** Undo a settlement — puts the person back on the landlord's to-do list. */
export async function clearSettlement(partyId: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('checkout_inspection_parties')
    .update({
      settlement_status: 'pending',
      settled_amount: null,
      settled_on: null,
      settlement_method: null,
      settlement_note: null,
    })
    .eq('id', partyId)
  return { error }
}

/**
 * Keep the inspection's own status honest after any settlement change:
 * everyone squared up → `settled`; anyone still owed → back to `finalized`.
 * Drafts are left alone — nothing is settled until the report is issued.
 */
export async function syncInspectionSettlementStatus(
  inspection: Inspection
): Promise<{ status: InspectionStatus; changed: boolean; error: any }> {
  if (inspection.status === 'draft') {
    return { status: 'draft', changed: false, error: null }
  }
  const { allSettled } = computeTotals(inspection)
  const next: InspectionStatus = allSettled ? 'settled' : 'finalized'
  if (next === inspection.status) return { status: next, changed: false, error: null }

  const { error } = await supabase
    .from('checkout_inspections')
    .update({
      status: next,
      settled_at: next === 'settled' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inspection.id)
  return { status: next, changed: !error, error }
}

export async function updateParty(
  id: string,
  patch: Partial<Pick<InspectionParty, 'name' | 'email' | 'room_label' | 'deposit_held'>>
): Promise<{ error: any }> {
  const { error } = await supabase.from('checkout_inspection_parties').update(patch).eq('id', id)
  return { error }
}

export async function removeParty(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('checkout_inspection_parties').delete().eq('id', id)
  return { error }
}

// ── Findings ─────────────────────────────────────────────────────────────────

export type ItemInput = {
  area: string | null
  title: string
  description: string | null
  notes: string | null
  cost: number
  is_wear_and_tear: boolean
  allocation: Allocation
  allocated_lease_id: string | null
  /** Parties charged when allocation is 'tenants'. Empty for other modes. */
  party_ids: string[]
}

/** Replace the set of tenants a finding is charged to. */
async function writeItemParties(itemId: string, partyIds: string[]): Promise<{ error: any }> {
  const { error: delErr } = await supabase
    .from('checkout_inspection_item_parties')
    .delete()
    .eq('item_id', itemId)
  if (delErr) return { error: delErr }
  if (partyIds.length === 0) return { error: null }

  const { error } = await supabase
    .from('checkout_inspection_item_parties')
    .insert([...new Set(partyIds)].map(party_id => ({ item_id: itemId, party_id })))
  return { error }
}

/** Split the input into the item row and its party links. */
function splitItemInput(input: Partial<ItemInput>) {
  const { party_ids, ...row } = input
  const isTenants = row.allocation === 'tenants' || row.allocation === 'tenant'
  return {
    row: {
      ...row,
      // Only 'tenants' keeps a party list; switching mode clears the old one.
      ...(row.allocation !== undefined && !isTenants ? { allocated_party_id: null } : {}),
    },
    partyIds: isTenants ? (party_ids ?? []) : [],
    touchesParties: party_ids !== undefined || row.allocation !== undefined,
  }
}

export async function addItem(
  inspectionId: string,
  input: ItemInput,
  position: number
): Promise<{ item: InspectionItem | null; error: any }> {
  const { row, partyIds } = splitItemInput(input)
  const { data, error } = await supabase
    .from('checkout_inspection_items')
    .insert({ inspection_id: inspectionId, ...row, allocated_party_id: null, position })
    .select()
    .single()
  if (error || !data) return { item: null, error }

  if (partyIds.length > 0) {
    const { error: linkErr } = await writeItemParties(data.id, partyIds)
    if (linkErr) return { item: null, error: linkErr }
  }

  return {
    item: { ...data, cost: Number(data.cost ?? 0), party_ids: partyIds, photos: [] },
    error: null,
  }
}

export async function updateItem(id: string, input: Partial<ItemInput>): Promise<{ error: any }> {
  const { row, partyIds, touchesParties } = splitItemInput(input)
  const { error } = await supabase
    .from('checkout_inspection_items')
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error }

  if (touchesParties) return writeItemParties(id, partyIds)
  return { error: null }
}

export async function removeItem(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('checkout_inspection_items').delete().eq('id', id)
  return { error }
}

// ── Photos ───────────────────────────────────────────────────────────────────

/**
 * Phone cameras are the main source here, and they don't always label their
 * output: iOS often reports an empty `File.type` for HEIC, and some browsers
 * send `application/octet-stream`. The bucket restricts mime types, so an
 * unlabelled file gets rejected. Derive the type from the extension instead of
 * trusting the browser.
 */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', avif: 'image/avif',
}

function resolveUpload(file: File): { ext: string; contentType: string } {
  const rawExt = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const byExt = MIME_BY_EXT[rawExt]
  const byBrowser = file.type && file.type.startsWith('image/') ? file.type : null
  const contentType = byExt ?? byBrowser ?? 'image/jpeg'
  const ext = rawExt || (contentType.split('/')[1] || 'jpg')
  return { ext, contentType }
}

export async function uploadItemPhoto(
  file: File,
  ownerId: string,
  inspectionId: string,
  itemId: string,
  position: number
): Promise<{ photo: InspectionPhoto | null; error: any }> {
  const { ext, contentType } = resolveUpload(file)
  // Generated key — never the user's filename, which can carry spaces, unicode
  // or '#' and produce an unusable object key.
  const path = `${ownerId}/${inspectionId}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('inspection-photos')
    .upload(path, file, { contentType, upsert: false })
  if (upErr) return { photo: null, error: upErr }

  const { data: { publicUrl } } = supabase.storage.from('inspection-photos').getPublicUrl(path)

  const { data, error } = await supabase
    .from('checkout_inspection_photos')
    .insert({ item_id: itemId, url: publicUrl, storage_path: path, position })
    .select()
    .single()
  if (error || !data) return { photo: null, error }
  return { photo: data as InspectionPhoto, error: null }
}

export async function removePhoto(photo: InspectionPhoto): Promise<{ error: any }> {
  if (photo.storage_path) {
    await supabase.storage.from('inspection-photos').remove([photo.storage_path])
  }
  const { error } = await supabase.from('checkout_inspection_photos').delete().eq('id', photo.id)
  return { error }
}
