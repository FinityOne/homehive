import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { renderListingLiveEmail, sendListingLiveEmail } from '@/lib/listingEmails'
import { getPlatformStats } from '@/lib/platformStats'

/**
 * Send — or preview — the "your listing is approved" email for one listing.
 *
 * Separate from the review route because approving and telling someone you
 * approved them are not the same event any more. A listing can be approved by
 * a migration, by a backfill, or by having been created self-serve, and in all
 * three cases nobody ever pressed the button that sends the email. This is how
 * an admin sends it after the fact without having to un-approve and re-approve
 * a live listing to trigger it.
 *
 * `?preview=1` renders the exact HTML and sends nothing. Mailing real landlords
 * is not reversible, so being able to read the thing first is the difference
 * between a considered send and a hopeful one.
 */

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: Response }> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') {
    return { ok: false, res: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { propertyId } = await params
  const preview = new URL(req.url).searchParams.get('preview') === '1'

  const db = admin()
  const { data: property, error } = await db
    .from('properties')
    .select('id, name, slug, owner_id, admin_status, owner_plan_active')
    .eq('id', propertyId)
    .single()

  if (error || !property) {
    return Response.json({ error: 'Property not found' }, { status: 404 })
  }
  if (property.admin_status !== 'active') {
    return Response.json(
      { error: `Listing is "${property.admin_status}", not approved — nothing to announce.` },
      { status: 409 },
    )
  }

  let email = ''
  try {
    const { data: { user } } = await db.auth.admin.getUserById(property.owner_id)
    email = user?.email || ''
  } catch { /* falls through to the error below */ }

  if (!email) {
    return Response.json({ error: 'No email on file for this listing owner.' }, { status: 409 })
  }

  const stats = await getPlatformStats(db)
  // The listing is only "live" if the owner is paying. Saying otherwise is a
  // claim the landlord disproves by clicking the link in the same email.
  const state = property.owner_plan_active ? 'live' as const : 'needs_plan' as const
  const opts = {
    to: email,
    propertyName: property.name,
    propertySlug: property.slug,
    state,
    stats,
  }

  if (preview) {
    const { subject, html } = renderListingLiveEmail(opts)
    return Response.json({ preview: true, to: email, state, subject, html })
  }

  await sendListingLiveEmail(opts)
  return Response.json({ ok: true, to: email, state })
}
