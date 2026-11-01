-- Turn the internet charge that was typed in six times into one lease utility.
--
-- The live 2026-27 lease carries house internet as six separate
-- `payment_line_items` rows of $17, one per tenant, because a charge had
-- nowhere else to live. This declares it once in `plan_utilities` and **adopts**
-- those six rows by stamping them with `utility_id`.
--
-- Adoption, emphatically not application. `apply_plan_utility` would see no
-- existing materialisation and add a *second* $17 to everybody, raising the
-- house rent by $102/mo for a bill nobody's rent had changed. Stamping the rows
-- that already exist means the declaration starts out exactly in sync: the next
-- call to `apply_plan_utility` reads old share $17, computes new share $17, and
-- correctly does nothing.
--
-- Declared as `per_payer` because that is what the data says it was — $17 each,
-- regardless of how many tenants there are — rather than `even`, which would
-- re-divide $102 the moment somebody moved in or out and silently change six
-- people's rent.
--
-- Net effect on money: none. Nobody's monthly total, rent row, or balance
-- moves. The only change is that the charge is now editable in one place.
--
-- Scoped by plan id, so this is a no-op in any environment without that lease.

do $$
declare
  pid uuid := '6c952c27-93c3-4c7f-9dc4-4326a63d056e';
  uid uuid;
  adopted integer;
begin
  -- Only if that plan exists here, and only if it has not been done already.
  if not exists (select 1 from public.payment_plans where id = pid) then
    return;
  end if;
  if exists (select 1 from public.plan_utilities where plan_id = pid and category = 'internet') then
    return;
  end if;

  insert into public.plan_utilities
    (plan_id, category, label, amount, cadence, split, notes)
  values
    (pid, 'internet', 'Internet', 17, 'monthly', 'per_payer',
     'Adopted from per-payer line items that predated lease-level utilities')
  returning id into uid;

  update public.payment_line_items li
     set utility_id = uid
   where li.utility_id is null
     and li.category = 'internet'
     and li.plan_tenant_id in (
       select t.id from public.payment_plan_tenants t where t.plan_id = pid
     );

  select count(*) into adopted from public.payment_line_items where utility_id = uid;
  raise notice 'adopted % internet line items into plan_utilities %', adopted, uid;
end $$;
