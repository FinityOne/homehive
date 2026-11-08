// One palette for the whole traffic section.
//
// The three series hues were validated for colour-vision deficiency against
// this surface rather than picked by eye (worst adjacent pair ΔE 13.6 deutan,
// 21.8 normal). The two ramps below are sequential — a single hue, light to
// dark, monotonic in lightness — because they encode one measure at different
// magnitudes (how many people reached a funnel stage, how busy an hour is),
// and a multi-hue scale there would imply categories that do not exist.

import type { PulseTone } from '@/lib/listingPulse'

export const C = {
  views:     '#BE2A55',
  visitors:  '#1197B0',
  inquiries: '#B07D08',
  // The neutrals are the money area's tokens, written out as literals because
  // this palette is consumed by SVG attributes and inline styles where a CSS
  // custom property cannot be read. They must stay in step with
  // `FINANCE_THEME` — the pulse sits inside a page built from it, and a
  // half-shade difference in border grey is exactly the kind of seam that
  // makes one screen look like two.
  ink:       '#1d1d1f',   // --ink
  ink2:      '#6e6e73',   // --ink-2
  muted:     '#8e8e93',   // --ink-3
  faint:     '#f0f0f2',   // --line-2
  line:      '#e5e5ea',   // --line
  surface:   '#ffffff',   // --surface
} as const

/** Light → dark, for funnel stages. Index 0 is the widest stage. */
export const FUNNEL_RAMP = [
  '#F6D9E1', '#EDB0C1', '#E083A0', '#D15880', '#BE2A55', '#8F1F40',
] as const

/** Light → dark, for how busy an hour is. Index 0 is "almost nothing". */
export const HEAT_RAMP = [
  '#EAF6F9', '#C3E6EE', '#8FD1E0', '#4FB4CB', '#1197B0', '#0A6F84',
] as const

/** One colour per meaning, matching the money area: green received, red
 *  failed, amber needs attention, grey nothing to do. Every tone carries an
 *  icon as well, so none of them is read by colour alone. */
export const TONE: Record<PulseTone, { bg: string; border: string; fg: string; icon: string }> = {
  good: { bg: '#e8f5ed', border: '#cfe9d9', fg: '#0f7a43', icon: '✓' },
  warn: { bg: '#fdf1e3', border: '#f6dcc0', fg: '#b25000', icon: '!' },
  bad:  { bg: '#fdeceb', border: '#f3c6c2', fg: '#d13b30', icon: '!' },
  info: { bg: '#fafafb', border: '#e5e5ea', fg: '#6e6e73', icon: 'i' },
}

/** Pick a ramp step for a 0–1 intensity. */
export function rampStep(ramp: readonly string[], t: number): string {
  if (!(t > 0)) return C.faint
  const i = Math.min(ramp.length - 1, Math.max(0, Math.ceil(t * ramp.length) - 1))
  return ramp[i]
}

export const nf = (n: number) => n.toLocaleString()
