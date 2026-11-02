-- When the tenant *sent* the money, as distinct from when it landed.
--
-- ── The problem ────────────────────────────────────────────────────────────
--
-- A late fee is supposed to answer "did the tenant pay by the deadline". Until
-- now the only date available to answer it was `paid_date`, which is written at
-- *settlement*. For a card that is the same instant, so it worked by accident.
-- For ACH it is not: a debit submitted on the 1st clears on the 5th or the
-- 10th, and `paid_date` records the 10th. The tenant then gets billed nine days
-- of late fee for money they sent before the deadline, because the clearing
-- window of the US banking system was charged to them at $15 a day.
--
-- That is not hypothetical. On the 2026–2027 lease, six ACH payments that were
-- submitted on or before their due date carried $585 of late fees between them,
-- purely for clearing slowly. A seventh, submitted one day late, was billed for
-- nine.
--
-- Worse, while an ACH debit is in flight the row reads `processing` with
-- `paid_date = null`, so the fee is measured against *today* and grows every
-- day the bank takes — the tenant watches a fee climb on rent they have
-- already paid.
--
-- ── The fix ────────────────────────────────────────────────────────────────
--
-- Record the submission instant. `submitted_at` is the Stripe PaymentIntent's
-- `created` time: the moment the tenant pressed pay, which is exactly the fact
-- the deadline is about. `lateFeeAsOf` prefers it over `paid_date`, so a
-- payment is judged on when it was sent and the clearing lag costs the tenant
-- nothing.
--
-- It is deliberately *not* a settlement signal. A bounced ACH clears this
-- column back to null (see `revertRentPayment`), and the fee resumes accruing
-- from the due date — a payment that failed was never a payment, so the grace
-- it bought is withdrawn with it.
--
-- Nullable forever: rent recorded by hand off-platform has no submission
-- instant, and inventing one would be a lie. Those rows keep falling back to
-- `paid_date`, which for a manual entry is the landlord's own verdict about
-- when the money arrived.

alter table public.scheduled_payments
  add column if not exists submitted_at timestamptz;

alter table public.special_payments
  add column if not exists submitted_at timestamptz;

comment on column public.scheduled_payments.submitted_at is
  'When the tenant submitted the payment (Stripe PaymentIntent.created). The date a late fee is judged against — NOT a settlement time. Null for manually recorded rent, and cleared when an ACH debit bounces.';

comment on column public.special_payments.submitted_at is
  'When the tenant submitted the payment (Stripe PaymentIntent.created). The date a late fee is judged against — NOT a settlement time. Null for manually recorded payments, and cleared when an ACH debit bounces.';

-- Rows whose money arrived the same instant it was sent can be backfilled
-- safely: for a card, settlement *is* submission. ACH cannot be inferred this
-- way — the whole point is that the two differ — so those rows are backfilled
-- from Stripe by `scripts/backfill-submitted-at.mjs`, which reads each intent's
-- real `created` time rather than guessing.
update public.scheduled_payments
   set submitted_at = settled_at
 where submitted_at is null
   and settled_at is not null
   and payment_method = 'card';

update public.special_payments
   set submitted_at = settled_at
 where submitted_at is null
   and settled_at is not null
   and payment_method = 'card';
