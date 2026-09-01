'use client'

import '@/styles/brand-tokens.css'
import { useState, use, useEffect, useRef, useCallback } from 'react'
import { usePostHog } from 'posthog-js/react'
import { supabase } from '@/lib/supabase'
import { getPropertyBySlug, Property } from '@/lib/properties'
import { getFaqsByPropertyId, PropertyFaq } from '@/lib/faqs'
import { acceptsInquiries, acceptsWaitlist } from '@/lib/listingStatus'
import { notFound } from 'next/navigation'
import PhoneInput from '@/components/ui/PhoneInput'
import SaveButton from '@/components/SaveButton'
import { identifyVisitor } from '@/lib/visitorId'

// Platform-wide amenity icons mapped to common tag keywords
const TAG_ICONS: Record<string, string> = {
  wifi: '⚡', internet: '⚡', 'high-speed': '⚡',
  washer: '🧺', laundry: '🧺', 'in-unit': '🧺',
  ac: '❄️', 'air conditioning': '❄️', heat: '❄️',
  parking: '🚗', garage: '🚗',
  pet: '🐾', pets: '🐾', 'pet friendly': '🐾',
  furnished: '🛋️', furniture: '🛋️',
  pool: '🏊', jacuzzi: '🛁', hottub: '🛁',
  gym: '💪', fitness: '💪',
  yard: '🌿', garden: '🌿', backyard: '🌿',
  dishwasher: '🍽️',
  balcony: '🏠', patio: '🏠',
  study: '📚',
}

