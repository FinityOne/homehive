import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getLandlordId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const token = auth.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user?.id ?? null
}

function parseBudget(budgetLabel: string): { budget_min: number | null; budget_max: number | null } {
  if (!budgetLabel) return { budget_min: null, budget_max: null }
  if (budgetLabel === 'Under $650') return { budget_min: 0, budget_max: 650 }
  if (budgetLabel === '$650–$850') return { budget_min: 650, budget_max: 850 }
  if (budgetLabel === '$850–$1,100') return { budget_min: 850, budget_max: 1100 }
  if (budgetLabel === '$1,100+') return { budget_min: 1100, budget_max: null }
  return { budget_min: null, budget_max: null }
}

function parseRoommates(val: string | number): number {
  if (val === '3+') return 3
  const n = parseInt(String(val), 10)
  return isNaN(n) ? 1 : n
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { first_name, last_name, email, grad_semester } = body as Record<string, string>

  if (!first_name?.trim()) return Response.json({ error: 'first_name is required' }, { status: 400 })
  if (!last_name?.trim()) return Response.json({ error: 'last_name is required' }, { status: 400 })
  if (!email?.trim()) return Response.json({ error: 'email is required' }, { status: 400 })
  if (!grad_semester?.trim()) return Response.json({ error: 'grad_semester is required' }, { status: 400 })

  const { budget_min, budget_max } = parseBudget((body.budget as string) || '')

  const { data, error } = await supabaseAdmin
    .from('roommate_profiles')
    .insert([{
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email.trim().toLowerCase(),
      phone: (body.phone as string) || null,
      grad_semester: grad_semester.trim(),
      major: (body.major as string) || null,
      housing_type: (body.housing_type as string) || null,
      move_in_month: (body.move_in_month as string) || null,
      budget_min,
      budget_max,
      roommates_wanted: body.roommates_wanted != null ? parseRoommates(body.roommates_wanted as string) : 1,
      sleep_schedule: (body.sleep_schedule as string) || null,
      cleanliness: (body.cleanliness as string) || null,
      noise_preference: (body.noise_preference as string) || null,
      guests_frequency: (body.guests_frequency as string) || null,
      pets: (body.pets as string) || null,
      smoking: (body.smoking as string) || null,
      work_from_home: (body.work_from_home as string) || null,
      gender_preference: (body.gender_preference as string) || 'any',
      about_me: (body.about_me as string) || null,
      status: 'active',
    }])
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true, id: data.id })
}

export async function GET(req: Request) {
  const landlordId = await getLandlordId(req)
  if (!landlordId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('roommate_profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ profiles: data || [] })
}
