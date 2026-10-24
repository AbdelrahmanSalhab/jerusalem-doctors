-- A clinic can belong to a health fund (صندوق مرضى); the fund as a
-- workplace of its own is for residents only again (lib/careerStage.ts).
--
--   doctor_workplaces.hmo_id  the fund a clinic belongs to (institutions of
--                             kind hmo), clinics only
--
-- save_doctor_profile() stores it; search_directory() counts a clinic as its
-- fund (the fund filter, "كل صناديق المرضى", and a search for the fund's
-- name) and returns the fund's name for the card; directory_counts() counts
-- the clinic's doctor for the fund.
--
-- Apply in the Supabase SQL editor before the code that uses it. Safe to run
-- more than once.

alter table public.doctor_workplaces
  add column if not exists hmo_id uuid references public.institutions (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'doctor_workplaces_hmo_only_on_clinics') then
    alter table public.doctor_workplaces
      add constraint doctor_workplaces_hmo_only_on_clinics
      check (hmo_id is null or workplace_type = 'clinic');
  end if;
end $$;

-- The fund filter and the foreign key (deleting a fund).
create index if not exists doctor_workplaces_hmo on public.doctor_workplaces (hmo_id)
  where hmo_id is not null;

create or replace function public.save_doctor_profile(
  p_doctor_id uuid,
  p_updates jsonb,
  p_specialty_ids uuid[],
  p_workplaces jsonb
) returns void
language plpgsql
set search_path = public
as $$
begin
  if p_updates is not null and p_updates <> '{}'::jsonb then
    update public.doctors d set
      (arabic_first_name, arabic_first_name_normalized,
       arabic_family_name, arabic_family_name_normalized,
       arabic_full_name_normalized, hebrew_first_name, hebrew_family_name,
       phone_e164, phone_display, is_phone_verified, email, subspecialty,
       subspecialty_normalized, bio, career_stage, residency_start_year,
       certificates, certificates_normalized, seeking_work, retired)
    = (select r.arabic_first_name, r.arabic_first_name_normalized,
              r.arabic_family_name, r.arabic_family_name_normalized,
              r.arabic_full_name_normalized, r.hebrew_first_name,
              r.hebrew_family_name, r.phone_e164, r.phone_display,
              r.is_phone_verified, r.email, r.subspecialty,
              r.subspecialty_normalized, r.bio, r.career_stage,
              r.residency_start_year, r.certificates,
              r.certificates_normalized, r.seeking_work, r.retired
         from jsonb_populate_record(d, p_updates) r)
    where d.id = p_doctor_id;
  end if;

  if p_specialty_ids is not null then
    delete from public.doctor_specialties where doctor_id = p_doctor_id;
    insert into public.doctor_specialties (doctor_id, specialty_id)
    select p_doctor_id, s from unnest(p_specialty_ids) as s;
  end if;

  if p_workplaces is not null then
    delete from public.doctor_workplaces where doctor_id = p_doctor_id;
    insert into public.doctor_workplaces
      (doctor_id, name, name_normalized, workplace_type, details, address,
       hours, phone, hmo_id, is_primary, sort_order)
    select p_doctor_id, w.name, w.name_normalized, w.workplace_type,
           w.details, w.address, w.hours, w.phone, w.hmo_id, w.is_primary,
           w.sort_order
      from jsonb_to_recordset(p_workplaces) as w(
        name text, name_normalized text, workplace_type text, details text,
        address text, hours text, phone text, hmo_id uuid, is_primary boolean,
        sort_order int);
  end if;
end;
$$;

revoke all on function public.save_doctor_profile(uuid, jsonb, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.save_doctor_profile(uuid, jsonb, uuid[], jsonb)
  to service_role;

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
      -- the same workplace row. A clinic that belongs to a fund counts as
      -- that fund, and as a صندوق مرضى workplace.
      and (p_workplace_institution is null and p_workplace_type is null or exists (
        select 1 from doctor_workplaces w
        where w.doctor_id = d.id
          and (p_workplace_institution is null
            or w.institution_id = p_workplace_institution or w.hmo_id = p_workplace_institution)
          and (p_workplace_type is null or w.workplace_type = p_workplace_type
            or (p_workplace_type = 'hmo' and w.hmo_id is not null))))
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
              or w.institution_id = any (p_institution_ids)
              or w.hmo_id = any (p_institution_ids))))
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
          'hmo', fund.name_ar,
          'is_primary', w.is_primary, 'sort_order', w.sort_order))
        from doctor_workplaces w
        left join institutions fund on fund.id = w.hmo_id
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
    -- workplaces it is (a clinic counts for its fund too): the search filter
    -- offers only these.
    'by_institution', coalesce((select jsonb_object_agg(institution_id, n) from (
      select x.institution_id, count(distinct x.doctor_id) as n
      from (
        select w.doctor_id, w.institution_id from doctor_workplaces w where w.institution_id is not null
        union all
        select w.doctor_id, w.hmo_id from doctor_workplaces w where w.hmo_id is not null
      ) x join listed l on l.id = x.doctor_id
      group by x.institution_id) i), '{}'::jsonb)
  );
$$;

revoke all on function public.directory_counts() from public, anon, authenticated;
grant execute on function public.directory_counts() to service_role;
