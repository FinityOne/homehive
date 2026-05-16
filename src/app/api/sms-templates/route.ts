import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const DEFAULT_TEMPLATES = [
  {
    name: 'Initial Welcome',
    category: 'First Touch',
    position: 0,
    body: `Hey {{first_name}}! This is {{your_name}} 🏠 Thanks for your interest in {{property_name}}! I wanted to personally reach out and see if you have any questions. Here's the full listing: {{listing_link}} — looking forward to hearing from you!`,
  },
  {
    name: 'Quick Intro',
    category: 'First Touch',
    position: 1,
    body: `Hi {{first_name}}, I'm {{your_name}} — you recently inquired about {{property_name}}. Happy to answer any questions! When are you looking to move?`,
  },
  {
    name: 'Listing Link Reminder',
    category: 'First Touch',
    position: 2,
    body: `Hi {{first_name}}! Quick reminder — here's the full listing for {{property_name}} with all the details and photos: {{listing_link}} Let me know if anything catches your eye 🙌`,
  },
  {
    name: 'First Follow-up',
    category: 'Follow-Up',
    position: 3,
    body: `Hey {{first_name}}, just following up on your inquiry for {{property_name}}. We still have availability for your move-in window and would love to get you set up. Is this spot still on your radar?`,
  },
  {
    name: 'Second Follow-up',
    category: 'Follow-Up',
    position: 4,
    body: `{{first_name}}, still thinking about {{property_name}}? Rooms are going quick for that timeframe — just wanted to check in before we fill up. Happy to answer any questions!`,
  },
  {
    name: 'Pre-screen Nudge',
    category: 'Follow-Up',
    position: 5,
    body: `Hey {{first_name}}! We'd love to move you forward on {{property_name}}. The next step is a quick 2-min pre-screen — completing it puts you at the top of our list and most applicants hear back within 24 hours. Check your email for the link, or reply here and I'll resend it!`,
  },
  {
    name: 'Cold Re-engagement',
    category: 'Follow-Up',
    position: 6,
    body: `Hi {{first_name}}, {{your_name}} here — I know it's been a while since you inquired about {{property_name}}! Just wanted to check if your housing search is still active. We've had some updates and would love to reconnect if you're still looking. Here's the listing: {{listing_link}}`,
  },
  {
    name: 'Tour Invitation',
    category: 'Tour',
    position: 7,
    body: `Hi {{first_name}}! Based on your interest in {{property_name}}, I think you'd really love seeing it in person. Check out the listing: {{listing_link}} — are you available for a quick tour this week? I have a few open slots and can be flexible!`,
  },
  {
    name: 'Tour Confirmation',
    category: 'Tour',
    position: 8,
    body: `Hey {{first_name}}, just confirming your tour at {{property_name}} is locked in! Looking forward to meeting you. Any questions before then? See you soon 🏠`,
  },
  {
    name: 'Day-of Tour Reminder',
    category: 'Tour',
    position: 9,
    body: `Hi {{first_name}}, excited to see you today for the tour at {{property_name}}! Let me know if anything comes up. See you soon!`,
  },
  {
    name: 'Post-tour Thank You',
    category: 'Tour',
    position: 10,
    body: `Hi {{first_name}}, it was great meeting you {{tour_date}} at {{property_name}}! I hope you loved the space as much as I enjoyed showing it. Any questions, or are you ready to take the next step?`,
  },
  {
    name: 'Post-tour Follow-up',
    category: 'Tour',
    position: 11,
    body: `Hey {{first_name}}, following up from your visit to {{property_name}} {{tour_date}}. Just wanted to check in and see what you thought! We had a few other inquiries come in and wanted to give you first shot if you're still interested. Where are you at? 🙌`,
  },
  {
    name: 'General Check-in',
    category: 'Check-In',
    position: 12,
    body: `Hey {{first_name}}! Quick check-in from {{your_name}} — how's the housing search going? Still interested in {{property_name}}? Happy to chat whenever!`,
  },
]

async function getAuthedUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null
  return user
}

export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing, error } = await supabaseAdmin
    .from('sms_templates')
    .select('*')
    .eq('landlord_id', user.id)
    .order('position', { ascending: true })

  if (error) return Response.json({ error: 'Failed to fetch templates' }, { status: 500 })

  // Seed defaults if this landlord has no templates yet
  if (!existing || existing.length === 0) {
    const toInsert = DEFAULT_TEMPLATES.map(t => ({ ...t, landlord_id: user.id }))
    const { data: seeded, error: seedErr } = await supabaseAdmin
      .from('sms_templates')
      .insert(toInsert)
      .select()
    if (seedErr) return Response.json({ error: 'Failed to seed templates' }, { status: 500 })
    return Response.json({ templates: seeded.sort((a, b) => a.position - b.position) })
  }

  return Response.json({ templates: existing })
}
