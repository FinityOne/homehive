-- Real demand numbers for the landlord pitch.
--
-- The subscribe page tells a landlord what one listing on HomeHive actually
-- pulls. Those numbers have to be counted, not written down, or the page starts
-- lying the first time the platform has a good week — or a bad one.
--
-- One function rather than six PostgREST counts: a median is not expressible as
-- a count, and the page should not make six sequential requests to render one
-- line of copy.
--
-- `security definer` is what makes this safe to expose to anon. The underlying
-- tables (`leads`, `site_visits`, `tours`) are not readable by the public and
-- must not become readable — this returns seven aggregate integers and no row
-- ever touches the client. It is deliberately incapable of leaking a renter's
-- email, which a view over `leads` would not be.
create or replace function public.homehive_platform_stats()
returns table (
  top_listing_leads    integer,
  median_listing_leads integer,
  total_leads          integer,
  distinct_renters     integer,
  site_visits          integer,
  tours                integer,
  live_listings        integer
)
language sql
stable
security definer
set search_path = public
as $$
  with per_listing as (
    -- `leads.property` holds the listing slug, not an id. Inquiries with no
    -- listing attached are not demand for a listing, so they are excluded here
    -- while still counting toward the total below.
    select count(*)::numeric as c
    from public.leads
    where property is not null and property <> ''
    group by property
  )
  select
    coalesce(max(c), 0)::integer,
    coalesce(percentile_disc(0.5) within group (order by c), 0)::integer,
    (select count(*) from public.leads)::integer,
    (select count(distinct lower(email)) from public.leads where email is not null and email <> '')::integer,
    (select count(*) from public.site_visits)::integer,
    (select count(*) from public.tours)::integer,
    (
      select count(*)
      from public.properties
      where is_active
        and admin_status = 'active'
        and not is_test
        and archived_at is null
        and owner_plan_active
        and (listing_status = 'active' or (listing_status = 'rented' and coalesce(show_when_rented, false)))
    )::integer
  from per_listing
$$;

grant execute on function public.homehive_platform_stats() to anon, authenticated;
