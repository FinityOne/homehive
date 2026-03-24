import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { getLeadById } from '@/lib/leads'
import { logEmail } from '@/lib/emailLog'

// Use service role key on server-side routes to bypass RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  const lead = await getLeadById(leadId)

  if (!lead) {
    return Response.json({ error: 'Lead not found' }, { status: 404 })
  }

  // Mark as engaged when they open the pre-screen link
  if (lead.status === 'new' || lead.status === 'contacted') {
    await supabase
      .from('leads')
      .update({ status: 'engaged' })
      .eq('id', leadId)
  }

  // Fetch property details (no is_active filter — property may be deactivated later)
  let property_name = lead.property
  let property_address = ''
  let property_hero_image = ''
  let property_price: number | null = null

  if (lead.property) {
    const { data: prop } = await supabase
      .from('properties')
      .select('name, address, hero_image, price')
      .eq('slug', lead.property)
      .single()

    if (prop) {
      property_name = prop.name
      property_address = prop.address
      property_hero_image = prop.hero_image || ''
      property_price = prop.price
    }
  }

  // Check if pre-screen already submitted
  const { data: existingPrescreen } = await supabase
    .from('pre_screens')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle()

  return Response.json({
    first_name: lead.first_name,
    property: lead.property,
    property_name,
    property_address,
    property_hero_image,
    property_price,
    status: lead.status,
    move_in_date: lead.move_in_date,
    prescreen_completed: !!existingPrescreen,
  })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()

  const {
    is_student, university, birthdate, gender,
    move_in_date, group_size, about,
    monthly_budget, lease_length, lifestyle, notes,
  } = body

  // 1. Upsert pre-screen data into pre_screens table
  const { error: insertError } = await supabase
    .from('pre_screens')
    .upsert(
      [{
        lead_id: leadId,
        is_student: !!is_student,
        university: is_student ? (university || null) : null,
        birthdate: birthdate || null,
        gender: gender || null,
        move_in_date: move_in_date || null,
        group_size: group_size || 1,
        about: about || null,
        monthly_budget: monthly_budget ? parseInt(String(monthly_budget)) : null,
        lease_length: lease_length || null,
        lifestyle: lifestyle || null,
        notes: notes || null,
      }],
      { onConflict: 'lead_id' }
    )

  if (insertError) {
    console.error('Pre-screen insert error:', insertError)
    return Response.json({ error: 'Failed to save pre-screen' }, { status: 500 })
  }

  // 2. Advance lead status to qualified
  await supabase
    .from('leads')
    .update({ status: 'qualified' })
    .eq('id', leadId)

  // 3. Fetch lead + property for notification email
  const lead = await getLeadById(leadId)
  let propertyName = lead?.property || 'Property'
  let propertyAddress = ''
  let propertyHeroImage = ''

  if (lead?.property) {
    const { data: prop } = await supabase
      .from('properties')
      .select('name, address, hero_image')
      .eq('slug', lead.property)
      .single()

    if (prop) {
      propertyName = prop.name
      propertyAddress = prop.address
      propertyHeroImage = prop.hero_image || ''
    }
  }

  // 4. Notify landlord/admin with full pre-screen summary
  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: process.env.YOUR_EMAIL!,
      subject: `✅ Pre-screen completed: ${lead?.first_name || 'Applicant'} — ${propertyName}`,
      html: buildLandlordPrescreenEmail({
        firstName: lead?.first_name || 'Applicant',
        email: lead?.email || '',
        phone: lead?.phone || '—',
        propertyName,
        propertyAddress,
        propertyHeroImage,
        moveInDate: move_in_date || '—',
        isStudent: !!is_student,
        university: is_student ? university : null,
        groupSize: group_size || 1,
        about: about || '—',
        monthlyBudget: monthly_budget || null,
        leaseLength: lease_length || '—',
        lifestyle: lifestyle || '—',
        gender: gender || '—',
        notes: notes || null,
        leadId,
      }),
    })
    await logEmail(leadId, 'lead_qualified_landlord', `✅ Pre-screen completed: ${lead?.first_name || 'Applicant'} — ${propertyName}`, process.env.YOUR_EMAIL!, { property: propertyName, first_name: lead?.first_name })
  } catch (e) {
    console.error('Landlord pre-screen notification error:', e)
  }

  return Response.json({ success: true })
}

