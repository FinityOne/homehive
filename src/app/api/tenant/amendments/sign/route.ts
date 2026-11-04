/**
 * POST /api/tenant/amendments/sign — the signature.
 *
 * Body: `{ token, action: 'sign' | 'decline', name?, date?, reason? }`
 *
 * This is the only route in the feature where something irreversible happens,
 * so it is written to be suspicious of everything except the session:
 *
 *   • **The signer is the session, not the token.** The token selects the row;
 *     `loadTenantIdentity` decides whether this account is the person the
 *     document was addressed to. Signing is the one action in this app where a
 *     link in an inbox is not good enough — a renewal can be answered by
 *     whoever holds the email, a contract cannot be signed by them.
 *
 *   • **The date is today, checked here.** The form pins the input to today;
 *     this says the same thing again, because a crafted request must not be
 *     able to do what the form will not. Backdating a contract is the single
 *     most consequential thing a signing form can allow.
 *
 *   • **The write is conditional on it still being unsigned.** `.eq('status',
 *     'sent')` means a double-submitted form, or a race against the landlord
 *     withdrawing, loses rather than overwriting a signature.
 *
 *   • **The signature is recorded before anybody is emailed.** A signed row
 *     with no receipt sent is recoverable — the tenant can see their copy on
 *     the page, and the landlord can resend. A receipt sent with no row is a
 *     tenant who has been told they signed something that is not recorded.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import {
  buildAmendmentSignedTenantEmail, buildAmendmentSignedLandlordEmail,
  buildAmendmentDeclinedLandlordEmail,
} from '@/lib/amendmentEmails'
import { logEmail } from '@/lib/emailLog'
import { loadTenantIdentity, normalizeEmail } from '@/lib/tenantIdentity'
import {
  checkSignatureName, checkSignatureDate, checkSignatureDeadline,
  verifyAmendmentDocument, amendmentPath,
  type AmendmentDocument,
} from '@/lib/leaseAmendments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

/**
 * The caller's IP, for the signature record.
 *
 * Best-effort and treated as such — it is a proxy header and a determined
 * client can set it. It is kept because in a dispute it is corroborating
 * evidence alongside the session, the timestamp and the email trail, not
 * because it proves anything on its own.
 */
function callerIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return req.headers.get('x-real-ip') || null
}

