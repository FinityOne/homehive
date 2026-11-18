-- The weekly maintenance digest: what was sent, and to whom.
--
-- The digest itself is derived — every number in it is recomputed from
-- `property_work_items` on each run, so nothing about the *content* needs
-- storing. This table exists for the one thing that cannot be derived: whether
-- the mail already went out.
--
-- A weekly summary has exactly one bad failure mode, which is arriving twice.
-- `(landlord_id, week_start)` carries a unique index for the scheduled run, so
-- the claim is the database's job rather than the route's: a Friday cron that
-- retries after a partial failure re-sends nothing, and two runs firing in the
-- same minute cannot both win.
--
-- A manual send (an admin pushing the digest out mid-week) is logged here too,
-- but deliberately *outside* that constraint — see the partial index below.
-- Blocking a manual send because the scheduled one already went this week
-- would make the manual tool useless in the exact moment it is reached for.

create table if not exists public.maintenance_digest_sends (
  id            uuid        primary key default gen_random_uuid(),
  landlord_id   uuid        not null references auth.users (id) on delete cascade,
  -- The Monday-independent week key: the Phoenix calendar date the digest was
  -- computed for. Stored as the date rather than a week number so a human
  -- reading this table can see when the mail landed without arithmetic.
  week_start    date        not null,
  -- 'weekly' = the Friday cron. 'manual' = someone sent it on purpose.
  kind          text        not null default 'weekly',
  email         text        not null,
  subject       text,
  -- Denormalised counts, purely so this log can answer "was that week quiet or
  -- was the job broken?" without replaying the digest against mutated rows.
  open_count    integer,
  overdue_count integer,
  sent_at       timestamptz not null default now(),
  constraint maintenance_digest_sends_kind_check
    check (kind in ('weekly', 'manual'))
);

comment on table public.maintenance_digest_sends is
  'One row per weekly maintenance digest sent. The partial unique index on (landlord_id, week_start) is what makes the scheduled send send-once.';
comment on column public.maintenance_digest_sends.kind is
  'weekly = the Friday cron, claimed once per landlord per week. manual = an on-demand send, intentionally not subject to that claim.';

-- The claim, for scheduled runs only. Partial, so a manual send never consumes
-- the week's slot and never collides with one that has.
create unique index if not exists maintenance_digest_sends_weekly_once
  on public.maintenance_digest_sends (landlord_id, week_start)
  where kind = 'weekly';

create index if not exists maintenance_digest_sends_landlord_idx
  on public.maintenance_digest_sends (landlord_id, sent_at desc);

alter table public.maintenance_digest_sends enable row level security;

-- Written and read only by the cron route under the service role, so that is
-- the only grant — deliberately narrower than the schema default. A landlord
-- has no reason to query their own send log (the digest is in their inbox),
-- and a logged-out visitor must never enumerate landlord addresses, which is
-- what the `email` column here is. RLS is on with no policies, which denies
-- anon and authenticated regardless, but the grant is the real gate: PostgREST
-- refuses an ungranted table before RLS is ever consulted. Stated explicitly
-- because every table in `public` declares its grants in the migration that
-- creates it, including the ones whose answer is "nobody".
grant all on public.maintenance_digest_sends to service_role;
