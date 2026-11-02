-- Automatic lead follow-ups: the send log that makes them send once.
--
-- Two days after someone inquires, we email them once. That email is not
-- transactional — nothing the recipient just did triggers it — so it carries
-- the same two obligations the landlord activation sequence carries: a way out,
-- and a guarantee it cannot arrive twice.
--
--   • The way out is `email_opt_outs`, already built for FIN-26. This migration
--     adds no table for it on purpose: the category column is free text, so
--     `lead_followup` needs nothing but the app checking for it. Reusing one
--     opt-out list means an address that has told us to stop is stopped
--     everywhere non-transactional, not just in the campaign it clicked from.
--
--   • The guarantee is this table. One row per (lead, kind) with a unique
--     constraint, so the claim is the database's decision and not the cron's.
--     A run that dies half way through re-sends nothing when it is retried,
--     and two overlapping runs cannot both mail the same lead.
--
-- `kind` is the funnel state the follow-up spoke to, not a step number. There
-- is no sequence here — a lead hears from us at most once per kind, ever:
--
--   'prescreen'    — they inquired and never filled the pre-screen in. The
--                    welcome email's ask, asked once more.
--   'tour_booking' — they pre-screened, the landlord invited them to tour, and
--                    they never picked a slot. Only ever sent when slots are
--                    genuinely open, so the link cannot land on a dead end.
--
-- Deliberately not a kind: "pre-screened but never invited to tour". That gate
-- belongs to the landlord, and an automated email cannot extend an invitation
-- on their behalf. The Next Best Action engine prompts them for it instead.

create table if not exists public.lead_followup_sends (
  id         uuid        primary key default gen_random_uuid(),
  lead_id    uuid        not null references public.leads (id) on delete cascade,
  kind       text        not null,
  -- Stored lowercased, because the per-address cooldown and the opt-out list
  -- both compare addresses case-insensitively and a mixed-case duplicate would
  -- defeat both.
  email      text        not null,
  subject    text,
  sent_at    timestamptz not null default now(),
  constraint lead_followup_sends_kind_check
    check (kind in ('prescreen', 'tour_booking')),
  -- The claim. This single line is what makes the feature safe to re-run.
  constraint lead_followup_sends_once
    unique (lead_id, kind)
);

comment on table public.lead_followup_sends is
  'One row per automatic lead follow-up sent. The unique (lead_id, kind) constraint is what makes each follow-up send once.';
comment on column public.lead_followup_sends.kind is
  'Which funnel gap the email spoke to: prescreen (never pre-screened) or tour_booking (invited, never booked). Not a sequence step.';

-- The cooldown lookup: "has this address heard from us lately?", asked once per
-- run for every candidate address. Lowercased to match how the column is
-- written, so the index is actually usable by that query.
create index if not exists lead_followup_sends_email_idx
  on public.lead_followup_sends (lower(email), sent_at desc);

-- And the per-lead lookup, for the claim check and for reading a lead's history.
create index if not exists lead_followup_sends_lead_idx
  on public.lead_followup_sends (lead_id, sent_at desc);

alter table public.lead_followup_sends enable row level security;

-- Written and read only by the cron route under the service role, so that is
-- the only grant. RLS is on with no policies, which denies anon and
-- authenticated regardless — but the grant is the real gate, since PostgREST
-- refuses an ungranted table before RLS is ever consulted. Stated explicitly
-- rather than left to default privileges: every table in this schema declares
-- its grants in the migration that creates it, including the ones whose answer
-- is "nobody but the server".
grant all on public.lead_followup_sends to service_role;
