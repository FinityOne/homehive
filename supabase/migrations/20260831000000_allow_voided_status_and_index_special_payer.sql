-- Applied to the hosted project on 2026-08-31.
--
-- The app writes status='voided' when a tenant is terminated early
-- (src/app/api/payments/[planId]/members/[memberId]/terminate/route.ts), and the
-- whole codebase reads it: the PaymentStatus type, the "Voided" badge, the
-- active/voided split in PlanWorkspace, and the inspection charge roll-up.
-- The CHECK constraint never allowed it, so terminating a tenant failed with a
-- 500 and their future rent stayed live. Widen the constraint to match the code.
alter table public.scheduled_payments
  drop constraint if exists scheduled_payments_status_check;

alter table public.scheduled_payments
  add constraint scheduled_payments_status_check
  check (status = any (array['pending','paid','partial','late','missed','processing','voided']));

-- The tenant portal loads a tenant's one-off charges by payer on every page
-- view (src/app/api/tenant/lease/route.ts) but only plan_id was indexed.
create index if not exists idx_special_tenant
  on public.special_payments using btree (plan_tenant_id);
