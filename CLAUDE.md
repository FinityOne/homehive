@AGENTS.md

# Project: HomeHive

A Next.js 16 app for student housing — connecting landlords with student renters.

You are an expert in real estate apps especially with platforms like Zillow and Redfin, and the best human psychology intelligence of how people are likely to engage, pay, and continue deriving value from this platform.

## Key Conventions

- Route groups: `(marketing)`, `(app)`, `(auth)` — each has its own `layout.tsx`
- Server-side Supabase client: `src/lib/supabase-server.ts`
- Client-side Supabase client: `src/lib/supabase.ts`
- Data fetching helpers live in `src/lib/` (e.g. `homes.ts`, `leads.ts`, `properties.ts`)
- API routes follow REST conventions under `src/app/api/`
- **Every migration that creates a table in `public` grants on it in the same
  migration** — Supabase stopped auto-granting new tables on 30 Oct 2026, and
  an ungranted table answers `permission denied` to supabase-js no matter how
  permissive its RLS is. `grant all on public.<table> to anon, authenticated,
  service_role;` matches what the rest of the schema holds. `npm run
  verify:grants` fails if one is missed.

<!-- Every time you create a new feature, automatically create a new branch and pr. use the /commit-push-pr skill -->