-- clinic_missing_details(doctors): true when one of the doctor's clinics has
-- no address or no phone.
--
-- /admin/stats counts those clinics under «يحتاج انتباهك»; the admin doctors
-- list filters on this (clinic_missing_details=is.true) so the count leads to
-- the doctors behind it. Same condition as admin_stats().
-- A PostgREST computed field, like registry_specialty().
-- Apply in the Supabase SQL editor. Safe to run more than once.

create or replace function public.clinic_missing_details(d public.doctors)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from doctor_workplaces w
    where w.doctor_id = d.id
      and w.workplace_type = 'clinic'
      and (coalesce(w.address, '') = '' or coalesce(w.phone, '') = ''));
$$;

revoke all on function public.clinic_missing_details(public.doctors)
  from public, anon, authenticated;
grant execute on function public.clinic_missing_details(public.doctors)
  to service_role;
