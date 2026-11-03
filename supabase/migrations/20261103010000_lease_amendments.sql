-- Lease amendments: one signed change to a running tenancy.
--
-- The portal could create a lease and it could renew a lease. It could not
-- change one. So every mid-term change — a pet arrives, a parking space is
-- added, a roommate takes a different room — happened in a text message, and
-- the lease stayed silent about it. Nine months later nobody can say what was
-- agreed, which in this market usually surfaces as an argument about a deposit.
--
-- One row = one change agreement on one lease, sent to one named tenant.
--
-- Why that shape, and not a column on `leases`:
--
--   • The lease is the record of what was signed in August. Writing the pet
--     rent onto it would destroy that, and Financials would then be unable to
--     say what was owed before the change. Same reason an accepted renewal
--     becomes a *new* lease instead of editing the old one — see
--     20261102040000_lease_renewals.sql.
--   • An amendment may be declined or withdrawn, at which point the lease it
--     refers to is still exactly valid. A column cannot be declined.
--   • It is addressed to a person, not to a tenancy. A six-bedroom student
--     house has six tenants on one lease, and a pet belongs to one of them.
--     `lease_tenant_id` says whose signature is being asked for, and whose
--     ledger the charge later lands on.
--
-- `status` is only the four things somebody *did*:
--
--   sent      — out with the tenant, waiting
--   signed    — the tenant signed it; it is part of the tenancy
--   declined  — the tenant said no
--   withdrawn — the landlord pulled it before it was answered
--
-- No `active`, no `expired`, no `ended`. Whether a signed amendment has reached
-- its effective date is arithmetic that changes with no code running, so
-- `amendmentPhase()` in src/lib/leaseAmendments.ts derives it. The project has
-- already paid for the alternative once: `late_fees_applied` was a stored flag
-- that drifted from the facts and every reader that trusted it was wrong.

create table if not exists public.lease_amendments (
  id                   uuid        primary key default gen_random_uuid(),
  lease_id             uuid        not null references public.leases (id) on delete cascade,

  -- Denormalised from the lease so the landlord's list query and the RLS
  -- policy do not have to join, and so the amendment survives in reports if
  -- the property is later renamed. The route copies both from the lease it
  -- verified against the caller.
  owner_id             uuid        not null references public.profiles (id) on delete cascade,
  property_id          uuid        references public.properties (id) on delete set null,

  /**
   * Whose signature this asks for.
   *
   * `on delete set null`, not cascade: if the landlord later removes someone
   * from the lease, the amendment they signed is still the record of what was
   * agreed and must not vanish with the row. The names and the email are
   * snapshotted below for exactly that case.
   */
  lease_tenant_id      uuid        references public.lease_tenants (id) on delete set null,

  kind                 text        not null,
  /** The document's own title, e.g. "Change of Lease Agreement — Pet Addition". */
  title                text        not null,
  /** When the change takes effect. Never the same thing as when it was signed. */
  effective_date       date        not null,

  -- The money the amendment adds, in whole dollars to match `leases.rent_amount`
  -- and `lease_renewals.new_rent` exactly. A charge that round-trips through a
  -- different money type is a charge that eventually disagrees with the lease.
  --
  -- This column is the *agreed* figure, and it is not a bill. Nothing in this
  -- table charges anybody: the landlord adds a `payment_line_items` row against
  -- the right payer, and `billed_at` records that they did. Creating a charge as
  -- a side effect of a tenant's own signature — on a shared lease, against a
  -- payer the server had to guess — is a surprise this product cannot afford.
  monthly_charge       integer     not null default 0,
  monthly_charge_label text,

  /**
   * The contract itself, frozen.
   *
   * This is the point of the whole table. The document is built once, at send
   * time, by `buildPetAdditionDocument()`, and this column stores the result
   * whole — including the property address, both party names and the lease term
   * it amends. Every later read renders *this*, and never rebuilds from the
   * current state of the lease.
   *
   * The alternative is subtly catastrophic: a signing page that re-renders the
   * document from `properties.name` and `leases.rent_amount` on each load means
   * renaming the property in March changes the wording of a contract signed in
   * November. A signed document that can change is not a signed document.
   */
  document             jsonb       not null,

  status               text        not null default 'sent',

  -- Who it went to, snapshotted at send time, because `lease_tenants` can be
  -- edited or deleted and an amendment must always be able to say who signed.
  tenant_name          text,
  tenant_email         text        not null,

  /**
   * The link in the email.
   *
   * Unlike `lease_renewals.token`, this does *not* authenticate the signer. A
   * signature needs a signer, so the signing page is behind the normal tenant
   * login and the POST verifies that the signed-in user resolves to this
   * amendment's tenant. The token is only the deep link that survives the login
   * redirect, and a stable id for the landlord's own copy of the document.
   */
  token                uuid        not null default gen_random_uuid(),

  sent_at              timestamptz not null default now(),

  -- ── The signature ─────────────────────────────────────────────────────────
  --
  -- Flat columns rather than a jsonb blob, because these are the fields that
  -- get asked about one at a time in a dispute ("when did she sign it?") and
  -- the ones worth indexing. Written together in a single update, and only
  -- when status moves to 'signed' — the check constraint below enforces that
  -- there is no such thing as a signed row with no name on it.
  signed_at            timestamptz,
  /** The name the tenant typed. This is the signature. */
  signature_name       text,
  /** The date they chose. The API accepts only today, in America/Phoenix. */
  signature_date       date,
  signature_ip         text,
  signature_user_agent text,
  /** The account that signed, for the audit trail. */
  signed_by_user_id    uuid        references public.profiles (id) on delete set null,

  declined_at          timestamptz,
  decline_reason       text,

  /**
   * When the landlord put the agreed charge on the tenant's ledger.
   *
   * Null on a signed amendment with a charge means real money is going
   * uncollected, which is why `nextAction()` surfaces it as the landlord's one
   * outstanding task rather than letting it sit quietly.
   */
  billed_at            timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint lease_amendments_kind_check
    check (kind in ('pet_addition', 'other')),
  constraint lease_amendments_status_check
    check (status in ('sent', 'signed', 'declined', 'withdrawn')),
  constraint lease_amendments_charge_check
    check (monthly_charge >= 0),
  constraint lease_amendments_token_unique
    unique (token),

  -- A signed row carries a signature, and an unsigned row does not pretend to.
  --
  -- Worth a constraint rather than trust in one route: "status = signed" is
  -- what the landlord's list, the tenant's page and any future export all key
  -- off, and a signed row with a null `signature_name` would render a contract
  -- with a blank signature line while reporting itself as executed.
  constraint lease_amendments_signature_complete
    check (
      (status = 'signed' and signed_at is not null
                         and signature_name is not null
                         and signature_date is not null)
      or
      (status <> 'signed' and signed_at is null
                          and signature_name is null
                          and signature_date is null)
    ),
  constraint lease_amendments_declined_shape
    check ((status = 'declined') = (declined_at is not null)),
  -- Nothing is billable until it is signed.
  constraint lease_amendments_billed_only_when_signed
    check (billed_at is null or status = 'signed')
);