function tagIcon(tag: string): string {
  const lower = tag.toLowerCase()
  for (const [key, icon] of Object.entries(TAG_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return '✓'
}

// Availability urgency config
function availabilityConfig(available: number, total: number) {
  if (available === 0) return { color: '#6b7280', bg: '#f3f4f6', text: 'Join waitlist', urgent: false }
  if (available === 1) return { color: '#dc2626', bg: '#fef2f2', text: '⚡ Last room — act fast', urgent: true }
  if (available === 2) return { color: '#d97706', bg: '#fffbeb', text: `⚠ Only 2 rooms left`, urgent: true }
  return { color: '#16a34a', bg: '#f0fdf4', text: `${available} of ${total} rooms available`, urgent: false }
}

export default function PropertyPageClient({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ name?: string; msg?: string; from?: string }>
}) {
  const { slug } = use(params)
  const resolvedSearch = use(searchParams)

  // ── All hooks unconditionally at the top ─────────────────────────────────
  const [home, setHome] = useState<Property | null | undefined>(undefined)
  const [activePhoto, setActivePhoto] = useState(0)
  const [formData, setFormData] = useState({ first_name: '', email: '', phone: '', move_in_date: '' })
  const [loggedInUser, setLoggedInUser] = useState<{ id: string; name: string; email: string; phone: string; avatarUrl: string | null } | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittedLeadId, setSubmittedLeadId] = useState<string | null>(null)
  const [existingLead, setExistingLead] = useState<{ id: string; status: string } | null | undefined>(undefined)
  const [mobileFormOpen, setMobileFormOpen] = useState(false)
  const [showStickyBar, setShowStickyBar] = useState(false)
  const [badgeHover, setBadgeHover] = useState(false)
  const [landlordProfile, setLandlordProfile] = useState<{ first_name: string | null; avatar_url: string | null } | null>(null)
  const [recommended, setRecommended] = useState<{
    slug: string; name: string; address: string; price: number; beds: number; baths: number
    available: number; total_rooms: number; asu_distance: number; is_featured: boolean
    asu_score: number; rental_mode: string; cover: string | null
  }[]>([])
  const titleRef = useRef<HTMLDivElement>(null)
  const formStartedRef = useRef(false)
  const [roomLightbox, setRoomLightbox] = useState<{ images: string[]; index: number; roomName: string } | null>(null)
  const [comments, setComments] = useState<{ id: string; author_name: string; avatar_url: string | null; content: string; created_at: string }[]>([])
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [faqs, setFaqs] = useState<PropertyFaq[]>([])

  const openRoomLightbox = useCallback((images: string[], index: number, roomName: string) => {
    setRoomLightbox({ images, index, roomName })
  }, [])
  const closeRoomLightbox = useCallback(() => setRoomLightbox(null), [])
  const roomLbPrev = useCallback(() => setRoomLightbox(lb => lb ? { ...lb, index: (lb.index - 1 + lb.images.length) % lb.images.length } : lb), [])
  const roomLbNext = useCallback(() => setRoomLightbox(lb => lb ? { ...lb, index: (lb.index + 1) % lb.images.length } : lb), [])

  useEffect(() => {
    if (!roomLightbox) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') roomLbPrev()
      else if (e.key === 'ArrowRight') roomLbNext()
      else if (e.key === 'Escape') closeRoomLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [roomLightbox, roomLbPrev, roomLbNext, closeRoomLightbox])

  const ph = usePostHog()

  const guestName   = resolvedSearch?.name || ''
  const customMsg   = resolvedSearch?.msg  || ''
  const fromName    = resolvedSearch?.from || 'Heran'
  const isPersonalized = !!guestName

  useEffect(() => {
    getPropertyBySlug(slug).then(p => setHome(p ?? null))
  }, [slug])

  // Load FAQs once we know the property id
  useEffect(() => {
    if (!home?.id) return
    getFaqsByPropertyId(home.id).then(rows => setFaqs(rows.filter(f => f.answer.trim())))
  }, [home?.id])

  useEffect(() => {
    if (!home?.owner_id) return
    fetch(`/api/profiles/${home.owner_id}/public`)
      .then(r => r.json())
      .then(data => { if (data.first_name) setLandlordProfile(data) })
      .catch(() => {})
  }, [home?.owner_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!home) return
    supabase
      .from('properties')
      .select('slug, name, address, price, beds, baths, available, total_rooms, asu_distance, is_featured, asu_score, rental_mode, property_images(url, position)')
      .eq('is_active', true)
      .eq('admin_status', 'active')
      .eq('is_test', false)
      .eq('is_featured', true)
      .neq('slug', slug)
      .order('asu_score', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (!data) return
        const mapped = data.map((p: any) => ({
          slug: p.slug, name: p.name, address: p.address, price: p.price,
          beds: p.beds, baths: p.baths, available: p.available, total_rooms: p.total_rooms,
          asu_distance: p.asu_distance, is_featured: p.is_featured, asu_score: p.asu_score,
          rental_mode: p.rental_mode ?? 'whole_home',
          cover: p.property_images?.sort((a: any, b: any) => a.position - b.position)?.[0]?.url ?? null,
        }))
        setRecommended(mapped)
      })
  }, [home]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch(`/api/comments?property=${slug}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setComments(data))
      .catch(() => {})
  }, [slug])

  const submitComment = async () => {
    if (!commentText.trim()) return
    setSubmittingComment(true)
    setCommentError(null)
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_slug: slug, content: commentText.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setCommentError(data.error || 'Failed to post comment'); return }
      setComments(prev => [data, ...prev])
      setCommentText('')
    } catch { setCommentError('Failed to post comment') }
    finally { setSubmittingComment(false) }
  }

  useEffect(() => {
    if (!home) return
    ph?.capture('property_viewed', {
      property_slug: slug,
      property_name: home.name,
      property_price: home.price,
      beds: home.beds,
      baths: home.baths,
      available_rooms: home.available,
      is_personalized: isPersonalized,
    })

    // Meta Pixel — ViewContent
    if (typeof window !== 'undefined' && (window as any).fbq) {
      ;(window as any).fbq('track', 'ViewContent', {
        content_name: home.name,
        content_ids: [slug],
        content_type: 'product',
        value: home.price,
        currency: 'USD',
      })
    }

    // Property page view attribution tracking
    const utm_source   = localStorage.getItem('utm_source')   || undefined
    const utm_medium   = localStorage.getItem('utm_medium')   || undefined
    const utm_campaign = localStorage.getItem('utm_campaign') || undefined
    const utm_content  = localStorage.getItem('utm_content')  || undefined
    const landing_page = localStorage.getItem('utm_landing_page') || window.location.pathname
    const referrer     = localStorage.getItem('utm_referrer') || document.referrer || undefined
    const device_type  = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop'

    // Generate or reuse session ID (persists for the browser session)
    if (!sessionStorage.getItem('hh_session_id')) {
      sessionStorage.setItem('hh_session_id', crypto.randomUUID())
    }
    const session_id = sessionStorage.getItem('hh_session_id')!

    fetch('/api/page-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_slug: slug, session_id, utm_source, utm_medium, utm_campaign, utm_content, landing_page, referrer, device_type }),
    }).catch(() => {})
  }, [home]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (guestName) {
      setFormData(prev => ({ ...prev, first_name: guestName.trim().split(' ')[0] || '' }))
    }
  }, [guestName])

  // Pre-fill form for logged-in users + check for existing lead
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { setExistingLead(null); return }
      const userId = session.user.id
      const [profileResult, leadResult] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, avatar_url').eq('id', userId).single(),
        supabase.from('leads').select('id, status').eq('email', session.user.email ?? '').eq('property', slug).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      const profile = profileResult.data
      const fullName = profile?.full_name || session.user.user_metadata?.full_name || ''
      const firstName = fullName.trim().split(/\s+/)[0] || ''
      const phone = profile?.phone || ''
      const avatarUrl = profile?.avatar_url || null
      setLoggedInUser({ id: userId, name: fullName, email: session.user.email || '', phone, avatarUrl })
      setFormData(prev => ({
        ...prev,
        first_name: firstName || prev.first_name,
        email: session.user.email || prev.email,
        phone: phone || prev.phone,
      }))
      setExistingLead(leadResult.data ?? null)
    })
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show sticky mobile bar once user scrolls past the title
  useEffect(() => {
    const onScroll = () => {
      const titleBottom = titleRef.current?.getBoundingClientRect().bottom ?? 0
      setShowStickyBar(titleBottom < 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Track mobile form open (must be before early returns)
  useEffect(() => {
    if (mobileFormOpen && home) {
      ph?.capture('inquiry_form_opened_mobile', { property_slug: slug, property_name: home.name })
    }
  }, [mobileFormOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / not-found guards ────────────────────────────────────────────
  if (home === undefined) {
    return (
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 24px' }}>
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        <div style={{ height: '28px', width: '30%', borderRadius: '6px', marginBottom: '20px', background: 'linear-gradient(90deg,var(--hh-bg-alt) 25%,var(--hh-bg) 50%,var(--hh-bg-alt) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '28px' }}>
          <div style={{ height: '500px', borderRadius: '16px', background: 'linear-gradient(90deg,var(--hh-bg-alt) 25%,var(--hh-bg) 50%,var(--hh-bg-alt) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
          <div style={{ height: '460px', borderRadius: '16px', background: 'linear-gradient(90deg,var(--hh-bg-alt) 25%,var(--hh-bg) 50%,var(--hh-bg-alt) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
        </div>
      </div>
    )
  }

  if (home === null) return notFound()

  // ── Derived values ────────────────────────────────────────────────────────
  const allImages  = home.images.filter(Boolean)
  const mainImage  = allImages[activePhoto] ?? ''
  // A rented home has no rooms to offer — override the urgency badge so the page
  // never advertises availability the landlord has switched off.
  const avail      = home.listing_status === 'rented'
    ? { text: 'Currently rented', color: '#1e40af', bg: '#eff6ff', urgent: false }
    : availabilityConfig(home.available, home.total_rooms)
  const isPopular  = (home.asu_score ?? 0) >= 8

  // Earliest selectable move-in: the listing's available_from if it's set and in
  // the future, otherwise today. Locks out every date before the home is ready.
  const todayStr   = new Date().toISOString().split('T')[0]
  const minMoveIn  = home.available_from && home.available_from > todayStr ? home.available_from : todayStr
  const availFromLabel = home.available_from
    ? new Date(home.available_from + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null
  const effectivePhone = loggedInUser?.phone || formData.phone.trim()
  const canSubmit  = formData.first_name.trim() !== '' && formData.email.trim() !== '' && effectivePhone !== '' && formData.move_in_date !== '' && formData.move_in_date >= minMoveIn

  const listingTypeCfg = home.listing_type === 'sublease'
    ? { label: 'Sublease', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' }
    : home.listing_type === 'lease_transfer'
      ? { label: 'Lease Transfer', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' }
      : { label: 'Whole Home', color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' }
  const missingFields = [
    !formData.first_name.trim() && 'name',
    !formData.email.trim() && 'email',
    !effectivePhone && 'phone',
    !formData.move_in_date && 'move-in date',
  ].filter(Boolean)
  const waitlistMode = acceptsWaitlist(home)
  const ctaCopy = canSubmit
    ? waitlistMode
      ? `Join the waitlist as ${formData.first_name.trim().split(' ')[0]} →`
      : `Check availability for ${formData.first_name.trim().split(' ')[0]} →`
    : missingFields.length === 4
      ? waitlistMode ? 'Join the Waitlist →' : 'Check Availability →'
      : `Add your ${missingFields[0]} to continue`

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
    if (!formStartedRef.current && home) {
      formStartedRef.current = true
      ph?.capture('inquiry_form_started', {
        property_slug: slug,
        property_name: home.name,
        property_price: home.price,
        available_rooms: home.available,
        first_field: e.target.name,
      })
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      // Pull attribution from localStorage (set by UtmCapture on any marketing page)
      const attribution = {
        utm_source:   localStorage.getItem('utm_source')        || undefined,
        utm_medium:   localStorage.getItem('utm_medium')        || undefined,
        utm_campaign: localStorage.getItem('utm_campaign')      || undefined,
        utm_content:  localStorage.getItem('utm_content')       || undefined,
        landing_page: localStorage.getItem('utm_landing_page')  || window.location.pathname,
        referrer:     localStorage.getItem('utm_referrer')      || document.referrer || undefined,
        device_type:  /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
        browser:      navigator.userAgent.split(' ').pop() || undefined,
      }

      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, property: slug, ...attribution }),
      })
      if (res.ok) {
        const data = await res.json()
        // Stitch this email onto all of the visitor's prior anonymous hits.
        if (formData.email) {
          localStorage.setItem('hh_identified_email', formData.email)
          identifyVisitor(formData.email, formData.first_name || null, 'lead_form')
        }
        ph?.capture('inquiry_submitted', {
          property_slug: slug,
          property_name: home?.name,
          move_in_date: formData.move_in_date,
          is_personalized: isPersonalized,
          utm_source: attribution.utm_source,
          utm_campaign: attribution.utm_campaign,
        })

        // Meta Pixel — Lead conversion event
        if (typeof window !== 'undefined' && (window as any).fbq) {
          ;(window as any).fbq('track', 'Lead', {
            content_name: home?.name,
            content_ids: [slug],
            value: home?.price,
            currency: 'USD',
          })
        }

        setSubmittedLeadId(data.leadId ?? null)
        setSubmitted(true)
        setMobileFormOpen(false)
        if (loggedInUser && data.leadId) {
          setTimeout(() => { window.location.href = `/pre-screen/${data.leadId}` }, 1800)
        }
      }
    } catch (e) { console.error(e) }
    setSubmitting(false)
  }

  // ── Lead status config ───────────────────────────────────────────────────
  const LEAD_STATUS_LABEL: Record<string, { label: string; desc: string; color: string; bg: string }> = {
    new:            { label: 'Pending Review',    desc: 'Your inquiry is in the queue — we\'ll be in touch within a few hours.',                  color: '#1d4ed8', bg: '#eff6ff' },
    contacted:      { label: 'We Reached Out',    desc: 'Check your email or phone — a team member has already been in contact.',                  color: '#c9973a', bg: '#fefce8' },
    engaged:        { label: 'In Conversation',   desc: 'You\'re in active conversation with us. Keep an eye on your messages.',                   color: '#7c3aed', bg: '#f5f3ff' },
    qualified:      { label: 'Pre-Qualified',     desc: 'You\'ve been pre-qualified! A team member will schedule your tour soon.',                 color: '#166534', bg: '#f0fdf4' },
    tour_scheduled: { label: 'Tour Scheduled',    desc: 'Your tour is booked — check your email for confirmation details.',                        color: 'var(--hh-primary)', bg: '#fdf2f5' },
    closed:         { label: 'Closed',            desc: 'This inquiry has been closed.',                                                           color: '#6b7280', bg: '#f3f4f6' },
  }

  // ── Landlord-set availability (see src/lib/listingStatus.ts) ─────────────
  const isRented    = home.listing_status === 'rented'
  const canInquire  = acceptsInquiries(home)
  const isWaitlist  = acceptsWaitlist(home)
  const availAgain  = home.rented_until
    ? new Date(home.rented_until + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  // ── Form JSX (shared between sidebar + mobile drawer) ────────────────────
  const FormContent = () => {
    // Rented but kept public — reframe the form as a waitlist rather than
    // pretending the home is available.
    const RentedBanner = isRented ? (
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
          Currently rented
        </div>
        <p style={{ fontSize: '13px', color: 'var(--hh-text-2)', lineHeight: 1.6 }}>
          This home is leased{availAgain ? ` until ${availAgain}` : ''}. Join the waitlist and you&apos;ll be
          first to hear when it opens up — waitlist renters usually get a look before it goes public.
        </p>
      </div>
    ) : null

    // Landlord paused inquiries — the listing stays browsable, the form doesn't.
    if (!canInquire && !isWaitlist) {
      return (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
            Not taking inquiries right now
          </div>
          <p style={{ fontSize: '13px', color: 'var(--hh-text-2)', lineHeight: 1.6, marginBottom: '12px' }}>
            This home isn&apos;t accepting new requests at the moment. Browse other verified homes near
            campus — most students find a match the same week.
          </p>
          <a href="/homes" style={{ display: 'block', textAlign: 'center', padding: '12px', background: 'var(--hh-ink-900)', color: '#fff', borderRadius: '9px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
            See similar homes →
          </a>
        </div>
      )
    }

    // Offer banner (shown above form if offer exists)
    const OfferBanner = home.offer_amount ? (
      <div style={{ background: 'linear-gradient(135deg, #1c2420 0%, var(--hh-hive-800) 100%)', border: '1px solid rgba(217,161,74,0.5)', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-30px', right: '-30px', width: '120px', height: '120px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(217,161,74,0.2) 0%,transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(217,161,74,0.15)', border: '1px solid rgba(217,161,74,0.4)', borderRadius: '20px', padding: '3px 10px', marginBottom: '8px' }}>
          <span style={{ fontSize: '9px', color: 'var(--hh-accent)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>🎁 Limited offer</span>
        </div>
        <div style={{ fontFamily: "var(--hh-font-display)", fontSize: '20px', color: 'var(--hh-accent)', lineHeight: 1.2, marginBottom: '4px' }}>
          ${home.offer_amount.toLocaleString()} lease credit
        </div>
        <div style={{ fontSize: '12px', color: '#c5c1b8', lineHeight: 1.5, marginBottom: home.offer_deadline ? '8px' : '0' }}>
          {home.offer_description || 'Cash credit applied when you sign your lease.'}
        </div>
        {home.offer_deadline && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--hh-accent)', fontWeight: 600 }}>
            <span>⏰</span>
            <span>Sign by {new Date(home.offer_deadline + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} to claim</span>
          </div>
        )}
      </div>
    ) : null

    // Existing lead — show status (skip if closed so they can re-inquire)
    if (existingLead && existingLead.status !== 'closed') {
      const cfg = LEAD_STATUS_LABEL[existingLead.status] ?? LEAD_STATUS_LABEL['new']
      const needsPrescreen = existingLead.status === 'new' || existingLead.status === 'contacted'
      return (
        <>
          {RentedBanner}
      {OfferBanner}
          <div style={{ background: cfg.bg, border: `1px solid ${cfg.color}22`, borderRadius: '12px', padding: '18px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{cfg.label}</span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--hh-text-2)', lineHeight: 1.6 }}>{cfg.desc}</p>
          </div>
          {needsPrescreen && (
            <a
              href={`/pre-screen/${existingLead.id}`}
              style={{ display: 'block', width: '100%', padding: '14px', background: 'var(--hh-accent)', color: 'var(--hh-ink-900)', border: 'none', borderRadius: '9px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', fontFamily: "var(--hh-font-ui)", letterSpacing: '0.1px', textAlign: 'center', textDecoration: 'none', boxShadow: '0 4px 18px rgba(217,161,74,0.45)', animation: 'goldPulse 2.8s ease-in-out infinite' }}
            >
              Complete your pre-screen →
            </a>
          )}
          {!needsPrescreen && (
            <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--hh-text-muted)', marginTop: '4px' }}>
              Questions? <a href="mailto:hello@homehive.live" style={{ color: 'var(--hh-primary)', fontWeight: 600 }}>Contact us</a>
            </div>
          )}
        </>
      )
    }

    // Post-submit state
    if (submitted) {
      const landlordName = landlordProfile?.first_name || null
      return (
        <div style={{ padding: '18px 4px' }}>
          {/* Sent confirmation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px 16px', marginBottom: '18px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>✓</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#166534' }}>
                {landlordName ? `Sent to ${landlordName}!` : 'Interest sent!'}
              </div>
              <div style={{ fontSize: '12px', color: '#16a34a', marginTop: '2px' }}>
                {landlordName ? `${landlordName} will review your inquiry shortly.` : 'The landlord will review your inquiry shortly.'}
              </div>
            </div>
          </div>

          {/* Pre-screen pitch */}
          <div style={{ fontFamily: "var(--hh-font-display)", fontSize: '18px', color: 'var(--hh-text)', lineHeight: 1.3, marginBottom: '8px' }}>
            Let's get to know you better.
          </div>
          <p style={{ fontSize: '13px', color: 'var(--hh-text-2)', lineHeight: 1.65, marginBottom: '14px' }}>
            Your inquiry is in — now take 2 minutes to complete your pre-screen. Tenants who do are reviewed <strong>first</strong> and move to the top of the list.
          </p>

          {/* What's in it */}
          <div style={{ background: 'var(--hh-bg)', border: '1px solid #e8e5de', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
            {[
              'A little about you (30 sec)',
              'Your move-in plan & group size',
              'Budget & lifestyle fit',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12px', color: 'var(--hh-text-2)', marginBottom: i < 2 ? '7px' : 0 }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'var(--hh-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: 'var(--hh-text)', flexShrink: 0 }}>✓</div>
                {item}
              </div>
            ))}
          </div>

          {/* CTA */}
          {submittedLeadId && (
            <a
              href={`/pre-screen/${submittedLeadId}`}
              style={{ display: 'block', padding: '14px', background: 'var(--hh-accent)', color: 'var(--hh-ink-900)', borderRadius: '9px', fontSize: '15px', fontWeight: 800, textDecoration: 'none', textAlign: 'center', boxShadow: '0 4px 18px rgba(217,161,74,0.45)', marginBottom: '10px' }}
            >
              Complete my pre-screen →
            </a>
          )}

          {loggedInUser && (
            <p style={{ fontSize: '11px', color: '#b0a898', textAlign: 'center', margin: 0 }}>Taking you there automatically…</p>
          )}
          {!loggedInUser && (
            <p style={{ fontSize: '11px', color: '#b0a898', textAlign: 'center', margin: 0 }}>No account needed · Takes 2 minutes · No commitment</p>
          )}
        </div>
      )
    }

    return (
    <>
      {RentedBanner}
      {OfferBanner}

      {/* Price header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
          <span style={{ fontFamily: "var(--hh-font-display)", fontSize: '30px', color: 'var(--hh-text)', letterSpacing: '-0.5px' }}>
            {home.rental_mode === 'by_room' ? `from $${home.price.toLocaleString()}` : `$${home.price.toLocaleString()}`}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--hh-text-muted)' }}>
            {home.rental_mode === 'by_room' ? '/mo per room' : '/mo'}
          </span>
        </div>
        {!home.utilities_included && (
          <div style={{ fontSize: '12px', color: 'var(--hh-text-muted)' }}>Est. all-in: <strong style={{ color: 'var(--hh-text)' }}>${home.price + 65}–${home.price + 140}/mo</strong> <span style={{ color: '#c5c1b8' }}>incl. utilities</span></div>
        )}
        {home.utilities_included && (
          <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 500 }}>✓ Utilities included</div>
        )}
      </div>

      {/* Availability badge */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: avail.bg, color: avail.color, fontSize: '12px', fontWeight: 600, padding: '5px 12px', borderRadius: '20px', marginBottom: '14px', animation: avail.urgent ? 'pulse 2s infinite' : 'none' }}>
        {avail.text}
      </div>

      {/* Social signals */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {isPopular && (
          <div style={{ fontSize: '11px', color: '#92400e', background: '#fef3c7', padding: '3px 9px', borderRadius: '20px', fontWeight: 500 }}>
            🔥 Popular listing
          </div>
        )}
        <div style={{ fontSize: '11px', color: '#1d4ed8', background: '#eff6ff', padding: '3px 9px', borderRadius: '20px', fontWeight: 500 }}>
          ⚡ Replies within 2 hrs
        </div>
      </div>

      <div style={{ height: '1px', background: '#f0ede6', marginBottom: '18px' }} />

      {/* Form fields */}
      {loggedInUser ? (
        /* ── Logged-in: compact pre-filled form ── */
        <div style={{ marginBottom: '14px' }}>
          {/* Identity row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--hh-bg-alt)', border: '1px solid #e8e5de', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px' }}>
            {loggedInUser.avatarUrl ? (
              <img src={loggedInUser.avatarUrl} alt={loggedInUser.name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--hh-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
                {(loggedInUser.name || loggedInUser.email)[0].toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--hh-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loggedInUser.name || 'You'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--hh-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {loggedInUser.email}
              </div>
            </div>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 7px', borderRadius: '4px', flexShrink: 0 }}>Verified ✓</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Phone — only show if not on profile */}
            {!loggedInUser.phone && (
              <PhoneInput
                value={formData.phone}
                onChange={e164 => setFormData(prev => ({ ...prev, phone: e164 }))}
                placeholder="(555) 000-0000 (optional)"
                borderRadius="9px"
              />
            )}
            {/* Move-in date — required */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--hh-text-muted)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                When do you want to move in? <span style={{ color: 'var(--hh-primary)' }}>*</span>
              </div>
              <input
                name="move_in_date"
                type="date"
                value={formData.move_in_date}
                onChange={handleChange}
                min={minMoveIn}
                style={{ width: '100%', padding: '11px 14px', border: `1.5px solid ${formData.move_in_date ? '#1a1a1a' : 'var(--hh-border-faint)'}`, borderRadius: '9px', fontSize: '14px', fontFamily: "var(--hh-font-ui)", outline: 'none', color: formData.move_in_date ? '#1a1a1a' : '#a0a0a0', background: '#fff', boxSizing: 'border-box' }}
                onFocus={e => e.target.style.borderColor = 'var(--hh-primary)'}
                onBlur={e => e.target.style.borderColor = formData.move_in_date ? '#1a1a1a' : 'var(--hh-border-faint)'}
              />
              {availFromLabel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#059669', marginTop: '6px', paddingLeft: '2px' }}>
                  <span style={{ fontSize: '12px' }}>🔒</span>
                  <span>Available from <strong>{availFromLabel}</strong> — earlier dates are locked</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Guest: full form ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
          <input
            name="first_name"
            placeholder="Your first name *"
            value={formData.first_name}
            onChange={handleChange}
            autoFocus={!isPersonalized}
            style={{ width: '100%', padding: '11px 14px', border: `1.5px solid ${formData.first_name ? '#1a1a1a' : 'var(--hh-border-faint)'}`, borderRadius: '9px', fontSize: '14px', fontFamily: "var(--hh-font-ui)", outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = 'var(--hh-primary)'}
            onBlur={e => e.target.style.borderColor = formData.first_name ? '#1a1a1a' : 'var(--hh-border-faint)'}
          />
          <input
            name="email"
            type="email"
            placeholder="Email address *"
            value={formData.email}
            onChange={handleChange}
            style={{ width: '100%', padding: '11px 14px', border: `1.5px solid ${formData.email ? '#1a1a1a' : 'var(--hh-border-faint)'}`, borderRadius: '9px', fontSize: '14px', fontFamily: "var(--hh-font-ui)", outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = 'var(--hh-primary)'}
            onBlur={e => e.target.style.borderColor = formData.email ? '#1a1a1a' : 'var(--hh-border-faint)'}
          />
          <PhoneInput
            value={formData.phone}
            onChange={e164 => setFormData(prev => ({ ...prev, phone: e164 }))}
            placeholder="Phone number *"
            required
            borderRadius="9px"
          />
          <div>
            <input
              name="move_in_date"
              type="date"
              value={formData.move_in_date}
              onChange={handleChange}
              min={minMoveIn}
              style={{ width: '100%', padding: '11px 14px', border: `1.5px solid ${formData.move_in_date ? '#1a1a1a' : 'var(--hh-border-faint)'}`, borderRadius: '9px', fontSize: '14px', fontFamily: "var(--hh-font-ui)", outline: 'none', color: formData.move_in_date ? '#1a1a1a' : '#a0a0a0', background: '#fff', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = 'var(--hh-primary)'}
              onBlur={e => e.target.style.borderColor = formData.move_in_date ? '#1a1a1a' : 'var(--hh-border-faint)'}
            />
            {availFromLabel ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#059669', marginTop: '6px', paddingLeft: '2px' }}>
                <span style={{ fontSize: '12px' }}>🔒</span>
                <span>Available from <strong>{availFromLabel}</strong> — earlier dates are locked</span>
              </div>
            ) : !formData.move_in_date && (
              <div style={{ fontSize: '10px', color: '#b0a898', marginTop: '4px', paddingLeft: '2px' }}>When do you want to move in? *</div>
            )}
          </div>
        </div>
      )}

      {/* CTA Button — gold always, never grey */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%', padding: '15px', border: 'none', borderRadius: '9px',
          background: 'var(--hh-accent)',
          color: 'var(--hh-ink-900)', fontSize: '15px', fontWeight: 800,
          cursor: submitting ? 'wait' : 'pointer',
          fontFamily: "var(--hh-font-ui)",
          transition: 'transform 0.1s, box-shadow 0.2s, opacity 0.2s',
          letterSpacing: '0.1px',
          opacity: canSubmit ? 1 : 0.72,
          boxShadow: canSubmit ? '0 4px 20px rgba(217,161,74,0.45)' : 'none',
          animation: canSubmit && !submitting ? 'goldPulse 2.8s ease-in-out infinite' : 'none',
        }}
        onMouseEnter={e => { if (!submitting) { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(217,161,74,0.55)' } }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = canSubmit ? '0 4px 20px rgba(217,161,74,0.45)' : 'none' }}
        onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(1px)' }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)' }}
      >
        {submitting ? 'Submitting…' : ctaCopy}
      </button>

      {/* Trust row */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '10px', flexWrap: 'wrap' }}>
        {['No spam', 'No commitment', 'Tours available'].map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--hh-text-muted)' }}>
            <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--hh-accent)' }} />
            {t}
          </div>
        ))}
      </div>
    </>
  )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Geist:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--hh-font-ui); background: var(--hh-bg); color: var(--hh-text); }

        .prop-page    { max-width: 1200px; margin: 0 auto; padding: 28px 24px 120px; }
        .breadcrumb   { font-size: 12px; color: var(--hh-text-muted); margin-bottom: 16px; }
        .breadcrumb a { color: var(--hh-text-muted); text-decoration: none; }
        .breadcrumb a:hover { color: var(--hh-text); }

        /* ── SPLIT LAYOUT ───────────────────────────────── */
        .prop-split   { display: grid; grid-template-columns: 1fr 380px; gap: 36px; align-items: start; margin-top: 28px; }
        .prop-left    { min-width: 0; }
        .prop-right   { position: sticky; top: 88px; }

        /* ── GALLERY ────────────────────────────────────── */
        .gallery-hero { position: relative; border-radius: 20px; overflow: hidden; height: 520px; cursor: pointer; background: var(--hh-bg-alt); margin-bottom: 10px; }
        .gallery-hero img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.6s cubic-bezier(0.25,0.46,0.45,0.94); }
        .gallery-hero:hover img { transform: scale(1.02); }
        .gallery-hero-overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 55%, rgba(22,24,16,0.42)); pointer-events: none; }
        .gallery-count { position: absolute; bottom: 16px; right: 16px; background: rgba(22,24,16,0.7); color: #fff; font-family: var(--hh-font-ui); font-size: 12px; font-weight: 500; padding: 6px 14px; border-radius: 100px; backdrop-filter: blur(8px); cursor: pointer; border: 1px solid rgba(255,255,255,0.15); transition: background 0.15s; letter-spacing: 0.01em; }
        .gallery-count:hover { background: rgba(22,24,16,0.9); }

        .gallery-strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; margin-top: 0; }
        .gallery-strip::-webkit-scrollbar { height: 3px; }
        .gallery-strip::-webkit-scrollbar-thumb { background: var(--hh-border); border-radius: 10px; }
        .gallery-thumb { flex-shrink: 0; width: 96px; height: 70px; border-radius: 10px; overflow: hidden; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s, opacity 0.15s; scroll-snap-align: start; opacity: 0.6; }
        .gallery-thumb.active { border-color: var(--hh-primary); opacity: 1; }
        .gallery-thumb:hover { opacity: 0.9; }
        .gallery-thumb img { width: 100%; height: 100%; object-fit: cover; }

        /* ── CONTENT SECTIONS ───────────────────────────── */
        .section      { background: #fff; border-radius: 18px; padding: 28px; margin-top: 16px; border: 1px solid var(--hh-border-faint); }
        .section-label{ font-size: var(--hh-sz-eyebrow); font-weight: var(--hh-wt-eyebrow); letter-spacing: var(--hh-ls-eyebrow); text-transform: uppercase; color: var(--hh-accent); margin-bottom: 16px; }

        .stats-row    { display: flex; border: 1px solid var(--hh-border-faint); border-radius: 14px; overflow: hidden; margin-bottom: 20px; }
        .stat-item    { flex: 1; padding: 18px 10px; text-align: center; border-right: 1px solid var(--hh-border-faint); }
        .stat-item:last-child { border-right: none; }
        .stat-num     { font-family: var(--hh-font-display); font-size: 28px; font-weight: 400; color: var(--hh-text); letter-spacing: -0.03em; line-height: 1; }
        .stat-lbl     { font-size: 10px; color: var(--hh-text-muted); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }

        .tags-wrap     { display: flex; flex-wrap: wrap; gap: 8px; }
        .tag-pill      { display: flex; align-items: center; gap: 6px; padding: 7px 14px; background: var(--hh-bg-alt); border: 1px solid var(--hh-border-faint); border-radius: 100px; font-size: 13px; color: var(--hh-text-2); transition: border-color 0.15s; }
        .tag-pill:hover { border-color: var(--hh-border); }

        .pain-list    { display: flex; flex-direction: column; gap: 10px; }
        .pain-item    { display: flex; gap: 14px; align-items: flex-start; padding: 14px 16px; background: var(--hh-bg-alt); border-radius: 12px; border: 1px solid var(--hh-border-faint); }
        .pain-dot     { width: 7px; height: 7px; border-radius: 50%; background: var(--hh-accent); flex-shrink: 0; margin-top: 8px; }
        .pain-text    { font-size: 14px; color: var(--hh-text-2); line-height: 1.7; }

        .pricing-row  { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--hh-border-faint); font-size: 14px; }
        .pricing-row:last-of-type { border-bottom: none; }
        .pricing-label{ color: var(--hh-text-muted); }
        .pricing-val  { font-weight: 500; color: var(--hh-text); }
        .pricing-val.green { color: #16a34a; }
        .pricing-total{ display: flex; justify-content: space-between; padding-top: 14px; margin-top: 6px; border-top: 1.5px solid var(--hh-text); font-size: 16px; font-weight: 600; }

        .map-wrap     { border-radius: 14px; overflow: hidden; border: 1px solid var(--hh-border-faint); margin-bottom: 14px; }
        .nearby-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .nearby-item  { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px; background: var(--hh-bg-alt); border-radius: 10px; border: 1px solid var(--hh-border-faint); }
        .nearby-place { font-size: 13px; color: var(--hh-text-2); }
        .nearby-time  { font-size: 12px; color: var(--hh-accent); font-weight: 600; }

        .faq-inline   { border: 1px solid var(--hh-border-faint); border-radius: 12px; overflow: hidden; background: #fff; }
        .faq-inline summary { list-style: none; cursor: pointer; padding: 14px 16px; font-size: 14px; font-weight: 600; color: var(--hh-text); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .faq-inline summary::-webkit-details-marker { display: none; }
        .faq-inline summary::after { content: '+'; font-size: 20px; color: var(--hh-primary); font-weight: 300; flex-shrink: 0; line-height: 1; }
        .faq-inline[open] summary::after { content: '\\2212'; }
        .faq-inline-a { padding: 0 16px 14px; font-size: 13.5px; color: var(--hh-text-2); line-height: 1.65; white-space: pre-wrap; }
        .faq-inline-more { display: inline-block; margin-top: 12px; font-size: 13px; font-weight: 600; color: var(--hh-primary); text-decoration: none; }
        .faq-inline-more:hover { text-decoration: underline; }

        .rec-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
        .rec-card    { border: 1px solid var(--hh-border-faint); border-radius: 16px; overflow: hidden; text-decoration: none; color: inherit; display: flex; flex-direction: column; transition: box-shadow 0.2s, transform 0.2s; background: #fff; }
        .rec-card:hover { box-shadow: 0 12px 40px rgba(34,40,16,0.11); transform: translateY(-3px); }
        .rec-img     { width: 100%; height: 148px; object-fit: cover; background: var(--hh-bg-alt); display: block; transition: transform 0.4s; }
        .rec-card:hover .rec-img { transform: scale(1.04); }
        .rec-body    { padding: 14px 16px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
        .rec-name    { font-family: var(--hh-font-display); font-size: 15px; font-weight: 400; color: var(--hh-text); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; }
        .rec-addr    { font-size: 11px; color: var(--hh-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rec-price   { font-family: var(--hh-font-display); font-size: 20px; font-weight: 400; color: var(--hh-text); margin-top: 6px; letter-spacing: -0.02em; }
        .rec-meta    { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
        .rec-pill    { font-size: 10px; font-weight: 500; color: var(--hh-text-muted); background: var(--hh-bg-alt); border-radius: 100px; padding: 2px 9px; border: 1px solid var(--hh-border-faint); }
        .rec-cta     { font-size: 12px; font-weight: 600; color: var(--hh-primary); margin-top: auto; padding-top: 10px; }

        /* ── FORM CARD (right column) ───────────────────── */
        .form-card    { background: #fff; border-radius: 20px; padding: 24px; border: 1px solid var(--hh-border-faint); box-shadow: 0 4px 32px rgba(34,40,16,0.09), 0 1px 4px rgba(34,40,16,0.05); }

        /* ── MOBILE STICKY BAR ──────────────────────────── */
        .mobile-sticky-bar {
          display: none;
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
          background: #fff; border-top: 1px solid var(--hh-border-faint);
          padding: 12px 20px 20px;
          box-shadow: 0 -8px 32px rgba(34,40,16,0.1);
        }
        .mobile-bar-inner { display: flex; align-items: center; gap: 12px; }
        .mobile-bar-price { flex-shrink: 0; }
        .mobile-bar-cta { flex: 1; padding: 14px; background: var(--hh-accent); color: var(--hh-ink-900); border: none; border-radius: 100px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: var(--hh-font-ui); letter-spacing: -0.01em; box-shadow: 0 4px 16px rgba(217,161,74,0.4); }

        /* ── MOBILE FORM DRAWER ─────────────────────────── */
        .drawer-backdrop { display: none; position: fixed; inset: 0; background: rgba(34,40,16,0.5); z-index: 200; backdrop-filter: blur(4px); }
        .drawer-backdrop.open { display: block; }
        .drawer { position: fixed; bottom: 0; left: 0; right: 0; z-index: 201; background: #fff; border-radius: 24px 24px 0 0; padding: 24px 20px 40px; max-height: 90vh; overflow-y: auto; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); }
        .drawer.open { transform: translateY(0); }
        .drawer-handle { width: 36px; height: 4px; background: var(--hh-border); border-radius: 10px; margin: 0 auto 20px; }

        /* ── ANIMATIONS ─────────────────────────────────── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes goldPulse { 0%,100%{box-shadow:0 4px 20px rgba(217,161,74,0.45)} 50%{box-shadow:0 4px 32px rgba(217,161,74,0.75)} }

        /* ── RESPONSIVE ─────────────────────────────────── */
        @media (max-width: 900px) {
          .prop-split { grid-template-columns: 1fr; }
          .prop-right { display: none; }
          .mobile-sticky-bar { display: block; }
          .gallery-hero { height: 320px; }
          .nearby-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 500px) {
          .prop-page { padding: 16px 16px 100px; }
          .gallery-hero { height: 260px; border-radius: 14px; }
          .stats-row { flex-wrap: wrap; }
          .stat-item { min-width: 50%; border-bottom: 1px solid var(--hh-border-faint); }
        }
      `}</style>

      <div className="prop-page">

        {/* PERSONALIZED BANNER */}
        {isPersonalized && (
          <div style={{ background: 'linear-gradient(135deg,#1c2420 0%,#243530 100%)', borderRadius: '14px', padding: '24px 28px', marginBottom: '24px', border: '1px solid rgba(217,161,74,0.4)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(217,161,74,0.15) 0%,transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(217,161,74,0.15)', border: '1px solid rgba(217,161,74,0.4)', borderRadius: '20px', padding: '4px 12px', marginBottom: '12px' }}>
              <span style={{ fontSize: '10px', color: 'var(--hh-accent)', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>✦ Picked for you</span>
            </div>
            <div style={{ fontFamily: 'var(--hh-font-display)', fontSize: '24px', color: '#fff', lineHeight: 1.2, marginBottom: '8px' }}>
              {guestName}, this one's yours.<br /><span style={{ color: 'var(--hh-accent)' }}>{customMsg || 'Spots fill up fast — we saved it for you.'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(217,161,74,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--hh-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600, color: 'var(--hh-text)', flexShrink: 0 }}>{fromName[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>{fromName} from HomeHive</div>
                  <div style={{ fontSize: '11px', color: 'var(--hh-text-muted)' }}>Sent this listing just for you</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(220,252,231,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '20px', padding: '5px 12px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '12px', color: '#86efac', fontWeight: 500 }}>{home.available} room{home.available !== 1 ? 's' : ''} open</span>
              </div>
            </div>
          </div>
        )}

        {/* BACK LINK — subtle, won't compete with the form */}
        <a
          href="/homes"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#b0a898', textDecoration: 'none', marginBottom: '10px', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--hh-text-muted)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = '#b0a898'}
        >
          <span style={{ fontSize: '15px', lineHeight: 1 }}>←</span> All homes
        </a>

        {/* BREADCRUMB */}
        <div className="breadcrumb">
          <a href="/">HomeHive</a> › <a href="/homes">Homes</a> › <strong>{home.name}</strong>
        </div>

        {/* TITLE ROW */}
        <div ref={titleRef}>
          <h1 style={{ fontFamily: "var(--hh-font-display)", fontSize: 'clamp(26px,4vw,38px)', color: 'var(--hh-text)', lineHeight: 1.15, marginBottom: '8px' }}>{home.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: 'var(--hh-text-muted)' }}>📍 {home.address}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', background: listingTypeCfg.bg, color: listingTypeCfg.color, border: `1px solid ${listingTypeCfg.border}`, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: listingTypeCfg.color, display: 'inline-block', flexShrink: 0 }} />
              {listingTypeCfg.label}
            </span>
            <span
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={() => setBadgeHover(true)}
              onMouseLeave={() => setBadgeHover(false)}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '4px 11px', borderRadius: '20px', background: 'var(--hh-primary)', color: '#fff', border: '1px solid rgba(47,74,72,0.5)', cursor: 'default', letterSpacing: '0.2px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                ✓ HomeHive Verified
              </span>
              {badgeHover && (
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '1px solid #e8e5de', borderRadius: '10px', padding: '12px 14px', boxShadow: '0 8px 28px rgba(0,0,0,0.12)', zIndex: 50, minWidth: '220px', pointerEvents: 'none' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--hh-primary)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>What this means</div>
                  {[
                    'Zero-tolerance scam policy',
                    'Every listing manually reviewed',
                    'Landlord identity verified',
                  ].map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--hh-text-2)', marginBottom: '5px' }}>
                      <span style={{ color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              )}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '20px', background: avail.bg, color: avail.color, animation: avail.urgent ? 'pulse 2s infinite' : 'none' }}>{avail.text}</span>
          </div>
        </div>

        {/* ── SPLIT LAYOUT ────────────────────────────────── */}
        <div className="prop-split">

          {/* LEFT — gallery + all details */}
          <div className="prop-left">

            {/* GALLERY */}
            <div style={{ marginTop: '20px' }}>
              <div className="gallery-hero">
                {mainImage && <img src={mainImage} alt={home.name} />}
                <div className="gallery-hero-overlay" />
                <SaveButton slug={home.slug} />
                {allImages.length > 1 && (
                  <div className="gallery-count" onClick={() => {}}>
                    🖼 {allImages.length} photos
                  </div>
                )}
              </div>
              {allImages.length > 1 && (
                <div className="gallery-strip">
                  {allImages.map((img, i) => (
                    <div key={i} className={`gallery-thumb${activePhoto === i ? ' active' : ''}`} onClick={() => setActivePhoto(i)}>
                      <img src={img} alt={`Photo ${i + 1}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* STATS */}
            <div className="section" style={{ marginTop: '20px' }}>
              <div className="section-label">Property Overview</div>
              <div className="stats-row">
                {([
                  [String(home.beds), 'Beds'],
                  [String(home.baths), 'Baths'],
                  ...(home.sqft?.trim() ? [[home.sqft, 'Sq Ft']] : []),
                  [`${home.asu_distance ?? '?'} mi`, 'To ASU'],
                ] as [string, string][]).map(([n, l]) => (
                  <div className="stat-item" key={l}>
                    <div className="stat-num">{n}</div>
                    <div className="stat-lbl">{l}</div>
                  </div>
                ))}
              </div>
              {/* Tags / features */}
              {home.tags.length > 0 && (
                <div className="tags-wrap">
                  {home.tags.map(tag => (
                    <div key={tag} className="tag-pill">
                      <span>{tagIcon(tag)}</span>
                      <span>{tag}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AVAILABLE FROM */}
            {home.available_from && (
              <div className="section" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div className="section-label" style={{ color: '#059669' }}>Move-In Ready</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Available From</span>
                    <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--hh-text)', fontFamily: "var(--hh-font-display)" }}>
                      {new Date(home.available_from + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* SUBLEASE / LEASE TRANSFER DATES */}
            {(home.listing_type === 'sublease' || home.listing_type === 'lease_transfer') &&
              (home.sublease_start_date || home.sublease_end_date) && (
              <div className="section" style={{ background: listingTypeCfg.bg, border: `1px solid ${listingTypeCfg.border}` }}>
                <div className="section-label" style={{ color: listingTypeCfg.color }}>
                  {home.listing_type === 'lease_transfer' ? 'Lease Transfer Period' : 'Sublease Period'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {home.sublease_start_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: listingTypeCfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Available From</span>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--hh-text)', fontFamily: "var(--hh-font-display)" }}>
                        {new Date(home.sublease_start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                  {home.sublease_start_date && home.sublease_end_date && (
                    <span style={{ fontSize: '20px', color: listingTypeCfg.color, fontWeight: 300, margin: '0 4px' }}>→</span>
                  )}
                  {home.sublease_end_date && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: listingTypeCfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {home.listing_type === 'lease_transfer' ? 'Lease Ends' : 'Sublease Ends'}
                      </span>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--hh-text)', fontFamily: "var(--hh-font-display)" }}>
                        {new Date(home.sublease_end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DESCRIPTION */}
            {home.description && (
              <div className="section">
                <div className="section-label">About this home</div>
                <p style={{ fontSize: '14px', color: 'var(--hh-text-2)', lineHeight: 1.75 }}>{home.description}</p>
              </div>
            )}

            {/* ASU HIGHLIGHTS */}
            {home.asu_reasons.length > 0 && (
              <div className="section">
                <div className="section-label">Why ASU students love it</div>
                <div className="pain-list">
                  {home.asu_reasons.map((text, i) => (
                    <div className="pain-item" key={i}>
                      <div className="pain-dot" />
                      <p className="pain-text">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ROOM GALLERY — only for by_room listings that have room photos */}
            {home.rental_mode === 'by_room' && home.rooms.some(r => r.images.length > 0) && (
              <div className="section">
                <div className="section-label">Explore the Rooms</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {home.rooms.filter(r => r.images.length > 0).map(room => {
                    const imgs = room.images
                    return (
                      <div key={room.id} style={{ border: '1px solid #e8e5de', borderRadius: 12, overflow: 'hidden', background: 'var(--hh-bg)' }}>
                        {/* Airbnb-style grid: 1 photo = full; 2 = split; 3+ = hero + 2 side */}
                        {imgs.length === 1 && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imgs[0]}
                            alt={room.name}
                            onClick={() => openRoomLightbox(imgs, 0, room.name)}
                            style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                          />
                        )}
                        {imgs.length === 2 && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                            {imgs.map((url, i) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={i} src={url} alt={`${room.name} ${i + 1}`} onClick={() => openRoomLightbox(imgs, i, room.name)} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                            ))}
                          </div>
                        )}
                        {imgs.length >= 3 && (
                          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gridTemplateRows: '140px 140px', gap: 2 }}>
                            {/* Hero — spans 2 rows */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={imgs[0]} alt={room.name} onClick={() => openRoomLightbox(imgs, 0, room.name)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', gridRow: '1 / 3', cursor: 'zoom-in' }} />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={imgs[1]} alt={`${room.name} 2`} onClick={() => openRoomLightbox(imgs, 1, room.name)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                            {/* Third slot — shows count badge if more */}
                            <div style={{ position: 'relative', overflow: 'hidden' }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={imgs[2]} alt={`${room.name} 3`} onClick={() => openRoomLightbox(imgs, 2, room.name)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
                              {imgs.length > 3 && (
                                <div
                                  onClick={() => openRoomLightbox(imgs, 2, room.name)}
                                  style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                >
                                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'var(--hh-font-ui)' }}>+{imgs.length - 3} more</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {/* Room info bar */}
                        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--hh-text)' }}>{room.name}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: room.is_available ? '#16a34a' : 'var(--hh-text-muted)', display: 'inline-block', flexShrink: 0 }} />
                              <span style={{ fontSize: 12, color: room.is_available ? '#16a34a' : 'var(--hh-text-muted)', fontWeight: 600 }}>{room.is_available ? 'Available' : 'Filled'}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--hh-text)', fontFamily: 'var(--hh-font-display)' }}>${room.price.toLocaleString()}</div>
                              <div style={{ fontSize: 11, color: 'var(--hh-text-muted)' }}>/month</div>
                            </div>
                            {imgs.length > 1 && (
                              <button
                                onClick={() => openRoomLightbox(imgs, 0, room.name)}
                                style={{ fontSize: 12, fontWeight: 600, color: 'var(--hh-primary)', background: 'rgba(47,74,72,0.06)', border: '1px solid rgba(47,74,72,0.2)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'var(--hh-font-ui)', whiteSpace: 'nowrap' }}
                              >
                                🖼 {imgs.length} photos
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* PRICING */}
            <div className="section">
              <div className="section-label">Transparent Pricing</div>

              {home.rental_mode === 'by_room' && home.rooms.length > 0 ? (
                /* ── By-room: show each room with price ── */
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--hh-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Room / Unit Pricing</div>
                    {home.rooms.map(room => (
                      <div className="pricing-row" key={room.id}>
                        <span className="pricing-label" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: room.is_available ? '#16a34a' : 'var(--hh-text-muted)', display: 'inline-block', flexShrink: 0 }} />
                          {room.name}
                          {!room.is_available && <span style={{ fontSize: '11px', color: 'var(--hh-text-muted)', fontStyle: 'italic' }}>(filled)</span>}
                        </span>
                        <span className={`pricing-val${room.is_available ? ' green' : ''}`}>
                          ${room.price.toLocaleString()}/mo
                        </span>
                      </div>
                    ))}
                    <div className="pricing-row" style={{ borderTop: '2px solid #1a1a1a', paddingTop: '10px', fontWeight: 600, fontSize: '15px' }}>
                      <span>Total potential rent</span>
                      <span style={{ color: 'var(--hh-text)' }}>
                        ${home.rooms.reduce((s, r) => s + r.price, 0).toLocaleString()}/mo
                      </span>
                    </div>
                  </div>
                  {[
                    ['Utilities (water, electric, gas)', home.utilities_included ? 'Included' : 'Not included', home.utilities_included] as const,
                    ['Move-in fee', '$0', true] as const,
                    ['Broker / agency fee', '$0', true] as const,
                    ['Security deposit',
                      home.security_deposit === 0 ? '$0 — No deposit required' :
                      home.security_deposit != null ? `$${home.security_deposit.toLocaleString()} (refundable)` :
                      'Contact landlord',
                      home.security_deposit === 0] as const,
                  ].map(([l, v, g]) => (
                    <div className="pricing-row" key={l}>
                      <span className="pricing-label">{l}</span>
                      <span className={`pricing-val${g ? ' green' : ''}`}>{v}</span>
                    </div>
                  ))}
                  <div className="pricing-total">
                    <span>Move-in cost (1 room)</span>
                    <span>
                      {home.security_deposit === 0
                        ? `from $${home.price.toLocaleString()}`
                        : home.security_deposit != null
                          ? `from $${(home.price + home.security_deposit).toLocaleString()}`
                          : `from $${home.price.toLocaleString()}`}
                    </span>
                  </div>
                </>
              ) : (
                /* ── Whole home: single price ── */
                <>
                  {[
                    ['Monthly rent', `$${home.price.toLocaleString()}`, false],
                    ['Utilities (water, electric, gas)', home.utilities_included ? 'Included' : 'Not included', home.utilities_included],
                    ['Move-in fee', '$0', true],
                    ['Broker / agency fee', '$0', true],
                    ['Security deposit',
                      home.security_deposit === 0 ? '$0 — No deposit required' :
                      home.security_deposit != null ? `$${home.security_deposit.toLocaleString()} (refundable)` :
                      `$${home.price.toLocaleString()} (refundable)`,
                      home.security_deposit === 0],
                  ].map(([l, v, g]) => (
                    <div className="pricing-row" key={String(l)}>
                      <span className="pricing-label">{l}</span>
                      <span className={`pricing-val${g ? ' green' : ''}`}>{v}</span>
                    </div>
                  ))}
                  <div className="pricing-total">
                    <span>Total to move in</span>
                    <span>
                      {home.security_deposit === 0
                        ? `$${home.price.toLocaleString()}`
                        : `$${(home.price + (home.security_deposit ?? home.price)).toLocaleString()}`}
                    </span>
                  </div>
                </>
              )}

              <p style={{ fontSize: '12px', color: 'var(--hh-text-muted)', marginTop: '10px', lineHeight: 1.5 }}>The price you see is the price you pay. No hidden charges at signing. Deposit fully refunded at move-out.</p>
            </div>

            {/* LOCATION */}
            {home.map_embed_url && (
              <div className="section">
                <div className="section-label">Location</div>
                <div className="map-wrap">
                  <iframe src={home.map_embed_url} style={{ width: '100%', height: '220px', border: 'none', display: 'block' }} loading="lazy" />
                </div>
                {home.nearby.length > 0 && (
                  <div className="nearby-grid">
                    {home.nearby.map(n => (
                      <div className="nearby-item" key={n.place}>
                        <span className="nearby-place">{n.place}</span>
                        <span className="nearby-time">{n.travel_time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* FAQ */}
            {faqs.length > 0 && (
              <div className="section">
                <div className="section-label">Frequently Asked Questions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {faqs.slice(0, 4).map(f => (
                    <details key={f.id} className="faq-inline">
                      <summary>{f.question}</summary>
                      <div className="faq-inline-a">{f.answer}</div>
                    </details>
                  ))}
                </div>
                <a href={`/homes/${home.slug}/faq`} className="faq-inline-more">
                  {faqs.length > 4 ? `View all ${faqs.length} questions` : 'View full FAQ page'} →
                </a>
              </div>
            )}

            {/* RECOMMENDED PROPERTIES */}
            {recommended.length > 0 && (
              <div className="section">
                <div className="section-label">You might also like</div>
                <div className="rec-grid">
                  {recommended.map(p => {
                    const pAvail = availabilityConfig(p.available, p.total_rooms)
                    return (
                      <a key={p.slug} href={`/homes/${p.slug}`} className="rec-card">
                        {p.cover ? (
                          <img src={p.cover} alt={p.name} className="rec-img" />
                        ) : (
                          <div className="rec-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🏠</div>
                        )}
                        <div className="rec-body">
                          {p.is_featured && (
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--hh-accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>⭐ Featured</div>
                          )}
                          <div className="rec-name">{p.name}</div>
                          <div className="rec-addr">📍 {p.address}</div>
                          <div className="rec-price">
                            {p.rental_mode === 'by_room' ? `from $${p.price.toLocaleString()}` : `$${p.price.toLocaleString()}`}
                            <span style={{ fontSize: 12, fontFamily: "var(--hh-font-ui)", color: 'var(--hh-text-muted)', fontWeight: 400 }}>
                              {p.rental_mode === 'by_room' ? '/mo per room' : '/mo'}
                            </span>
                          </div>
                          <div className="rec-meta">
                            <span className="rec-pill">{p.beds} bd · {p.baths} ba</span>
                            {p.asu_distance > 0 && <span className="rec-pill">{p.asu_distance} mi to ASU</span>}
                            <span style={{ fontSize: 10, fontWeight: 600, color: pAvail.color, background: pAvail.bg, borderRadius: 20, padding: '2px 8px' }}>
                              {pAvail.text}
                            </span>
                          </div>
                          <div className="rec-cta">View listing →</div>
                        </div>
                      </a>
                    )
                  })}
                </div>
                <div style={{ marginTop: 14, textAlign: 'center' }}>
                  <a href="/homes" style={{ fontSize: 13, color: 'var(--hh-text-muted)', textDecoration: 'none', fontWeight: 500, transition: 'color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = '#1a1a1a'}
                    onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--hh-text-muted)'}
                  >
                    Browse all homes →
                  </a>
                </div>
              </div>
            )}

          {/* ── COMMENTS ── */}
          <div style={{ borderTop: '1px solid var(--hh-border-faint)', paddingTop: '28px', marginTop: '12px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--hh-text)', margin: '0 0 20px', fontFamily: 'var(--hh-font-ui)' }}>
              {comments.length > 0 ? `${comments.length} Question${comments.length !== 1 ? 's' : ''} & Comment${comments.length !== 1 ? 's' : ''}` : 'Questions & Comments'}
            </h3>

            {/* Composer */}
            {loggedInUser ? (
              <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
                {loggedInUser.avatarUrl ? (
                  <img src={loggedInUser.avatarUrl} alt={loggedInUser.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--hh-border-faint)' }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {loggedInUser.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <textarea
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    placeholder="Ask a question or share your experience…"
                    maxLength={1000}
                    rows={1}
                    style={{ width: '100%', border: 'none', borderBottom: '1.5px solid var(--hh-border-faint)', borderRadius: 0, padding: '6px 0', fontSize: 14, fontFamily: 'var(--hh-font-ui, system-ui)', resize: 'none', outline: 'none', boxSizing: 'border-box', lineHeight: 1.6, color: 'var(--hh-text)', background: 'transparent', minHeight: 34 }}
                    onFocus={e => { e.target.style.borderBottomColor = '#8C1D40'; e.target.rows = 3 }}
                    onBlur={e => { if (!commentText.trim()) { e.target.style.borderBottomColor = 'var(--hh-border-faint)'; e.target.rows = 1 } }}
                  />
                  {(commentText.trim() || submittingComment) && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                      {commentError && <span style={{ fontSize: 12, color: '#dc2626', marginRight: 'auto' }}>{commentError}</span>}
                      <button onClick={() => setCommentText('')} style={{ background: 'none', color: '#6b6b6b', border: 'none', borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Cancel
                      </button>
                      <button onClick={submitComment} disabled={submittingComment || !commentText.trim()}
                        style={{ background: submittingComment || !commentText.trim() ? '#e0e0e0' : '#8C1D40', color: submittingComment || !commentText.trim() ? '#909090' : '#fff', border: 'none', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 700, cursor: submittingComment || !commentText.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'background 0.15s' }}>
                        {submittingComment ? 'Posting…' : 'Post'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, padding: '12px 16px', background: 'var(--hh-bg-alt)', borderRadius: 10, border: '1px solid var(--hh-border-faint)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>👤</div>
                <div style={{ fontSize: 13, color: 'var(--hh-text-muted)' }}>
                  <a href="/login" style={{ color: '#8C1D40', fontWeight: 600, textDecoration: 'none' }}>Sign in</a> to ask a question or leave a comment
                </div>
              </div>
            )}

            {/* Comments list */}
            {comments.length === 0 ? (
              <div style={{ padding: '24px 0', color: 'var(--hh-text-muted)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ fontSize: 20 }}>💬</span>
                No comments yet — be the first to ask a question.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {comments.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 12, padding: '16px 0', borderBottom: '1px solid var(--hh-border-faint)' }}>
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt={c.author_name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--hh-border-faint)' }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {c.author_name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--hh-text)' }}>{c.author_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--hh-text-muted)' }}>
                          {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 14, color: 'var(--hh-text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          </div>{/* /prop-left */}

          {/* RIGHT — sticky form card */}
          <div className="prop-right" id="inquiry">

            {/* Posted by landlord */}
            {landlordProfile && (
              <div style={{ background: '#fff', border: '1px solid #e8e5de', borderRadius: '12px', padding: '12px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {landlordProfile.avatar_url ? (
                  <img src={landlordProfile.avatar_url} alt={landlordProfile.first_name ?? ''} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #e8e5de' }} />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--hh-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {(landlordProfile.first_name ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--hh-text)' }}>Posted by {landlordProfile.first_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--hh-text-muted)', marginTop: '1px' }}>HomeHive verified member</div>
                </div>
              </div>
            )}

            <div className="form-card">
              {FormContent()}
            </div>

            {/* HomeHive Promise */}
            <div style={{ background: 'var(--hh-hive-800)', borderRadius: '14px', padding: '18px 20px', marginTop: '12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--hh-accent)', marginBottom: '8px' }}>The HomeHive Promise</div>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.65 }}>We match you with homes and housemates that fit your life — your schedule, your major, your vibe. No surprises, no runaround.</p>
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px' }}>🔍</span>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>Every listing is manually reviewed — we verify ownership and check for red flags before it goes live. No ghost listings, no scams.</p>
              </div>
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--hh-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>🏠</div>
                <div>
                  <div style={{ fontSize: '12px', color: '#fff', fontWeight: 500 }}>150+ Students Placed</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>Near ASU since 2022</div>
                </div>
              </div>
            </div>
          </div>

        </div>{/* /prop-split */}
      </div>{/* /prop-page */}

      {/* ── MOBILE STICKY BAR ─────────────────────────── */}
      <div className="mobile-sticky-bar" style={{ transform: showStickyBar || mobileFormOpen ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.3s cubic-bezier(0.32,0.72,0,1)' }}>
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: '14px', fontWeight: 600, color: '#16a34a' }}>✓ You're on the list! Check your email.</div>
        ) : (
          <div className="mobile-bar-inner">
            <div className="mobile-bar-price">
              <div style={{ fontFamily: "var(--hh-font-display)", fontSize: '22px', color: 'var(--hh-text)', lineHeight: 1 }}>
                {home.rental_mode === 'by_room' ? `from $${home.price.toLocaleString()}` : `$${home.price.toLocaleString()}`}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--hh-text-muted)' }}>
                {home.rental_mode === 'by_room' ? '/mo per room' : '/mo'}
              </div>
            </div>
            <button className="mobile-bar-cta" onClick={() => setMobileFormOpen(true)}>
              Check Availability →
            </button>
          </div>
        )}
      </div>

      {/* ── MOBILE FORM DRAWER ────────────────────────── */}
      <div className={`drawer-backdrop${mobileFormOpen ? ' open' : ''}`} onClick={() => setMobileFormOpen(false)} />
      <div className={`drawer${mobileFormOpen ? ' open' : ''}`}>
        <div className="drawer-handle" />
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--hh-text)', marginBottom: '4px' }}>{home.name}</div>
        <div style={{ fontSize: '12px', color: 'var(--hh-text-muted)', marginBottom: '20px' }}>📍 {home.address}</div>
        {FormContent()}
      </div>

      {/* ── ROOM LIGHTBOX ─────────────────────────────── */}
      {roomLightbox && (
        <div
          onClick={closeRoomLightbox}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.93)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--hh-font-ui)' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={roomLightbox.images[roomLightbox.index]}
              alt={`${roomLightbox.roomName} photo ${roomLightbox.index + 1}`}
              style={{ maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 10, userSelect: 'none', display: 'block' }}
              draggable={false}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', opacity: 0.9 }}>{roomLightbox.roomName}</span>
              {roomLightbox.images.length > 1 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{roomLightbox.index + 1} / {roomLightbox.images.length}</span>
              )}
            </div>
            {roomLightbox.images.length > 1 && (
              <>
                <button onClick={e => { e.stopPropagation(); roomLbPrev() }} style={{ position: 'absolute', left: -60, top: '40%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, color: '#fff', fontFamily: 'var(--hh-font-ui)' }}>‹</button>
                <button onClick={e => { e.stopPropagation(); roomLbNext() }} style={{ position: 'absolute', right: -60, top: '40%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20, color: '#fff', fontFamily: 'var(--hh-font-ui)' }}>›</button>
              </>
            )}
            {roomLightbox.images.length > 1 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {roomLightbox.images.map((_, di) => (
                  <button key={di} onClick={e => { e.stopPropagation(); setRoomLightbox(lb => lb ? { ...lb, index: di } : lb) }} style={{ width: di === roomLightbox.index ? 20 : 8, height: 8, borderRadius: 4, background: di === roomLightbox.index ? '#fff' : 'rgba(255,255,255,0.3)', border: 'none', cursor: 'pointer', padding: 0, transition: 'all 0.2s' }} />
                ))}
              </div>
            )}
            {/* Thumbnail strip */}
            {roomLightbox.images.length > 1 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '80vw', paddingBottom: 2 }}>
                {roomLightbox.images.map((url, ti) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={ti}
                    src={url}
                    alt=""
                    onClick={e => { e.stopPropagation(); setRoomLightbox(lb => lb ? { ...lb, index: ti } : lb) }}
                    style={{ height: 52, width: 70, objectFit: 'cover', borderRadius: 6, flexShrink: 0, cursor: 'pointer', border: `2px solid ${ti === roomLightbox.index ? '#fff' : 'transparent'}`, opacity: ti === roomLightbox.index ? 1 : 0.55, transition: 'all 0.15s' }}
                  />
                ))}
              </div>
            )}
          </div>
          <button onClick={closeRoomLightbox} style={{ position: 'fixed', top: 18, right: 18, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, color: '#fff', fontFamily: 'var(--hh-font-ui)' }}>×</button>
          {/* Mobile tap zones */}
          {roomLightbox.images.length > 1 && (
            <style>{`@media (max-width: 767px) { .rlb-arrow { display: none !important; } }`}</style>
          )}
          {roomLightbox.images.length > 1 && (
            <>
              <div onClick={e => { e.stopPropagation(); roomLbPrev() }} style={{ position: 'fixed', left: 0, top: 60, bottom: 80, width: '38%', cursor: 'pointer', zIndex: 1 }} />
              <div onClick={e => { e.stopPropagation(); roomLbNext() }} style={{ position: 'fixed', right: 0, top: 60, bottom: 80, width: '38%', cursor: 'pointer', zIndex: 1 }} />
            </>
          )}
        </div>
      )}
    </>
  )
}
