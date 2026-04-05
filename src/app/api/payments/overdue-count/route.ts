import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 })

  const { data: plans } = await supabase
    .from('payment_plans')
    .select('id')
    .eq('owner_id', user.id)

  if (!plans || plans.length === 0) return NextResponse.json({ count: 0 })

  const today = new Date().toISOString().split('T')[0]
  const { count } = await supabase
    .from('scheduled_payments')
    .select('id', { count: 'exact', head: true })
    .in('plan_id', plans.map((p: { id: string }) => p.id))
    .eq('status', 'pending')
    .lt('due_date', today)

  return NextResponse.json({ count: count ?? 0 })
}
