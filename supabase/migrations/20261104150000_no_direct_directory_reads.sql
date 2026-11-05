-- No signed-in session reads the directory tables directly (#16).
--
-- The directory is served only by the app, through the service role and the
-- listed_doctors view (accepted, visible, consenting doctors). Until now a
-- signed-in session could still read these tables itself through the REST API
-- (the public key and URL ship in the browser bundle), limited by their read
-- policies to the caller's own row (a non-admin) or everything (an admin).
-- That was already narrow, but it left a second way to the data that the app's
-- own rules (accepted doctors only, second factor for admins) do not govern.
-- This takes it away, and drops the read policies so a later blanket
-- "grant select on all tables to authenticated" cannot silently bring it back.
--
-- The app never reads these with a user session: the server client is used only
-- for sign-in, and every read goes through the service role. is_admin() is
-- security definer, so the policies that use it elsewhere are unaffected.
-- specialties stays readable (the list of specialties is not sensitive).
--
-- Apply in the Supabase SQL editor. Safe at any time and safe to run more than
-- once. To undo: recreate the three policies (see 20261021103844_supabase_lint.sql)
-- and grant select on the tables back to authenticated.

revoke select on public.doctors from anon, authenticated;
revoke select on public.doctor_workplaces from anon, authenticated;
revoke select on public.doctor_specialties from anon, authenticated;

drop policy if exists "doctor or admin reads doctors" on public.doctors;
drop policy if exists "doctor_workplaces readable for visible doctors" on public.doctor_workplaces;
drop policy if exists "doctor_specialties readable for visible doctors" on public.doctor_specialties;

insert into public.applied_migrations (name) values ('20261104150000_no_direct_directory_reads') on conflict do nothing;
