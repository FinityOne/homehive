-- Leads: turn RLS on, and make the policies mean something.
--
-- `public.leads` carried six policies and RLS switched OFF, so Supabase's
-- linter reported it twice (0007 policy_exists_rls_disabled, 0013
-- rls_disabled_in_public) and anyone holding the project URL and the anon key
-- could read, edit and delete every renter's name, email and phone number.
--
-- Simply flipping RLS on would not have been a fix: the policies underneath it
-- were "authenticated can select using (true)" and "authenticated can update
-- using (true)", i.e. any signed-in renter could read and rewrite every
-- landlord's entire lead book. So the old six are dropped and replaced with
-- policies that follow the ownership the app actually has:
--
--   * a landlord sees the leads for the property slugs they own
--   * an admin sees everything
--   * a renter sees their own lead (by user_id, or by the email they signed
--     in with — /dashboard and the listing page both look leads up by email)
--   * nobody inserts through the API; every lead is written server-side with
--     the service role (the public form posts to /api/leads)
--   * nobody deletes through the API
--
-- ── 1. Helpers ───────────────────────────────────────────────────────────────
-- These live in `private`, not `public`: a SECURITY DEFINER function in the
-- public schema is a callable REST endpoint for anon (lint 0028), and these
-- two exist only to be read by a policy. They have to be SECURITY DEFINER
-- because `profiles` and `properties` have RLS of their own — a plain subquery
-- inside a policy is filtered by that RLS and would answer "no" for reasons
-- that have nothing to do with ownership.
create schema if not exists private;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = (select auth.uid())
       and role = 'admin'
  )
$$;

create or replace function private.owns_property_slug(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_slug is not null and exists (
    select 1 from public.properties
     where slug = p_slug
       and owner_id = (select auth.uid())
  )
$$;

-- A policy expression runs as the caller, so the caller needs to be able to
-- reach these. The schema is not exposed to PostgREST, so this grants no
-- endpoint — only the right to be consulted by a policy.
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.owns_property_slug(text) to authenticated;

-- ── 2. Out with the old ──────────────────────────────────────────────────────
drop policy if exists "Admins can read leads"                on public.leads;
drop policy if exists "Admins can update leads"              on public.leads;
drop policy if exists "Anyone can submit a lead"             on public.leads;
drop policy if exists "Authenticated users can read leads"   on public.leads;
drop policy if exists "Authenticated users can update leads" on public.leads;
drop policy if exists "Public can insert leads"              on public.leads;

-- ── 3. RLS on ────────────────────────────────────────────────────────────────
alter table public.leads enable row level security;

-- ── 4. In with the new ───────────────────────────────────────────────────────
-- Read: the landlord who owns the listing, an admin, or the renter themselves.
-- Email is compared case-insensitively because a lead row keeps whatever
-- casing the renter typed into the form, while the JWT carries the normalised
-- address they signed in with.
create policy "leads_select_owner_admin_or_self"
  on public.leads
  for select
  to authenticated
  using (
    private.is_admin()
    or private.owns_property_slug(property)
    or user_id = (select auth.uid())
    or (
      email is not null
      and lower(email) = lower((select auth.jwt() ->> 'email'))
    )
  );

-- Write: only the landlord who owns the listing, or an admin. A renter can
-- read their own lead but not rewrite its status. WITH CHECK repeats the
-- predicate so an update cannot hand the row to a property the caller does
-- not own.
create policy "leads_update_owner_or_admin"
  on public.leads
  for update
  to authenticated
  using (
    private.is_admin()
    or private.owns_property_slug(property)
  )
  with check (
    private.is_admin()
    or private.owns_property_slug(property)
  );

-- No insert and no delete policy is deliberate. Lead creation runs through
-- /api/leads, the roommate-group join and the inbound-email webhook, all of
-- which hold the service role and bypass RLS; nothing deletes a lead.

-- ── 5. Grants ────────────────────────────────────────────────────────────────
-- Unchanged in substance — stated here so the table's access is visible in one
-- place and `npm run verify:grants` keeps seeing it.
-- `anon` is deliberately absent: with no insert policy the grant would be
-- inert anyway, and a logged-out visitor has no business touching this table.
grant select, insert, update on public.leads to authenticated;
grant all on public.leads to service_role;

-- Index for the ownership lookup the select policy does on every row.
create index if not exists idx_leads_property on public.leads (property);
