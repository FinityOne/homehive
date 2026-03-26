import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type TenantStatus = 'active' | 'inactive' | 'pending' | 'former'

export type Tenant = {
  id: string
  owner_id: string
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  notes: string | null
  status: TenantStatus
  rating: number | null  // 1–5
  lead_id: string | null
  created_at: string
  updated_at: string
}

export type TenantFormData = {
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  notes: string | null
  status: TenantStatus
  rating: number | null
  lead_id?: string | null
}

export async function getTenantsByOwner(ownerId: string): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching tenants:', error)
    return []
  }
  return data as Tenant[]
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (error || !data) return null
  return data as Tenant
}

export async function createTenant(
  ownerId: string,
  formData: TenantFormData
): Promise<{ tenant: Tenant | null; error: any }> {
  const { data, error } = await supabase
    .from('tenants')
    .insert({ ...formData, owner_id: ownerId })
    .select()
    .single()

  if (error || !data) return { tenant: null, error }
  return { tenant: data as Tenant, error: null }
}

export async function updateTenant(
  tenantId: string,
  formData: Partial<TenantFormData>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('tenants')
    .update({ ...formData, updated_at: new Date().toISOString() })
    .eq('id', tenantId)

  return { error }
}

export async function deleteTenant(tenantId: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('tenants')
    .delete()
    .eq('id', tenantId)

  return { error }
}

// Check if email already exists for owner (for duplicate prevention)
export async function tenantEmailExists(ownerId: string, email: string, excludeId?: string): Promise<boolean> {
  let query = supabase
    .from('tenants')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('email', email.toLowerCase().trim())

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data } = await query
  return (data?.length ?? 0) > 0
}
