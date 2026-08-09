import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import InspectionReport from '@/components/inspections/InspectionReport'
import type { Inspection } from '@/lib/inspections'

/**
 * Public, printable move-out report.
 *
 * Lives outside every route group on purpose — no nav, no footer, nothing that
 * would print. Access is by unguessable share token; the inspection tables stay
 * owner-only under RLS, so this reads through the service role and never
 * exposes anything but the one report the token names.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Move-out Inspection Report — HomeHive',
  robots: { index: false, follow: false },
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const SELECT = `
  *,
  property:properties ( id, name, address, slug ),
  leases:checkout_inspection_leases ( id, inspection_id, lease_id ),
  parties:checkout_inspection_parties ( * ),
  items:checkout_inspection_items ( *, photos:checkout_inspection_photos ( * ), itemParties:checkout_inspection_item_parties ( party_id ) ),
  lateFees:checkout_inspection_late_fees ( * )
`

export default async function CheckoutReportPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // A malformed token would make PostgREST error on the uuid comparison.
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound()

  const { data, error } = await supabaseAdmin
    .from('checkout_inspections')
    .select(SELECT)
    .eq('share_token', token)
    .maybeSingle()

  if (error || !data) notFound()

  const inspection: Inspection = {
    ...(data as any),
    leases: (data as any).leases ?? [],
    parties: [...((data as any).parties ?? [])]
      .sort((a: any, b: any) => a.position - b.position)
      .map((p: any) => ({ ...p, deposit_held: Number(p.deposit_held ?? 0) })),
    items: [...((data as any).items ?? [])]
      .sort((a: any, b: any) => a.position - b.position)
      .map((i: any) => ({
        ...i,
        cost: Number(i.cost ?? 0),
        party_ids: (i.itemParties ?? []).length > 0
          ? (i.itemParties ?? []).map((ip: any) => ip.party_id)
          : (i.allocated_party_id ? [i.allocated_party_id] : []),
        photos: [...(i.photos ?? [])].sort((a: any, b: any) => a.position - b.position),
      })),
    lateFees: [...((data as any).lateFees ?? [])]
      .sort((a: any, b: any) => a.position - b.position)
      .map((f: any) => ({
        ...f,
        amount_due: Number(f.amount_due ?? 0),
        fee_amount: Number(f.fee_amount ?? 0),
        rule_fee_amount: f.rule_fee_amount == null ? null : Number(f.rule_fee_amount),
        rule_max_total: f.rule_max_total == null ? null : Number(f.rule_max_total),
      })),
  }

  return <InspectionReport inspection={inspection} />
}
