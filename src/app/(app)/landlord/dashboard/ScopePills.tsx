'use client'

/**
 * The property scope toggle, shared by the overview and its sub-pages.
 *
 * Scope is kept in the URL (`?property=<slug>`) rather than in component
 * state, for one reason: the sub-pages exist so a landlord can go deeper, and
 * arriving at the traffic page scoped to "all properties" after clicking
 * through from a single property would throw away the only thing they had
 * already told us.
 */

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Property } from '@/lib/properties'

/** Read the scope out of the URL. `'all'` when absent or unknown. */
export function useScope(properties: Property[]): string {
  const params = useSearchParams()
  const slug = params.get('property')
  if (!slug || slug === 'all') return 'all'
  return properties.some(p => p.slug === slug) ? slug : 'all'
}

/** Append the current scope to a sub-page link, so the drill-down keeps it. */
export function withScope(href: string, scope: string) {
  return scope === 'all' ? href : `${href}?property=${encodeURIComponent(scope)}`
}

export default function ScopePills({ properties, scope }: { properties: Property[]; scope: string }) {
  const router = useRouter()
  const pathname = usePathname()

  if (properties.length < 2) return null

  const go = (slug: string) => {
    router.replace(slug === 'all' ? pathname : `${pathname}?property=${encodeURIComponent(slug)}`, { scroll: false })
  }

  return (
    <div className="db-prop-toggle">
      {[{ slug: 'all', name: 'All properties' }, ...properties].map(p => (
        <button
          key={p.slug}
          onClick={() => go(p.slug)}
          className={`db-prop-pill${scope === p.slug ? ' is-active' : ''}`}
        >
          {p.name}
        </button>
      ))}
    </div>
  )
}
