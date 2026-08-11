import type { Metadata } from 'next'
import { getHomeCardsServer } from '@/lib/homeData'

/**
 * 404 — treated as a landing page, not an apology.
 *
 * Someone lands here from a stale link, a rented listing, or a typo. They came
 * looking for housing near ASU, so the page does what the homepage does: search,
 * real inventory, and a way to narrow it down. The dead end is stated once,
 * briefly, and then it gets out of the way.
 *
 * Server component so real listings render in the HTML — fast, and useful even
 * before JS loads.
 */

export const metadata: Metadata = {
  title: 'Page not found — Find housing near ASU | HomeHive',
  description:
    'That page has moved or the listing is no longer available. Browse verified off-campus housing near ASU in Tempe — apartments, subleases and rooms, with no broker fees.',
  robots: { index: false, follow: true },
}

// The listing may have been rented moments ago; keep this fresh but cheap.
export const revalidate = 300

// Param names must match what HomesPageClient's useInitialFilters reads.
const QUICK_LINKS = [
  { href: '/homes?price_max=700', label: 'Under $700/mo', hint: 'Budget-friendly' },
  { href: '/homes?distance_max=1', label: 'Walk to campus', hint: 'Within 1 mile' },
  { href: '/homes?beds=2', label: '2+ bedrooms', hint: 'Share with friends' },
  { href: '/homes', label: 'Every home', hint: 'Browse all' },
]

