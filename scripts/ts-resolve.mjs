/**
 * Lets the verify scripts import `src/lib/*.ts` the way the app does.
 *
 * Node's own `--experimental-strip-types` runs TypeScript happily, but it will
 * not guess at an extension: the app writes `from './rentPaymentNotify'`, which
 * the bundler resolves and Node does not, so a script importing anything that
 * imports something else died on ERR_MODULE_NOT_FOUND.
 *
 * This hook fills in that one gap — an extensionless relative specifier that
 * exists as `.ts` or `.tsx` — and otherwise stays out of the way. It also maps
 * the `@/` alias from tsconfig, since library code uses it freely.
 *
 * Used as: node --experimental-strip-types --import ./scripts/ts-resolve.mjs <script>
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = ${JSON.stringify(pathToFileURL(new URL('../src/', import.meta.url).pathname).href)}

export async function resolve(specifier, context, next) {
  let spec = specifier

  // tsconfig's "@/*" -> "src/*".
  if (spec.startsWith('@/')) spec = new URL(spec.slice(2), SRC).href

  const relative = spec.startsWith('./') || spec.startsWith('../')
  const absolute = spec.startsWith('file:')
  if ((relative || absolute) && !/\\.[cm]?[jt]sx?$/.test(spec)) {
    const base = absolute ? spec : new URL(spec, context.parentURL).href
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const candidate = base + ext
      if (existsSync(fileURLToPath(candidate))) return next(candidate, context)
    }
  }

  return next(spec, context)
}
`), pathToFileURL('./'))
