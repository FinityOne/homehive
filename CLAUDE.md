@AGENTS.md

# HomeHive

Next.js 16 app for student housing — landlords ↔ student renters. Think Zillow/Redfin
product sense: what makes people engage, pay, and stay.

## Conventions

- Route groups `(marketing)` / `(app)` / `(auth)`, each with its own `layout.tsx`
- Supabase: `src/lib/supabase-server.ts` (server), `src/lib/supabase.ts` (client)
- Data helpers in `src/lib/` (`homes.ts`, `leads.ts`, `properties.ts`, …)
- REST API routes under `src/app/api/`

## Rules

- **A migration creating a `public` table grants on it in the same migration** —
  `grant all on public.<table> to anon, authenticated, service_role;`. Supabase
  stopped auto-granting (30 Oct 2026); an ungranted table answers `permission
  denied` however permissive its RLS. A deliberately narrower grant is fine —
  `npm run verify:grants` reports those, and fails only on *no* grant.
- New feature → new branch + PR via the `/commit-push-pr` skill.
