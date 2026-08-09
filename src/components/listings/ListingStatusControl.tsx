'use client'

import { useState } from 'react'
import {
  LISTING_STATUS_META,
  LISTING_STATUS_ORDER,
  MARKETING_TOOLTIP,
  INQUIRIES_TOOLTIP,
  describeVisibility,
  type ListingStatus,
} from '@/lib/listingStatus'
import { updateListingStatus, type Property } from '@/lib/properties'

/**
 * The landlord's single place to control where a listing appears.
 *
 * Design: one primary choice (three status cards) plus only the settings that
 * matter for that choice — extra toggles appear contextually instead of sitting
 * there as permanent noise. A live "Where it shows" strip answers the only
 * question a landlord actually has: who can see this right now?
 */

function Tip({ text }: { text: string }) {
  return (
    <span className="lsc-tip" tabIndex={0} role="button" aria-label={text}>
      i
      <span className="lsc-tip-bubble" role="tooltip">{text}</span>
    </span>
  )
}

type Props = {
  property: Property
  /** Called with the saved fields so the parent can update its own copy. */
  onSaved?: (patch: Partial<Property>) => void
}

export default function ListingStatusControl({ property, onSaved }: Props) {
  const [status, setStatus] = useState<ListingStatus>(property.listing_status ?? 'active')
  const [marketing, setMarketing] = useState(property.marketing_enabled ?? true)
  const [inquiries, setInquiries] = useState(property.accepting_inquiries ?? true)
  const [showWhenRented, setShowWhenRented] = useState(property.show_when_rented ?? false)
  const [rentedUntil, setRentedUntil] = useState(property.rented_until ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Local state seeds from props once; callers pass key={property.id} so
  // switching listings remounts with fresh values.
  const dirty =
    status !== (property.listing_status ?? 'active') ||
    marketing !== (property.marketing_enabled ?? true) ||
    inquiries !== (property.accepting_inquiries ?? true) ||
    showWhenRented !== (property.show_when_rented ?? false) ||
    (rentedUntil || '') !== (property.rented_until ?? '')

  const visibility = describeVisibility({
    listing_status: status,
    marketing_enabled: marketing,
    accepting_inquiries: inquiries,
    show_when_rented: showWhenRented,
    admin_status: property.admin_status,
    archived_at: property.archived_at,
  })

  async function save() {
    setSaving(true)
    setMsg(null)
    const patch = {
      listing_status: status,
      marketing_enabled: marketing,
      accepting_inquiries: inquiries,
      show_when_rented: status === 'rented' ? showWhenRented : false,
      rented_until: status === 'rented' && rentedUntil ? rentedUntil : null,
    }
    const { error } = await updateListingStatus(property.id, patch, property.admin_status)
    setSaving(false)
    if (error) {
      setMsg({ ok: false, text: 'Could not save. Please try again.' })
      return
    }
    setMsg({ ok: true, text: `Saved — your listing is now ${LISTING_STATUS_META[status].label}.` })
    onSaved?.(patch as Partial<Property>)
    setTimeout(() => setMsg(null), 4000)
  }

  return (
    <div className="lsc">
      <style>{`
        .lsc { font-family: 'DM Sans', sans-serif; }

        .lsc-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .lsc-opt { position: relative; text-align: left; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 13px 14px; cursor: pointer; font-family: inherit; transition: border-color .15s, box-shadow .15s, background .15s; }
        .lsc-opt:hover { border-color: #cbd5e1; }
        .lsc-opt:focus-visible { outline: 2px solid #0f172a; outline-offset: 2px; }
        .lsc-opt-top { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
        .lsc-dot { font-size: 12px; line-height: 1; }
        .lsc-opt-label { font-size: 14px; font-weight: 600; color: #0f172a; }
        .lsc-opt-blurb { font-size: 11.5px; color: #64748b; line-height: 1.45; }
        .lsc-opt.is-on { border-width: 2px; padding: 12px 13px; }

        .lsc-panel { margin-top: 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; background: #fff; }
        .lsc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 15px; }
        .lsc-row + .lsc-row { border-top: 1px solid #f1f5f9; }
        .lsc-row-title { font-size: 13.5px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 6px; }
        .lsc-row-sub { font-size: 11.5px; color: #64748b; margin-top: 2px; line-height: 1.45; }
        .lsc-note { padding: 13px 15px; font-size: 12.5px; color: #64748b; line-height: 1.5; }

        .lsc-switch { position: relative; width: 42px; height: 23px; flex-shrink: 0; }
        .lsc-switch input { opacity: 0; width: 0; height: 0; }
        .lsc-slider { position: absolute; inset: 0; background: #e2e8f0; border-radius: 24px; cursor: pointer; transition: background .2s; }
        .lsc-slider::before { content: ''; position: absolute; width: 17px; height: 17px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .2s; }
        .lsc-switch input:checked + .lsc-slider { background: #10b981; }
        .lsc-switch input:checked + .lsc-slider::before { transform: translateX(19px); }
        .lsc-switch input:focus-visible + .lsc-slider { outline: 2px solid #0f172a; outline-offset: 2px; }

        .lsc-date { border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; color: #0f172a; background: #fff; outline: none; }
        .lsc-date:focus { border-color: #10b981; }

        .lsc-vis { margin-top: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .lsc-vis-item { border: 1px solid #eef2f7; background: #fafbfc; border-radius: 9px; padding: 10px 12px; }
        .lsc-vis-hdr { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: #0f172a; }
        .lsc-vis-mark { font-size: 12px; font-weight: 700; }
        .lsc-vis-note { font-size: 11px; color: #94a3b8; line-height: 1.4; margin-top: 3px; }

        .lsc-actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
        .lsc-save { background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .lsc-save:disabled { opacity: .5; cursor: not-allowed; }
        .lsc-save:not(:disabled):hover { background: #1e293b; }
        .lsc-msg { font-size: 12.5px; font-weight: 500; }

        /* Tooltip — hover or keyboard focus, no library */
        .lsc-tip { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; background: #e2e8f0; color: #475569; font-size: 10px; font-weight: 700; font-style: italic; cursor: help; position: relative; flex-shrink: 0; }
        .lsc-tip:hover, .lsc-tip:focus-visible { background: #cbd5e1; outline: none; }
        .lsc-tip-bubble { visibility: hidden; opacity: 0; position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 260px; background: #0f172a; color: #f8fafc; font-size: 11.5px; font-style: normal; font-weight: 400; line-height: 1.5; text-align: left; padding: 9px 11px; border-radius: 8px; z-index: 30; transition: opacity .12s; pointer-events: none; box-shadow: 0 8px 24px rgba(15,23,42,.18); }
        .lsc-tip-bubble::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 5px solid transparent; border-top-color: #0f172a; }
        .lsc-tip:hover .lsc-tip-bubble, .lsc-tip:focus-visible .lsc-tip-bubble { visibility: visible; opacity: 1; }

        @media (max-width: 640px) {
          .lsc-options, .lsc-vis { grid-template-columns: 1fr; }
          .lsc-tip-bubble { width: 200px; }
        }
      `}</style>

      {/* Primary choice */}
      <div className="lsc-options" role="radiogroup" aria-label="Listing status">
        {LISTING_STATUS_ORDER.map(s => {
          const meta = LISTING_STATUS_META[s]
          const on = status === s
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              className={`lsc-opt${on ? ' is-on' : ''}`}
              style={on ? { borderColor: meta.border, background: meta.bg } : undefined}
              onClick={() => setStatus(s)}
            >
              <span className="lsc-opt-top">
                <span className="lsc-dot" style={{ color: meta.color }}>{meta.icon}</span>
                <span className="lsc-opt-label">{meta.label}</span>
                <Tip text={meta.tooltip} />
              </span>
              <span className="lsc-opt-blurb">{meta.blurb}</span>
            </button>
          )
        })}
      </div>

      {/* Contextual settings — only what this status can change */}
      <div className="lsc-panel">
        {status === 'active' && (
          <>
            <div className="lsc-row">
              <div>
                <div className="lsc-row-title">
                  Promote this listing
                  <Tip text={MARKETING_TOOLTIP} />
                </div>
                <div className="lsc-row-sub">Homepage, featured slots and search-engine sitemap.</div>
              </div>
              <label className="lsc-switch">
                <input type="checkbox" checked={marketing} onChange={e => setMarketing(e.target.checked)} aria-label="Promote this listing" />
                <span className="lsc-slider" />
              </label>
            </div>
            <div className="lsc-row">
              <div>
                <div className="lsc-row-title">
                  Accept new inquiries
                  <Tip text={INQUIRIES_TOOLTIP} />
                </div>
                <div className="lsc-row-sub">Shows the request form on your listing page.</div>
              </div>
              <label className="lsc-switch">
                <input type="checkbox" checked={inquiries} onChange={e => setInquiries(e.target.checked)} aria-label="Accept new inquiries" />
                <span className="lsc-slider" />
              </label>
            </div>
          </>
        )}

        {status === 'rented' && (
          <>
            <div className="lsc-row">
              <div>
                <div className="lsc-row-title">
                  Keep the page up for a waitlist
                  <Tip text="Students who find your page after it's rented are your cheapest leads for the next term — they've already chosen the home. With this on, the page stays live with a Rented badge and a waitlist form instead of disappearing." />
                </div>
                <div className="lsc-row-sub">Page stays live with a Rented badge. Off = hidden everywhere.</div>
              </div>
              <label className="lsc-switch">
                <input type="checkbox" checked={showWhenRented} onChange={e => setShowWhenRented(e.target.checked)} aria-label="Keep the page up for a waitlist" />
                <span className="lsc-slider" />
              </label>
            </div>
            <div className="lsc-row">
              <div>
                <div className="lsc-row-title">
                  Available again
                  <Tip text="Optional. Shown to waitlist visitors so they know when to come back, and used to remind you to relist before the lease ends." />
                </div>
                <div className="lsc-row-sub">Usually the end of the current lease.</div>
              </div>
              <input
                className="lsc-date"
                type="date"
                value={rentedUntil}
                onChange={e => setRentedUntil(e.target.value)}
                aria-label="Available again"
              />
            </div>
          </>
        )}

        {status === 'inactive' && (
          <div className="lsc-note">
            Nothing is deleted. Your photos, leads, tours and history stay exactly as they are —
            switch back to <strong>Live</strong> whenever you&apos;re ready and the listing returns immediately.
          </div>
        )}
      </div>

      {/* Where it shows — the payoff */}
      <div className="lsc-vis">
        {visibility.map(v => (
          <div key={v.surface} className="lsc-vis-item">
            <div className="lsc-vis-hdr">
              <span className="lsc-vis-mark" style={{ color: v.visible ? '#10b981' : '#cbd5e1' }}>
                {v.visible ? '✓' : '✕'}
              </span>
              {v.surface}
            </div>
            <div className="lsc-vis-note">{v.note}</div>
          </div>
        ))}
      </div>

      <div className="lsc-actions">
        <button className="lsc-save" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save status' : 'Saved'}
        </button>
        {msg && (
          <span className="lsc-msg" style={{ color: msg.ok ? '#059669' : '#dc2626' }}>{msg.text}</span>
        )}
      </div>
    </div>
  )
}
