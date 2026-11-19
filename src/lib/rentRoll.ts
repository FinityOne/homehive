/**
 * The rent roll.
 *
 * ── Why this document and not another dashboard ────────────────────────────
 *
 * A rent roll is the one piece of paper every outside party asks a rental
 * owner for, and this product had no way to produce it. A lender underwriting a
 * refinance, an insurer pricing a policy, a buyer in diligence, an accountant
 * at year end and a co-owner all ask the same question in the same shape: *one
 * row per unit — who is in it, what they pay, until when, what you hold, and
 * what they owe.*
 *
 * None of those people want a tree they can expand. The portfolio page is the
 * right way to *work* a portfolio and the wrong thing entirely to hand over,
 * and what landlords were doing instead was retyping it into a spreadsheet,
 * which is where the errors come from.
 *
 * ── The one thing that makes it a rent roll rather than a lease list ───────
 *
 * Empty units are rows.
 *
 * That is the whole difference, and it is the reason a lease list is not a
 * substitute. A six-bedroom house with four tenants appears on a lease list as
 * four healthy rows and reads as a full property. On a rent roll it appears as
 * six rows, two of them vacant, and the total at the bottom is the rent the
 * building *could* produce beside the rent it does. Anyone assessing the asset
 * needs both numbers, and a document that quietly omits the empty rooms is
 * the kind of omission that ends a diligence conversation badly.
 *
 * So `rentRoll()` takes the listing's own room count and emits a vacant row for
 * every room no payer is in — valued at the landlord's own asking rent, or left
 * blank when the listing carries no price rather than guessing one.
 *
 * Pure: the tree and the listings in, rows out.
 */

import type { MoneyTree, TreeLease } from './financialsTree'
import type { PropertyFacts } from './propertyMoney'
import type { PropertyOccupancy } from './occupancy'

export type RollState = 'occupied' | 'ending' | 'upcoming' | 'ended' | 'vacant' | 'reserved'

/** `tone` matches `StatusDot`'s four, deliberately: an upcoming tenancy is not
 *  a problem, so it reads quiet rather than borrowing the warning colour. */
export const ROLL_STATE_META: Record<RollState, { label: string; tone: 'good' | 'warn' | 'bad' | 'idle' }> = {
  occupied: { label: 'Occupied',  tone: 'good' },
  ending:   { label: 'Ending',    tone: 'warn' },
  upcoming: { label: 'Upcoming',  tone: 'idle' },
  ended:    { label: 'Ended',     tone: 'idle' },
  vacant:   { label: 'Vacant',    tone: 'bad' },
  // Empty tonight, already let from a later date. Not a vacancy: nothing about
  // it needs marketing and nothing about it is lost rent, so it must not wear
  // the colour or the arithmetic of one.
  reserved: { label: 'Let later',  tone: 'idle' },
}

export type RollRow = {
  /** Stable key. A vacant row has no lease, so it is keyed by its slot. */
  key: string
  propertyId: string
  propertyName: string
  address: string | null
  /** The tenancy's name, or "Room 5 (vacant)" for an empty slot. */
  unit: string
  /** Everyone named on the tenancy. Empty for a vacancy. */
  tenants: string[]
  termStart: string | null
  termEnd: string | null
  /** Contracted monthly rent. The asking rent for a vacancy, or null. */
  rent: number | null
  /** True when `rent` is what the property asks rather than what is signed. */
  rentIsAsking: boolean
  /** Deposits held against this tenancy and not returned. */
  deposit: number
  /** Owed today, late fees included. */
  balance: number
  state: RollState
  /** The lease key, for linking back into the product. Null for a vacancy. */
  leaseKey: string | null
  daysLeft: number | null
}

