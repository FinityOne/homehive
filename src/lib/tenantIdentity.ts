// Working out which rent rows belong to the signed-in tenant.
//
// This lived in two routes that disagreed: the lease view would fall back to
// matching on *first name*, the payment route would not. Two housemates called
// Alex could therefore see each other's balance in one place and not the other.
// One resolver now, used by both, and the first-name match is gone: showing a
// tenant the wrong person's rent is worse than showing them nothing.

import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

export const normalizeEmail = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
export const normalizeName = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const LEASE_TENANT_COLS = 'id, lease_id, tenant_id, name, email'

export type LeaseTenantRow = {
  id: string
  lease_id: string
  tenant_id: string | null
  name: string | null
  email: string | null
}

export type TenantIdentity = {
  /** The address the tenant signs in with, lowercased. */
  email: string
  /** Their name on their profile, for greeting them. */
  fullName: string | null
  /** Every lease_tenants row naming this person. */
  leaseTenants: LeaseTenantRow[]
}

/**
 * Resolve a signed-in user to the lease rows that name them.
 *
 * Matched by email, and by the `tenants` record carrying that email — a
 * landlord may have added someone to a lease via the tenant directory without
 * retyping the address.
 *
 * Every query is filtered in Postgres. Selecting the table and filtering in
 * memory tops out at Supabase's 1000-row response cap, past which a tenant
 * silently stops matching — a failure that grows in with the business.
 */
export async function loadTenantIdentity(
  db: DB,
  user: { id: string; email?: string | null }
): Promise<TenantIdentity | null> {
  const { data: profile } = await db
    .from('profiles').select('email, full_name').eq('id', user.id).maybeSingle()

  const email = normalizeEmail(profile?.email || user.email)
  if (!email) return null

  const { data: tenantRows } = await db
    .from('tenants').select('id').ilike('email', email)
  const tenantIds = (tenantRows ?? []).map(t => t.id)

  const { data: byEmail } = await db
    .from('lease_tenants').select(LEASE_TENANT_COLS).ilike('email', email)
  const { data: byTenantId } = tenantIds.length > 0
    ? await db.from('lease_tenants').select(LEASE_TENANT_COLS).in('tenant_id', tenantIds)
    : { data: [] as LeaseTenantRow[] }

  const seen = new Set<string>()
  const leaseTenants = [...(byEmail ?? []), ...(byTenantId ?? [])].filter(lt => {
    if (seen.has(lt.id)) return false
    seen.add(lt.id)
    return true
  }) as LeaseTenantRow[]

  return { email, fullName: profile?.full_name ?? null, leaseTenants }
}

/**
 * The tenant's names, for matching payer rows that carry no email.
 *
 * Pass a `leaseId` to scope to one lease — a name is only weak evidence, and
 * it should not reach across leases the tenant isn't on.
 */
export function tenantNames(identity: TenantIdentity, leaseId?: string): string[] {
  const rows = leaseId
    ? identity.leaseTenants.filter(lt => lt.lease_id === leaseId)
    : identity.leaseTenants
  return [...new Set(rows.map(lt => normalizeName(lt.name)).filter(Boolean))]
}

/**
 * Does this payer row belong to the tenant?
 *
 * Email is authoritative. An exact full-name match is the fallback, and only
 * that — no first-name or partial matching, which is how a tenant ends up
 * looking at a housemate's ledger.
 */
export function payerBelongsToTenant(
  payer: { email?: string | null; name?: string | null },
  identity: TenantIdentity,
  names: string[]
): boolean {
  if (payer.email && normalizeEmail(payer.email) === identity.email) return true
  const n = normalizeName(payer.name)
  return !!n && names.includes(n)
}
