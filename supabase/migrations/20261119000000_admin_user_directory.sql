-- The admin user directory, computed in the database.
--
-- ─── What was wrong ──────────────────────────────────────────────────────────
--
-- `/admin/users/*` is three pages (Tenants, Landlords, Admin Team) and each of
-- them used to download the *entire* platform to draw twenty-five rows: every
-- profile, every lead, and every property — the last of those through the
-- admin property select, which drags five child tables (images, tags, nearby,
-- ASU reasons, rooms) along with `select *`. The browser then joined them in
-- memory, scored each landlord, sorted by that score, and threw away all but
-- one page.
--
-- Two things made that expensive beyond the bytes. The join was redone from
-- scratch on every tab click, because the tab bar was plain `<a href>` and so
-- reloaded the document. And the *sort* was the reason none of it could be
-- paginated: an engagement score mixing recency, live listings and lead volume
-- cannot be ordered by the server if the server does not know it.
--
-- So the score moves here. Once Postgres can compute it, it can also order by
-- it, and the API can ask for one page.
--
-- ─── Why a view and not a table ──────────────────────────────────────────────
--
-- Every column below is derived from rows that already exist, and the whole
-- point of the score is that it is current — a landlord who listed a property
-- this morning should read as Hot this morning. A table would need a trigger
-- on four tables plus a cron to re-age the recency term each midnight, and
-- would still be a cache that can lie. A view cannot drift.
--
-- The aggregates are per-profile subqueries rather than one grouped join, so a
-- landlord with eight properties cannot multiply their own lead count — the
-- classic fan-out bug when you group over two one-to-many joins at once.

create or replace view public.admin_user_directory as
with prop as (
  select
    p.owner_id,
    count(*)                                             as property_count,
    count(*) filter (where p.admin_status = 'active')     as active_property_count,
    max(p.created_at)                                     as last_property_at,
    -- Leads are counted per property and summed here, not joined at the top
    -- level, so the two one-to-many relationships never multiply each other.
    coalesce(sum((select count(*) from public.leads l where l.property = p.slug)), 0) as total_leads
  from public.properties p
  where p.owner_id is not null
  group by p.owner_id
)
select
  pr.id,
  pr.email,
  pr.full_name,
  pr.phone,
  pr.role,
  pr.company_name,
  pr.verified,
  pr.onboarded,
  pr.created_at,

  lp.plan_type                                as plan_type,
  lp.status                                   as plan_status,
  lp.current_period_end                       as plan_period_end,

  coalesce(prop.property_count, 0)::int        as property_count,
  coalesce(prop.active_property_count, 0)::int as active_property_count,
  coalesce(prop.total_leads, 0)::int           as total_leads,

  -- "Last sign of life": their newest listing, or failing that the day they
  -- signed up. Same definition the browser used.
  greatest(pr.created_at, coalesce(prop.last_property_at, pr.created_at)) as latest_activity_at,

  -- Engagement score, max 100: recency (40) + live listings (35) + leads (25).
  -- Kept digit-for-digit identical to the TypeScript it replaces, so the
  -- Hot/Active/Warm/Cold badges do not quietly re-grade every landlord on the
  -- day this ships.
  (
    case
      when greatest(pr.created_at, coalesce(prop.last_property_at, pr.created_at)) > now() - interval  '1 day'  then 40
      when greatest(pr.created_at, coalesce(prop.last_property_at, pr.created_at)) > now() - interval  '7 days' then 32
      when greatest(pr.created_at, coalesce(prop.last_property_at, pr.created_at)) > now() - interval '14 days' then 22
      when greatest(pr.created_at, coalesce(prop.last_property_at, pr.created_at)) > now() - interval '30 days' then 12
      when greatest(pr.created_at, coalesce(prop.last_property_at, pr.created_at)) > now() - interval '90 days' then 4
      else 0
    end
    +
    case
      when coalesce(prop.active_property_count, 0) >= 3 then 35
      when coalesce(prop.active_property_count, 0)  = 2 then 25
      when coalesce(prop.active_property_count, 0)  = 1 then 14
      else 0
    end
    +
    case
      when coalesce(prop.total_leads, 0) >= 15 then 25
      when coalesce(prop.total_leads, 0) >=  8 then 19
      when coalesce(prop.total_leads, 0) >=  3 then 12
      when coalesce(prop.total_leads, 0) >=  1 then 6
      else 0
    end
  )::int as score,

  -- One haystack for the search box. The browser used to match name, email,
  -- phone, company *and* property names; the last of those is why the property
  -- names are folded in here rather than searched separately.
  lower(concat_ws(' ',
    pr.full_name, pr.email, pr.phone, pr.company_name,
    (select string_agg(p2.name, ' ') from public.properties p2 where p2.owner_id = pr.id)
  )) as search_text,

  -- The owner's listings, for the row expanders, aggregated here rather than
  -- fetched alongside.
  --
  -- This started life as a second query in the route — `properties` filtered
  -- by the page's owner ids — which looks cheap: three narrow columns for at
  -- most twenty-five owners. It was not, because it could only be *issued*
  -- once the page of rows had come back, making it a second round-trip wave.
  -- Measured against this database it cost ~119ms, which is more than the
  -- entire query it was meant to be an improvement on.
  --
  -- That is the shape of this whole fix: the admin portal was never slow
  -- because of how many rows it moved. It was slow because of how many times
  -- it went and asked.
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', p3.name, 'slug', p3.slug,
             'admin_status', coalesce(p3.admin_status, 'pending'))
           order by p3.created_at desc)
    from public.properties p3
    where p3.owner_id = pr.id
  ), '[]'::jsonb) as properties

