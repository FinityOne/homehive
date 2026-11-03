/**
 * POST /api/renewals/convert
 *
 * Turns an accepted renewal into a real lease.
 *
 * The new term is a *new row* in `leases`, and the old lease is not touched.
 * That is the whole design decision in this file, and it is worth stating why,
 * because editing the existing row looks simpler and is wrong:
 *
 *   • Rent history stops being answerable. Financials reports against the
 *     lease a charge belongs to, so moving the rent on the old row rewrites
 *     what was owed last March. Two rows keep "they used to pay $850" true.
 *   • Move-out, deposits and the payment plan all hang off a lease id. A
 *     tenancy that silently became a different tenancy takes those with it.
 *
 * What it deliberately does *not* do is create a payment plan for the new
 * term. Rent collection is a decision with its own money in it — amounts, due
 * day, late-fee rule, who pays what in a share house — and inventing one from
 * a renewal would have a landlord discover charges they never set. The
 * response hands back the new lease id so the UI can walk them to Financials.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return Response.json({ error: 'Which renewal?' }, { status: 400 })

  const { data: renewal } = await supabaseAdmin
    .from('lease_renewals')
    .select(`
      *,
      lease:leases (
        id, owner_id, property_id, unit_number, notes, is_demo, end_date,
        tenants:lease_tenants ( tenant_id, lead_id, name, email )
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!renewal) return Response.json({ error: 'Renewal not found.' }, { status: 404 })
  if (renewal.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })
  if (renewal.status !== 'accepted') {
    return Response.json({ error: 'Only an accepted renewal becomes a lease.' }, { status: 409 })
  }
  if (renewal.renewal_lease_id) {
    // Idempotent on purpose: a double click must not sign the same tenant
    // twice. The second call returns the lease the first one made.
    return Response.json({ leaseId: renewal.renewal_lease_id, alreadyDone: true })
  }

  const old = renewal.lease as {
    id: string; property_id: string; unit_number: string | null; notes: string | null; end_date: string
    tenants?: Array<{ tenant_id: string | null; lead_id: string | null; name: string | null; email: string | null }>
  } | null
  if (!old) return Response.json({ error: 'The original lease is gone.' }, { status: 409 })

  const { data: created, error: leaseErr } = await supabaseAdmin
    .from('leases')
    .insert({
      owner_id: user.id,
      property_id: old.property_id,
      start_date: renewal.new_start_date,
      end_date: renewal.new_end_date,
      rent_amount: renewal.new_rent,
      unit_number: old.unit_number,
      notes: `Renewal of the lease ending ${old.end_date}. Accepted ${(renewal.responded_at as string)?.slice(0, 10) ?? 'by the tenant'}.`,
      is_demo: false,
    })
    .select('id')
    .single()

  if (leaseErr || !created) {
    console.error('renewal convert: lease insert failed', leaseErr)
    return Response.json({ error: 'Could not create the renewed lease.' }, { status: 500 })
  }

  // Carry the tenants across. Same people, same term: a renewal that arrives
  // with an empty tenant list is a lease the landlord has to retype, which is
  // most of the work they were promised they would not have to do again.
  const tenants = (old.tenants ?? []).filter(t => t.name || t.email)
  if (tenants.length) {
    const { error: tenantErr } = await supabaseAdmin.from('lease_tenants').insert(
      tenants.map(t => ({
        lease_id: created.id,
        tenant_id: t.tenant_id || null,
        lead_id: t.lead_id || null,
        name: t.name,
        email: t.email,
      }))
    )
    // Non-fatal: the lease exists and is editable, and losing it over a
    // tenant-row failure would leave the renewal unconvertible.
    if (tenantErr) console.error('renewal convert: tenants insert failed', tenantErr)
  }

  const { error: linkErr } = await supabaseAdmin
    .from('lease_renewals')
    .update({ renewal_lease_id: created.id, updated_at: new Date().toISOString() })
    .eq('id', renewal.id)
    .is('renewal_lease_id', null)

  if (linkErr) console.error('renewal convert: link failed', linkErr)

  return Response.json({ leaseId: created.id, tenantsCopied: tenants.length })
}
