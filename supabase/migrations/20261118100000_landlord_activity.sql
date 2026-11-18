-- The activity log: what has actually been happening with a landlord's
-- residents, in one reverse-chronological list.
--
-- Everything in here already existed somewhere. Rent lived in Financials,
-- failed attempts in `rent_payment_attempts`, correspondence in Reminders,
-- and whether a tenant had ever even signed in lived nowhere a landlord could
-- reach. The cost of that was not missing data, it was that a landlord had to
-- already suspect something before they could go and look. A log is the
-- opposite: it is read without a question in mind, and the question arrives
-- from the log.
--
-- ─── Why a table and not a view ──────────────────────────────────────────────
--
-- A union-all view over six tables would need no backfill and could never
-- drift. It was rejected for two reasons that both come from this being a
-- *feed*:
--
--   • Unread. "What is new since I last looked" needs a stable identity per
--     event, and a view's rows have none — they are recomputed, so an event
--     cannot be pointed at, linked to, or counted against a read mark with any
--     confidence that it is the same event next time.
--   • Truth at the time. A payment that is later voided, a plan that is later
--     renamed, a tenant later removed from a lease — a view rewrites history
--     every time it is read. A log says what happened, when it happened.
--
-- ─── Why a sync function and not triggers ────────────────────────────────────
--
-- Triggers on six tables is six places to forget, and a missed trigger is an
-- event that is gone forever. `sync_landlord_activity()` is one idempotent
-- function reading the same six sources, keyed on (source_table, source_id,
-- kind) so running it twice — or a hundred times — changes nothing. It is what
-- does the three-month backfill at the bottom of this file, and the API route
-- calls it over a short trailing window on each read, so the feed is current
-- without a single dual-write anywhere in the app.
--
-- Running it is cheap because it is bounded by `p_since`, not by table size.

-- ─── The log ─────────────────────────────────────────────────────────────────

create table if not exists public.landlord_activity (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references auth.users (id) on delete cascade,

  -- The vocabulary is closed on purpose: the page renders an icon, a colour
  -- and a verb per kind, and an unknown kind would render as a blank row.
  -- `src/lib/landlordActivity.ts` holds the matching list and
  -- `npm run verify:activity` fails if the two ever disagree.
  kind text not null check (kind in (
    'rent.paid',          -- a scheduled rent charge settled
    'charge.paid',        -- a deposit / utility / one-off charge settled
    'payment.submitted',  -- money sent, not yet cleared (ACH especially)
    'payment.failed',     -- the ONLY record of a failed payment, per
                          -- `rent_payment_attempts`
    'email.sent',         -- anything the platform emailed about this tenancy
    'tenant.login',       -- a resident asked for a sign-in code
    'tenant.signup'       -- a resident created their portal account
  )),

  -- When the thing happened — NOT when we recorded it. The backfill inserts
  -- three months of rows in one second; ordering by `created_at` would show a
  -- landlord their entire history as having happened at once.
  occurred_at timestamptz not null,

  title text not null,
  detail text,
  -- Where the full story lives. A feed that cannot be clicked through to the
  -- real record is a feed that gets read once.
  href text,

  -- Denormalised deliberately. The resident's name as it was *then*, so a
  -- tenant removed from a lease in December does not erase their October rent
  -- from the log.
  actor_name text,
  actor_email text,

  property_id uuid references public.properties (id) on delete set null,
  plan_id uuid references public.payment_plans (id) on delete set null,
  amount numeric(12,2),

  meta jsonb not null default '{}'::jsonb,

  -- The idempotency key. `source_id` is text rather than uuid because the
  -- sources are not all uuid-keyed (`auth_code_sends` is a bigint).
  source_table text not null,
  source_id text not null,

  created_at timestamptz not null default now(),

  constraint landlord_activity_source_uniq
    unique (landlord_id, source_table, source_id, kind)
);

-- The feed's only query.
create index if not exists landlord_activity_feed_idx
  on public.landlord_activity (landlord_id, occurred_at desc);

