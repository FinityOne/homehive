-- Self-serve landlord plans: pay for access, priced by property count.
--
-- The app enforces the cap in /api/properties, but a landlord's browser talks
-- to PostgREST directly with their own JWT, so the cap has to hold at the row
-- level too — otherwise "upgrade to add another property" is a suggestion.
--
-- Nobody loses anything they already had: every landlord who was on the
-- platform before it went paid is grandfathered onto a `legacy_free` row whose
-- limit is exactly the number of properties they already own. They keep what
-- they built; adding the next one is what costs money.
--
-- DEPLOY ORDER — this migration and the application code ship together:
--
--   * Running it BEFORE the code is deployed stops a landlord who owns no
--     properties yet from creating their first one, because the old UI has no
--     way to sell them a plan.
--   * Running the code BEFORE this migration is survivable but degraded:
--     `loadPlanState` retries without `property_limit` and logs a warning, so
--     plans keep working while grandfathered overrides do not exist yet.
--
-- So: deploy, then migrate, in the same window. Minutes apart, not days.

-- ── 1. Per-landlord limit override ───────────────────────────────────────────
-- Normally null and the tier decides. Set only for grandfathered accounts and
-- for one-off arrangements an admin makes by hand.
alter table public.landlord_plans
  add column if not exists property_limit integer;

comment on column public.landlord_plans.property_limit is
  'Overrides the tier default property cap. Null = use the tier. Set for grandfathered accounts.';

create index if not exists landlord_plans_status_idx
  on public.landlord_plans (landlord_id, status);

-- ── 2. The limit, in the database ────────────────────────────────────────────
-- Mirrors propertyLimitFor() in src/lib/landlordPlans.ts. Returns 0 when there
-- is no plan at all, which is the whole point: no plan, no properties.
create or replace function public.landlord_property_limit(p_landlord uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p.property_limit,
    case p.plan_type
      when 'unlimited'      then 2147483647
      when 'growth'         then 5
      when 'starter'        then 1
      -- Plans sold before the tiers existed. Honoured, never sold again.
      when 'lifetime'       then 2147483647
      when 'two_listing'    then 2
      when 'single_listing' then 1
      else 0
    end
  )
  from public.landlord_plans p
  where p.landlord_id = p_landlord
    -- past_due keeps working. A failed card is a retry, not a cancellation.
    and p.status in ('active', 'past_due')
  limit 1
$$;

-- Archived listings are not live and so do not count against the cap — a
-- landlord who rented one out and let it archive is not being billed for it.
create or replace function public.landlord_property_count(p_landlord uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.properties
  where owner_id = p_landlord
    and archived_at is null
$$;

create or replace function public.landlord_can_add_property(p_landlord uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.landlord_property_count(p_landlord)
       < coalesce(public.landlord_property_limit(p_landlord), 0)
$$;

grant execute on function public.landlord_property_limit(uuid) to authenticated;
grant execute on function public.landlord_property_count(uuid) to authenticated;
grant execute on function public.landlord_can_add_property(uuid) to authenticated;

-- ── 3. Grandfather everyone who was here first ───────────────────────────────
-- Runs before the new INSERT policy so nobody is ever momentarily locked out.
insert into public.landlord_plans (landlord_id, plan_type, status, property_limit)
select
  pr.owner_id,
  'legacy_free',
  'active',
  count(*)::integer
from public.properties pr
where pr.owner_id is not null
  and pr.archived_at is null
group by pr.owner_id
on conflict (landlord_id) do nothing;

-- ── 4. Enforce the cap on insert ─────────────────────────────────────────────
-- The old policy was a single ALL policy, which meant its WITH CHECK covered
-- inserts and updates together. Splitting it lets the cap apply to "add a new
-- property" without also blocking "edit the ones you have" — a landlord who
-- downgrades can still manage what they kept, they just cannot add more.
drop policy if exists "Owners can manage own properties" on public.properties;

create policy "Owners can read own properties"
  on public.properties for select to authenticated
  using (owner_id = auth.uid());

create policy "Owners can update own properties"
  on public.properties for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Owners can delete own properties"
  on public.properties for delete to authenticated
  using (owner_id = auth.uid());

create policy "Owners can create properties within plan"
  on public.properties for insert to authenticated
  with check (
    owner_id = auth.uid()
    and public.landlord_can_add_property(auth.uid())
  );
