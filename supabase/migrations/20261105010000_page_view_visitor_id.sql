-- Stable visitor identity for listing page views.
--
-- `property_page_views` has recorded a row per listing view since May 2026, but
-- the only identity on it was `session_id` — a `sessionStorage` uuid that dies
-- with the browser tab. Counting distinct sessions answers "how many visits",
-- never "how many people": one student checking a listing on Monday, Wednesday
-- and again from their phone is three sessions and one renter. The landlord
-- overview now leads on unique visitors, so the number has to mean what it says.
--
-- `anonymous_id` is the same 1-year cookie/localStorage id the visitor-tracking
-- system already keeps (`src/lib/visitorId.ts`, `hh_anon_id`), so a view row and
-- a `site_visits` row for the same person now share a key.
--
-- Rows written before this column exists keep a null `anonymous_id`. The
-- counting engine falls back to `session_id` for those, which means uniques over
-- a window reaching back past today are slightly *over*-counted and converge on
-- the truth as the window rolls forward. Over-counting is the safe direction
-- here: it never invents a quiet listing out of a busy one.
--
-- No grants below: `property_page_views` already holds the grants from
-- 20261102020000_data_api_grants.sql, and adding a column does not change them.
-- Its RLS stays as it was — anon inserts, service-role reads — which is why
-- every landlord-facing read of this table goes through a server route.

alter table public.property_page_views
  add column if not exists anonymous_id text;

-- The overview and the performance page both scan one owner's slugs over a
-- trailing window, newest first. Without this the table is a sequential scan on
-- every dashboard load.
create index if not exists property_page_views_slug_created_idx
  on public.property_page_views (property_slug, created_at desc);

-- Counting distinct people over a window.
create index if not exists property_page_views_anon_idx
  on public.property_page_views (anonymous_id)
  where anonymous_id is not null;
