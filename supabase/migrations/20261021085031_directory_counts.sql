-- directory_counts(): how many doctors the directory lists, in all and per
-- top-level specialty, as one small JSON value.
--
-- The dashboard used to download every listed doctor with their specialty
-- links to count them in the app: a payload that grows with the directory,
-- on every dashboard load. This counts where the rows are and returns
-- { "listed": n, "by_domain": { "<specialty id>": n, ... } }.
--
-- A subspecialty counts under its parent (a cardiologist under الباطنية,
-- the chip the dashboard shows), and a doctor counts once per domain however
-- many of its subspecialties they hold. "Listed" is the same rule as search
-- (search_directory) and lib/directory.ts.
-- Apply in the Supabase SQL editor. Safe to run more than once.

create or replace function public.directory_counts()
returns jsonb
language sql
stable
set search_path = public
as $$
  with listed as (
    select d.id from doctors d
    where d.is_active and d.is_visible and d.is_phone_verified
      and d.is_admin_approved and d.consent_directory_use
  ),
  domains as (
    select distinct l.id as doctor_id, coalesce(s.parent_id, s.id) as domain
    from listed l
    join doctor_specialties ds on ds.doctor_id = l.id
    join specialties s on s.id = ds.specialty_id
  )
  select jsonb_build_object(
    'listed', (select count(*) from listed),
    'by_domain', coalesce((select jsonb_object_agg(domain, n) from (
      select domain, count(*) as n from domains group by domain) c), '{}'::jsonb)
  );
$$;

revoke all on function public.directory_counts() from public, anon, authenticated;
grant execute on function public.directory_counts() to service_role;
