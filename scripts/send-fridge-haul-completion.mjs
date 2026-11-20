/**
 * Tell the residents of University Dr Palace that the garage junk haul is done.
 *
 * This exists because the job was finished and paid for out in the world, with
 * no browser session around to press "Tell residents it's done" with. It is the
 * admin path, not a second implementation: it imports
 * `buildWorkItemCompletedEmail`, `shapeForTenant`, `visibleUpdates` and
 * `leaseIsActive` — the same functions POST
 * /api/maintenance/[id]/notify-completion calls — so the email and the
 * `email_logs` row are what the portal button would have produced. The only
 * thing it skips is the bearer-token check; ownership is asserted below against
 * `property_work_items.owner_id` instead, so a wrong item id fails rather than
 * mailing a stranger's tenants.
 *
 * It keeps the route's three gates, because they are the reason this is safe:
 * the item must be `completed`, it must be `tenant_visible`, and a recipient
 * must hold an *active* lease at the property. This house has two ended
 * tenancies on it — one of them carrying placeholder addresses like
 * `tyler@gmail.com` — and the active-lease gate is the only thing standing
 * between a close-out notice and a stranger's inbox.
 *
 * One email per resident, never one email to six addresses: a single `to:` with
 * the whole house in it publishes the house's email list to the house.
 *
 * Dry run (default — prints the audience and the email, sends nothing):
 *   node --experimental-strip-types --no-warnings --env-file=.env.local \
 *     --import ./scripts/ts-resolve.mjs scripts/send-fridge-haul-completion.mjs
 *
 * For real:
 *   … scripts/send-fridge-haul-completion.mjs --send
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const { buildWorkItemCompletedEmail } = await import('../src/lib/maintenanceEmails.ts')
const { shapeForTenant, visibleUpdates, leaseIsActive } =
  await import('../src/lib/tenantMaintenance.ts')
const { logEmail } = await import('../src/lib/emailLog.ts')

const SEND = process.argv.includes('--send')

// ── The one job this run closes out ─────────────────────────────────────────
//
// Hard-coded rather than taken from flags, for the same reason the rent
// reminder script hard-codes its plan: a script that mails six real residents
// should be read before it is run, and these are the values a reader checks.
const ITEM = {
  workItemId: '9bff1205-02c2-4502-bdbc-eae4b1c6a311', // "Haul away old fridge and garage junk"
  ownerId:    '16f7ab29-9a38-4883-9fa9-816185f73f60',
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.includes('localhost')
  ? 'https://homehive.live'
  : (process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live')

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

/** The tenant-facing columns, plus the two this script authorises on. */
const COLS = [
  'id', 'owner_id', 'property_id', 'lease_id', 'title', 'kind', 'status',
  'tenant_visible', 'tenant_note', 'area',
  'target_date', 'scheduled_for', 'completed_at', 'created_at', 'updated_at',
].join(', ')

const die = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1) }

// ── 1. The job, and the right to mail about it ──────────────────────────────

const { data: item } = await db
  .from('property_work_items')
  .select(COLS)
  .eq('id', ITEM.workItemId)
  .maybeSingle()

if (!item) die('That work item does not exist.')
if (item.owner_id !== ITEM.ownerId) die('That work item belongs to somebody else.')
if (item.status !== 'completed') die(`The job is "${item.status}", not completed — nothing to announce.`)
if (!item.tenant_visible) die('The job is private. Sharing it is a decision for the landlord, not this script.')

const { data: property } = await db
  .from('properties').select('id, name').eq('id', item.property_id).maybeSingle()
if (!property) die('The property behind that item is missing.')

// ── 2. The audience, by the portal's own rule ───────────────────────────────

const { data: leaseRows } = await db
  .from('leases')
  .select('id, property_id, start_date, end_date, lease_tenants ( id, name, email )')
  .eq('property_id', item.property_id)

const active = (leaseRows ?? [])
  .filter(l => leaseIsActive(l))
  .filter(l => item.lease_id === null || item.lease_id === l.id)

const byEmail = new Map()
for (const l of active) {
  for (const t of l.lease_tenants ?? []) {
    const email = t.email?.trim()
    if (!email) continue
    const key = email.toLowerCase()
    if (!byEmail.has(key)) byEmail.set(key, { name: t.name ?? null, email })
  }
}
const recipients = [...byEmail.values()]
if (recipients.length === 0) die('No active resident has an email address recorded.')

const skipped = (leaseRows ?? []).filter(l => !active.some(a => a.id === l.id))

// ── 3. The landlord's own sentence about the finished work ──────────────────

const { data: updateRows } = await db
  .from('work_item_updates')
  .select('id, work_item_id, body, tenant_visible, created_at, photos:work_item_photos ( id, url, caption, position )')
  .eq('work_item_id', item.id)
  .eq('tenant_visible', true)

const shared = visibleUpdates(item, updateRows ?? [])
const note = shared.find(u => !!u.body)?.body ?? null

const tenantItem = shapeForTenant(item, updateRows ?? [])
const portalUrl = `${SITE}/dashboard/lease?tab=maintenance`

// ── 4. Report, then send ────────────────────────────────────────────────────

console.log(`\n  ${item.title}`)
console.log(`  ${property.name} — ${item.area ?? 'no area'} · completed ${item.completed_at}`)
console.log(`\n  Audience (${recipients.length}), from ${active.length} active tenancy(ies):`)
for (const r of recipients) console.log(`    • ${r.name ?? '(no name)'} <${r.email}>`)
if (skipped.length > 0) {
  console.log(`\n  Not mailed — ${skipped.length} tenancy(ies) not active today:`)
  for (const l of skipped) {
    console.log(`    · ${l.start_date} → ${l.end_date} (${(l.lease_tenants ?? []).length} on it)`)
  }
}
console.log(`\n  Shared progress note: ${note ? `"${note}"` : '(none — the email reads fine without it)'}`)

const sample = buildWorkItemCompletedEmail({
  item: tenantItem,
  propertyName: property.name,
  portalUrl,
  note,
  tenantName: recipients[0].name,
})
console.log(`\n  Subject: ${sample.subject}`)
console.log(`\n${sample.text.split('\n').map(l => `  | ${l}`).join('\n')}\n`)

if (!SEND) {
  console.log('  Dry run — nothing sent. Re-run with --send.\n')
  process.exit(0)
}

const resend = new Resend(process.env.RESEND_API_KEY)
let sent = 0

for (const r of recipients) {
  const { subject, html, text } = buildWorkItemCompletedEmail({
    item: tenantItem,
    propertyName: property.name,
    portalUrl,
    note,
    tenantName: r.name,
  })
  try {
    const { data, error } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: r.email,
      subject,
      html,
      text,
    })
    // Resend reports a rejected send in `error` rather than by throwing.
    if (error) throw new Error(error.message || 'Resend rejected the send')

    await logEmail(null, 'maintenance_completed_tenant', subject, r.email, {
      work_item_id: item.id,
      property_id: property.id,
      property_name: property.name,
      sent_by: ITEM.ownerId,
      provider_id: data?.id ?? null,
      via: 'scripts/send-fridge-haul-completion.mjs',
    })
    sent++
    console.log(`  ✓ ${r.email} (${data?.id ?? 'no id'})`)
  } catch (e) {
    console.error(`  ✗ ${r.email} — ${e instanceof Error ? e.message : String(e)}`)
  }
}

console.log(`\n  Told ${sent} of ${recipients.length} residents.\n`)
