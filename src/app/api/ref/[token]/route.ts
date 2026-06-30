import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { getSiteUrl } from '@/lib/siteUrl'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

// Notify the landlord that a reference just completed a verification form, with
// a direct link into that applicant's background check. Best-effort: never lets
// a notification failure break the reference submission itself.
async function notifyLandlord(bgCheckId: string, refType: string, refName: string | null) {
  try {
    const { data: bgCheck } = await supabaseAdmin
      .from('background_checks')
      .select('id, landlord_id, is_cosigner, subject_first_name, subject_last_name, leads(first_name, last_name)')
      .eq('id', bgCheckId)
      .single()
    if (!bgCheck) return

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', bgCheck.landlord_id)
      .single()
    if (!profile?.email) return

    const lead = (Array.isArray(bgCheck.leads) ? bgCheck.leads[0] : bgCheck.leads) as
      { first_name: string | null; last_name: string | null } | null
    const leadName = bgCheck.is_cosigner
      ? ([bgCheck.subject_first_name, bgCheck.subject_last_name].filter(Boolean).join(' ').trim() || 'a co-signer')
      : ([lead?.first_name, lead?.last_name].filter(Boolean).join(' ').trim() || 'an applicant')
    const isEmployer = refType === 'employer'
    const kind = isEmployer ? 'Employment verification' : 'Rental reference'
    const from = refName || (isEmployer ? 'An employer' : 'A previous landlord')
    const url = `${getSiteUrl()}/landlord/background-checks/${bgCheckId}`

    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: profile.email,
      subject: `${kind} completed for ${leadName}`,
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
  </div>
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:30px 28px;">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      Good news — <strong>${from}</strong> just completed the ${isEmployer ? 'employment verification' : 'rental reference'} for <strong>${leadName}</strong>. Their answers are now on the background check.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#8C1D40;color:#fff;text-decoration:none;padding:13px 30px;border-radius:10px;font-size:15px;font-weight:700;">
        View Background Check →
      </a>
    </div>
    <p style="margin:0;font-size:12px;color:#9b9b9b;line-height:1.6;">
      Or paste this link into your browser:<br/>
      <a href="${url}" style="color:#8C1D40;word-break:break-all;">${url}</a>
    </p>
  </div>
  <div style="margin-top:18px;text-align:center;font-size:11px;color:#9b9b9b;">Sent via HomeHive</div>
</div></body></html>`,
    })
  } catch (e) {
    console.error('notifyLandlord (ref submitted) error:', e)
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: ref } = await supabaseAdmin
    .from('bg_check_references')
    .select('id, type, name, address, status, responses, bg_check_id')
    .eq('public_token', token)
    .single()

  if (!ref) return Response.json({ error: 'Not found' }, { status: 404 })

  // Fetch the subject's name via the bg_check. Co-signer checks store the name
  // on the row (subject_*); applicant checks read it from the linked lead.
  const { data: bgCheck } = await supabaseAdmin
    .from('background_checks')
    .select('is_cosigner, subject_first_name, subject_last_name, leads(first_name, last_name)')
    .eq('id', ref.bg_check_id)
    .single()

  const lead = (Array.isArray(bgCheck?.leads) ? bgCheck?.leads[0] : bgCheck?.leads) as { first_name: string | null; last_name: string | null } | null
  const leadName = bgCheck?.is_cosigner
    ? (bgCheck.subject_first_name && bgCheck.subject_last_name
        ? `${bgCheck.subject_first_name} ${bgCheck.subject_last_name}`
        : bgCheck.subject_first_name || 'the co-signer')
    : (lead?.first_name && lead?.last_name
        ? `${lead.first_name} ${lead.last_name}`
        : lead?.first_name || 'the applicant')

  return Response.json({
    ref: {
      id: ref.id,
      type: ref.type,
      name: ref.name,
      address: ref.address,
      status: ref.status,
      responses: ref.responses,
    },
    leadName,
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: ref } = await supabaseAdmin
    .from('bg_check_references')
    .select('id, status, type, name, bg_check_id')
    .eq('public_token', token)
    .single()

  if (!ref) return Response.json({ error: 'Not found' }, { status: 404 })

  const { responses } = await req.json()
  if (!responses || !Array.isArray(responses)) {
    return Response.json({ error: 'responses array required' }, { status: 400 })
  }
  // Sanitise — only keep known fields
  const clean = responses.map((r: { question?: string; answer?: string; detail?: string }) => ({
    question: String(r.question || ''),
    answer: String(r.answer || ''),
    ...(r.detail ? { detail: String(r.detail) } : {}),
  }))

  // Only notify on the first submission, not re-submits of an already-verified ref
  const wasAlreadyVerified = ref.status === 'verified'

  await supabaseAdmin
    .from('bg_check_references')
    .update({ responses: clean, status: 'verified', contact_date: new Date().toISOString().split('T')[0] })
    .eq('id', ref.id)

  if (!wasAlreadyVerified) {
    await notifyLandlord(ref.bg_check_id, ref.type, ref.name)
  }

  return Response.json({ success: true })
}