export type RentRoll = {
  rows: RollRow[]
  /** Rent contracted across every occupied and upcoming row. */
  contracted: number
  /** Contracted plus the asking rent of every vacancy priced on the listing. */
  potential: number
  /** potential − contracted. The vacancy's monthly cost, where it is known. */
  vacancyLoss: number
  /** True when at least one vacancy had no asking price, so loss is partial. */
  vacancyLossPartial: boolean
  deposits: number
  balance: number
  units: number
  occupied: number
  vacant: number
  /**
   * Occupancy, 0–100, over the properties whose unit count is actually known.
   *
   * Properties with no room count on the listing are excluded from both halves
   * of this ratio rather than counted as full. Including them is the subtle
   * version of the mistake this whole model exists to avoid: a property whose
   * rooms we cannot count contributes one occupied "unit" per tenancy and no
   * vacancies, so it drags the figure towards 100% — and a rent roll that
   * reports a portfolio as fully let because its listings are incomplete is
   * worse than one that declines to say.
   *
   * Null when no property has a room count, in which case there is no honest
   * occupancy figure to give.
   */
  occupancyPct: number | null
  /** Properties whose listing carries no room count, so their units are leases
   *  rather than rooms. Named so the document can say so rather than imply
   *  completeness it does not have. */
  unknownUnitCounts: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

const stateOf = (l: TreeLease): RollState => {
  switch (l.stage) {
    case 'active':   return 'occupied'
    case 'ending':   return 'ending'
    case 'upcoming': return 'upcoming'
    default:         return 'ended'
  }
}

const isLive = (s: RollState) => s === 'occupied' || s === 'ending' || s === 'upcoming'

/**
 * Build the roll.
 *
 * `includeEnded` is off by default. A rent roll describes the building as it
 * stands; three years of finished tenancies make it unreadable and are not what
 * anyone asking for one means. It is a control rather than a hard rule because
 * the same table, with ended leases in, is what a co-owner asking "what has
 * this place done" wants.
 */
export function rentRoll(
  tree: MoneyTree,
  facts: PropertyFacts[],
  {
    includeEnded = false,
    occupancyByProperty,
  }: {
    includeEnded?: boolean
    /**
     * Lease-derived occupancy per property id, from `occupancy.ts`.
     *
     * Pass it. Without it the vacant rows are counted from active *payers* on
     * the money tree, which is built from payment plans — so a signed lease
     * with no rent schedule on it yet emits a vacant row for a room somebody
     * is living in, and a whole-home letting reads as part-empty whenever it
     * has fewer payers than bedrooms.
     */
    occupancyByProperty?: Map<string, PropertyOccupancy>
  } = {},
): RentRoll {
  const byId = new Map(facts.map(f => [f.id, f]))
  const rows: RollRow[] = []
  const unknownUnitCounts: string[] = []
  // The occupancy ratio's own tallies, over known-unit properties only.
  let countedUnits = 0
  let countedOccupied = 0

  for (const prop of tree.properties) {
    const f = byId.get(prop.propertyId) ?? null
    const leases = prop.leases
      .filter(l => includeEnded || isLive(stateOf(l)))
      .sort((a, b) => (b.termStart ?? '').localeCompare(a.termStart ?? ''))

    for (const l of leases) {
      rows.push({
        key: l.key,
        propertyId: prop.propertyId,
        propertyName: prop.propertyName,
        address: f?.address ?? null,
        unit: l.label,
        tenants: l.payers.map(p => p.name),
        termStart: l.termStart,
        termEnd: l.termEnd,
        rent: l.monthly,
        rentIsAsking: false,
        deposit: l.depositsHeld,
        balance: l.owed,
        state: stateOf(l),
        leaseKey: l.key,
        daysLeft: l.daysLeft,
      })
    }

    // ── The vacancies ──────────────────────────────────────────────────────
    //
    // Only for a property whose listing says how many rooms it has. Inferring a
    // unit count from the number of tenants would make every property read as
    // exactly full, which is the one answer a rent roll must never give by
    // default.
    const rooms = f?.total_rooms && f.total_rooms > 0 ? f.total_rooms : null
    if (rooms === null) {
      unknownUnitCounts.push(prop.propertyName)
      continue
    }

    const occ = occupancyByProperty?.get(prop.propertyId) ?? null
    const filled = occ
      ? occ.occupied
      : prop.leases
          .filter(l => l.stage === 'active' || l.stage === 'ending')
          .reduce((n, l) => n + l.activePayers, 0)
    const empty = Math.max(0, rooms - filled)
    // An empty room with a signed lease waiting on it is not a vacancy to
    // price. It is counted as a row so the roll still adds up to the building,
    // but its asking rent is not money the landlord is losing.
    const letLater = Math.min(empty, occ?.upcoming ?? 0)
    const ask = f?.price && f.price > 0 ? f.price : null

    countedUnits += rooms
    countedOccupied += Math.min(filled, rooms)

    for (let i = 0; i < empty; i++) {
      rows.push({
        key: `vacant-${prop.propertyId}-${i}`,
        propertyId: prop.propertyId,
        propertyName: prop.propertyName,
        address: f?.address ?? null,
        unit: i < letLater
          ? `Room ${filled + i + 1} of ${rooms} — let from a later date`
          : `Vacant room ${filled + i + 1} of ${rooms}`,
        tenants: [],
        termStart: null,
        termEnd: null,
        rent: i < letLater ? null : ask,
        rentIsAsking: true,
        deposit: 0,
        balance: 0,
        state: i < letLater ? 'reserved' : 'vacant',
        leaseKey: null,
        daysLeft: null,
      })
    }
  }

  const live = rows.filter(r => isLive(r.state))
  const vacancies = rows.filter(r => r.state === 'vacant')
  const contracted = round2(live.reduce((n, r) => n + (r.rent ?? 0), 0))
  const vacancyLoss = round2(vacancies.reduce((n, r) => n + (r.rent ?? 0), 0))

  return {
    rows,
    contracted,
    potential: round2(contracted + vacancyLoss),
    vacancyLoss,
    vacancyLossPartial: vacancies.some(r => r.rent === null),
    deposits: round2(rows.reduce((n, r) => n + r.deposit, 0)),
    balance: round2(rows.reduce((n, r) => n + r.balance, 0)),
    units: live.length + vacancies.length + rows.filter(r => r.state === 'reserved').length,
    occupied: live.length,
    vacant: vacancies.length,
    occupancyPct: countedUnits > 0
      ? Math.round((countedOccupied / countedUnits) * 100)
      : null,
    unknownUnitCounts,
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const q = (v: string | number | null) => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The roll as a spreadsheet, which is how it is actually sent.
 *
 * `Rent basis` is its own column rather than a footnote on the rent figure: a
 * reader summing the rent column has to be able to tell a signed rent from an
 * asking price, and a document that mixes them in one column without saying so
 * overstates income to the exact person who must not be misled about it.
 */
export function rentRollCsv(roll: RentRoll): string {
  const head = [
    'Property', 'Address', 'Unit / tenancy', 'Tenants', 'Status',
    'Term start', 'Term end', 'Monthly rent', 'Rent basis',
    'Deposit held', 'Balance owed',
  ]
  const rows = roll.rows.map(r => [
    r.propertyName,
    r.address ?? '',
    r.unit,
    r.tenants.join('; '),
    ROLL_STATE_META[r.state].label,
    r.termStart ?? '',
    r.termEnd ?? '',
    r.rent === null ? '' : r.rent.toFixed(2),
    r.rent === null ? 'not priced' : r.rentIsAsking ? 'asking' : 'contracted',
    r.deposit.toFixed(2),
    r.balance.toFixed(2),
  ].map(q).join(','))

  const total = [
    'TOTAL', '', `${roll.occupied} occupied, ${roll.vacant} vacant`, '', '', '', '',
    roll.potential.toFixed(2),
    'contracted + asking',
    roll.deposits.toFixed(2),
    roll.balance.toFixed(2),
  ].map(q).join(',')

  return [head.join(','), ...rows, total].join('\n')
}
