-- Utilities belong to the lease, and late fees that were paid become visible.
--
-- Two changes, both about money being recorded where it actually belongs.
--
-- ── 1. A utility is one charge on the lease, not six identical line items ────
--
-- A shared bill had to be typed into every payer by hand. On the live 2026-27
-- lease, house internet is six separate `payment_line_items` rows of $17 — the
-- same $102/mo charge entered six times, with nothing recording that it was
-- ever one thing. Changing the bill meant six edits that could disagree.
--
-- So the charge is declared once, in `plan_utilities`, and *materialised* into
-- the per-payer rows the rest of the system already understands:
--
--     plan_utilities (the declaration)
--        └─ monthly   → one payment_line_items row per payer, + their share
--                       folded into monthly_total and future unpaid rent
--        └─ one-time  → one special_payments row per payer
--
-- Materialising rather than computing on read is deliberate: the tenant pay
-- route, the reminder cron, the arrears model and every total already read
-- those tables. A utility that existed only as a declaration would be a charge
-- nobody could pay. The `utility_id` back-reference is what keeps that honest —
-- it means "this row is owned by that declaration", so re-applying updates the
-- same rows instead of adding more, and deleting the declaration takes its rows
-- with it.
--
-- Two rules the apply function below must never break, both learned from what
-- the money actually looks like:
--
--   • **Deltas, never sums.** A payer's `monthly_total` can be a deliberate
--     override that does not equal the sum of their line items (the ledger lets
--     a landlord set it directly). Recomputing from the sum would silently
--     rewrite somebody's rent, so a share change is applied as
--     `monthly_total - old_share + new_share`.
--   • **Never rewrite settled or past rent.** Only `pending` rent with nothing
--     paid against it and a due date still in the future is moved. Rent that is
--     paid, part-paid, clearing, voided, or simply already due is history.
--
-- ── 2. Late fees that were collected ────────────────────────────────────────
--
-- `settleRentPayment` charges the tenant rent *plus* the derived late fee, then
-- writes `paid_amount = amount` — the rent only — and puts the fee in
-- `late_fees_applied`. Since every total is built from `paid_amount`, a late fee
-- the tenant genuinely paid was invisible: the landlord could not see money they
-- had received.
--
-- `late_fees_applied` cannot be repurposed for this. It is a known-corrupt
-- column, written at various times by code that recomputed a *derived* figure,
-- and has held fees against rent that was paid early. It stays derive-only
-- (see `lateFeeDue`). `late_fee_paid` is a new, narrower fact with exactly one
-- meaning: **late-fee money actually received for this charge.**

-- ── Utilities ───────────────────────────────────────────────────────────────
create table if not exists public.plan_utilities (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.payment_plans (id) on delete cascade,
  category    text not null,
  label       text not null,
  -- What `amount` means depends on `split`, which is why they live together:
  --   even      → the whole bill for the property, divided across active payers
  --   per_payer → what each payer pays, charged to every one of them
  amount      numeric(10,2) not null check (amount >= 0),
  cadence     text not null check (cadence in ('monthly', 'one_time')),
  split       text not null check (split in ('even', 'per_payer')),
  -- Monthly: the window it applies over. `start_date` null means "from the
  -- start of the lease", `end_date` null means "until the lease ends".
  start_date  date,
  end_date    date,
  -- One-time: when the single charge falls due.
  due_date    date,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A monthly utility has no single due date, and a one-time one has no window.
  constraint plan_utilities_cadence_shape check (
    (cadence = 'monthly'  and due_date is null) or
    (cadence = 'one_time' and due_date is not null and start_date is null and end_date is null)
  ),
  constraint plan_utilities_window check (
    start_date is null or end_date is null or end_date >= start_date
  )
);

comment on table public.plan_utilities is
  'A utility or shared charge declared once against a payment plan. Materialised into payment_line_items (monthly) or special_payments (one_time) per payer, each carrying utility_id back to here.';

create index if not exists plan_utilities_plan_idx on public.plan_utilities (plan_id);

alter table public.plan_utilities enable row level security;

-- Matches late_fee_rules.owner_all — ownership is the plan's.
drop policy if exists owner_all on public.plan_utilities;
create policy owner_all on public.plan_utilities
  for all using (
    plan_id in (select p.id from public.payment_plans p where p.owner_id = auth.uid())
  );

