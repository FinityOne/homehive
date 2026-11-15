-- What a rental property *costs*.
--
-- ── The hole this fills ─────────────────────────────────────────────────────
--
-- The money area of this product has, until now, only ever been able to answer
-- one half of the only question a rental owner actually has. It knows what was
-- billed, what arrived, who is behind and what is coming. It has no idea
-- whether any of it was worth doing, because it has never held a single cost.
--
-- Eleven screens, eight pure models, and not one of them can say what a
-- property earned *net*. A landlord collecting $2,400 a month against a $1,900
-- mortgage and $300 of tax and insurance is making $200, and this product would
-- congratulate them on $2,400.
--
-- ── Why `property_work_items` could not be this table ───────────────────────
--
-- The maintenance list already carries `estimated_cost` and `actual_cost`, and
-- the obvious move was to total those and call it expenses. Two reasons not to:
--
--   1. **It is a planning list, not a ledger.** In the live database every
--      work item has an estimate and *none* has an actual. That is not a data
--      quality problem to be nagged about — it is what the feature is for.
--      People write down what needs doing and what they think it will cost.
--   2. **Most of what a rental costs is not work.** Mortgage interest,
--      property tax, insurance, HOA dues, management fees, legal fees,
--      advertising, owner-paid utilities, mileage. None of those are a job
--      somebody does to the building, none has a priority or a status, and all
--      of them are deductible lines an accountant will ask for by name.
--
-- So work items keep their job and this table keeps the money. A completed work
-- item can be *posted* here with `work_item_id` set, which is a pointer and not
-- a copy: the model counts the expense row and never the work item's own
-- `actual_cost`, so a posted job cannot be counted twice.
--
-- ── `incurred_on` is the only date that decides anything ────────────────────
--
-- Not `created_at`. A landlord entering last year's insurance premium in
-- January must have it land in last year, and a cost typed in a batch on a
-- Sunday evening must not pile six months of spend into that Sunday. Every
-- month bucket, every year total and every tax summary reads `incurred_on`,
-- which is the same rule the rent side already follows with `submitted_at`
-- rather than server time (see src/lib/rentPayments.ts).
--
-- ── Capital is derived from the category, never stored ──────────────────────
--
-- A new roof is not an expense, it is an improvement — it is depreciated rather
-- than deducted, and totalling it into operating cost overstates expenses and
-- understates the asset. So the distinction has to exist. It is *not* a column:
-- `CATEGORY_META` in src/lib/propertyExpenses.ts holds `capital` per category,
-- and one function decides it for every reader. A boolean here could drift from
-- the category beside it, and we have been bitten by exactly that before —
-- `late_fees_applied` is corrupt in this database for that reason.
--
-- ── No recurrence engine ───────────────────────────────────────────────────
--
-- A monthly mortgage payment begs for a "repeats monthly" flag. Deliberately
-- absent. A recurrence that generates rows needs a cron to stay true and is
-- wrong in between — the trap the renewal `status` column documents at length.
-- Instead the UI offers "post this for every month of a range", which writes
-- the real rows once, immediately, and leaves a ledger that is correct whether
-- or not anything is running. A landlord can then edit or delete any single
-- month, which a generated series makes awkward.