comment on table public.landlord_activity is
  'Append-only feed of resident activity per landlord. Written only by sync_landlord_activity().';

-- ─── The read mark ───────────────────────────────────────────────────────────
--
-- One timestamp per landlord, not an `is_read` flag per row.
--
-- The flag was the obvious design and it is wrong here for a reason specific
-- to a backfilled log: marking all read would have to write every row a
-- landlord has ever had, and the backfill itself would have to write a read
-- flag onto three months of history at insert time — so the sync function
-- would need to know about read state, which is exactly the coupling that
-- makes a log hard to extend. A watermark is one row, one write, and the sync
-- function never touches it.

create table if not exists public.landlord_activity_reads (
  landlord_id uuid primary key references auth.users (id) on delete cascade,
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now()
);

comment on table public.landlord_activity_reads is
  'Per-landlord watermark. Unread = landlord_activity rows with occurred_at > last_read_at.';

-- ─── Who counts as this landlord's resident ─────────────────────────────────
--
-- Three tables name the same people and none of them is authoritative:
-- `tenants` is the landlord's own directory, `lease_tenants` is who signed,
-- `payment_plan_tenants` is who pays. A resident may appear in one, two or all
-- three, and **the only thing that joins them is a lowercased email address** —
-- `payment_plan_tenants` has no `tenant_id` at all. That is the same rule the
-- tenant record page is built on; do not "fix" it with a name match, because
-- two housemates called Alex would then read as one person.
--
-- Not granted to `authenticated`. A plain view runs as its owner and would
-- therefore hand every landlord's resident list to any logged-in user — this
-- is read only by the service-role API route and by the function below.

create or replace view public.landlord_tenant_directory as
  select
    t.owner_id as landlord_id,
    lower(btrim(t.email)) as email,
    nullif(btrim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), '') as name
  from public.tenants t
  where coalesce(btrim(t.email), '') <> ''
  union
  select l.owner_id, lower(btrim(lt.email)), nullif(btrim(lt.name), '')
  from public.lease_tenants lt
  join public.leases l on l.id = lt.lease_id
  where coalesce(btrim(lt.email), '') <> ''
  union
  select pp.owner_id, lower(btrim(pt.email)), nullif(btrim(pt.name), '')
  from public.payment_plan_tenants pt
  join public.payment_plans pp on pp.id = pt.plan_id
  where coalesce(btrim(pt.email), '') <> '';

-- ─── The sync ────────────────────────────────────────────────────────────────

create or replace function public.sync_landlord_activity(
  p_since timestamptz default (now() - interval '3 months')
) returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_total integer := 0;
  v_n integer;
