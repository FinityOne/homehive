import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

// Anon key for public lead inserts (RLS allows)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Service role client for auth admin lookups
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: Request) {
  const body = await req.json()
  const { first_name, email, phone, move_in_date, property } = body

  console.log('Incoming lead:', JSON.stringify({ first_name, email, phone, move_in_date, property }, null, 2))

  // 1. Save to Supabase
  const { data, error } = await supabase
    .from('leads')
    .insert([{ first_name, email, phone, move_in_date, property, status: 'new' }])
    .select()

  if (error || !data || data.length === 0) {
    console.error('Supabase error:', error)
    return Response.json({ error: 'Failed to save lead' }, { status: 500 })
  }

  const leadId = data[0].id
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'
  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`

  // 2. Fetch property details for emails
  let propertyName = property || 'the property'
  let propertyAddress = ''
  let propertyHeroImage = ''
  let propertyPrice: number | null = null
  let landlordEmail = process.env.ADMIN_EMAIL!

  if (property) {
    const { data: prop } = await supabase
      .from('properties')
      .select('name, address, price, owner_id, property_images(url, position)')
      .eq('slug', property)
      .single()

    if (prop) {
      propertyName = prop.name
      propertyAddress = prop.address
      propertyPrice = prop.price
      const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
      propertyHeroImage = imgs.sort((a, b) => a.position - b.position)[0]?.url || ''

      // Look up landlord email via service role
      if (prop.owner_id) {
        try {
          const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(prop.owner_id)
          if (user?.email) landlordEmail = user.email
        } catch (_) {}
      }
    }
  }

  // 3. Notify landlord
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: landlordEmail,
      subject: `New interest! ${first_name} → ${propertyName}`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,198,39,0.3);">
      🔔 New Lead
    </div>
  </div>

  ${propertyHeroImage ? `
  <div style="width:100%;height:200px;overflow:hidden;">
    <img src="${propertyHeroImage}" alt="${propertyName}" style="width:100%;height:100%;object-fit:cover;" />
  </div>` : ''}

  <!-- Property bar -->
  <div style="background:#fff;padding:16px 28px;border-left:4px solid #8C1D40;${propertyHeroImage ? '' : 'border-radius:14px 14px 0 0;'}">
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${propertyName}</div>
    ${propertyAddress ? `<div style="font-size:13px;color:#9b9b9b;margin-top:3px;">📍 ${propertyAddress}</div>` : ''}
    ${propertyPrice ? `<div style="font-size:13px;color:#8C1D40;font-weight:600;margin-top:3px;">$${propertyPrice.toLocaleString()}/mo per room</div>` : ''}
  </div>

  <!-- Main card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:24px 28px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8C1D40;margin-bottom:8px;">Lead Details</div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;">
      <tr><td style="padding:7px 0;color:#6b6b6b;width:130px;">Name</td><td style="padding:7px 0;font-weight:600;">${first_name}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;">Email</td><td style="padding:7px 0;"><a href="mailto:${email}" style="color:#8C1D40;text-decoration:none;">${email}</a></td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;">Phone</td><td style="padding:7px 0;">${phone || '—'}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;">Move-in</td><td style="padding:7px 0;">${move_in_date || '—'}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;font-size:12px;">Lead ID</td><td style="padding:7px 0;font-size:12px;color:#9b9b9b;">${leadId}</td></tr>
    </table>

    <div style="margin-top:20px;background:rgba(255,198,39,0.08);border:1px solid rgba(255,198,39,0.3);border-radius:10px;padding:14px 16px;font-size:13px;color:#5a4400;">
      Pre-screen link was sent to the lead:<br/>
      <a href="${prescreenUrl}" style="color:#8C1D40;font-weight:600;">${prescreenUrl}</a>
    </div>
  </div>

  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>
</div>
</body>
</html>`,
    })
    await logEmail(leadId, 'new_lead_landlord', `New interest! ${first_name} → ${propertyName}`, landlordEmail, { property: propertyName })
  } catch (emailError) {
    console.error('Admin notification email error:', emailError)
  }

  // 4. Send lead welcome email
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: email,
      subject: `${first_name}, one quick step to hold your spot at ${propertyName}`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <!-- Header bar -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:12px;color:#9b9b9b;margin-top:4px;">Student Housing Near ASU</div>
  </div>

  ${propertyHeroImage ? `
  <!-- Property Image -->
  <div style="width:100%;height:220px;overflow:hidden;position:relative;">
    <img src="${propertyHeroImage}" alt="${propertyName}" style="width:100%;height:100%;object-fit:cover;" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,rgba(0,0,0,0.55));"></div>
    <div style="position:absolute;bottom:16px;left:20px;right:20px;">
      <div style="font-size:17px;font-weight:700;color:#fff;">${propertyName}</div>
      ${propertyAddress ? `<div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:2px;">📍 ${propertyAddress}</div>` : ''}
    </div>
  </div>` : `
  <!-- Property name bar (no image) -->
  <div style="background:#8C1D40;padding:16px 28px;">
    <div style="font-size:16px;font-weight:700;color:#fff;">${propertyName}</div>
    ${propertyAddress ? `<div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:2px;">📍 ${propertyAddress}</div>` : ''}
  </div>`}

  <!-- Card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;">

    <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">
      Hi ${first_name}! 👋
    </p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;">
      Your interest in <strong>${propertyName}</strong>${propertyAddress ? ` at <strong>${propertyAddress}</strong>` : ''} was received!
      We're already reviewing your timing and availability.
    </p>

    <!-- Next step box -->
    <div style="background:#fdf2f5;border-left:4px solid #8C1D40;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#8C1D40;margin-bottom:6px;">🏠 Move to the front of the line</div>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65;">
        Complete your quick pre-screen in under 2 minutes.
        Landlords review pre-screened applicants <strong>first</strong> — spots fill up fast!
      </p>
    </div>

    <!-- What you'll fill out -->
    <div style="margin-bottom:24px;">
      <div style="font-size:12px;font-weight:600;color:#9b9b9b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">What's in the pre-screen:</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${['A little about you (takes 30 sec)', 'Your move-in plan & group size', 'Budget & lifestyle fit'].map(item => `
        <div style="display:flex;align-items:center;gap:10px;font-size:13px;color:#3a3a3a;">
          <div style="width:18px;height:18px;border-radius:50%;background:#FFC627;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#1a1a1a;flex-shrink:0;">✓</div>
          ${item}
        </div>`).join('')}
      </div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin:24px 0;">
      <a href="${prescreenUrl}"
         style="display:inline-block;background:#FFC627;color:#1a1a1a;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:10px;letter-spacing:-0.2px;box-shadow:0 4px 20px rgba(255,198,39,0.4);">
        Complete My Pre-Screen →
      </a>
    </div>

    <p style="margin:16px 0 0;font-size:12px;color:#b0a898;text-align:center;line-height:1.6;">
      This link is personal to you · Expires in 7 days · No account needed
    </p>
  </div>

  <!-- Footer -->
  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>

</div>
</body>
</html>`,
    })
    console.log('Welcome email sent to:', email)
    await logEmail(leadId, 'lead_welcome', `${first_name}, one quick step to hold your spot at ${propertyName}`, email, { property: propertyName })
  } catch (emailError) {
    console.error('Welcome email error:', emailError)
  }

  return Response.json({ success: true, leadId })
}
