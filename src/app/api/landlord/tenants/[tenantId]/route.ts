/**
 * GET /api/landlord/tenants/[tenantId]
 *
 * One tenant's whole file, in one request: their leases and the documents on
 * them, every rent charge with how it was settled, every payment attempt
 * including the ones that bounced, every email they have been sent and what
 * became of it, their co-signers, their screening, and whether they have ever
 * managed to sign in.
 *
 * Service role, after proving the tenant belongs to the caller. Parts of this
 * are not readable by a browser at all — see `tenantDossierServer.ts`.
 */
import { NextRequest } from 'next/server'
import {
  dossierAdmin, loadTenantContext, loadCosigners, loadDossierExtras,
  type Dossier,
} from '@/lib/tenantDossierServer'

export async function GET(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const db = dossierAdmin()
  const { data: { user }, error: authErr } = await db.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Admins manage landlord accounts and are not customers of the plan, so they
  // see the same record — the same rule the portal shell applies.
  const { data: profile } = await db
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'

  const ctxResult = await loadTenantContext(tenantId, user.id, isAdmin)
  if (!ctxResult.ok) {
    return Response.json({ error: ctxResult.error }, { status: ctxResult.status })
  }
  const { tenant, leases, payers } = ctxResult

  const [{ checks, cosigners }, extras] = await Promise.all([
    loadCosigners(tenant),
    loadDossierExtras(tenant, payers, leases),
  ])

  const dossier: Dossier = {
    tenant,
    linkage: {
      payers: payers.length,
      matchedBy: [...new Set(payers.map(p => p.matchedBy))],
    },
    leases,
    payers,
    checks,
    cosigners,
    ...extras,
  }

  return Response.json(dossier)
}
