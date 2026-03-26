import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type LeaseStatus = 'upcoming' | 'current' | 'past'

export type LeaseTenant = {
  id: string
  lease_id: string
  tenant_id: string | null
  lead_id: string | null
  name: string | null
  email: string | null
}

export type LeaseDocument = {
  id: string
  lease_id: string
  name: string
  storage_path: string
  created_at: string
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
  document_url: string | null  // legacy — kept for DB compat, not used in UI
  tenants: LeaseTenant[]
  documents: LeaseDocument[]
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
      lease_tenants ( id, lease_id, tenant_id, lead_id, name, email ),
      lease_documents ( id, lease_id, name, storage_path, created_at ),
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
    documents: row.lease_documents || [],
    property: row.property || undefined,
  })) as Lease[]
}

export async function getLeaseById(leaseId: string): Promise<Lease | null> {
  const { data, error } = await supabase
    .from('leases')
    .select(`
      *,
      lease_tenants ( id, lease_id, tenant_id, lead_id, name, email ),
      lease_documents ( id, lease_id, name, storage_path, created_at ),
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
    documents: data.lease_documents || [],
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
  document_url: string | null  // always null going forward; kept for DB column compat
}

export type TenantInput = {
  tenant_id: string | null
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
      tenant_id: t.tenant_id || null,
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

  const { error: deleteError } = await supabase.from('lease_tenants').delete().eq('lease_id', leaseId)
  if (deleteError) return { error: deleteError }

  if (tenants.length > 0) {
    const rows = tenants.map(t => ({
      lease_id: leaseId,
      tenant_id: t.tenant_id || null,
      lead_id: t.lead_id || null,
      name: t.name,
      email: t.email,
    }))
    const { error: tenantError } = await supabase.from('lease_tenants').insert(rows)
    if (tenantError) return { error: tenantError }
  }

  return { error: null }
}

// Uploads a file to storage and saves a record in lease_documents.
export async function addLeaseDocument(
  leaseId: string,
  file: File,
  displayName: string
): Promise<{ doc: LeaseDocument | null; error: any }> {
  const ext = file.name.split('.').pop()
  const storagePath = `${leaseId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('lease-docs')
    .upload(storagePath, file, { upsert: false })

  if (uploadError) return { doc: null, error: uploadError }

  const { data, error: dbError } = await supabase
    .from('lease_documents')
    .insert({ lease_id: leaseId, name: displayName.trim() || file.name, storage_path: storagePath })
    .select()
    .single()

  if (dbError) return { doc: null, error: dbError }
  return { doc: data as LeaseDocument, error: null }
}

// Deletes a document record and its file from storage.
export async function deleteLeaseDocument(doc: LeaseDocument): Promise<{ error: any }> {
  await supabase.storage.from('lease-docs').remove([doc.storage_path])
  const { error } = await supabase.from('lease_documents').delete().eq('id', doc.id)
  return { error }
}

// Legacy single-file upload kept for any existing code paths.
export async function uploadLeaseDocument(
  file: File,
  leaseId: string
): Promise<{ path: string | null; error: any }> {
  const ext = file.name.split('.').pop()
  const path = `${leaseId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('lease-docs')
    .upload(path, file, { upsert: true })

  if (error) return { path: null, error }
  return { path, error: null }
}

// Generates a signed URL valid for 1 hour for a private lease document.
export async function getLeaseDocumentSignedUrl(
  storagePath: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('lease-docs')
    .createSignedUrl(storagePath, 3600)
  if (error || !data) return null
  return data.signedUrl
}
