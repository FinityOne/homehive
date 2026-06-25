// Server-only: resolves everything needed to preview OR send a background-check
// reference verification email, scoped to the owning landlord. Shared by the
// preview and send routes so the two never drift apart.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildReferenceEmail, type BuiltEmail, type RefEmailType } from '@/lib/referenceEmails'

type Lead = { first_name: string | null; last_name: string | null; email: string }

export type ResolvedRefEmail = {
  built: BuiltEmail
  refId: string
  refType: RefEmailType
  recipient: string
  recipientName: string | null
  leadId: string
}

type Ok = { ok: true; data: ResolvedRefEmail }
type Err = { ok: false; status: number; error: string }

export async function resolveReferenceEmail(
  admin: SupabaseClient,
  checkId: string,
  refId: string,
  userId: string,
  userEmail?: string | null,
): Promise<Ok | Err> {
  if (!refId) return { ok: false, status: 400, error: 'refId required' }

  const { data: bgCheck } = await admin
    .from('background_checks')
    .select('id, lead_id, leads(first_name, last_name, email)')
    .eq('id', checkId)
    .eq('landlord_id', userId)
    .single()

  if (!bgCheck) return { ok: false, status: 404, error: 'Not found' }

  const { data: ref } = await admin
    .from('bg_check_references')
    .select('*')
    .eq('id', refId)
    .eq('bg_check_id', checkId)
    .single()

  if (!ref) return { ok: false, status: 404, error: 'Reference not found' }
  if (!ref.email) return { ok: false, status: 400, error: 'Reference has no email address' }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single()

  const landlordName = profile?.full_name || 'Your landlord'
  const landlordEmail = profile?.email || userEmail || 'hello@homehive.live'

  // PostgREST returns the embedded relation as an array or object depending on
  // the relationship; normalize to a single lead.
  const rawLead = bgCheck.leads as unknown
  const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as Lead | null
  const leadName = lead?.first_name && lead?.last_name
    ? `${lead.first_name} ${lead.last_name}`
    : lead?.first_name || lead?.email || 'the applicant'

  const refType: RefEmailType = ref.type === 'employer' ? 'employer' : 'residence'
  const formUrl = `${getSiteUrl()}/ref/${ref.public_token}`

  const built = buildReferenceEmail({
    type: refType,
    leadName,
    landlordName,
    landlordEmail,
    employerName: ref.name,
    managerName: ref.manager_name,
    contactName: ref.name,
    propertyAddress: ref.address,
    formUrl,
  })

  return {
    ok: true,
    data: {
      built,
      refId: ref.id,
      refType,
      recipient: ref.email,
      recipientName: ref.manager_name || ref.name || null,
      leadId: bgCheck.lead_id,
    },
  }
}
