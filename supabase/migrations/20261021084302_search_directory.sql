-- search_directory(): the whole directory search in one query.
--
-- /api/search used to make up to seven trips to the database for one
-- search, most of them one after another: the specialty tree, then the
-- specialty, workplace and institution matches, then their doctors, then one
-- query per 150 matching doctors, merged in the app. Each trip is a network
-- round trip from Vercel; together they were most of a search's time. This
-- does the matching, the visibility rules, the order and the card's data in
-- one statement.
--
-- What a search matches, unchanged:
--   - a doctor's Arabic name (full, first, family), subspecialty or
--     certificates
--   - a specialty name, which brings in its subspecialties (الباطنية finds
--     the cardiologists)
--   - a workplace name, or a workplace linked to one of p_institution_ids
--     (the app matches institutions by any of their spellings, which needs
--     its Arabic and Hebrew normalisation, and passes the ids in)
-- and only listed doctors: active, visible, phone verified, approved,
-- consented. p_specialty_id narrows to that specialty and its
-- subspecialties.
--
-- p_term is already normalised by the app (lib/normalize/arabic.ts,
-- toIlikeTerm): letters, digits and spaces only, so it carries no LIKE
-- wildcards. Results are ordered by Arabic name in code-unit order (COLLATE
-- "C"), the order the app has always shown, and p_limit rows at most: the
-- route asks for one more than a page to know whether more matched.
--
-- Returns the cards as a JSON array in the shape lib/directory.ts reads.
-- Apply in the Supabase SQL editor. Safe to run more than once.

-- Search looks up doctor_specialties by specialty; its primary key leads
-- with the doctor, so it could not serve that.
create index if not exists doctor_specialties_specialty
  on public.doctor_specialties (specialty_id, doctor_id);

-- The one searched doctor column without a trigram index.
create index if not exists doctors_certificates_norm_trgm
  on public.doctors using gin (certificates_normalized gin_trgm_ops);

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
        or d.arabic_full_name_normalized ilike pattern.p
        or d.arabic_first_name_normalized ilike pattern.p
        or d.arabic_family_name_normalized ilike pattern.p
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
