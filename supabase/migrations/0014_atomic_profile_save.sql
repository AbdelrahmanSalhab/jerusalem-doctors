-- 0014: save a profile in one transaction, and no blanket directory read.
--
-- 1. save_doctor_profile: /api/profile used to update the doctor row, then
--    delete and re-insert specialties, then delete and re-insert workplaces,
--    as separate requests. A failure between a delete and its insert left
--    the doctor with no specialties or no workplaces, after the rest of the
--    profile had already been saved. One function call is one transaction:
--    all of it lands or none of it does.
--
--    p_updates holds only the doctor columns being changed (absent keys keep
--    their value, an explicit JSON null writes NULL). A NULL p_specialty_ids
--    or p_workplaces leaves that list alone; an empty one clears it.
--
-- 2. Drops "verified doctors readable by authenticated". The app reads the
--    directory with the service role only, so the policy served nothing, but
--    it let any signed-in JWT read every column of every listed doctor
--    straight from PostgREST. Own-row and admin policies stay.
--
-- Apply in the Supabase SQL editor before deploying the code that calls it.

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
       arabic_full_name_normalized, email, subspecialty,
       subspecialty_normalized, bio, career_stage, residency_start_year,
       certificates, certificates_normalized, seeking_work)
    = (select r.arabic_first_name, r.arabic_first_name_normalized,
              r.arabic_family_name, r.arabic_family_name_normalized,
              r.arabic_full_name_normalized, r.email, r.subspecialty,
              r.subspecialty_normalized, r.bio, r.career_stage,
              r.residency_start_year, r.certificates,
              r.certificates_normalized, r.seeking_work
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
       hours, phone, is_primary, sort_order)
    select p_doctor_id, w.name, w.name_normalized, w.workplace_type,
           w.details, w.address, w.hours, w.phone, w.is_primary, w.sort_order
      from jsonb_to_recordset(p_workplaces) as w(
        name text, name_normalized text, workplace_type text, details text,
        address text, hours text, phone text, is_primary boolean,
        sort_order int);
  end if;
end;
$$;

revoke all on function public.save_doctor_profile(uuid, jsonb, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.save_doctor_profile(uuid, jsonb, uuid[], jsonb)
  to service_role;

drop policy if exists "verified doctors readable by authenticated" on public.doctors;
