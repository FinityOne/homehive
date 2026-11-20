/**
 * POST /api/maintenance/[id]/notify-completion
 *
 * Email the residents of a home that a shared maintenance job is finished.
 *
 * The portal already tells this truth — a completed item moves into the
 * tenant's "Completed" list by itself. But nobody refreshes a portal to find
 * out that something they were waiting on has happened, and a job that was
 * announced ("the removal company comes Friday, please be home") and then
 * never closed out reads as a job that was forgotten. So the close-out is a
 * push, not a pull.
 *
 * ── What is sent ───────────────────────────────────────────────────────────
 *
 * Nothing but the job, its status and a link. No cost, no vendor, no phone
 * number, no landlord email, and no `replyTo` header either — the portal is
 * where the detail and the conversation live, and it is the one surface where
 * the per-item visibility rules are already enforced. That guarantee is
 * structural rather than careful: the row goes through `shapeForTenant` first
 * and the template only ever receives the shaped object, so the landlord's
 * `actual_cost` and `vendor_contact` are not fields this code can reach.
 *
 * ── Who gets it ────────────────────────────────────────────────────────────
 *
 * Exactly the audience the tenant portal would show it to, decided by the same
 * pure functions the read route uses (`leaseIsActive`, and the per-lease
 * scoping below). Not "the tenants of this property": someone whose lease
 * ended in July is not told about November's work, and work scoped to one
 * tenancy is not announced to the other rooms. A second audience rule written
 * out longhand here would drift from the portal's, and the failure mode of
 * that drift is an email to a stranger about a house they left.
 *
 * Three gates, all of which must hold before anything is sent:
 *   • the item is `completed` — this email asserts a fact, so the row must say it
 *   • the item is `tenant_visible` — never announce a job kept private; this
 *     fails closed, like every other decision on this table
 *   • the resident holds an active lease at the property (and the item's lease,
 *     when it names one)
 *
 * One email per resident, sent individually. A single message to six addresses
 * would publish the whole house's email list to the whole house.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { logEmail } from '@/lib/emailLog'
import { buildWorkItemCompletedEmail } from '@/lib/maintenanceEmails'
import {
  shapeForTenant, visibleUpdates, leaseIsActive,
  type ShareableWorkRow, type ShareableUpdateRow,
} from '@/lib/tenantMaintenance'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

/**
 * Read with a column list, not `*`.
 *
 * Only the tenant-facing columns plus the two this route authorises on
 * (`owner_id`, `property_id`). The private columns are not excluded from the
 * email later — they never enter the process.
 */
const COLS = [
  'id', 'owner_id', 'property_id', 'lease_id', 'title', 'kind', 'status',
  'tenant_visible', 'tenant_note', 'area',
  'target_date', 'scheduled_for', 'completed_at', 'created_at', 'updated_at',
].join(', ')

type Recipient = { name: string | null; email: string }

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: row } = await supabaseAdmin
    .from('property_work_items')
    .select(COLS)
    .eq('id', id)
    .maybeSingle()

  if (!row) return Response.json({ error: 'Item not found.' }, { status: 404 })

  const item = row as unknown as ShareableWorkRow & { owner_id: string }
  if (item.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  if (item.status !== 'completed') {
    return Response.json(
      { error: 'Mark the job completed before telling your residents it is done.' },
      { status: 400 },
    )
  }
  if (!item.tenant_visible) {
    return Response.json(
      { error: 'This job is private. Share it with your residents first — otherwise this email announces work they were never told about.' },
      { status: 400 },
    )
  }

  const { data: property } = await supabaseAdmin
    .from('properties')
    .select('id, name')
    .eq('id', item.property_id)
    .maybeSingle()

  if (!property) return Response.json({ error: 'Property not found.' }, { status: 404 })

  // The audience: active tenancies at this property, narrowed to the item's own
  // lease when it names one.
  const { data: leaseRows } = await supabaseAdmin
    .from('leases')
    .select('id, property_id, start_date, end_date, lease_tenants ( id, name, email )')
    .eq('property_id', item.property_id)

  type LeaseRow = {
    id: string
    property_id: string
    start_date: string | null
    end_date: string | null
    lease_tenants: { id: string; name: string | null; email: string | null }[] | null
  }

  const active = ((leaseRows ?? []) as unknown as LeaseRow[])
    .filter(l => leaseIsActive(l))
    .filter(l => item.lease_id === null || item.lease_id === l.id)

  // Deduped on the address, case-insensitively. A housemate listed on two
  // overlapping leases is one person and gets one email.
  const byEmail = new Map<string, Recipient>()
  for (const l of active) {
    for (const t of l.lease_tenants ?? []) {
      const email = t.email?.trim()
      if (!email) continue
      const key = email.toLowerCase()
      if (!byEmail.has(key)) byEmail.set(key, { name: t.name ?? null, email })
    }
  }
  const recipients = [...byEmail.values()]

  if (recipients.length === 0) {
    return Response.json({
      error: active.length === 0
        ? 'Nobody is living here right now — there is no active tenancy to tell.'
        : 'The active tenancy here has no resident email addresses recorded yet.',
    }, { status: 400 })
  }

  /**
   * The landlord's own sentence about the finished work.
   *
   * The newest *shared* progress update, through the same `visibleUpdates`
   * gate the portal uses — so an update the landlord kept private stays
   * private even though this email is about the job it belongs to. Absent when
   * they never wrote one, and the email reads fine without it.
   */
  const { data: updateRows } = await supabaseAdmin
    .from('work_item_updates')
    .select('id, work_item_id, body, tenant_visible, created_at, photos:work_item_photos ( id, url, caption, position )')
    .eq('work_item_id', item.id)
    .eq('tenant_visible', true)

  const shared = visibleUpdates(item, (updateRows ?? []) as unknown as ShareableUpdateRow[])
  const note = shared.find(u => !!u.body)?.body ?? null

  const tenantItem = shapeForTenant(item, (updateRows ?? []) as unknown as ShareableUpdateRow[])
  const portalUrl = `${getSiteUrl()}/dashboard/lease?tab=maintenance`

  const sent: Recipient[] = []
  const failed: { email: string; reason: string }[] = []

  for (const r of recipients) {
    const { subject, html, text } = buildWorkItemCompletedEmail({
      item: tenantItem,
      propertyName: property.name,
      portalUrl,
      note,
      tenantName: r.name,
    })
    try {
      const { data: sendData, error: sendErr } = await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: r.email,
        subject,
        html,
        text,
      })
      // Resend reports a rejected send in `error` rather than by throwing, so a
      // bounced address would otherwise be counted as delivered.
      if (sendErr) throw new Error(sendErr.message || 'Resend rejected the send')

      await logEmail(null, 'maintenance_completed_tenant', subject, r.email, {
        work_item_id: item.id,
        property_id: property.id,
        property_name: property.name,
        sent_by: user.id,
        provider_id: sendData?.id ?? null,
      })
      sent.push(r)
    } catch (e) {
      console.error('maintenance completion email failed', r.email, e)
      failed.push({ email: r.email, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  return Response.json({
    sent: sent.map(r => ({ name: r.name, email: r.email })),
    failed,
    // Stated so the UI can say "6 residents" rather than "sent!" — a number is
    // the only part of this a landlord can check.
    count: sent.length,
  })
}
