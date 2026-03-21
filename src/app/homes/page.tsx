'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { homes, Home } from '@/lib/homes'

// ─── FILTER STATE ────────────────────────────────────────────────────────────
type Filters = {
  maxPrice: number
  minBeds: number
  maxDistance: number   // miles from ASU
  search: string
}

const DEFAULT_FILTERS: Filters = {
  maxPrice: 1200,
  minBeds: 1,
  maxDistance: 2,
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
function HomesMap({ homes, hoveredId }: { homes: Home[]; hoveredId: string | null }) {
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

  function addMarkers(homeList: Home[], L: any, map: any) {
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    homeList.forEach(home => {
      if (!home.coordinates) return
      const icon = L.divIcon({
        className: '',
        html: makePinHtml(home.slug, home.price, false),
        iconAnchor: [40, 38],
      })
      const marker = L.marker(home.coordinates, { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:'DM Sans',sans-serif;min-width:200px;padding:4px 0;">
            <img src="${home.heroImage}" style="width:100%;height:110px;object-fit:cover;border-radius:6px;margin-bottom:10px;" />
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
    const { L, map } = mapInstanceRef.current
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

// ─── SCORE BAR ───────────────────────────────────────────────────────────────
function ScoreBar({ score }: { score: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ flex: 1, height: '3px', background: '#e8e4db', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ width: `${score * 10}%`, height: '100%', background: score >= 8 ? '#c9973a' : '#6b9e6b', borderRadius: '10px' }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color: score >= 8 ? '#c9973a' : '#6b9e6b' }}>{score}/10</span>
    </div>
  )
}

// ─── HOME CARD ───────────────────────────────────────────────────────────────
function HomeCard({ home, onHover }: { home: Home; onHover: (id: string | null) => void }) {
  const isWholeHouseAvailable = home.available === home.totalRooms
  const estimatedUtilities = '~$65–$140'

  return (
    <a
      href={`/homes/${home.slug}`}
      onMouseEnter={() => onHover(home.slug)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        background: '#fff', border: '1px solid #e8e4db', borderRadius: '14px',
        overflow: 'hidden', transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
      }}
      onMouseOver={e => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = 'translateY(-3px)'
        el.style.boxShadow = '0 12px 40px rgba(0,0,0,0.09)'
        el.style.borderColor = '#d4c9b0'
      }}
      onMouseOut={e => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = 'translateY(0)'
        el.style.boxShadow = 'none'
        el.style.borderColor = '#e8e4db'
      }}
    >
      {/* Image */}
      <div style={{ height: '200px', overflow: 'hidden', position: 'relative' }}>
        <img src={home.heroImage} alt={home.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

        {/* Top-left: availability badge */}
        <div style={{
          position: 'absolute', top: '10px', left: '10px',
          display: 'flex', flexDirection: 'column', gap: '5px',
        }}>
          {isWholeHouseAvailable ? (
            <div style={{ background: 'rgba(220,252,231,0.96)', color: '#166534', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(187,247,208,0.9)', backdropFilter: 'blur(4px)' }}>
              🏠 Entire house available
            </div>
          ) : (
            <div style={{ background: home.available === 1 ? 'rgba(254,249,195,0.96)' : 'rgba(220,252,231,0.96)', color: home.available === 1 ? '#854d0e' : '#166534', fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', border: `1px solid ${home.available === 1 ? 'rgba(253,224,71,0.6)' : 'rgba(187,247,208,0.9)'}`, backdropFilter: 'blur(4px)' }}>
              {home.available === 1 ? '⚡ 1 room left' : `${home.available} of ${home.totalRooms} rooms open`}
            </div>
          )}
        </div>

        {/* Bottom-right: price pill */}
        <div style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(26,26,26,0.9)', color: '#fff', fontFamily: "'Fraunces', serif", fontSize: '18px', fontWeight: 300, padding: '5px 12px', borderRadius: '7px', backdropFilter: 'blur(6px)', letterSpacing: '-0.3px' }}>
          ${home.price.toLocaleString()}<span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '11px', opacity: 0.7, fontWeight: 400 }}>/mo</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 18px 18px' }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: '18px', fontWeight: 300, color: '#1a1a1a', marginBottom: '3px', letterSpacing: '-0.3px' }}>{home.name}</div>
        <div style={{ fontSize: '12px', color: '#9b9b9b', marginBottom: '14px' }}>📍 {home.address}</div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
          {[`${home.beds} bed`, `${home.baths} bath`, `${home.sqft} sqft`, `${home.asuDistance} mi to ASU`].map((s, i, arr) => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#6b6b6b' }}>{s}</span>
              {i < arr.length - 1 && <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#e8e4db', display: 'inline-block' }} />}
            </span>
          ))}
        </div>

        {/* Cost breakdown */}
        <div style={{ background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ fontSize: '12px', color: '#6b6b6b' }}>Rent per room</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>${home.price.toLocaleString()}/mo</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
            <span style={{ fontSize: '12px', color: '#6b6b6b' }}>Est. utilities per person</span>
            <span style={{ fontSize: '12px', color: '#6b6b6b' }}>{estimatedUtilities}/mo <span style={{ fontSize: '10px' }}>💡</span></span>
          </div>
          <div style={{ height: '1px', background: '#e8e4db', margin: '8px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a' }}>Est. total per person</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#8C1D40' }}>${home.price + 65}–${home.price + 140}/mo</span>
          </div>
          <div style={{ fontSize: '10px', color: '#c5c1b8', marginTop: '5px' }}>Utilities vary by A/C usage. Summer months trend higher.</div>
        </div>

        {/* Group prompt if whole house available */}
        {isWholeHouseAvailable && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '9px 12px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>👥</span>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#166534' }}>Perfect for a group of {home.totalRooms}</div>
              <div style={{ fontSize: '11px', color: '#4b9e66' }}>Entire {home.beds}-bed house available — bring your squad</div>
            </div>
          </div>
        )}

        {/* Footer CTA */}
        <div style={{ borderTop: '1px solid #f0ede6', paddingTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#c9973a' }}>{home.asuScore}/10</span>
            <span style={{ fontSize: '11px', color: '#9b9b9b' }}>ASU fit score</span>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#8C1D40' }}>View details →</span>
        </div>
      </div>
    </a>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
export default function HomesPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'price' | 'score' | 'distance'>('price')
  const [mapVisible, setMapVisible] = useState(true)

  const filtered = useMemo(() => {
    return homes
      .filter(h => {
        if (h.price > filters.maxPrice) return false
        if (h.beds < filters.minBeds) return false
        const dist = parseFloat(h.asuDistance)
        if (dist > filters.maxDistance) return false
        if (filters.search) {
          const q = filters.search.toLowerCase()
          if (!h.name.toLowerCase().includes(q) && !h.address.toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'price') return a.price - b.price
        if (sortBy === 'score') return b.asuScore - a.asuScore
        if (sortBy === 'distance') return parseFloat(a.asuDistance) - parseFloat(b.asuDistance)
        return 0
      })
  }, [filters, sortBy])

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
        .homes-list { width: 50%; flex-shrink: 0; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; background: #faf9f6; }
        .homes-list.full { width: 100%; }

        /* MAP */
        .homes-map { width: 50%; flex-shrink: 0; position: sticky; top: 0; height: 100%; background: #e8e4db; }

        /* EMPTY */
        .empty-state { text-align: center; padding: 60px 20px; }
        .empty-title { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 300; color: #1a1a1a; margin-bottom: 8px; }
        .empty-sub { font-size: 14px; color: #9b9b9b; margin-bottom: 16px; }
        .reset-btn { background: #8C1D40; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }

        @media (max-width: 768px) {
          .homes-page { height: auto; overflow: visible; }
          .homes-body { flex-direction: column; }
          .homes-list, .homes-list.full { width: 100%; }
          .homes-map { width: 100%; height: 340px; position: relative; }
          .search-box { max-width: 100%; }
          .toolbar-right { margin-left: 0; width: 100%; justify-content: space-between; }
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
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            />
          </div>

          <div className="filter-group">

            {/* Max price */}
            <div className={`filter-pill ${filters.maxPrice < 1200 ? 'active' : ''}`}>
              <label>Max $</label>
              <input
                type="range"
                min={500} max={1200} step={50}
                value={filters.maxPrice}
                onChange={e => setFilters(f => ({ ...f, maxPrice: Number(e.target.value) }))}
              />
              <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '38px' }}>${filters.maxPrice}</span>
            </div>

            {/* Min beds */}
            <div className={`filter-pill ${filters.minBeds > 1 ? 'active' : ''}`}>
              <label>Beds</label>
              <select
                value={filters.minBeds}
                onChange={e => setFilters(f => ({ ...f, minBeds: Number(e.target.value) }))}
              >
                <option value={1}>Any</option>
                <option value={2}>2+</option>
                <option value={3}>3+</option>
                <option value={4}>4+</option>
              </select>
            </div>

            {/* Distance */}
            <div className={`filter-pill ${filters.maxDistance < 2 ? 'active' : ''}`}>
              <label>To ASU</label>
              <input
                type="range"
                min={0.2} max={2} step={0.1}
                value={filters.maxDistance}
                onChange={e => setFilters(f => ({ ...f, maxDistance: Number(e.target.value) }))}
              />
              <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '34px' }}>{filters.maxDistance}mi</span>
            </div>

            {/* Available only */}
            <button
              className={`filter-pill ${filters.maxPrice < 1200 || filters.minBeds > 1 || filters.maxDistance < 2 ? 'active' : ''}`}
              onClick={() => setFilters(DEFAULT_FILTERS)}
              style={{ cursor: 'pointer', border: '1.5px solid #e8e4db' }}
            >
              Reset
            </button>
          </div>

          <div className="toolbar-right">
            <span className="result-count">{filtered.length} home{filtered.length !== 1 ? 's' : ''}</span>
            <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="price">Price: low to high</option>
              <option value="score">Best ASU fit</option>
              <option value="distance">Closest to ASU</option>
            </select>
            <button className="map-toggle" onClick={() => setMapVisible(v => !v)}>
              {mapVisible ? '⊟ Hide map' : '⊞ Show map'}
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="homes-body">

          {/* LIST */}
          <div className={`homes-list${!mapVisible ? ' full' : ''}`}>
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-title">No homes match your filters</div>
                <p className="empty-sub">Try widening your search — we're adding new listings regularly.</p>
                <button className="reset-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>
              </div>
            ) : (
              filtered.map(home => (
                <HomeCard key={home.slug} home={home} onHover={setHoveredId} />
              ))
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
