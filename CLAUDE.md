@AGENTS.md

# Project: HomeHive

A Next.js 16 app for student housing — connecting landlords with student renters.

## Stack

- **Framework**: Next.js 16.2 (App Router) — see `AGENTS.md` for version caveats
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Auth & DB**: Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- **Email**: Resend
- **Analytics**: PostHog
- **Maps**: Leaflet / react-leaflet

## Project Structure

```
src/
  app/
    (marketing)/   # Public-facing pages (homepage, listings, how-it-works, etc.)
    (app)/         # Authenticated app (landlord dashboard, leads, listings CRUD)
    (auth)/        # Login / signup
    api/           # Route handlers (leads, properties)
  components/      # Shared UI components (Nav, Footer, AppShell, etc.)
  lib/             # Data access & utilities (supabase, homes, leads, properties, posthog)
```

## Key Conventions

- Route groups: `(marketing)`, `(app)`, `(auth)` — each has its own `layout.tsx`
- Server-side Supabase client: `src/lib/supabase-server.ts`
- Client-side Supabase client: `src/lib/supabase.ts`
- Data fetching helpers live in `src/lib/` (e.g. `homes.ts`, `leads.ts`, `properties.ts`)
- API routes follow REST conventions under `src/app/api/`

## Dev Commands

```bash
npm run dev    # Start dev server
npm run build  # Production build
npm run lint   # ESLint
```

<!-- Every time you create a new feature, automatically create a new branch and pr. use the /commit-push-pr skill -->