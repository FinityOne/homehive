import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params

  const { data, error } = await supabaseAdmin
    .from('lead_notes')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: 'Failed to fetch notes' }, { status: 500 })

  return Response.json({ notes: data || [] })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()
  const content = body.content?.trim()

  if (!content) return Response.json({ error: 'content is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('lead_notes')
    .insert({ lead_id: leadId, content })
    .select()
    .single()

  if (error) return Response.json({ error: 'Failed to create note' }, { status: 500 })

  return Response.json({ note: data })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const body = await req.json()
  const { noteId, content } = body

  if (!noteId || !content?.trim()) {
    return Response.json({ error: 'noteId and content are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('lead_notes')
    .update({ content: content.trim(), updated_at: new Date().toISOString() })
    .eq('id', noteId)
    .eq('lead_id', leadId)
    .select()
    .single()

  if (error) return Response.json({ error: 'Failed to update note' }, { status: 500 })

  return Response.json({ note: data })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params
  const { searchParams } = new URL(req.url)
  const noteId = searchParams.get('noteId')

  if (!noteId) return Response.json({ error: 'noteId is required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('lead_notes')
    .delete()
    .eq('id', noteId)
    .eq('lead_id', leadId)

  if (error) return Response.json({ error: 'Failed to delete note' }, { status: 500 })

  return Response.json({ success: true })
}
