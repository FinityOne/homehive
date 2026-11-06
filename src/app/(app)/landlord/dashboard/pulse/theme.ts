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
  ink:       '#0f172a',
  ink2:      '#475569',
  muted:     '#94a3b8',
  faint:     '#f1f5f9',
  line:      '#e2e8f0',
  surface:   '#fff',
} as const

/** Light → dark, for funnel stages. Index 0 is the widest stage. */
export const FUNNEL_RAMP = [
  '#F6D9E1', '#EDB0C1', '#E083A0', '#D15880', '#BE2A55', '#8F1F40',
] as const

/** Light → dark, for how busy an hour is. Index 0 is "almost nothing". */
export const HEAT_RAMP = [
  '#EAF6F9', '#C3E6EE', '#8FD1E0', '#4FB4CB', '#1197B0', '#0A6F84',
] as const

export const TONE: Record<PulseTone, { bg: string; border: string; fg: string; icon: string }> = {
  good: { bg: '#f0fdf4', border: '#bbf7d0', fg: '#15803d', icon: '✓' },
  warn: { bg: '#fffbeb', border: '#fde68a', fg: '#b45309', icon: '!' },
  bad:  { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c', icon: '!' },
  info: { bg: '#f8fafc', border: '#e2e8f0', fg: '#475569', icon: 'i' },
}

/** Pick a ramp step for a 0–1 intensity. */
export function rampStep(ramp: readonly string[], t: number): string {
  if (!(t > 0)) return C.faint
  const i = Math.min(ramp.length - 1, Math.max(0, Math.ceil(t * ramp.length) - 1))
  return ramp[i]
}

export const nf = (n: number) => n.toLocaleString()
