'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { getProperties, Property } from '@/lib/properties'
import { usePostHog } from 'posthog-js/react'

// ─── FILTER STATE ────────────────────────────────────────────────────────────
type Filters = {
  maxPrice: number
  minBeds: number
  maxDistance: number   // miles from ASU
  search: string
}

const DEFAULT_FILTERS: Filters = {
  maxPrice: 2000,
  minBeds: 1,
  maxDistance: 5,
  search: '',
}

// ─── LANDMARKS ───────────────────────────────────────────────────────────────
const LANDMARKS = [
  { coords: [33.4242, -111.9281] as [number, number], label: '⚡ ASU', color: '#8C1D40', textColor: '#FFC627', border: '#FFC627', description: 'Arizona State University' },
  { coords: [33.3955, -111.9459] as [number, number], label: '⛰ A Mountain', color: '#fff', textColor: '#1a1a1a', border: '#e8e4db', description: 'Hayden Butte / A Mountain' },
  { coords: [33.4265, -111.9403] as [number, number], label: '🌯 Chipotle', color: '#fff', textColor: '#7B341E', border: '#e8e4db', description: 'Chipotle — Mill Ave' },
  { coords: [33.4152, -111.9090] as [number, number], label: '🌯 Chipotle', color: '#fff', textColor: '#7B341E', border: '#e8e4db', description: 'Chipotle — Rural Rd' },
  { coords: [33.4268, -111.9397] as [number, number], label: '🚉 Light Rail', color: '#fff', textColor: '#1a73e8', border: '#e8e4db', description: 'Mill Ave / 3rd St Station' },
  { coords: [33.4177, -111.9090] as [number, number], label: '🚉 Light Rail', color: '#fff', textColor: '#1a73e8', border: '#e8e4db', description: 'University Dr / Rural Rd Station' },
  { coords: [33.4338, -111.9399] as [number, number], label: '🏪 Trader Joe\'s', color: '#fff', textColor: '#c41e3a', border: '#e8e4db', description: 'Trader Joe\'s — Tempe' },
]

