-- Lease renewals: the offer, and the tenant's answer to it.
--
-- Student housing is the one rental market where every lease ends in the same
-- six weeks. Until now the portal counted those leases on the Overview tile
-- ("3 expiring within 60 days") and then did nothing with them at all: no
-- offer, no record of asking, no idea whether the tenant intends to stay. The
-- landlord's entire next year was decided in a gap in the product.
--
-- One row = one offer on one lease. That shape matters more than it looks:
--
--   • A renewal is not a column on `leases`. It is a negotiation with its own
--     terms, its own deadline and its own answer, and it may be declined — at
--     which point the lease it refers to is still perfectly valid and running
--     to its original end date. Writing the proposed rent onto the lease would
--     corrupt the live tenancy with a term nobody agreed to.
--   • An accepted renewal becomes a *new* lease, pointed at by
--     `renewal_lease_id`. The old one is left exactly as it was signed. That
--     keeps the rent history honest — Financials can still say what was owed
--     last March — and it is the only way a landlord can later answer "what
--     did they used to pay".
--
-- `status` is deliberately only the four things somebody *did*:
--
--   sent      — the offer is out and waiting
--   accepted  — the tenant said yes
--   declined  — the tenant said no
--   withdrawn — the landlord pulled it
--
-- "Expired" is not in that list, and must never be. An offer whose respond-by
-- date has passed is expired by arithmetic, the moment it passes, whether or
-- not any code was running to notice. A fifth status would need a cron to stay
-- true and would be wrong in between — the same trap `late_fees_applied` fell
-- into, where a stored boolean drifted from the facts and every reader that
-- trusted it was wrong. `renewalState()` in src/lib/renewals.ts derives it.
--
-- The tenant answers without logging in. They are often not a HomeHive user at
-- all — `lease_tenants` rows carry a name and an email and frequently no
-- `tenant_id` — and putting an account between a landlord and a signed renewal
-- would lose renewals to forgotten passwords. So the row carries an
-- unguessable token, and /renewal/[token] reads it through the service role,
-- exactly as the move-out report at /checkout-report/[token] already does.