from public.profiles pr
left join prop on prop.owner_id = pr.id
left join public.landlord_plans lp on lp.landlord_id = pr.id;

-- Read by `/api/admin/users`, which runs as service_role behind an admin-role
-- check in the route. Deliberately narrower than the usual
-- `anon, authenticated, service_role`: this view is the whole user table with
-- contact details attached, and no browser has any business reading it
-- directly. `npm run verify:grants` reports narrow grants and fails only on no
-- grant at all.
grant select on public.admin_user_directory to service_role;

-- ─── Indexes the directory needs ─────────────────────────────────────────────
--
-- `profiles` had nothing but its primary key, so every tab filtered 81 rows by
-- sequential scan today and will scan 81,000 the same way later. The role+date
-- composite answers both the tab filter and its ordering from one index.

create index if not exists profiles_role_created_idx
  on public.profiles (role, created_at desc);

-- The per-owner aggregate above, and every "who owns this" lookup in the admin
-- portal, start here.
create index if not exists properties_owner_id_idx
  on public.properties (owner_id)
  where owner_id is not null;

-- ─── The header figures ──────────────────────────────────────────────────────
--
-- The stat tiles above the table (total, paid plans, active users, average
-- score) and the per-tab counts in the tab bar are aggregates over the *whole*
-- filtered set, not over the visible page — which is exactly why the old page
-- felt it had to download everything. A function returns all of them in one
-- row, so one page view costs one page of rows plus one scalar round trip
-- instead of three full table downloads.
--
-- `p_q` is matched against the same `search_text` haystack the page query
-- uses, so the tiles always describe the rows underneath them.

create or replace function public.admin_user_directory_stats(
  p_role text default null,
  p_q    text default null
)
returns table (
  total            int,
  paid_plans       int,
  with_listings    int,
  active_users     int,
  avg_score        int,
  tenant_count     int,
  landlord_count   int,
  admin_count      int
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select *
    from public.admin_user_directory d
    where (p_role is null or p_role = 'all' or d.role = p_role)
      and (p_q is null or p_q = '' or d.search_text like '%' || lower(p_q) || '%')
  ),
  -- Tab counts ignore the role filter by definition: they are what the three
  -- tabs would each show. They do honour the search, so searching does not
  -- leave a tab promising rows it would not display.
  all_roles as (
    select role
    from public.admin_user_directory d
    where (p_q is null or p_q = '' or d.search_text like '%' || lower(p_q) || '%')
  )
  select
    (select count(*) from scoped)::int,
    (select count(*) from scoped where plan_status = 'active')::int,
    (select count(*) from scoped where active_property_count > 0)::int,
    (select count(*) from scoped where score >= 45)::int,
    coalesce((select round(avg(score)) from scoped), 0)::int,
    (select count(*) from all_roles where role = 'tenant')::int,
    (select count(*) from all_roles where role = 'landlord')::int,
    (select count(*) from all_roles where role = 'admin')::int;
$$;

-- `security definer` so the function can read the directory view, which only
-- service_role may select from; `execute` stays with service_role alone, so
-- that definer rights are not a way around the view's own narrow grant.
revoke all on function public.admin_user_directory_stats(text, text) from public;
grant execute on function public.admin_user_directory_stats(text, text) to service_role;
