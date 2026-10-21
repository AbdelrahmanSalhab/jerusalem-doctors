-- Server-only tables say so: an explicit "nobody" policy on each.
--
-- Row-level security with no policy already refuses every row to the
-- public and signed-in keys; only the server (service role, which bypasses
-- RLS) reads or writes these. Supabase's advisor reports that state as
-- "RLS enabled, no policy" (lint 0008) because it cannot tell intent from
-- an oversight. A policy that is always false changes no access and puts
-- the intent in the database.
-- Apply in the Supabase SQL editor. Safe to run more than once.

drop policy if exists "server only" on public.doctor_license_slots;
create policy "server only"
  on public.doctor_license_slots
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "server only" on public.institutions;
create policy "server only"
  on public.institutions
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "server only" on public.metrics_daily;
create policy "server only"
  on public.metrics_daily
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "server only" on public.moh_practitioners;
create policy "server only"
  on public.moh_practitioners
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "server only" on public.pending_signups;
create policy "server only"
  on public.pending_signups
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "server only" on public.usage_events;
create policy "server only"
  on public.usage_events
  for all
  to anon, authenticated
  using (false)
  with check (false);
