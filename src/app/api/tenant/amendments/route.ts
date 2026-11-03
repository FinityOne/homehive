/**
 * GET /api/tenant/amendments
 *
 * The amendments addressed to the signed-in tenant. With `?token=…`, the one
 * that token names — still only if it is theirs.
 *
 * Served through the service role, like /api/tenant/lease: the amendment tables
 * are landlord-owned and select-only to `authenticated` under RLS, and a tenant
 * must see exactly the documents addressed to them and nothing about a
 * housemate. That is a filter this route applies explicitly.
 *
 * Identity is `loadTenantIdentity`, the same resolver the rent pages use, so a
 * tenant cannot reach a housemate's contract by guessing a token: the token
 * selects the row and the identity check decides whether they may have it. The
 * token is a deep link, never the authentication — which is the one way this
 * differs from /renewal/[token], and it differs because a signature needs a
 * signer. A renewal can be answered by whoever holds the email; a contract
 * cannot be signed by them.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { loadTenantIdentity, normalizeEmail } from '@/lib/tenantIdentity'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The columns a tenant may see. Deliberately not `select('*')`. */
const TENANT_COLS =
  'id, lease_id, kind, title, effective_date, monthly_charge, monthly_charge_label, ' +
  'document, status, tenant_name, tenant_email, token, sent_at, ' +
  'signed_at, signature_name, signature_date, declined_at, decline_reason'
// `billed_at` is absent on purpose: whether the landlord has got round to
// putting the charge on the ledger is their admin, and showing a tenant
// "not yet billed" invites them to assume they do not owe it.
// `signature_ip` and `signature_user_agent` are absent because they are an
// audit record about the signer, not a thing to hand back over the wire.

/**
 * Does this amendment belong to this signed-in person?
 *
 * Two ways in, and either is enough:
 *   • the document was sent to the address they log in with, or
 *   • it names a `lease_tenants` row that resolves to them.
 *
 * Both, rather than just the email, because a landlord may have added someone
 * to a lease through the tenant directory and the amendment then carries the
 * directory's address. Not name matching: a signature page is the last place to
 * accept weak evidence — see the note at the top of src/lib/tenantIdentity.ts.
 */
function isMine(
  row: { tenant_email: string; lease_tenant_id?: string | null },
  identity: { email: string; leaseTenants: Array<{ id: string }> }
): boolean {
  if (normalizeEmail(row.tenant_email) === identity.email) return true
  return !!row.lease_tenant_id && identity.leaseTenants.some(lt => lt.id === row.lease_tenant_id)
}

export async function GET(req: NextRequest) {
  const authToken = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(authToken)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const identity = await loadTenantIdentity(supabaseAdmin, user)
  if (!identity) return Response.json({ amendments: [] })

  const token = req.nextUrl.searchParams.get('token')

  if (token) {
    if (!UUID.test(token)) return Response.json({ error: 'Not found.' }, { status: 404 })
    const { data } = await supabaseAdmin
      .from('lease_amendments')
      .select(`${TENANT_COLS}, lease_tenant_id, property:properties ( name, address )`)
      .eq('token', token)
      .maybeSingle()

    if (!data || !isMine(data, identity)) {
      // One response for "no such document" and "not yours", so a token that
      // belongs to a housemate cannot be distinguished from one that is wrong.
      return Response.json({ error: 'Not found.' }, { status: 404 })
    }
    const { lease_tenant_id: _omit, ...safe } = data as Record<string, unknown>
    return Response.json({ amendment: safe, signerName: identity.fullName })
  }

  const leaseIds = [...new Set(identity.leaseTenants.map(lt => lt.lease_id))]
  if (leaseIds.length === 0) return Response.json({ amendments: [] })

  // Scoped in Postgres to the leases this person is on, then narrowed in memory
  // to the rows actually addressed to them. The first filter is what keeps this
  // off the 1000-row response cap; the second is what keeps a housemate's
  // contract off the page.
  const { data } = await supabaseAdmin
    .from('lease_amendments')
    .select(`${TENANT_COLS}, lease_tenant_id, property:properties ( name, address )`)
    .in('lease_id', leaseIds)
    .order('sent_at', { ascending: false })

  const mine = (data ?? [])
    .filter(row => isMine(row as never, identity))
    .map(row => {
      const { lease_tenant_id: _omit, ...safe } = row as Record<string, unknown>
      return safe
    })

  return Response.json({ amendments: mine, signerName: identity.fullName })
}
