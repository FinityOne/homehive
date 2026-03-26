import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type LeaseStatus = 'upcoming' | 'current' | 'past'

export type LeaseTenant = {
  id: string
  lease_id: string
  lead_id: string | null
  name: string | null
  email: string | null
}

export type Lease = {
  id: string
  created_at: string
  updated_at: string
  property_id: string
  owner_id: string
  start_date: string   // 'YYYY-MM-DD'
  end_date: string     // 'YYYY-MM-DD'
  rent_amount: number | null
  unit_number: string | null
  notes: string | null
  document_url: string | null
  tenants: LeaseTenant[]
  property?: { id: string; name: string; slug: string }
}

export function getLeaseStatus(start: string, end: string): LeaseStatus {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const s = new Date(start)
  const e = new Date(end)
  if (s > today) return 'upcoming'
  if (e < today) return 'past'
  return 'current'
}

export function formatLeaseDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export async function getLeasesForOwner(ownerId: string): Promise<Lease[]> {
  const { data, error } = await supabase
    .from('leases')
    .select(`
      *,
      lease_tenants ( id, lease_id, lead_id, name, email ),
      property:properties ( id, name, slug )
    `)
    .eq('owner_id', ownerId)
    .order('start_date', { ascending: false })

  if (error || !data) {
    console.error('Error fetching leases:', error)
    return []
  }

  return data.map(row => ({
    ...row,
    tenants: row.lease_tenants || [],
    property: row.property || undefined,
  })) as Lease[]
}

export async function getLeaseById(leaseId: string): Promise<Lease | null> {
  const { data, error } = await supabase
    .from('leases')
    .select(`
      *,
      lease_tenants ( id, lease_id, lead_id, name, email ),
      property:properties ( id, name, slug )
    `)
    .eq('id', leaseId)
    .single()

  if (error || !data) {
    console.error('Error fetching lease:', error)
    return null
  }

  return {
    ...data,
    tenants: data.lease_tenants || [],
    property: data.property || undefined,
  } as Lease
}

export type LeaseFormData = {
  property_id: string
  start_date: string
  end_date: string
  rent_amount: number | null
  unit_number: string | null
  notes: string | null
  document_url: string | null
}

export type TenantInput = {
  lead_id: string | null
  name: string
  email: string
}

export async function createLease(
  ownerId: string,
  data: LeaseFormData,
  tenants: TenantInput[]
): Promise<{ id: string | null; error: any }> {
  const { data: lease, error } = await supabase
    .from('leases')
    .insert({ ...data, owner_id: ownerId })
    .select('id')
    .single()

  if (error || !lease) return { id: null, error }

  if (tenants.length > 0) {
    const rows = tenants.map(t => ({
      lease_id: lease.id,
      lead_id: t.lead_id || null,
      name: t.name,
      email: t.email,
    }))
    const { error: tenantError } = await supabase.from('lease_tenants').insert(rows)
    if (tenantError) return { id: lease.id, error: tenantError }
  }

  return { id: lease.id, error: null }
}

export async function updateLease(
  leaseId: string,
  data: LeaseFormData,
  tenants: TenantInput[]
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('leases')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', leaseId)

  if (error) return { error }

  // Replace all tenants: delete then re-insert
  await supabase.from('lease_tenants').delete().eq('lease_id', leaseId)

  if (tenants.length > 0) {
    const rows = tenants.map(t => ({
      lease_id: leaseId,
      lead_id: t.lead_id || null,
      name: t.name,
      email: t.email,
    }))
    const { error: tenantError } = await supabase.from('lease_tenants').insert(rows)
    if (tenantError) return { error: tenantError }
  }

  return { error: null }
}

export async function uploadLeaseDocument(
  file: File,
  leaseId: string
): Promise<{ url: string | null; error: any }> {
  const ext = file.name.split('.').pop()
  const path = `${leaseId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('lease-docs')
    .upload(path, file, { upsert: true })

  if (error) return { url: null, error }

  const { data } = supabase.storage.from('lease-docs').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}
