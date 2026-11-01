-- Landlord activation nudges: the sequence, and the way out of it.
--
-- Every other email in this app is transactional — it answers something the
-- recipient just did. This one does not: it goes to a landlord who signed up
-- and then stopped, on our schedule rather than theirs. That difference is the
-- whole reason these two tables exist.
--
--   • `email_opt_outs` — because promotional mail a recipient cannot stop is
--     both indefensible and, under CAN-SPAM, illegal. Keyed on the address
--     rather than a user id, so unsubscribing works from the email itself
--     without a session, and keeps working if the profile is later deleted.
--
--   • `landlord_activation_sends` — because the failure mode of a sequence is
--     sending it twice. One row per (landlord, kind, step) with a unique
--     constraint means a re-run after a partial failure picks up only what it
--     missed, and step 3 is genuinely the last thing they ever hear.
--
-- Both are written only by the cron route under the service role. No RLS
-- policies are defined, which denies every anon and authenticated client by
-- default — deliberate: an opt-out list is not something a logged-in user
-- should be able to enumerate or edit for anyone but themselves, and the
-- unsubscribe route handles that case server-side with a signed token.

-- ─── OPT-OUTS ───────────────────────────────────────────────────────────────

create table if not exists public.email_opt_outs (
  email         text        not null,
  -- Scoped, not global: opting out of our pitch must never silence a rent
  -- receipt or a lease document. Only non-transactional categories belong here.
  category      text        not null default 'landlord_activation',
  unsubscribed_at timestamptz not null default now(),
  -- 'email_link' when they clicked unsubscribe, 'admin' when we did it for
  -- them, 'bounce' when the address is dead. Useful when someone asks why they
  -- stopped hearing from us.
  source        text        not null default 'email_link',
  primary key (email, category)
);

comment on table public.email_opt_outs is
  'Addresses that have opted out of a non-transactional email category. Checked before every activation send.';
comment on column public.email_opt_outs.category is
  'Which category was declined. Scoped so an opt-out never suppresses transactional mail.';

alter table public.email_opt_outs enable row level security;

-- ─── SEND LOG ───────────────────────────────────────────────────────────────

create table if not exists public.landlord_activation_sends (
  id            uuid        primary key default gen_random_uuid(),
  landlord_id   uuid        not null references auth.users (id) on delete cascade,
  -- Which conversation this is. 'no_property' = signed up, never added a place.
  -- 'dormant_listing' = the listing exists but no plan keeps it off the site.
  -- They are different emails because they are different problems.
  kind          text        not null,
  -- 1, 2, 3. The sequence stops after the last one, for good.
  step          integer     not null,
  email         text        not null,
  subject       text,
  sent_at       timestamptz not null default now(),
  constraint landlord_activation_sends_kind_check
    check (kind in ('no_property', 'dormant_listing')),
  constraint landlord_activation_sends_step_check
    check (step between 1 and 3),
  -- The claim. Two cron runs in the same minute cannot both send step 2.
  constraint landlord_activation_sends_once
    unique (landlord_id, kind, step)
);

comment on table public.landlord_activation_sends is
  'One row per activation email sent. The unique (landlord_id, kind, step) constraint is what makes the sequence send-once.';

create index if not exists landlord_activation_sends_landlord_idx
  on public.landlord_activation_sends (landlord_id, sent_at desc);

alter table public.landlord_activation_sends enable row level security;
