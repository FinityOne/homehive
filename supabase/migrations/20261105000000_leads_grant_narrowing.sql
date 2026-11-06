-- Leads: make the grants say what the policies mean.
--
-- 20261103011000_leads_rls.sql turned RLS on and wrote the grants it wanted,
-- with a comment explaining that `anon` was deliberately absent. That comment
-- described the migration, not the database: `leads` had already been handed
-- `grant all to anon, authenticated, service_role` by the blanket grant in
-- 20261102020000_data_api_grants.sql, and a later `grant` cannot take away
-- what an earlier one gave. So anon was still holding DELETE and TRUNCATE on
-- the table this whole time.
--
-- Nothing was reachable through it. RLS was verified to hold the line: as
-- `anon` an unqualified `delete from public.leads` removed 0 rows, an insert
-- raised 42501, and a select returned 0 of 200. PostgREST also never issues
-- TRUNCATE. This is defence in depth, not an incident — but a privilege no
-- policy backs is one nobody has to reason about, and the next person reading
-- the previous migration should find a database that agrees with it.
--
-- The grants below are exactly the two policies on the table:
--   leads_select_owner_admin_or_self  -> select, for authenticated
--   leads_update_owner_or_admin       -> update, for authenticated
-- Inserts and deletes are service-role only, which is already how every
-- lead-writing path runs (/api/leads, the roommate-group join, the
-- inbound-email webhook).
--
-- This is the same deliberate narrowing CLAUDE.md allows for
-- `rent_payment_attempts` and `lead_followup_sends`; `npm run verify:grants`
-- reports it rather than failing it.

revoke all on public.leads from anon;

revoke all on public.leads from authenticated;
grant select, update on public.leads to authenticated;

grant all on public.leads to service_role;