comment on table public.lease_amendments is
  'One signed change to a running lease, addressed to one tenant. The lease is never edited; `document` is the contract frozen at send time and re-rendered by nobody.';
comment on column public.lease_amendments.document is
  'The whole contract as built at send time, including party names and the lease term. Read as-is forever — rebuilding it from current lease/property rows would let a later rename change a signed document.';
comment on column public.lease_amendments.monthly_charge is
  'The agreed monthly amount in whole dollars. NOT a bill: the landlord adds a payment_line_items row and billed_at records it. Signing never charges anybody.';
comment on column public.lease_amendments.token is
  'The deep link in the email. Does NOT authenticate the signer — the signing page is behind the tenant login and the POST re-verifies identity.';
comment on column public.lease_amendments.status is
  'Only what somebody did: sent, signed, declined, withdrawn. Whether a signed amendment has reached its effective date is derived by amendmentPhase().';

-- At most one unanswered amendment per tenant at a time.
--
-- A constraint and not a check in the route, because two live amendments on one
-- person means two documents they could sign in either order, and the product
-- has no way to say which won. A landlord changing their mind withdraws and
-- re-sends; the withdrawn row stays as history. Scoped to the tenant rather
-- than the lease on purpose — six housemates may each have their own pending
-- change, and that is normal.
create unique index if not exists lease_amendments_one_live_per_tenant
  on public.lease_amendments (lease_id, lease_tenant_id)
  where status = 'sent' and lease_tenant_id is not null;

-- The landlord's list.
create index if not exists lease_amendments_owner_idx
  on public.lease_amendments (owner_id, sent_at desc);

-- The lease hub's Amendments tab.
create index if not exists lease_amendments_lease_idx
  on public.lease_amendments (lease_id, sent_at desc);

-- The tenant's own list, matched by the address the document was sent to.
create index if not exists lease_amendments_tenant_email_idx
  on public.lease_amendments (lower(tenant_email), sent_at desc);