export async function POST(req: NextRequest) {
  const authToken = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!authToken) return Response.json({ error: 'Please sign in to sign this document.' }, { status: 401 })
  const { data: { user } } = await supabaseAdmin.auth.getUser(authToken)
  if (!user) return Response.json({ error: 'Please sign in to sign this document.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const token = str(body.token)
  const action = str(body.action) ?? 'sign'
  if (!token || !UUID.test(token)) return Response.json({ error: 'Not found.' }, { status: 404 })
  if (action !== 'sign' && action !== 'decline') {
    return Response.json({ error: 'Unknown action.' }, { status: 400 })
  }

  const identity = await loadTenantIdentity(supabaseAdmin, user)
  if (!identity) return Response.json({ error: 'Not found.' }, { status: 404 })

  const { data: amendment } = await supabaseAdmin
    .from('lease_amendments').select('*').eq('token', token).maybeSingle()

  // One response for "no such document" and "not yours", so a housemate's
  // token cannot be told apart from a wrong one.
  if (!amendment) return Response.json({ error: 'Not found.' }, { status: 404 })

  const mine =
    normalizeEmail(amendment.tenant_email) === identity.email ||
    (!!amendment.lease_tenant_id &&
      identity.leaseTenants.some(lt => lt.id === amendment.lease_tenant_id))
  if (!mine) {
    return Response.json({
      error: 'This document was sent to a different person. ' +
        `It is addressed to ${amendment.tenant_email}, so sign in with that email to sign it.`,
    }, { status: 403 })
  }

  if (amendment.status !== 'sent') {
    return Response.json({
      error: amendment.status === 'signed'
        ? 'You have already signed this.'
        : amendment.status === 'withdrawn'
          ? 'Your landlord withdrew this document, so it can no longer be signed.'
          : 'You already declined this.',
    }, { status: 409 })
  }

  const doc = amendment.document as AmendmentDocument

  // ── Decline ───────────────────────────────────────────────────────────────

  if (action === 'decline') {
    const reason = str(body.reason)
    const { data: declined, error } = await supabaseAdmin
      .from('lease_amendments')
      .update({
        status: 'declined',
        declined_at: new Date().toISOString(),
        decline_reason: reason,
      })
      .eq('id', amendment.id)
      .eq('status', 'sent')
      .select('*')
      .single()

    if (error || !declined) {
      return Response.json({ error: 'Could not record that — please reload and try again.' }, { status: 409 })
    }

    await notifyLandlordDeclined(amendment.owner_id, declined, doc, reason)
    return Response.json({ amendment: stripAudit(declined) })
  }

  // ── Sign ──────────────────────────────────────────────────────────────────

  const name = str(body.name)
  const date = str(body.date)
  if (!name) return Response.json({ error: 'Type your full legal name to sign.' }, { status: 400 })
  if (!date) return Response.json({ error: 'Pick the date you are signing.' }, { status: 400 })

  // The offer's own deadline, first. The document says it is "deemed
  // withdrawn" after this date, so accepting a late signature would record an
  // agreement the contract itself says does not exist. Derived every time from
  // `respond_by`, never from a stored flag — an offer lapses at midnight
  // whether or not a cron was running to notice.
  const lateProblem = checkSignatureDeadline(amendment.respond_by)
  if (lateProblem) return Response.json({ error: lateProblem }, { status: 409 })

  const nameProblem = checkSignatureName(name, amendment.tenant_name)
  if (nameProblem) return Response.json({ error: nameProblem }, { status: 400 })
  const dateProblem = checkSignatureDate(date)
  if (dateProblem) return Response.json({ error: dateProblem }, { status: 400 })

  // The document is checked again at signing, not only at sending.
  //
  // Belt and braces, and cheap: this is the last moment before a person is
  // bound by it, and the cost of being wrong is a tenant held to a contract
  // whose protective clause went missing between November and now. There is no
  // path that should edit a stored document, which is exactly why a stored
  // document that fails this check means something is badly wrong and the
  // signature must not proceed.
  const problems = verifyAmendmentDocument(doc)
  if (problems.length > 0) {
    console.error('refusing signature on a malformed document', amendment.id, problems)
    return Response.json({
      error: 'There is a problem with this document and it cannot be signed. ' +
        'Please contact your landlord — nothing has been recorded.',
    }, { status: 409 })
  }

  const signatureName = name.replace(/\s+/g, ' ')
  const { data: signed, error } = await supabaseAdmin
    .from('lease_amendments')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signature_name: signatureName,
      signature_date: date,
      signature_ip: callerIp(req),
      signature_user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      signed_by_user_id: user.id,
    })
    .eq('id', amendment.id)
    .eq('status', 'sent')   // a double submit loses rather than re-signing
    .select('*')
    .single()

  if (error || !signed) {
    console.error('amendment signature write failed', error)
    return Response.json({
      error: 'Could not record your signature — please reload the page and try again. ' +
        'Nothing was signed.',
    }, { status: 409 })
  }

  // Emails are after the write, and each failure is caught separately. A
  // signature that is recorded but unreceipted is a nuisance; one that is
  // receipted but unrecorded is a lie, and rolling back a real signature
  // because an inbox was full would be the worst outcome of the three.
  const viewUrl = `${getSiteUrl()}${amendmentPath(signed.token)}`
  const tenantEmail = buildAmendmentSignedTenantEmail({
    doc, signatureName, signatureDate: date, viewUrl,
  })
  try {
    const { error: sendErr } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: amendment.tenant_email,
      subject: tenantEmail.subject,
      html: tenantEmail.html,
      text: tenantEmail.text,
    })
    if (sendErr) throw sendErr
    await supabaseAdmin.from('lease_amendment_sends').insert({
      amendment_id: signed.id, owner_id: signed.owner_id, kind: 'signed',
      recipient: amendment.tenant_email, subject: tenantEmail.subject,
    })
    await logEmail(null, 'amendment_signed_tenant', tenantEmail.subject, amendment.tenant_email, {
      amendment_id: signed.id, lease_id: signed.lease_id,
    })
  } catch (e) {
    console.error('amendment signed receipt to tenant failed', e)
  }

  await notifyLandlordSigned(signed, doc, signatureName, date)

  return Response.json({ amendment: stripAudit(signed) })
}