create table if not exists public.lease_renewals (
  id                  uuid        primary key default gen_random_uuid(),
  lease_id            uuid        not null references public.leases (id) on delete cascade,
  -- Denormalised from the lease so the pipeline query and the RLS policy do
  -- not have to join, and so a renewal survives in reports if the property is
  -- later renamed. The route copies both from the lease it verified.
  owner_id            uuid        not null references public.profiles (id) on delete cascade,
  property_id         uuid        references public.properties (id) on delete set null,

  -- The offer. Dollars, integer, to match `leases.rent_amount` exactly: a
  -- renewal that round-trips through a different money type is a renewal that
  -- eventually disagrees with the lease it replaces.
  new_rent            integer     not null,
  new_start_date      date        not null,
  new_end_date        date        not null,
  /** The date the offer stops being open. Expiry is derived from this. */
  respond_by          date        not null,
  /** The landlord's own words. Shown to the tenant above the terms. */
  message             text,

  status              text        not null default 'sent',

  -- Who it went to, snapshotted at send time. `lease_tenants` can be edited or
  -- deleted later, and a renewal must always be able to say who was asked.
  tenant_name         text,
  tenant_email        text        not null,

  /** The tenant's door in. Unguessable, single-purpose, no login. */
  token               uuid        not null default gen_random_uuid(),

  sent_at             timestamptz not null default now(),
  responded_at        timestamptz,
  /** Free text from the tenant with their answer — kept verbatim. */
  response_note       text,
  /** Set when the accepted renewal has been turned into a real lease. */
  renewal_lease_id    uuid        references public.leases (id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint lease_renewals_status_check
    check (status in ('sent', 'accepted', 'declined', 'withdrawn')),
  constraint lease_renewals_term_check
    check (new_end_date > new_start_date),
  constraint lease_renewals_rent_check
    check (new_rent >= 0),
  constraint lease_renewals_token_unique
    unique (token)
);

comment on table public.lease_renewals is
  'One renewal offer on one lease. An accepted offer becomes a new lease (renewal_lease_id); the original lease is never edited. Expiry is derived from respond_by, never stored.';
comment on column public.lease_renewals.status is
  'Only what somebody did: sent, accepted, declined, withdrawn. "Expired" is derived from respond_by by renewalState() — a stored expiry would be wrong between cron runs.';
comment on column public.lease_renewals.token is
  'The tenant''s unguessable link to /renewal/[token]. Tenants often have no account, so there is no login in this path.';
comment on column public.lease_renewals.renewal_lease_id is
  'The new lease created from an accepted offer. Null until the landlord converts it.';

-- At most one offer in flight per lease.
--
-- This is the integrity rule the whole feature rests on, which is why it is a
-- constraint and not a check in the route. Two live offers on one tenancy means
-- two different rents the tenant could accept, and the second acceptance would
-- silently overwrite the first. A landlord who wants to change their terms
-- withdraws and re-sends; the withdrawn row stays as history.
create unique index if not exists lease_renewals_one_live
  on public.lease_renewals (lease_id)
  where status = 'sent';

-- The pipeline read: a landlord's renewals, newest first.
create index if not exists lease_renewals_owner_idx
  on public.lease_renewals (owner_id, sent_at desc);

-- And the per-lease lookup, for the lease detail page.
create index if not exists lease_renewals_lease_idx
  on public.lease_renewals (lease_id, sent_at desc);

alter table public.lease_renewals enable row level security;

-- A landlord reads their own renewals. Writes go through /api/renewals under
-- the service role so that sending an offer and emailing the tenant cannot
-- come apart: an offer the tenant was never told about is worse than no offer,
-- because the landlord believes they have asked. Hence select only.
drop policy if exists "owner_select" on public.lease_renewals;
create policy "owner_select"
  on public.lease_renewals for select
  using (owner_id = auth.uid());

-- Grants, in the same migration that creates the table — Supabase stopped
-- auto-granting on 30 Oct 2026 and an ungranted table answers `permission
-- denied` however permissive its RLS is.
--
-- Narrower than the schema's usual `anon, authenticated, service_role` on
-- purpose, and the grants check reports rather than fails that:
--   • no `anon`: the tenant's path is the token page, which reads through the
--     service role. A logged-out visitor has no business listing renewals.
--   • `select` only for `authenticated`: see the policy note above.
grant select on public.lease_renewals to authenticated;
grant all on public.lease_renewals to service_role;

-- ── The nudge log ───────────────────────────────────────────────────────────
--
-- The renewal window is only worth anything if somebody notices it opening,
-- and the landlords who most need telling are exactly the ones not logging in
-- weekly. So a weekly cron mails them — which raises the only hard question
-- about that kind of email: how do you guarantee it goes once?
--
-- The same way `lead_followup_sends` does. One row per (lease, kind) with a
-- unique constraint, so the claim is the database's decision and not the
-- cron's. A run that dies half way through re-sends nothing on retry, and two
-- overlapping runs cannot both mail the same landlord about the same lease.
--
-- Two kinds, and deliberately no sequence:
--
--   'window_open' — the lease crossed into the 120-day window with no offer
--                   sent. The one email early enough to change the outcome.
--   'urgent'      — it crossed 45 days and *still* has no answer. A different
--                   email making a different point: by this stage the renters
--                   who plan ahead have signed elsewhere, so it is about the
--                   vacancy rather than about the renewal.
--
-- A landlord hears about any one lease at most twice, ever. Anything more
-- frequent is a product nagging about a decision it cannot make, and it gets
-- filtered — taking the rent reminders with it.

create table if not exists public.lease_renewal_nudges (
  id         uuid        primary key default gen_random_uuid(),
  lease_id   uuid        not null references public.leases (id) on delete cascade,
  owner_id   uuid        not null references public.profiles (id) on delete cascade,
  kind       text        not null,
  email      text        not null,
  subject    text,
  sent_at    timestamptz not null default now(),
  constraint lease_renewal_nudges_kind_check
    check (kind in ('window_open', 'urgent')),
  -- The claim. This one line is what makes the cron safe to re-run.
  constraint lease_renewal_nudges_once
    unique (lease_id, kind)
);

comment on table public.lease_renewal_nudges is
  'One row per renewal-window nudge sent to a landlord. Unique (lease_id, kind) is what makes each nudge send once, ever.';

create index if not exists lease_renewal_nudges_owner_idx
  on public.lease_renewal_nudges (owner_id, sent_at desc);

alter table public.lease_renewal_nudges enable row level security;

-- Written and read only by the cron under the service role, so that is the
-- only grant. Stated explicitly rather than left to default privileges: every
-- table in this schema declares its grants in the migration that creates it,
-- including the ones whose answer is "nobody but the server".
grant all on public.lease_renewal_nudges to service_role;

-- ── A note on what the live database actually did ───────────────────────────
--
-- The grants above are additive, and this project's *default* privileges still
-- hand every new table in `public` to anon and authenticated. So both tables
-- arrived wider than the lines above ask for: `anon` and `authenticated` held
-- all seven privileges on each.
--
-- RLS denied those writes regardless — `lease_renewals` has a select-only
-- owner policy and `lease_renewal_nudges` has no policy at all — but the grant
-- is the outer gate and PostgREST consults it before RLS is ever reached, so
-- it should say what we mean rather than relying on the inner one. Hence the
-- explicit revokes. Applied as the `lease_renewals_tighten_grants` migration
-- on 3 Nov 2026; kept here so a fresh database ends up in the same state as
-- production rather than the permissive one.
revoke all on public.lease_renewals from anon;
revoke all on public.lease_renewals from authenticated;
grant select on public.lease_renewals to authenticated;

revoke all on public.lease_renewal_nudges from anon;
revoke all on public.lease_renewal_nudges from authenticated;
