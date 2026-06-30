// Client-side "Shortlist" — homes a student saves while browsing, kept in
// localStorage (no login required) and shareable with roommates via a URL.
// Components subscribe via onShortlistChange to stay in sync (incl. cross-tab).

const KEY = 'hh_shortlist'
export const SHORTLIST_EVENT = 'hh-shortlist-change'

export function getShortlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

function save(slugs: string[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(slugs))
  window.dispatchEvent(new CustomEvent(SHORTLIST_EVENT))
}

export function isSaved(slug: string): boolean {
  return getShortlist().includes(slug)
}

// Toggles membership; returns the new saved state.
export function toggleSaved(slug: string): boolean {
  const list = getShortlist()
  const i = list.indexOf(slug)
  if (i >= 0) {
    list.splice(i, 1)
    save(list)
    return false
  }
  save([...list, slug])
  return true
}

export function removeSaved(slug: string) {
  save(getShortlist().filter(s => s !== slug))
}

// Merge a set of slugs into the shortlist (used when accepting a shared list).
export function addManySaved(slugs: string[]) {
  const set = new Set(getShortlist())
  slugs.forEach(s => set.add(s))
  save([...set])
}

export function clearShortlist() {
  save([])
}

// Subscribe to changes (same-tab via CustomEvent, other tabs via storage).
// Returns an unsubscribe function.
export function onShortlistChange(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(SHORTLIST_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(SHORTLIST_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}
