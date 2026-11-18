-- The bell and the log become the same thing.
--
-- `notifications` already existed: lead landed, pre-screen filled, tour
-- booked, shown in a dropdown off the top bar. It was a *different product*
-- from the activity log built in the previous migration — different store,
-- different read state, different surface — and a landlord had no way to know
-- that "a tenant's card was declined" was in one and "a new lead arrived" was
-- in the other. Two inboxes is the failure mode every notification-centre
-- write-up names first: a badge the user stops trusting, because clearing it
-- in one place does not clear the thing they were worried about.
--
-- So there is now one store. `notifications` keeps being *written* exactly as
-- it is today — no writer anywhere in the app changes — and the sync pulls
-- those rows into `landlord_activity` alongside rent, email and sign-ins. The
-- bell, the sidebar badge, the full page and the per-property and per-tenant
-- feeds are then four views of one list, which is the only way "mark all
-- read" can mean what it says.
--
-- `notifications.is_read` is left alone and is now vestigial: the watermark in
-- `landlord_activity_reads` is the one read state. Nothing reads the old flag.

-- Three new kinds, plus a catch-all.
--
-- `notice.other` exists because `notifications.type` is an open string with no
-- check constraint on it. Without a fallback, a type added next month would be
-- silently dropped by the sync — a notification that exists in the database,
-- is counted nowhere, and is shown to nobody. It is better to render an
-- unfamiliar notice plainly than to lose it.
alter table public.landlord_activity
  drop constraint if exists landlord_activity_kind_check;

alter table public.landlord_activity
  add constraint landlord_activity_kind_check check (kind in (
    'rent.paid',
    'charge.paid',
    'payment.submitted',
    'payment.failed',
    'email.sent',
    'tenant.login',
    'tenant.signup',
    'lead.new',          -- a student enquired
    'lead.prescreen',    -- they completed the pre-screen
    'tour.booked',       -- they booked a viewing
    'notice.other'       -- any future notifications.type, rendered plainly
  ));

-- The notifications source, appended to the sync.
--
-- Split out as its own function rather than edited into
-- `sync_landlord_activity`, so that migration stays the file it was; the two
-- are joined by `sync_landlord_feed` below. The title, body and href are taken
-- as written — they were composed for a human reading a dropdown, which is
-- exactly this audience.
create or replace function public.sync_landlord_activity_notices(
  p_since timestamptz default (now() - interval '3 months')
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_n integer;
begin
  insert into public.landlord_activity (
    landlord_id, kind, occurred_at, title, detail, href,
    actor_name, actor_email, property_id, meta, source_table, source_id
  )
  select
    n.landlord_id,
    case n.type
      when 'lead_in'          then 'lead.new'
      when 'prescreen_filled' then 'lead.prescreen'
      when 'tour_booked'      then 'tour.booked'
      else 'notice.other'
    end,
    n.created_at,
    n.title,
    n.body,
    n.href,
    -- The lead's name is already inside the title ("New lead: Emma"), so
    -- pulling it out again would print it twice in a row that is one line
    -- high. The lead row itself is one click away via `href`.
    null,
    nullif(lower(btrim(coalesce(ld.email, ''))), ''),
    -- `leads.property` is a SLUG, not an id — there is no `property_id` on
    -- leads. Scoped to this landlord's own properties so a slug collision
    -- could never attach one landlord's lead to another's listing.
    p.id,
    jsonb_build_object('notification_type', n.type, 'lead_id', n.lead_id),
    'notifications',
    n.id::text
  from public.notifications n
  left join public.leads ld on ld.id = n.lead_id
  left join public.properties p
    on p.slug = ld.property and p.owner_id = n.landlord_id
  where n.created_at >= p_since
  on conflict on constraint landlord_activity_source_uniq do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.sync_landlord_activity_notices(timestamptz) from public;

comment on function public.sync_landlord_activity_notices(timestamptz) is
  'Idempotent: pulls public.notifications into landlord_activity. Called by sync_landlord_feed().';

-- ─── One entry point ─────────────────────────────────────────────────────────
--
-- The app calls this and nothing else. Having the route call two functions
-- would mean a third source, added later, needs a code change in the route as
-- well as a migration — and the one that gets forgotten is always the route.

create or replace function public.sync_landlord_feed(
  p_since timestamptz default (now() - interval '3 months')
) returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.sync_landlord_activity(p_since)
       + public.sync_landlord_activity_notices(p_since);
$$;

revoke all on function public.sync_landlord_feed(timestamptz) from public;

comment on function public.sync_landlord_feed(timestamptz) is
  'The only sync the app calls. Idempotent across every landlord_activity source.';

-- Three months of notices, same window as everything else.
select public.sync_landlord_activity_notices(now() - interval '3 months');

-- A landlord who had notices but no money or email history still needs a
-- watermark, or every notice they have ever had counts as unread.
insert into public.landlord_activity_reads (landlord_id, last_read_at)
select distinct landlord_id, now() - interval '7 days'
from public.landlord_activity
on conflict (landlord_id) do nothing;
