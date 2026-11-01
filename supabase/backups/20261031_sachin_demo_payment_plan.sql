-- Payment plan deleted from the "Sachin" demo lease on 2026-10-31.
--
-- That lease (b2806e4a-06dc-4374-aa38-0f56eebcc6f0, ASU Student Castle w/
-- Backyard) was only ever a rehearsal of the lease flow, but its plan sat in
-- Financials next to real tenancies and moved every portfolio figure: $4,001
-- billed, $525 of derived late fees, a 2026-09-01 ACH charge stuck in
-- `processing` since August. The lease is now flagged `leases.is_demo`, and a
-- trigger forbids a payment plan on such a lease, so the plan had to go.
--
-- Kept here rather than in a migration because nothing should replay it. It
-- exists so these numbers can still be answered for, and so the one row that
-- reached Stripe (pi_3UAg8QH0iOs5gSJc0D6e0KDY, $800 + $16 ACH surcharge, never
-- settled) is not simply gone. To restore, clear `is_demo` on the lease first --
-- the trigger rejects the plan insert otherwise.

begin;

insert into payment_plans (id, owner_id, property_id, lease_id, name, due_day, notes, created_at, updated_at) values
  ('45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','16f7ab29-9a38-4883-9fa9-816185f73f60','d68aff5c-d92c-4ef6-b61b-a3ffc20929dc','b2806e4a-06dc-4374-aa38-0f56eebcc6f0','Rent – ASU Student Castle w/ Backyard',1,null,'2026-08-11T00:05:37.756583+00','2026-08-11T00:05:37.756583+00');

insert into payment_plan_tenants (id, plan_id, name, email, monthly_total, created_at, start_date, end_date, status, termination_date, termination_reason) values
  ('0706c0de-806f-49a8-86ed-17c5eaf9b4b2','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','Sachin','heran@finityone.com',800,'2026-08-11T00:05:38.630551+00',null,null,'active',null,null),
  ('c3a55c38-5c6e-4205-96bc-e48fe4e9552c','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','Heran Patel','heran@maharajaestates.com',1,'2026-08-31T23:43:36.236582+00','2026-08-01','2026-09-01','terminated','2026-09-01',null);

insert into payment_line_items (id, plan_tenant_id, category, label, amount, created_at) values
  ('f92325d3-4c02-4a34-9d4e-ab6ad99e7aa6','0706c0de-806f-49a8-86ed-17c5eaf9b4b2','rent','Rent',800,'2026-08-11T00:05:39.131863+00');

insert into late_fee_rules (id, plan_id, grace_period_days, fee_amount, frequency_days, max_total_fees, created_at) values
  ('c5fbd34a-307f-44a4-87ab-6f95079c2207','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230',0,15,1,null,'2026-08-11T00:05:40.139387+00');

insert into scheduled_payments (id, plan_id, plan_tenant_id, due_date, amount, status, paid_amount, paid_date, late_fees_applied, notes, created_at, updated_at, void_reason, payment_method, recorded_by, processing_fee, stripe_payment_intent_id, reminder_sent_at, reminder_count, settled_at) values
  ('a1f02720-016b-4819-ba7e-1322964abfba','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','0706c0de-806f-49a8-86ed-17c5eaf9b4b2','2026-08-01',800,'paid',800,'2026-08-31',450,null,'2026-08-11T00:05:39.615289+00','2026-08-31T23:44:21.949+00',null,null,null,0,null,'2026-08-11T00:15:44.448+00',1,null),
  ('6ec82907-f2a8-456b-952c-2181316fb3d7','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','c3a55c38-5c6e-4205-96bc-e48fe4e9552c','2026-08-01',1,'pending',0,null,0,null,'2026-08-31T23:43:36.362144+00','2026-08-31T23:43:36.362144+00',null,null,null,0,null,'2026-08-31T23:44:31.643+00',1,null),
  ('606256f2-927b-4ac3-b174-f748ca4a64e9','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','0706c0de-806f-49a8-86ed-17c5eaf9b4b2','2026-09-01',800,'processing',0,null,0,null,'2026-08-11T00:05:39.615289+00','2026-08-11T00:05:39.615289+00',null,'ach','tenant',16,'pi_3UAg8QH0iOs5gSJc0D6e0KDY',null,0,null),
  ('69b2b7ac-bb13-4dc9-a899-d009a9f790eb','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','0706c0de-806f-49a8-86ed-17c5eaf9b4b2','2026-10-01',800,'paid',800,'2026-10-06',75,null,'2026-08-11T00:05:39.615289+00','2026-10-06T00:37:07.147+00',null,null,null,0,null,null,0,null),
  ('409de65a-1b89-4032-be19-b7eaf8e9bdf8','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','0706c0de-806f-49a8-86ed-17c5eaf9b4b2','2026-11-01',800,'pending',0,null,0,null,'2026-08-11T00:05:39.615289+00','2026-08-11T00:05:39.615289+00',null,null,null,0,null,null,0,null),
  ('b18baa07-728e-4e2b-a337-e38e4b541e0c','45c5f0c2-cbd7-4d76-9dd1-9b4a09530230','0706c0de-806f-49a8-86ed-17c5eaf9b4b2','2026-12-01',800,'pending',0,null,0,null,'2026-08-11T00:05:39.615289+00','2026-08-11T00:05:39.615289+00',null,null,null,0,null,null,0,null);

-- No special_payments, payment_emails or rent_reminder_sends rows existed.

commit;
