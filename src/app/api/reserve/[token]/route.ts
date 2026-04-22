import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: reservation, error } = await supabaseAdmin
    .from('lead_reservations')
    .select(`
      *,
      properties ( name, address, price ),
      property_rooms ( name, price )
    `)
    .eq('accept_token', token)
    .single()

  if (error || !reservation) {
    return Response.json({ error: 'Reservation not found' }, { status: 404 })
  }

  // Check if expired
  const now = new Date()
  const expiresAt = new Date(reservation.expires_at)
  if (now > expiresAt && reservation.status === 'pending') {
    await supabaseAdmin
      .from('lead_reservations')
      .update({ status: 'expired' })
      .eq('accept_token', token)
    reservation.status = 'expired'
  }

  return Response.json({ reservation })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: reservation, error } = await supabaseAdmin
    .from('lead_reservations')
    .select('*')
    .eq('accept_token', token)
    .single()

  if (error || !reservation) {
    return Response.json({ error: 'Reservation not found' }, { status: 404 })
  }

  if (reservation.status !== 'pending') {
    return Response.json({ error: `Reservation is ${reservation.status}` }, { status: 409 })
  }

  const now = new Date()
  if (now > new Date(reservation.expires_at)) {
    await supabaseAdmin
      .from('lead_reservations')
      .update({ status: 'expired' })
      .eq('accept_token', token)
    return Response.json({ error: 'Reservation has expired' }, { status: 410 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('lead_reservations')
    .update({ status: 'accepted', accepted_at: now.toISOString() })
    .eq('accept_token', token)

  if (updateErr) return Response.json({ error: 'Failed to accept reservation' }, { status: 500 })

  return Response.json({ success: true })
}
