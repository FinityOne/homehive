-- Self-serve listings: a paying landlord publishes without waiting for a human.
--
-- Two changes that only make sense together:
--
--   1. The review queue stops gating publication. `admin_status = 'pending'`
--      used to mean "a human has not looked at this yet", and every new listing
--      started there. A landlord who had just paid then waited a day to see
--      their own listing, which is the worst possible moment to introduce a
--      delay. New listings are now created `active`. The other admin states
--      (`rejected`, `flagged`, `test`, `inactive`) are untouched and still work
--      — review becomes a moderation tool applied after the fact rather than a
--      gate in front of every landlord.
--
--   2. Payment becomes the gate instead. A listing is only visible to students
--      while its landlord has a live plan. This is the honest version of
--      "approved": the landlord controls when it is ready, we control that
--      they are paying, and neither of us makes the other wait.
--
-- Why a maintained column rather than a join: every public query runs through
-- PostgREST from the browser or an anon server client, and `properties` has no
-- foreign key to `landlord_plans` (both point at `auth.users`), so there is no
-- embed to filter on. A boolean on the row keeps all six public query sites to
-- a single extra `.eq()`, stays indexable, and cannot be forgotten by a caller
-- the way a join condition can.
--
-- It is derived state, so it is never written by application code — two
-- triggers own it, and that is deliberate: a plan lapsing has to hide listings
-- without anybody touching the property row, which is exactly the case
-- recomputing on write would miss.

-- ── 1. The column ────────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists owner_plan_active boolean not null default false;

comment on column public.properties.owner_plan_active is
  'Derived: does this listing''s owner have a plan we are being paid for? Public queries require it. Maintained by trigger — never write it from application code.';

-- ── 2. Does this landlord have a plan we are being paid for? ─────────────────
-- Mirrors planGrantsAccess() in src/lib/landlordPlans.ts, including the two
-- rules that look odd in isolation:
--   * past_due still counts. A failed card is a retry, not a cancellation, and
--     yanking a landlord's listings off the site over one declined charge loses
--     their tenants their search results and us the renewal.
--   * per_lead never counted. It was never a listing plan.
--
-- A null owner is HomeHive's own claimable inventory — listings we seeded, with
-- no landlord to bill. Those stay visible; there is nobody for the paywall to
-- be about.
create or replace function public.landlord_plan_is_active(p_landlord uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_landlord is null then true
    else exists (
      select 1
      from public.landlord_plans p
      where p.landlord_id = p_landlord
        and p.status in ('active', 'past_due')
        and p.plan_type <> 'per_lead'
    )
  end
$$;

grant execute on function public.landlord_plan_is_active(uuid) to authenticated, anon;

-- ── 3. Backfill ──────────────────────────────────────────────────────────────
update public.properties p
   set owner_plan_active = public.landlord_plan_is_active(p.owner_id)
 where p.owner_plan_active is distinct from public.landlord_plan_is_active(p.owner_id);

-- ── 4. Keep it true ──────────────────────────────────────────────────────────
-- A new row, or one changing hands, answers the question for itself.
create or replace function public.properties_set_owner_plan_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.owner_plan_active := public.landlord_plan_is_active(new.owner_id);
  return new;
end
$$;

drop trigger if exists properties_owner_plan_active on public.properties;
create trigger properties_owner_plan_active
  before insert or update of owner_id on public.properties
  for each row execute function public.properties_set_owner_plan_active();

-- A plan starting, lapsing, or being deleted republishes or hides every listing
-- that landlord owns. This is the half that no property write would ever catch.
create or replace function public.landlord_plans_sync_properties()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_landlord uuid := coalesce(new.landlord_id, old.landlord_id);
  v_active   boolean;
begin
  v_active := public.landlord_plan_is_active(v_landlord);

  update public.properties
     set owner_plan_active = v_active
   where owner_id = v_landlord
     and owner_plan_active is distinct from v_active;

  return null;
end
$$;

drop trigger if exists landlord_plans_sync_properties on public.landlord_plans;
create trigger landlord_plans_sync_properties
  after insert or update or delete on public.landlord_plans
  for each row execute function public.landlord_plans_sync_properties();

-- Partial index matching the shape every public feed query actually uses.
create index if not exists properties_public_feed_idx
  on public.properties (owner_plan_active)
  where is_active and archived_at is null and not is_test;

-- ── 5. Drain the review queue ────────────────────────────────────────────────
-- One-off. Nothing enters `pending` after this migration, so these rows are
-- the last of a queue that no longer exists — leaving them would strand real
-- landlords behind a gate nobody is standing at any more.
--
-- `is_active` stays derived: approving must not override a landlord who set
-- their own listing to Rented or Inactive, so it is recomputed from their
-- status rather than forced to true. `is_test` is left alone — a test row that
-- is approved is still a test row and still stays off the public site.
update public.properties
   set admin_status = 'active',
       is_active = (
         listing_status = 'active'
         or (listing_status = 'rented' and coalesce(show_when_rented, false))
       )
 where admin_status = 'pending';
