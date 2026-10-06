'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import PlanPicker from '@/components/billing/PlanPicker'
import { EMPTY_STATS, formatCount, formatFloor, type PlatformStats } from '@/lib/platformStats'

/**
 * The paywall a landlord lands on after signing up — and the only page on the
 * platform whose job is to be convincing.
 *
 * Three things do the persuading, in this order:
 *
 *   1. **One specific, verifiable number.** The most inquiries a single listing
 *      on HomeHive has taken. A landlord does not care about platform totals,
 *      they care what a property like theirs can pull. The number is read live
 *      from the database, never written down, so the page cannot drift into
 *      claims we would not stand behind.
 *
 *   2. **The focus, stated as the reason it works.** HomeHive is ASU and Tempe
 *      only this year. A landlord's instinct is that a smaller audience is
 *      worse, so the copy has to flip that: every renter here is looking for
 *      housing near campus, which is why the inquiry rate is what it is. Niche
 *      is the product, not a limitation.
 *
 *   3. **The full value stack.** The old page listed three reassurances and
 *      left the actual product — screening, tours, leases, rent collection,
 *      maintenance, move-out — entirely unmentioned, so a landlord was being
 *      asked to pay for "a listing". Naming everything is what makes the price
 *      look small rather than arbitrary.
 *
 * Objections are answered inline rather than in a FAQ nobody opens: cancel any
 * time, students pay nothing, no per-lead fees, and nothing is charged until a
 * plan is chosen.
 */

type PlanState = {
  planType: string | null
  hasAccess: boolean
  propertyCount: number
}

/** Shown while the real numbers load, so the layout never jumps. */
function StatCard({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e8e4db', borderRadius: 12,
      padding: '18px 18px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 30, fontWeight: 800, color: '#8C1D40', letterSpacing: '-1px', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1a1a1a', marginTop: 7, lineHeight: 1.35 }}>
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: '#9b9b9b', marginTop: 4, lineHeight: 1.45 }}>{hint}</div>
      )}
    </div>
  )
}

const VALUE_STACK: Array<[string, string, string]> = [
  ['🎯', 'Students who can actually sign',
   'ASU and Tempe only. Every renter browsing HomeHive is looking for housing near campus this year — not a general rental audience you have to filter down.'],
  ['∞', 'Every inquiry is yours',
   'No per-lead charges and nothing to unlock. However many students ask about your place, you get all of them with full contact details.'],
  ['🛡️', 'Screening and background checks',
   'Credit and background checks, employment and landlord reference verification, co-signer handling, and income-to-rent scoring on every applicant.'],
  ['📅', 'Tours students book themselves',
   'Publish your availability and let students pick a slot. Confirmations, calendar invites and reminders go out without you sending a message.'],
  ['📝', 'Leases and e-signature',
   'Generate the lease, send it for signature, and keep every document on the tenancy record.'],
  ['💳', 'Online rent collection',
   'Card and bank payments, automatic receipts, late-fee rules, and reminders before rent is due.'],
  ['🔧', 'Maintenance and move-out',
   'Track work orders and costs per property, then run move-out inspections with per-tenant charge splits and deposit reconciliation.'],
  ['📊', 'Know what is working',
   'Per-property lead funnels, inquiry trends, and a money view by property and lease.'],
]