begin
  -- 1 ─ Rent settled.
  --
  -- `settled_at` is the moment the money was ours; `submitted_at` is when the
  -- tenant sent it. Either is a real event; `paid_date` is a Phoenix calendar
  -- day entered by hand, so it is cast in Phoenix rather than UTC — a payment
  -- recorded on the 1st must not sort into the 31st.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, plan_id, amount, meta,
    source_table, source_id
  )
  select
    pp.owner_id,
    'rent.paid',
    coalesce(sp.settled_at, sp.submitted_at,
             (sp.paid_date::timestamp at time zone 'America/Phoenix'), sp.updated_at),
    'Rent paid',
    to_char(sp.due_date, 'FMMonth YYYY') || ' rent'
      || coalesce(' · ' || nullif(sp.payment_method, ''), ''),
    '/landlord/financials?plan=' || pp.id,
    pt.name,
    lower(btrim(pt.email)),
    pp.property_id,
    pp.id,
    coalesce(sp.paid_amount, sp.amount),
    jsonb_build_object(
      'due_date', sp.due_date,
      'method', sp.payment_method,
      'late_fee_paid', sp.late_fee_paid,
      'plan', pp.name
    ),
    'scheduled_payments',
    sp.id::text
  from public.scheduled_payments sp
  join public.payment_plans pp on pp.id = sp.plan_id
  left join public.payment_plan_tenants pt on pt.id = sp.plan_tenant_id
  where sp.status = 'paid'
    and coalesce(sp.settled_at, sp.submitted_at,
                 (sp.paid_date::timestamp at time zone 'America/Phoenix'),
                 sp.updated_at) >= p_since
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 2 ─ Everything else that settled: deposits, utilities, one-offs.
  --
  -- A waived charge is deliberately not here. Waiving is the landlord's own
  -- action, and a feed of resident activity that reports the reader's own
  -- clicks back to them is noise.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, plan_id, amount, meta,
    source_table, source_id
  )
  select
    pp.owner_id,
    'charge.paid',
    coalesce(xp.settled_at, xp.submitted_at,
             (xp.paid_date::timestamp at time zone 'America/Phoenix'), xp.updated_at),
    coalesce(nullif(btrim(xp.label), ''),
             initcap(replace(xp.category, '_', ' '))) || ' paid',
    'Due ' || to_char(xp.due_date, 'FMMon FMDD, YYYY')
      || coalesce(' · ' || nullif(xp.payment_method, ''), ''),
    '/landlord/financials?plan=' || pp.id,
    pt.name,
    lower(btrim(pt.email)),
    pp.property_id,
    pp.id,
    xp.amount,
    jsonb_build_object('category', xp.category, 'due_date', xp.due_date, 'plan', pp.name),
    'special_payments',
    xp.id::text
  from public.special_payments xp
  join public.payment_plans pp on pp.id = xp.plan_id
  left join public.payment_plan_tenants pt on pt.id = xp.plan_tenant_id
  where xp.status = 'paid'
    and coalesce(xp.settled_at, xp.submitted_at,
                 (xp.paid_date::timestamp at time zone 'America/Phoenix'),
                 xp.updated_at) >= p_since
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 3 ─ Money sent, not yet landed.
  --
  -- This matters most for ACH, which takes days: between submitting and
  -- clearing, the charge still reads as unpaid everywhere else in the portal,
  -- and a landlord chasing a tenant who has already paid is the single most
  -- expensive mistake this log can prevent.
  --
  -- The attempt row does not name the payer — it carries the charge ids in
  -- `items` instead — so the resident is resolved back through those.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, plan_id, amount, meta,
    source_table, source_id
  )
  select
    pp.owner_id,
    'payment.submitted',
    a.submitted_at,
    'Payment submitted',
    coalesce(payer.label, 'Payment')
      || case when a.method = 'ach' then ' · bank transfer, clears in a few days'
              when a.method = 'card' then ' · card'
              else '' end,
    '/landlord/financials?plan=' || pp.id,
    payer.name,
    payer.email,
    pp.property_id,
    pp.id,
    a.amount,
    jsonb_build_object('method', a.method, 'status', a.status, 'plan', pp.name),
    'rent_payment_attempts',
    a.id::text
  from public.rent_payment_attempts a
  join public.payment_plans pp on pp.id = a.plan_id
  left join lateral (
    select
      max(pt.name) as name,
      max(lower(btrim(pt.email))) as email,
      string_agg(distinct i.item ->> 'label', ', ') as label
    from jsonb_array_elements(coalesce(a.items, '[]'::jsonb)) as i(item)
    left join public.scheduled_payments sp on sp.id = (i.item ->> 'id')::uuid
    left join public.payment_plan_tenants pt on pt.id = sp.plan_tenant_id
  ) payer on true
  where a.submitted_at is not null
    and a.submitted_at >= p_since
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 4 ─ Payments that failed.
  --
  -- Same source row as above, different kind, so both survive: a tenant whose
  -- card was declined on the 1st and who paid on the 3rd has two things that
  -- happened, not one row that changed its mind.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, plan_id, amount, meta,
    source_table, source_id
  )
  select
    pp.owner_id,
    'payment.failed',
    a.failed_at,
    'Payment failed',
    coalesce(nullif(btrim(a.failure_message), ''),
             nullif(btrim(a.failure_code), ''),
             'The payment did not go through') ,
    '/landlord/financials?plan=' || pp.id,
    payer.name,
    payer.email,
    pp.property_id,
    pp.id,
    a.amount,
    jsonb_build_object('method', a.method, 'code', a.failure_code, 'plan', pp.name),
    'rent_payment_attempts',
    a.id::text
  from public.rent_payment_attempts a
  join public.payment_plans pp on pp.id = a.plan_id
  left join lateral (
    select max(pt.name) as name, max(lower(btrim(pt.email))) as email
    from jsonb_array_elements(coalesce(a.items, '[]'::jsonb)) as i(item)
    left join public.scheduled_payments sp on sp.id = (i.item ->> 'id')::uuid
    left join public.payment_plan_tenants pt on pt.id = sp.plan_tenant_id
  ) payer on true
  where a.failed_at is not null
    and a.failed_at >= p_since
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 5 ─ Email the platform sent about this tenancy.
  --
  -- The outcome — delivered, opened, bounced, complained — arrives *later*, by
  -- webhook, so this is the one source that updates in place. Without the
  -- update a landlord reading the log in the morning would see "sent" forever
  -- on an address that started bouncing the same afternoon.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, plan_id, amount, meta,
    source_table, source_id
  )
  select
    pp.owner_id,
    'email.sent',
    pe.created_at,
    case pe.audience
      when 'landlord' then 'Email sent to you'
      when 'cosigner' then 'Email sent to a co-signer'
      else 'Email sent to tenant'
    end,
    pe.subject,
    '/landlord/reminders',
    pe.recipient_name,
    lower(btrim(pe.recipient_email)),
    pp.property_id,
    pp.id,
    pe.amount_total,
    jsonb_build_object(
      'email_kind', pe.kind,
      'audience', pe.audience,
      'trigger', pe.trigger,
      'outcome', case
        when pe.status = 'failed'      then 'failed'
        when pe.complained_at is not null then 'complained'
        when pe.bounced_at is not null then 'bounced'
        when pe.opened_at is not null  then 'opened'
        when pe.delivered_at is not null then 'delivered'
        else 'sent'
      end,
      'plan', pp.name
    ),
    'payment_emails',
    pe.id::text
  from public.payment_emails pe
  join public.payment_plans pp on pp.id = pe.plan_id
  where pe.created_at >= p_since
  on conflict on constraint landlord_activity_source_uniq do update
    set meta   = excluded.meta,
        detail = excluded.detail,
        title  = excluded.title;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 6 ─ Automatic rent reminders.
  --
  -- These leave no row in `payment_emails`; `rent_reminder_sends` is their
  -- only trace, which is precisely why they were invisible before.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, plan_id, meta,
    source_table, source_id
  )
  select
    pp.owner_id,
    'email.sent',
    rs.sent_at,
    'Rent reminder sent',
    initcap(replace(coalesce(rs.kind, 'reminder'), '_', ' ')) || ' · ' || rs.recipient_email,
    '/landlord/reminders',
    pt.name,
    lower(btrim(rs.recipient_email)),
    pp.property_id,
    pp.id,
    jsonb_build_object('email_kind', rs.kind, 'trigger', 'auto',
                       'outcome', 'sent', 'plan', pp.name),
    'rent_reminder_sends',
    rs.id::text
  from public.rent_reminder_sends rs
  left join public.scheduled_payments sp on sp.id = rs.scheduled_payment_id
  left join public.special_payments xp on xp.id = rs.special_payment_id
  join public.payment_plans pp on pp.id = coalesce(sp.plan_id, xp.plan_id)
  left join public.payment_plan_tenants pt
    on pt.id = coalesce(sp.plan_tenant_id, xp.plan_tenant_id)
  where rs.sent_at >= p_since
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 7 ─ Residents signing in.
  --
  -- Be precise about what this is. `auth_code_sends` records that a six-digit
  -- code was *emailed*, which is a resident trying to get in — it is not proof
  -- they got in. Supabase keeps only `last_sign_in_at`, a single point, so
  -- there is no confirmed sign-in *history* to read anywhere.
  --
  -- So each attempt is matched against that one point: a code sent within half
  -- an hour before the account's last recorded sign-in is the sign-in, and is
  -- titled as one. Every other attempt is reported honestly as a request. The
  -- alternative — calling all of them "signed in" — would tell a landlord
  -- their tenant is active when the tenant may be locked out, which is the
  -- exact opposite of the truth they need.
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail,
    href, actor_name, actor_email, meta, source_table, source_id
  )
  select distinct on (d.landlord_id, cs.id)
    d.landlord_id,
    case when cs.mode = 'signup' then 'tenant.signup' else 'tenant.login' end,
    cs.created_at,
    case
      when cs.mode = 'signup' then 'Resident created their account'
      when u.last_sign_in_at is not null
       and u.last_sign_in_at between cs.created_at and cs.created_at + interval '30 minutes'
        then 'Resident signed in'
      else 'Resident asked for a sign-in code'
    end,
    coalesce(d.email, cs.email),
    '/landlord/tenants',
    d.name,
    d.email,
    jsonb_build_object(
      'mode', cs.mode,
      'confirmed', (u.last_sign_in_at is not null
        and u.last_sign_in_at between cs.created_at and cs.created_at + interval '30 minutes'),
      'has_account', (u.id is not null)
    ),
    'auth_code_sends',
    cs.id::text
  from public.auth_code_sends cs
  join public.landlord_tenant_directory d on d.email = lower(btrim(cs.email))
  left join auth.users u on lower(u.email) = lower(btrim(cs.email))
  where cs.created_at >= p_since
  -- The directory can name one address twice (a `tenants` row and a
  -- `lease_tenants` row spelling the name differently). One event per code
  -- send, preferring the spelling we actually have.
  order by d.landlord_id, cs.id, d.name nulls last
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  return v_total;
end;
$fn$;