-- Signed and agreed, but not yet on anybody's ledger: the uncollected-money
-- query, and the only partial index here that exists for a *report* rather than
-- a page.
create index if not exists lease_amendments_unbilled_idx
  on public.lease_amendments (owner_id, effective_date)
  where status = 'signed' and billed_at is null and monthly_charge > 0;

alter table public.lease_amendments enable row level security;

-- A landlord reads their own amendments. Everything else — sending, signing,
-- withdrawing — goes through the API under the service role.
--
-- Select only, and for the same reason as renewals: creating the row and
-- emailing the tenant are one action with two halves, and a row saying "sent"
-- that the tenant never received is worse than no row, because the landlord
-- stops chasing. And a signature in particular must be written by something
-- that can also record the IP, the user agent and the account behind it; a
-- client-side update could not be trusted to.
drop policy if exists "owner_select" on public.lease_amendments;
create policy "owner_select"
  on public.lease_amendments for select
  using (owner_id = auth.uid());

-- Grants, in the same migration that creates the table — Supabase stopped
-- auto-granting on 30 Oct 2026 and an ungranted table answers `permission
-- denied` however permissive its RLS is.
--
-- Narrower than the schema's usual trio on purpose, and `npm run verify:grants`
-- reports rather than fails that:
--   • no `anon`: a logged-out visitor has no business reading a contract
--     between two named people. The tenant's path is a logged-in page.
--   • `select` only for `authenticated`: see the policy note above.
--
-- The revokes are not redundant. This project's default privileges still hand
-- every new table in `public` to anon and authenticated with all seven
-- privileges, which is exactly what happened to both renewal tables, so a bare
-- `grant` would leave the outer gate wider than these lines claim. PostgREST
-- consults the grant before RLS is ever reached, so it should say what we mean.
revoke all on public.lease_amendments from anon;
revoke all on public.lease_amendments from authenticated;
grant select on public.lease_amendments to authenticated;
grant all on public.lease_amendments to service_role;

-- ── The send log ────────────────────────────────────────────────────────────
--
-- Every email about one amendment, in order.
--
-- A `lease_amendments` row can say when it was sent and when it was signed. It
-- cannot answer the question a landlord actually asks, which is "has she been
-- reminded, and how many times". That is the whole difference between a feature
-- that is trackable and one that merely stores a result: the chase is the part
-- that takes the effort, and if the product does not record it the landlord
-- keeps the count in their head and either nags or forgets.
--
-- Append-only. One row per email that left the building, written after the send
-- succeeded, so a row here means Resend accepted it.

create table if not exists public.lease_amendment_sends (
  id            uuid        primary key default gen_random_uuid(),
  amendment_id  uuid        not null references public.lease_amendments (id) on delete cascade,
  owner_id      uuid        not null references public.profiles (id) on delete cascade,
  /**
   * request  — the original "please sign this"
   * reminder — a nudge, sent by the landlord, any number of times
   * signed   — the receipt, to the tenant, with the executed document
   * landlord — the notification to the landlord that it was signed or declined
   */
  kind          text        not null,
  recipient     text        not null,
  subject       text,
  sent_at       timestamptz not null default now(),
  constraint lease_amendment_sends_kind_check
    check (kind in ('request', 'reminder', 'signed', 'landlord'))
);

comment on table public.lease_amendment_sends is
  'Append-only log of every email about one amendment. Exists so the landlord can see whether, and how often, a tenant has been chased — the part a status column cannot answer.';

create index if not exists lease_amendment_sends_amendment_idx
  on public.lease_amendment_sends (amendment_id, sent_at desc);

alter table public.lease_amendment_sends enable row level security;

-- Read by the landlord on the amendments tab; written only by the API.
drop policy if exists "owner_select" on public.lease_amendment_sends;
create policy "owner_select"
  on public.lease_amendment_sends for select
  using (owner_id = auth.uid());

revoke all on public.lease_amendment_sends from anon;
revoke all on public.lease_amendment_sends from authenticated;
grant select on public.lease_amendment_sends to authenticated;
grant all on public.lease_amendment_sends to service_role;

-- ── updated_at ──────────────────────────────────────────────────────────────
--
-- Set in the routes too, but a trigger as well: `updated_at` is the column a
-- future export or sync will trust to find what changed, and a single UPDATE
-- written by hand somewhere that forgets it would make that export silently
-- incomplete.

create or replace function public.touch_lease_amendment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lease_amendments_touch on public.lease_amendments;
create trigger lease_amendments_touch
  before update on public.lease_amendments
  for each row execute function public.touch_lease_amendment();
