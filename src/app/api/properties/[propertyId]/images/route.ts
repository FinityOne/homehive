import { createClient } from '@supabase/supabase-js'

// Service role key bypasses RLS — ownership check is done manually below
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const { propertyId } = await params
  const { images, ownerId } = await req.json() as { images: string[]; ownerId: string }

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

  // Delete existing images then re-insert
  const { error: delError } = await supabase
    .from('property_images')
    .delete()
    .eq('property_id', propertyId)

  if (delError) {
    console.error('property_images delete error:', delError)
    return Response.json({ error: 'Failed to update images' }, { status: 500 })
  }

  if (images.length > 0) {
    const { error: insError } = await supabase
      .from('property_images')
      .insert(images.map((url, position) => ({ property_id: propertyId, url, position })))

    if (insError) {
      console.error('property_images insert error:', insError)
      return Response.json({ error: 'Failed to save images' }, { status: 500 })
    }
  }

  return Response.json({ success: true })
}
