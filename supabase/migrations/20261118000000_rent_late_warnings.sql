-- The first formal warning about late rent — and who it went to.
--
-- ── Why a table, when `payment_emails` already records every send ───────────
--
-- Because a warning is not an email. It is a *step in an escalation*, and the
-- step is the thing a landlord, a co-signer and eventually a court all reason
-- about: "this is the first notice, sent on the 4th, for November's rent and
-- the $60 fee on it". The emails are how that notice was delivered — one to the
-- resident, one to each co-signer who guaranteed the lease — and there may be
-- two of them, or four, or one that bounced and one that was opened. Storing
-- only the sends leaves nobody able to answer "has she been warned yet?"
-- without reading subject lines and guessing.
--
-- So the warning is a row, the sends stay in `payment_emails` (which already
-- carries the whole delivery lifecycle from the Resend webhook), and
-- `payment_emails.late_warning_id` joins them. Nothing is duplicated: what the
-- warning *covered* is the `payment_email_items` of its sends, recorded as the
-- recipient was shown them.
--
-- `level` exists because "warning #1" only means something inside a sequence.
-- Only level 1 is sendable from the UI today; the column is here so that the
-- second and final notices land as more rows rather than as a second table.
--
-- The money columns are a *snapshot*, deliberately denormalised. A notice is a
-- statement about a moment: it said $930.66 was owed as of 18 November, and
-- that stays true after the tenant pays. Recomputing it later would rewrite
-- history, which is the one thing a warning trail must never do.

create table if not exists public.rent_late_warnings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The person warned. Nullable only so a warning survives a tenant record
  -- being deleted — the trail is the point of the table.
  tenant_id uuid references public.tenants (id) on delete set null,
  plan_id uuid references public.payment_plans (id) on delete set null,
  plan_tenant_id uuid references public.payment_plan_tenants (id) on delete set null,
  lease_id uuid references public.leases (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,

  -- 1 = first notice. See the note above.
  level smallint not null default 1 check (level between 1 and 3),

  -- The billing day the figures were judged against, in America/Phoenix
  -- (`billingToday`). Never the server's date: rent due on the 1st is not late
  -- until the 2nd *where the property is*, and a UTC date makes it late at 5pm
  -- on the 1st.
  as_of date not null,

  -- The snapshot. Rent + late fees = total, held apart because a tenant who
  -- disputes a fee is not disputing the rent.
  rent_due numeric(10,2) not null default 0 check (rent_due >= 0),
  late_fee_due numeric(10,2) not null default 0 check (late_fee_due >= 0),
  total_due numeric(10,2) not null default 0 check (total_due >= 0),
  -- Whole days past the due date of the oldest unpaid charge it covered. What
  -- "how late were they when we warned them" means.
  days_late integer not null default 0 check (days_late >= 0),

  -- The landlord's own words, as the recipients read them.
  note text,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- "Has this tenant been warned, and when was the last one?" — the only
-- question the tenant page asks of this table.
create index if not exists rent_late_warnings_tenant_idx
  on public.rent_late_warnings (tenant_id, created_at desc);
create index if not exists rent_late_warnings_owner_idx
  on public.rent_late_warnings (owner_id, created_at desc);

comment on table public.rent_late_warnings is
  'One formal late-rent notice. Its sends (resident + co-signers) are the payment_emails rows pointing back at it via late_warning_id; the money columns are a snapshot of the moment it was sent and must never be recomputed.';

-- ── The sends ────────────────────────────────────────────────────────────────

alter table public.payment_emails
  add column if not exists late_warning_id uuid
    references public.rent_late_warnings (id) on delete set null;

create index if not exists payment_emails_late_warning_idx
  on public.payment_emails (late_warning_id)
  where late_warning_id is not null;

-- A co-signer is a fourth audience, and counting their copy as the tenant's
-- would make "we told her twice" out of one notice sent to two people. The
-- existing three are untouched.
alter table public.payment_emails drop constraint if exists payment_emails_audience_check;
alter table public.payment_emails
  add constraint payment_emails_audience_check
  check (audience = any (array['tenant'::text, 'cosigner'::text, 'landlord'::text, 'admin'::text]));

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Owner-reads-own. Writes happen in `/api/landlord/tenants/[tenantId]/late-warning`
-- through the service role, because the same request also has to read the
-- co-signers off `background_checks` and send mail; there is no path by which a
-- landlord's browser should be inserting its own warning rows.
alter table public.rent_late_warnings enable row level security;

drop policy if exists "Owners read own late warnings" on public.rent_late_warnings;
create policy "Owners read own late warnings"
  on public.rent_late_warnings for select
  using (owner_id = auth.uid());

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Required in the same migration that creates the table: Supabase stopped
-- auto-granting new tables on 30 Oct 2026, and an ungranted table answers
-- `permission denied` to supabase-js however permissive its RLS is.
--
-- Deliberately narrow, and `npm run verify:grants` reports it as such rather
-- than failing it. No `anon`: a logged-out visitor must never read who is
-- behind on their rent. `select` only for `authenticated`, because the writes
-- are the service role's — see the RLS note.
grant select on public.rent_late_warnings to authenticated;
grant all on public.rent_late_warnings to service_role;

-- ── Sign-in activity, without exposing auth.users ────────────────────────────
--
-- The tenant page answers "can this person even pay online?" — and the honest
-- answer is often "they have never signed in", or "there is no account on this
-- address at all", which is why a tenant who looks like they are ignoring
-- every payment link is in fact locked out of the portal. That fact lives in
-- `auth.users`, which PostgREST does not expose and should not.
--
-- So: one function, returning only the three timestamps the page shows, and
-- executable by the service role alone. The API route that calls it has already
-- proven the caller owns the tenant record. Granting this to `authenticated`
-- would turn it into an oracle for "does this person have an account here",
-- which is exactly what it must not be.
create or replace function public.auth_activity_for_email(p_email text)
returns table (
  user_id uuid,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.created_at, u.last_sign_in_at, u.email_confirmed_at
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.last_sign_in_at desc nulls last
  limit 1
$$;

revoke all on function public.auth_activity_for_email(text) from public;
revoke all on function public.auth_activity_for_email(text) from anon, authenticated;
grant execute on function public.auth_activity_for_email(text) to service_role;

comment on function public.auth_activity_for_email(text) is
  'Sign-in timestamps for one email address. Service-role only: it is an account-existence oracle for anyone else.';
