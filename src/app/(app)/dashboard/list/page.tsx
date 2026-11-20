'use client'

/**
 * "List your place" — where a renter asks to become a landlord.
 *
 * Four states, and the old page treated them as four tinted boxes of roughly
 * equal weight: no request yet, under review, not approved, already approved.
 * Each one wants something different from the reader, so each now leads with
 * the one sentence that tells them where they stand and offers exactly one
 * next step.
 *
 * Two small honesty fixes while restyling it:
 *   • The browser tab said "My Applications". This page is not applications;
 *     it is a request for landlord access, and a tab title that names a
 *     different feature is how somebody loses the page in a sea of tabs.
 *   • The pending state claimed a 24-hour review turnaround as a fact. It now
 *     says what we actually commit to — that we email either way — because an
 *     unmet promise on this screen is the first thing a landlord experiences
 *     of the product.
 */

import { useEffect, useState } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Icon, { type IconName } from '@/components/NavIcons'
import { TenantStyles, PageHead, PageSkeleton } from '@/components/tenant/TenantFrame'

type UpgradeStatus = 'pending' | 'approved' | 'rejected'
type UpgradeRequest = { id: string; status: UpgradeStatus; admin_note: string | null }

/** What a landlord gets. Stated as facts about the product, not as adjectives. */
const BENEFITS: { icon: IconName; text: string }[] = [
  { icon: 'target', text: 'ASU and Tempe renters only — people who can actually sign a lease' },
  { icon: 'users', text: 'Every inquiry is yours. No per-lead fees, no commission on a signed lease' },
  { icon: 'shieldCheck', text: 'Screening, background and reference checks built into the flow' },
  { icon: 'creditCard', text: 'Tours, leases, rent collection and receipts in one portal' },
  { icon: 'building', text: 'Works for a whole home, a single room, or a sublease' },
]

