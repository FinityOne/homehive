/**
 * GET /api/tenant/maintenance
 *
 * The maintenance a signed-in tenant may see on the homes they currently rent.
 *
 * Service role, like `/api/tenant/lease`, and for the same reason: the work
 * list is landlord-owned behind owner-only RLS, and the rule for the tenant
 * side — "shared, at a property where this person holds an *active* lease" —
 * is a join across `lease_tenants` → `leases` → `property_work_items` that no
 * policy on this table can express. So the gate is applied here, explicitly,
 * and the decision itself lives in a pure module that a test can hold:
 * `visibleToTenant` in src/lib/tenantMaintenance.ts.
 *
 * Two independent filters, both of which matter:
 *   • **in Postgres** — only `tenant_visible` rows, only for the property ids
 *     this tenant's leases name. Filtering in memory instead would pull the
 *     landlord's whole private work list across the wire to this process and
 *     cap out at Supabase's 1000-row response limit, which fails by *growing
 *     in* — the same trap `loadTenantIdentity` documents.
 *   • **in `visibleToTenant`** — the active-lease window and the per-lease
 *     scoping, then `shapeForTenant` to build the tenant-facing object field
 *     by field. The response never contains a cost, a vendor contact, or the
 *     landlord's own description.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { loadTenantIdentity } from '@/lib/tenantIdentity'
import {
  visibleToTenant, splitForTenant, summarise, leaseIsActive,
  type ShareableWorkRow, type ShareableUpdateRow, type LeaseWindow,
} from '@/lib/tenantMaintenance'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/**
 * The only columns that leave this table.
 *
 * Spelled out rather than `*` so that adding `contractor_invoice_url` to the
 * table next year cannot put it in a tenant's browser. `shapeForTenant` is the
 * second gate; this is the first, and it is the one that keeps the private
 * columns out of the process entirely.
 */
const TENANT_COLS = [
  'id', 'property_id', 'lease_id', 'title', 'kind', 'status',
  'tenant_visible', 'tenant_note', 'area',
  'target_date', 'scheduled_for', 'completed_at', 'created_at', 'updated_at',
].join(', ')

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const identity = await loadTenantIdentity(supabaseAdmin, user)
  if (!identity || identity.leaseTenants.length === 0) {
    return Response.json({ homes: [] })
  }

  const leaseIds = [...new Set(identity.leaseTenants.map(lt => lt.lease_id))]

  const { data: leaseRows } = await supabaseAdmin
    .from('leases')
    .select('id, property_id, start_date, end_date, unit_number, property:properties ( id, name, address )')
    .in('id', leaseIds)

  type Home = { id: string; name: string; address: string }
  // A to-one embed is typed as an array by the generated types but arrives as
  // an object, so normalise rather than cast — the cast is what puts `[object
  // Object]` in front of a tenant on the day the shape changes.
  const one = (p: unknown): Home | null =>
    Array.isArray(p) ? (p[0] as Home) ?? null : (p as Home) ?? null

  type LeaseRow = {
    id: string; property_id: string
    start_date: string | null; end_date: string | null
    unit_number: string | null
    property: Home | Home[] | null
  }

  const leases: (LeaseWindow & { unit_number: string | null; property: Home | null })[] =
    ((leaseRows ?? []) as unknown as LeaseRow[]).map(l => ({
      id: l.id,
      property_id: l.property_id,
      start_date: l.start_date,
      end_date: l.end_date,
      unit_number: l.unit_number ?? null,
      property: one(l.property),
    }))
  if (leases.length === 0) return Response.json({ homes: [] })

  const propertyIds = [...new Set(leases.map(l => l.property_id).filter(Boolean))]
  const { data: rows } = await supabaseAdmin
    .from('property_work_items')
    .select(TENANT_COLS)
    .eq('tenant_visible', true)
    .in('property_id', propertyIds)
    // `cancelled` never reaches the tenant — dropped here as well as in
    // `splitForTenant`, so a future caller of this route inherits the rule.
    .neq('status', 'cancelled')

  /**
   * The shared progress updates on those items, with their photos.
   *
   * Filtered to `tenant_visible` here as well as in `visibleUpdates`, so the
   * landlord's private work diary — before-photos for an insurance claim, what
   * the contractor really said — never enters this process at all. The item
   * gate is applied in `visibleUpdates`: an update shared against a job that is
   * still private must stay invisible, or publishing the update reveals the
   * job.
   *
   * Column lists again rather than `*`, including on the embedded photos:
   * `storage_path` and `owner_id` are on that table and neither belongs in a
   * tenant's browser.
   */
  const workItems = (rows ?? []) as unknown as ShareableWorkRow[]
  const workItemIds = workItems.map(r => r.id)
  const { data: updateRows } = workItemIds.length > 0
    ? await supabaseAdmin
        .from('work_item_updates')
        .select('id, work_item_id, body, tenant_visible, created_at, photos:work_item_photos ( id, url, caption, position )')
        .eq('tenant_visible', true)
        .in('work_item_id', workItemIds)
    : { data: [] }

  const items = visibleToTenant(
    workItems,
    leases,
    new Date(),
    (updateRows ?? []) as unknown as ShareableUpdateRow[],
  )

  /**
   * Grouped by home, not returned as one flat list.
   *
   * A tenant with two tenancies reading "boiler replacement — scheduled" with
   * no address attached cannot tell which of their homes it is about, and the
   * portal switches between tenancies by property.
   *
   * One group per *active* lease — an ended or not-yet-started tenancy gets no
   * group at all, which is the whole point. An active lease with nothing shared
   * still gets its (empty) group, because "nothing outstanding on this home" is
   * worth saying and an absent section only reads as a page that failed.
   */
  const homes = leases.filter(l => leaseIsActive(l)).map(l => {
    const mine = items.filter(i => i.property_id === l.property_id)
    const { pending, completed } = splitForTenant(mine)
    return {
      lease_id: l.id,
      property_id: l.property_id,
      property: l.property,
      unit_number: l.unit_number,
      pending,
      completed,
      summary: summarise(mine),
    }
  })

  return Response.json({ homes })
}
