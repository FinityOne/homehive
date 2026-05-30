import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  // Fetch lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads').select('*').eq('id', leadId).single()

  if (leadErr || !lead) {
    return Response.json({ error: 'Lead not found' }, { status: 404 })
  }

  // Fetch property
  let propertyName = lead.property || 'the property'
  let propertyAddress = ''
  let propertyHeroImage = ''

  if (lead.property) {
    const { data: prop } = await supabase
      .from('properties').select('name, address, property_images(url, position)').eq('slug', lead.property).single()
    if (prop) {
      propertyName = prop.name
      propertyAddress = prop.address
      const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
      propertyHeroImage = imgs.sort((a, b) => a.position - b.position)[0]?.url || ''
    }
  }

  // Check if pre-screen already completed
  const { data: existingPrescreen } = await supabase
    .from('pre_screens')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle()
  const prescreenDone = !!existingPrescreen

  const siteUrl = getSiteUrl()
  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`

  const propertyImageBlock = propertyHeroImage ? `
  <div style="width:100%;height:200px;overflow:hidden;position:relative;">
    <img src="${propertyHeroImage}" alt="${propertyName}" style="width:100%;height:100%;object-fit:cover;" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,rgba(0,0,0,0.55));"></div>
    <div style="position:absolute;bottom:16px;left:20px;right:20px;">
      <div style="font-size:17px;font-weight:700;color:#fff;">${propertyName}</div>
      ${propertyAddress ? `<div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:2px;">📍 ${propertyAddress}</div>` : ''}
    </div>
  </div>` : ''

  const headerBlock = `
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:12px;color:#9b9b9b;margin-top:4px;">Student Housing Near ASU</div>
  </div>`

  const footerBlock = `
  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>`

  // ── Branch: pre-screen already done → send warm "we'll be in touch" email
  if (prescreenDone) {
    const subject = `${lead.first_name}, you're already in — we'll be in touch soon! 🎉`
    try {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: lead.email,
        subject,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">
  ${headerBlock}
  ${propertyImageBlock}
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;">
    <div style="text-align:center;margin-bottom:20px;">
      <div style="width:64px;height:64px;border-radius:50%;background:#FFC627;display:inline-flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 4px 16px rgba(255,198,39,0.4);">🎉</div>
    </div>
    <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#1a1a1a;text-align:center;">You're all set, ${lead.first_name}!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;text-align:center;">
      Thanks for completing your pre-screen for <strong>${propertyName}</strong>. Our team is reviewing your profile and we'll be in touch soon to welcome you to your new home — hopefully!
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">What happens next</div>
      ${['A HomeHive rep reviews your full profile', "We'll reach out within 24 hours", 'Schedule a tour and get the keys 🗝️'].map((s, i) => `
      <div style="display:flex;align-items:center;gap:10px;font-size:13px;color:#166534;margin-bottom:${i < 2 ? '8px' : '0'};">
        <div style="width:20px;height:20px;border-radius:50%;background:#10b981;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i + 1}</div>
        ${s}
      </div>`).join('')}
    </div>
    <p style="margin:0;font-size:12px;color:#9b9b9b;text-align:center;">
      Questions? <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
    </p>
  </div>
  ${footerBlock}
</div>
</body>
</html>`,
      })
      await logEmail(leadId, 'prescreen_done_followup', subject, lead.email, { property: propertyName })
      return Response.json({ success: true })
    } catch (e) {
      console.error('Follow-up email error:', e)
      return Response.json({ error: 'Failed to send email' }, { status: 500 })
    }
  }

  // ── Branch: pre-screen NOT done → send urgency reminder
  const subject = `${lead.first_name}, your spot at ${propertyName} is still waiting`
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">
  ${headerBlock}
  ${propertyImageBlock}
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;">
    <div style="display:inline-flex;align-items:center;gap:6px;background:#fef3c7;border:1px solid #fde68a;border-radius:20px;padding:4px 12px;margin-bottom:16px;">
      <span style="font-size:11px;color:#92400e;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">⏰ Gentle reminder</span>
    </div>
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">Hey ${lead.first_name}!</p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;">
      Your spot at <strong>${propertyName}</strong> is still available, but rooms are filling up fast.
      You're just a 2-minute pre-screen away from locking it in. 🏠
    </p>
    <div style="background:#fdf2f5;border-left:4px solid #8C1D40;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#8C1D40;margin-bottom:4px;">Don't lose your spot</div>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65;">
        Pre-screened applicants are reviewed first. It takes under 2 minutes and dramatically increases your chances.
      </p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${prescreenUrl}" style="display:inline-block;background:#FFC627;color:#1a1a1a;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:10px;box-shadow:0 4px 20px rgba(255,198,39,0.4);">
        Complete My Pre-Screen →
      </a>
    </div>
    <p style="margin:0 0 16px;font-size:12px;color:#b0a898;text-align:center;">
      This link is personal to you · Takes 2 minutes · No commitment
    </p>
    <div style="border-top:1px solid #f0ede6;padding-top:14px;">
      <p style="margin:0;font-size:12px;color:#9b9b9b;text-align:center;line-height:1.6;">
        Already filled it out? You're all set — we'll be in touch soon to welcome you home! 🎉
      </p>
    </div>
  </div>
  ${footerBlock}
</div>
</body>
</html>`,
    })

    await logEmail(leadId, 'prescreen_reminder', subject, lead.email, { property: propertyName })
    return Response.json({ success: true })
  } catch (e) {
    console.error('Reminder email error:', e)
    return Response.json({ error: 'Failed to send reminder' }, { status: 500 })
  }
}
