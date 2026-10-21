-- registry_specialty(doctors): the specialty the Israeli MoH registry lists
-- for a doctor's licence, or null.
--
-- The registry names a specialty only once the board certificate is granted,
-- so a doctor marked طبيب مقيم whose licence has one is almost certainly a
-- specialist who picked the wrong stage. Until #96 that was the only stage
-- that could list a صندوق مرضى workplace, so many did. The admin doctors list
-- filters on this to find them.
--
-- A function taking the doctors row is a PostgREST computed field: it can be
-- selected and filtered on like a column (registry_specialty=not.is.null).
-- Blank specialties count as none, as in lib/moh/match.ts.
-- Apply in the Supabase SQL editor. Safe to run more than once.

create or replace function public.registry_specialty(d public.doctors)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(btrim(m.specialty_name_he), '')
  from moh_practitioners m
  where d.license_region = 'IL'
    -- Inside a case, so the cast only ever sees digits: Postgres does not
    -- promise to test the conditions of a where clause in order.
    and m.license_number = case when d.license_number ~ '^[0-9]{1,9}$' then d.license_number::int end;
$$;

revoke all on function public.registry_specialty(public.doctors)
  from public, anon, authenticated;
grant execute on function public.registry_specialty(public.doctors)
  to service_role;
