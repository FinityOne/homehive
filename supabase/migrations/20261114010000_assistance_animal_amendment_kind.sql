-- Let a lease amendment say "assistance animal".
--
-- `lease_amendments.kind` allowed 'pet_addition' and 'other'. An assistance
-- animal is neither: it is the opposite of a pet addition — it takes the pet
-- rent off — and filing it under 'other' would lose the one fact a landlord
-- most needs to find again later, which is which of their animals are
-- accommodations rather than pets. Under the Fair Housing Act that distinction
-- decides whether a charge may exist at all, so it belongs in a column and not
-- in a free-text title.
--
-- Widening a CHECK constraint only: every existing row still satisfies it, so
-- this cannot fail on data. No table is created here, so there is nothing new
-- to GRANT — `lease_amendments` keeps the grants its own migration gave it.

alter table public.lease_amendments
  drop constraint if exists lease_amendments_kind_check;

alter table public.lease_amendments
  add constraint lease_amendments_kind_check
  check (kind = any (array['pet_addition'::text, 'assistance_animal'::text, 'other'::text]));
