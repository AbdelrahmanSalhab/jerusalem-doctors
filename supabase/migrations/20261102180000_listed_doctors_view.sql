-- listed_doctors: who is in the directory, written once (#158).
--
-- "Listed" is five conditions on doctors: active, visible, phone verified,
-- approved by an admin, and consent to the directory. They were written out
-- in three places that had to be kept identical by hand: the card query in
-- lib/directory.ts, search_directory() and directory_counts(). A fourth
-- place that forgot one would show an unapproved or closed account, and no
-- test would notice.
--
-- This view holds them, with only the columns the directory shows (no
-- licence, no status flags, no sign-in id). The two functions read it, and so
-- does the card query; an ESLint rule keeps other code from reading the
-- doctors table directly (eslint.config.mjs).
--
-- security_invoker: the view runs with the caller's rights, so it exposes
-- nothing the caller could not already read. Like every table here it is
-- server only: no grant to anon or authenticated, so the public key sees
-- nothing through it.
--
-- search_directory() and directory_counts() are their current definitions
-- (20261024090000_clinic_hmo.sql) with only the doctors reads changed.
--
-- Apply in the Supabase SQL editor BEFORE deploying the code that reads the
-- view. Safe to run more than once.

create or replace view public.listed_doctors
with (security_invoker = true) as
select
  d.id,
  d.arabic_full_name,
  d.arabic_first_name,
  d.arabic_family_name,
  d.arabic_full_name_normalized,
  d.hebrew_first_name,
  d.hebrew_family_name,
  d.phone_display,
  d.phone_e164,
  d.profile_picture_url,
  d.email,
  d.subspecialty,
  d.subspecialty_normalized,
  d.bio,
  d.career_stage,
  d.residency_start_year,
  d.certificates,
  d.certificates_normalized,
  d.seeking_work,
  d.retired,
  d.featured,
  d.featured_at,
  d.created_at
from public.doctors d
where d.is_active and d.is_visible and d.is_phone_verified
  and d.is_admin_approved and d.consent_directory_use;

revoke all on public.listed_doctors from public, anon, authenticated;
grant select on public.listed_doctors to service_role;

CREATE OR REPLACE FUNCTION public.search_directory(p_term text DEFAULT NULL::text, p_specialty_id uuid DEFAULT NULL::uuid, p_institution_ids uuid[] DEFAULT '{}'::uuid[], p_limit integer DEFAULT 51, p_workplace_institution uuid DEFAULT NULL::uuid, p_workplace_type text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_seeking_work boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    from listed_doctors d, pattern
    where true
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
  join listed_doctors d on d.id = h.id;
$function$;

CREATE OR REPLACE FUNCTION public.directory_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with listed as (
    select d.id from listed_doctors d
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
$function$;

revoke all on function public.search_directory(text, uuid, uuid[], int, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.search_directory(text, uuid, uuid[], int, uuid, text, text, boolean) to service_role;
revoke all on function public.directory_counts() from public, anon, authenticated;
grant execute on function public.directory_counts() to service_role;

insert into public.applied_migrations (name) values ('20261102180000_listed_doctors_view') on conflict do nothing;
