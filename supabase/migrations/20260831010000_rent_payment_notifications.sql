-- One row per notification we have already sent about a payment intent.
--
-- settleRentPayment() is deliberately safe to run twice — the webhook and the
-- browser's confirm call both go through it, in either order — so the emails it
-- triggers need their own guard. Claiming a (payment_intent_id, kind) row before
-- sending means whichever caller gets there first sends, and the other's insert
-- fails on the unique index and quietly does nothing.
create table if not exists public.rent_payment_notifications (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id text not null,
  -- 'paid' | 'processing' | 'failed' — a bounced ACH debit is its own email,
  -- and a payment that clears after 'processing' still owes a 'paid' one.
  kind text not null,
  created_at timestamptz not null default now(),
  unique (payment_intent_id, kind)
);

alter table public.rent_payment_notifications enable row level security;
-- No policies: this is service-role bookkeeping, never read by the browser.
