/**
 * The landlord's side of a lease amendment.
 *
 *   GET    /api/lease-amendments?lease_id=…  — the amendments on one lease
 *   POST   /api/lease-amendments             — build one, freeze it, email it
 *   PATCH  /api/lease-amendments             — withdraw it, or mark it billed
 *
 * Sending runs on the server, and not only because the Resend key does. The
 * insert and the email are one action with two halves, and the half that
 * matters is the one that leaves the building: a row saying "sent for
 * signature" that the tenant never received is worse than no row at all,
 * because the landlord stops chasing and believes they have asked. So if the
 * email fails, the row is removed and the caller is told nothing went out.
 *
 * The document is built here and stored whole. That is the one thing in this
 * route that must not be moved to the client or recomputed later — see the
 * comment on `lease_amendments.document`.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildAmendmentRequestEmail } from '@/lib/amendmentEmails'
import { logEmail } from '@/lib/emailLog'
import {
  buildPetAdditionDocument, verifyAmendmentDocument, amendmentPath, signingToday, DATE_RE,
  type AmendmentDocument, type AmendmentKind,
} from '@/lib/leaseAmendments'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

async function requireUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user ?? null
}

const LEASE_SELECT = `
  id, owner_id, property_id, start_date, end_date, unit_number, is_demo,
  property:properties ( id, name, address, slug ),
  tenants:lease_tenants ( id, name, email )
`

/** The tenant-facing URL of one amendment. Login-gated; the token is the deep link. */
const signUrlFor = (token: string) => `${getSiteUrl()}${amendmentPath(token)}`

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const leaseId = req.nextUrl.searchParams.get('lease_id')
  if (!leaseId) return Response.json({ error: 'Which lease?' }, { status: 400 })

  const { data: amendments, error } = await supabaseAdmin
    .from('lease_amendments')
    .select('*')
    .eq('lease_id', leaseId)
    .eq('owner_id', user.id)       // scoped by owner, not by a client-supplied id alone
    .order('sent_at', { ascending: false })

  if (error) {
    console.error('amendment list failed', error)
    return Response.json({ error: 'Could not load amendments.' }, { status: 500 })
  }

  // The chase history. Fetched in one query for the whole list rather than per
  // row — six housemates with three reminders each is otherwise 18 round trips
  // to render one tab.
  const ids = (amendments ?? []).map(a => a.id)
  const { data: sends } = ids.length > 0
    ? await supabaseAdmin
        .from('lease_amendment_sends')
        .select('id, amendment_id, kind, recipient, subject, sent_at')
        .in('amendment_id', ids)
        .order('sent_at', { ascending: false })
    : { data: [] }

  return Response.json({ amendments: amendments ?? [], sends: sends ?? [] })
}

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leaseId = str(body.lease_id)
  const leaseTenantId = str(body.lease_tenant_id)
  const kind = (str(body.kind) ?? 'pet_addition') as AmendmentKind
  if (!leaseId) return Response.json({ error: 'Which lease?' }, { status: 400 })
  if (!leaseTenantId) return Response.json({ error: 'Which tenant is signing it?' }, { status: 400 })
  if (kind !== 'pet_addition') {
    // The table accepts 'other'; nothing builds a document for it yet, and a
    // blank contract is not something to let out of the door.
    return Response.json({ error: 'Only a pet addition can be drawn up right now.' }, { status: 400 })
  }

  const effective = str(body.effective_date)
  if (!effective || !DATE_RE.test(effective)) {
    return Response.json({ error: 'Give the change an effective date.' }, { status: 400 })
  }

  /** Whole dollars, or an error naming the field a landlord can see. */
  const money = (v: unknown, label: string): number | string => {
    const n = Number(v ?? 0)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return `${label} has to be a whole number of dollars.`
    }
    return n
  }
  const charge = money(body.monthly_charge, 'The monthly pet rent')
  const deposit = money(body.deposit_amount, 'The pet security deposit')
  const cleaning = money(body.one_time_fee_amount, 'The one-time cleaning fee')
  for (const v of [charge, deposit, cleaning]) {
    if (typeof v === 'string') return Response.json({ error: v }, { status: 400 })
  }

  // The acceptance deadline. Optional, but if it is given it must be in the
  // future — an offer that is already expired when it lands in the tenant's
  // inbox is worse than one with no deadline at all, because the landlord
  // believes they have asked and the tenant cannot answer.
  const respondBy = str(body.respond_by)
  if (respondBy && !DATE_RE.test(respondBy)) {
    return Response.json({ error: 'The sign-by date is not a date.' }, { status: 400 })
  }
  if (respondBy && respondBy < signingToday()) {
    return Response.json({
      error: 'The sign-by date has already passed — the tenant could never sign it in time.',
    }, { status: 400 })
  }

  const petName = str(body.pet_name)
  const species = str(body.pet_species)
  if (!species) return Response.json({ error: 'Say what kind of animal it is.' }, { status: 400 })
  if (!petName) return Response.json({ error: 'Give the pet a name — the document identifies it.' }, { status: 400 })

  const dob = str(body.pet_dob)
  if (dob && !DATE_RE.test(dob)) {
    return Response.json({ error: 'The pet’s date of birth is not a date.' }, { status: 400 })
  }

  // The lease must be the caller's. Never trust a client-supplied id.
  const { data: lease } = await supabaseAdmin
    .from('leases').select(LEASE_SELECT).eq('id', leaseId).maybeSingle()

  if (!lease) return Response.json({ error: 'Lease not found.' }, { status: 404 })
  if (lease.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })
  if (lease.is_demo) {
    // A demo lease is a rehearsal with no real tenant behind it. An amendment
    // on one would mail a stranger a contract for a tenancy that does not exist.
    return Response.json({
      error: 'This is a demo lease — there is nobody to send an amendment to.',
    }, { status: 400 })
  }

  const tenants = (lease.tenants ?? []) as Array<{ id: string; name: string | null; email: string | null }>
  const recipient = tenants.find(t => t.id === leaseTenantId)
  if (!recipient) {
    return Response.json({ error: 'That tenant is not on this lease.' }, { status: 400 })
  }
  if (!recipient.email?.trim()) {
    return Response.json({
      error: `${recipient.name || 'That tenant'} has no email address on the lease. Add one first — ` +
        'an amendment has to be sent to somebody.',
    }, { status: 400 })
  }

  const property = lease.property as { name?: string; address?: string } | null
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('email, full_name').eq('id', user.id).maybeSingle()

  // The premises, written the way a contract writes it: the street address,
  // with the unit if the tenancy is for one room of a house.
  const premises = [
    property?.address || property?.name || 'the premises',
    (lease.unit_number as string | null)?.trim() || null,
  ].filter(Boolean).join(' — ')

  const doc: AmendmentDocument = buildPetAdditionDocument({
    propertyAddress: premises,
    // A document that names "your landlord" as a party is not a document. The
    // profile name is the only real name available, so its absence is a hard
    // stop rather than something to paper over with a placeholder.
    landlordName: profile?.full_name?.trim() || '',
    tenantName: recipient.name?.trim() || '',
    leaseStartDate: lease.start_date as string,
    leaseEndDate: lease.end_date as string,
    effectiveDate: effective,
    // The document is dated the day it is issued, which is today — not the day
    // the change takes effect. Conflating them would date a contract into the
    // future, and a reader cannot tell a forward-dated document from a
    // backdated one.
    agreementDate: signingToday(),
    monthlyPetRent: charge as number,
    petDeposit: deposit as number,
    cleaningFee: cleaning as number,
    respondBy,
    requireCotenantConsent: body.require_cotenant_consent !== false,
    pet: {
      name: petName,
      species,
      breed: str(body.pet_breed),
      color: str(body.pet_color),
      sex: str(body.pet_sex),
      weight: str(body.pet_weight),
      dob,
      microchip: str(body.pet_microchip),
      recordNumber: str(body.pet_record_number),
      sterilized: body.pet_sterilized === true,
      vaccinated: body.pet_vaccinated === true,
    },
    additionalTerms: str(body.additional_terms),
  })

  if (!doc.landlordName) {
    return Response.json({
      error: 'Add your full name to your HomeHive profile first — a lease amendment has to name you as the landlord.',
    }, { status: 400 })
  }
  if (!doc.tenantName) {
    return Response.json({
      error: `Add ${recipient.email}'s name to the lease first — the document has to name who is signing.`,
    }, { status: 400 })
  }

  // The guard that matters. See `verifyAmendmentDocument`: the failure it
  // catches is not a crash but a plausible-looking contract that quietly lost
  // the clause saying the rest of the lease is untouched.
  const problems = verifyAmendmentDocument(doc)
  if (problems.length > 0) {
    console.error('amendment document rejected', problems)
    return Response.json({ error: problems[0] }, { status: 400 })
  }

  const { data: amendment, error: insertErr } = await supabaseAdmin
    .from('lease_amendments')
    .insert({
      lease_id: lease.id,
      owner_id: user.id,
      property_id: lease.property_id,
      lease_tenant_id: recipient.id,
      kind,
      title: doc.title,
      effective_date: effective,
      // Projected out of `document.charges`, which is the authoritative copy.
      // These exist so a query can find "signed and never billed" without
      // reaching into jsonb.
      monthly_charge: charge as number,
      monthly_charge_label: doc.charges.find(c => c.kind === 'monthly')?.label ?? null,
      deposit_amount: deposit as number,
      one_time_fee_amount: cleaning as number,
      respond_by: respondBy,
      document: doc,
      tenant_name: recipient.name,
      tenant_email: recipient.email.trim().toLowerCase(),
    })
    .select('*')
    .single()

  if (insertErr || !amendment) {
    // 23505 is the one-live-amendment-per-tenant index doing its job.
    if (insertErr?.code === '23505') {
      return Response.json({
        error: `There is already an unsigned amendment out to ${recipient.name || recipient.email}. ` +
          'Withdraw it before sending another.',
      }, { status: 409 })
    }
    console.error('amendment insert failed', insertErr)
    return Response.json({ error: 'Could not save the amendment.' }, { status: 500 })
  }

  const { data: image } = await supabaseAdmin
    .from('property_images')
    .select('url')
    .eq('property_id', lease.property_id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  const built = buildAmendmentRequestEmail({
    doc,
    tenantName: recipient.name,
    landlordName: profile?.full_name ?? null,
    signUrl: signUrlFor(amendment.token),
    heroImage: (image?.url as string) ?? null,
  })

  try {
    const { error: sendErr } = await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: recipient.email,
      replyTo: profile?.email || undefined,
      subject: built.subject,
      html: built.html,
      text: built.text,
    })
    if (sendErr) throw sendErr
  } catch (e) {
    console.error('amendment request email failed', e)
    // Undo it rather than leave a landlord believing they have asked.
    await supabaseAdmin.from('lease_amendments').delete().eq('id', amendment.id)
    return Response.json({
      error: `Could not email ${recipient.email}. Nothing was sent, so nothing was recorded — ` +
        'check the address and try again.',
    }, { status: 502 })
  }

  // Both logged after the send succeeded, and outside that try on purpose: a
  // failed log entry must never be mistaken for a failed send and roll back a
  // contract the tenant has already received.
  try {
    await supabaseAdmin.from('lease_amendment_sends').insert({
      amendment_id: amendment.id,
      owner_id: user.id,
      kind: 'request',
      recipient: recipient.email,
      subject: built.subject,
    })
    await logEmail(null, 'amendment_request_tenant', built.subject, recipient.email, {
      lease_id: lease.id, amendment_id: amendment.id, monthly_charge: charge,
    })
  } catch (e) {
    console.error('amendment send log failed', e)
  }

  return Response.json({ amendment, sentTo: recipient.email })
}

