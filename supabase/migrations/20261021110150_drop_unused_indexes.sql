-- Drops the eight indexes Supabase's advisor reports as never used, and two
-- redundant conditions from search_directory().
--
-- They were trigram indexes for ILIKE '%term%'. Measured locally with 5,000
-- listed doctors (several times the directory's realistic size), search
-- reads the whole table and takes about 8 ms: its condition is "a name, OR a
-- specialty, OR a workplace", and an index cannot serve an OR that includes
-- a subquery, so the planner never picks them. They only made every signup
-- and profile save update up to eight indexes. Dropped:
--   doctors: arabic_full / arabic_first / arabic_family / subspecialty /
--            certificates (normalised) and hebrew_full (Hebrew search is off)
--   specialties: name_ar_normalized (about 30 rows, ever)
--   doctor_workplaces: name_normalized (read per doctor through its
--            doctor_id index)
-- ponytail: if the directory ever reaches tens of thousands, the fix is one
-- generated search column with one trigram index, not these eight.
--
-- search_directory() no longer checks the first and family names apart:
-- the stored full name is normalizeArabic(first + " " + family), so any part
-- of either is already part of it.
-- Apply in the Supabase SQL editor. Safe to run more than once.

drop index if exists public.doctors_arabic_full_norm_trgm;
drop index if exists public.doctors_arabic_first_norm_trgm;
drop index if exists public.doctors_arabic_family_norm_trgm;
drop index if exists public.doctors_subspecialty_norm_trgm;
drop index if exists public.doctors_certificates_norm_trgm;
drop index if exists public.doctors_hebrew_full_trgm;
drop index if exists public.specialties_name_ar_norm_trgm;
drop index if exists public.doctor_workplaces_name_norm_trgm;

create or replace function public.search_directory(
  p_term text default null,
  p_specialty_id uuid default null,
  p_institution_ids uuid[] default '{}',
  p_limit int default 51
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

revoke all on function public.search_directory(text, uuid, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.search_directory(text, uuid, uuid[], int)
  to service_role;
