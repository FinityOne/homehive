import { createClient } from '@supabase/supabase-js'
import { resolveReferenceEmail } from '@/lib/referenceEmailContext'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getLandlordUser(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user ?? null
}

// Returns the exact rendered email (subject + html) that would be sent for a
// reference, so the landlord can review it before confirming. Sends nothing.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ checkId: string }> }
) {
  const { checkId } = await params
  const user = await getLandlordUser(req)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { refId } = await req.json()

  const resolved = await resolveReferenceEmail(supabaseAdmin, checkId, refId, user.id, user.email)
  if (!resolved.ok) return Response.json({ error: resolved.error }, { status: resolved.status })

  const { built, recipient, recipientName, refType } = resolved.data
  return Response.json({
    subject: built.subject,
    html: built.html,
    recipient,
    recipientName,
    refType,
  })
}
