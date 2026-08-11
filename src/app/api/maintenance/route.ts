/**
 * POST /api/maintenance
 *
 * Creates a maintenance / upgrade item and emails the landlord a record of it.
 * Creation goes through the server so the notification can't be skipped —
 * the Resend key is server-only, and a list that adds things silently is a list
 * people stop trusting.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildWorkItemAddedEmail } from '@/lib/maintenanceEmails'
import type { WorkItem, WorkKind, WorkPriority, WorkStatus } from '@/lib/maintenance'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const KINDS: WorkKind[] = ['upgrade', 'repair', 'tenant_issue', 'known_issue', 'preventive', 'turnover', 'compliance']
const PRIORITIES: WorkPriority[] = ['emergency', 'high', 'medium', 'low']
const STATUSES: WorkStatus[] = ['todo', 'scheduled', 'in_progress', 'blocked', 'completed', 'cancelled']

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  const title = str(body.title)
  if (!title) return Response.json({ error: 'Give the item a title.' }, { status: 400 })
  if (!body.property_id) return Response.json({ error: 'Pick a property.' }, { status: 400 })

  // The property must belong to the caller — never trust a client-supplied id.
  const { data: property } = await supabaseAdmin
    .from('properties')
    .select('id, name, owner_id')
    .eq('id', body.property_id)
    .maybeSingle()

  if (!property) return Response.json({ error: 'Property not found.' }, { status: 404 })
  if (property.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  const kind: WorkKind = KINDS.includes(body.kind) ? body.kind : 'repair'
  const priority: WorkPriority = PRIORITIES.includes(body.priority) ? body.priority : 'medium'
  const status: WorkStatus = STATUSES.includes(body.status) ? body.status : 'todo'

  const { data, error } = await supabaseAdmin
    .from('property_work_items')
    .insert({
      owner_id: user.id,
      property_id: property.id,
      room_id: str(body.room_id),
      lease_id: str(body.lease_id),
      area: str(body.area),
      title,
      description: str(body.description),
      kind,
      priority,
      status,
      estimated_cost: num(body.estimated_cost),
      actual_cost: num(body.actual_cost),
      target_date: str(body.target_date),
      scheduled_for: str(body.scheduled_for),
      vendor_name: str(body.vendor_name),
      vendor_contact: str(body.vendor_contact),
      assigned_to: str(body.assigned_to),
      reported_by: str(body.reported_by),
      notes: str(body.notes),
      inspection_item_id: str(body.inspection_item_id),
    })
    .select('*, property:properties ( id, name, slug )')
    .single()

  if (error || !data) {
    console.error('work item insert failed', error)
    return Response.json({ error: 'Could not save the item.' }, { status: 500 })
  }

  // Notify the landlord. Best-effort: the item is saved either way, and a
  // bounced email shouldn't cost them the record.
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email, full_name, first_name')
      .eq('id', user.id)
      .maybeSingle()

    const to = profile?.email || user.email
    if (to) {
      const { subject, html, text } = buildWorkItemAddedEmail({
        item: data as unknown as WorkItem,
        propertyName: property.name,
        listUrl: `${getSiteUrl()}/landlord/maintenance`,
        landlordName: profile?.full_name || profile?.first_name || null,
      })
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to,
        subject,
        html,
        text,
      })
    }
  } catch (e) {
    console.error('work item email failed', e)
  }

  return Response.json({ item: data })
}
