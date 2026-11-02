-- Explicit Data API grants for every table in `public`.
--
-- ── Why this migration exists ──────────────────────────────────────────────
--
-- Until now not one migration in this repo has granted a single table
-- privilege, and the schema still worked, because Supabase shipped a default
-- ACL on `public` that handed every newly created table to `anon`,
-- `authenticated` and `service_role` automatically. Every grant this database
-- has was a gift from that default, never something we asked for.
--
-- Supabase withdrew that gift on 30 October 2026. Tables created in `public`
-- from that date need an explicit GRANT before supabase-js, PostgREST or
-- GraphQL can see them; without one the API answers `permission denied` no
-- matter how permissive RLS is. Existing tables on an existing project keep
-- the grants they already hold — which is why production is, today, fine.
--
-- Two things follow, and only one of them is about today.
--
-- The live one is forward-looking: the moment that default ACL is gone from
-- this project, the next `create table` in a migration produces a table the
-- API cannot see, and nothing in the migration, the types or the build says
-- so. It surfaces as a `permission denied` from a query against a table that
-- demonstrably exists. Every table added from here needs its own GRANT.
--
-- The second is that this database's grants are, right now, entirely borrowed.
-- Nothing in version control asks for a single one of them. This migration
-- writes down what production already holds, so the schema states its own
-- access instead of inheriting it from a platform default that is being
-- withdrawn. (A replay cannot rebuild this database in any case — only 8 of
-- these 62 tables were ever created by a migration; the rest predate this
-- directory and have no baseline dump. Those 8 are the ones a reset would
-- bring back ungranted.)
--
-- ── Why `all` and not least privilege ──────────────────────────────────────
--
-- This grants exactly what production already holds: everything, to all three
-- API roles. That reads alarmingly, and a tighter set (select to `anon`,
-- write to `authenticated`) would be the better posture — but writing the
-- tighter set *here* would make a rebuilt database quietly stricter than
-- production, so a query that works in prod would fail locally or on a preview
-- branch, which is the harder bug to find. Grants are not the access control
-- in this schema; RLS is, on all 62 tables but one. Narrowing them is a
-- deliberate change to make against production and the policies together, not
-- a side effect of fixing a rebuild.
--
-- One table does not hold up its end: `public.leads` has RLS *disabled* while
-- carrying six policies, which makes those policies inert and the table fully
-- readable and writable by `anon`. That predates this migration and is not
-- quietly changed by it — enabling RLS there would immediately start enforcing
-- six never-exercised policies — but it is the reason the paragraph above says
-- "all but one".
--
-- ── The convention from here ───────────────────────────────────────────────
--
-- Every migration that creates a table in `public` grants on it in the same
-- migration. `npm run verify:grants` fails if one forgets.

