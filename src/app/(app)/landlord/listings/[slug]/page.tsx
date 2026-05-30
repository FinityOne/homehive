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
  replacePropertyRooms,
  Property,
} from '@/lib/properties'
import type { Lead } from '@/lib/leads'

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

  /* RENTAL MODE SELECTOR */
  .rent-mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
  .rent-mode-opt { border: 2px solid #e2e8f0; border-radius: 10px; padding: 13px 14px; cursor: pointer; text-align: left; background: #fff; font-family: 'DM Sans', sans-serif; transition: border-color 0.15s, background 0.15s; width: 100%; }
  .rent-mode-opt:hover { border-color: #94a3b8; }
  .rent-mode-opt.selected { border-color: #10b981; background: #f0fdf4; }
  .rent-mode-title { font-size: 13px; font-weight: 600; color: #0f172a; margin-bottom: 2px; }
  .rent-mode-opt.selected .rent-mode-title { color: #166534; }
  .rent-mode-desc { font-size: 11px; color: #64748b; line-height: 1.4; }

  /* ROOM BUILDER */
  .room-builder { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-top: 6px; }
  .room-builder-hdr { display: grid; grid-template-columns: 1fr 110px 80px 30px; gap: 8px; margin-bottom: 7px; padding: 0 2px; }
  .room-col-lbl { font-size: 10px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; }
  .room-build-row { display: grid; grid-template-columns: 1fr 110px 80px 30px; gap: 8px; align-items: center; margin-bottom: 7px; }
  .room-avail-toggle { padding: 7px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1.5px solid; font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: all 0.15s; }
  .room-avail-toggle.open { border-color: #10b981; background: #f0fdf4; color: #10b981; }
  .room-avail-toggle.filled { border-color: #e2e8f0; background: #fff; color: #94a3b8; }
  .room-summary-bar { display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-top: 10px; }
  .room-price-readonly { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 9px 12px; font-size: 14px; color: #0f172a; font-weight: 500; }

  @media (max-width: 560px) {
    .lp-header { flex-direction: column; }
    .form-row, .form-row-3 { grid-template-columns: 1fr; }
    .rent-mode-grid { grid-template-columns: 1fr; }
    .room-builder-hdr { grid-template-columns: 1fr 90px; }
    .room-build-row { grid-template-columns: 1fr 90px; }
  }
`

export default function ManagePropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router   = useRouter()

  const [property, setProperty]     = useState<Property | null>(null)
  const [leads, setLeads]           = useState<Lead[]>([])
  const [leadsPage, setLeadsPage]   = useState(1)
  const [leadsTotal, setLeadsTotal] = useState(0)
  const [leadsLoading, setLeadsLoading] = useState(false)
  const LEADS_PAGE_SIZE = 20
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
  const [availableFrom, setAvailableFrom]       = useState('')
  const [totalRooms, setTotalRooms]             = useState('')
  const [availableRooms, setAvailableRooms]     = useState('')
  const [typeSaving, setTypeSaving]             = useState(false)
  const [typeMsg, setTypeMsg]                   = useState<{ ok: boolean; text: string } | null>(null)

  // ── Rental mode & room builder ───────────────────────────────────────────────
  type RoomRow = { name: string; price: string; is_available: boolean }
  const [rentalMode, setRentalMode]             = useState<'whole_home' | 'by_room'>('whole_home')
  const [rooms, setRooms]                       = useState<RoomRow[]>([{ name: '', price: '', is_available: true }])

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

  useEffect(() => { document.title = 'Listing Details — Landlord | HomeHive' }, [])

  // ── Load ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [props, { data: unlocks }, { data: plan }] = await Promise.all([
        getPropertiesByOwner(user.id),
        supabase.from('lead_unlocks').select('lead_id').eq('landlord_id', user.id),
        supabase.from('landlord_plans').select('plan_type, status').eq('landlord_id', user.id).eq('status', 'active').maybeSingle(),
      ])
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      const activePlan = plan && ['single_listing', 'two_listing', 'lifetime'].includes(plan.plan_type)
      setProperty(found)
      setHasPlan(!!activePlan)
      setUnlockedIds((unlocks || []).map((u: any) => u.lead_id))

      // Fetch first page of leads for this property
      const { data: firstPage, count } = await supabase
        .from('leads')
        .select('*', { count: 'exact' })
        .eq('property', slug)
        .order('created_at', { ascending: false })
        .range(0, LEADS_PAGE_SIZE - 1)
      setLeads(firstPage ?? [])
      setLeadsTotal(count ?? 0)

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
      setAvailableFrom(found.available_from || '')
      setTotalRooms(found.total_rooms?.toString() || '')
      setAvailableRooms(found.available?.toString() || '')
      setRentalMode(found.rental_mode ?? 'whole_home')
      if (found.rooms && found.rooms.length > 0) {
        setRooms(found.rooms.map(r => ({ name: r.name, price: r.price.toString(), is_available: r.is_available })))
      }
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

  // Re-fetch when page changes (after initial load)
  useEffect(() => {
    if (leadsPage === 1 || loading) return
    const fetchPage = async () => {
      setLeadsLoading(true)
      const from = (leadsPage - 1) * LEADS_PAGE_SIZE
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('property', slug)
        .order('created_at', { ascending: false })
        .range(from, from + LEADS_PAGE_SIZE - 1)
      setLeads(data ?? [])
      setLeadsLoading(false)
    }
    fetchPage()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadsPage, slug])

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

    const baseUpdate = {
      listing_type:        listingType,
      sublease_start_date: listingType !== 'standard_rental' ? subleaseStart || null : null,
      sublease_end_date:   listingType !== 'standard_rental' ? subleaseEnd   || null : null,
      available_from:      listingType === 'standard_rental' ? availableFrom || null : null,
      rental_mode:         rentalMode,
    }

    if (rentalMode === 'by_room') {
      const validRooms = rooms.filter(r => Number(r.price) > 0)
      if (validRooms.length === 0) {
        flash(setTypeMsg, false, 'Add at least one room with a price.')
        setTypeSaving(false)
        return
      }
      const [modeRes, roomsRes] = await Promise.all([
        supabase.from('properties').update(baseUpdate).eq('id', property.id),
        replacePropertyRooms(
          property.id,
          validRooms.map((r, i) => ({
            name: r.name.trim() || `Room ${i + 1}`,
            price: Number(r.price),
            is_available: r.is_available,
          })),
          true  // sync price/total_rooms/available on property
        ),
      ])
      const err = modeRes.error || roomsRes.error
      setTypeSaving(false)
      flash(setTypeMsg, !err, err ? 'Failed to save. Try again.' : 'Rooms & availability saved!')
      if (!err) {
        const minPrice = Math.min(...validRooms.map(r => Number(r.price)).filter(p => p > 0))
        setProperty(p => p ? {
          ...p,
          listing_type: listingType,
          rental_mode: 'by_room',
          total_rooms: validRooms.length,
          available: validRooms.filter(r => r.is_available).length,
          price: minPrice || p.price,
          rooms: validRooms.map((r, i) => ({ id: '', property_id: p.id, name: r.name.trim() || `Room ${i + 1}`, price: Number(r.price), is_available: r.is_available, position: i, images: [] })),
        } : p)
      }
    } else {
      const { error } = await supabase.from('properties').update({
        ...baseUpdate,
        total_rooms: parseInt(totalRooms) || 1,
        available:   parseInt(availableRooms) || 0,
      }).eq('id', property.id)
      setTypeSaving(false)
      flash(setTypeMsg, !error, error ? 'Failed to save. Try again.' : 'Saved!')
      if (!error) setProperty(p => p ? { ...p, listing_type: listingType, rental_mode: 'whole_home', total_rooms: parseInt(totalRooms)||1, available: parseInt(availableRooms)||0 } : p)
    }
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
                    <div className="detail-label">Rental Type</div>
                    <span className={`badge ${property.rental_mode === 'by_room' ? 'badge-blue' : 'badge-teal'}`}>
                      {property.rental_mode === 'by_room' ? 'By room' : 'Entire property'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Price</div>
                    <div className="detail-value">
                      {property.rental_mode === 'by_room'
                        ? `from $${property.price?.toLocaleString()}/mo`
                        : `$${property.price?.toLocaleString()}/mo`}
                    </div>
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
                {property.available_from && property.listing_type === 'standard_rental' && (
                  <div className="detail-row" style={{ marginTop: '12px' }}>
                    <div className="detail-item">
                      <div className="detail-label">Available From</div>
                      <div className="detail-value" style={{ color: '#059669', fontWeight: 600 }}>
                        {new Date(property.available_from + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                  </div>
                )}
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

            {/* Room breakdown — by_room mode */}
            {property.rental_mode === 'by_room' && property.rooms && property.rooms.length > 0 && (
              <div className="lp-card">
                <div className="lp-card-hdr">
                  <span className="lp-card-title">Rooms / Units ({property.rooms.length})</span>
                  <button onClick={() => setActiveTab('type')} style={{ fontSize: '12px', color: '#10b981', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Edit rooms →</button>
                </div>
                <div className="lp-card-body" style={{ padding: '0' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8', padding: '10px 18px', textAlign: 'left', borderBottom: '1px solid #f1f5f9' }}>Room / Unit</th>
                        <th style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8', padding: '10px 18px', textAlign: 'right', borderBottom: '1px solid #f1f5f9' }}>Price/mo</th>
                        <th style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8', padding: '10px 18px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {property.rooms.map((room, i) => (
                        <tr key={room.id || i}>
                          <td style={{ fontSize: '13px', color: '#0f172a', padding: '10px 18px', borderBottom: i < property.rooms.length - 1 ? '1px solid #f9fafb' : 'none', fontWeight: 500 }}>
                            {room.name || `Room ${i + 1}`}
                          </td>
                          <td style={{ fontSize: '13px', color: '#0f172a', padding: '10px 18px', textAlign: 'right', borderBottom: i < property.rooms.length - 1 ? '1px solid #f9fafb' : 'none', fontWeight: 600 }}>
                            ${room.price.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px 18px', textAlign: 'center', borderBottom: i < property.rooms.length - 1 ? '1px solid #f9fafb' : 'none' }}>
                            <span className={`badge ${room.is_available ? 'badge-green' : 'badge-grey'}`}>
                              {room.is_available ? 'Open' : 'Filled'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #e2e8f0' }}>
                        <td style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', padding: '10px 18px' }}>
                          {property.rooms.filter(r => r.is_available).length} of {property.rooms.length} available
                        </td>
                        <td style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', padding: '10px 18px', textAlign: 'right' }}>
                          ${property.rooms.reduce((s, r) => s + r.price, 0).toLocaleString()}/mo total
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

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
                <span className="lp-card-title">Leads ({leadsTotal})</span>
                {leadsTotal > 0 && (
                  <a href="/landlord/leads" style={{ fontSize: '12px', color: '#10b981', textDecoration: 'none', fontWeight: 600 }}>View all in CRM →</a>
                )}
              </div>
              <div className="lp-card-body" style={{ padding: 0, position: 'relative' }}>
                {leadsLoading && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.6)', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: 13, color: '#9b9b9b', fontFamily: "'DM Sans', sans-serif" }}>Loading…</div>
                  </div>
                )}
                <LeadsTable
                  leads={leads}
                  hasPlan={hasPlan}
                  initialUnlockedIds={unlockedIds}
                />
                {leadsTotal > LEADS_PAGE_SIZE && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontFamily: "'DM Sans', sans-serif" }}>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      {(leadsPage - 1) * LEADS_PAGE_SIZE + 1}–{Math.min(leadsPage * LEADS_PAGE_SIZE, leadsTotal)} of {leadsTotal} leads
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        disabled={leadsPage === 1}
                        onClick={() => setLeadsPage(p => p - 1)}
                        style={{ padding: '5px 12px', border: '1.5px solid #e8e5de', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, cursor: leadsPage === 1 ? 'not-allowed' : 'pointer', opacity: leadsPage === 1 ? 0.4 : 1, fontFamily: "'DM Sans', sans-serif", color: '#4a4a4a' }}
                      >← Prev</button>
                      <span style={{ fontSize: 12, color: '#6b6b6b', fontWeight: 600, alignSelf: 'center' }}>
                        Page {leadsPage} of {Math.ceil(leadsTotal / LEADS_PAGE_SIZE)}
                      </span>
                      <button
                        disabled={leadsPage >= Math.ceil(leadsTotal / LEADS_PAGE_SIZE)}
                        onClick={() => setLeadsPage(p => p + 1)}
                        style={{ padding: '5px 12px', border: '1.5px solid #e8e5de', borderRadius: 6, background: '#fff', fontSize: 12, fontWeight: 600, cursor: leadsPage >= Math.ceil(leadsTotal / LEADS_PAGE_SIZE) ? 'not-allowed' : 'pointer', opacity: leadsPage >= Math.ceil(leadsTotal / LEADS_PAGE_SIZE) ? 0.4 : 1, fontFamily: "'DM Sans', sans-serif", color: '#4a4a4a' }}
                      >Next →</button>
                    </div>
                  </div>
                )}
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
                  {rentalMode === 'by_room' ? (
                    <>
                      <div className="room-price-readonly">
                        {property && property.price > 0 ? `from $${property.price.toLocaleString()}` : '—'}
                      </div>
                      <div className="form-hint">Auto-calculated from room prices — edit in <button onClick={() => setActiveTab('type')} style={{ color: '#10b981', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}>Type &amp; Availability</button></div>
                    </>
                  ) : (
                    <input className="fi" type="number" min="0" value={basics.price} onChange={e => setBasics(f=>({...f,price:e.target.value}))} placeholder="699" />
                  )}
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

              {/* Listing type */}
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

              {/* Sublease dates */}
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

              {/* Available from — standard rentals */}
              {listingType === 'standard_rental' && (
                <div className="fg" style={{ marginTop: '8px', maxWidth: 220 }}>
                  <label className="fl">Available From</label>
                  <input
                    className="fi"
                    type="date"
                    value={availableFrom}
                    onChange={e => setAvailableFrom(e.target.value)}
                  />
                  <div className="form-hint">Shown on the listing so renters know when they can move in.</div>
                </div>
              )}

              {/* Rental mode — only for standard rentals */}
              {listingType === 'standard_rental' && (
                <div className="fg" style={{ marginTop: '8px' }}>
                  <label className="fl">How do you charge rent?</label>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>Works for single rooms, whole houses, and apartment complexes.</div>
                  <div className="rent-mode-grid">
                    <button
                      className={`rent-mode-opt${rentalMode === 'whole_home' ? ' selected' : ''}`}
                      onClick={() => setRentalMode('whole_home')}
                    >
                      <div className="rent-mode-title">Entire property</div>
                      <div className="rent-mode-desc">One price for the whole unit. You control total & available room counts.</div>
                    </button>
                    <button
                      className={`rent-mode-opt${rentalMode === 'by_room' ? ' selected' : ''}`}
                      onClick={() => setRentalMode('by_room')}
                    >
                      <div className="rent-mode-title">By room / by unit</div>
                      <div className="rent-mode-desc">Each bedroom or unit has its own name and price. Total & available auto-calculate.</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Whole-home: simple room count inputs */}
              {(rentalMode === 'whole_home' || listingType !== 'standard_rental') && (
                <div className="form-row" style={{ maxWidth: 320, marginTop: '8px' }}>
                  <div className="fg">
                    <label className="fl">Total Rooms</label>
                    <input className="fi" type="number" min="1" value={totalRooms} onChange={e => setTotalRooms(e.target.value)} placeholder="4" />
                  </div>
                  <div className="fg">
                    <label className="fl">Available Rooms</label>
                    <input className="fi" type="number" min="0" value={availableRooms} onChange={e => setAvailableRooms(e.target.value)} placeholder="2" />
                  </div>
                </div>
              )}

              {/* By-room: full room builder */}
              {rentalMode === 'by_room' && listingType === 'standard_rental' && (
                <div className="fg" style={{ marginTop: '8px' }}>
                  <label className="fl">Rooms / Units</label>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                    Name each room or unit (optional) and set its monthly price. Toggle Open/Filled to track availability.
                  </div>
                  <div className="room-builder">
                    {/* Column headers */}
                    <div className="room-builder-hdr">
                      <div className="room-col-lbl">Room / Unit name</div>
                      <div className="room-col-lbl">Price/mo ($)</div>
                      <div className="room-col-lbl">Status</div>
                      <div />
                    </div>

                    {rooms.map((room, i) => (
                      <div key={i} className="room-build-row">
                        <input
                          className="fi"
                          type="text"
                          placeholder={i === 0 ? 'e.g. Master Bedroom' : i === 1 ? 'e.g. Room B' : `e.g. Unit ${101 + i}`}
                          value={room.name}
                          onChange={e => setRooms(rs => rs.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                        />
                        <input
                          className="fi"
                          type="number"
                          min="1"
                          placeholder="700"
                          value={room.price}
                          onChange={e => setRooms(rs => rs.map((r, j) => j === i ? { ...r, price: e.target.value } : r))}
                        />
                        <button
                          className={`room-avail-toggle ${room.is_available ? 'open' : 'filled'}`}
                          onClick={() => setRooms(rs => rs.map((r, j) => j === i ? { ...r, is_available: !r.is_available } : r))}
                          title="Toggle availability"
                        >
                          {room.is_available ? 'Open' : 'Filled'}
                        </button>
                        {rooms.length > 1 ? (
                          <button className="btn-rm" onClick={() => setRooms(rs => rs.filter((_, j) => j !== i))} title="Remove">×</button>
                        ) : (
                          <div />
                        )}
                      </div>
                    ))}

                    <button
                      className="btn-add"
                      style={{ width: '100%', marginTop: '4px' }}
                      onClick={() => setRooms(rs => [...rs, { name: '', price: '', is_available: true }])}
                    >
                      + Add room / unit
                    </button>

                    {/* Running summary */}
                    {rooms.some(r => Number(r.price) > 0) && (() => {
                      const valid = rooms.filter(r => Number(r.price) > 0)
                      const total = valid.reduce((s, r) => s + Number(r.price), 0)
                      const minP  = Math.min(...valid.map(r => Number(r.price)))
                      const avail = rooms.filter(r => r.is_available).length
                      return (
                        <div className="room-summary-bar">
                          <div>
                            <div style={{ fontSize: '12px', color: '#64748b' }}>{avail} of {rooms.length} rooms available</div>
                            <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px' }}>Listing shows "from ${minP.toLocaleString()}/mo"</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Total potential rent</div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>${total.toLocaleString()}/mo</div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

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
