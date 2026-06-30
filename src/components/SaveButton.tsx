'use client'

import { useEffect, useState } from 'react'
import { isSaved, toggleSaved, onShortlistChange } from '@/lib/shortlist'

// Heart toggle that saves a listing to the shortlist. Self-contained (inline
// styles) so it can drop into any card without coordinating CSS. Sits in the
// top-right of a position:relative parent.
export default function SaveButton({ slug }: { slug: string }) {
  const [saved, setSaved] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setSaved(isSaved(slug))
    return onShortlistChange(() => setSaved(isSaved(slug)))
  }, [slug])

  // Avoid a hydration mismatch — render the neutral state until mounted.
  const active = mounted && saved

  return (
    <button
      type="button"
      aria-label={active ? 'Remove from shortlist' : 'Save to shortlist'}
      aria-pressed={active}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setSaved(toggleSaved(slug))
      }}
      style={{
        position: 'absolute', top: 10, right: 10, zIndex: 3,
        width: 34, height: 34, borderRadius: '50%',
        background: 'rgba(255,255,255,0.92)',
        WebkitBackdropFilter: 'blur(6px)', backdropFilter: 'blur(6px)',
        border: 'none', padding: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        transition: 'transform 0.12s ease',
      }}
      onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.88)' }}
      onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        fill={active ? '#e0245e' : 'none'}
        stroke={active ? '#e0245e' : '#1a1a1a'} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
