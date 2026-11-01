-- Applied to the hosted project on 2026-10-31.
--
-- Late fees a landlord can actually see, chase, and write off.
--
-- A late fee here has never been a row. `lateFeeDue` derives it from the rule
-- whenever something renders, and `late_fee_paid` records it if money arrives.
-- Nothing ever listed the fees as things to collect, and the result is visible
-- in the data: 32 charges have assessed a fee and not one has been paid.
--
-- Deriving stays right — a fee is a function of a rule and a date, and storing
-- it is what corrupted `late_fees_applied`. So nothing here stores a fee. What
-- these tables store is the two things that are *not* derivable: the landlord's
-- decision to let a fee go, and the fact that they asked for it.

-- ── Writing a fee off ───────────────────────────────────────────────────────
--
-- Needed because of what the pending fees on this database actually are: all of
-- them sit on rent that was eventually paid in full, frozen at whatever the
-- uncapped $15/day rule had reached — up to $741.96 of fees on $741.96 of rent
-- that settled in June. Some of that is not collectable and some of it is not
-- lawful to pursue months after accepting the rent. Without a way to clear
-- those rows the list could never reach zero, and a list that cannot reach zero
-- gets ignored, which is how the feature would fail.
--
-- `amount` is the fee as it stood when the decision was made. It is history, so
-- it is frozen: recomputing it later against today's date would rewrite what
-- the landlord actually chose to forgive.
create table if not exists public.late_fee_waivers (
  id uuid primary key default gen_random_uuid(),
  -- One waiver per rent charge. Waiving twice is the same decision.
  scheduled_payment_id uuid not null unique
    references public.scheduled_payments(id) on delete cascade,
  plan_id uuid not null references public.payment_plans(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  reason text,
  waived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.late_fee_waivers is
  'A landlord''s recorded decision not to collect the late fee on one rent charge. `amount` is the fee as it stood at that moment — history, never recomputed.';

create index if not exists late_fee_waivers_plan_idx
  on public.late_fee_waivers (plan_id);

alter table public.late_fee_waivers enable row level security;

-- Matches late_fee_rules.owner_all and plan_utilities.owner_all — ownership is
-- the plan's, so the policy is the ownership check. The browser reads these
-- directly to render the ledger, which is why this table has a policy where
-- payment_emails deliberately does not.
drop policy if exists owner_all on public.late_fee_waivers;
create policy owner_all on public.late_fee_waivers
  for all using (
    plan_id in (select p.id from public.payment_plans p where p.owner_id = auth.uid())
  );

-- ── Having asked for it ─────────────────────────────────────────────────────
--
-- Deliberately separate from `reminder_sent_at`/`reminder_count`, which count
-- chases about the *rent*. A tenant who was reminded four times to pay August
-- rent has not been asked once about the fee, and showing "4" against the fee
-- would misreport the only thing the landlord needs to know before sending:
-- have I already put this to them? The ledger reads these two columns rather
-- than joining payment_emails, because it renders every charge on every lease.
alter table public.scheduled_payments
  add column if not exists late_fee_reminder_sent_at timestamptz,
  add column if not exists late_fee_reminder_count integer not null default 0;

comment on column public.scheduled_payments.late_fee_reminder_count is
  'Reminders sent specifically about this charge''s late fee. Distinct from reminder_count, which counts chases about the rent itself.';

-- ── A fee request is a kind of request ──────────────────────────────────────
--
-- Fee emails go through the same history every other payment request does, so
-- they appear in "Requests sent" beside the rent chases rather than in a
-- parallel log the landlord has to know to look for. The covered item is still
-- the rent row the fee rides on; only its kind is new.
alter table public.payment_email_items
  drop constraint if exists payment_email_items_kind_check;

alter table public.payment_email_items
  add constraint payment_email_items_kind_check
  check (kind in ('rent','charge','late_fee'));
