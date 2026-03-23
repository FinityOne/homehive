---
name: App route architecture
description: Route group layout structure — which routes use marketing vs app shell layouts
type: project
---

Three layout zones via Next.js route groups:

- `(marketing)/` — wraps homes, roommates, contact, pricing, student-guide, how-it-works, root page. Uses `Nav` + `Footer`.
- `(app)/` — wraps dashboard (tenant), landlord/dashboard (landlord), admin (admin). Uses `AppShell` sidebar.
- `(auth)/` — wraps login, signup. Bare (no nav/footer).

Root `layout.tsx` is a bare html/body shell only.

**AppShell portal system:**
- Portal detected from pathname: `/landlord/*` = landlord portal, `/admin/*` = admin portal, else = tenant portal
- Each portal has a distinct sidebar theme (CSS custom properties on wrapper div):
  - Tenant: white sidebar, maroon (#8C1D40) + gold (#FFC627) accents
  - Landlord: dark navy sidebar (#0f172a), teal/green (#10b981 / #34d399) accents
  - Admin: dark charcoal sidebar (#18181b), purple (#a78bfa) accents
- Portal switcher at the bottom of sidebar nav shows available portals based on user role
- Role hierarchy: tenant (default, all users), landlord (role=landlord or admin), admin (role=admin only)

**Middleware:** renamed to `src/proxy.ts` per Next.js 16 convention (function = `proxy` not `middleware`).

**Why:** Next.js 16 deprecated `middleware` in favor of `proxy`.
**How to apply:** New route protection files should be in `src/proxy.ts` exporting `proxy` function.
