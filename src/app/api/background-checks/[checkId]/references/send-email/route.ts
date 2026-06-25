import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { resolveReferenceEmail } from '@/lib/referenceEmailContext'

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const user = await getLandlordUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { refId } = await req.json()

  const resolved = await resolveReferenceEmail(supabaseAdmin, checkId, refId, user.id, user.email)
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status })

  const { built, refType, recipient, recipientName } = resolved.data
  const isEmployer = refType === 'employer'

  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      replyTo: built.replyTo,
      to: recipient,
      subject: built.subject,
      html: built.html,
    })

    // Residences: mark as contacted; employers: status stays as-is
    if (!isEmployer) {
      await supabaseAdmin
        .from('bg_check_references')
        .update({ status: 'contacted', contact_date: new Date().toISOString().split('T')[0] })
        .eq('id', refId)
    }

    // Record send in history
    const { data: logRow } = await supabaseAdmin
      .from('bg_check_emails')
      .insert({
        bg_check_id: checkId,
        ref_id: refId,
        ref_type: refType,
        recipient,
        recipient_name: recipientName,
        subject: built.subject,
        status: 'sent',
        sent_by: user.id,
      })
      .select()
      .single()

    return Response.json({ success: true, log: logRow })
  } catch (e) {
    console.error('Send email error:', e)

    // Record the failed attempt too
    await supabaseAdmin.from('bg_check_emails').insert({
      bg_check_id: checkId,
      ref_id: refId,
      ref_type: refType,
      recipient,
      recipient_name: recipientName,
      subject: built.subject,
      status: 'failed',
      error: e instanceof Error ? e.message : 'Unknown error',
      sent_by: user.id,
    })

    return Response.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
