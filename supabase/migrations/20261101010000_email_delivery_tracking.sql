-- Delivery tracking for the emails we send about money.
--
-- `payment_emails` already recorded that we *called Resend* and whether the
-- call was accepted. That is not the same as the tenant receiving anything, and
-- it is the gap a landlord feels: "I reminded them twice" is worth very little
-- when both messages bounced off a dead address, and worth a great deal when
-- the log can say the tenant opened the second one an hour after it landed.
--
-- Resend reports the rest of the lifecycle by webhook, keyed on the message id
-- we already store in `provider_id`. So the states below are timestamps rather
-- than one status column: they are not mutually exclusive (a mail is delivered
-- *and* opened *and* clicked), and each one answers a different question. A
-- single enum would have to pick a winner and throw the rest away.
alter table public.payment_emails
  -- Resend accepted it and it left their infrastructure.
  add column if not exists delivered_at  timestamptz,
  add column if not exists opened_at     timestamptz,
  add column if not exists clicked_at    timestamptz,
  -- Hard failure at the receiving end: wrong address, mailbox gone, blocked.
  add column if not exists bounced_at    timestamptz,
  -- The recipient marked it as spam. Rarer than a bounce and much worse: keep
  -- mailing someone who has complained and the sending domain pays for it.
  add column if not exists complained_at timestamptz,
  -- Whatever the provider last told us, verbatim, for the rows above.
  add column if not exists delivery_detail text,
  add column if not exists delivery_updated_at timestamptz;

-- Who the message was written for.
--
-- The same table holds the tenant's receipt and the landlord's copy of it, and
-- a page called "reminders sent to tenants" that quietly includes the
-- landlord's own mail is a page that lies. `kind` already encodes this in its
-- prefix, but only by convention — a column states it, and the backfill below
-- settles the rows written before it existed.
alter table public.payment_emails
  add column if not exists audience text not null default 'tenant';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_emails_audience_check'
  ) then
    alter table public.payment_emails
      add constraint payment_emails_audience_check
      check (audience in ('tenant', 'landlord', 'admin'));
  end if;
end $$;

update public.payment_emails
   set audience = 'landlord'
 where audience = 'tenant'
   and kind like '%landlord%';

update public.payment_emails
   set audience = 'admin'
 where audience = 'tenant'
   and kind like '%admin%';

-- Every row already in the table was accepted by Resend and never heard about
-- again, because nothing was listening. Leaving `delivered_at` null on those
-- would make historic sends look like they failed to arrive, so the ones we
-- know Resend accepted are stamped from their own creation time and marked as
-- what they are: an acceptance, not an observed delivery.
update public.payment_emails
   set delivered_at = created_at,
       delivery_detail = 'Accepted by the provider before delivery tracking existed'
 where status = 'sent'
   and delivered_at is null;

-- The webhook arrives knowing only the provider's message id.
create index if not exists idx_payment_emails_provider
  on public.payment_emails using btree (provider_id)
  where provider_id is not null;

-- The reminders page reads a landlord's whole history newest-first and filters
-- in the query, so the common path is plan_id + created_at.
create index if not exists idx_payment_emails_plan_audience_created
  on public.payment_emails using btree (plan_id, audience, created_at desc);
