import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { buildCosignerWelcomeEmail } from '@/lib/cosignerEmails'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

async function getLandlordUser(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user ?? null
}

// Resolve the primary applicant's display name + street address for the welcome
// email, given the primary check's embedded lead and property slug.
async function resolvePrimaryContext(primary: {
  leads: unknown
}): Promise<{ applicantName: string; propertyAddress: string | null }> {
  const rawLead = primary.leads
  const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as
    { first_name: string | null; last_name: string | null; email: string | null; property: string | null } | null

  const applicantName = lead?.first_name && lead?.last_name
    ? `${lead.first_name} ${lead.last_name}`
    : lead?.first_name || lead?.email || 'the applicant'

  let propertyAddress: string | null = null
  if (lead?.property) {
    const bySlug = await supabaseAdmin.from('properties').select('address').eq('slug', lead.property).maybeSingle()
    propertyAddress = bySlug.data?.address
      ?? (await supabaseAdmin.from('properties').select('address').eq('name', lead.property).maybeSingle()).data?.address
      ?? null
  }
  return { applicantName, propertyAddress }
}

// POST — add a co-signer to a primary applicant's background check. Creates the
// co-signer's own (full-flow) background_checks row, links it to the primary,
// flags the primary as having a co-signer, and emails the co-signer a welcome.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const user = await getLandlordUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // The primary check must belong to this landlord and must itself be a primary
  // (we don't allow co-signers of co-signers).
  const { data: primary } = await supabaseAdmin
    .from('background_checks')
    .select('id, landlord_id, is_cosigner, leads(first_name, last_name, email, property)')
    .eq('id', checkId)
    .eq('landlord_id', user.id)
    .single()

  if (!primary) return Response.json({ error: 'Not found' }, { status: 404 })
  if (primary.is_cosigner) {
    return Response.json({ error: 'Cannot add a co-signer to a co-signer' }, { status: 400 })
  }

  const body = await req.json()
  const first_name = (body.first_name || '').trim()
  const last_name = (body.last_name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  const phone = (body.phone || '').trim()
  const relationship = (body.relationship || '').trim()

  if (!first_name || !email) {
    return Response.json({ error: 'first_name and email are required' }, { status: 400 })
  }

  // Create the co-signer's own background check
  const { data: cosignerCheck, error: insertErr } = await supabaseAdmin
    .from('background_checks')
    .insert({
      landlord_id: user.id,
      is_cosigner: true,
      cosigner_for_check_id: checkId,
      cosigner_relationship: relationship || null,
      subject_first_name: first_name,
      subject_last_name: last_name || null,
      subject_email: email,
      subject_phone: phone || null,
      status: 'initiated',
    })
    .select()
    .single()

  if (insertErr || !cosignerCheck) {
    console.error('Failed to create co-signer check:', insertErr)
    return Response.json({ error: 'Failed to create co-signer' }, { status: 500 })
  }

  // Flag the primary applicant as having a co-signer (drives the checklist toggle)
  await supabaseAdmin
    .from('background_checks')
    .update({ cosigner: 'yes', updated_at: new Date().toISOString() })
    .eq('id', checkId)

  // Welcome email (best-effort — never block creation on email failure)
  const { applicantName, propertyAddress } = await resolvePrimaryContext(primary)
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('full_name, email').eq('id', user.id).single()
  const landlordName = profile?.full_name || 'Your landlord'
  const landlordEmail = profile?.email || user.email || 'hello@homehive.live'

  const built = buildCosignerWelcomeEmail({
    cosignerFirstName: first_name,
    applicantName,
    propertyAddress,
    landlordName,
    landlordEmail,
  })

  const recipientName = [first_name, last_name].filter(Boolean).join(' ').trim() || null
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: email,
      replyTo: built.replyTo,
      subject: built.subject,
      html: built.html,
    })
    await supabaseAdmin
      .from('background_checks')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', cosignerCheck.id)
    await supabaseAdmin.from('bg_check_emails').insert({
      bg_check_id: cosignerCheck.id,
      ref_id: null,
      ref_type: 'cosigner',
      recipient: email,
      recipient_name: recipientName,
      subject: built.subject,
      status: 'sent',
      sent_by: user.id,
    })
  } catch (e) {
    console.error('Co-signer welcome email error:', e)
    await supabaseAdmin.from('bg_check_emails').insert({
      bg_check_id: cosignerCheck.id,
      ref_id: null,
      ref_type: 'cosigner',
      recipient: email,
      recipient_name: recipientName,
      subject: built.subject,
      status: 'failed',
      error: e instanceof Error ? e.message : 'Unknown error',
      sent_by: user.id,
    })
    // Still return success — the co-signer record exists; landlord can resend later.
    return Response.json({ check: cosignerCheck, email_sent: false })
  }

  return Response.json({ check: cosignerCheck, email_sent: true })
}
