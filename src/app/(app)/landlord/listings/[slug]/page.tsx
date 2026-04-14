'use client'

import { use, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  getPropertiesByOwner,
  updatePropertyCore,
  updatePropertyOffer,
  replacePropertyTags,
  replacePropertyNearby,
  replacePropertyAsuReasons,
  Property,
} from '@/lib/properties'
import { getLeadsForOwner, Lead } from '@/lib/leads'

const LeadsTable = dynamic(() => import('@/components/leads/LeadsTable'), { ssr: false })

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Tab = 'overview' | 'basics' | 'type' | 'location' | 'offer' | 'calendar'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',  label: 'Overview'          },
  { id: 'basics',    label: 'Basics'             },
  { id: 'type',      label: 'Type & Availability'},
  { id: 'location',  label: 'Location & Details' },
  { id: 'offer',     label: 'Special Offer'      },
  { id: 'calendar',  label: '📅 Tour Calendar'   },
]

const LISTING_TYPE_LABELS: Record<string, string> = {
  standard_rental: 'Standard Rental',
  sublease:        'Sublease',
  lease_transfer:  'Lease Transfer',
}

function getCompleteness(p: Property) {
  const items = [
    { label: 'Property name',  filled: !!p.name,                   weight: 1 },
    { label: 'Address',        filled: !!p.address,                 weight: 1 },
    { label: 'Description',    filled: !!p.description,             weight: 2 },
    { label: 'Photos',         filled: (p.images?.length ?? 0) > 0, weight: 2 },
    { label: 'Price',          filled: (p.price || 0) > 0,          weight: 1 },
    { label: 'ASU distance',   filled: (p.asu_distance || 0) > 0,   weight: 1 },
    { label: 'Nearby places',  filled: (p.nearby?.length ?? 0) > 0, weight: 1 },
    { label: 'ASU highlights', filled: (p.asu_reasons?.length ?? 0) > 0, weight: 1 },
    { label: 'Tags',           filled: (p.tags?.length ?? 0) > 0,   weight: 1 },
  ]
  const total  = items.reduce((s, i) => s + i.weight, 0)
  const earned = items.filter(i => i.filled).reduce((s, i) => s + i.weight, 0)
  return { items, pct: Math.round((earned / total) * 100) }
}

