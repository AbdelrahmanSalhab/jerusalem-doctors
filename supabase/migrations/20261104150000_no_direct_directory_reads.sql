-- No signed-in session reads the directory tables directly (#16).
--
-- The directory is served only by the app, through the service role and the
-- listed_doctors view (accepted, visible, consenting doctors). But the
-- doctor_workplaces and doctor_specialties read policies only check the
-- doctor they describe, never who is asking, and the public key and URL ship
-- in the browser bundle. So any signed-in session, including a doctor an
-- admin has not accepted, could read
--   GET /rest/v1/doctor_workplaces?select=*
-- and get every listed doctor's workplace rows (phone, address, hours),
-- whatever the app shows or refuses. doctors is revoked with them because
-- those two policies sub-select it as the caller.
--
-- The app never reads these with a user session: the server client is used
-- only for sign-in, and every read goes through the service role. is_admin()
-- is security definer, so the policies that use it are unaffected.
-- specialties stays readable (the list of specialties is not sensitive).
--
-- Apply in the Supabase SQL editor. Safe at any time and safe to run more
-- than once. To undo: grant select on the three tables back to authenticated.

revoke select on public.doctors from anon, authenticated;
revoke select on public.doctor_workplaces from anon, authenticated;
revoke select on public.doctor_specialties from anon, authenticated;

insert into public.applied_migrations (name) values ('20261104150000_no_direct_directory_reads') on conflict do nothing;
