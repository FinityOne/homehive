'use client'

import '@/styles/brand-tokens.css'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getPropertiesBySlugs, type Property } from '@/lib/properties'
import {
  getShortlist, removeSaved, addManySaved, onShortlistChange,
} from '@/lib/shortlist'

function SavedInner() {
  const sp = useSearchParams()
  const sharedIds = (sp.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const isShared = sharedIds.length > 0

  const [homes, setHomes] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [roommates, setRoommates] = useState(2)
  const [copied, setCopied] = useState(false)
  const [savedShared, setSavedShared] = useState(false)

  // Load the right set of slugs and fetch them.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const slugs = isShared ? sharedIds : getShortlist()
      if (slugs.length === 0) { if (!cancelled) { setHomes([]); setLoading(false) }; return }
      const data = await getPropertiesBySlugs(slugs)
      if (!cancelled) { setHomes(data); setLoading(false) }
    }
    load()
    // Keep the personal list reactive (heart toggles elsewhere / other tabs).
    const off = isShared ? () => {} : onShortlistChange(load)
    return () => { cancelled = true; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShared, sp])

  const total = homes.reduce((sum, h) => sum + (h.price || 0), 0)
  const cheapest = homes.length ? Math.min(...homes.map(h => h.price || 0)) : 0

  const share = async () => {
    const slugs = isShared ? sharedIds : getShortlist()
    const url = `${window.location.origin}/saved?ids=${slugs.join(',')}`
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'My HomeHive shortlist', text: 'Check out these places near ASU 👀', url })
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2200)
      }
    } catch { /* user dismissed share sheet */ }
  }

  const acceptShared = () => { addManySaved(sharedIds); setSavedShared(true) }

  return (
    <div className="sv-wrap">
      <style>{`
        .sv-wrap { max-width: 1100px; margin: 0 auto; padding: 40px 24px 80px; }
        .sv-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 8px; }
        .sv-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--hh-text-muted); margin-bottom: 10px; }
        .sv-title { font-family: var(--hh-font-display); font-size: clamp(30px, 4vw, 46px); font-weight: 350; letter-spacing: -0.03em; line-height: 1.05; color: var(--hh-text); margin: 0; }
        .sv-title em { font-style: italic; color: var(--hh-primary); }
        .sv-share { display: inline-flex; align-items: center; gap: 8px; background: var(--hh-ink-900); color: #fff; border: none; border-radius: 100px; padding: 12px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: var(--hh-font-ui); transition: background 0.15s, transform 0.15s; white-space: nowrap; }
        .sv-share:hover { background: var(--hh-hive-800); transform: translateY(-1px); }

        .sv-shared-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 14px; padding: 14px 18px; margin: 22px 0 0; }
        .sv-shared-banner span { font-size: 14px; color: #7c2d12; }
        .sv-shared-banner button { background: #1a1a1a; color: #fff; border: none; border-radius: 100px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .sv-shared-banner button:disabled { opacity: 0.6; cursor: default; }

        .sv-split { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; background: var(--hh-bg-alt); border: 1px solid var(--hh-border-faint); border-radius: 16px; padding: 16px 20px; margin: 22px 0 28px; }
        .sv-split-label { font-size: 14px; color: var(--hh-text); font-weight: 500; }
        .sv-stepper { display: inline-flex; align-items: center; gap: 0; border: 1.5px solid var(--hh-border); border-radius: 100px; overflow: hidden; background: #fff; }
        .sv-stepper button { width: 34px; height: 34px; border: none; background: #fff; font-size: 18px; line-height: 1; cursor: pointer; color: var(--hh-text); }
        .sv-stepper button:hover { background: var(--hh-bg-alt); }
        .sv-stepper button:disabled { opacity: 0.35; cursor: default; }
        .sv-stepper-val { min-width: 30px; text-align: center; font-size: 15px; font-weight: 700; color: var(--hh-text); }
        .sv-split-stat { font-size: 13px; color: var(--hh-text-muted); }
        .sv-split-stat strong { color: var(--hh-primary); font-size: 15px; }

        .sv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 22px 20px; }
        .sv-card { position: relative; display: flex; flex-direction: column; background: #fff; border: 1px solid var(--hh-border-faint); border-radius: 16px; overflow: hidden; transition: transform 0.18s, box-shadow 0.18s; }
        .sv-card:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(34,40,16,0.10); }
        .sv-media { position: relative; aspect-ratio: 4 / 3; background: var(--hh-bg-alt); }
        .sv-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .sv-media-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 38px; background: linear-gradient(135deg,#ede9e0,#d9d2c5); }
        .sv-remove { position: absolute; top: 10px; right: 10px; z-index: 2; width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(26,26,26,0.78); color: #fff; font-size: 16px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .sv-remove:hover { background: #1a1a1a; }
        .sv-card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .sv-card-name { font-size: 15px; font-weight: 600; color: var(--hh-text); text-decoration: none; line-height: 1.3; }
        .sv-card-name:hover { color: var(--hh-primary); }
        .sv-card-meta { font-size: 13px; color: var(--hh-text-muted); }
        .sv-card-split { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--hh-border-faint); display: flex; align-items: baseline; justify-content: space-between; }
        .sv-card-per { font-size: 13px; color: var(--hh-text-muted); }
        .sv-card-per strong { font-size: 17px; font-weight: 700; color: var(--hh-text); }
        .sv-card-total { font-size: 12px; color: var(--hh-text-muted); }

        .sv-empty { text-align: center; padding: 80px 20px; }
        .sv-empty-icon { font-size: 40px; margin-bottom: 14px; }
        .sv-empty-title { font-family: var(--hh-font-display); font-size: 24px; font-weight: 350; color: var(--hh-text); margin-bottom: 8px; }
        .sv-empty-sub { font-size: 14px; color: var(--hh-text-muted); margin-bottom: 22px; }
        .sv-empty-btn { display: inline-block; background: var(--hh-ink-900); color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 100px; }

        @media (max-width: 600px) {
          .sv-wrap { padding: 28px 16px 64px; }
          .sv-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px 12px; }
        }
      `}</style>

      <div className="sv-head">
        <div>
          <div className="sv-eyebrow">{isShared ? 'Shared with you' : 'Your shortlist'}</div>
          <h1 className="sv-title">
            {isShared ? <>A crew picked <em>these places</em></> : <>Homes <em>you saved</em></>}
          </h1>
        </div>
        {homes.length > 0 && (
          <button className="sv-share" onClick={share}>
            {copied ? '✓ Link copied!' : <>🔗 Share with your crew</>}
          </button>
        )}
      </div>

      {isShared && (
        <div className="sv-shared-banner">
          <span>👋 Someone shared {sharedIds.length} {sharedIds.length === 1 ? 'home' : 'homes'} with you. Add them to your own shortlist?</span>
          <button onClick={acceptShared} disabled={savedShared}>
            {savedShared ? '✓ Added' : 'Save all to my shortlist'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="sv-empty"><div className="sv-empty-sub">Loading your homes…</div></div>
      ) : homes.length === 0 ? (
        <div className="sv-empty">
          <div className="sv-empty-icon">🤍</div>
          <div className="sv-empty-title">No saved homes yet</div>
          <div className="sv-empty-sub">Tap the heart on any listing to save it here, then share with your roommates.</div>
          <a href="/homes" className="sv-empty-btn">Browse homes →</a>
        </div>
      ) : (
        <>
          <div className="sv-split">
            <span className="sv-split-label">Splitting rent between</span>
            <div className="sv-stepper">
              <button onClick={() => setRoommates(n => Math.max(1, n - 1))} disabled={roommates <= 1} aria-label="Fewer roommates">−</button>
              <span className="sv-stepper-val">{roommates}</span>
              <button onClick={() => setRoommates(n => Math.min(12, n + 1))} disabled={roommates >= 12} aria-label="More roommates">+</button>
            </div>
            <span className="sv-split-label">{roommates === 1 ? 'person' : 'people'}</span>
            <span className="sv-split-stat" style={{ marginLeft: 'auto' }}>
              Cheapest split here: <strong>${Math.round(cheapest / roommates).toLocaleString()}/mo each</strong>
              {' · '}avg ${Math.round((total / homes.length) / roommates).toLocaleString()}/mo each
            </span>
          </div>

          <div className="sv-grid">
            {homes.map(h => {
              const per = Math.round((h.price || 0) / roommates)
              return (
                <div key={h.slug} className="sv-card">
                  <div className="sv-media">
                    {h.images?.[0]
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={h.images[0]} alt={h.name} loading="lazy" />
                      : <div className="sv-media-ph">🏠</div>}
                    {!isShared && (
                      <button className="sv-remove" aria-label="Remove from shortlist" onClick={() => removeSaved(h.slug)}>×</button>
                    )}
                  </div>
                  <div className="sv-card-body">
                    <a href={`/homes/${h.slug}`} className="sv-card-name">{h.name}</a>
                    <div className="sv-card-meta">
                      {[h.beds > 0 ? `${h.beds} bd` : null, h.baths > 0 ? `${h.baths} ba` : null,
                        typeof h.asu_distance === 'number' ? `${h.asu_distance} mi to ASU` : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                    <div className="sv-card-split">
                      <span className="sv-card-per"><strong>${per.toLocaleString()}</strong> /person</span>
                      <span className="sv-card-total">${(h.price || 0).toLocaleString()}/mo total</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function SavedPage() {
  return (
    <Suspense fallback={null}>
      <SavedInner />
    </Suspense>
  )
}
