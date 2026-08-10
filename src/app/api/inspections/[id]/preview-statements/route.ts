/**
 * POST /api/inspections/[id]/preview-statements
 *
 * Renders the exact emails that /send-report would send, without sending them.
 * Same loader, same builder, same live-email resolution — so what the landlord
 * approves in the preview modal is byte-for-byte what lands in the inbox.
 *
 * Body: { partyIds?: string[] } — omit for everyone on the report.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { computeTotals } from '@/lib/inspections'
import { buildTenantStatementEmail } from '@/lib/inspectionEmails'
import { resolveLiveEmails } from '@/lib/inspectionContacts'
import { INSPECTION_SELECT_SERVER, normalizeInspection } from '@/lib/inspectionServer'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

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
  if ((data as any).owner_id !== user.id) return Response.json({ error: 'Unauthorized' }, { status: 403 })

  const inspection = normalizeInspection(data)

  // Preview against the same addresses the send would use — display only here.
  const liveEmails = await resolveLiveEmails(supabaseAdmin as never, inspection.parties)
  inspection.parties = inspection.parties.map(p =>
    liveEmails.has(p.id) ? { ...p, email: liveEmails.get(p.id)! } : p
  )

  const siteUrl = getSiteUrl()
  const totals = computeTotals(inspection)
  const targets = totals.perParty.filter(pt =>
    requestedIds ? requestedIds.includes(pt.party.id) : true
  )

  const previews = targets.map(pt => {
    const { subject, html } = buildTenantStatementEmail({
      inspection,
      partyTotal: pt,
      reportUrl: `${siteUrl}/checkout-report/${pt.party.share_token}`,
      landlordName: null,
      landlordEmail: user.email ?? null,
    })
    return {
      partyId: pt.party.id,
      name: pt.party.name,
      to: pt.party.email?.trim() || null,
      balance: pt.balance,
      alreadySent: !!pt.party.report_sent_at,
      subject,
      html,
    }
  })

  return Response.json({
    isDraft: inspection.status === 'draft',
    version: inspection.version ?? 0,
    previews,
  })
}
