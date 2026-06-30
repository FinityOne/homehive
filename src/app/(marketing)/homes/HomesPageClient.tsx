'use client'

import '@/styles/brand-tokens.css'
import { useState, useMemo, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
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

function useInitialFilters(): Filters {
  const sp = useSearchParams()
  return {
    maxPrice: sp.get('price_max') ? Number(sp.get('price_max')) : DEFAULT_FILTERS.maxPrice,
    minBeds:  sp.get('beds')      ? Number(sp.get('beds'))      : DEFAULT_FILTERS.minBeds,
    maxDistance: DEFAULT_FILTERS.maxDistance,
    search: sp.get('q') || DEFAULT_FILTERS.search,
  }
}

// ─── LANDMARKS ───────────────────────────────────────────────────────────────
// Brand hex values (used in injected map HTML where CSS vars don't apply)
const BRAND = { primary: '#2F4A48', accent: '#D9A14A', bg: '#FAF8F3', bgAlt: '#F4F1EA', text: '#222810', textMuted: '#6b6b5a', border: '#dddad0' }

const LANDMARKS = [
  { coords: [33.4242, -111.9281] as [number, number], label: '⚡ ASU', color: BRAND.primary, textColor: BRAND.accent, border: BRAND.accent, description: 'Arizona State University' },
  { coords: [33.3955, -111.9459] as [number, number], label: '⛰ A Mountain', color: '#fff', textColor: BRAND.text, border: BRAND.border, description: 'Hayden Butte / A Mountain' },
  { coords: [33.4265, -111.9403] as [number, number], label: '🌯 Chipotle', color: '#fff', textColor: '#7B341E', border: BRAND.border, description: 'Chipotle — Mill Ave' },
  { coords: [33.4152, -111.9090] as [number, number], label: '🌯 Chipotle', color: '#fff', textColor: '#7B341E', border: BRAND.border, description: 'Chipotle — Rural Rd' },
  { coords: [33.4268, -111.9397] as [number, number], label: '🚉 Light Rail', color: '#fff', textColor: '#1a73e8', border: BRAND.border, description: 'Mill Ave / 3rd St Station' },
  { coords: [33.4177, -111.9090] as [number, number], label: '🚉 Light Rail', color: '#fff', textColor: '#1a73e8', border: BRAND.border, description: 'University Dr / Rural Rd Station' },
  { coords: [33.4338, -111.9399] as [number, number], label: '🏪 Trader Joe\'s', color: '#fff', textColor: '#c41e3a', border: BRAND.border, description: 'Trader Joe\'s — Tempe' },
]

// ─── LEAFLET MAP ─────────────────────────────────────────────────────────────
function HomesMap({ homes, hoveredId }: { homes: Property[]; hoveredId: string | null }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])

  function makePinHtml(slug: string, price: number, active = false) {
    const bg     = active ? BRAND.primary : '#1c2420'
    const scale  = active ? 'scale(1.14)' : 'scale(1)'
    const shadow = active ? `0 4px 18px rgba(47,74,72,0.5)` : '0 2px 8px rgba(0,0,0,0.2)'
    const accent = active ? BRAND.accent : 'rgba(255,255,255,0.75)'
    return `
      <div class="map-pin" data-id="${slug}" style="
        background:${bg};color:#fff;
        font-size:12px;font-weight:700;
        padding:6px 12px;border-radius:100px;
        white-space:nowrap;cursor:pointer;
        border:1.5px solid ${accent};
        box-shadow:${shadow};
        font-family:system-ui,-apple-system,sans-serif;
        transform:${scale};
        transition:all 0.18s ease;
        letter-spacing:-0.2px;
        position:relative;
      ">
        $${price.toLocaleString()}<span style="font-weight:400;opacity:0.7;font-size:10px;">/mo</span>
        <div style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);
          width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;
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
          <div style="font-family:system-ui,-apple-system,sans-serif;min-width:210px;padding:4px 0;">
            ${home.images?.[0] ? `<img src="${home.images[0]}" style="width:100%;height:118px;object-fit:cover;border-radius:8px;margin-bottom:11px;display:block;" />` : ''}
            <div style="font-size:14px;font-weight:600;color:${BRAND.text};margin-bottom:3px;line-height:1.3;">${home.name}</div>
            <div style="font-size:11px;color:${BRAND.textMuted};margin-bottom:9px;">📍 ${home.address}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;">
              <span style="font-size:18px;font-weight:700;color:${BRAND.primary};letter-spacing:-0.3px;">$${home.price.toLocaleString()}<span style="font-size:11px;font-weight:400;color:${BRAND.textMuted};">/mo</span></span>
              <span style="font-size:11px;background:rgba(47,74,72,0.08);color:${BRAND.primary};padding:3px 9px;border-radius:20px;font-weight:600;">${home.available} open</span>
            </div>
            <a href="/homes/${home.slug}" style="display:block;background:${BRAND.primary};color:#fff;padding:10px 12px;border-radius:100px;text-decoration:none;text-align:center;font-size:13px;font-weight:600;letter-spacing:-0.1px;">View home →</a>
          </div>
        `, { maxWidth: 248, className: 'home-popup' })
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
        .leaflet-popup-content-wrapper { border-radius: 14px !important; box-shadow: 0 12px 40px rgba(34,40,16,0.14) !important; border: 1px solid var(--hh-border-faint, #dddad0) !important; padding: 0 !important; overflow: hidden; background: var(--hh-bg, #FAF8F3) !important; }
        .leaflet-popup-content { margin: 13px 15px !important; }
        .leaflet-popup-tip-container { display: none; }
        .lm-tooltip { background: #1c2420; color: #fff; border: none; border-radius: 6px; font-family: system-ui,-apple-system,sans-serif; font-size: 12px; padding: 4px 9px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
        .lm-tooltip::before { display: none; }
        .leaflet-control-zoom { border: 1px solid var(--hh-border-faint, #dddad0) !important; border-radius: 10px !important; overflow: hidden; box-shadow: 0 2px 10px rgba(34,40,16,0.08) !important; }
        .leaflet-control-zoom a { color: var(--hh-text, #222810) !important; font-size: 16px !important; background: var(--hh-bg, #FAF8F3) !important; }
        .leaflet-control-zoom a:hover { background: var(--hh-bg-alt, #F4F1EA) !important; }
        .leaflet-control-attribution { font-size: 9px !important; background: rgba(250,248,243,0.85) !important; backdrop-filter: blur(6px); border-radius: 8px !important; padding: 3px 8px !important; color: var(--hh-text-muted, #6b6b5a) !important; }
      `}</style>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </>
  )
}

// ─── LISTING TYPE CONFIG ─────────────────────────────────────────────────────
const TYPE_CONFIG = {
  standard_rental: { label: 'For Rent',       bg: 'rgba(250,248,243,0.95)', color: '#2F4A48', border: 'rgba(47,74,72,0.25)' },
  sublease:        { label: 'Sublease',        bg: 'rgba(217,161,74,0.12)',  color: '#9a6a1e', border: 'rgba(217,161,74,0.4)' },
  lease_transfer:  { label: 'Lease Transfer',  bg: 'rgba(239,246,255,0.95)', color: '#1d4ed8', border: 'rgba(191,219,254,0.9)' },
} as const

function fmtDate(d: string | null | undefined) {
  if (!d) return null
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── HOME CARD ───────────────────────────────────────────────────────────────
function HomeCard({ home, onHover, featured = false }: { home: Property; onHover: (id: string | null) => void; featured?: boolean }) {
  const tc      = TYPE_CONFIG[home.listing_type] ?? TYPE_CONFIG.standard_rental
  const start   = fmtDate(home.sublease_start_date)
  const end     = fmtDate(home.sublease_end_date)
  const isSub   = home.listing_type === 'sublease' || home.listing_type === 'lease_transfer'

  return (
    <a
      href={`/homes/${home.slug}`}
      className={`hc2-card${featured ? ' hc2-featured' : ''}`}
      onMouseEnter={() => onHover(home.slug)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Image */}
      <div className={`hc2-img-wrap${featured ? ' hc2-img-wrap--featured' : ''}`}>
        {home.images?.[0]
          ? <img src={home.images[0]} alt={home.name} className="hc2-img" loading="lazy" />
          : <div className="hc2-img-placeholder" />
        }
        {/* Gradient overlay for featured */}
        {featured && <div className="hc2-grad" />}

        {/* Type badge */}
        <div className="hc2-type-badge" style={{ background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
          {tc.label}
        </div>

        {/* Price chip */}
        <div className="hc2-price">
          ${home.price.toLocaleString()}<span>/mo</span>
        </div>

        {/* Arrow affordance — signals clickability */}
        <div className="hc2-arrow">↗</div>
      </div>

      {/* Body */}
      <div className="hc2-body">
        <div className="hc2-name">{home.name}</div>
        <div className="hc2-meta">
          <span className="hc2-bed-pill">{home.beds} bed · {home.baths} bath</span>
          {isSub && start && end && (
            <span className="hc2-date-pill">{start} – {end}</span>
          )}
          {!isSub && home.available_from && (
            <span className="hc2-avail-pill">
              Available {fmtDate(home.available_from)}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}

// ─── SECTION HEADING ─────────────────────────────────────────────────────────
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="section-heading">
      <span className="section-label">{label}</span>
      <span className="section-count">{count}</span>
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
function HomesPageInner({ initialProperties }: { initialProperties?: Property[] }) {
  const ph = usePostHog()
  const initialFilters = useInitialFilters()
  const hasInitial = !!(initialProperties && initialProperties.length > 0)
  const [properties, setProperties] = useState<Property[]>(initialProperties ?? [])
  const [loading, setLoading] = useState(!hasInitial)
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'price' | 'score' | 'distance'>('price')
  const [mapVisible, setMapVisible] = useState(true)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Server-rendered into the initial HTML; only client-fetch as a fallback.
    if (!hasInitial) {
      getProperties().then(data => { setProperties(data); setLoading(false) })
    }
  }, [hasInitial])

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
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Geist:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--hh-font-ui); background: var(--hh-bg); }

        /* ── LAYOUT ── */
        .homes-page { display: flex; flex-direction: column; height: calc(100vh - 94px); overflow: hidden; }
        .homes-toolbar {
          background: var(--hh-bg);
          border-bottom: 1px solid var(--hh-border-faint);
          padding: 10px 20px;
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          flex-shrink: 0; z-index: 10;
        }

        /* ── SEARCH ── */
        .search-box {
          display: flex; align-items: center; gap: 8px;
          background: #fff; border: 1.5px solid var(--hh-border-faint);
          border-radius: 100px; padding: 0 14px; height: 38px;
          min-width: 200px; flex: 1; max-width: 280px;
          transition: border-color 0.15s;
        }
        .search-box:focus-within { border-color: var(--hh-primary); }
        .search-box input { border: none; background: none; outline: none; font-size: 13px; color: var(--hh-text); font-family: var(--hh-font-ui); width: 100%; }
        .search-box input::placeholder { color: var(--hh-text-placeholder); }

        /* ── FILTER PILLS ── */
        .filter-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .filter-pill {
          display: flex; align-items: center; gap: 6px;
          background: #fff; border: 1.5px solid var(--hh-border-faint);
          border-radius: 100px; padding: 0 14px; height: 38px;
          font-size: 13px; color: var(--hh-text);
          cursor: pointer; white-space: nowrap;
          font-family: var(--hh-font-ui); transition: border-color 0.15s, background 0.15s;
        }
        .filter-pill:hover { border-color: var(--hh-primary); }
        .filter-pill.active { border-color: var(--hh-primary); background: rgba(47,74,72,0.06); color: var(--hh-primary); }
        .filter-pill select { border: none; background: none; outline: none; font-size: 13px; color: inherit; font-family: var(--hh-font-ui); cursor: pointer; }
        .filter-pill label { font-size: 11px; color: var(--hh-text-muted); font-weight: 500; }
        .filter-pill input[type=range] { width: 86px; accent-color: var(--hh-primary); cursor: pointer; }

        .toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
        .sort-select {
          border: 1.5px solid var(--hh-border-faint); border-radius: 100px;
          padding: 0 14px; height: 38px; font-size: 13px;
          color: var(--hh-text); font-family: var(--hh-font-ui);
          background: #fff; outline: none; cursor: pointer;
          transition: border-color 0.15s;
        }
        .sort-select:focus { border-color: var(--hh-primary); }
        .map-toggle {
          background: var(--hh-primary); color: #fff; border: none;
          border-radius: 100px; padding: 0 16px; height: 38px;
          font-size: 13px; font-weight: 500; cursor: pointer;
          font-family: var(--hh-font-ui); white-space: nowrap;
          display: flex; align-items: center; gap: 6px;
          transition: opacity 0.15s;
          letter-spacing: -0.01em;
        }
        .map-toggle:hover { opacity: 0.85; }
        .result-count { font-size: 13px; color: var(--hh-text-muted); white-space: nowrap; }

        /* ── BODY ── */
        .homes-body { display: flex; flex: 1; overflow: hidden; }

        /* ── LIST ── */
        .homes-list { width: 50%; flex-shrink: 0; overflow-y: auto; padding: 20px 20px 40px; background: var(--hh-bg); }
        .homes-list.full { width: 100%; }

        /* ── SECTION HEADING ── */
        .section-heading { display: flex; align-items: center; gap: 10px; margin: 28px 0 14px; }
        .section-heading:first-child { margin-top: 0; }
        .section-label {
          font-family: var(--hh-font-display); font-size: 20px; font-weight: 380;
          color: var(--hh-text); font-style: italic; letter-spacing: -0.02em;
        }
        .section-count {
          font-size: 11px; font-weight: 600; color: var(--hh-text-muted);
          background: var(--hh-bg-alt); padding: 2px 10px; border-radius: 100px;
          border: 1px solid var(--hh-border-faint);
        }

        /* ── GRID ── */
        .homes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .homes-list.full .homes-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }

        /* ── CARD ── */
        .hc2-card {
          display: block; text-decoration: none; color: inherit;
          background: #fff; border-radius: 18px; overflow: hidden;
          cursor: pointer; border: 1px solid var(--hh-border-faint);
          transition: transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.22s, border-color 0.22s;
          box-shadow: 0 1px 3px rgba(34,40,16,0.05);
        }
        .hc2-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 44px rgba(34,40,16,0.12), 0 4px 12px rgba(34,40,16,0.06);
          border-color: var(--hh-border);
        }

        /* ── FEATURED CARD ── */
        .hc2-featured { grid-column: span 2; }
        .hc2-img-wrap--featured { height: 290px !important; }

        /* ── IMAGE ── */
        .hc2-img-wrap { position: relative; height: 200px; overflow: hidden; background: var(--hh-bg-alt); }
        .hc2-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94); }
        .hc2-card:hover .hc2-img { transform: scale(1.06); }
        .hc2-img-placeholder { width: 100%; height: 100%; background: linear-gradient(135deg, var(--hh-bg-alt) 0%, var(--hh-bg) 50%, var(--hh-bg-alt) 100%); }

        /* Gradient overlay */
        .hc2-grad { position: absolute; inset: 0; background: linear-gradient(to top, rgba(22,28,20,0.42) 0%, transparent 52%); pointer-events: none; }

        /* ── OVERLAYS ── */
        .hc2-type-badge { position: absolute; top: 10px; left: 10px; font-size: 10px; font-weight: 700; padding: 4px 10px; border-radius: 100px; backdrop-filter: blur(8px); letter-spacing: 0.3px; text-transform: uppercase; }
        .hc2-price { position: absolute; bottom: 11px; left: 13px; color: #fff; font-family: var(--hh-font-display); font-size: 20px; font-weight: 380; letter-spacing: -0.3px; line-height: 1.2; text-shadow: 0 1px 6px rgba(0,0,0,0.3); }
        .hc2-price span { font-family: var(--hh-font-ui); font-size: 11px; font-weight: 400; opacity: 0.82; }
        .hc2-arrow {
          position: absolute; bottom: 11px; right: 13px;
          width: 30px; height: 30px; border-radius: 50%;
          background: rgba(255,255,255,0.2); backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.38);
          color: #fff; font-size: 14px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transform: scale(0.8);
          transition: opacity 0.2s, transform 0.2s;
        }
        .hc2-card:hover .hc2-arrow { opacity: 1; transform: scale(1); }

        /* ── CARD BODY ── */
        .hc2-body { padding: 13px 15px 15px; }
        .hc2-name {
          font-family: var(--hh-font-display); font-size: 15px; font-weight: 400;
          color: var(--hh-text); margin-bottom: 7px; letter-spacing: -0.01em;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .hc2-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .hc2-bed-pill { font-size: 11px; font-weight: 500; color: var(--hh-text-2); background: var(--hh-bg-alt); padding: 3px 9px; border-radius: 100px; border: 1px solid var(--hh-border-faint); }
        .hc2-date-pill { font-size: 11px; font-weight: 600; color: var(--hh-primary); background: rgba(47,74,72,0.07); border: 1px solid rgba(47,74,72,0.18); padding: 3px 9px; border-radius: 100px; }
        .hc2-avail-pill { font-size: 11px; font-weight: 600; color: #059669; background: rgba(16,185,129,0.07); border: 1px solid rgba(16,185,129,0.22); padding: 3px 9px; border-radius: 100px; }

        /* ── MAP ── */
        .homes-map { width: 50%; flex-shrink: 0; position: sticky; top: 0; height: 100%; background: var(--hh-bg-alt); }

        /* ── EMPTY STATE ── */
        .empty-state { text-align: center; padding: 60px 20px; }
        .empty-title { font-family: var(--hh-font-display); font-size: 26px; font-weight: 380; color: var(--hh-text); margin-bottom: 10px; font-style: italic; }
        .empty-sub { font-size: 14px; color: var(--hh-text-muted); margin-bottom: 18px; line-height: 1.6; }
        .reset-btn {
          background: var(--hh-primary); color: #fff; border: none;
          padding: 11px 24px; border-radius: 100px; font-size: 13px;
          font-weight: 600; cursor: pointer; font-family: var(--hh-font-ui);
          letter-spacing: -0.01em; transition: opacity 0.15s;
        }
        .reset-btn:hover { opacity: 0.85; }

        @keyframes shimmer { 0% { background-position: 100% 0 } 100% { background-position: -100% 0 } }

        /* ── RESPONSIVE ── */
        @media (max-width: 768px) {
          .homes-page { height: auto; overflow: visible; }
          .homes-body { flex-direction: column; }
          .homes-list, .homes-list.full { width: 100%; padding: 16px 12px 40px; }
          .homes-grid, .homes-list.full .homes-grid { grid-template-columns: 1fr; gap: 12px; }
          .hc2-featured { grid-column: span 1; }
          .hc2-img-wrap { height: 230px; }
          .hc2-img-wrap--featured { height: 230px !important; }
          .homes-map { width: 100%; height: 300px; position: relative; }
          .search-box { max-width: 100%; }
          .toolbar-right { margin-left: 0; width: 100%; justify-content: space-between; }
          .hc2-arrow { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div className="homes-page">

        {/* TOOLBAR */}
        <div className="homes-toolbar">

          {/* Search */}
          <div className="search-box">
            <span style={{ color: 'var(--hh-text-muted)', fontSize: '14px' }}>🔍</span>
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
              style={{ cursor: 'pointer', border: '1.5px solid var(--hh-border-faint)' }}
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
                {[0, 1, 2, 3, 5, 6].map(i => (
                  <div key={i} style={{ background: '#fff', borderRadius: '18px', overflow: 'hidden', border: '1px solid var(--hh-border-faint)' }}>
                    <div style={{ height: '200px', background: 'linear-gradient(90deg,var(--hh-bg-alt) 25%,var(--hh-bg) 50%,var(--hh-bg-alt) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />
                    <div style={{ padding: '13px 15px 15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ height: '15px', width: '65%', background: 'var(--hh-bg-alt)', borderRadius: '4px' }} />
                      <div style={{ height: '22px', width: '40%', background: 'var(--hh-bg-alt)', borderRadius: '100px' }} />
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
            ) : (() => {
              const featured    = filtered.filter(h => h.is_featured)
              const rentals     = filtered.filter(h => !h.is_featured && h.listing_type === 'standard_rental')
              const subleases   = filtered.filter(h => !h.is_featured && h.listing_type === 'sublease')
              const transfers   = filtered.filter(h => !h.is_featured && h.listing_type === 'lease_transfer')

              return (
                <>
                  {/* Featured */}
                  {featured.length > 0 && (
                    <>
                      <SectionHeading label="Featured Picks" count={featured.length} />
                      <div className="homes-grid">
                        {featured.map((home, i) => (
                          <HomeCard key={home.slug} home={home} onHover={setHoveredId} featured={i === 0 && featured.length === 1} />
                        ))}
                      </div>
                    </>
                  )}

                  {/* For Rent */}
                  {rentals.length > 0 && (
                    <>
                      <SectionHeading label="For Rent" count={rentals.length} />
                      <div className="homes-grid">
                        {rentals.map(home => (
                          <HomeCard key={home.slug} home={home} onHover={setHoveredId} />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Subleases */}
                  {subleases.length > 0 && (
                    <>
                      <SectionHeading label="Subleases" count={subleases.length} />
                      <div className="homes-grid">
                        {subleases.map(home => (
                          <HomeCard key={home.slug} home={home} onHover={setHoveredId} />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Lease Transfers */}
                  {transfers.length > 0 && (
                    <>
                      <SectionHeading label="Lease Transfers" count={transfers.length} />
                      <div className="homes-grid">
                        {transfers.map(home => (
                          <HomeCard key={home.slug} home={home} onHover={setHoveredId} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )
            })()}
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

export default function HomesPageClient({ initialProperties }: { initialProperties?: Property[] }) {
  return (
    <Suspense fallback={null}>
      <HomesPageInner initialProperties={initialProperties} />
    </Suspense>
  )
}
