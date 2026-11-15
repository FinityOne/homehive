'use client'

/**
 * The pixel size of a box, kept current as it changes.
 *
 * ── Why a dashboard that does not scroll needs this ────────────────────────
 *
 * Every chart in this app is drawn into a fixed `viewBox` and scaled to fit
 * its container. That is the right trick for a page that scrolls, where a
 * chart's height follows its width and the page simply gets longer. It is the
 * wrong trick here. On a deck whose panes are handed *whatever height is
 * left*, a chart has to be told its height, not derive it — and a scaled
 * viewBox distorts everything inside it the moment the two axes disagree: a
 * hover dot becomes an ellipse and 10px axis labels become 5px on a phone.
 *
 * Measuring instead means the chart is drawn at 1:1, so a pixel is a pixel,
 * text is the size it says it is at every width, and the plot fills exactly
 * the space the layout gave it.
 *
 * Returns zeroes on the first render and before the observer fires, so every
 * caller must handle a zero size by drawing nothing — which is also what makes
 * this safe on the server, where there is no element to measure.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type Size = { w: number; h: number }

export function useSize<T extends HTMLElement>(): [(el: T | null) => void, Size] {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const observer = useRef<ResizeObserver | null>(null)

  // A callback ref rather than a `useRef` + effect: the element a pane renders
  // changes identity when the pane switches, and a callback ref is the only
  // form that is told about that.
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      // Rounded, because a fractional width makes the observer fire on every
      // sub-pixel reflow and re-render the chart for no visible change.
      setSize(prev => {
        const w = Math.round(r.width), h = Math.round(r.height)
        return prev.w === w && prev.h === h ? prev : { w, h }
      })
    }
    read()
    observer.current = new ResizeObserver(read)
    observer.current.observe(el)
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])

  return [ref, size]
}