comment on function public.sync_landlord_activity(timestamptz) is
  'Idempotent: rebuilds landlord_activity from its sources for events at or after p_since.';

-- Service-role only. It reads `auth.users` and every landlord's rows, so
-- granting it to `authenticated` would make it a cross-tenant read.
revoke all on function public.sync_landlord_activity(timestamptz) from public;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- The app reads this through a service-role route, but the policies exist so
-- that a direct client read can never be cross-tenant.

alter table public.landlord_activity enable row level security;
alter table public.landlord_activity_reads enable row level security;

drop policy if exists landlord_activity_own_select on public.landlord_activity;
create policy landlord_activity_own_select on public.landlord_activity
  for select to authenticated
  using (landlord_id = auth.uid());

drop policy if exists landlord_activity_reads_own on public.landlord_activity_reads;
create policy landlord_activity_reads_own on public.landlord_activity_reads
  for all to authenticated
  using (landlord_id = auth.uid())
  with check (landlord_id = auth.uid());

-- ─── Grants ──────────────────────────────────────────────────────────────────
--
-- Supabase stopped auto-granting on new public tables, and an ungranted table
-- answers `permission denied` however permissive its RLS. Writes to the log
-- itself are the sync function's alone, so `authenticated` gets select only —
-- a deliberate narrowing, which `npm run verify:grants` reports rather than
-- fails on.

grant select on public.landlord_activity to authenticated;
grant all on public.landlord_activity to service_role;

grant select, insert, update on public.landlord_activity_reads to authenticated;
grant all on public.landlord_activity_reads to service_role;

-- The directory view is not for clients — see the comment above it.
grant select on public.landlord_tenant_directory to service_role;

-- ─── Backfill: three months ──────────────────────────────────────────────────

select public.sync_landlord_activity(now() - interval '3 months');

-- Everything older than a week starts read.
--
-- A landlord opening this for the first time with three months of history and
-- a badge reading "412" learns nothing and clears it without looking — the
-- unread count would have taught them, on day one, that the bubble is noise.
-- The last seven days is a feed worth reading; the rest is the archive they
-- came for.
insert into public.landlord_activity_reads (landlord_id, last_read_at)
select distinct landlord_id, now() - interval '7 days'
from public.landlord_activity
on conflict (landlord_id) do nothing;
