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
    body: `Hey {{first_name}}! Just saw your inquiry — here's the full listing for {{property_name}}: {{listing_link}} Let me know if you have any questions!`,
  },
  {
    name: 'Quick Intro',
    category: 'First Touch',
    position: 1,
    body: `Hey {{first_name}}! Just following up on {{property_name}}. Happy to answer any questions — when are you looking to move?`,
  },
  {
    name: 'Listing Link Reminder',
    category: 'First Touch',
    position: 2,
    body: `Hey {{first_name}}, here's the link to the place: {{listing_link}} — let me know what you think!`,
  },
  {
    name: 'First Follow-up',
    category: 'Follow-Up',
    position: 3,
    body: `Hey {{first_name}}, just following up — still have availability for your move-in window at {{property_name}}. Is this still on your radar?`,
  },
  {
    name: 'Second Follow-up',
    category: 'Follow-Up',
    position: 4,
    body: `Hey {{first_name}}, just checking in on {{property_name}} — spots are going fast for that timeframe. Still interested?`,
  },
  {
    name: 'Pre-screen Nudge',
    category: 'Follow-Up',
    position: 5,
    body: `Hey {{first_name}}! Next step for {{property_name}} is a quick 2-min pre-screen — it takes most people under 2 minutes and puts you at the top of the list. Check your email for the link, or reply here and I'll resend it!`,
  },
  {
    name: 'Cold Re-engagement',
    category: 'Follow-Up',
    position: 6,
    body: `Hey {{first_name}}, just wanted to check if you're still searching for housing — here's the link to {{property_name}} in case it's helpful: {{listing_link}}`,
  },
  {
    name: 'Tour Invitation',
    category: 'Tour',
    position: 7,
    body: `Hey {{first_name}}! Would love to show you {{property_name}} in person — here's the listing: {{listing_link}} Free for a tour this week?`,
  },
  {
    name: 'Tour Confirmation',
    category: 'Tour',
    position: 8,
    body: `Hey {{first_name}}, just confirming your tour at {{property_name}} is set! Any questions before then? See you soon 🙌`,
  },
  {
    name: 'Day-of Tour Reminder',
    category: 'Tour',
    position: 9,
    body: `Hey {{first_name}}, excited to show you the place today! Let me know if anything comes up. See you soon!`,
  },
  {
    name: 'Post-tour Thank You',
    category: 'Tour',
    position: 10,
    body: `Hey {{first_name}}, great meeting you {{tour_date}}! Hope you loved the place. Any questions, or ready to move forward?`,
  },
  {
    name: 'Post-tour Follow-up',
    category: 'Tour',
    position: 11,
    body: `Hey {{first_name}}, just following up from your visit {{tour_date}} — what did you think? A few other people have been asking about it, so wanted to give you first shot if you're still in!`,
  },
  {
    name: 'General Check-in',
    category: 'Check-In',
    position: 12,
    body: `Hey {{first_name}}! Just checking in — how's the housing search going? Still interested in {{property_name}}?`,
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
