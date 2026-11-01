-- Building a listing is free; publishing it is not.
--
-- The self-serve migration made a plan the price of entry: `landlord_property_limit`
-- returns NULL for a landlord with no active plan, so `landlord_can_add_property`
-- coalesced that to 0 and the INSERT policy refused the row. A landlord's first
-- action on the platform was therefore a card form, before they had typed a
-- single thing worth paying for.
--
-- The line moves here. An unpaid landlord may build up to a free ceiling; a
-- paid one keeps their tier's allowance, unchanged. Nothing about *visibility*
-- moves — `owner_plan_active` still gates every public query, so a free
-- landlord's listings remain invisible to students until they pay. The product
-- being sold is the audience and everything downstream of it, not the form.
--
-- Mirrors FREE_PROPERTY_LIMIT in src/lib/landlordAccess.ts. The API route that
-- creates properties runs under the service key and enforces the same number
-- in TypeScript; this is the half that holds when a client inserts directly.

-- ── The free ceiling, in one place ───────────────────────────────────────────
create or replace function public.landlord_free_property_limit()
returns integer
language sql
immutable
as $$ select 3 $$;

comment on function public.landlord_free_property_limit() is
  'Properties a landlord with no plan may build. Mirrors FREE_PROPERTY_LIMIT in src/lib/landlordAccess.ts — change both together.';

-- ── What a landlord may build right now ──────────────────────────────────────
-- Plan allowance when they are paying, the free ceiling when they are not.
-- `landlord_property_limit` is left alone on purpose: it answers "what does
-- their plan cover", which is a billing question, and the billing UI reads it.
create or replace function public.landlord_property_allowance(p_landlord uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.landlord_property_limit(p_landlord),
    public.landlord_free_property_limit()
  )
$$;

comment on function public.landlord_property_allowance(uuid) is
  'How many properties this landlord may have at once: their plan''s allowance, or the free ceiling when they have no plan.';

-- ── The cap the INSERT policy checks ─────────────────────────────────────────
-- Same shape as before, one function deeper, so the policy itself is untouched
-- and no landlord is momentarily locked out while this runs.
create or replace function public.landlord_can_add_property(p_landlord uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.landlord_property_count(p_landlord)
       < public.landlord_property_allowance(p_landlord)
$$;

grant execute on function public.landlord_free_property_limit() to authenticated;
grant execute on function public.landlord_property_allowance(uuid) to authenticated;
