-- 0011_revoke_doctor_self_update.sql
-- Closes direct writes to the doctor tables from the anon and authenticated
-- roles. Apply after 0010. Idempotent: safe to re-run.
--
-- Why: 0002's "doctor updates own row" policy allowed an UPDATE of ANY
-- column on the caller's own row, relying on the API to whitelist columns.
-- A doctor holding the anon key and their own access token could skip the
-- API and PATCH /rest/v1/doctors directly, setting is_admin,
-- is_admin_approved or is_active on themselves. The "owner manages"
-- policies on doctor_specialties (0002) and doctor_workplaces (0004) are the
-- same shape: they let a doctor bypass the API's limits (5 specialties, 20
-- workplaces, length checks, active specialties only).
--
-- Nothing in the app needs these grants: every write to these tables
-- (signup, /api/profile, /api/admin/doctors/*) goes through the service
-- role, which bypasses both grants and RLS. The user-scoped client is only
-- used for Supabase Auth. SELECT is left alone; the read policies stay.
--
-- Revoking the table privileges is the real fix (TRUNCATE included, since
-- RLS never applies to it); the write policies are dropped as well so nobody
-- reads them later and assumes direct writes are supported.

revoke insert, update, delete, truncate
  on public.doctors, public.doctor_specialties, public.doctor_workplaces
  from anon, authenticated;

drop policy if exists "doctor updates own row" on public.doctors;
drop policy if exists "admin updates all doctors" on public.doctors;
drop policy if exists "doctor_specialties owner manages" on public.doctor_specialties;
drop policy if exists "doctor_specialties admin manages" on public.doctor_specialties;
drop policy if exists "doctor_workplaces owner manages" on public.doctor_workplaces;
drop policy if exists "doctor_workplaces admin manages" on public.doctor_workplaces;