function SubscribeInner() {
  const router = useRouter()
  const params = useSearchParams()
  const canceled = params.get('canceled') === '1'
  // Tenants approved for landlord access arrive with ?from=upgrade, so the page
  // can greet the handover instead of reading as a wall they hit by accident.
  const fromUpgrade = params.get('from') === 'upgrade'

  const [state, setState] = useState<PlanState | null>(null)
  const [stats, setStats] = useState<PlatformStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = 'Choose your plan — HomeHive' }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login?next=/landlord/subscribe'); return }

      const res = await fetch('/api/landlord/plan')
      if (!res.ok) { if (!cancelled) setLoading(false); return }
      const data = await res.json()
      if (cancelled) return

      // Already paying — nothing to sell them here.
      if (data.hasAccess) { router.replace('/landlord/dashboard'); return }
      setState(data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [router])

  // Stats are decoration on a page that must render regardless, so they load
  // separately and failure is silent — the blocks just do not appear.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/platform-stats')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStats(data as PlatformStats)
      } catch { /* leave EMPTY_STATS */ }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '80px 24px', textAlign: 'center', color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif" }}>
        Loading…
      </div>
    )
  }

  const hasStats = stats.topListingLeads > 0 || stats.distinctRenters > 0 || stats.siteVisits > 0

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '36px 24px 80px', fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── HERO ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{
          display: 'inline-block', background: '#8C1D40', color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
          padding: '5px 13px', borderRadius: 20, marginBottom: 16,
        }}>
          ASU &amp; Tempe only · 2026–27
        </div>
        <h1 style={{ margin: 0, fontSize: 33, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-1px', lineHeight: 1.18 }}>
          {fromUpgrade
            ? 'You’re approved. Now get your place in front of students.'
            : 'Put your place in front of students who are actually looking'}
        </h1>
        <p style={{ margin: '12px auto 0', fontSize: 15, color: '#5a5a5a', lineHeight: 1.7, maxWidth: 600 }}>
          HomeHive is built for one rental market: students near ASU in Tempe. Your
          listing is not competing for attention across a whole metro — it reaches
          the renters who can sign a lease near campus. Pick a plan and your listing
          goes live immediately, with no review queue to wait on.
        </p>
      </div>

      {canceled && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10,
          padding: '12px 16px', fontSize: 13, color: '#92400e', marginBottom: 20, textAlign: 'center',
        }}>
          Checkout was cancelled — nothing was charged. Pick a plan whenever you are ready.
        </div>
      )}

      {fromUpgrade && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
          padding: '12px 16px', fontSize: 13, color: '#166534', marginBottom: 20, textAlign: 'center',
        }}>
          Your landlord access is approved — this is the last step before you can publish.
        </div>
      )}

      {/* ── PROOF: real numbers, read live ── */}
      {hasStats && (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12, marginBottom: 10,
          }}>
            {stats.topListingLeads > 0 && (
              <StatCard
                value={formatCount(stats.topListingLeads)}
                label="Inquiries on our top listing"
                hint="The most a single HomeHive listing has received"
              />
            )}
            {stats.distinctRenters > 0 && (
              <StatCard
                value={formatFloor(stats.distinctRenters)}
                label="Renters who have inquired"
                hint="Students searching near ASU and Tempe"
              />
            )}
            {stats.siteVisits > 0 && (
              <StatCard
                value={formatFloor(stats.siteVisits)}
                label="Listing views"
                hint="Students browsing homes on HomeHive"
              />
            )}
            {stats.tours > 0 && (
              <StatCard
                value={formatCount(stats.tours)}
                label="Tours booked"
                hint="Scheduled through HomeHive, not over text"
              />
            )}
          </div>
          <p style={{
            fontSize: 11.5, color: '#9b9b9b', textAlign: 'center', margin: '0 0 30px', lineHeight: 1.6,
          }}>
            Counted live from the platform, not estimates. Your own results depend on your
            price, photos and how close you are to campus — these are what the demand side
            looks like today.
          </p>
        </>
      )}

      {/* ── THE PLANS ── */}
      {state && state.propertyCount > 0 && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
          padding: '12px 16px', fontSize: 13, color: '#1d4ed8', marginBottom: 20, textAlign: 'center',
        }}>
          You already have {state.propertyCount} propert{state.propertyCount === 1 ? 'y' : 'ies'} set
          up — choose a plan that covers {state.propertyCount === 1 ? 'it' : 'them all'} and
          {state.propertyCount === 1 ? ' it goes' : ' they go'} live right away.
        </div>
      )}

      <PlanPicker currentTier={null} propertyCount={state?.propertyCount ?? 0} />

      {/* ── VALUE STACK ── */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{
          margin: '0 0 6px', fontSize: 21, fontWeight: 800, color: '#1a1a1a',
          letterSpacing: '-0.5px', textAlign: 'center',
        }}>
          Every plan is the whole platform
        </h2>
        <p style={{
          margin: '0 auto 22px', fontSize: 13.5, color: '#6b6b6b', textAlign: 'center',
          maxWidth: 560, lineHeight: 1.65,
        }}>
          Paying more only raises how many properties you can list. Nothing below is an
          add-on, an upsell, or locked to a higher tier.
        </p>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 12,
        }}>
          {VALUE_STACK.map(([icon, title, body]) => (
            <div key={title} style={{
              background: '#fff', border: '1px solid #e8e4db', borderRadius: 12, padding: '16px 18px',
            }}>
              <div style={{ fontSize: 19, marginBottom: 8, lineHeight: 1 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 5 }}>{title}</div>
              <div style={{ fontSize: 12.8, color: '#5a5a5a', lineHeight: 1.6 }}>{body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── OBJECTIONS ── */}
      <div style={{
        marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12, fontSize: 12.5, color: '#6b6b6b',
      }}>
        {[
          ['Cancel any time', 'Month to month. Cancel from your billing page and you keep access until the period ends.'],
          ['Students pay nothing', 'Renters use HomeHive free, which is why there are renters here. Your plan is the only fee on the platform.'],
          ['No per-lead charges', 'Every inquiry on your properties is yours — there is nothing to unlock and no commission on a signed lease.'],
          ['Live immediately', 'No approval queue. Your listing publishes the moment your plan is active, and you can edit or unpublish it whenever.'],
        ].map(([title, body]) => (
          <div key={title} style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, color: '#1a1a1a', marginBottom: 4, fontSize: 13 }}>{title}</div>
            <div style={{ lineHeight: 1.55 }}>{body}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 28, fontSize: 13, color: '#9b9b9b' }}>
        Questions first?{' '}
        <a href="mailto:landlord@homehive.live" style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>
          landlord@homehive.live
        </a>
      </div>
    </div>
  )
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeInner />
    </Suspense>
  )
}
