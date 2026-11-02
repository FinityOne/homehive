-- Telling the tenant a fee was written off.
--
-- A waiver was already a recorded decision, but it was a decision the tenant
-- never heard about: their portal quietly stopped showing the fee. Silence
-- there is the worst of both worlds — the landlord gets no credit for the
-- goodwill, and a tenant who had been chased twice about a fee is left unsure
-- whether it is gone or merely not displayed this week. So a waiver now carries
-- whether, when, and to whom it was announced.
--
-- Nullable, not defaulted: an un-announced waiver is a real and legitimate
-- state (a correction of the landlord's own mistake needs no email), and the
-- landlord's panel reads these columns to say which is which.
alter table public.late_fee_waivers
  add column if not exists tenant_notified_at timestamptz,
  add column if not exists tenant_notified_email text,
  -- What the tenant was told, beyond the reason the landlord recorded for
  -- themselves. `reason` is an internal note; this is the sentence that left
  -- the building, and the two are deliberately not the same field.
  add column if not exists tenant_note text;

comment on column public.late_fee_waivers.tenant_notified_at is
  'When the tenant was emailed about this waiver. Null means the write-off was never announced, which is a legitimate state, not a failure.';
comment on column public.late_fee_waivers.tenant_note is
  'The message shown to the tenant. Distinct from `reason`, which is the landlord''s private note.';
