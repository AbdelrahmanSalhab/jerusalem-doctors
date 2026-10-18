-- 0011_revoke_doctor_self_update.sql
-- Closes direct writes to public.doctors from the anon and authenticated
-- roles. Apply after 0010. Idempotent: safe to re-run.
--
-- Why: 0002's "doctor updates own row" policy allowed an UPDATE of ANY
-- column on the caller's own row, relying on the API to whitelist columns.
-- A doctor holding the anon key and their own access token could skip the
-- API and PATCH /rest/v1/doctors directly, setting is_admin,
-- is_admin_approved or is_active on themselves.
--
-- Nothing in the app needs these grants: every write to doctors (signup,
-- /api/profile, /api/admin/doctors/*) goes through the service role, which
-- bypasses both grants and RLS. The user-scoped client is only used for
-- Supabase Auth.
--
-- Revoking the table privilege is the real fix; the policies are dropped as
-- well so nobody reads them later and assumes self-update is supported.

revoke insert, update, delete on public.doctors from anon, authenticated;

drop policy if exists "doctor updates own row" on public.doctors;
drop policy if exists "admin updates all doctors" on public.doctors;
