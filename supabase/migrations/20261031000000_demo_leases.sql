-- Demo leases: a tenancy kept to exercise the product, never to take money.
--
-- Landlords (and we) build a throwaway lease to see what the flow does, then
-- leave it there. Financials cannot tell that lease from a real one, so a
-- rehearsal with an $800 rent and a punitive daily late-fee rule lands in the
-- portfolio's billed, outstanding and collection-rate figures and quietly makes
-- every number on the page wrong. That is the whole problem this column solves:
-- the landlord needs one place to say "this one isn't real", and the money
-- surfaces need one flag to honour.
--
-- The flag is deliberately on `leases` and not on the payment plan. "Is this a
-- real tenancy" is a fact about the tenancy; a plan is just the money hanging
-- off it. Put the other way round, a landlord would have to remember to mark
-- each plan, and a lease flagged demo could still sprout a chargeable plan
-- tomorrow.
--
-- Hence the invariant this migration enforces, in both directions: **a demo
-- lease has no payment plan.** Not "has a plan nobody looks at" — no plan at
-- all. Soft-filtering in the UI would leave a real schedule in the database
-- with a real late-fee rule attached to it, which the rent-reminder cron and
-- the tenant pay route reach directly, and either one would charge or chase a
-- tenant over a rehearsal. The only safe reading of "doesn't actually charge
-- the tenant" is that there is nothing there to charge.

-- ── 1. The flag ──────────────────────────────────────────────────────────────
alter table public.leases
  add column if not exists is_demo boolean not null default false;

comment on column public.leases.is_demo is
  'This lease is a demo/test tenancy: it never collects rent and is excluded from Financials. A demo lease cannot hold a payment plan — enforced by trigger in both directions.';

-- Partial, because the interesting set is tiny and every read is "the demo ones".
create index if not exists leases_is_demo_idx on public.leases (is_demo) where is_demo;

-- ── 2. No payment plan may point at a demo lease ─────────────────────────────
-- Plans are created client-side under RLS (see createPlan in src/lib/payments.ts),
-- so a check in the page would be a suggestion. This is the real guard.
create or replace function public.forbid_plan_on_demo_lease()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.leases l where l.id = new.lease_id and l.is_demo) then
    raise exception 'Lease % is a demo lease and cannot have a payment plan.', new.lease_id
      using errcode = 'check_violation',
            hint = 'Clear is_demo on the lease first if rent should really be collected on it.';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_plans_forbid_demo_lease on public.payment_plans;
create trigger payment_plans_forbid_demo_lease
  before insert or update of lease_id on public.payment_plans
  for each row execute function public.forbid_plan_on_demo_lease();

-- ── 3. ...and the same invariant from the other side ─────────────────────────
-- Flagging a lease demo while its schedule stays live is the dangerous half of
-- this: the lease looks inert in the portal while the cron keeps emailing its
-- tenant. Refuse the flag instead of silently orphaning the money, and say what
-- to do about it — deleting a plan is the landlord's call, not a trigger's.
create or replace function public.forbid_demo_flag_with_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_count integer;
begin
  if new.is_demo and not coalesce(old.is_demo, false) then
    select count(*) into plan_count from public.payment_plans p where p.lease_id = new.id;
    if plan_count > 0 then
      raise exception 'Lease % still has % payment plan(s); delete them before marking it a demo lease.', new.id, plan_count
        using errcode = 'check_violation',
              hint = 'Deleting the plan removes its schedule, charges and late-fee rule with it.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leases_forbid_demo_with_plan on public.leases;
create trigger leases_forbid_demo_with_plan
  before update of is_demo on public.leases
  for each row execute function public.forbid_demo_flag_with_plan();