create table if not exists public.property_expenses (
  id            uuid        primary key default gen_random_uuid(),

  -- Denormalised from the property so the ledger read needs no join and the
  -- RLS policy no sub-select. Every write path copies it from the property it
  -- has already verified the caller owns.
  owner_id      uuid        not null references public.profiles (id) on delete cascade,
  property_id   uuid        not null references public.properties (id) on delete cascade,

  -- Optional. Some costs belong to a tenancy rather than to the building — a
  -- turnover clean, a letting fee, a tenant's damage made good — and a landlord
  -- reconciling a deposit wants them attributable. Most costs have no lease.
  lease_id      uuid        references public.leases (id) on delete set null,

  category      text        not null,
  -- Dollars with cents. The rent side is integer dollars because that is what
  -- leases are written in; costs are not — insurance is $142.67 and rounding it
  -- makes a year's total wrong by real money.
  amount        numeric(12,2) not null,

  /** The date the cost belongs to. The ONLY date any total reads. */
  incurred_on   date        not null,

  /** Who was paid. Free text — most landlords are not maintaining a vendor list. */
  vendor        text,
  /** The landlord's own note. Never shown to a tenant. */
  memo          text,
  /** A link to the invoice or receipt, wherever they keep it. */
  receipt_url   text,

  /**
   * The maintenance job this cost came from, when it came from one.
   *
   * A pointer, not a copy: with this set, the expense row is the money and the
   * work item's `actual_cost` is ignored by every total, so posting a job
   * cannot double count it.
   */
  work_item_id  uuid        references public.property_work_items (id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The category list. A check constraint rather than a lookup table because
  -- these are not user data: they are the lines an accountant and the IRS
  -- Schedule E already recognise, plus the handful of real costs that schedule
  -- folds into "other". Adding one is a migration, which is correct — a new
  -- category changes what every historical total means.
  constraint property_expenses_category_check check (category in (
    'mortgage_interest',   -- Schedule E line 12
    'property_tax',        -- line 16
    'insurance',           -- line 9
    'hoa',                 -- line 19 (other)
    'utilities',           -- line 17, owner-paid only
    'repairs',             -- line 14
    'maintenance',         -- line 7 (cleaning and maintenance)
    'management',          -- line 11 (management fees)
    'leasing',             -- line 11 — letting and tenant placement fees
    'advertising',         -- line 5
    'legal_professional',  -- line 10
    'supplies',            -- line 15
    'travel',              -- line 6 (auto and travel)
    'capital_improvement', -- NOT deductible as an expense: depreciated
    'other'                -- line 19
  )),

  -- A cost is a positive number. A refund or a credit is not an expense with a
  -- minus sign in front of it — that reading breaks every category total and
  -- every tax line — so the ledger refuses it and the UI says so.
  constraint property_expenses_amount_check check (amount >= 0)
);

comment on table public.property_expenses is
  'One cost incurred on one property. The landlord''s cost side of the money area: NOI, net income and the tax-year summary are all built from this. `incurred_on` is the only date any total reads; capital vs operating is derived from `category` by CATEGORY_META in src/lib/propertyExpenses.ts and is deliberately not a column.';
comment on column public.property_expenses.incurred_on is
  'The date the cost belongs to — never created_at. A premium entered in January for last December must land in last December, and a batch of entries typed on one evening must not pile into that evening.';
comment on column public.property_expenses.work_item_id is
  'The maintenance job this cost was posted from, if any. A pointer, not a copy: totals read this row''s amount and ignore the work item''s own actual_cost, so a posted job is never counted twice.';
comment on column public.property_expenses.lease_id is
  'Set when the cost belongs to a tenancy rather than to the building — a turnover clean, a letting fee, tenant damage made good. Most costs have no lease.';
comment on column public.property_expenses.category is
  'Constrained to the Schedule E lines plus the real costs that schedule folds into "other". Adding one is a migration on purpose: a new category changes what every historical total means.';

-- The ledger read: one landlord's costs, newest first. Every list, total and
-- year summary in the product goes through this.
create index if not exists property_expenses_owner_idx
  on public.property_expenses (owner_id, incurred_on desc);

-- And the per-property read, for the property money page.
create index if not exists property_expenses_property_idx
  on public.property_expenses (property_id, incurred_on desc);

-- At most one expense row per work item, so "post this job" is idempotent and
-- a landlord who double-clicks it does not book the plumber twice.
create unique index if not exists property_expenses_one_per_work_item
  on public.property_expenses (work_item_id)
  where work_item_id is not null;

alter table public.property_expenses enable row level security;

-- ── Policies ────────────────────────────────────────────────────────────────
--
-- Unlike nearly every other write in this product, the landlord writes here
-- directly from the client rather than through a service-role route. That is a
-- deliberate difference and it rests on one fact: nothing else happens when a
-- cost is recorded. No tenant is emailed, no charge is raised, no money moves,
-- no third party learns anything. The row is private bookkeeping about the
-- landlord's own building.
--
-- The service-role routes elsewhere exist to keep a write and its side effect
-- from coming apart — an offer the tenant was never told about, a payment with
-- no receipt. With no side effect to bind, a route would add a hop and a second
-- place for the ownership check to be wrong.
--
-- `owner_id = auth.uid()` in both USING and WITH CHECK, so a landlord can
-- neither read another's costs nor file a cost against their property.
drop policy if exists "owner_select" on public.property_expenses;
create policy "owner_select"
  on public.property_expenses for select
  using (owner_id = auth.uid());

drop policy if exists "owner_insert" on public.property_expenses;
create policy "owner_insert"
  on public.property_expenses for insert
  with check (owner_id = auth.uid());

drop policy if exists "owner_update" on public.property_expenses;
create policy "owner_update"
  on public.property_expenses for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "owner_delete" on public.property_expenses;
create policy "owner_delete"
  on public.property_expenses for delete
  using (owner_id = auth.uid());

-- ── Grants ──────────────────────────────────────────────────────────────────
--
-- In the same migration that creates the table, per the rule in CLAUDE.md:
-- Supabase stopped auto-granting new tables on 30 Oct 2026 and an ungranted
-- table answers `permission denied` to supabase-js however permissive its RLS
-- is.
--
-- Narrower than the schema's usual `anon, authenticated, service_role`, which
-- `npm run verify:grants` reports rather than fails. No `anon` at all, and the
-- revoke is what makes that true rather than aspirational: this project's
-- default privileges still hand every new table in `public` to anon and
-- authenticated, and a GRANT cannot take back what a previous GRANT gave — only
-- `revoke` does (the lesson from the leads grants, PR #43/#44).
--
-- A logged-out visitor reading a landlord's mortgage balance, insurance premium
-- and management fees would be the most sensitive leak in this database. RLS
-- would deny it, but the grant is the outer gate and PostgREST consults it
-- first, so it should say what we mean.
revoke all on public.property_expenses from anon;
revoke all on public.property_expenses from authenticated;
grant select, insert, update, delete on public.property_expenses to authenticated;
grant all on public.property_expenses to service_role;
