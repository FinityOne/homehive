'use client'

/**
 * One modal shape for the tenant portal, with the keyboard and screen-reader
 * mechanics written once.
 *
 * The portal had two hand-rolled modals — the pay sheet and the late-fee
 * explanation — and between them they implemented the dialog contract twice
 * and incompletely. Neither closed on Escape. Neither trapped focus, so Tab
 * from the last field walked out of the pay sheet and into the page behind it,
 * which on a payment form means a tenant can be typing into something they
 * cannot see. The pay sheet had no `role="dialog"` at all, so a screen reader
 * announced nothing when it opened. Neither locked the page scroll, so a phone
 * scrolled the lease page behind the sheet. And both were centred cards, which
 * is the wrong shape for a thumb — on a phone this renders as a bottom sheet
 * (see `.tp-sheet` in the theme).
 *
 * What it guarantees:
 *   • Escape closes it, and the backdrop closes it, and the close button
 *     closes it — all three, because people reach for different ones.
 *   • Focus moves inside on open and returns to whatever opened it on close,
 *     so a tenant who opens a fee explanation and closes it is back on the fee
 *     row they were reading, not at the top of the document.
 *   • Tab and Shift-Tab cycle within the sheet.
 *   • The page behind cannot scroll, and `aria-hidden` is not faked — the
 *     dialog is labelled by its own title, so what gets announced is the thing
 *     the tenant opened.
 *
 * `onClose` is called for every dismissal. A sheet in the middle of taking a
 * payment passes `dismissible={false}`, which withdraws Escape and the
 * backdrop but keeps focus trapped — losing a payment to a stray Escape press
 * is the one dismissal that is never what someone meant.
 */

import { useCallback, useEffect, useId, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function TenantSheet({
  kicker, title, subtitle, children, footer, onClose,
  dismissible = true, wide = false, labelledBy,
}: {
  /** Small line above the title — what kind of thing this is. */
  kicker?: string
  /** The dialog's accessible name. Required unless `labelledBy` is given. */
  title?: string
  subtitle?: string
  children: React.ReactNode
  /** Pinned under the scroll area, so the primary action never scrolls away. */
  footer?: React.ReactNode
  onClose: () => void
  /** False while a payment is in flight: no Escape, no backdrop dismissal. */
  dismissible?: boolean
  wide?: boolean
  /** Id of an element inside that names the dialog, when `title` is not used. */
  labelledBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  /** Whatever had focus when the sheet opened, to give it back on close. */
  const restoreTo = useRef<HTMLElement | null>(null)

  const close = useCallback(() => { if (dismissible) onClose() }, [dismissible, onClose])

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null

    // Move focus in. The panel itself, not the first control: landing on
    // "Close" reads as though closing is what we want, and landing in a card
    // field before the tenant has chosen a payment method is worse.
    const panel = ref.current
    panel?.focus({ preventScroll: true })

    // Lock the page. Padding compensates for the scrollbar so the content
    // behind does not jump sideways as the sheet opens.
    const { overflow, paddingRight } = document.body.style
    const gap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (gap > 0) document.body.style.paddingRight = `${gap}px`

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement)
      if (items.length === 0) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const activeInside = panel.contains(document.activeElement)
      if (!activeInside) { e.preventDefault(); first.focus(); return }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
      // Only if focus is still somewhere in the sheet — if the tenant has
      // already clicked into the page, stealing it back is hostile.
      if (!document.activeElement || document.activeElement === document.body) {
        restoreTo.current?.focus?.({ preventScroll: true })
      }
    }
  }, [close])

  return (
    <div className="tp tp-sheet-back" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div
        ref={ref}
        className={`tp-sheet${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        tabIndex={-1}
      >
        {(title || kicker) && (
          <div className="tp-sheet-hd">
            <div style={{ minWidth: 0 }}>
              {kicker && <div className="tp-sheet-k">{kicker}</div>}
              {title && <h2 className="tp-sheet-t" id={titleId}>{title}</h2>}
              {subtitle && <div className="tp-sheet-sub">{subtitle}</div>}
            </div>
            {dismissible && (
              <button className="tp-sheet-x" onClick={onClose} aria-label="Close">×</button>
            )}
          </div>
        )}
        <div className="tp-sheet-bd">{children}</div>
        {footer && <div className="tp-sheet-ft">{footer}</div>}
      </div>
    </div>
  )
}
