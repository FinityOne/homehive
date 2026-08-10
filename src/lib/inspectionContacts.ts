// Server-side resolution of a party's current email address.
//
// Party rows snapshot the contact details that were on file when the report was
// created. Names should stay frozen — an issued statement names who it was
// issued to — but an email is where the statement has to land, so it always
// follows the live record. Used by the public report (display only, no writes
// on a public GET) and by the send endpoint (which does persist the correction).
//
// Takes a client rather than creating one so callers supply the right
// privileges: the report page and the API both hold a service-role client.

type MinimalClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: any[] | null }>
    }
  }
}

export type PartyContact = { id: string; name: string; email: string | null; tenant_id: string | null; lease_id: string | null }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * Returns partyId → live email, for parties whose address has drifted.
 * Resolution order: the tenant record the landlord maintains, then the lease
 * row, then leave the snapshot alone.
 */
export async function resolveLiveEmails(
  supabase: MinimalClient,
  parties: PartyContact[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (parties.length === 0) return out

  const tenantIds = [...new Set(parties.map(p => p.tenant_id).filter(Boolean))] as string[]
  const leaseIds = [...new Set(parties.map(p => p.lease_id).filter(Boolean))] as string[]

  const [tenantsRes, leaseRes] = await Promise.all([
    tenantIds.length
      ? supabase.from('tenants').select('id, email').in('id', tenantIds)
      : Promise.resolve({ data: [] }),
    leaseIds.length
      ? supabase.from('lease_tenants').select('lease_id, tenant_id, name, email').in('lease_id', leaseIds)
      : Promise.resolve({ data: [] }),
  ])

  const tenantEmail = new Map<string, string>()
  for (const t of tenantsRes.data ?? []) {
    if (t.email?.trim()) tenantEmail.set(t.id, t.email.trim())
  }

  for (const p of parties) {
    let live: string | null = null

    if (p.tenant_id && tenantEmail.has(p.tenant_id)) {
      live = tenantEmail.get(p.tenant_id)!
    } else {
      const lt = (leaseRes.data ?? []).find((r: any) =>
        r.lease_id === p.lease_id &&
        (
          (p.tenant_id && r.tenant_id === p.tenant_id) ||
          norm(r.name) === norm(p.name) ||
          (norm(r.email) && norm(r.email) === norm(p.email))
        )
      )
      if (lt?.email?.trim()) live = lt.email.trim()
    }

    if (live && norm(live) !== norm(p.email)) out.set(p.id, live)
  }

  return out
}
