-- Fixes for Supabase's database linter (Advisors → Security and
-- Performance).
--
-- 1. Trigger functions with a role-mutable search_path (lint 0011): pinned
--    to public, so a schema earlier on a caller's path cannot redirect the
--    tables they name.
-- 2. is_admin() callable through the API as /rest/v1/rpc/is_admin (lints
--    0028, 0029): moved to a "private" schema the API does not expose.
--    Policies refer to a function by its identity, not its name, so every
--    policy that calls it keeps working. Signed-in users keep EXECUTE: the
--    policies run as them. anon never needs it.
-- 3. rls_auto_enable(), Supabase's own event-trigger function for
--    automatic RLS, callable by anon and signed-in users (lints 0028,
--    0029): EXECUTE revoked. Event triggers do not need it. Only where the
--    function exists (it is not in a fresh local database).
-- 4. pg_trgm installed in public (lint 0014): moved to the extensions
--    schema. The trigram indexes keep working (they refer to the operator
--    class by identity); nothing calls trigram functions by name.
--
-- Not changed, on purpose: "RLS enabled, no policy" (lint 0008) on
-- doctor_license_slots, institutions, metrics_daily, moh_practitioners,
-- pending_signups and usage_events. They are server-only tables: RLS on with
-- no policy is exactly "nobody but the service role".
--
-- Performance:
-- 5. Policies that call auth.uid() or is_admin() per row (lint 0003): the
--    calls are wrapped in (select ...), so Postgres evaluates them once per
--    query.
-- 6. Two permissive SELECT policies on one table for one role (lint 0006):
--    doctors' "own row" and "admin reads all" become one policy, and the
--    specialties admin policy no longer covers SELECT (one read policy that
--    also lets admins see inactive specialties, as before).
-- 7. Foreign keys without an index (lint 0001): audit_logs.target_doctor_id
--    and usage_events.doctor_id, both scanned when a doctor is deleted
--    (on delete set null) and read by doctor in the admin screens.
-- 8. moh_practitioners_norm, never used (lint 0005): names are only
--    compared after a lookup by licence number, so it only slowed the
--    registry upserts. The other "unused" trigram indexes stay: the tables
--    are still small enough that a scan wins, and they are what keeps search
--    fast as the directory grows.
-- Apply in the Supabase SQL editor. Safe to run more than once.

-- 1
alter function public.tg_touch_updated_at() set search_path = public;
alter function public.tg_sync_doctor_license_slots() set search_path = public;

-- 2
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'is_admin') then
    alter function public.is_admin() set schema private;
  end if;
end $$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;

-- 3
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- 4
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- 5, 6: doctors
drop policy if exists "doctor reads own row" on public.doctors;
drop policy if exists "admin reads all doctors" on public.doctors;
drop policy if exists "doctor or admin reads doctors" on public.doctors;
create policy "doctor or admin reads doctors"
  on public.doctors
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()) or (select private.is_admin()));

-- 5: the rows that hang off a doctor
drop policy if exists "doctor_specialties readable for visible doctors" on public.doctor_specialties;
create policy "doctor_specialties readable for visible doctors"
  on public.doctor_specialties
  for select
  to authenticated
  using (exists (
    select 1 from public.doctors d
    where d.id = doctor_specialties.doctor_id
      and (d.auth_user_id = (select auth.uid())
        or (select private.is_admin())
        or (d.is_active and d.is_visible and d.is_phone_verified
            and d.is_admin_approved and d.consent_directory_use))));

drop policy if exists "doctor_workplaces readable for visible doctors" on public.doctor_workplaces;
create policy "doctor_workplaces readable for visible doctors"
  on public.doctor_workplaces
  for select
  to authenticated
  using (exists (
    select 1 from public.doctors d
    where d.id = doctor_workplaces.doctor_id
      and (d.auth_user_id = (select auth.uid())
        or (select private.is_admin())
        or (d.is_active and d.is_visible and d.is_phone_verified
            and d.is_admin_approved and d.consent_directory_use))));

drop policy if exists "admin reads audit logs" on public.audit_logs;
create policy "admin reads audit logs"
  on public.audit_logs
  for select
  to authenticated
  using ((select private.is_admin()));

-- 5, 6: specialties
drop policy if exists "admin manages specialties" on public.specialties;
drop policy if exists "specialties readable by authenticated" on public.specialties;
drop policy if exists "specialties readable" on public.specialties;
drop policy if exists "admin adds specialties" on public.specialties;
drop policy if exists "admin edits specialties" on public.specialties;
drop policy if exists "admin removes specialties" on public.specialties;
create policy "specialties readable"
  on public.specialties
  for select
  to authenticated
  using (is_active or (select private.is_admin()));
create policy "admin adds specialties"
  on public.specialties for insert to authenticated
  with check ((select private.is_admin()));
create policy "admin edits specialties"
  on public.specialties for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admin removes specialties"
  on public.specialties for delete to authenticated
  using ((select private.is_admin()));

-- 7
create index if not exists audit_logs_target
  on public.audit_logs (target_doctor_id, created_at desc);
create index if not exists usage_events_doctor
  on public.usage_events (doctor_id);

-- 8
drop index if exists public.moh_practitioners_norm;
