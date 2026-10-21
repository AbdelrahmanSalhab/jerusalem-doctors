-- search_directory() gains the dashboard's search filters, in the same
-- single query:
--   p_workplace_institution  works at this hospital or health fund
--   p_workplace_type         has a workplace of this kind
--                            (hospital / clinic / hmo)
--   p_stage                  specialist / resident / general (طب عام, stored
--                            as no career stage)
--   p_seeking_work           only doctors looking for work
-- A workplace filter given with both an institution and a type needs one
-- workplace that is both. Every new parameter defaults to "no filter", so a
-- caller that passes only the old four parameters gets what it got before:
-- the code deployed before this migration keeps working until the new code
-- is.
--
-- The old four-parameter version is dropped first, so the API never has two
-- functions of that name to choose between.
--
-- directory_counts() also counts listed doctors per hospital or fund
-- (by_institution), so the filter lists only places with doctors.
-- Apply in the Supabase SQL editor. Safe to run more than once.

drop function if exists public.search_directory(text, uuid, uuid[], int);

create or replace function public.search_directory(
  p_term text default null,
  p_specialty_id uuid default null,
  p_institution_ids uuid[] default '{}',
  p_limit int default 51,
  p_workplace_institution uuid default null,
  p_workplace_type text default null,
  p_stage text default null,
  p_seeking_work boolean default false
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with
  pattern as (
    select '%' || p_term || '%' as p
  ),
  filter_specialties as (
    select s.id from specialties s
    where s.id = p_specialty_id or s.parent_id = p_specialty_id
  ),
  term_specialties as (
    select s.id
    from specialties s
    left join specialties parent on parent.id = s.parent_id, pattern
    where p_term is not null
      and (s.name_ar_normalized ilike pattern.p or s.name_ar ilike pattern.p
        or parent.name_ar_normalized ilike pattern.p or parent.name_ar ilike pattern.p)
  ),
  hits as (
    select d.id, d.arabic_full_name
    from doctors d, pattern
    where d.is_active and d.is_visible and d.is_phone_verified
      and d.is_admin_approved and d.consent_directory_use
      -- Works at: one hospital or fund, and/or one kind of workplace, on
      -- the same workplace row.
      and (p_workplace_institution is null and p_workplace_type is null or exists (
        select 1 from doctor_workplaces w
        where w.doctor_id = d.id
          and (p_workplace_institution is null or w.institution_id = p_workplace_institution)
          and (p_workplace_type is null or w.workplace_type = p_workplace_type)))
      -- Career stage: طب عام is stored as no stage.
      and (p_stage is null
        or (p_stage = 'general' and d.career_stage is null)
        or d.career_stage = p_stage)
      and (not p_seeking_work or d.seeking_work)
      and (p_specialty_id is null or exists (
        select 1 from doctor_specialties ds
        where ds.doctor_id = d.id and ds.specialty_id in (select id from filter_specialties)))
      and (p_term is null
        -- The full name is first + family, so it covers matches in either.
        or d.arabic_full_name_normalized ilike pattern.p
        or d.subspecialty_normalized ilike pattern.p
        or d.certificates_normalized ilike pattern.p
        or exists (
          select 1 from doctor_specialties ds
          where ds.doctor_id = d.id and ds.specialty_id in (select id from term_specialties))
        or exists (
          select 1 from doctor_workplaces w
          where w.doctor_id = d.id
            and (w.name_normalized ilike pattern.p or w.name ilike pattern.p
              or w.institution_id = any (p_institution_ids))))
    order by d.arabic_full_name collate "C"
    limit p_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'arabic_full_name', d.arabic_full_name,
      'arabic_first_name', d.arabic_first_name,
      'arabic_family_name', d.arabic_family_name,
      'hebrew_first_name', d.hebrew_first_name,
      'hebrew_family_name', d.hebrew_family_name,
      'phone_display', d.phone_display,
      'phone_e164', d.phone_e164,
      'profile_picture_url', d.profile_picture_url,
      'email', d.email,
      'subspecialty', d.subspecialty,
      'bio', d.bio,
      'career_stage', d.career_stage,
      'residency_start_year', d.residency_start_year,
      'certificates', d.certificates,
      'seeking_work', d.seeking_work,
      'retired', d.retired,
      'doctor_specialties', coalesce((
        select jsonb_agg(jsonb_build_object('specialty', jsonb_build_object('id', s.id, 'name_ar', s.name_ar)))
        from doctor_specialties ds join specialties s on s.id = ds.specialty_id
        where ds.doctor_id = d.id), '[]'::jsonb),
      'doctor_workplaces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', w.name, 'workplace_type', w.workplace_type, 'details', w.details,
          'address', w.address, 'hours', w.hours, 'phone', w.phone,
          'is_primary', w.is_primary, 'sort_order', w.sort_order))
        from doctor_workplaces w
        where w.doctor_id = d.id), '[]'::jsonb)
    )
    order by h.arabic_full_name collate "C"), '[]'::jsonb)
  from hits h
  join doctors d on d.id = h.id;
$$;

revoke all on function public.search_directory(text, uuid, uuid[], int, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.search_directory(text, uuid, uuid[], int, uuid, text, text, boolean)
  to service_role;

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
      select domain, count(*) as n from domains group by domain) c), '{}'::jsonb),
    -- Listed doctors per hospital or fund, once each however many of their
    -- workplaces it is: the search filter offers only these.
    'by_institution', coalesce((select jsonb_object_agg(institution_id, n) from (
      select w.institution_id, count(distinct w.doctor_id) as n
      from doctor_workplaces w join listed l on l.id = w.doctor_id
      where w.institution_id is not null
      group by w.institution_id) i), '{}'::jsonb)
  );
$$;

revoke all on function public.directory_counts() from public, anon, authenticated;
grant execute on function public.directory_counts() to service_role;