// ── PATCH ────────────────────────────────────────────────────────────────────

/**
 * Withdraw an unsigned amendment, or record that a signed one has been billed.
 *
 * Withdrawing sends no email. A landlord withdraws almost exclusively to
 * re-send on different terms, and "your amendment has been withdrawn" landing a
 * minute before "please sign this amendment" reads as chaos rather than as
 * diligence. The withdrawn row stays as history either way.
 */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = str(body.id)
  const action = str(body.action) ?? 'withdraw'
  if (!id) return Response.json({ error: 'Which amendment?' }, { status: 400 })

  const { data: amendment } = await supabaseAdmin
    .from('lease_amendments')
    .select('id, owner_id, status, billed_at, cotenant_consents_at')
    .eq('id', id).maybeSingle()

  if (!amendment) return Response.json({ error: 'Amendment not found.' }, { status: 404 })
  if (amendment.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  if (action === 'withdraw') {
    if (amendment.status !== 'sent') {
      return Response.json({
        error: amendment.status === 'signed'
          ? 'This has been signed. A signed amendment cannot be withdrawn — send a new one that reverses it.'
          : `This amendment was already ${amendment.status}.`,
      }, { status: 409 })
    }
    const { data, error } = await supabaseAdmin
      .from('lease_amendments')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .eq('status', 'sent')   // lose the race rather than overwrite a signature
      .select('*')
      .single()
    if (error || !data) {
      return Response.json({
        error: 'Could not withdraw it — it may have just been signed.',
      }, { status: 409 })
    }
    return Response.json({ amendment: data })
  }

  // The two "I have done the thing outside the product" switches. Both are
  // reversible, because both are a human asserting something happened
  // elsewhere, and a human who clicks the wrong one should not have to live
  // with a signed record saying their tenant consented when they did not.
  const MARKS: Record<string, { column: 'billed_at' | 'cotenant_consents_at'; set: boolean }> = {
    mark_billed:      { column: 'billed_at',            set: true },
    unmark_billed:    { column: 'billed_at',            set: false },
    mark_consents:    { column: 'cotenant_consents_at', set: true },
    unmark_consents:  { column: 'cotenant_consents_at', set: false },
  }
  const mark = MARKS[action]
  if (mark) {
    if (amendment.status !== 'signed') {
      return Response.json({
        error: mark.column === 'billed_at'
          ? 'Only a signed amendment can be billed.'
          : 'The other tenants cannot consent to something that has not been signed yet.',
      }, { status: 409 })
    }
    const { data, error } = await supabaseAdmin
      .from('lease_amendments')
      .update({ [mark.column]: mark.set ? new Date().toISOString() : null })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) {
      return Response.json({ error: 'Could not update the amendment.' }, { status: 500 })
    }
    return Response.json({ amendment: data })
  }

  return Response.json({ error: 'Unknown action.' }, { status: 400 })
}
