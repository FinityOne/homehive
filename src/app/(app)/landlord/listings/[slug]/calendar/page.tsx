'use client'

import { use, useEffect, useState, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Generate 30-min slots from 7am to 9pm
const ALL_SLOTS: string[] = []
for (let h = 7; h < 21; h++) {
  ALL_SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  ALL_SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}

function formatTime(slot: string): string {
  const [h, m] = slot.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function getNext7Days(): { date: string; label: string; dayName: string; isToday: boolean }[] {
  const days = []
  const today = new Date()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    days.push({
      date: dateStr,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dayName: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' }),
      isToday: i === 0,
    })
  }
  return days
}

type SlotKey = string // "date|time_slot"
type RemoteSlot = { id: string; date: string; time_slot: string; is_booked: boolean }

function slotKey(date: string, time: string): SlotKey { return `${date}|${time}` }

export default function CalendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [property, setProperty] = useState<{ name: string; address: string } | null>(null)
  const [days] = useState(getNext7Days)

  // selected = set of slotKey strings the landlord has toggled on
  const [selected, setSelected] = useState<Set<SlotKey>>(new Set())
  // booked = slots already locked by a tenant
  const [booked, setBooked] = useState<Set<SlotKey>>(new Set())
  // remote = existing slots fetched from server (slotKey → id)
  const [remoteSlots, setRemoteSlots] = useState<Map<SlotKey, RemoteSlot>>(new Map())

  // drag state
  const dragRef = useRef<{ active: boolean; adding: boolean; keys: Set<SlotKey> }>({ active: false, adding: true, keys: new Set() })
  const [isDragging, setIsDragging] = useState(false)

  const [session, setSession] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    init()
  }, [slug])

  async function init() {
    const { data: { session: s } } = await supabase.auth.getSession()
    if (!s) { router.push('/login'); return }
    setSession(s.access_token)

    // Fetch property
    const { data: prop } = await supabase.from('properties').select('name, address, owner_id').eq('slug', slug).single()
    if (!prop || prop.owner_id !== s.user.id) { router.push('/landlord/listings'); return }
    setProperty({ name: prop.name, address: prop.address })

    // Fetch existing availability
    const res = await fetch(`/api/properties/${slug}/availability?all=true`)
    if (res.ok) {
      const { slots } = await res.json() as { slots: RemoteSlot[] }
      const newRemote = new Map<SlotKey, RemoteSlot>()
      const newSelected = new Set<SlotKey>()
      const newBooked = new Set<SlotKey>()
      for (const s of slots) {
        const k = slotKey(s.date, s.time_slot)
        newRemote.set(k, s)
        if (!s.is_booked) newSelected.add(k)
        if (s.is_booked) newBooked.add(k)
      }
      setRemoteSlots(newRemote)
      setSelected(newSelected)
      setBooked(newBooked)
    }

    setLoading(false)
  }

  // ── Drag handlers ──
  function onSlotPointerDown(date: string, time: string, e: React.PointerEvent) {
    e.preventDefault()
    const key = slotKey(date, time)
    const adding = !selected.has(key)
    dragRef.current = { active: true, adding, keys: new Set([key]) }
    setIsDragging(true)

    setSelected(prev => {
      const next = new Set(prev)
      if (adding) next.add(key)
      else next.delete(key)
      return next
    })

    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onSlotPointerEnter(date: string, time: string) {
    if (!dragRef.current.active) return
    const key = slotKey(date, time)
    if (dragRef.current.keys.has(key)) return
    dragRef.current.keys.add(key)

    setSelected(prev => {
      const next = new Set(prev)
      if (dragRef.current.adding) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const endDrag = useCallback(() => {
    dragRef.current.active = false
    setIsDragging(false)
  }, [])

  useEffect(() => {
    window.addEventListener('pointerup', endDrag)
    return () => window.removeEventListener('pointerup', endDrag)
  }, [endDrag])

  async function handleSave() {
    if (!session) return
    setSaving(true)

    // Determine what to send
    const slots: { date: string; time_slot: string }[] = []
    const clearDates = new Set<string>()

    for (const key of selected) {
      const [date, time_slot] = key.split('|')
      if (!booked.has(key)) {
        slots.push({ date, time_slot })
        clearDates.add(date)
      }
    }

    // Also clear days where we removed all slots
    for (const day of days) {
      const hadSlotsForDay = Array.from(remoteSlots.keys()).some(k => k.startsWith(day.date + '|') && !booked.has(k))
      if (hadSlotsForDay) clearDates.add(day.date)
    }

    const res = await fetch(`/api/properties/${slug}/availability`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session}`,
      },
      body: JSON.stringify({ slots, clearDates: Array.from(clearDates) }),
    })

    if (res.ok) {
      showToast('Availability saved!')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      // Refresh
      await init()
    } else {
      const body = await res.json()
      showToast(body.error || 'Failed to save', 'error')
    }
    setSaving(false)
  }

  function selectAll(date: string) {
    setSelected(prev => {
      const next = new Set(prev)
      ALL_SLOTS.forEach(t => { if (!booked.has(slotKey(date, t))) next.add(slotKey(date, t)) })
      return next
    })
  }

  function clearDay(date: string) {
    setSelected(prev => {
      const next = new Set(prev)
      ALL_SLOTS.forEach(t => { if (!booked.has(slotKey(date, t))) next.delete(slotKey(date, t)) })
      return next
    })
  }

  const selectedCount = selected.size + booked.size

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* Full-viewport layout — no page scroll */
        .cal-page {
          height: 100svh;
          display: flex;
          flex-direction: column;
          background: #f5f4f0;
          font-family: 'DM Sans', sans-serif;
          overflow: hidden;
        }

        /* Top bar */
        .cal-topbar {
          background: #fff;
          border-bottom: 1px solid #e8e5de;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-shrink: 0;
          z-index: 20;
        }
        .cal-topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .cal-back {
          display: flex; align-items: center; gap: 4px;
          font-size: 12px; color: #9b9b9b; text-decoration: none;
          background: none; border: none; cursor: pointer;
          font-family: 'DM Sans', sans-serif; padding: 0; flex-shrink: 0;
        }
        .cal-back:hover { color: #1a1a1a; }
        .cal-title { font-size: 14px; font-weight: 700; color: #1a1a1a; white-space: nowrap; }
        .cal-subtitle { font-size: 11px; color: #9b9b9b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Legend inline in topbar */
        .cal-legend {
          display: flex; gap: 12px; align-items: center; flex-shrink: 0;
        }
        .cal-legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b6b6b; white-space: nowrap; }
        .cal-legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }

        /* Slot count badge */
        .cal-slot-count {
          font-size: 11px; color: #9b9b9b; white-space: nowrap; flex-shrink: 0;
        }

        .cal-save-btn {
          background: #1a1a1a; color: #FFC627; border: none; border-radius: 8px;
          padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer;
          font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; white-space: nowrap; flex-shrink: 0;
        }
        .cal-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .cal-save-btn.saved { background: #10b981; color: #fff; }

        /* Scrollable grid area fills remaining height */
        .cal-body {
          flex: 1;
          overflow: auto;
          padding: 10px 12px 12px;
          -webkit-overflow-scrolling: touch;
        }

        /* Grid container */
        .cal-grid-wrap {
          background: #fff;
          border: 1px solid #e8e5de;
          border-radius: 12px;
          overflow: hidden;
          min-width: 560px;
        }

        .cal-grid-header {
          display: grid;
          grid-template-columns: 52px repeat(7, 1fr);
          border-bottom: 1px solid #e8e5de;
          background: #faf9f6;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .cal-grid-header-cell {
          padding: 6px 4px;
          text-align: center;
          border-right: 1px solid #e8e5de;
        }
        .cal-grid-header-cell:last-child { border-right: none; }
        .cal-grid-day-name { font-size: 10px; font-weight: 700; color: #6b6b6b; text-transform: uppercase; letter-spacing: 0.4px; }
        .cal-grid-day-date { font-size: 12px; font-weight: 600; color: #1a1a1a; margin-top: 1px; }
        .cal-grid-today .cal-grid-day-name,
        .cal-grid-today .cal-grid-day-date { color: #8C1D40; }

        /* All/Clear inline per column */
        .cal-day-actions { display: flex; gap: 4px; justify-content: center; margin-top: 3px; }
        .cal-day-action-btn {
          font-size: 9px; font-weight: 600; color: #9b9b9b;
          background: none; border: none; cursor: pointer; padding: 0;
          font-family: 'DM Sans', sans-serif; text-decoration: underline; line-height: 1;
        }
        .cal-day-action-btn:hover { color: #1a1a1a; }

        /* Rows */
        .cal-row {
          display: grid;
          grid-template-columns: 52px repeat(7, 1fr);
          border-bottom: 1px solid #f0ede6;
        }
        .cal-row:last-child { border-bottom: none; }

        /* Only show label on :00 rows, leave :30 blank */
        .cal-time-label {
          padding: 0 6px 0 0;
          font-size: 10px;
          color: #b0a898;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          border-right: 1px solid #e8e5de;
          white-space: nowrap;
          height: 20px;
        }

        .cal-cell {
          border-right: 1px solid #f0ede6;
          padding: 2px;
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
        }
        .cal-cell:last-child { border-right: none; }

        .cal-slot {
          width: 100%;
          height: 16px;
          border-radius: 3px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background 0.08s;
          background: #f0ede6;
        }
        .cal-slot:hover { background: #ddd9d0; }
        .cal-slot.available { background: #10b981; border-color: #059669; }
        .cal-slot.available:hover { background: #059669; }
        .cal-slot.booked { background: #8b5cf6; border-color: #7c3aed; cursor: not-allowed; }
        .cal-slot.dragging { background: #FFC627; border-color: #d97706; }

        /* Toast */
        .cal-toast {
          position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
          background: #1a1a1a; color: #fff; border-radius: 8px;
          padding: 10px 20px; font-size: 13px; font-weight: 600;
          z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,0.2); white-space: nowrap;
        }
        .cal-toast.error { background: #dc2626; }

        @media (max-width: 640px) {
          .cal-legend { display: none; }
          .cal-slot-count { display: none; }
        }
      `}</style>

      <div className="cal-page">
        {/* Topbar — all controls in one line */}
        <div className="cal-topbar">
          <div className="cal-topbar-left">
            <Link href={`/landlord/listings/${slug}`} className="cal-back">← Back</Link>
            <div style={{ borderLeft: '1px solid #e8e5de', paddingLeft: '10px' }}>
              <div className="cal-title">Tour Availability</div>
              {property && <div className="cal-subtitle">{property.name}</div>}
            </div>
          </div>

          {/* Legend + count + save — all inline */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="cal-legend">
              <div className="cal-legend-item">
                <div className="cal-legend-dot" style={{ background: '#f0ede6', border: '1px solid #d4d0c8' }} />
                Empty
              </div>
              <div className="cal-legend-item">
                <div className="cal-legend-dot" style={{ background: '#10b981' }} />
                Open
              </div>
              <div className="cal-legend-item">
                <div className="cal-legend-dot" style={{ background: '#8b5cf6' }} />
                Booked
              </div>
            </div>
            <div className="cal-slot-count">
              {selected.size} open · {booked.size} booked
            </div>
            <button
              className={`cal-save-btn${saved ? ' saved' : ''}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* Grid — fills remaining height, scrolls only horizontally on mobile */}
        <div className="cal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#9b9b9b', fontSize: '13px' }}>Loading...</div>
          ) : (
            <div className="cal-grid-wrap">
              {/* Sticky header */}
              <div className="cal-grid-header">
                <div style={{ borderRight: '1px solid #e8e5de' }} />
                {days.map(day => (
                  <div key={day.date} className={`cal-grid-header-cell${day.isToday ? ' cal-grid-today' : ''}`}>
                    <div className="cal-grid-day-name">{day.dayName}</div>
                    <div className="cal-grid-day-date">{day.label}</div>
                    <div className="cal-day-actions">
                      <button className="cal-day-action-btn" onClick={() => selectAll(day.date)}>All</button>
                      <span style={{ color: '#d4d0c8', fontSize: '9px' }}>·</span>
                      <button className="cal-day-action-btn" onClick={() => clearDay(day.date)}>Clear</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Slot rows */}
              {ALL_SLOTS.map(time => {
                const isHour = time.endsWith(':00')
                return (
                  <div key={time} className="cal-row">
                    <div className="cal-time-label">
                      {isHour ? formatTime(time).replace(':00', '') : ''}
                    </div>
                    {days.map(day => {
                      const key = slotKey(day.date, time)
                      const isSelected = selected.has(key)
                      const isBooked = booked.has(key)
                      const isDrag = isDragging && dragRef.current.keys.has(key)
                      return (
                        <div key={day.date} className="cal-cell">
                          <div
                            className={`cal-slot${isBooked ? ' booked' : isSelected ? ' available' : isDrag ? ' dragging' : ''}`}
                            onPointerDown={isBooked ? undefined : (e) => onSlotPointerDown(day.date, time, e)}
                            onPointerEnter={() => onSlotPointerEnter(day.date, time)}
                            title={isBooked ? 'Booked' : isSelected ? `${formatTime(time)} — click to remove` : `${formatTime(time)} — click to add`}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className={`cal-toast${toast.type === 'error' ? ' error' : ''}`}>{toast.msg}</div>
      )}
    </>
  )
}
