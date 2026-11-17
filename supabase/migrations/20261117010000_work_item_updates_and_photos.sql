-- Progress on a maintenance job: a note, some photos, and whether the tenant
-- sees it.
--
-- `property_work_items.tenant_note` says what a job *is* ("replacing the
-- bedroom 2 flooring"). It cannot say what has *happened* to it, because there
-- is one of it: a landlord who edits it to "all done" destroys the sentence
-- that explained the job, and a tenant who reads only the latest state cannot
-- tell a job that is moving from a job that is stuck. Progress is a log, so it
-- is rows.
--
-- **The update is the unit of sharing, not the photo.** One flag per update,
-- carrying its note and its photos together, because that is the real decision
-- a landlord makes — "show them the finished floor and tell them it's done".
-- A per-photo flag would mean a landlord publishing the completion note and
-- silently keeping the photo back, which is the uninteresting half of what they
-- meant, and it doubles the number of ways to get this wrong.
--
-- A private update (the default) is how the landlord keeps a work diary:
-- before-photos for an insurance claim, the quote that came in, what the
-- contractor actually said.

create table if not exists public.work_item_updates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Cascade: an update is a note *about* a job and has no life without it.
  work_item_id uuid not null references public.property_work_items (id) on delete cascade,
  -- Nullable, because an update may be nothing but photos ("here's the damage").
  body text,
  -- Shared with the property's tenants only on an explicit yes. Note that this
  -- is the *second* gate: an update is only ever shown when its item is shared
  -- too, or publishing an update would reveal a job the tenant was never told
  -- about. The rule lives in `visibleUpdates` (src/lib/tenantMaintenance.ts).
  tenant_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_item_updates_item_idx
  on public.work_item_updates (work_item_id, created_at desc);
-- The tenant portal's only question of this table.
create index if not exists work_item_updates_shared_idx
  on public.work_item_updates (work_item_id)
  where tenant_visible;

create table if not exists public.work_item_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- A photo always hangs off an update, never off the item directly. That is
  -- what keeps "is this photo shared?" a question with exactly one answer.
  update_id uuid not null references public.work_item_updates (id) on delete cascade,
  -- Both, like `checkout_inspection_photos`: `url` is what gets rendered,
  -- `storage_path` is what gets deleted. A row with a url and no path is an
  -- orphan nobody can clean up.
  url text not null,
  storage_path text,
  caption text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists work_item_photos_update_idx
  on public.work_item_photos (update_id, position);

comment on table public.work_item_updates is
  'Progress log on a maintenance item: a note and/or photos, shared with the property''s tenants only when tenant_visible AND the parent item is itself shared.';
comment on column public.work_item_photos.storage_path is
  'Object key in the maintenance-photos bucket. Needed to delete the file; the url alone cannot.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Owner-only, like `property_work_items`. The tenant side is served by the
-- service role in /api/tenant/maintenance, because "a tenant on an active
-- lease at this property" is a join these tables cannot express.
--
-- `owner_id = auth.uid()` is not enough on its own here: it would let a
-- landlord attach an update to *another* landlord's work item by id, stamping
-- their own owner_id on it. So the item's ownership is checked too.
alter table public.work_item_updates enable row level security;
alter table public.work_item_photos enable row level security;

drop policy if exists "Owners manage own work item updates" on public.work_item_updates;
create policy "Owners manage own work item updates"
  on public.work_item_updates for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.property_work_items w
      where w.id = work_item_id and w.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners manage own work item photos" on public.work_item_photos;
create policy "Owners manage own work item photos"
  on public.work_item_photos for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.work_item_updates u
      where u.id = update_id and u.owner_id = auth.uid()
    )
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Required in the same migration that creates the table: Supabase stopped
-- auto-granting new tables on 30 Oct 2026, and an ungranted table answers
-- `permission denied` to supabase-js however permissive its RLS is.
--
-- No `anon`: a logged-out visitor has no business reading a landlord's work
-- diary, and nothing public renders these. The tenant portal reads them through
-- the service role, not as `anon`. `npm run verify:grants` reports this as a
-- deliberate narrowing rather than failing it.
grant select, insert, update, delete on public.work_item_updates to authenticated;
grant select, insert, update, delete on public.work_item_photos to authenticated;
grant all on public.work_item_updates to service_role;
grant all on public.work_item_photos to service_role;

-- ── Storage ──────────────────────────────────────────────────────────────────
-- Mirrors `inspection-photos`, which solves the same problem (photographs of
-- the inside of someone's home, shown to a non-landlord). Public-read with
-- unguessable generated keys, 25MB, and the HEIC/HEIF types iOS actually
-- produces — a bucket that lists only jpeg/png rejects half of what a landlord
-- photographs on their phone with a 415.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'maintenance-photos', 'maintenance-photos', true, 26214400,
  array['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif','image/gif','image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- First path segment is the uploader's uid, which is what these policies check.
-- See `maintenancePhotoPath` in src/lib/workItemUpdates.ts — change one and the
-- other stops working.
drop policy if exists "Maintenance photos are publicly readable" on storage.objects;
create policy "Maintenance photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'maintenance-photos');

drop policy if exists "Owners upload own maintenance photos" on storage.objects;
create policy "Owners upload own maintenance photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "Owners delete own maintenance photos" on storage.objects;
create policy "Owners delete own maintenance photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