-- Tables, alphabetically. Kept as one statement per table so that a reader can
-- see, and grep, exactly which relations the Data API can reach.
grant all on public.auth_code_sends                  to anon, authenticated, service_role;
grant all on public.background_checks                to anon, authenticated, service_role;
grant all on public.bg_check_emails                  to anon, authenticated, service_role;
grant all on public.bg_check_references              to anon, authenticated, service_role;
grant all on public.checkout_inspection_item_parties to anon, authenticated, service_role;
grant all on public.checkout_inspection_items        to anon, authenticated, service_role;
grant all on public.checkout_inspection_late_fees    to anon, authenticated, service_role;
grant all on public.checkout_inspection_leases       to anon, authenticated, service_role;
grant all on public.checkout_inspection_parties      to anon, authenticated, service_role;
grant all on public.checkout_inspection_photos       to anon, authenticated, service_role;
grant all on public.checkout_inspection_revisions    to anon, authenticated, service_role;
grant all on public.checkout_inspections             to anon, authenticated, service_role;
grant all on public.email_logs                       to anon, authenticated, service_role;
grant all on public.email_opt_outs                   to anon, authenticated, service_role;
grant all on public.group_email_logs                 to anon, authenticated, service_role;
grant all on public.group_messages                   to anon, authenticated, service_role;
grant all on public.landlord_activation_sends        to anon, authenticated, service_role;
grant all on public.landlord_plans                   to anon, authenticated, service_role;
grant all on public.late_fee_payments                to anon, authenticated, service_role;
grant all on public.late_fee_rules                   to anon, authenticated, service_role;
grant all on public.late_fee_waivers                 to anon, authenticated, service_role;
grant all on public.lead_automation_logs             to anon, authenticated, service_role;
grant all on public.lead_notes                       to anon, authenticated, service_role;
grant all on public.lead_reservations                to anon, authenticated, service_role;
grant all on public.lead_unlocks                     to anon, authenticated, service_role;
grant all on public.leads                            to anon, authenticated, service_role;
grant all on public.lease_documents                  to anon, authenticated, service_role;
grant all on public.lease_tenants                    to anon, authenticated, service_role;
grant all on public.leases                           to anon, authenticated, service_role;
grant all on public.listing_comments                 to anon, authenticated, service_role;
grant all on public.notifications                    to anon, authenticated, service_role;
grant all on public.payment_email_items              to anon, authenticated, service_role;
grant all on public.payment_emails                   to anon, authenticated, service_role;
grant all on public.payment_line_items               to anon, authenticated, service_role;
grant all on public.payment_plan_tenants             to anon, authenticated, service_role;
grant all on public.payment_plans                    to anon, authenticated, service_role;
grant all on public.plan_audit_log                   to anon, authenticated, service_role;
grant all on public.plan_utilities                   to anon, authenticated, service_role;
grant all on public.pre_screens                      to anon, authenticated, service_role;
grant all on public.profiles                         to anon, authenticated, service_role;
grant all on public.properties                       to anon, authenticated, service_role;
grant all on public.property_asu_reasons             to anon, authenticated, service_role;
grant all on public.property_faqs                    to anon, authenticated, service_role;
grant all on public.property_images                  to anon, authenticated, service_role;
grant all on public.property_nearby                  to anon, authenticated, service_role;
grant all on public.property_page_views              to anon, authenticated, service_role;
grant all on public.property_rooms                   to anon, authenticated, service_role;
grant all on public.property_tags                    to anon, authenticated, service_role;
grant all on public.property_work_items              to anon, authenticated, service_role;
grant all on public.rent_payment_notifications       to anon, authenticated, service_role;
grant all on public.rent_reminder_sends              to anon, authenticated, service_role;
grant all on public.roommate_group_members           to anon, authenticated, service_role;
grant all on public.roommate_groups                  to anon, authenticated, service_role;
grant all on public.roommate_profiles                to anon, authenticated, service_role;
grant all on public.scheduled_payments               to anon, authenticated, service_role;
grant all on public.site_visits                      to anon, authenticated, service_role;
grant all on public.sms_templates                    to anon, authenticated, service_role;
grant all on public.special_payments                 to anon, authenticated, service_role;
grant all on public.tenants                          to anon, authenticated, service_role;
grant all on public.tour_availabilities              to anon, authenticated, service_role;
grant all on public.tours                            to anon, authenticated, service_role;
grant all on public.upgrade_requests                 to anon, authenticated, service_role;

-- `auth_code_sends` is the one table in this schema with a `serial` key, so it
-- is the one table whose inserts also need the sequence. The withdrawn default
-- ACL covered sequences too.
grant usage, select on sequence public.auth_code_sends_id_seq to anon, authenticated, service_role;

-- Functions already carry explicit `grant execute` where they are called over
-- RPC (`homehive_platform_stats`, `landlord_plan_is_active`,
-- `landlord_property_limit`, `landlord_property_count`,
-- `landlord_can_add_property`, `landlord_free_property_limit`,
-- `landlord_property_allowance`). Nothing to catch up there.