function buildLandlordPrescreenEmail(d: {
  firstName: string; email: string; phone: string
  propertyName: string; propertyAddress: string; propertyHeroImage: string
  moveInDate: string; isStudent: boolean; university: string | null
  groupSize: number; about: string; monthlyBudget: number | null
  leaseLength: string; lifestyle: string; gender: string; notes: string | null
  leadId: string
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;">
    <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#FFC627;background:rgba(255,198,39,0.15);padding:4px 12px;border-radius:20px;border:1px solid rgba(255,198,39,0.3);">
      ✅ Pre-Screen Complete
    </div>
  </div>

  ${d.propertyHeroImage ? `
  <!-- Property Image -->
  <div style="width:100%;height:200px;overflow:hidden;">
    <img src="${d.propertyHeroImage}" alt="${d.propertyName}" style="width:100%;height:100%;object-fit:cover;" />
  </div>` : ''}

  <!-- Property Info Bar -->
  <div style="background:#fff;padding:16px 28px;border-left:4px solid #8C1D40;${d.propertyHeroImage ? '' : 'border-radius:14px 14px 0 0;'}">
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${d.propertyName}</div>
    ${d.propertyAddress ? `<div style="font-size:13px;color:#9b9b9b;margin-top:3px;">📍 ${d.propertyAddress}</div>` : ''}
  </div>

  <!-- Main Card -->
  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:24px 28px;">

    <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8C1D40;margin-bottom:8px;">New Application</div>
    <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#1a1a1a;">${d.firstName} completed their pre-screen</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#9b9b9b;">Review their profile below and follow up when ready.</p>

    <!-- Contact Info -->
    <div style="background:#faf9f6;border-radius:10px;padding:16px 18px;margin-bottom:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:10px;">Contact</div>
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#6b6b6b;width:120px;">Name</td><td style="padding:4px 0;font-weight:600;">${d.firstName}</td></tr>
        <tr><td style="padding:4px 0;color:#6b6b6b;">Email</td><td style="padding:4px 0;"><a href="mailto:${d.email}" style="color:#8C1D40;text-decoration:none;">${d.email}</a></td></tr>
        <tr><td style="padding:4px 0;color:#6b6b6b;">Phone</td><td style="padding:4px 0;">${d.phone}</td></tr>
        <tr><td style="padding:4px 0;color:#6b6b6b;">Gender</td><td style="padding:4px 0;">${d.gender}</td></tr>
        ${d.isStudent ? `<tr><td style="padding:4px 0;color:#6b6b6b;">Student</td><td style="padding:4px 0;">Yes — ${d.university || 'University not specified'}</td></tr>` : '<tr><td style="padding:4px 0;color:#6b6b6b;">Student</td><td style="padding:4px 0;">No</td></tr>'}
      </table>
    </div>

    <!-- Move-in Details -->
    <div style="background:#faf9f6;border-radius:10px;padding:16px 18px;margin-bottom:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:10px;">Move-in Plan</div>
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#6b6b6b;width:120px;">Move-in</td><td style="padding:4px 0;font-weight:600;">${d.moveInDate}</td></tr>
        <tr><td style="padding:4px 0;color:#6b6b6b;">Group size</td><td style="padding:4px 0;">${d.groupSize === 1 ? 'Solo' : `${d.groupSize} people`}</td></tr>
        <tr><td style="padding:4px 0;color:#6b6b6b;">Lease</td><td style="padding:4px 0;">${d.leaseLength}</td></tr>
      </table>
    </div>

    <!-- Budget & Lifestyle -->
    <div style="background:#faf9f6;border-radius:10px;padding:16px 18px;margin-bottom:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9b9b9b;margin-bottom:10px;">Budget & Lifestyle</div>
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#6b6b6b;width:120px;">Budget</td><td style="padding:4px 0;font-weight:600;color:#8C1D40;">${d.monthlyBudget ? `$${d.monthlyBudget.toLocaleString()}/mo` : '—'}</td></tr>
        <tr><td style="padding:4px 0;color:#6b6b6b;">Lifestyle</td><td style="padding:4px 0;">${d.lifestyle}</td></tr>
      </table>
    </div>

    <!-- About -->
    ${d.about && d.about !== '—' ? `
    <div style="background:#fdf2f5;border-left:3px solid #8C1D40;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:16px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8C1D40;margin-bottom:6px;">About Themselves</div>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65;font-style:italic;">"${d.about}"</p>
    </div>` : ''}

    ${d.notes ? `
    <div style="background:#faf9f6;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#6b6b6b;">
      <strong>Additional notes:</strong> ${d.notes}
    </div>` : ''}

    <!-- Lead status note -->
    <div style="background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px 16px;font-size:13px;color:#065f46;">
      ✅ Lead status has been automatically updated to <strong>Qualified</strong>.
    </div>

  </div>

  <!-- Footer -->
  <div style="margin-top:20px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>

</div>
</body>
</html>`
}
