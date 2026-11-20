/**
 * Proves the tenant portal's colour pairings are actually legible, by computing
 * them rather than by trusting the comment that says they are.
 *
 * Worth a script because of one specific trap, recorded the hard way on the
 * public site: **the logo's gold is 1.6:1 on cream.** It is a beautiful fill
 * with dark ink on it and an unreadable text colour on any light band, and the
 * two uses are one careless line apart. The portal now has gold in it — on the
 * dark balance panel, as the accent CTA — so the rule needs an enforcer rather
 * than a comment. `--accent-text` exists for the light-band case and has to
 * stay above 4.5:1.
 *
 * Everything below is read out of `src/lib/tenantTheme.ts` itself, so a token
 * edited to a prettier value fails here instead of shipping.
 *
 * Run: npm run verify:tenant-contrast
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/lib/tenantTheme.ts', import.meta.url), 'utf8')

/** Every `--token: #hex;` declared on `.tp`. */
const tokens = {}
for (const m of src.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2]

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const pass = []
const fail = []

/** `name` must clear `min`:1 against `on`. */
const needs = (label, fg, bg, min) => {
  const a = tokens[fg] ?? fg
  const b = tokens[bg] ?? bg
  if (!a?.startsWith('#') || !b?.startsWith('#')) {
    fail.push(`${label} — token missing (${fg} on ${bg})`)
    return
  }
  const r = ratio(a, b)
  const line = `${label} — ${r.toFixed(2)}:1 (needs ${min}:1)`
  ;(r >= min ? pass : fail).push(line)
}

/** `name` must NOT be legible — the guard against using it as text. */
const mustFail = (label, fg, bg) => {
  const r = ratio(tokens[fg] ?? fg, tokens[bg] ?? bg)
  const line = `${label} — ${r.toFixed(2)}:1, correctly unusable as text`
  ;(r < 4.5 ? pass : fail).push(
    r < 4.5 ? line : `${label} — ${r.toFixed(2)}:1, unexpectedly legible; the rule below may be stale`,
  )
}

const WHITE = '#ffffff'

// ── Body text, on both surfaces the portal uses ─────────────────────────────
needs('ink on white',            '--ink',   WHITE,        7)
needs('ink on the cream page',   '--ink',   '--page',     7)
needs('secondary ink on white',  '--ink-2', WHITE,        4.5)
needs('muted ink on white',      '--ink-3', WHITE,        4.5)
needs('muted ink on surface-2',  '--ink-3', '--surface-2', 4.5)
// --ink-4 is placeholder and timestamp text only, so large-text 3:1 is its bar.
needs('faint ink on white (large/secondary only)', '--ink-4', WHITE, 3)

// ── The interactive colour, as a link and as a fill ─────────────────────────
needs('maroon link text on white',        '--primary', WHITE,          4.5)
needs('maroon link on its own wash',      '--primary', '--primary-wash', 4.5)
needs('white on the maroon button',       WHITE,       '--primary',     4.5)
needs('white on the maroon hover state',  WHITE,       '--primary-ink', 4.5)

// ── THE TRAP. Gold fills; it is never text on a light band. ─────────────────
mustFail('gold as text on cream',  '--accent', '--page')
mustFail('gold as text on white',  '--accent', WHITE)
needs('ink on the gold CTA fill',          '--ink',        '--accent',      7)
needs('gold text on the dark panel',       '--accent',     '--dark',        4.5)
needs('accent-text, for a light band',     '--accent-text', WHITE,          4.5)
needs('accent-text on its own wash',       '--accent-text', '--accent-wash', 4.5)

// ── The dark panel ──────────────────────────────────────────────────────────
needs('white on the dark panel',           WHITE, '--dark',   7)
needs('white on the panel gradient end',   WHITE, '--dark-2', 7)

// ── States: each one as a figure on white, and inside its own wash ──────────
for (const [name, fg, wash] of [
  ['owed',     '--owed',     '--owed-wash'],
  ['paid',     '--paid',     '--paid-wash'],
  ['clearing', '--clearing', '--clearing-wash'],
  ['fee',      '--fee',      '--fee-wash'],
]) {
  needs(`${name} on white`, fg, WHITE, 4.5)
  needs(`${name} in its own badge/note wash`, fg, wash, 4.5)
}
// Grey means "nothing to do" and is used for words like "Cancelled".
needs('idle text on its wash', '--ink-3', '--idle-wash', 4.5)

// ── Report ──────────────────────────────────────────────────────────────────
for (const line of pass) console.log(`  ok   ${line}`)
if (fail.length) {
  console.log(`\n${pass.length} passed\n\n${fail.length} FAILED:`)
  for (const line of fail) console.log(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`\n${pass.length} passed`)
console.log('✓ every tenant-portal pairing clears its contrast bar, and gold stays a fill')
