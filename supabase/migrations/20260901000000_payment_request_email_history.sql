-- Applied to the hosted project on 2026-09-01.
--
-- Email history for payment requests (rent reminders, deposit and charge asks).
--
-- Until now the only trace a sent request left was a counter on the charge it
-- covered: `reminder_sent_at` plus `reminder_count`. That answers "have I
-- chased this?" and nothing else. A landlord asking the questions they actually
-- ask — which month did I chase, who did it go to, did it bounce, what did I
-- say — had no record to read, and the counter cannot answer any of them
-- because one email routinely covers several months at once.
--
-- Two tables rather than a jsonb blob on one: a single request to a tenant can
-- cover March rent, April rent and a deposit, and the per-row history in the
-- ledger has to look up "every email that mentioned THIS charge". That is a
-- join, so the covered rows get to be rows.
create table if not exists public.payment_emails (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.payment_plans(id) on delete cascade,
  -- Kept nullable: a payer can be removed from the plan later, and losing the
  -- payer must not erase the record that we once emailed them.
  plan_tenant_id uuid references public.payment_plan_tenants(id) on delete set null,
  recipient_email text not null,
  recipient_name  text,
  subject text not null,
  -- Room for the automated nudges that will follow the manual ones.
  kind    text not null default 'rent_request',
  trigger text not null default 'manual' check (trigger in ('manual','auto')),
  -- Failures are recorded too. "I sent it and heard nothing" and "it never
  -- left the building" look identical to a landlord unless we keep both.
  status  text not null default 'sent' check (status in ('sent','failed')),
  error   text,
  -- Resend's message id, so a future webhook can attach delivery and opens.
  provider_id text,
  custom_message text,
  amount_total numeric(12,2) not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_email_items (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.payment_emails(id) on delete cascade,
  -- Exactly one of the two below is set; the check enforces it. Rent lives in
  -- scheduled_payments, deposits and one-offs in special_payments.
  scheduled_payment_id uuid references public.scheduled_payments(id) on delete cascade,
  special_payment_id   uuid references public.special_payments(id)   on delete cascade,
  -- Denormalised on purpose: the label and amount are what the tenant was
  -- actually shown. Editing a charge later must not rewrite history.
  label text not null,
  due_date date not null,
  amount numeric(12,2) not null,
  kind text not null check (kind in ('rent','charge')),
  constraint payment_email_items_one_target check (
    (scheduled_payment_id is not null) <> (special_payment_id is not null)
  )
);

-- The Activity tab reads a plan's requests newest-first.
create index if not exists idx_payment_emails_plan_created
  on public.payment_emails using btree (plan_id, created_at desc);
-- The portfolio log reads every request a landlord has sent, newest-first.
create index if not exists idx_payment_emails_sent_by_created
  on public.payment_emails using btree (sent_by, created_at desc);
create index if not exists idx_payment_email_items_email
  on public.payment_email_items using btree (email_id);
-- The per-row history in the ledger looks up by the charge being displayed.
create index if not exists idx_payment_email_items_scheduled
  on public.payment_email_items using btree (scheduled_payment_id);
create index if not exists idx_payment_email_items_special
  on public.payment_email_items using btree (special_payment_id);

alter table public.payment_emails      enable row level security;
alter table public.payment_email_items enable row level security;
-- No policies, matching rent_payment_notifications: these are written and read
-- only by service-role API routes, which check plan ownership themselves before
-- returning anything. The browser never queries them directly.