-- ── The back-references that make re-applying safe ──────────────────────────
alter table public.payment_line_items
  add column if not exists utility_id uuid references public.plan_utilities (id) on delete cascade;

alter table public.special_payments
  add column if not exists utility_id uuid references public.plan_utilities (id) on delete set null;

comment on column public.payment_line_items.utility_id is
  'Set when this line item was materialised from a plan_utilities row. Null for items the landlord typed directly.';
comment on column public.special_payments.utility_id is
  'Set when this charge came from a one-time plan_utilities row. SET NULL on delete: a charge somebody has already paid must outlive the declaration that created it.';

-- One materialised line per payer per utility, so re-applying can upsert.
create unique index if not exists payment_line_items_utility_payer_idx
  on public.payment_line_items (utility_id, plan_tenant_id)
  where utility_id is not null;

create index if not exists special_payments_utility_idx
  on public.special_payments (utility_id) where utility_id is not null;

-- ── Late-fee money actually received ────────────────────────────────────────
alter table public.scheduled_payments
  add column if not exists late_fee_paid numeric(10,2) not null default 0;

comment on column public.scheduled_payments.late_fee_paid is
  'Late-fee money actually received for this charge, on top of paid_amount. Distinct from late_fees_applied, which is a corrupt derived figure and must never be read — late fees DUE are always derived via lateFeeDue().';

