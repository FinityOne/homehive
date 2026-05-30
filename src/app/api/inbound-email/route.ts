import { getSiteUrl } from '@/lib/siteUrl'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { notifyLandlord } from '@/lib/notifyLandlord'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

// Resend inbound webhook — receives forwarded Redfin lead emails
export async function POST(req: Request) {
  // Verify webhook secret to prevent spoofing
  const secret = req.headers.get('x-webhook-secret') || req.headers.get('x-resend-signature')
  if (process.env.INBOUND_WEBHOOK_SECRET && secret !== process.env.INBOUND_WEBHOOK_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subject: string = String(payload.subject || payload.Subject || '')
  const from: string    = String(payload.from || payload.From || '')
  const textBody: string = String(
    payload.text || payload.body_plain || payload.plain || payload.body || ''
  )
  const htmlBody: string = String(payload.html || payload.body_html || '')

  // Only handle Redfin lead emails
  const addressMatch = subject.match(/New lead for:\s*(.+)/i)
  if (!addressMatch) {
    // Not a Redfin lead email — ignore silently
    return Response.json({ ignored: true })
  }

  const parsedAddress = addressMatch[1].trim()

  // Log the attempt early so partial failures are visible
  const { data: logRow } = await supabase
    .from('lead_automation_logs')
    .insert([{
      source: 'redfin',
      raw_subject: subject,
      raw_from: from,
      parsed_address: parsedAddress,
      status: 'processing',
    }])
    .select('id')
    .single()

  const logId: string = logRow?.id || ''

  const fail = async (msg: string) => {
    if (logId) {
      await supabase.from('lead_automation_logs')
        .update({ status: 'failed', error_message: msg })
        .eq('id', logId)
    }
    console.error('inbound-email error:', msg)
    return Response.json({ error: msg }, { status: 200 }) // 200 so Resend doesn't retry
  }

  // 1. Match property by address — bidirectional word-overlap scoring
  // Redfin often truncates (e.g. "1234 E University Dr") while the stored
  // address is full (e.g. "1234 E University Dr, Tempe, AZ 85281").
  // We pull all properties and pick the best word-overlap match so partial
  // addresses work in either direction.
  const { data: allProperties } = await supabase
    .from('properties')
    .select('id, name, slug, address, owner_id, property_images(url, position)')

  if (!allProperties || allProperties.length === 0) {
    return fail('No properties found in the system')
  }

  const scored = allProperties
    .map(p => ({ prop: p, score: addressOverlapScore(parsedAddress, p.address || '') }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return fail(`No property found matching address: "${parsedAddress}"`)
  }

  const property = scored[0].prop
  const imgs = (property.property_images as { url: string; position: number }[] | null) ?? []
  const propertyHeroImage = imgs.sort((a, b) => a.position - b.position)[0]?.url || ''

  // 2. Parse lead details from email body
  const lead = parseRedfinEmailBody(textBody || htmlBody)

  if (!lead.email) {
    return fail(`Could not parse lead email from Redfin body. Subject: "${subject}"`)
  }

  // 3. Look up landlord email
  let landlordEmail = process.env.ADMIN_EMAIL!
  if (property.owner_id) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(property.owner_id)
      if (user?.email) landlordEmail = user.email
    } catch (_) {}
  }

  // 4. Create lead (upsert by email + property to avoid duplicates)
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('email', lead.email)
    .eq('property', property.slug)
    .maybeSingle()

  let leadId: string

  if (existingLead) {
    leadId = existingLead.id
    // Update to contacted if still new
    await supabase.from('leads')
      .update({ status: 'contacted' })
      .eq('id', leadId)
      .in('status', ['new'])
  } else {
    const { data: newLead, error: insertErr } = await supabase
      .from('leads')
      .insert([{
        first_name: lead.firstName,
        last_name:  lead.lastName,
        email:      lead.email,
        phone:      lead.phone || null,
        property:   property.slug,
        status:     'contacted',
      }])
      .select('id')
      .single()

    if (insertErr || !newLead) {
      return fail(`Failed to insert lead: ${insertErr?.message}`)
    }
    leadId = newLead.id
  }

  // 5. Send pre-screen email to lead
  const siteUrl = getSiteUrl()
  const prescreenUrl = `${siteUrl}/pre-screen/${leadId}`

  try {
    await resend.emails.send({
      from: 'HomeHive <hello@homehive.live>',
      to: lead.email,
      subject: `${lead.firstName}, a quick step to move to the front of the line at ${property.name}`,
      html: buildPrescreenEmail({
        firstName: lead.firstName,
        propertyName: property.name,
        propertyAddress: property.address,
        propertyHeroImage,
        prescreenUrl,
      }),
    })
  } catch (e) {
    console.error('Pre-screen email send error:', e)
    // Don't fail the whole flow — lead is created, email is non-critical
  }

  // 6. Notify landlord of new automated lead
  if (property.owner_id) {
    await notifyLandlord({
      landlordId: property.owner_id,
      type: 'lead_in',
      leadId,
      title: `Redfin lead: ${lead.firstName || lead.email}`,
      body: `Auto-captured for ${property.name}`,
      href: `/landlord/leads/${leadId}`,
    }).catch(() => {})
  }

  // 7. Mark log as success
  await supabase.from('lead_automation_logs')
    .update({
      status:        'success',
      property_slug: property.slug,
      property_name: property.name,
      lead_id:       leadId,
      landlord_id:   property.owner_id || null,
      lead_name:     [lead.firstName, lead.lastName].filter(Boolean).join(' '),
      lead_email:    lead.email,
      lead_phone:    lead.phone || null,
    })
    .eq('id', logId)

  return Response.json({ success: true, leadId })
}

