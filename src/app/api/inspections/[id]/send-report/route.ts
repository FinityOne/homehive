/**
 * POST /api/inspections/[id]/send-report
 *
 * Emails each tenant on a finalized move-out inspection their own deposit
 * statement. Personalised per person — nobody receives anyone else's numbers.
 *
 * Body: { partyIds?: string[] }  — omit to send to everyone not yet emailed.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { computeTotals, type Inspection } from '@/lib/inspections'
import { buildTenantStatementEmail } from '@/lib/inspectionEmails'
import { resolveLiveEmails } from '@/lib/inspectionContacts'
import { INSPECTION_SELECT_SERVER, normalizeInspection } from '@/lib/inspectionServer'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const resend = new Resend(process.env.RESEND_API_KEY!)


export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const requestedIds: string[] | undefined = Array.isArray(body.partyIds) ? body.partyIds : undefined

  const { data, error } = await supabaseAdmin
    .from('checkout_inspections')
    .select(INSPECTION_SELECT_SERVER)
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return Response.json({ error: 'Inspection not found' }, { status: 404 })
  if (data.owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  // A draft's figures can still change — sending one would be a promise the
  // landlord hasn't made yet.
  if (data.status === 'draft') {
    return Response.json(
      { error: 'Finalize the inspection before emailing tenants.' },
      { status: 409 }
    )
  }

  const inspection: Inspection = normalizeInspection(data)

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, first_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const landlordName = profile?.full_name || profile?.first_name || null
  const landlordEmail = profile?.email || user.email || null
  // Resolve addresses at send time from the live tenant records. The party row
  // is a snapshot taken when the report was created; if the landlord has since
  // corrected someone's email, the statement must follow it — not go to the
  // address that was on file weeks ago.
  const liveEmails = await resolveLiveEmails(supabaseAdmin as never, inspection.parties)
  for (const party of inspection.parties) {
    const live = liveEmails.get(party.id)
    if (!live) continue
    party.email = live
    // Unlike the public report, sending is a deliberate action by the owner —
    // persist the correction so the record matches what was actually used.
    await supabaseAdmin
      .from('checkout_inspection_parties')
      .update({ email: live })
      .eq('id', party.id)
  }

  const siteUrl = getSiteUrl()
  const totals = computeTotals(inspection)
  const targets = totals.perParty.filter(pt =>
    requestedIds ? requestedIds.includes(pt.party.id) : true
  )

  const sent: { partyId: string; name: string; email: string }[] = []
  const skipped: { name: string; reason: string }[] = []
  const failed: { name: string; reason: string }[] = []

  for (const pt of targets) {
    const to = pt.party.email?.trim()
    if (!to) {
      skipped.push({ name: pt.party.name, reason: 'no email address on file' })
      continue
    }

    const { subject, html, text } = buildTenantStatementEmail({
      inspection,
      partyTotal: pt,
      // Their own link — the house report would expose housemates' balances.
      reportUrl: `${siteUrl}/checkout-report/${pt.party.share_token}`,
      landlordName,
      landlordEmail,
    })

    try {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to,
        subject,
        html,
        text,
        ...(landlordEmail ? { replyTo: landlordEmail } : {}),
      })
      sent.push({ partyId: pt.party.id, name: pt.party.name, email: to })
    } catch (e) {
      console.error('inspection statement send failed', pt.party.id, e)
      failed.push({ name: pt.party.name, reason: 'delivery failed' })
    }
  }

  if (sent.length > 0) {
    const stamp = new Date().toISOString()
    for (const s of sent) {
      await supabaseAdmin
        .from('checkout_inspection_parties')
        .update({ report_sent_at: stamp, report_sent_to: s.email })
        .eq('id', s.partyId)
    }
  }

  return Response.json({
    sent: sent.length,
    skipped,
    failed,
    recipients: sent.map(s => s.email),
  })
}
