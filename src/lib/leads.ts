// No 'use client' directive — this is a shared lib

import { createBrowserClient } from '@supabase/ssr'
import { getPropertiesByOwner } from './properties'

// SQL to run in Supabase (note as comment only, do NOT execute from code):
// ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_reason text;

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Lead = {
  id: string
  created_at: string | null
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  move_in_date: string | null
  // prescreen fields (filled in step 2)
  lease_length: string | null
  budget: string | null
  roommate_preference: string | null
  lifestyle: string | null
  notes: string | null
  // status flow
  status: 'new' | 'contacted' | 'engaged' | 'qualified' | 'tour_scheduled' | 'closed'
  closed_reason: 'leased' | 'lost' | null
  property: string | null // stores property slug
}

export async function getLeadsForOwner(userId: string): Promise<Lead[]> {
  const properties = await getPropertiesByOwner(userId)
  const slugs = properties.map(p => p.slug).filter(Boolean)

  if (slugs.length === 0) return []

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .in('property', slugs)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching leads for owner:', error)
    return []
  }

  return data as Lead[]
}

export async function getLeadById(leadId: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (error || !data) {
    console.error('Error fetching lead by id:', error)
    return null
  }

  return data as Lead
}

export async function getAllLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching all leads:', error)
    return []
  }

  return data as Lead[]
}

export async function updateLeadStatus(
  leadId: string,
  status: Lead['status'],
  closedReason?: 'leased' | 'lost'
): Promise<{ error: any }> {
  const updatePayload: Record<string, any> = { status }
  if (status === 'closed' && closedReason) {
    updatePayload.closed_reason = closedReason
  }

  const { error } = await supabase
    .from('leads')
    .update(updatePayload)
    .eq('id', leadId)

  return { error }
}

export async function savePrescreen(
  leadId: string,
  data: {
    lease_length: string
    budget: string
    roommate_preference: string
    lifestyle: string
    notes: string
  }
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('leads')
    .update({
      ...data,
      status: 'qualified',
    })
    .eq('id', leadId)

  return { error }
}
