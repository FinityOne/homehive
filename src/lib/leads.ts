// No 'use client' directive — this is a shared lib

import { supabase } from '@/lib/supabase'
import { getPropertiesByOwner } from './properties'

/*
 * SQL to run once in Supabase dashboard:
 *
 * CREATE TABLE pre_screens (
 *   id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL UNIQUE,
 *   created_at    timestamptz DEFAULT now(),
 *   is_student    boolean,
 *   university    text,
 *   birthdate     date,
 *   gender        text,
 *   move_in_date  text,
 *   group_size    integer DEFAULT 1,
 *   about         text,
 *   monthly_budget integer,
 *   lease_length  text,
 *   lifestyle     text,
 *   notes         text
 * );
 * ALTER TABLE pre_screens ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Allow public inserts on pre_screens"
 *   ON pre_screens FOR INSERT TO anon WITH CHECK (true);
 *
 * ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_reason text;
 */

export type Lead = {
  id: string
  created_at: string | null
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  move_in_date: string | null
  // Pipeline: new → contacted → follow_up → engaged → qualified → matching → cold → closed
  // 'tour_scheduled' kept for backward compat with existing records; treated as qualified+toured visually
  status: 'new' | 'contacted' | 'follow_up' | 'engaged' | 'qualified' | 'matching' | 'cold' | 'tour_scheduled' | 'closed'
  toured: boolean | null // true once lead has done a physical/virtual tour (replaces tour_scheduled status)
  closed_reason: 'leased' | 'found_another_place' | 'unresponsive' | 'budget_mismatch' | 'not_qualified' | 'other' | null
  closed_notes: string | null
  property: string | null // stores property slug
  lead_group_id: string | null
}

export type PrescreenData = {
  occupation: string
  university: string
  birthdate: string
  gender: string
  move_in_date: string
  group_size: number
  about: string
  monthly_budget: number
  lease_length: string
  lifestyle: string
  pets: string | null
  notes: string
  // derived from occupation for backward compat
  is_student: boolean
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

export async function getLeadsForSlugs(slugs: string[]): Promise<Lead[]> {
  if (slugs.length === 0) return []

  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .in('property', slugs)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching leads for slugs:', error)
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
  closedReason?: Lead['closed_reason'],
  closedNotes?: string
): Promise<{ error: any }> {
  const updatePayload: Record<string, any> = { status }
  if (status === 'closed' && closedReason) {
    updatePayload.closed_reason = closedReason
    updatePayload.closed_notes = closedNotes ?? null
  }

  const { error } = await supabase
    .from('leads')
    .update(updatePayload)
    .eq('id', leadId)

  return { error }
}

export async function savePrescreen(
  leadId: string,
  data: PrescreenData
): Promise<{ error: any }> {
  // Upsert into separate pre_screens table (idempotent if re-submitted)
  const { error: insertError } = await supabase
    .from('pre_screens')
    .upsert(
      [{
        lead_id: leadId,
        is_student: data.is_student,
        university: data.is_student ? data.university : null,
        birthdate: data.birthdate || null,
        gender: data.gender,
        move_in_date: data.move_in_date,
        group_size: data.group_size,
        about: data.about,
        monthly_budget: data.monthly_budget || null,
        lease_length: data.lease_length,
        lifestyle: data.lifestyle,
        notes: data.notes || null,
      }],
      { onConflict: 'lead_id' }
    )

  if (insertError) return { error: insertError }

  // Advance lead status to qualified
  const { error: statusError } = await supabase
    .from('leads')
    .update({ status: 'qualified' })
    .eq('id', leadId)

  return { error: statusError }
}
