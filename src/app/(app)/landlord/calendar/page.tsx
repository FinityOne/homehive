'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Tour = {
  id: string
  lead_id: string
  property_slug: string
  scheduled_date: string // "2026-04-15"
  time_slot: string      // "14:00"
  status: string
  booked_by: string
  custom_note: string | null
  lead_first_name?: string
  lead_email?: string
  property_name?: string
}

function formatTime(slot: string): string {
  const [h, m] = slot.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function LandlordCalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed
  const [tours, setTours] = useState<Tour[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useEffect(() => { document.title = 'Calendar — Landlord | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }

      // Fetch all confirmed/pending tours for this landlord
      const { data: tourRows } = await supabase
        .from('tours')
        .select('*')
        .eq('landlord_id', session.user.id)
        .neq('status', 'cancelled')
        .order('scheduled_date', { ascending: true })
        .order('time_slot', { ascending: true })

      if (!tourRows || tourRows.length === 0) { setTours([]); setLoading(false); return }

      // Enrich with lead names + property names
      const leadIds = [...new Set(tourRows.map((t: Tour) => t.lead_id))]
      const slugs = [...new Set(tourRows.map((t: Tour) => t.property_slug))]

      const [{ data: leads }, { data: props }] = await Promise.all([
        supabase.from('leads').select('id, first_name, email').in('id', leadIds),
        supabase.from('properties').select('slug, name').in('slug', slugs),
      ])

      const leadMap = Object.fromEntries((leads || []).map((l: { id: string; first_name: string; email: string }) => [l.id, l]))
      const propMap = Object.fromEntries((props || []).map((p: { slug: string; name: string }) => [p.slug, p]))

      setTours(tourRows.map((t: Tour) => ({
        ...t,
        lead_first_name: leadMap[t.lead_id]?.first_name || '',
        lead_email: leadMap[t.lead_id]?.email || '',
        property_name: propMap[t.property_slug]?.name || t.property_slug,
      })))
      setLoading(false)
    }
    load()
  }, [])

  // Group tours by date
  const toursByDate = tours.reduce<Record<string, Tour[]>>((acc, t) => {
    if (!acc[t.scheduled_date]) acc[t.scheduled_date] = []
    acc[t.scheduled_date].push(t)
    return acc
  }, {})

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
    setSelectedDate(null)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
    setSelectedDate(null)
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const dayStr = (d: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const selectedTours = selectedDate ? (toursByDate[selectedDate] || []) : []

  // Count tours this month
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthTours = tours.filter(t => t.scheduled_date.startsWith(monthPrefix))

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', padding: '24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>
            Tour Calendar
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b' }}>
            {monthTours.length} tour{monthTours.length !== 1 ? 's' : ''} scheduled in {MONTH_NAMES[month]}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

          {/* ── CALENDAR ── */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>

            {/* Month nav */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e2e8f0' }}>
              <button
                onClick={prevMonth}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 14, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ‹
              </button>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                {MONTH_NAMES[month]} {year}
              </span>
              <button
                onClick={nextMonth}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 14, color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ›
              </button>
            </div>

            {/* Day labels */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #e2e8f0' }}>
              {DAY_LABELS.map(d => (
                <div key={d} style={{ padding: '10px 4px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5 }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {/* Empty cells before first day */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} style={{ minHeight: 72, borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', background: '#fafbfc' }} />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d = i + 1
                const ds = dayStr(d)
                const dayTours = toursByDate[ds] || []
                const isToday = ds === todayStr
                const isSelected = ds === selectedDate
                const hasTours = dayTours.length > 0
                const isPast = ds < todayStr

                return (
                  <div
                    key={ds}
                    onClick={() => hasTours ? setSelectedDate(isSelected ? null : ds) : undefined}
                    style={{
                      minHeight: 72,
                      borderRight: '1px solid #f1f5f9',
                      borderBottom: '1px solid #f1f5f9',
                      padding: '8px 6px 6px',
                      cursor: hasTours ? 'pointer' : 'default',
                      background: isSelected ? '#f0fdf4' : hasTours && !isPast ? '#fefce8' : '#fff',
                      transition: 'background 0.15s',
                      position: 'relative',
                    }}
                  >
                    {/* Day number */}
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isToday ? '#0f172a' : 'transparent',
                      color: isToday ? '#fff' : isPast ? '#cbd5e1' : '#1e293b',
                      fontSize: 12, fontWeight: isToday ? 700 : 500,
                      marginBottom: 4,
                    }}>
                      {d}
                    </div>

                    {/* Tour dots */}
                    {dayTours.slice(0, 3).map((t, idx) => (
                      <div key={t.id} style={{
                        fontSize: 10, fontWeight: 600,
                        color: isSelected ? '#065f46' : '#78716c',
                        background: isSelected ? 'rgba(16,185,129,0.12)' : 'rgba(251,191,36,0.2)',
                        borderRadius: 4, padding: '2px 4px',
                        marginBottom: 2, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        maxWidth: '100%',
                      }}>
                        {formatTime(t.time_slot)} · {t.lead_first_name || t.lead_email?.split('@')[0]}
                      </div>
                    ))}
                    {dayTours.length > 3 && (
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                        +{dayTours.length - 3} more
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── SIDE PANEL ── */}
          <div>
            {/* Legend */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>Legend</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#0f172a', flexShrink: 0 }} />
                  Today
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569' }}>
                  <div style={{ width: 12, height: 8, borderRadius: 3, background: 'rgba(251,191,36,0.35)', flexShrink: 0 }} />
                  Upcoming tour
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569' }}>
                  <div style={{ width: 12, height: 8, borderRadius: 3, background: 'rgba(16,185,129,0.2)', flexShrink: 0 }} />
                  Selected day
                </div>
              </div>
            </div>

            {/* Selected day tours */}
            {selectedDate ? (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {selectedTours.length} tour{selectedTours.length !== 1 ? 's' : ''}
                  </div>
                </div>
                {selectedTours.map(t => (
                  <a
                    key={t.id}
                    href={`/landlord/leads/${t.lead_id}`}
                    style={{ display: 'block', padding: '14px 16px', borderBottom: '1px solid #f1f5f9', textDecoration: 'none', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                        📅
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                          {formatTime(t.time_slot)} — {t.lead_first_name || t.lead_email?.split('@')[0] || 'Tenant'}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.property_name}
                        </div>
                        {t.custom_note && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Note: {t.custom_note}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
                            padding: '2px 6px', borderRadius: 4,
                            background: t.status === 'confirmed' ? '#f0fdf4' : '#fefce8',
                            color: t.status === 'confirmed' ? '#059669' : '#92400e',
                          }}>
                            {t.status}
                          </span>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>
                            by {t.booked_by}
                          </span>
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>→</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '32px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                  {loading ? 'Loading tours…' : 'Click a date with tours to see details'}
                </div>
              </div>
            )}

            {/* Upcoming tours list */}
            {!loading && tours.filter(t => t.scheduled_date >= todayStr).length > 0 && !selectedDate && (
              <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginTop: 16 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Upcoming
                </div>
                {tours.filter(t => t.scheduled_date >= todayStr).slice(0, 5).map(t => (
                  <a
                    key={t.id}
                    href={`/landlord/leads/${t.lead_id}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #f1f5f9', textDecoration: 'none', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ textAlign: 'center', width: 36, flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                        {parseInt(t.scheduled_date.split('-')[2])}
                      </div>
                      <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        {MONTH_NAMES[parseInt(t.scheduled_date.split('-')[1]) - 1].slice(0, 3)}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.lead_first_name || t.lead_email?.split('@')[0]} · {formatTime(t.time_slot)}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.property_name}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>→</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
