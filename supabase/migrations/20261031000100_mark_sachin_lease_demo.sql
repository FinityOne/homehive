-- The "Sachin" lease was a rehearsal. Say so, and take its money away.
--
-- Lease b2806e4a (ASU Student Castle w/ Backyard, Aug–Oct 2026) was built to
-- test the lease flow end to end and then left in place. Its plan was billing
-- $4,001 across six charges, carried a 0-day-grace $15/day late-fee rule that
-- had already derived $525 of fees, and held a 2026-09-01 ACH charge that has
-- been `processing` since August — all of it landing in the landlord's
-- Financials next to real tenancies.
--
-- Deleting the plan cascades its payers, line items, schedule, charges, late-fee
-- rule and email history. The rows are kept verbatim in
-- supabase/backups/20261031_sachin_demo_payment_plan.sql, including the Stripe
-- intent id, because a payment that touched Stripe should stay answerable for
-- even once it is out of the books.
--
-- Order matters: the plan goes first, because the trigger from the previous
-- migration refuses the flag while a plan still hangs off the lease.
--
-- Scoped by id, so this is a no-op in any environment that does not have this
-- particular lease.

delete from public.payment_plans
  where lease_id = 'b2806e4a-06dc-4374-aa38-0f56eebcc6f0';

update public.leases
   set is_demo = true,
       updated_at = now()
 where id = 'b2806e4a-06dc-4374-aa38-0f56eebcc6f0';
