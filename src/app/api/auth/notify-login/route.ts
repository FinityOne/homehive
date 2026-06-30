import { notifyAdmin } from '@/lib/notifyAdmin'

// Fire-and-forget admin notification on successful login. Called by the login
// page after OTP verification. Never blocks or breaks the sign-in flow.
export async function POST(req: Request) {
  const { name, email, role } = await req.json().catch(() => ({}))
  if (!email) return Response.json({ ok: true })

  const roleLabel = role === 'landlord' ? 'Landlord' : role === 'admin' ? 'Admin' : 'Student / Renter'

  await notifyAdmin({
    event: 'Login',
    subject: `Login: ${name || email} (${roleLabel})`,
    headline: `${name || email} just signed in.`,
    rows: [
      { label: 'Name', value: name || '—' },
      { label: 'Email', value: email },
      { label: 'Role', value: roleLabel },
    ],
    ctaLabel: 'View users',
    ctaPath: '/admin/users',
    accent: '#1d4ed8',
  })

  return Response.json({ ok: true })
}
