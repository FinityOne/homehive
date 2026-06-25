import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

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

function reviewEmailHtml(params: { firstName: string; landlordName: string }): string {
  const { firstName, landlordName } = params
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Your Application is Under Review</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<div style="max-width:520px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Home<span style="color:#FFC627;font-style:italic;">Hive</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.45);font-weight:600;text-transform:uppercase;letter-spacing:1px;">Application Update</div>
  </div>

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:32px 28px;">

    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#1a1a1a;">${greeting}</p>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      Great news — your rental application is moving along! Your background check is
      <strong>currently being reviewed</strong>, and we're almost done. 🎉
    </p>

    <div style="background:#faf9f6;border:1px solid #e8e5de;border-radius:12px;padding:18px 20px;margin:0 0 22px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:34px;height:34px;border-radius:50%;background:rgba(255,198,39,0.18);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;">⏳</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;">Review in progress</div>
          <div style="font-size:12px;color:#6b6b6b;margin-top:2px;">You'll have an update from us shortly.</div>
        </div>
      </div>
    </div>

    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#3a3a3a;">
      There's nothing you need to do right now — we just wanted to keep you in the loop.
      We'll be in touch very soon with the next step. Thanks for your patience!
    </p>

    <div style="border-top:1px solid #f0ede6;padding-top:20px;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1a1a1a;">${landlordName}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#9b9b9b;">Sent via <a href="https://homehive.live" style="color:#8C1D40;text-decoration:none;">HomeHive</a></p>
    </div>

  </div>

  <div style="margin-top:20px;text-align:center;font-size:11px;color:#9b9b9b;line-height:1.7;">
    You're receiving this because you applied to a rental managed on HomeHive.
  </div>
</div>
</body>
</html>`
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const user = await getLandlordUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: bgCheck } = await supabaseAdmin
    .from('background_checks')
    .select('id, leads(first_name, last_name, email)')
    .eq('id', checkId)
    .eq('landlord_id', user.id)
    .single()

  if (!bgCheck) return Response.json({ error: 'Not found' }, { status: 404 })

  const rawLead = bgCheck.leads as unknown
  const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as
    { first_name: string | null; last_name: string | null; email: string } | null

  if (!lead?.email) return Response.json({ error: 'Applicant has no email address' }, { status: 400 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  const landlordName = profile?.full_name || 'Your landlord'
  const firstName = lead.first_name || ''
  const subject = 'Your application is being reviewed — almost done!'

  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: reviewEmailHtml({ firstName, landlordName }),
    })

    const recipientName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
    const { data: logRow } = await supabaseAdmin
      .from('bg_check_emails')
      .insert({
        bg_check_id: checkId,
        ref_id: null,
        ref_type: 'applicant',
        recipient: lead.email,
        recipient_name: recipientName,
        subject,
        status: 'sent',
        sent_by: user.id,
      })
      .select()
      .single()

    return Response.json({ success: true, log: logRow })
  } catch (e) {
    console.error('Notify-review email error:', e)
    await supabaseAdmin.from('bg_check_emails').insert({
      bg_check_id: checkId,
      ref_id: null,
      ref_type: 'applicant',
      recipient: lead.email,
      recipient_name: [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null,
      subject,
      status: 'failed',
      error: e instanceof Error ? e.message : 'Unknown error',
      sent_by: user.id,
    })
    return Response.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