/**
 * Strip the audit columns before handing the row back.
 *
 * The tenant just supplied their own IP and user agent, so this is not about
 * secrecy. It is about not teaching the client to depend on fields that exist
 * for a dispute, and keeping the response shape identical to what
 * /api/tenant/amendments returns.
 */
function stripAudit(row: Record<string, unknown>) {
  const {
    signature_ip: _ip, signature_user_agent: _ua, signed_by_user_id: _by,
    billed_at: _billed, owner_id: _owner, property_id: _prop,
    lease_tenant_id: _lt, created_at: _c, updated_at: _u,
    ...safe
  } = row
  return safe
}

/** Tell the landlord it was signed, and what single thing collects the money. */
async function notifyLandlordSigned(
  signed: any,
  doc: AmendmentDocument,
  signatureName: string,
  signatureDate: string
): Promise<void> {
  try {
    const { data: owner } = await supabaseAdmin
      .from('profiles').select('email, full_name').eq('id', signed.owner_id).maybeSingle()
    if (!owner?.email) return

    const built = buildAmendmentSignedLandlordEmail({
      amendment: signed,
      doc,
      signatureName,
      signatureDate,
      manageUrl: `${getSiteUrl()}/landlord/leases/${signed.lease_id}?tab=amendments`,
    })
    const { error } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: owner.email,
      subject: built.subject, html: built.html, text: built.text,
    })
    if (error) throw error
    await supabaseAdmin.from('lease_amendment_sends').insert({
      amendment_id: signed.id, owner_id: signed.owner_id, kind: 'landlord',
      recipient: owner.email, subject: built.subject,
    })
    await logEmail(null, 'amendment_signed_landlord', built.subject, owner.email, {
      amendment_id: signed.id, lease_id: signed.lease_id, monthly_charge: signed.monthly_charge,
    })
  } catch (e) {
    console.error('amendment signed notice to landlord failed', e)
  }
}

/** And tell them when the answer was no — the lease is unchanged either way. */
async function notifyLandlordDeclined(
  ownerId: string,
  declined: any,
  doc: AmendmentDocument,
  reason: string | null
): Promise<void> {
  try {
    const { data: owner } = await supabaseAdmin
      .from('profiles').select('email, full_name').eq('id', ownerId).maybeSingle()
    if (!owner?.email) return

    const built = buildAmendmentDeclinedLandlordEmail({
      doc,
      tenantName: declined.tenant_name,
      reason,
      manageUrl: `${getSiteUrl()}/landlord/leases/${declined.lease_id}?tab=amendments`,
    })
    const { error } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: owner.email,
      subject: built.subject, html: built.html, text: built.text,
    })
    if (error) throw error
    await supabaseAdmin.from('lease_amendment_sends').insert({
      amendment_id: declined.id, owner_id: ownerId, kind: 'landlord',
      recipient: owner.email, subject: built.subject,
    })
    await logEmail(null, 'amendment_declined_landlord', built.subject, owner.email, {
      amendment_id: declined.id, lease_id: declined.lease_id,
    })
  } catch (e) {
    console.error('amendment declined notice to landlord failed', e)
  }
}
