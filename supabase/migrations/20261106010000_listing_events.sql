-- The two ends of the funnel this platform never recorded.
--
-- `property_page_views` answers "how many people opened the listing page",
-- which is the middle of the funnel and, on its own, half a diagnosis. The two
-- missing halves are the ones that name the fix:
--
--   • ABOVE the page view: how many students saw the listing's card in search
--     and did not click it. A listing with 400 impressions and 9 clicks has a
--     cover-photo-and-price problem, and no amount of editing the description
--     touches it. Without impressions, that listing is indistinguishable from
--     one nobody searched for at all — and the landlord's instinct in both
--     cases is to cut the rent, which fixes neither.
--   • BELOW the page view: what people did on the page. Someone who opened the
--     gallery, read the FAQ and started typing into the inquiry form before
--     leaving is a different event from someone who bounced in four seconds,
--     and only the first one says the listing is nearly working. Started-but-
--     abandoned inquiry forms are the single most recoverable loss on the
--     platform, and nothing recorded them.
--
-- One table rather than one per event: these are all "a visitor did something
-- to a listing", they are queried together as a funnel, and a per-event table
-- would mean a new migration every time the funnel grows a stage.
--
-- Identity matches `property_page_views` exactly — `anonymous_id` first (the
-- 1-year cookie, so it means a person), `session_id` as the fallback — so a
-- person's impression, click, view and inquiry stitch into one journey.

create table if not exists public.listing_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  property_id   uuid references public.properties(id) on delete set null,
  property_slug text not null,

  -- See LISTING_EVENT_KINDS in src/lib/listingEvents.ts. Deliberately text with
  -- a check rather than an enum: adding a funnel stage should be a one-line
  -- migration, and an enum value cannot be removed once shipped.
  event_type    text not null check (event_type in (
    'impression',      -- the card scrolled into view in search
    'card_click',      -- …and was clicked
    'gallery_open',    -- opened a photo full-size
    'faq_open',        -- opened the FAQ section
    'form_start',      -- typed the first character into the inquiry form
    'form_abandon',    -- …and left without sending it
    'save',            -- hearted the listing
    'tour_click',      -- opened the tour scheduler
    'share'            -- copied or shared the link
  )),

  anonymous_id  text,
  session_id    text,

  -- Where the event happened ('search', 'listing', 'saved', 'home'), and for an
  -- impression, its 1-based rank in the result list. Position is what makes
  -- click-through readable: being skipped at rank 2 and at rank 40 are not the
  -- same finding.
  surface       text,
  position      int,

  device_type   text,
  referrer      text,
  utm_source    text
);

-- The landlord reads are always "these slugs, this window, newest first".
create index if not exists listing_events_slug_created_idx
  on public.listing_events (property_slug, created_at desc);

-- Funnel counting groups by stage inside that window.
create index if not exists listing_events_type_created_idx
  on public.listing_events (event_type, created_at desc);

create index if not exists listing_events_anon_idx
  on public.listing_events (anonymous_id)
  where anonymous_id is not null;

alter table public.listing_events enable row level security;

-- Mirrors property_page_views: a logged-out visitor must be able to write their
-- own events, and nobody but the server may read them back. The rows carry
-- session ids and referrers, so every landlord-facing read goes through a
-- service-role route that aggregates before anything crosses the wire.
drop policy if exists "Allow public inserts on listing_events" on public.listing_events;
create policy "Allow public inserts on listing_events"
  on public.listing_events for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Allow service role to read listing_events" on public.listing_events;
create policy "Allow service role to read listing_events"
  on public.listing_events for select
  to service_role
  using (true);

-- Grants, in the same migration that creates the table (see CLAUDE.md).
-- Deliberately narrower than `all to anon, authenticated, service_role`:
-- `insert` is the only thing a browser legitimately does here, and a visitor
-- who could `select` would be reading every other visitor's browsing trail.
grant insert on public.listing_events to anon, authenticated;
grant all    on public.listing_events to service_role;
