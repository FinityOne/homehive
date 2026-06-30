/**
 * GET /api/cron/archive-stale-listings
 * Vercel Cron — runs daily. Archives listings inactive for 30+ days (no new
 * leads, no landlord edits), warning the landlord ~3 days beforehand. Archived
 * listings drop off the public home/browse pages until re-activated.
 *
 * vercel.json: { "path": "/api/cron/archive-stale-listings", "schedule": "0 16 * * *" }
 * Secure with CRON_SECRET.
 */
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { NextRequest } from 'next/server'
import { getSiteUrl } from '@/lib/siteUrl'
import { buildArchiveWarningEmail, buildArchivedEmail } from '@/lib/archiveEmails'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const resend = new Resend(process.env.RESEND_API_KEY!)

// Warn after 27 inactive days, then archive 3 days later (~30 days total) unless
// activity resumes. After a warning is set we anchor on archive_warned_at rather
// than updated_at — a DB trigger bumps updated_at on every write (including this
// cron's own warn-write), so updated_at can't be trusted as the clock post-warn.
const WARN_DAYS = 27
const GRACE_DAYS = 3
const DAY_MS = 86400000

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Live, non-test listings that aren't already archived
  const { data: props, error } = await supabaseAdmin
    .from('properties')
    .select('id, slug, name, owner_id, updated_at, created_at, archive_warned_at')
    .eq('is_active', true)
    .eq('admin_status', 'active')
    .eq('is_test', false)
    .is('archived_at', null)

  if (error) return Response.json({ error: 'Failed to load listings' }, { status: 500 })
  if (!props || props.length === 0) return Response.json({ archived: 0, warned: 0, scanned: 0 })

  // Latest lead per property slug = freshest "lead activity" signal
  const slugs = props.map(p => p.slug).filter(Boolean) as string[]
  const latestLeadBySlug: Record<string, number> = {}
  if (slugs.length > 0) {
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('property, created_at')
      .in('property', slugs)
    for (const l of leads || []) {
      if (!l.property || !l.created_at) continue
      const t = new Date(l.created_at).getTime()
      if (!latestLeadBySlug[l.property] || t > latestLeadBySlug[l.property]) latestLeadBySlug[l.property] = t
    }
  }

  // Resolve landlord emails/names in one batch
  const ownerIds = [...new Set(props.map(p => p.owner_id).filter(Boolean))] as string[]
  const profileById: Record<string, { email: string | null; name: string | null }> = {}
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, first_name')
      .in('id', ownerIds)
    for (const pr of profiles || []) {
      profileById[pr.id] = { email: pr.email ?? null, name: pr.full_name || pr.first_name || null }
    }
  }

  const now = Date.now()
  const manageUrl = `${getSiteUrl()}/landlord/listings`
  let archived = 0
  let warned = 0
  let reset = 0

  for (const p of props) {
    const prof = profileById[p.owner_id] || { email: null, name: null }
    const latestLead = latestLeadBySlug[p.slug] || 0
    const updatedAt = p.updated_at ? new Date(p.updated_at).getTime() : 0
    const createdAt = p.created_at ? new Date(p.created_at).getTime() : 0
    const warnedAt = p.archive_warned_at ? new Date(p.archive_warned_at).getTime() : 0

    if (warnedAt) {
      // In the grace window. Did real activity happen since the warning?
      // (a new lead, or a landlord edit that pushed updated_at past warn time)
      const activitySinceWarn = latestLead > warnedAt || updatedAt > warnedAt
      if (activitySinceWarn) {
        await supabaseAdmin.from('properties').update({ archive_warned_at: null }).eq('id', p.id)
        reset++
        continue
      }
      if (now - warnedAt >= GRACE_DAYS * DAY_MS) {
        await supabaseAdmin
          .from('properties')
          .update({ archived_at: new Date().toISOString(), archived_reason: 'auto_inactive_30d' })
          .eq('id', p.id)
        archived++
        if (prof.email) {
          const { subject, html } = buildArchivedEmail({ landlordName: prof.name, propertyName: p.name, manageUrl })
          try {
            await resend.emails.send({ from: 'HomeHive <hello@homehive.live>', to: prof.email, subject, html })
          } catch (e) { console.error('archived email failed', p.id, e) }
        }
      }
      continue
    }

    // Not warned yet — measure inactivity from the freshest real signal.
    const lastActivity = Math.max(updatedAt, createdAt, latestLead)
    const daysInactive = Math.floor((now - lastActivity) / DAY_MS)
    if (daysInactive >= WARN_DAYS) {
      await supabaseAdmin
        .from('properties')
        .update({ archive_warned_at: new Date().toISOString() })
        .eq('id', p.id)
      warned++
      if (prof.email) {
        const { subject, html } = buildArchiveWarningEmail({ landlordName: prof.name, propertyName: p.name, daysInactive, manageUrl })
        try {
          await resend.emails.send({ from: 'HomeHive <hello@homehive.live>', to: prof.email, subject, html })
        } catch (e) { console.error('warning email failed', p.id, e) }
      }
    }
  }

  return Response.json({ scanned: props.length, archived, warned, reset })
}