// ---------------------------------------------------------------------------
// Address matching: bidirectional word-overlap score
// Normalizes both strings to lowercase word sets, then counts how many words
// from the SHORTER string appear in the LONGER one. This handles truncated
// Redfin addresses ("1234 E University Dr") matching full stored addresses
// ("1234 E University Dr, Tempe, AZ 85281") and the reverse.
// ---------------------------------------------------------------------------
function addressOverlapScore(a: string, b: string): number {
  const tokenize = (s: string) =>
    s.toLowerCase()
      .replace(/[.,#\-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1) // skip single chars like "e", "n", "s"

  const wa = tokenize(a)
  const wb = tokenize(b)
  const [shorter, longerSet] = wa.length <= wb.length
    ? [wa, new Set(wb)]
    : [wb, new Set(wa)]

  if (shorter.length === 0) return 0

  const matches = shorter.filter(w => longerSet.has(w)).length
  // Require the street number to match (first numeric token) to avoid false positives
  const streetNum = shorter.find(w => /^\d+$/.test(w))
  if (streetNum && !longerSet.has(streetNum)) return 0

  return matches / shorter.length // 0–1; 1.0 = perfect subset match
}

// ---------------------------------------------------------------------------
// Parser: extract name/email/phone from Redfin lead email body
// ---------------------------------------------------------------------------
function parseRedfinEmailBody(body: string): {
  firstName: string
  lastName: string
  email: string
  phone: string
} {
  // Strip HTML tags for text parsing
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

  // Email
  const emailMatch = text.match(/\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/)
  const email = emailMatch?.[1] || ''

  // Phone — various formats
  const phoneMatch = text.match(/\b(\+?1?\s?[\(\-]?\d{3}[\)\-\s]?\s?\d{3}[\-\s]?\d{4})\b/)
  const phone = phoneMatch?.[1]?.replace(/\s+/g, ' ').trim() || ''

  // Name — Redfin format: "Name: John Smith" or "Buyer: John Smith"
  let firstName = 'Renter'
  let lastName  = ''

  const namePatterns = [
    /(?:Buyer|Name|Contact|From)[:\s]+([A-Z][a-z]+(?: [A-Z][a-z]+)+)/,
    /^([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:is|has|sent)/m,
    /([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s+(?:wants to|would like)/,
  ]

  for (const pattern of namePatterns) {
    const m = text.match(pattern)
    if (m?.[1]) {
      const parts = m[1].trim().split(' ')
      firstName = parts[0]
      lastName  = parts.slice(1).join(' ')
      break
    }
  }

  return { firstName, lastName, email, phone }
}

// ---------------------------------------------------------------------------
// Email template: pre-screen invite for auto-captured lead
// ---------------------------------------------------------------------------
function buildPrescreenEmail(d: {
  firstName: string
  propertyName: string
  propertyAddress: string
  propertyHeroImage: string
  prescreenUrl: string
}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">

  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
    <div style="font-size:12px;color:#9b9b9b;margin-top:4px;">Student Housing Near ASU</div>
  </div>

  ${d.propertyHeroImage ? `
  <div style="width:100%;height:220px;overflow:hidden;position:relative;">
    <img src="${d.propertyHeroImage}" alt="${d.propertyName}" style="width:100%;height:100%;object-fit:cover;" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,rgba(0,0,0,0.55));"></div>
    <div style="position:absolute;bottom:16px;left:20px;right:20px;">
      <div style="font-size:17px;font-weight:700;color:#fff;">${d.propertyName}</div>
      ${d.propertyAddress ? `<div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:2px;">📍 ${d.propertyAddress}</div>` : ''}
    </div>
  </div>` : `
  <div style="background:#8C1D40;padding:16px 28px;">
    <div style="font-size:16px;font-weight:700;color:#fff;">${d.propertyName}</div>
    ${d.propertyAddress ? `<div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:2px;">📍 ${d.propertyAddress}</div>` : ''}
  </div>`}

  <div style="background:#fff;border:1px solid #e8e5de;border-top:none;border-radius:0 0 14px 14px;padding:28px 28px 32px;">

    <div style="display:inline-flex;align-items:center;gap:6px;background:#fef3cd;border:1px solid #fde68a;border-radius:20px;padding:5px 12px;margin-bottom:16px;">
      <span style="font-size:11px;color:#92400e;font-weight:600;letter-spacing:0.4px;">📨 Your Redfin inquiry was received</span>
    </div>

    <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1a1a1a;">
      Hi ${d.firstName}, one quick step!
    </p>
    <p style="margin:0 0 20px;font-size:15px;color:#4a4a4a;line-height:1.7;">
      We received your Redfin inquiry for <strong>${d.propertyName}</strong>. Complete your 2-minute pre-screen to move to the top of the applicant list — landlords review pre-screened applicants first.
    </p>

    <div style="background:#fdf2f5;border-left:4px solid #8C1D40;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#8C1D40;margin-bottom:6px;">⚡ Move to the front of the line</div>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65;">
        Takes under 2 minutes. Dramatically increases your chances of getting a showing.
      </p>
    </div>

    <div style="text-align:center;margin:24px 0;">
      <a href="${d.prescreenUrl}"
         style="display:inline-block;background:#FFC627;color:#1a1a1a;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;border-radius:10px;letter-spacing:-0.2px;box-shadow:0 4px 20px rgba(255,198,39,0.4);">
        Complete My Pre-Screen →
      </a>
    </div>

    <p style="margin:0;font-size:12px;color:#b0a898;text-align:center;line-height:1.6;">
      This link is personal to you · Takes 2 minutes · No commitment
    </p>
  </div>

  <div style="margin-top:24px;text-align:center;font-size:12px;color:#9b9b9b;">
    HomeHive Team · <a href="mailto:hello@homehive.live" style="color:#8C1D40;text-decoration:none;">hello@homehive.live</a>
  </div>
</div>
</body>
</html>`
}
