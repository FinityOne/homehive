-- One row per attempt to move rent money, and what became of it.
--
-- ── Why this exists ────────────────────────────────────────────────────────
--
-- A landlord asking "which payments cleared and which didn't" could not be
-- answered by this schema at all, because a failure erases itself.
--
-- The charge rows carry the *current* state of the money: `paid` with a
-- `paid_date`, or `processing` while an ACH debit is in flight. That covers two
-- of the three outcomes. The third — the debit bounced — is handled by
-- `revertRentPayment`, which puts the charge back to `pending`, clears
-- `paid_amount`, `paid_date`, `payment_method`, `processing_fee` and
-- `submitted_at`, and moves on. That is correct bookkeeping (a payment that
-- failed was never a payment) and a total loss of history: afterwards nothing
-- on the row says a tenant ever tried, when they tried, how much, or why the
-- bank refused. The landlord sees an unpaid month and a tenant who claims to
-- have paid, and the platform has no opinion.
--
-- ACH is not an edge case here. Every bank payment on this database spends
-- three to nine days in `processing` before it lands (one October debit was
-- submitted on the 3rd and settled on the 8th), so "it is coming" and "it
-- bounced a week ago" are the two most consequential states the money has, and
-- only one of them was observable.
--
-- ── The shape ──────────────────────────────────────────────────────────────
--
-- One row per (plan, Stripe PaymentIntent). The intent is the payment as the
-- tenant experienced it — they pressed pay once, even if it covered three
-- months of rent and a late fee — so it is the natural unit of a payments log,
-- and `items` keeps the snapshot of what that one press was for.
--
-- Three states, each with its own timestamp rather than a single `updated_at`,
-- because the gap between them is the fact the landlord is reading:
--
--   processing → submitted_at                (sent, bank has it)
--   cleared    → submitted_at, cleared_at    (landed; the gap is the lag)
--   failed     → submitted_at, failed_at     (bounced, with the bank's reason)
--
-- This table is deliberately *not* a source of truth for money. Totals keep
-- coming from the charge rows and `late_fee_paid`; this is the narrative beside
-- them. Dropping it would cost the log and nothing else.

create table if not exists public.rent_payment_attempts (
  id                 uuid          primary key default gen_random_uuid(),
  -- Denormalised onto the plan so a landlord-scoped read needs no join, and so
  -- RLS can key on ownership exactly as `late_fee_payments` does.
  plan_id            uuid          not null
    references public.payment_plans (id) on delete cascade,
  payment_intent_id  text          not null,
  -- 'card' | 'ach'. Null only if Stripe told us nothing, which should not
  -- happen and is not worth a constraint.
  method             text,
  status             text          not null default 'processing',
  -- Dollars, like every other money column here: the rent, charges and late
  -- fees this one intent actually moved. Not the Stripe charge total — that
  -- includes the surcharge below, which is the tenant's cost, not income.
  amount             numeric(12,2) not null default 0,
  surcharge          numeric(12,2) not null default 0,
  -- When the tenant pressed pay (PaymentIntent.created), which is also the
  -- instant every late fee is judged against — see `submitted_at` on the
  -- charge rows and `lateFeeAsOf`.
  submitted_at       timestamptz,
  cleared_at         timestamptz,
  failed_at          timestamptz,
  -- Stripe's own words, kept verbatim. "insufficient_funds" and "the account
  -- was closed" are different conversations with the tenant.
  failure_code       text,
  failure_message    text,
  -- What the payment was for, as it was at the time:
  --   [{ kind: 'rent'|'charge'|'late_fee', id, label, due_date, amount }]
  -- Denormalised on purpose, for the same reason `payment_email_items` is: a
  -- failed attempt's charges get edited, re-billed and paid again later, and
  -- rewriting the history of what bounced would make the log a lie. It is also
  -- the only record left of what a reverted payment covered.
  items              jsonb         not null default '[]'::jsonb,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),
  constraint rent_payment_attempts_status_check
    check (status in ('processing', 'cleared', 'failed')),
  -- The idempotency key. Settlement runs twice by design (the webhook and the
  -- browser's confirm call, in either order), so the second run updates this
  -- row rather than writing a second history for one payment.
  constraint rent_payment_attempts_once
    unique (plan_id, payment_intent_id)
);

comment on table public.rent_payment_attempts is
  'Append-only history of rent payment attempts: one row per (plan, Stripe PaymentIntent), carrying submitted/cleared/failed and the bank''s reason. Narrative only — money totals still come from the charge rows.';
comment on column public.rent_payment_attempts.items is
  'Snapshot of what this payment covered at the time it was made. Never rewritten: a bounced payment''s charges get re-billed, and the log must still say what bounced.';
comment on column public.rent_payment_attempts.amount is
  'Rent, charges and late fees moved by this intent, in dollars. Excludes the tenant''s surcharge, which is not landlord income.';

-- The payments log reads one landlord's attempts newest-first.
create index if not exists rent_payment_attempts_plan_idx
  on public.rent_payment_attempts (plan_id, submitted_at desc);
-- Settlement looks a row up by its intent before deciding insert or update.
create index if not exists rent_payment_attempts_intent_idx
  on public.rent_payment_attempts (payment_intent_id);

alter table public.rent_payment_attempts enable row level security;

-- A landlord may read attempts on their own plans. Writes come only from
-- settlement under the service role, which bypasses RLS, so there is
-- deliberately no insert or update policy: nothing in a browser may author
-- payment history.
drop policy if exists "owner_read" on public.rent_payment_attempts;
create policy "owner_read"
  on public.rent_payment_attempts for select
  using (
    plan_id in (
      select p.id from public.payment_plans p where p.owner_id = auth.uid()
    )
  );

-- A policy alone is not access: without a grant, PostgREST refuses the table
-- before RLS is ever consulted, and the landlord's log comes back as a
-- permission error. Granted in the same migration as the table, on purpose.
grant select on public.rent_payment_attempts to authenticated;
grant all    on public.rent_payment_attempts to service_role;

-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Every payment already in the database that went through Stripe gets its row,
-- grouped by intent exactly as new ones will be. Dates come from the charge
-- rows themselves, so a backfilled attempt reads identically to a live one.
--
-- Failures cannot be recovered: the rows they touched were reset and carry no
-- trace, which is the whole reason this table exists. The log says so rather
-- than implying none ever happened.
insert into public.rent_payment_attempts
  (plan_id, payment_intent_id, method, status, amount, surcharge,
   submitted_at, cleared_at, items)
select
  m.plan_id,
  m.payment_intent_id,
  m.method,
  m.status,
  m.amount,
  m.surcharge,
  m.submitted_at,
  case when m.status = 'cleared' then m.settled_at end,
  m.items
from (
  select
    plan_id,
    stripe_payment_intent_id as payment_intent_id,
    min(payment_method)                                as method,
    -- An intent whose rows are all still clearing is in flight; if any row
    -- landed, the money landed.
    case when bool_or(status = 'paid') then 'cleared' else 'processing' end as status,
    sum(money)                                         as amount,
    sum(fee)                                           as surcharge,
    min(submitted_at)                                  as submitted_at,
    max(settled_at)                                    as settled_at,
    jsonb_agg(item order by due_date)                  as items
  from (
    select
      sp.plan_id,
      sp.stripe_payment_intent_id,
      sp.payment_method,
      sp.status,
      sp.due_date,
      coalesce(sp.paid_amount, 0)    as money,
      coalesce(sp.processing_fee, 0) as fee,
      sp.submitted_at,
      sp.settled_at,
      jsonb_build_object(
        'kind', 'rent', 'id', sp.id,
        'label', to_char(sp.due_date, 'FMMonth YYYY') || ' rent',
        'due_date', sp.due_date, 'amount', sp.amount
      ) as item
    from public.scheduled_payments sp
    where sp.stripe_payment_intent_id is not null
      and sp.status in ('paid', 'processing')
    union all
    select
      pp.plan_id,
      pp.stripe_payment_intent_id,
      pp.payment_method,
      pp.status,
      pp.due_date,
      case when pp.status = 'paid' then coalesce(pp.amount, 0) else 0 end,
      coalesce(pp.processing_fee, 0),
      pp.submitted_at,
      pp.settled_at,
      jsonb_build_object(
        'kind', 'charge', 'id', pp.id,
        'label', pp.label,
        'due_date', pp.due_date, 'amount', pp.amount
      )
    from public.special_payments pp
    where pp.stripe_payment_intent_id is not null
      and pp.status in ('paid', 'processing')
  ) legs
  group by plan_id, stripe_payment_intent_id
) m
on conflict (plan_id, payment_intent_id) do nothing;