export default function ListYourPlacePage() {
  const router = useRouter()

  const [userRole, setUserRole] = useState('')
  const [upgradeRequest, setUpgradeRequest] = useState<UpgradeRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { document.title = 'List your place — My Portal | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser()
      if (!user) { router.push('/login'); return }

      const [profileRes, upgradeRes] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', user.id).single(),
        supabase.from('upgrade_requests')
          .select('id, status, admin_note')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      setUserRole(profileRes.data?.role || 'tenant')
      if (upgradeRes.data) setUpgradeRequest(upgradeRes.data as UpgradeRequest)
      setLoading(false)
    }
    load()
  }, [router])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/upgrade-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (res.ok) {
        const data = await res.json()
        setUpgradeRequest({ id: data.id, status: 'pending', admin_note: null })
        setShowForm(false)
        setMessage('')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — please try again. Nothing was sent.')
    }
    setSubmitting(false)
  }

  if (loading) return <><TenantStyles css={CSS} /><PageSkeleton panel={false} cards={3} /></>

  /** The request form, shared by the first-time and try-again paths. */
  const form = (
    <div className="tp-card">
      <div className="tp-card-bd">
        <label className="tp-label" htmlFor="lp-msg">
          Anything you want to tell us? (optional)
        </label>
        <textarea
          id="lp-msg"
          className="tp-textarea"
          placeholder="What you have — a house, a room, a sublease — and where it is. One or two lines is plenty."
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        {error && <div className="tp-note bad" style={{ marginTop: 12 }} role="alert">{error}</div>}
      </div>
      <div className="tp-card-ft lp-ft">
        <button className="tp-btn tp-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? 'Sending…' : 'Send request'}
        </button>
        <button
          className="tp-btn tp-btn-secondary"
          onClick={() => { setShowForm(false); setMessage(''); setError('') }}
        >
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <>
      <TenantStyles css={CSS} />
      <div className="tp tp-wrap narrow">
        <PageHead
          back={{ href: '/dashboard', label: 'Home' }}
          title="List your place"
          lede="Reach students searching for housing near ASU in Tempe. Every inquiry is yours, with no per-lead fees."
        />

        {/* ── ALREADY APPROVED ─────────────────────────────────────────────
            Into the work, not into the price. The listing builder is free, so
            sending them to checkout first would ask for a card before they
            have anything to publish. ── */}
        {userRole === 'landlord' ? (
          <>
            <div className="lp-state paid">
              <span className="lp-state-ic"><Icon name="checkCircle" size={19} /></span>
              <div>
                <div className="lp-state-t">You&apos;re approved as a landlord</div>
                <div className="lp-state-b">
                  Building the listing is free and there is no review queue. A plan is what
                  publishes it to students and switches on leads, tours, screening and rent.
                </div>
              </div>
            </div>
            <div className="lp-actions">
              <Link href="/landlord/listings/new" className="tp-btn tp-btn-primary lg">
                Add my place — free
              </Link>
              <Link href="/landlord/subscribe?from=upgrade" className="tp-btn tp-btn-secondary lg">
                See the plans first
              </Link>
            </div>
          </>

        /* ── UNDER REVIEW ─────────────────────────────────────────────────── */
        ) : upgradeRequest?.status === 'pending' ? (
          <>
            <div className="lp-state fee">
              <span className="lp-state-ic"><Icon name="clock" size={19} /></span>
              <div>
                <div className="lp-state-t">Your request is in review</div>
                <div className="lp-state-b">
                  We have it. Somebody reads every one of these by hand, and we email you either
                  way — approved or not — so there is nothing you need to chase.
                </div>
              </div>
            </div>
            <div className="tp-card">
              <div className="tp-card-hd">
                <span className="tp-card-title">While you wait</span>
              </div>
              <div className="tp-card-bd">
                <div className="tp-muted">
                  Have a look at how the listings students actually reply to are put together —
                  photos, room-by-room rent, and the distance to campus stated plainly.
                </div>
              </div>
              <div className="tp-card-ft">
                <Link href="/homes" className="tp-btn tp-btn-secondary">Browse live listings</Link>
              </div>
            </div>
          </>

        /* ── NOT APPROVED ─────────────────────────────────────────────────── */
        ) : upgradeRequest?.status === 'rejected' ? (
          <>
            <div className="lp-state owed">
              <span className="lp-state-ic"><Icon name="info" size={19} /></span>
              <div>
                <div className="lp-state-t">This request wasn&apos;t approved</div>
                {upgradeRequest.admin_note && (
                  <div className="lp-reason">
                    <strong>Why:</strong> {upgradeRequest.admin_note}
                  </div>
                )}
                <div className="lp-state-b">
                  You can send another one — if something has changed, say so and it will be read
                  fresh. Questions:{' '}
                  <a href="mailto:hello@homehive.live">hello@homehive.live</a>.
                </div>
              </div>
            </div>
            {!showForm ? (
              <button className="tp-btn tp-btn-primary lg" onClick={() => setShowForm(true)}>
                Send a new request
              </button>
            ) : form}
          </>

        /* ── NOTHING SENT YET ─────────────────────────────────────────────── */
        ) : (
          <>
            <div className="tp-card">
              <div className="tp-card-hd">
                <span className="tp-card-title">What you get</span>
              </div>
              <div className="tp-card-bd">
                {BENEFITS.map(b => (
                  <div key={b.text} className="lp-benefit">
                    <span className="lp-benefit-ic"><Icon name={b.icon} size={16} /></span>
                    <span>{b.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {!showForm ? (
              <>
                <button
                  className="tp-btn tp-btn-primary lg full"
                  onClick={() => setShowForm(true)}
                >
                  Request landlord access
                </button>
                <div className="tp-hint" style={{ marginTop: 10, textAlign: 'center' }}>
                  Free to ask, and free to build a listing. You only pay when you publish one.
                </div>
              </>
            ) : form}
          </>
        )}
      </div>
    </>
  )
}

const CSS = `
  /* ── A state card: one icon, one sentence that says where you stand, one
     paragraph of detail. The tone lives on the icon and the left edge, not as
     a wash behind the text — the text has to stay fully legible. ── */
  .lp-state { display: flex; gap: 13px; align-items: flex-start; background: var(--surface);
    border: 1px solid var(--line); border-left: 3px solid var(--idle);
    border-radius: var(--r); box-shadow: var(--shadow); padding: 17px 19px;
    margin-bottom: 16px; }
  .lp-state.paid { border-left-color: var(--paid); }
  .lp-state.fee  { border-left-color: var(--fee); }
  .lp-state.owed { border-left-color: var(--owed); }
  .lp-state-ic { flex-shrink: 0; width: 36px; height: 36px; border-radius: 11px;
    display: flex; align-items: center; justify-content: center; }
  .lp-state.paid .lp-state-ic { background: var(--paid-wash); color: var(--paid); }
  .lp-state.fee  .lp-state-ic { background: var(--fee-wash);  color: var(--fee); }
  .lp-state.owed .lp-state-ic { background: var(--owed-wash); color: var(--owed); }
  .lp-state-t { font-size: 15.5px; font-weight: 600; color: var(--ink);
    letter-spacing: -0.2px; }
  .lp-state-b { font-size: 13px; color: var(--ink-3); line-height: 1.6; margin-top: 5px; }
  .lp-state-b a { color: var(--primary); font-weight: 600; }
  .lp-reason { font-size: 12.5px; color: var(--owed); background: var(--owed-wash);
    border: 1px solid var(--owed-line); border-radius: var(--r-sm); padding: 9px 12px;
    margin-top: 9px; line-height: 1.55; }

  .lp-actions { display: flex; gap: 10px; flex-wrap: wrap; }

  .lp-benefit { display: flex; gap: 12px; align-items: flex-start; font-size: 13.5px;
    color: var(--ink-2); line-height: 1.55; padding: 10px 0;
    border-bottom: 1px solid var(--line-2); }
  .lp-benefit:last-child { border-bottom: none; padding-bottom: 0; }
  .lp-benefit:first-child { padding-top: 0; }
  .lp-benefit-ic { flex-shrink: 0; width: 30px; height: 30px; border-radius: 9px;
    background: var(--primary-wash); color: var(--primary);
    display: flex; align-items: center; justify-content: center; }

  .lp-ft { display: flex; gap: 9px; flex-wrap: wrap; }

  @media (max-width: 720px) {
    .lp-actions .tp-btn, .lp-ft .tp-btn { width: 100%; }
  }
`