export default async function NotFound() {
  // Best-effort: a 404 must never itself fail.
  let homes: Awaited<ReturnType<typeof getHomeCardsServer>> = []
  try {
    homes = await getHomeCardsServer({ marketingOnly: true })
  } catch {
    homes = []
  }

  // Lead with the closest homes to campus — the thing most students filter on.
  const featured = [...homes]
    .sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) ||
                    (a.asu_distance ?? 99) - (b.asu_distance ?? 99))
    .slice(0, 3)

  const cheapest = homes.length
    ? Math.min(...homes.map(h => h.price).filter(Boolean))
    : null

  return (
    <>
      <style>{CSS}</style>
      <div className="nf">

        {/* Minimal nav — app/not-found.tsx renders outside the marketing layout,
            so the page would otherwise have no way back. */}
        <header className="nf-nav">
          <a href="/" className="nf-logo">
            Home<em>Hive</em>
          </a>
          <nav className="nf-nav-links">
            <a href="/homes">Browse homes</a>
            <a href="/how-it-works">How it works</a>
            <a href="/for-landlords">List your place</a>
          </nav>
        </header>

        <main className="nf-main">
          {/* Say it once, plainly, and move on. */}
          <div className="nf-badge">404 — page not found</div>

          <h1 className="nf-title">
            This page moved out.<br />
            <em>Your next place hasn&apos;t.</em>
          </h1>

          <p className="nf-lead">
            The link you followed is broken, or that listing has already been rented.
            {homes.length > 0 && (
              <> There {homes.length === 1 ? 'is' : 'are'} <strong>{homes.length} home{homes.length !== 1 ? 's' : ''}</strong> available
              near ASU right now{cheapest ? <>, starting at <strong>${cheapest.toLocaleString()}/mo</strong></> : ''}.</>
            )}
          </p>

          {/* Search is the fastest path back to intent */}
          <form className="nf-search" action="/homes" method="get">
            <input
              type="search"
              name="q"
              placeholder="Try a street, neighborhood or “2 bed”…"
              aria-label="Search homes near ASU"
              className="nf-search-input"
            />
            <button type="submit" className="nf-search-btn">Search homes</button>
          </form>

          {/* Quick filters — most 404 visitors don't know what to type */}
          <div className="nf-chips">
            {QUICK_LINKS.map(l => (
              <a key={l.href} href={l.href} className="nf-chip">
                <span className="nf-chip-label">{l.label}</span>
                <span className="nf-chip-hint">{l.hint}</span>
              </a>
            ))}
          </div>

          {/* Real inventory — the actual marketing payload */}
          {featured.length > 0 && (
            <section className="nf-homes">
              <div className="nf-homes-hd">
                <h2 className="nf-homes-title">Closest to campus right now</h2>
                <a href="/homes" className="nf-homes-all">See all {homes.length} →</a>
              </div>

              <div className="nf-grid">
                {featured.map(h => (
                  <a key={h.slug} href={`/homes/${h.slug}`} className="nf-card">
                    <div className="nf-card-img">
                      {h.images?.[0]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={h.images[0]} alt={h.name} loading="lazy" />
                        : <div className="nf-card-ph" />}
                      <span className="nf-card-price">${h.price?.toLocaleString()}<span>/mo</span></span>
                    </div>
                    <div className="nf-card-body">
                      <div className="nf-card-name">{h.name}</div>
                      <div className="nf-card-meta">
                        {h.beds} bed · {h.baths} bath
                        {h.asu_distance ? ` · ${h.asu_distance} mi to ASU` : ''}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Catch the other intents rather than dead-ending them */}
          <section className="nf-else">
            <div className="nf-else-title">Looking for something else?</div>
            <div className="nf-else-links">
              <a href="/saved">Your shortlist</a>
              <a href="/how-it-works">How HomeHive works</a>
              <a href="/student-guide">ASU student housing guide</a>
              <a href="/for-landlords">List your property</a>
              <a href="/dashboard">Your account</a>
              <a href="/contact">Contact us</a>
            </div>
          </section>
        </main>

        <footer className="nf-foot">
          <a href="/">HomeHive</a> · Off-campus housing near ASU, Tempe · No broker fees
        </footer>
      </div>
    </>
  )
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&family=Geist:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .nf {
    --cream: #FAF8F3; --cream-alt: #F4F1EA;
    --hive: #2F4A48; --honey: #D9A14A;
    --ink: #222810; --ink-2: #3d3d30; --ink-muted: #6b6b5a; --hair: #dddad0;
    min-height: 100vh; background: var(--cream); color: var(--ink);
    font-family: 'Geist', system-ui, sans-serif;
    display: flex; flex-direction: column;
  }

  .nf-nav { display: flex; align-items: center; justify-content: space-between; gap: 20px;
    padding: 20px 28px; border-bottom: 1px solid var(--hair); flex-wrap: wrap; }
  .nf-logo { font-size: 20px; font-weight: 600; letter-spacing: -0.4px; color: var(--ink); text-decoration: none; }
  .nf-logo em { font-family: 'Newsreader', serif; font-style: italic; color: var(--honey); }
  .nf-nav-links { display: flex; gap: 22px; }
  .nf-nav-links a { font-size: 14px; color: var(--ink-2); text-decoration: none; }
  .nf-nav-links a:hover { color: var(--hive); }

  .nf-main { flex: 1; width: 100%; max-width: 940px; margin: 0 auto; padding: 56px 24px 72px; }

  .nf-badge { display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--ink-muted); background: var(--cream-alt);
    border: 1px solid var(--hair); padding: 5px 12px; border-radius: 20px; margin-bottom: 22px; }

  .nf-title { font-family: 'Newsreader', Georgia, serif; font-weight: 380;
    font-size: clamp(38px, 6vw, 68px); line-height: 1.04; letter-spacing: -0.025em; color: var(--ink); }
  .nf-title em { font-style: italic; color: var(--hive); }

  .nf-lead { font-size: 17px; line-height: 1.65; color: var(--ink-2); margin-top: 18px; max-width: 560px; }
  .nf-lead strong { color: var(--ink); font-weight: 600; }

  .nf-search { display: flex; gap: 10px; margin-top: 28px; max-width: 560px; flex-wrap: wrap; }
  .nf-search-input { flex: 1; min-width: 220px; border: 1.5px solid var(--hair); background: #fff;
    border-radius: 11px; padding: 14px 16px; font-size: 15px; font-family: inherit; color: var(--ink); outline: none; }
  .nf-search-input:focus { border-color: var(--honey); }
  .nf-search-input::placeholder { color: #8a8a78; }
  .nf-search-btn { background: var(--hive); color: #fff; border: none; border-radius: 11px;
    padding: 14px 24px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap; }
  .nf-search-btn:hover { background: #26403e; }

  .nf-chips { display: flex; gap: 9px; margin-top: 16px; flex-wrap: wrap; }
  .nf-chip { background: #fff; border: 1px solid var(--hair); border-radius: 11px;
    padding: 10px 15px; text-decoration: none; transition: border-color .15s, transform .15s; }
  .nf-chip:hover { border-color: var(--honey); transform: translateY(-1px); }
  .nf-chip-label { display: block; font-size: 14px; font-weight: 500; color: var(--ink); }
  .nf-chip-hint { display: block; font-size: 11.5px; color: var(--ink-muted); margin-top: 1px; }

  .nf-homes { margin-top: 52px; }
  .nf-homes-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
    margin-bottom: 16px; flex-wrap: wrap; }
  .nf-homes-title { font-family: 'Newsreader', serif; font-weight: 400; font-size: 26px;
    letter-spacing: -0.015em; color: var(--ink); }
  .nf-homes-all { font-size: 14px; font-weight: 500; color: var(--hive); text-decoration: none; }
  .nf-homes-all:hover { color: var(--honey); }

  .nf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .nf-card { background: #fff; border: 1px solid var(--hair); border-radius: 16px; overflow: hidden;
    text-decoration: none; color: inherit; transition: transform .16s, box-shadow .16s; display: block; }
  .nf-card:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(34,40,16,0.09); }
  .nf-card-img { position: relative; aspect-ratio: 4 / 3; background: var(--cream-alt); overflow: hidden; }
  .nf-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .nf-card-ph { width: 100%; height: 100%; background: linear-gradient(135deg, #F4F1EA, #e6e1d5); }
  .nf-card-price { position: absolute; left: 10px; bottom: 10px; background: rgba(34,40,16,0.88);
    color: #fff; font-size: 14px; font-weight: 600; padding: 5px 11px; border-radius: 8px; backdrop-filter: blur(4px); }
  .nf-card-price span { font-size: 11px; font-weight: 400; opacity: 0.75; }
  .nf-card-body { padding: 13px 15px 15px; }
  .nf-card-name { font-size: 15px; font-weight: 500; line-height: 1.35; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nf-card-meta { font-size: 12.5px; color: var(--ink-muted); margin-top: 3px; }

  .nf-else { margin-top: 52px; padding-top: 28px; border-top: 1px solid var(--hair); }
  .nf-else-title { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 12px; }
  .nf-else-links { display: flex; gap: 10px 26px; flex-wrap: wrap; }
  .nf-else-links a { font-size: 14px; color: var(--ink-muted); text-decoration: none; }
  .nf-else-links a:hover { color: var(--hive); text-decoration: underline; }

  .nf-foot { border-top: 1px solid var(--hair); padding: 20px 28px; text-align: center;
    font-size: 12.5px; color: var(--ink-muted); }
  .nf-foot a { color: var(--ink-2); text-decoration: none; font-weight: 500; }

  @media (max-width: 760px) {
    .nf-grid { grid-template-columns: 1fr; }
    .nf-main { padding: 40px 20px 56px; }
    .nf-nav-links { display: none; }
  }
`
