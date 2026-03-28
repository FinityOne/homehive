import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { logEmail } from '@/lib/emailLog'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(req: Request) {
  const body = await req.json() as {
    name: string
    address: string
    description?: string
    price: number
    security_deposit?: number | null
    listing_type: string
    unit_type?: string | null
    beds?: number
    baths?: number
    sqft?: string
    total_rooms?: number
    available?: number
    asu_distance?: number
    sublease_end_date?: string | null
    move_in_date?: string | null
    map_embed_url?: string
    lat?: number
    lng?: number
    owner_id?: string | null   // null = claimable
    is_claimable: boolean
    tags?: string[]
    asu_reasons?: string[]
    nearby?: { place: string; travel_time: string }[]
    images?: string[]          // already-uploaded URLs
  }

  // Build slug
  const base = body.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 7)
  const slug = `${base}-${suffix}`

  // Generate claim token if claimable
  const claim_token = body.is_claimable
    ? crypto.randomUUID()
    : null

  const { data: row, error: insertErr } = await supabase
    .from('properties')
    .insert({
      slug,
      name: body.name,
      address: body.address,
      description: body.description || '',
      price: body.price,
      security_deposit: body.security_deposit ?? null,
      listing_type: body.listing_type || 'standard_rental',
      unit_type: body.unit_type ?? null,
      beds: body.beds ?? 1,
      baths: body.baths ?? 1,
      sqft: body.sqft ?? '',
      total_rooms: body.total_rooms ?? 1,
      available: body.available ?? 1,
      asu_distance: body.asu_distance ?? 0,
      sublease_end_date: body.sublease_end_date ?? null,
      map_embed_url: body.map_embed_url ?? '',
      lat: body.lat ?? 0,
      lng: body.lng ?? 0,
      owner_id: body.owner_id ?? null,
      is_claimable: body.is_claimable,
      claim_token,
      // Admin-created listings are immediately active
      is_active: true,
      admin_status: 'active',
      is_test: false,
      is_featured: false,
      asu_score: 7,
    })
    .select('id')
    .single()

  if (insertErr || !row) {
    return Response.json({ error: 'Failed to create property' }, { status: 500 })
  }

  const propertyId = row.id

  // Save tags
  if (body.tags && body.tags.length > 0) {
    await supabase.from('property_tags')
      .insert(body.tags.map(tag => ({ property_id: propertyId, tag })))
  }

  // Save nearby places
  if (body.nearby && body.nearby.length > 0) {
    await supabase.from('property_nearby')
      .insert(body.nearby.map(n => ({ property_id: propertyId, place: n.place, travel_time: n.travel_time })))
  }

  // Save ASU reasons
  if (body.asu_reasons && body.asu_reasons.length > 0) {
    await supabase.from('property_asu_reasons')
      .insert(body.asu_reasons.map((reason, i) => ({ property_id: propertyId, reason, position: i })))
  }

  // Save images
  if (body.images && body.images.length > 0) {
    await supabase.from('property_images')
      .insert(body.images.map((url, i) => ({ property_id: propertyId, url, position: i })))
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'

  // Notify assigned landlord if owner was set
  if (body.owner_id) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(body.owner_id)
      const landlordEmail = user?.email
      if (landlordEmail) {
        const listingUrl = `${siteUrl}/landlord/listings/${slug}`
        await resend.emails.send({
          from: 'HomeHive <hello@homehive.live>',
          to: landlordEmail,
          subject: `A new listing has been added to your HomeHive account`,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:540px;margin:0 auto;padding:32px 16px;">
  <div style="background:#1a1a1a;border-radius:14px 14px 0 0;padding:20px 28px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">
      Home<span style="color:#FFC627;font-style:italic;">Hive</span>
    </div>
  </div>
  <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 28px;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#166534;margin-bottom:4px;">New Listing Added</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;">${body.name}</div>
  </div>
  <div style="background:#fff;border:1px solid #e8e4db;border-top:none;border-radius:0 0 14px 14px;padding:28px;">
    <p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">Your listing is live!</p>
    <p style="font-size:14px;color:#4a4a4a;line-height:1.7;margin:0 0 24px;">
      The HomeHive team has added <strong>${body.name}</strong> to your account and it's already live for students to discover.
      Log in to manage your listing, update details, and track incoming leads.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${listingUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c002a,#8c1d40);color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:9px;">View Your Listing →</a>
    </div>
    <p style="margin:0;font-size:13px;color:#9b9b9b;">Questions? <a href="mailto:hello@homehive.live" style="color:#8C1D40;">hello@homehive.live</a></p>
  </div>
</div>
</body>
</html>`,
        })
        await logEmail('', 'listing_approved', `A new listing has been added to your account`, landlordEmail, { propertySlug: slug })
      }
    } catch (_) {}
  }

  const claimUrl = claim_token ? `${siteUrl}/claim/${claim_token}` : null

  return Response.json({ ok: true, id: propertyId, slug, claimUrl })
}
