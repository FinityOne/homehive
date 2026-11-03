-- A recurring charge the tenant has to be told *about*, not just billed for.
--
-- A pet rent line reads "$65" on the tenant's "what your rent covers" panel and
-- tells them nothing: which pet, agreed when, what it does and does not cover.
-- That gap is where the support email comes from, and with six payers on a
-- lease the landlord answers it six times.
--
-- `special_payments` already carries `notes` for exactly this reason; the
-- recurring half of the same idea did not. One nullable column closes it, and
-- the tenant API now ships `notes` on both so a charge can explain itself
-- wherever it appears.
--
-- No grant statement: this adds a column to an existing table, and
-- `payment_line_items` was granted when it was created. A GRANT is per-table,
-- not per-column, so it already covers this.
alter table public.payment_line_items
  add column if not exists notes text;

comment on column public.payment_line_items.notes is
  'Tenant-facing detail about this recurring charge — what it is for, what it covers. Shown to the tenant alongside the amount. Not a private landlord memo: anything written here is read by the payer.';
