-- 0013: featured doctors, "seeking work", and GP certificates.
--
--   featured / featured_at  set by an admin; the dashboard shows the most
--                           recent 'doctor' and up to 6 'graduate' rows.
--   seeking_work            self-declared on /signup and /profile.
--   certificates            extra certificates a طب عام doctor holds; cards
--                           show them in place of the الطب العام chip.
--                           certificates_normalized feeds the text search.
--
-- Additive and idempotent: safe to run before the code that reads it ships.

alter table public.doctors
  add column if not exists seeking_work boolean not null default false,
  add column if not exists featured text
    check (featured in ('doctor', 'graduate')),
  add column if not exists featured_at timestamptz,
  add column if not exists certificates text[] not null default '{}'
    check (cardinality(certificates) <= 5),
  add column if not exists certificates_normalized text;

create index if not exists doctors_featured
  on public.doctors (featured, featured_at desc)
  where featured is not null;
