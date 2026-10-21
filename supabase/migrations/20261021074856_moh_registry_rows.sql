-- moh_practitioners: every specialty, and the registry's dates read right.
--
-- The registry has one row per specialty certificate, so a doctor certified
-- in two fields has two rows. The sync kept whichever came last: certificates
-- were lost, and a licence whose blank row came last read as no specialty at
-- all. Each licence now keeps all of them, oldest first.
--
-- The registry writes dates as DDMMYYYY (22111979), which
-- license_issued_yyyymmdd stored as if it were YYYYMMDD. Nothing reads that
-- column any more; it goes in a later migration, once no deployed code
-- selects it.
--
-- The table also stops being a copy of the whole registry: it now holds only
-- the licences the app has looked up (signups, admin checks) and the nightly
-- sync keeps only our own doctors' (app/api/cron/sync-moh).
-- Apply in the Supabase SQL editor. Safe to run more than once.

alter table public.moh_practitioners
  add column if not exists specialties text[] not null default '{}',
  add column if not exists license_issued_on date,
  add column if not exists specialist_since date;

comment on column public.moh_practitioners.specialty_name_he is
  'The most recent specialty certificate, or null; all of them are in specialties.';
comment on column public.moh_practitioners.specialist_since is
  'When the first specialty certificate was granted.';
