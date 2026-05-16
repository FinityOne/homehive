import { createClient } from '@supabase/supabase-js'

// Service role key bypasses RLS — ownership check is done manually below
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ propertyId: string; roomId: string }> }
) {
  const { propertyId, roomId } = await params
  const { url, ownerId } = await req.json() as { url: string; ownerId: string }

  if (!ownerId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the caller owns this property
  const { data: prop } = await supabase
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('owner_id', ownerId)
    .single()

  if (!prop) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Find the max position for existing images on this room
  const { data: existing } = await supabase
    .from('property_images')
    .select('position')
    .eq('property_id', propertyId)
    .eq('room_id', roomId)
    .order('position', { ascending: false })
    .limit(1)

  const maxPos = existing && existing.length > 0 ? existing[0].position : -1
  const position = maxPos + 1

  const { error: insError } = await supabase
    .from('property_images')
    .insert({ property_id: propertyId, room_id: roomId, url, position })

  if (insError) {
    console.error('room image insert error:', insError)
    return Response.json({ error: 'Failed to save image' }, { status: 500 })
  }

  return Response.json({ success: true })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ propertyId: string; roomId: string }> }
) {
  const { propertyId, roomId } = await params
  const { url, ownerId } = await req.json() as { url: string; ownerId: string }

  if (!ownerId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the caller owns this property
  const { data: prop } = await supabase
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('owner_id', ownerId)
    .single()

  if (!prop) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: delError } = await supabase
    .from('property_images')
    .delete()
    .eq('property_id', propertyId)
    .eq('room_id', roomId)
    .eq('url', url)

  if (delError) {
    console.error('room image delete error:', delError)
    return Response.json({ error: 'Failed to delete image' }, { status: 500 })
  }

  return Response.json({ success: true })
}