// ─── LEAFLET MAP ─────────────────────────────────────────────────────────────
function HomesMap({ homes, hoveredId }: { homes: Property[]; hoveredId: string | null }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  function makePinHtml(slug: string, price: number, active = false) {
    const bg = active ? '#8C1D40' : '#1a1a1a'
    const scale = active ? 'scale(1.12)' : 'scale(1)'
    const shadow = active ? '0 4px 16px rgba(140,29,64,0.45)' : '0 2px 8px rgba(0,0,0,0.22)'
    return `
      <div class="map-pin" data-id="${slug}" style="
        background:${bg};color:#fff;
        font-size:12px;font-weight:700;
        padding:6px 11px;border-radius:8px;
        white-space:nowrap;cursor:pointer;
        border:2px solid rgba(255,255,255,0.9);
        box-shadow:${shadow};
        font-family:'DM Sans',sans-serif;
        transform:${scale};
        transition:all 0.15s ease;
        letter-spacing:-0.2px;
        position:relative;
      ">
        $${price.toLocaleString()}<span style="font-weight:400;opacity:0.75;font-size:10px;">/mo</span>
        <div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);
          width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;
          border-top:7px solid ${bg};"></div>
      </div>`
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    import('leaflet').then(L => {
      delete (L.Icon.Default.prototype as any)._getIconUrl

      const map = L.map(mapRef.current!, {
        center: [33.415, -111.940],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
      })

      // Clean CartoDB Positron tiles — light grey, minimal, elegant
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)

      // Minimal attribution bottom-left
      L.control.attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('© <a href="https://openstreetmap.org">OSM</a> © <a href="https://carto.com">CARTO</a>')
        .addTo(map)

      L.control.zoom({ position: 'bottomright' }).addTo(map)

      // Landmarks
      LANDMARKS.forEach(lm => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            background:${lm.color};color:${lm.textColor};
            font-size:11px;font-weight:600;
            padding:4px 9px;border-radius:20px;
            white-space:nowrap;
            border:1.5px solid ${lm.border};
            box-shadow:0 1px 4px rgba(0,0,0,0.12);
            font-family:'DM Sans',sans-serif;
          ">${lm.label}</div>`,
          iconAnchor: [0, 0],
        })
        L.marker(lm.coords, { icon, interactive: false }).addTo(map)
          .bindTooltip(lm.description, { permanent: false, direction: 'top', className: 'lm-tooltip' })
      })

      mapInstanceRef.current = { map, L }
      addMarkers(homes, L, map)
    })

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.map.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  function addMarkers(homeList: Property[], L: any, map: any) {
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    homeList.forEach(home => {
      if (!home.lat || !home.lng) return
      const icon = L.divIcon({
        className: '',
        html: makePinHtml(home.slug, home.price, false),
        iconAnchor: [40, 38],
      })
      const marker = L.marker([home.lat, home.lng] as [number, number], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:200px;padding:4px 0;">
            ${home.images?.[0] ? `<img src="${home.images[0]}" style="width:100%;height:110px;object-fit:cover;border-radius:6px;margin-bottom:10px;" />` : ''}
            <div style="font-weight:700;font-size:14px;color:#1a1a1a;margin-bottom:3px;">${home.name}</div>
            <div style="font-size:11px;color:#9b9b9b;margin-bottom:8px;">📍 ${home.address}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="font-size:16px;font-weight:700;color:#8C1D40;">$${home.price.toLocaleString()}<span style="font-size:11px;font-weight:400;color:#9b9b9b;">/mo</span></span>
              <span style="font-size:11px;background:#fdf2f5;color:#8C1D40;padding:2px 8px;border-radius:20px;font-weight:600;">${home.available} rooms open</span>
            </div>
            <a href="/homes/${home.slug}" style="display:block;background:#8C1D40;color:#fff;padding:9px 12px;border-radius:7px;text-decoration:none;text-align:center;font-size:13px;font-weight:700;letter-spacing:0.1px;">View home →</a>
          </div>
        `, { maxWidth: 240, className: 'home-popup' })
      markersRef.current.push(marker)
    })
  }

  useEffect(() => {
    if (!mapInstanceRef.current) return
    const { L, map } = mapInstanceRef.current
    addMarkers(homes, L, map)
  }, [homes])

  // Live pin highlight on card hover
  useEffect(() => {
    if (!mapInstanceRef.current) return
    const { L } = mapInstanceRef.current
    markersRef.current.forEach(marker => {
      const el = marker.getElement()?.querySelector('.map-pin') as HTMLElement | null
      if (!el) return
      const id = el.getAttribute('data-id')
      const home = homes.find(h => h.slug === id)
      if (!home) return
      const isActive = id === hoveredId
      el.innerHTML = makePinHtml(id!, home.price, isActive).match(/<div[^>]*>([\s\S]*)<\/div>/)?.[0] || el.innerHTML
      // Re-set icon so Leaflet re-renders
      marker.setIcon(L.divIcon({
        className: '',
        html: makePinHtml(id!, home.price, isActive),
        iconAnchor: [40, 38],
      }))
    })
  }, [hoveredId])

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>{`
        .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 8px 32px rgba(0,0,0,0.14) !important; border: 1px solid #e8e4db; padding: 0 !important; overflow: hidden; }
        .leaflet-popup-content { margin: 12px 14px !important; }
        .leaflet-popup-tip-container { display: none; }
        .lm-tooltip { background: #1a1a1a; color: #fff; border: none; border-radius: 6px; font-family: 'DM Sans', sans-serif; font-size: 12px; padding: 4px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
        .lm-tooltip::before { display: none; }
        .leaflet-control-zoom { border: 1px solid #e8e4db !important; border-radius: 8px !important; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important; }
        .leaflet-control-zoom a { color: #1a1a1a !important; font-size: 16px !important; }
        .leaflet-control-attribution { font-size: 9px !important; background: rgba(255,255,255,0.7) !important; backdrop-filter: blur(4px); border-radius: 6px !important; padding: 2px 6px !important; }
      `}</style>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </>
  )
}

// ─── LISTING TYPE CONFIG ─────────────────────────────────────────────────────
const TYPE_CONFIG = {
  standard_rental: { label: 'For Rent',       bg: 'rgba(220,252,231,0.95)', color: '#166534', border: 'rgba(187,247,208,0.9)' },
  sublease:        { label: 'Sublease',        bg: 'rgba(253,242,245,0.95)', color: '#8C1D40', border: 'rgba(245,198,208,0.9)' },
  lease_transfer:  { label: 'Lease Transfer',  bg: 'rgba(239,246,255,0.95)', color: '#1d4ed8', border: 'rgba(191,219,254,0.9)' },
} as const

function fmtDate(d: string | null | undefined) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── HOME CARD ───────────────────────────────────────────────────────────────
function HomeCard({ home, onHover }: { home: Property; onHover: (id: string | null) => void }) {
  const tc   = TYPE_CONFIG[home.listing_type] ?? TYPE_CONFIG.standard_rental
  const start = fmtDate(home.sublease_start_date)
  const end   = fmtDate(home.sublease_end_date)
  const isSublease = home.listing_type === 'sublease' || home.listing_type === 'lease_transfer'

  return (
    <a
      href={`/homes/${home.slug}`}
      className="hc2-card"
      onMouseEnter={() => onHover(home.slug)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Image */}
      <div className="hc2-img-wrap">
        {home.images?.[0]
          ? <img src={home.images[0]} alt={home.name} className="hc2-img" />
          : <div className="hc2-img-placeholder" />
        }
        {/* Type badge — top left */}
        <div className="hc2-type-badge" style={{ background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
          {tc.label}
        </div>
        {/* Price — bottom right */}
        <div className="hc2-price">
          ${home.price.toLocaleString()}<span>/mo</span>
        </div>
      </div>

      {/* Body */}
      <div className="hc2-body">
        <div className="hc2-name">{home.name}</div>
        <div className="hc2-meta">
          <span>📍 {home.asu_distance} mi to ASU</span>
          <span className="hc2-sep" />
          <span>{home.beds}bd · {home.baths}ba</span>
        </div>
        {isSublease && start && end && (
          <div className="hc2-dates">{start} → {end}</div>
        )}
        <div className="hc2-cta">Explore →</div>
      </div>
    </a>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
export default function HomesPageClient() {
  const ph = usePostHog()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'price' | 'score' | 'distance'>('price')
  const [mapVisible, setMapVisible] = useState(true)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    getProperties().then(data => { setProperties(data); setLoading(false) })
  }, [])

  const filtered = useMemo(() => {
    return properties
      .filter(h => {
        if (h.price > filters.maxPrice) return false
        if (h.beds < filters.minBeds) return false
        if (h.asu_distance > filters.maxDistance) return false
        if (filters.search) {
          const q = filters.search.toLowerCase()
          if (!h.name.toLowerCase().includes(q) && !h.address.toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'price') return a.price - b.price
        if (sortBy === 'score') return b.asu_score - a.asu_score
        if (sortBy === 'distance') return a.asu_distance - b.asu_distance
        return 0
      })
  }, [properties, filters, sortBy])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #faf9f6; }

        .homes-page { display: flex; flex-direction: column; height: calc(100vh - 94px); overflow: hidden; }
        .homes-toolbar { background: #fff; border-bottom: 1px solid #e8e4db; padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex-shrink: 0; z-index: 10; }

        /* SEARCH */
        .search-box { display: flex; align-items: center; gap: 8px; background: #faf9f6; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; min-width: 200px; flex: 1; max-width: 280px; }
        .search-box input { border: none; background: none; outline: none; font-size: 13px; color: #1a1a1a; font-family: 'DM Sans', sans-serif; width: 100%; }
        .search-box input::placeholder { color: #c5c1b8; }

        /* FILTER PILLS */
        .filter-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .filter-pill { display: flex; align-items: center; gap: 6px; background: #faf9f6; border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 12px; height: 36px; font-size: 13px; color: #1a1a1a; cursor: pointer; white-space: nowrap; font-family: 'DM Sans', sans-serif; transition: border-color 0.15s; }
        .filter-pill:hover { border-color: #8C1D40; }
        .filter-pill.active { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }
        .filter-pill select { border: none; background: none; outline: none; font-size: 13px; color: inherit; font-family: 'DM Sans', sans-serif; cursor: pointer; }
        .filter-pill label { font-size: 11px; color: #9b9b9b; font-weight: 500; }
        .filter-pill input[type=range] { width: 90px; accent-color: #8C1D40; cursor: pointer; }

        .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
        .sort-select { border: 1.5px solid #e8e4db; border-radius: 8px; padding: 0 10px; height: 36px; font-size: 13px; color: #1a1a1a; font-family: 'DM Sans', sans-serif; background: #fff; outline: none; cursor: pointer; }
        .map-toggle { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 0 14px; height: 36px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
        .map-toggle:hover { background: #333; }
        .result-count { font-size: 13px; color: #9b9b9b; white-space: nowrap; }

        /* BODY */
        .homes-body { display: flex; flex: 1; overflow: hidden; }

        /* LIST */
        .homes-list { width: 50%; flex-shrink: 0; overflow-y: auto; padding: 16px; background: #faf9f6; }
        .homes-list.full { width: 100%; }
        .homes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .homes-list.full .homes-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }

        /* COMPACT CARD */
        .hc2-card { display: block; text-decoration: none; color: inherit; background: #fff; border: 1px solid #e8e4db; border-radius: 14px; overflow: hidden; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; }
        .hc2-card:hover { transform: translateY(-3px); box-shadow: 0 12px 36px rgba(0,0,0,0.09); border-color: #d4c9b0; }
        .hc2-img-wrap { position: relative; height: 148px; overflow: hidden; background: #f0ede6; }
        .hc2-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s; }
        .hc2-card:hover .hc2-img { transform: scale(1.06); }
        .hc2-img-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg,#e8e4db,#f0ede6); }
        .hc2-type-badge { position: absolute; top: 9px; left: 9px; font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 20px; backdrop-filter: blur(4px); letter-spacing: 0.2px; }
        .hc2-price { position: absolute; bottom: 9px; right: 9px; background: rgba(26,26,26,0.9); color: #fff; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 300; padding: 4px 10px; border-radius: 7px; backdrop-filter: blur(6px); letter-spacing: -0.2px; line-height: 1.3; }
        .hc2-price span { font-family: 'DM Sans', sans-serif; font-size: 10px; opacity: 0.65; font-weight: 400; }
        .hc2-body { padding: 11px 13px 13px; }
        .hc2-name { font-family: 'Fraunces', serif; font-size: 14px; font-weight: 300; color: #1a1a1a; margin-bottom: 4px; letter-spacing: -0.1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hc2-meta { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b6b6b; margin-bottom: 4px; }
        .hc2-sep { width: 3px; height: 3px; border-radius: 50%; background: #d4c9b0; flex-shrink: 0; }
        .hc2-dates { font-size: 10px; color: #8C1D40; font-weight: 600; background: #fdf2f5; border: 1px solid #f5c6d0; padding: 2px 8px; border-radius: 20px; display: inline-block; margin-bottom: 4px; }
        .hc2-cta { font-size: 12px; font-weight: 600; color: #8C1D40; margin-top: 6px; }
        .hc2-card:hover .hc2-cta { color: #c9973a; }

        /* MAP */
        .homes-map { width: 50%; flex-shrink: 0; position: sticky; top: 0; height: 100%; background: #e8e4db; }

        /* EMPTY */
        .empty-state { text-align: center; padding: 60px 20px; }
        .empty-title { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 300; color: #1a1a1a; margin-bottom: 8px; }
        .empty-sub { font-size: 14px; color: #9b9b9b; margin-bottom: 16px; }
        .reset-btn { background: #8C1D40; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        @keyframes shimmer { 0% { background-position: 100% 0 } 100% { background-position: -100% 0 } }

        @media (max-width: 768px) {
          .homes-page { height: auto; overflow: visible; }
          .homes-body { flex-direction: column; }
          .homes-list, .homes-list.full { width: 100%; }
          .homes-grid, .homes-list.full .homes-grid { grid-template-columns: 1fr 1fr; }
          .homes-map { width: 100%; height: 340px; position: relative; }
          .search-box { max-width: 100%; }
          .toolbar-right { margin-left: 0; width: 100%; justify-content: space-between; }
        }
        @media (max-width: 480px) {
          .homes-grid, .homes-list.full .homes-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="homes-page">

        {/* TOOLBAR */}
        <div className="homes-toolbar">

          {/* Search */}
          <div className="search-box">
            <span style={{ color: '#9b9b9b', fontSize: '14px' }}>🔍</span>
            <input
              placeholder="Search by name or address..."
              value={filters.search}
              onChange={e => {
                const q = e.target.value
                setFilters(f => ({ ...f, search: q }))
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
                searchDebounceRef.current = setTimeout(() => {
                  if (q.trim()) ph?.capture('homes_searched', { query: q.trim(), results_count: filtered.length })
                }, 1500)
              }}
            />
          </div>

          <div className="filter-group">

            {/* Max price */}
            <div className={`filter-pill ${filters.maxPrice < 2000 ? 'active' : ''}`}>
              <label>Max $</label>
              <input
                type="range"
                min={500} max={2000} step={50}
                value={filters.maxPrice}
                onChange={e => setFilters(f => ({ ...f, maxPrice: Number(e.target.value) }))}
                onMouseUp={e => ph?.capture('homes_filter_changed', { filter: 'max_price', value: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={e => ph?.capture('homes_filter_changed', { filter: 'max_price', value: Number((e.target as HTMLInputElement).value) })}
              />
              <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '38px' }}>${filters.maxPrice}</span>
            </div>

            {/* Min beds */}
            <div className={`filter-pill ${filters.minBeds > 1 ? 'active' : ''}`}>
              <label>Beds</label>
              <select
                value={filters.minBeds}
                onChange={e => {
                  const v = Number(e.target.value)
                  setFilters(f => ({ ...f, minBeds: v }))
                  ph?.capture('homes_filter_changed', { filter: 'min_beds', value: v })
                }}
              >
                <option value={1}>Any</option>
                <option value={2}>2+</option>
                <option value={3}>3+</option>
                <option value={4}>4+</option>
              </select>
            </div>

            {/* Distance */}
            <div className={`filter-pill ${filters.maxDistance < 5 ? 'active' : ''}`}>
              <label>To ASU</label>
              <input
                type="range"
                min={0.2} max={5} step={0.1}
                value={filters.maxDistance}
                onChange={e => setFilters(f => ({ ...f, maxDistance: Number(e.target.value) }))}
                onMouseUp={e => ph?.capture('homes_filter_changed', { filter: 'max_distance_mi', value: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={e => ph?.capture('homes_filter_changed', { filter: 'max_distance_mi', value: Number((e.target as HTMLInputElement).value) })}
              />
              <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '34px' }}>{filters.maxDistance}mi</span>
            </div>

            {/* Available only */}
            <button
              className={`filter-pill ${filters.maxPrice < 2000 || filters.minBeds > 1 || filters.maxDistance < 5 ? 'active' : ''}`}
              onClick={() => { setFilters(DEFAULT_FILTERS); ph?.capture('homes_filter_reset') }}
              style={{ cursor: 'pointer', border: '1.5px solid #e8e4db' }}
            >
              Reset
            </button>
          </div>

          <div className="toolbar-right">
            <span className="result-count">{loading ? 'Loading…' : `${filtered.length} home${filtered.length !== 1 ? 's' : ''}`}</span>
            <select className="sort-select" value={sortBy} onChange={e => {
              const v = e.target.value as 'price' | 'score' | 'distance'
              setSortBy(v)
              ph?.capture('homes_sorted', { sort_by: v, results_count: filtered.length })
            }}>
              <option value="price">Price: low to high</option>
              <option value="score">Best ASU fit</option>
              <option value="distance">Closest to ASU</option>
            </select>
            <button className="map-toggle" onClick={() => {
              const next = !mapVisible
              setMapVisible(next)
              ph?.capture('map_toggled', { visible: next })
            }}>
              {mapVisible ? '⊟ Hide map' : '⊞ Show map'}
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="homes-body">

          {/* LIST */}
          <div className={`homes-list${!mapVisible ? ' full' : ''}`}>
            {loading ? (
              <div className="homes-grid">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ background: '#fff', border: '1px solid #e8e4db', borderRadius: '14px', overflow: 'hidden' }}>
                    <div style={{ height: '148px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
                    <div style={{ padding: '11px 13px 13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ height: '14px', width: '70%', background: '#f0ede6', borderRadius: '4px' }} />
                      <div style={{ height: '11px', width: '50%', background: '#f0ede6', borderRadius: '4px' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">No homes match your filters</div>
                <p className="empty-sub">Try widening your search — we're adding new listings regularly.</p>
                <button className="reset-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>
              </div>
            ) : (
              <div className="homes-grid">
                {filtered.map(home => (
                  <HomeCard key={home.slug} home={home} onHover={setHoveredId} />
                ))}
              </div>
            )}
          </div>

          {/* MAP */}
          {mapVisible && (
            <div className="homes-map">
              <HomesMap homes={filtered} hoveredId={hoveredId} />
            </div>
          )}

        </div>
      </div>
    </>
  )
}
