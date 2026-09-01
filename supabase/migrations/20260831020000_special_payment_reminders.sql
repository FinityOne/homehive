-- Rent requests for deposits and one-off charges (MAH-41).
--
-- `scheduled_payments` already tracks how often a landlord has chased a charge;
-- special_payments — deposits, penalties, one-offs — could never be emailed at
-- all, so they never needed it. Now that they can be requested, they need the
-- same history, or the "reminded 2×" affordance lies on exactly the charge that
-- matters most at move-in.
alter table public.special_payments
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_count   integer not null default 0;