/* ── Shared form styles ───────────────────────────────────────────────────── */
const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,600&family=DM+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .lp-wrap { max-width: 900px; margin: 0 auto; padding: 24px 20px 80px; font-family: 'DM Sans', sans-serif; }

  /* BREADCRUMB */
  .lp-breadcrumb { font-size: 13px; color: #64748b; margin-bottom: 16px; }
  .lp-breadcrumb a { color: #10b981; text-decoration: none; }
  .lp-breadcrumb a:hover { text-decoration: underline; }

  /* HEADER */
  .lp-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .lp-title { font-size: 20px; font-weight: 700; color: #0f172a; }
  .lp-title-sub { font-size: 12px; color: #64748b; margin-top: 3px; }
  .lp-header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .btn-preview { background: #fff; color: #0f172a; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; white-space: nowrap; }
  .btn-preview:hover { border-color: #10b981; color: #059669; }
  .leads-badge { background: rgba(16,185,129,0.12); color: #059669; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }

  /* BANNER */
  .status-banner { border-radius: 12px; padding: 16px 20px; margin-bottom: 18px; }

  /* TABS */
  .lp-tabs { display: flex; gap: 2px; border-bottom: 2px solid #e2e8f0; margin-bottom: 24px; overflow-x: auto; scrollbar-width: none; }
  .lp-tabs::-webkit-scrollbar { display: none; }
  .lp-tab { padding: 10px 16px; font-size: 13px; font-weight: 500; color: #64748b; border: none; background: none; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color 0.15s; }
  .lp-tab:hover { color: #0f172a; }
  .lp-tab.active { color: #10b981; border-bottom-color: #10b981; font-weight: 600; }

  /* CARDS */
  .lp-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .lp-card-hdr { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; }
  .lp-card-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.6px; }
  .lp-card-body { padding: 16px 18px; }

  /* DETAIL DISPLAY */
  .detail-row { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 8px; }
  .detail-item { display: flex; flex-direction: column; gap: 2px; }
  .detail-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .detail-value { font-size: 13px; color: #0f172a; font-weight: 500; }
  .detail-muted { font-size: 13px; color: #94a3b8; }
  .badge { display: inline-flex; align-items: center; border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-grey  { background: #e5e7eb; color: #6b7280; }
  .badge-teal  { background: rgba(16,185,129,0.15); color: #059669; }
  .badge-blue  { background: #eff6ff; color: #1d4ed8; }
  .badge-maroon { background: #fff1f2; color: #9f1239; }
  .pill-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { background: #f1f5f9; color: #334155; border-radius: 20px; padding: 3px 10px; font-size: 12px; }

  /* COMPLETENESS */
  .comp-bar-track { height: 7px; background: #e2e8f0; border-radius: 10px; overflow: hidden; margin: 10px 0 8px; }
  .comp-bar-fill  { height: 100%; border-radius: 10px; transition: width 0.4s; }
  .missing-pill { background: #fef9c3; color: #92400e; border: 1px solid #fde68a; border-radius: 20px; padding: 2px 10px; font-size: 11px; font-weight: 500; }

  /* FORM FIELDS */
  .fg { margin-bottom: 16px; }
  .fl { display: block; font-size: 11px; font-weight: 700; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
  .fi { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; transition: border-color 0.15s; }
  .fi:focus { border-color: #10b981; }
  .ft { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; resize: vertical; min-height: 90px; transition: border-color 0.15s; }
  .ft:focus { border-color: #10b981; }
  .fs { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; font-size: 14px; color: #0f172a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; cursor: pointer; }
  .fs:focus { border-color: #10b981; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .form-hint { font-size: 11px; color: #94a3b8; margin-top: 4px; }
  .form-actions { display: flex; gap: 10px; align-items: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #f1f5f9; flex-wrap: wrap; }
  .btn-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 22px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
  .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-save:not(:disabled):hover { background: #1e293b; }
  .alert-ok  { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 9px 14px; font-size: 13px; color: #166534; margin-bottom: 14px; }
  .alert-err { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 9px 14px; font-size: 13px; color: #991b1b; margin-bottom: 14px; }

  /* NEARBY / REASONS list editor */
  .list-editor { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .list-row { display: flex; gap: 8px; align-items: center; }
  .list-row .fi { flex: 1; }
  .list-row .fi-sm { flex: 0 0 140px; }
  .btn-rm { background: none; border: 1.5px solid #fecaca; border-radius: 7px; color: #ef4444; font-size: 14px; font-weight: 700; width: 30px; height: 30px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .btn-rm:hover { background: #fef2f2; }
  .btn-add { background: none; border: 1.5px dashed #cbd5e1; border-radius: 7px; color: #64748b; font-size: 12px; font-weight: 500; padding: 7px 14px; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-top: 4px; }
  .btn-add:hover { border-color: #10b981; color: #10b981; }

  /* LEADS TABLE */
  .leads-table { width: 100%; border-collapse: collapse; }
  .leads-table th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; padding: 8px 12px; text-align: left; border-bottom: 1px solid #f1f5f9; }
  .leads-table td { font-size: 13px; color: #334155; padding: 10px 12px; border-bottom: 1px solid #f9fafb; }
  .leads-table tr:last-child td { border-bottom: none; }

  /* MEDIA */
  .media-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .media-thumb { width: 80px; height: 60px; object-fit: cover; border-radius: 7px; border: 1px solid #e2e8f0; }

  @media (max-width: 560px) {
    .lp-header { flex-direction: column; }
    .form-row, .form-row-3 { grid-template-columns: 1fr; }
  }
`

export default function ManagePropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router   = useRouter()

  const [property, setProperty]     = useState<Property | null>(null)
  const [leads, setLeads]           = useState<Lead[]>([])
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState<Tab>('overview')
  const [hasPlan, setHasPlan]       = useState(false)
  const [unlockedIds, setUnlockedIds] = useState<string[]>([])

  // ── Basics form ─────────────────────────────────────────────────────────────
  const [basics, setBasics] = useState({ name: '', address: '', description: '', price: '', security_deposit: '', beds: '', baths: '', sqft: '', asu_distance: '', utilities_included: false })
  const [basicsSaving, setBasicsSaving] = useState(false)
  const [basicsMsg, setBasicsMsg]       = useState<{ ok: boolean; text: string } | null>(null)

  // ── Type & Availability form ────────────────────────────────────────────────
  const [listingType, setListingType]           = useState<'standard_rental' | 'sublease' | 'lease_transfer'>('standard_rental')
  const [subleaseStart, setSubleaseStart]       = useState('')
  const [subleaseEnd, setSubleaseEnd]           = useState('')
  const [totalRooms, setTotalRooms]             = useState('')
  const [availableRooms, setAvailableRooms]     = useState('')
  const [typeSaving, setTypeSaving]             = useState(false)
  const [typeMsg, setTypeMsg]                   = useState<{ ok: boolean; text: string } | null>(null)

  // ── Location & Details form ──────────────────────────────────────────────────
  const [loc, setLoc] = useState({ lat: '', lng: '', map_embed_url: '' })
  const [nearby, setNearby]       = useState<{ place: string; travel_time: string }[]>([])
  const [reasons, setReasons]     = useState<string[]>([])
  const [tags, setTags]           = useState<string[]>([])
  const [newTag, setNewTag]       = useState('')
  const [locSaving, setLocSaving] = useState(false)
  const [locMsg, setLocMsg]       = useState<{ ok: boolean; text: string } | null>(null)

  // ── Offer form ───────────────────────────────────────────────────────────────
  const [offerAmount, setOfferAmount]           = useState('')
  const [offerDeadline, setOfferDeadline]       = useState('')
  const [offerDescription, setOfferDescription] = useState('')
  const [offerSaving, setOfferSaving]           = useState(false)
  const [offerMsg, setOfferMsg]                 = useState<{ ok: boolean; text: string } | null>(null)

  // ── Load ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [props, lds, { data: unlocks }, { data: plan }] = await Promise.all([
        getPropertiesByOwner(user.id),
        getLeadsForOwner(user.id),
        supabase.from('lead_unlocks').select('lead_id').eq('landlord_id', user.id),
        supabase.from('landlord_plans').select('plan_type, status').eq('landlord_id', user.id).eq('status', 'active').maybeSingle(),
      ])
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      const slugLeads = lds.filter(l => l.property === slug)
      const activePlan = plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)
      setProperty(found)
      setLeads(slugLeads)
      setHasPlan(!!activePlan)
      setUnlockedIds((unlocks || []).map((u: any) => u.lead_id))

      setBasics({
        name: found.name || '', address: found.address || '', description: found.description || '',
        price: found.price?.toString() || '', security_deposit: found.security_deposit?.toString() ?? '',
        beds: found.beds?.toString() || '', baths: found.baths?.toString() || '',
        sqft: found.sqft?.toString() || '', asu_distance: found.asu_distance?.toString() || '',
        utilities_included: found.utilities_included ?? false,
      })
      setListingType(found.listing_type || 'standard_rental')
      setSubleaseStart(found.sublease_start_date || '')
      setSubleaseEnd(found.sublease_end_date || '')
      setTotalRooms(found.total_rooms?.toString() || '')
      setAvailableRooms(found.available?.toString() || '')
      setLoc({ lat: found.lat?.toString() || '', lng: found.lng?.toString() || '', map_embed_url: found.map_embed_url || '' })
      setNearby(found.nearby || [])
      setReasons(found.asu_reasons || [])
      setTags(found.tags || [])
      setOfferAmount(found.offer_amount != null ? String(found.offer_amount) : '')
      setOfferDeadline(found.offer_deadline || '')
      setOfferDescription(found.offer_description || '')
      setLoading(false)
    }
    load()
  }, [slug, router])

  function flash(setter: (v: { ok: boolean; text: string } | null) => void, ok: boolean, text: string) {
    setter({ ok, text })
    setTimeout(() => setter(null), 3500)
  }

  // ── Save handlers ─────────────────────────────────────────────────────────
  async function saveBasics() {
    if (!property) return
    setBasicsSaving(true)
    const { error } = await updatePropertyCore(property.id, {
      name: basics.name, address: basics.address, description: basics.description,
      price: parseFloat(basics.price) || 0,
      security_deposit: basics.security_deposit === '' ? null : parseInt(basics.security_deposit),
      beds: parseInt(basics.beds) || 0, baths: parseFloat(basics.baths) || 0,
      sqft: basics.sqft, asu_distance: parseFloat(basics.asu_distance) || 0,
      utilities_included: basics.utilities_included,
    })
    setBasicsSaving(false)
    flash(setBasicsMsg, !error, error ? 'Failed to save. Try again.' : 'Basics saved!')
    if (!error) setProperty(p => p ? { ...p, name: basics.name, address: basics.address, description: basics.description, price: parseFloat(basics.price)||0, beds: parseInt(basics.beds)||0, baths: parseFloat(basics.baths)||0, sqft: basics.sqft, asu_distance: parseFloat(basics.asu_distance)||0, utilities_included: basics.utilities_included } : p)
  }

  async function saveType() {
    if (!property) return
    setTypeSaving(true)
    const { error } = await supabase.from('properties').update({
      listing_type:         listingType,
      sublease_start_date:  listingType !== 'standard_rental' ? subleaseStart || null : null,
      sublease_end_date:    listingType !== 'standard_rental' ? subleaseEnd   || null : null,
      total_rooms:          parseInt(totalRooms) || 1,
      available:            parseInt(availableRooms) || 0,
    }).eq('id', property.id)
    setTypeSaving(false)
    flash(setTypeMsg, !error, error ? 'Failed to save. Try again.' : 'Saved!')
    if (!error) setProperty(p => p ? { ...p, listing_type: listingType, total_rooms: parseInt(totalRooms)||1, available: parseInt(availableRooms)||0 } : p)
  }

  async function saveLocation() {
    if (!property) return
    setLocSaving(true)
    const [coreRes, nearbyRes, reasonsRes, tagsRes] = await Promise.all([
      updatePropertyCore(property.id, {
        lat: parseFloat(loc.lat) || 0, lng: parseFloat(loc.lng) || 0, map_embed_url: loc.map_embed_url,
      }),
      replacePropertyNearby(property.id, nearby.filter(n => n.place.trim())),
      replacePropertyAsuReasons(property.id, reasons.filter(r => r.trim())),
      replacePropertyTags(property.id, tags.filter(t => t.trim())),
    ])
    setLocSaving(false)
    const anyError = coreRes.error || nearbyRes.error || reasonsRes.error || tagsRes.error
    flash(setLocMsg, !anyError, anyError ? 'Failed to save. Try again.' : 'Location & details saved!')
  }

  async function saveOffer() {
    if (!property) return
    setOfferSaving(true)
    const { error } = await updatePropertyOffer(property.id, {
      offer_amount:      offerAmount === '' ? null : Number(offerAmount),
      offer_deadline:    offerDeadline || null,
      offer_description: offerDescription.trim() || null,
    })
    setOfferSaving(false)
    flash(setOfferMsg, !error, error ? 'Failed to save. Try again.' : 'Offer saved!')
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif", fontSize: '14px', color: '#9b9b9b' }}>
      Loading…
    </div>
  )
  if (!property) return null

  const { items: compItems, pct } = getCompleteness(property)
  const missing = compItems.filter(i => !i.filled)
  const isSublease = listingType !== 'standard_rental'

  return (
    <>
      <style>{SHARED_CSS}</style>
      <div className="lp-wrap">

        {/* STATUS BANNERS */}
        {property.admin_status === 'pending' && (
          <div className="status-banner" style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderLeft: '4px solid #f59e0b', marginBottom: '18px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#92400e', marginBottom: '4px' }}>In review — we&apos;ll email you within 24 hours</div>
            <div style={{ fontSize: '13px', color: '#78350f', lineHeight: 1.5 }}>Your listing is being reviewed. Complete all sections below to boost your approval odds and get more leads once live.</div>
          </div>
        )}
        {property.admin_status === 'rejected' && (
          <div className="status-banner" style={{ background: '#fff1f2', border: '1.5px solid #fecdd3', borderLeft: '4px solid #9f1239' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#9f1239', marginBottom: '4px' }}>Listing needs updates before going live</div>
            {property.review_note && <div style={{ fontSize: '13px', color: '#7f1d1d', marginTop: '6px' }}><strong>Note:</strong> &ldquo;{property.review_note}&rdquo;</div>}
            <div style={{ fontSize: '13px', color: '#7f1d1d', marginTop: '6px' }}>Contact us: <a href="mailto:hello@homehive.live" style={{ color: '#9f1239', fontWeight: 600 }}>hello@homehive.live</a></div>
          </div>
        )}
        {['inactive', 'test', 'flagged'].includes(property.admin_status) && (
          <div className="status-banner" style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderLeft: '4px solid #cbd5e1' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Not publicly visible</div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>Contact <a href="mailto:hello@homehive.live" style={{ color: '#475569', fontWeight: 600 }}>hello@homehive.live</a> if you believe this is an error.</div>
          </div>
        )}

        {/* BREADCRUMB + HEADER */}
        <div className="lp-breadcrumb">
          <a href="/landlord/listings">Listings</a> › {property.name}
        </div>
        <div className="lp-header">
          <div>
            <div className="lp-title">{property.name}</div>
            <div className="lp-title-sub">{property.address || 'No address set'}</div>
          </div>
          <div className="lp-header-actions">
            <a
              href={property.is_active ? `/homes/${property.slug}` : `/landlord/listings/${slug}/preview`}
              target="_blank" rel="noopener noreferrer"
              className="btn-preview"
            >
              {property.is_active ? 'View Live ↗' : 'Preview →'}
            </a>
            <span className="leads-badge">{leads.length} lead{leads.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* TABS */}
        <div className="lp-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`lp-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {t.id === 'type' && property.listing_type !== 'standard_rental' && (
                <span style={{ marginLeft: '6px', fontSize: '10px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>
                  {LISTING_TYPE_LABELS[property.listing_type]}
                </span>
              )}
              {t.id === 'offer' && property.offer_amount && (
                <span style={{ marginLeft: '6px', fontSize: '10px', background: '#fef9c3', color: '#92400e', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>ON</span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <>
            {/* Completeness */}
            <div className="lp-card">
              <div className="lp-card-hdr">
                <span className="lp-card-title">Listing Completeness</span>
                <span style={{ fontSize: '18px', fontWeight: 700, color: pct===100?'#10b981':pct>=60?'#f59e0b':'#ef4444' }}>{pct}%</span>
              </div>
              <div className="lp-card-body">
                <div className="comp-bar-track">
                  <div className="comp-bar-fill" style={{ width: `${pct}%`, background: pct===100?'#10b981':pct>=60?'#f59e0b':'#ef4444' }} />
                </div>
                {missing.length > 0 ? (
                  <div className="pill-list">
                    {missing.map(m => <span key={m.label} className="missing-pill">Missing: {m.label}</span>)}
                  </div>
                ) : (
                  <div style={{ fontSize: '13px', color: '#10b981', fontWeight: 600 }}>Listing is fully optimized!</div>
                )}
              </div>
            </div>

            {/* Snapshot */}
            <div className="lp-card">
              <div className="lp-card-hdr"><span className="lp-card-title">Snapshot</span></div>
              <div className="lp-card-body">
                <div className="detail-row">
                  <div className="detail-item">
                    <div className="detail-label">Status</div>
                    <span className={`badge ${property.is_active ? 'badge-green' : 'badge-grey'}`}>{property.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Listing Type</div>
                    <span className={`badge ${property.listing_type === 'standard_rental' ? 'badge-green' : property.listing_type === 'sublease' ? 'badge-maroon' : 'badge-blue'}`}>
                      {LISTING_TYPE_LABELS[property.listing_type] || property.listing_type}
                    </span>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Price</div>
                    <div className="detail-value">${property.price?.toLocaleString()}/mo</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Rooms</div>
                    <div className="detail-value">{property.available} of {property.total_rooms} available</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Beds / Baths</div>
                    <div className="detail-value">{property.beds}bd · {property.baths}ba</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">ASU Distance</div>
                    <div className="detail-value">{property.asu_distance ? `${property.asu_distance} mi` : '—'}</div>
                  </div>
                </div>
                {(property.sublease_start_date || property.sublease_end_date) && (
                  <div className="detail-row" style={{ marginTop: '12px' }}>
                    <div className="detail-item">
                      <div className="detail-label">Sublease Period</div>
                      <div className="detail-value">
                        {property.sublease_start_date ? new Date(property.sublease_start_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}
                        {' → '}
                        {property.sublease_end_date ? new Date(property.sublease_end_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}
                      </div>
                    </div>
                  </div>
                )}
                {property.tags?.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="detail-label" style={{ marginBottom: '6px' }}>Tags</div>
                    <div className="pill-list">{property.tags.map((t,i) => <span key={i} className="pill">{t}</span>)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Photos */}
            {property.images?.length > 0 && (
              <div className="lp-card">
                <div className="lp-card-hdr">
                  <span className="lp-card-title">Photos ({property.images.length})</span>
                  <a href={`/landlord/listings/${slug}/edit/media`} style={{ fontSize: '12px', color: '#10b981', textDecoration: 'none', fontWeight: 600 }}>Edit photos →</a>
                </div>
                <div className="lp-card-body">
                  <div className="media-grid">
                    {property.images.slice(0,6).map((img, i) => (
                      <img key={i} src={img} alt="" className="media-thumb" />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Leads */}
            <div className="lp-card">
              <div className="lp-card-hdr">
                <span className="lp-card-title">Leads ({leads.length})</span>
                {leads.length > 0 && (
                  <a href="/landlord/leads" style={{ fontSize: '12px', color: '#10b981', textDecoration: 'none', fontWeight: 600 }}>View all in CRM →</a>
                )}
              </div>
              <div className="lp-card-body" style={{ padding: 0 }}>
                <LeadsTable
                  leads={leads}
                  hasPlan={hasPlan}
                  initialUnlockedIds={unlockedIds}
                />
              </div>
            </div>
          </>
        )}

        {/* ── BASICS TAB ───────────────────────────────────────────────── */}
        {activeTab === 'basics' && (
          <div className="lp-card">
            <div className="lp-card-hdr"><span className="lp-card-title">Core Details</span></div>
            <div className="lp-card-body">
              {basicsMsg && <div className={basicsMsg.ok ? 'alert-ok' : 'alert-err'}>{basicsMsg.text}</div>}
              <div className="fg">
                <label className="fl">Property Name</label>
                <input className="fi" value={basics.name} onChange={e => setBasics(f=>({...f,name:e.target.value}))} placeholder="e.g. University Dr Palace" />
              </div>
              <div className="fg">
                <label className="fl">Address</label>
                <input className="fi" value={basics.address} onChange={e => setBasics(f=>({...f,address:e.target.value}))} placeholder="e.g. 820 W 9th St, Tempe AZ 85281" />
              </div>
              <div className="fg">
                <label className="fl">Description</label>
                <textarea className="ft" value={basics.description} onChange={e => setBasics(f=>({...f,description:e.target.value}))} placeholder="Describe your property — features, what's nearby, why students love it…" style={{ minHeight: 110 }} />
              </div>
              <div className="form-row">
                <div className="fg">
                  <label className="fl">Price per Month ($)</label>
                  <input className="fi" type="number" min="0" value={basics.price} onChange={e => setBasics(f=>({...f,price:e.target.value}))} placeholder="699" />
                </div>
                <div className="fg">
                  <label className="fl">Security Deposit ($)</label>
                  <input className="fi" type="number" min="0" value={basics.security_deposit} onChange={e => setBasics(f=>({...f,security_deposit:e.target.value}))} placeholder="0 for none" />
                  {basics.security_deposit === '0' && <div className="form-hint" style={{ color: '#10b981' }}>No deposit — shown as $0 on listing</div>}
                </div>
              </div>
              <div className="fg">
                <label className="fl">Utilities</label>
                <div
                  onClick={() => setBasics(f => ({ ...f, utilities_included: !f.utilities_included }))}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', border: `1.5px solid ${basics.utilities_included ? '#10b981' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', background: basics.utilities_included ? '#f0fdf4' : '#fff', transition: 'all 0.15s', userSelect: 'none' }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                      {basics.utilities_included ? 'Utilities included' : 'Utilities not included'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Water, electric, gas — covered in rent</div>
                  </div>
                  <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: basics.utilities_included ? '#10b981' : '#e2e8f0', transition: 'background 0.2s', position: 'relative', flexShrink: 0 }}>
                    <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', transition: 'left 0.2s', left: basics.utilities_included ? '21px' : '3px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                </div>
              </div>
              <div className="form-row-3">
                <div className="fg">
                  <label className="fl">Bedrooms</label>
                  <input className="fi" type="number" min="0" value={basics.beds} onChange={e => setBasics(f=>({...f,beds:e.target.value}))} placeholder="4" />
                </div>
                <div className="fg">
                  <label className="fl">Bathrooms</label>
                  <input className="fi" type="number" min="0" step="0.5" value={basics.baths} onChange={e => setBasics(f=>({...f,baths:e.target.value}))} placeholder="2" />
                </div>
                <div className="fg">
                  <label className="fl">Sqft</label>
                  <input className="fi" type="text" value={basics.sqft} onChange={e => setBasics(f=>({...f,sqft:e.target.value}))} placeholder="1200" />
                </div>
              </div>
              <div className="fg" style={{ maxWidth: 220 }}>
                <label className="fl">ASU Distance (miles)</label>
                <input className="fi" type="number" min="0" step="0.1" value={basics.asu_distance} onChange={e => setBasics(f=>({...f,asu_distance:e.target.value}))} placeholder="0.4" />
              </div>
              <div className="form-actions">
                <button className="btn-save" onClick={saveBasics} disabled={basicsSaving}>{basicsSaving ? 'Saving…' : 'Save Basics'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── TYPE & AVAILABILITY TAB ──────────────────────────────────── */}
        {activeTab === 'type' && (
          <div className="lp-card">
            <div className="lp-card-hdr"><span className="lp-card-title">Type &amp; Availability</span></div>
            <div className="lp-card-body">
              {typeMsg && <div className={typeMsg.ok ? 'alert-ok' : 'alert-err'}>{typeMsg.text}</div>}
              <div className="fg">
                <label className="fl">Listing Type</label>
                <select className="fs" value={listingType} onChange={e => setListingType(e.target.value as typeof listingType)}>
                  <option value="standard_rental">Standard Rental — fixed monthly rent</option>
                  <option value="sublease">Sublease — transferring your lease to someone else</option>
                  <option value="lease_transfer">Lease Transfer — someone takes over your full lease</option>
                </select>
                <div className="form-hint">
                  {listingType === 'standard_rental' && 'Students rent directly from you month-to-month or with a new lease.'}
                  {listingType === 'sublease' && 'You stay on the lease; a subletter pays you during a specific period.'}
                  {listingType === 'lease_transfer' && 'You fully transfer your remaining lease obligations to a new tenant.'}
                </div>
              </div>
              {isSublease && (
                <div className="form-row" style={{ marginTop: '4px' }}>
                  <div className="fg">
                    <label className="fl">Start Date</label>
                    <input className="fi" type="date" value={subleaseStart} onChange={e => setSubleaseStart(e.target.value)} />
                  </div>
                  <div className="fg">
                    <label className="fl">End Date</label>
                    <input className="fi" type="date" value={subleaseEnd} onChange={e => setSubleaseEnd(e.target.value)} />
                  </div>
                </div>
              )}
              <div className="form-row" style={{ marginTop: isSublease ? '0' : '4px', maxWidth: 320 }}>
                <div className="fg">
                  <label className="fl">Total Rooms</label>
                  <input className="fi" type="number" min="1" value={totalRooms} onChange={e => setTotalRooms(e.target.value)} placeholder="4" />
                </div>
                <div className="fg">
                  <label className="fl">Available Rooms</label>
                  <input className="fi" type="number" min="0" value={availableRooms} onChange={e => setAvailableRooms(e.target.value)} placeholder="2" />
                </div>
              </div>
              <div className="form-actions">
                <button className="btn-save" onClick={saveType} disabled={typeSaving}>{typeSaving ? 'Saving…' : 'Save Type & Availability'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── LOCATION & DETAILS TAB ───────────────────────────────────── */}
        {activeTab === 'location' && (
          <>
            {locMsg && <div className={locMsg.ok ? 'alert-ok' : 'alert-err'}>{locMsg.text}</div>}

            <div className="lp-card">
              <div className="lp-card-hdr"><span className="lp-card-title">Map & Coordinates</span></div>
              <div className="lp-card-body">
                <div className="form-row">
                  <div className="fg">
                    <label className="fl">Latitude</label>
                    <input className="fi" type="number" step="any" value={loc.lat} onChange={e => setLoc(l=>({...l,lat:e.target.value}))} placeholder="33.4152" />
                  </div>
                  <div className="fg">
                    <label className="fl">Longitude</label>
                    <input className="fi" type="number" step="any" value={loc.lng} onChange={e => setLoc(l=>({...l,lng:e.target.value}))} placeholder="-111.9090" />
                  </div>
                </div>
                <div className="fg">
                  <label className="fl">Map Embed URL</label>
                  <input className="fi" type="url" value={loc.map_embed_url} onChange={e => setLoc(l=>({...l,map_embed_url:e.target.value}))} placeholder="https://maps.google.com/maps?..." />
                </div>
              </div>
            </div>

            <div className="lp-card">
              <div className="lp-card-hdr"><span className="lp-card-title">Nearby Places</span></div>
              <div className="lp-card-body">
                <div className="list-editor">
                  {nearby.map((n, i) => (
                    <div key={i} className="list-row">
                      <input className="fi" value={n.place} onChange={e => setNearby(arr => arr.map((x,j)=>j===i?{...x,place:e.target.value}:x))} placeholder="Place name (e.g. Chipotle)" />
                      <input className="fi fi-sm" value={n.travel_time} onChange={e => setNearby(arr => arr.map((x,j)=>j===i?{...x,travel_time:e.target.value}:x))} placeholder="5 min walk" />
                      <button className="btn-rm" onClick={() => setNearby(arr=>arr.filter((_,j)=>j!==i))}>×</button>
                    </div>
                  ))}
                </div>
                <button className="btn-add" onClick={() => setNearby(arr=>[...arr,{place:'',travel_time:''}])}>+ Add place</button>
              </div>
            </div>

            <div className="lp-card">
              <div className="lp-card-hdr"><span className="lp-card-title">ASU Highlights</span></div>
              <div className="lp-card-body">
                <div className="list-editor">
                  {reasons.map((r, i) => (
                    <div key={i} className="list-row">
                      <input className="fi" value={r} onChange={e => setReasons(arr=>arr.map((x,j)=>j===i?e.target.value:x))} placeholder="e.g. 5-min walk to Sun Devil Stadium" />
                      <button className="btn-rm" onClick={() => setReasons(arr=>arr.filter((_,j)=>j!==i))}>×</button>
                    </div>
                  ))}
                </div>
                <button className="btn-add" onClick={() => setReasons(arr=>[...arr,''])}>+ Add highlight</button>
              </div>
            </div>

            <div className="lp-card">
              <div className="lp-card-hdr"><span className="lp-card-title">Tags</span></div>
              <div className="lp-card-body">
                <div className="pill-list" style={{ marginBottom: '10px' }}>
                  {tags.map((t, i) => (
                    <span key={i} className="pill" style={{ cursor: 'pointer' }} onClick={() => setTags(arr=>arr.filter((_,j)=>j!==i))}>
                      {t} ×
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="fi" value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="e.g. Pool, Parking, Furnished" onKeyDown={e => { if (e.key==='Enter' && newTag.trim()) { setTags(arr=>[...arr,newTag.trim()]); setNewTag('') }}} style={{ maxWidth: 260 }} />
                  <button className="btn-add" style={{ marginTop: 0 }} onClick={() => { if (newTag.trim()) { setTags(arr=>[...arr,newTag.trim()]); setNewTag('') }}}>Add</button>
                </div>
                <div className="form-hint">Press Enter or click Add. Click a tag to remove it.</div>
              </div>
            </div>

            <div className="lp-card" style={{ border: '1.5px dashed #e2e8f0', background: '#fafafa' }}>
              <div className="lp-card-hdr" style={{ borderBottom: 'none' }}>
                <span className="lp-card-title">Photos</span>
                <a href={`/landlord/listings/${slug}/edit/media`} className="btn-preview">Manage photos →</a>
              </div>
              <div className="lp-card-body" style={{ paddingTop: 0 }}>
                {property.images?.length > 0 ? (
                  <div className="media-grid">{property.images.slice(0,4).map((img,i)=><img key={i} src={img} alt="" className="media-thumb" />)}</div>
                ) : (
                  <div style={{ fontSize: '13px', color: '#94a3b8' }}>No photos yet — photos significantly increase leads.</div>
                )}
              </div>
            </div>

            <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
              <button className="btn-save" onClick={saveLocation} disabled={locSaving}>{locSaving ? 'Saving…' : 'Save Location & Details'}</button>
            </div>
          </>
        )}

        {/* ── OFFER TAB ────────────────────────────────────────────────── */}
        {activeTab === 'offer' && (
          <div className="lp-card">
            <div className="lp-card-hdr">
              <span className="lp-card-title">Special Offer</span>
              {offerAmount
                ? <span className="badge badge-teal">Active</span>
                : <span style={{ fontSize: '11px', color: '#94a3b8' }}>Optional</span>
              }
            </div>
            <div className="lp-card-body">
              <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.55, marginBottom: '18px' }}>
                Add a cash credit offer to your listing. It shows as an eye-catching banner and pushes students to inquire faster.
              </p>
              {offerMsg && <div className={offerMsg.ok ? 'alert-ok' : 'alert-err'}>{offerMsg.text}</div>}
              <div className="form-row">
                <div className="fg">
                  <label className="fl">Cash Credit Amount ($)</label>
                  <input className="fi" type="number" min="0" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} placeholder="e.g. 500" />
                </div>
                <div className="fg">
                  <label className="fl">Sign-by Deadline</label>
                  <input className="fi" type="date" value={offerDeadline} onChange={e => setOfferDeadline(e.target.value)} />
                </div>
              </div>
              <div className="fg">
                <label className="fl">Offer Description</label>
                <input className="fi" type="text" value={offerDescription} onChange={e => setOfferDescription(e.target.value)} placeholder="e.g. Cash credit applied at lease signing" />
              </div>
              <div className="form-actions">
                <button className="btn-save" onClick={saveOffer} disabled={offerSaving}>{offerSaving ? 'Saving…' : 'Save Offer'}</button>
                {offerAmount && (
                  <button onClick={() => { setOfferAmount(''); setOfferDeadline(''); setOfferDescription('') }} style={{ background: 'none', border: 'none', fontSize: '13px', color: '#94a3b8', cursor: 'pointer', textDecoration: 'underline' }}>
                    Remove offer
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── CALENDAR TAB ─────────────────────────────────────────────── */}
        {activeTab === 'calendar' && property && (
          <div className="lp-card">
            <div className="lp-card-hdr">
              <span className="lp-card-title">Tour Calendar</span>
            </div>
            <div className="lp-card-body">
              <p style={{ fontSize: '14px', color: '#4a4a4a', lineHeight: 1.7, marginBottom: '20px' }}>
                Set your available time slots for the next 7 days. Tenants you invite will be able to pick a 30-minute window to tour <strong>{property.name}</strong>.
              </p>
              <a
                href={`/landlord/listings/${property.slug}/calendar`}
                style={{ display: 'inline-block', background: '#1a1a1a', color: '#FFC627', textDecoration: 'none', fontSize: '15px', fontWeight: 700, padding: '14px 32px', borderRadius: '10px' }}
              >
                📅 Open Tour Calendar →
              </a>
              <p style={{ marginTop: '14px', fontSize: '12px', color: '#9b9b9b', lineHeight: 1.6 }}>
                The calendar opens in a focused view for easy drag-and-select scheduling. Come back here when done.
              </p>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
