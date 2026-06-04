import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'
import { notifyLandlord } from '@/lib/notifyLandlord'

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
  const {
    first_name, email, phone, move_in_date, property,
    utm_source, utm_medium, utm_campaign, utm_content,
    landing_page, referrer, device_type, browser,
  } = body

  console.log('Incoming lead:', JSON.stringify({ first_name, email, phone, move_in_date, property, utm_source, utm_campaign }, null, 2))

  // 1. Save to Supabase
  const { data, error } = await supabase
    .from('leads')
    .insert([{
      first_name, email, phone, move_in_date, property, status: 'new',
      utm_source:   utm_source   || null,
      utm_medium:   utm_medium   || null,
      utm_campaign: utm_campaign || null,
      utm_content:  utm_content  || null,
      landing_page: landing_page || null,
      referrer:     referrer     || null,
      device_type:  device_type  || null,
      browser:      browser      || null,
    }])
    .select()

  if (error || !data || data.length === 0) {
    console.error('Supabase error:', error)
    return Response.json({ error: 'Failed to save lead' }, { status: 500 })
  }

  const leadId = data[0].id

  // Auto-group: check for existing leads with same email + property
  if (email && property) {
    const { data: existingLeads } = await supabaseAdmin
      .from('leads')
      .select('id, lead_group_id')
      .eq('email', email)
      .eq('property', property)
      .neq('id', leadId)

    if (existingLeads && existingLeads.length > 0) {
      const groupId = existingLeads.find(l => l.lead_group_id)?.lead_group_id || crypto.randomUUID()
      const idsToGroup = [leadId, ...existingLeads.filter(l => !l.lead_group_id).map(l => l.id)]
      // Assign group_id to new lead + any ungrouped existing leads
      await supabaseAdmin.from('leads').update({ lead_group_id: groupId }).in('id', idsToGroup)
      // If existing leads didn't have a group_id yet, assign the same one
      if (!existingLeads.find(l => l.lead_group_id)) {
        await supabaseAdmin.from('leads').update({ lead_group_id: groupId }).in('id', existingLeads.map(l => l.id))
      }
    }
  }

  const siteUrl = getSiteUrl()
  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`

  // 2. Fetch property details for emails
  let propertyName = property || 'the property'
  let propertyAddress = ''
  let propertyHeroImage = ''
  let propertyPrice: number | null = null // kept for internal use, not shown in emails
  let landlordEmail = process.env.ADMIN_EMAIL!
  let landlordFirstName = ''
  let landlordId = ''
  let hasFaqs = false
  const faqUrl = property ? `${siteUrl}/homes/${property}/faq` : ''

  if (property) {
    const { data: prop } = await supabase
      .from('properties')
      .select('id, name, address, price, owner_id, property_images(url, position)')
      .eq('slug', property)
      .single()

    if (prop) {
      propertyName = prop.name
      propertyAddress = prop.address
      propertyPrice = prop.price
      landlordId = prop.owner_id || ''

      // Does this listing have answered FAQs worth linking in the welcome email?
      try {
        const { count } = await supabase
          .from('property_faqs')
          .select('id', { count: 'exact', head: true })
          .eq('property_id', prop.id)
          .neq('answer', '')
        hasFaqs = (count ?? 0) > 0
      } catch (_) {}
      const imgs = (prop.property_images as { url: string; position: number }[] | null) ?? []
      propertyHeroImage = imgs.sort((a, b) => a.position - b.position)[0]?.url || ''

      // Look up landlord email + first name via service role
      if (prop.owner_id) {
        try {
          const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(prop.owner_id)
          if (user?.email) landlordEmail = user.email
        } catch (_) {}
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name')
            .eq('id', prop.owner_id)
            .single()
          if (profile?.first_name) landlordFirstName = profile.first_name
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

  // 3b. Admin CC — always notify admin regardless of landlord assignment
  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail && adminEmail !== landlordEmail) {
    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/Phoenix', month: 'short', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    try {
      await resend.emails.send({
        from: 'HomeHive <hello@homehive.live>',
        to: adminEmail,
        subject: `[Lead] ${first_name} → ${propertyName}`,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:12px 12px 0 0;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;">
    <span style="font-size:18px;font-weight:700;color:#fff;">Home<em style="color:#FFC627;font-style:italic;">Hive</em></span>
    <span style="font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:4px 10px;border-radius:12px;border:1px solid rgba(255,198,39,0.3);">🔔 New Lead</span>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:7px 0;color:#6b6b6b;width:110px;border-bottom:1px solid #f4f1eb;">Name</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f4f1eb;">${first_name}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">Email</td><td style="padding:7px 0;border-bottom:1px solid #f4f1eb;"><a href="mailto:${email}" style="color:#8C1D40;text-decoration:none;">${email}</a></td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">Phone</td><td style="padding:7px 0;border-bottom:1px solid #f4f1eb;">${phone || '—'}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">Property</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f4f1eb;">${propertyName}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;border-bottom:1px solid #f4f1eb;">Move-in</td><td style="padding:7px 0;border-bottom:1px solid #f4f1eb;">${move_in_date || '—'}</td></tr>
      <tr><td style="padding:7px 0;color:#6b6b6b;">Received</td><td style="padding:7px 0;">${now} MST</td></tr>
    </table>
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
      <a href="${getSiteUrl()}/admin/leads" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">View all leads →</a>
      <a href="${prescreenUrl}" style="display:inline-block;background:#fff;color:#1a1a1a;border:1.5px solid #e8e4db;text-decoration:none;font-size:13px;font-weight:500;padding:10px 18px;border-radius:8px;">Pre-screen link ↗</a>
    </div>
  </div>
</div>
</body>
</html>`,
      })
      await logEmail(leadId, 'admin_new_lead', `[Lead] ${first_name} → ${propertyName}`, adminEmail, { property: propertyName, leadEmail: email })
    } catch (_) {}
  }

  // 4. Send lead welcome email
  const welcomeSubject = `${first_name}, let's get you to the front of the line at ${propertyName}`
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: email,
      subject: welcomeSubject,
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

    <!-- Sent confirmation badge -->
    <div style="display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;padding:5px 12px;margin-bottom:16px;">
      <span style="font-size:11px;color:#166534;font-weight:600;letter-spacing:0.4px;">✓ Interest sent${landlordFirstName ? ` to ${landlordFirstName}` : ''}</span>
    </div>

    <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">
      Let's get to know you, ${first_name}.
    </p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;">
      Your inquiry is in${landlordFirstName ? ` and <strong>${landlordFirstName}</strong> will see it shortly` : ''}. Now take 2 minutes to complete your pre-screen and move yourself to the top of the applicant list.
    </p>

    <!-- Urgency box -->
    <div style="background:#fdf2f5;border-left:4px solid #8C1D40;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#8C1D40;margin-bottom:6px;">⚡ Move to the front of the line</div>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65;">
        Landlords review pre-screened applicants <strong>first</strong>. It takes under 2 minutes and dramatically increases your chances.
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

    <p style="margin:0 0 20px;font-size:12px;color:#b0a898;text-align:center;line-height:1.6;">
      This link is personal to you · Takes 2 minutes · No commitment
    </p>

    ${hasFaqs ? `
    <!-- FAQ link -->
    <div style="border-top:1px solid #f0ede6;padding-top:18px;margin-bottom:18px;">
      <div style="background:#f8f7f4;border:1px solid #e8e5de;border-radius:12px;padding:16px 18px;">
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">❓ Have questions about ${propertyName}?</div>
        <p style="margin:0 0 12px;font-size:13px;color:#4a4a4a;line-height:1.6;">
          We've answered the most common questions — utilities, parking, lease terms, tours and more.
        </p>
        <a href="${faqUrl}" style="display:inline-block;background:#1a1a1a;color:#FFC627;text-decoration:none;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;">
          Read the FAQ →
        </a>
      </div>
    </div>` : ''}

    <!-- Already completed note -->
    <div style="border-top:1px solid #f0ede6;padding-top:16px;">
      <p style="margin:0;font-size:12px;color:#9b9b9b;line-height:1.65;text-align:center;">
        Already filled out your pre-screen? You're all set — we'll be in touch soon to welcome you to your new home! 🎉
      </p>
    </div>

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
    await logEmail(leadId, 'lead_welcome', welcomeSubject, email, { property: propertyName })
  } catch (emailError) {
    console.error('Welcome email error:', emailError)
  }

  // Notify landlord of new lead
  if (landlordId) {
    await notifyLandlord({
      landlordId,
      type: 'lead_in',
      leadId,
      title: `New lead: ${first_name || email}`,
      body: `Interested in ${propertyName}`,
      href: `/landlord/leads/${leadId}`,
    }).catch(() => {})
  }

  return Response.json({ success: true, leadId })
}
