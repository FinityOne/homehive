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

<!-- Every time you create a new feature, automatically create a new branch and pr. use the /commit-push-pr skill -->