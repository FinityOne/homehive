-- Late fee money, recorded per payment rather than per charge.
--
-- ── Why a table and not just `late_fee_paid` ───────────────────────────────
--
-- Until now a late fee could only be collected as a passenger on its rent: the
-- tenant paid the month, and settlement wrote the fee onto the same row. That
-- made `scheduled_payments.late_fee_paid` sufficient, because there was exactly
-- one payment per row and `stripe_payment_intent_id` identified it.
--
-- Letting a tenant pay a fee *on its own* breaks both of those assumptions. The
-- rent on these rows was settled months ago by a different payment — on this
-- database every outstanding fee sits on rent that was paid in full — so the
-- row's `stripe_payment_intent_id` already belongs to the rent, and the fee
-- payment needs its own identity. Without one:
--
--   • the webhook and the browser's confirm call both run settlement, and with
--     nothing to key on, the second run adds the fee a second time;
--   • an ACH fee payment that bounces cannot be un-applied without guessing how
--     much of `late_fee_paid` came from which payment;
--   • the landlord has no record of *when* a fee was collected, only a running
--     total they cannot reconcile.
--
-- So each collection is a row here, unique on (charge, intent). Settlement
-- inserts first and only increments `late_fee_paid` when the insert actually
-- happened, which makes a repeat run a no-op. `late_fee_paid` stays the
-- authoritative running total — `financialsRollup` and the late-fee ledger
-- already read it, and nothing there needs to change.

create table if not exists public.late_fee_payments (
  id                       uuid        primary key default gen_random_uuid(),
  scheduled_payment_id     uuid        not null
    references public.scheduled_payments (id) on delete cascade,
  -- Denormalised so a landlord-scoped query does not have to walk back through
  -- the charge. RLS keys on it, as it does elsewhere in the payment tables.
  plan_id                  uuid        not null
    references public.payment_plans (id) on delete cascade,
  stripe_payment_intent_id text        not null,
  -- Dollars, like every other money column in this schema.
  amount                   numeric(10,2) not null check (amount > 0),
  -- The surcharge the tenant paid to send it. Recorded for the same reason
  -- `processing_fee` is on the rent rows: it is a cost, not income.
  processing_fee           numeric(10,2) not null default 0,
  method                   text,
  -- 'paid' once the money has landed, 'processing' while an ACH debit clears.
  -- A fee that is still clearing must not read as collected.
  status                   text        not null default 'paid',
  settled_at               timestamptz,
  created_at               timestamptz not null default now(),
  constraint late_fee_payments_status_check
    check (status in ('paid', 'processing')),
  -- The idempotency key. Two settlement runs for one intent cannot both apply.
  constraint late_fee_payments_once
    unique (scheduled_payment_id, stripe_payment_intent_id)
);

comment on table public.late_fee_payments is
  'One row per late-fee collection. Unique (scheduled_payment_id, stripe_payment_intent_id) makes settlement idempotent; scheduled_payments.late_fee_paid remains the running total.';
comment on column public.late_fee_payments.amount is
  'Fee dollars collected by this payment. Added to scheduled_payments.late_fee_paid when the row is first inserted.';

create index if not exists late_fee_payments_charge_idx
  on public.late_fee_payments (scheduled_payment_id);
create index if not exists late_fee_payments_plan_idx
  on public.late_fee_payments (plan_id, created_at desc);

alter table public.late_fee_payments enable row level security;

-- A landlord may read fee collections on their own plans, keyed on
-- `payment_plans.owner_id` exactly as the `owner_all` policies on
-- `scheduled_payments` and `late_fee_waivers` are. Writes come only from
-- settlement under the service role, which bypasses RLS, so there is
-- deliberately no insert or update policy.
drop policy if exists "owner_all" on public.late_fee_payments;
create policy "owner_all"
  on public.late_fee_payments for select
  using (
    plan_id in (
      select p.id from public.payment_plans p where p.owner_id = auth.uid()
    )
  );
