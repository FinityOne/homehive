'use client'

/**
 * The money area's icon set — twelve glyphs, drawn here, no dependency.
 *
 * ── Why icons at all ───────────────────────────────────────────────────────
 *
 * The area had none, and that is a real part of why it read as a wall of
 * figures: every row looked exactly like every other row, so nothing could be
 * found by shape. An icon is a second channel. It lets a landlord locate the
 * arrears section, or a "never chased" signal, without reading a word — and it
 * gives a colour-blind reader something other than hue to go on.
 *
 * ── The rules ──────────────────────────────────────────────────────────────
 *
 *   • **One stroke weight, one grid.** 20×20 viewBox, 1.6 stroke, round caps.
 *     Mixed weights are the fastest way to make a careful interface look
 *     assembled from parts.
 *   • **`currentColor`, always.** A glyph never carries its own colour; it
 *     inherits from whatever it sits in, so the palette stays in one file.
 *   • **Never alone.** Every glyph in this product sits beside a word. Icons
 *     are an accelerator for a label, never a replacement for one, which is why
 *     they are all `aria-hidden` — the text next to them is the accessible
 *     name.
 */

export type GlyphName =
  | 'alert' | 'clock' | 'trend-down' | 'trend-up' | 'mail' | 'calendar'
  | 'shield' | 'check' | 'users' | 'building' | 'wallet' | 'search'
  | 'bolt' | 'arrow-right'

/** The path data, on a 20×20 grid. */
const PATHS: Record<GlyphName, React.ReactNode> = {
  alert: (
    <>
      <path d="M10 3.5 2.8 16.2h14.4L10 3.5Z" />
      <path d="M10 8.3v3.4" />
      <path d="M10 14.1h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.3l2.8 1.7" />
    </>
  ),
  'trend-down': (
    <>
      <path d="M3 6.5l5 5 3-3 6 6" />
      <path d="M17 10.5v4h-4" />
    </>
  ),
  'trend-up': (
    <>
      <path d="M3 13.5l5-5 3 3 6-6" />
      <path d="M17 9.5v-4h-4" />
    </>
  ),
  mail: (
    <>
      <rect x="2.8" y="4.5" width="14.4" height="11" rx="1.8" />
      <path d="M3.4 5.8 10 10.8l6.6-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.8" width="14" height="12.2" rx="1.8" />
      <path d="M3 8.4h14M7 3v3M13 3v3" />
    </>
  ),
  shield: (
    <>
      <path d="M10 2.8 4 5v5c0 3.4 2.4 6.3 6 7.2 3.6-.9 6-3.8 6-7.2V5l-6-2.2Z" />
      <path d="M7.6 10l1.8 1.8 3.2-3.4" />
    </>
  ),
  check: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M6.9 10.2l2.1 2.1 4.1-4.4" />
    </>
  ),
  users: (
    <>
      <circle cx="8" cy="7.5" r="2.8" />
      <path d="M2.8 16.4c.5-2.6 2.6-4.2 5.2-4.2s4.7 1.6 5.2 4.2" />
      <path d="M14 5.2a2.6 2.6 0 0 1 0 5" />
      <path d="M15.2 12.6c1.3.5 2.2 1.6 2.5 3.2" />
    </>
  ),
  building: (
    <>
      <path d="M4 17V5.2c0-.7.6-1.2 1.2-1.2h6c.7 0 1.2.5 1.2 1.2V17" />
      <path d="M12.4 9h2.9c.7 0 1.2.5 1.2 1.2V17" />
      <path d="M6.7 7.2h3M6.7 10.4h3M6.7 13.6h3M3 17h14" />
    </>
  ),
  wallet: (
    <>
      <rect x="2.8" y="5.4" width="14.4" height="10.2" rx="2" />
      <path d="M2.8 9h14.4" />
      <path d="M13.4 12.6h1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5.3" />
      <path d="M12.9 12.9 17 17" />
    </>
  ),
  bolt: <path d="M11.4 2.6 5.2 11.4h4l-.6 6 6.2-8.8h-4l.6-6Z" />,
  'arrow-right': (
    <>
      <path d="M3.6 10h12.8" />
      <path d="M12.2 5.9 16.4 10l-4.2 4.1" />
    </>
  ),
}

export default function Glyph({
  name, size = 16, className,
}: {
  name: GlyphName
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className ? `gl ${className}` : 'gl'}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      // The label beside it is the accessible name — see the header note.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

/** Shared glyph CSS. Injected with the rest of the money area's styles. */
export const GLYPH_CSS = `
  .fin .gl { flex-shrink: 0; vertical-align: -0.16em; }
  /* A glyph in a round plate — for a signal row or a section header, where the
     icon is carrying the eye rather than decorating a word. */
  .fin .gl-plate {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border-radius: 10px; flex-shrink: 0;
    background: var(--idle-bg); color: var(--ink-2);
  }
  .fin .gl-plate.critical { background: var(--late-bg);   color: var(--late); }
  .fin .gl-plate.warning  { background: var(--fee-bg);    color: var(--fee); }
  .fin .gl-plate.watch    { background: var(--flight-bg); color: var(--flight); }
  .fin .gl-plate.good     { background: var(--in-bg);     color: var(--in); }
  .fin .gl-plate.sm { width: 24px; height: 24px; border-radius: 8px; }
`