-- Backfill: where a Stripe intent settled this row, the fee recorded against it
-- was the fee the tenant was really charged (settleRentPayment writes it from
-- the intent's own metadata), so that money did arrive. Rows a landlord ticked
-- off by hand are left at 0 — nobody can say from here whether a fee was ever
-- handed over, and inventing one would be worse than asking.
update public.scheduled_payments
   set late_fee_paid = late_fees_applied
 where stripe_payment_intent_id is not null
   and status = 'paid'
   and coalesce(late_fees_applied, 0) > 0;

-- ── Applying a utility to its payers ────────────────────────────────────────
--
-- Idempotent by construction: it diffs against what it materialised last time
-- and applies only the difference, so calling it twice changes nothing the
-- second time. That matters because the ledger calls it after every edit.
--
-- `security invoker`, deliberately. Every table this touches (payment_plans,
-- payment_plan_tenants, payment_line_items, scheduled_payments,
-- special_payments) carries an owner-keyed RLS policy, so running as the caller
-- means a landlord can only ever move their own money and no ownership check
-- has to be written here — the policies already are that check. `definer` would
-- have made this function a way to edit somebody else's plan by guessing a
-- utility id. A service-role caller bypasses RLS as usual.
create or replace function public.apply_plan_utility(p_utility_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  u              public.plan_utilities;
  payer_count    integer;
  base_cents     integer;
  share_cents    integer;
  remainder      integer;
  idx            integer := 0;
  payer          record;
  old_share      numeric(10,2);
  new_share      numeric(10,2);
begin
  select * into u from public.plan_utilities where id = p_utility_id;
  if not found then
    raise exception 'plan_utilities row % not found', p_utility_id;
  end if;

  -- Only active payers carry a utility. Somebody who has moved out does not
  -- start owing for next month's internet.
  select count(*) into payer_count
    from public.payment_plan_tenants t
   where t.plan_id = u.plan_id and t.status = 'active';

  if payer_count = 0 then
    -- Nothing to spread it over. Leave any previous materialisation in place
    -- rather than guessing; the ledger shows the utility as unallocated.
    return;
  end if;

  -- Whole cents, with the rounding remainder handed out one cent at a time to
  -- the first payers. Three people and a $100 bill is 33.34 / 33.33 / 33.33 —
  -- it has to add up to the bill exactly, or the landlord under-bills forever.
  base_cents  := round(u.amount * 100);
  if u.split = 'even' then
    share_cents := base_cents / payer_count;
    remainder   := base_cents - (share_cents * payer_count);
  else
    share_cents := base_cents;
    remainder   := 0;
  end if;

  for payer in
    select t.id, t.monthly_total
      from public.payment_plan_tenants t
     where t.plan_id = u.plan_id and t.status = 'active'
     order by t.created_at, t.id
  loop
    new_share := (share_cents + case when idx < remainder then 1 else 0 end)::numeric / 100;
    idx := idx + 1;

    if u.cadence = 'monthly' then
      select li.amount into old_share
        from public.payment_line_items li
       where li.utility_id = u.id and li.plan_tenant_id = payer.id;

      if old_share is null then
        insert into public.payment_line_items (plan_tenant_id, category, label, amount, utility_id)
        values (payer.id, u.category, u.label, new_share, u.id);
        old_share := 0;
      else
        update public.payment_line_items
           set amount = new_share, category = u.category, label = u.label
         where utility_id = u.id and plan_tenant_id = payer.id;
      end if;

      if new_share <> old_share then
        -- Delta, never a recomputed sum: monthly_total may be an override.
        update public.payment_plan_tenants
           set monthly_total = greatest(0, monthly_total - old_share + new_share)
         where id = payer.id;

        -- Future unpaid rent only. Anything settled, part-paid, clearing,
        -- voided or already due is history and stays exactly as it is.
        update public.scheduled_payments sp
           set amount = greatest(0, sp.amount - old_share + new_share),
               updated_at = now()
         where sp.plan_tenant_id = payer.id
           and sp.status = 'pending'
           and coalesce(sp.paid_amount, 0) = 0
           and sp.due_date > current_date
           and (u.start_date is null or sp.due_date >= u.start_date)
           and (u.end_date   is null or sp.due_date <= u.end_date);
      end if;

    else
      -- One-time: its own charge per payer, so it can be paid, chased and
      -- waived independently of rent.
      if exists (
        select 1 from public.special_payments s
         where s.utility_id = u.id and s.plan_tenant_id = payer.id
      ) then
        -- Never re-price a charge somebody has already settled or is paying.
        update public.special_payments
           set amount = new_share, label = u.label, due_date = u.due_date,
               category = 'other', updated_at = now()
         where utility_id = u.id and plan_tenant_id = payer.id
           and status = 'pending';
      else
        insert into public.special_payments
          (plan_id, plan_tenant_id, category, label, amount, due_date, status, notes, utility_id)
        values
          (u.plan_id, payer.id, 'other', u.label, new_share, u.due_date, 'pending', u.notes, u.id);
      end if;
    end if;
  end loop;
end;
$$;

comment on function public.apply_plan_utility(uuid) is
  'Materialise a plan_utilities row onto its active payers. Idempotent: diffs against the previous materialisation and applies only the delta. Never touches settled or already-due rent.';

-- ── Taking a utility away ───────────────────────────────────────────────────
--
-- The line items go by FK cascade, but the shares folded into monthly_total and
-- into future rent have to be unwound first — otherwise deleting a utility
-- leaves every payer's rent permanently inflated by a charge that no longer
-- exists. BEFORE DELETE, while the line items are still readable.
create or replace function public.unapply_plan_utility()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  li record;
begin
  if old.cadence = 'monthly' then
    for li in
      select plan_tenant_id, amount
        from public.payment_line_items
       where utility_id = old.id
    loop
      update public.payment_plan_tenants
         set monthly_total = greatest(0, monthly_total - li.amount)
       where id = li.plan_tenant_id;

      update public.scheduled_payments sp
         set amount = greatest(0, sp.amount - li.amount),
             updated_at = now()
       where sp.plan_tenant_id = li.plan_tenant_id
         and sp.status = 'pending'
         and coalesce(sp.paid_amount, 0) = 0
         and sp.due_date > current_date
         and (old.start_date is null or sp.due_date >= old.start_date)
         and (old.end_date   is null or sp.due_date <= old.end_date);
    end loop;
  else
    -- An unpaid one-time charge disappears with its declaration. A paid one
    -- stays on the books (utility_id goes null) — money that changed hands is
    -- not deleted because somebody tidied up a setting.
    delete from public.special_payments
     where utility_id = old.id and status = 'pending';
  end if;

  return old;
end;
$$;

drop trigger if exists plan_utilities_unapply on public.plan_utilities;
create trigger plan_utilities_unapply
  before delete on public.plan_utilities
  for each row execute function public.unapply_plan_utility();
