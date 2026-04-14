import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET — return available slots for a lead's property (next 7 days, unbooked)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  // Fetch lead
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('leads').select('property, tour_invite_sent_at, status').eq('id', leadId).single()
  if (leadErr || !lead) return Response.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.tour_invite_sent_at) return Response.json({ error: 'Not invited yet' }, { status: 403 })

  // Check if already has a tour
  const { data: existingTour } = await supabaseAdmin
    .from('tours').select('*').eq('lead_id', leadId).eq('status', 'confirmed').maybeSingle()
  if (existingTour) {
    return Response.json({ alreadyBooked: true, tour: existingTour })
  }

  // Fetch property basic info
  const { data: prop } = await supabaseAdmin
    .from('properties')
    .select('name, address, property_images(url, position)')
    .eq('slug', lead.property)
    .single()

  // Fetch available slots for next 7 days
  const today = new Date()
  const in7Days = new Date(today); in7Days.setDate(in7Days.getDate() + 7)

  const { data: slots } = await supabaseAdmin
    .from('tour_availabilities')
    .select('*')
    .eq('property_slug', lead.property)
    .eq('is_booked', false)
    .gte('date', today.toISOString().split('T')[0])
    .lte('date', in7Days.toISOString().split('T')[0])
    .order('date', { ascending: true })
    .order('time_slot', { ascending: true })

  const imgs = (prop?.property_images as { url: string; position: number }[] | null) ?? []
  const heroImage = imgs.sort((a, b) => a.position - b.position)[0]?.url || ''

  return Response.json({
    alreadyBooked: false,
    slots: slots || [],
    property: prop ? { name: prop.name, address: prop.address, heroImage } : null,
    lead: { first_name: lead.status },
  })
}
