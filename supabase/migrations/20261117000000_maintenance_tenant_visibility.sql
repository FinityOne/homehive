-- Maintenance a tenant is allowed to see.
--
-- The work list was built landlord-private, and every row on it carries things
-- a tenant must never read: the estimate, the actual spend, the vendor's phone
-- number, "reported_by: housemate complained again". So visibility cannot be
-- derived from the row — a tenant_issue is exactly as private as an upgrade
-- until the landlord says otherwise. It is an explicit per-item flag, and it
-- defaults to FALSE: every item that exists today stays private, and a landlord
-- who never touches this never leaks anything.
--
-- `tenant_note` exists because `description` does not travel. The description is
-- the landlord's own working note ("carpet is trashed, cheapest LVP will do")
-- and publishing it verbatim is how a tenant reads something that was never
-- addressed to them. The note is the sentence written *to* the tenant —
-- same split as `late_fee_waivers.tenant_note` / `reason`.
alter table public.property_work_items
  add column if not exists tenant_visible boolean not null default false,
  add column if not exists tenant_note text;

comment on column public.property_work_items.tenant_visible is
  'Does this item appear on the tenant portal for active lease holders at this property? Defaults to false — shared only by explicit landlord action.';

comment on column public.property_work_items.tenant_note is
  'The update written TO the tenant. Shown on their portal in place of `description`, which is the landlord''s private working note.';

-- The tenant portal asks exactly one question of this table: "the shared items
-- for this property". Partial, because the shared rows are the small minority.
create index if not exists property_work_items_tenant_visible_idx
  on public.property_work_items (property_id, status)
  where tenant_visible;

-- No new table, so no new grant is strictly required — `property_work_items`
-- was granted when it was created and a GRANT is per-table, not per-column.
-- Restated anyway because it is cheap and `npm run verify:grants` reads these
-- migrations: the table is landlord-owned behind owner-only RLS, and the tenant
-- side is served by the service role in /api/tenant/maintenance rather than by
-- a tenant-readable policy, because "a tenant on an *active* lease" is a join
-- this table cannot express.
grant all on public.property_work_items to anon, authenticated, service_role;
