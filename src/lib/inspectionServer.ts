// Server-only loader for a full inspection, shared by the statement preview and
// send endpoints so a landlord previews byte-for-byte what actually goes out.
import type { Inspection } from './inspections'

export const INSPECTION_SELECT_SERVER = `
  *,
  property:properties ( id, name, address, slug ),
  leases:checkout_inspection_leases ( id, inspection_id, lease_id ),
  parties:checkout_inspection_parties ( * ),
  items:checkout_inspection_items ( *, photos:checkout_inspection_photos ( * ), itemParties:checkout_inspection_item_parties ( party_id ) ),
  lateFees:checkout_inspection_late_fees ( * )
`

/** Normalise the raw PostgREST row into the shape the pure helpers expect. */
export function normalizeInspection(data: any): Inspection {
  return {
    ...data,
    revisions: [],
    leases: data.leases ?? [],
    parties: [...(data.parties ?? [])]
      .sort((a: any, b: any) => a.position - b.position)
      .map((p: any) => ({
        ...p,
        deposit_held: Number(p.deposit_held ?? 0),
        settled_amount: p.settled_amount == null ? null : Number(p.settled_amount),
      })),
    items: [...(data.items ?? [])]
      .sort((a: any, b: any) => a.position - b.position)
      .map((i: any) => ({
        ...i,
        cost: Number(i.cost ?? 0),
        party_ids: (i.itemParties ?? []).length > 0
          ? (i.itemParties ?? []).map((ip: any) => ip.party_id)
          : (i.allocated_party_id ? [i.allocated_party_id] : []),
        photos: [...(i.photos ?? [])].sort((a: any, b: any) => a.position - b.position),
      })),
    lateFees: [...(data.lateFees ?? [])]
      .sort((a: any, b: any) => a.position - b.position)
      .map((f: any) => ({
        ...f,
        amount_due: Number(f.amount_due ?? 0),
        fee_amount: Number(f.fee_amount ?? 0),
        ledger_fee_amount: f.ledger_fee_amount == null ? null : Number(f.ledger_fee_amount),
        rule_fee_amount: f.rule_fee_amount == null ? null : Number(f.rule_fee_amount),
        rule_max_total: f.rule_max_total == null ? null : Number(f.rule_max_total),
      })),
  }
}
