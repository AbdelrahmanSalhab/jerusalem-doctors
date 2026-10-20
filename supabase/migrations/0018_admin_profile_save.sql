-- 0018: let the profile save reach the identity fields, for admins.
--
-- save_doctor_profile (0014) is both the transaction boundary and the column
-- allow-list for a profile save. An admin can now edit any part of a doctor's
-- profile, including the four fields a doctor cannot change for themselves:
-- the Hebrew name (which the licence matcher compares against the registry)
-- and the phone number with its display spelling, plus the verified flag.
--
-- They go in the function rather than a second UPDATE in the route so the
-- whole save stays one transaction: phone_e164 is UNIQUE, and a collision
-- must abort the name and workplace half of the same save, not leave it
-- committed.
--
-- NOT in the list, on purpose:
--   arabic_full_name, hebrew_full_name  -- generated always as ... stored;
--     naming either here raises "cannot insert into a generated column".
--     Note arabic_full_name_normalized IS a real column and does belong.
--   profile_picture_url  -- only the photo routes write it, with their own
--     update, right after the upload succeeds.
--
-- Apply in the Supabase SQL editor BEFORE deploying the code that calls it:
-- against the old function the new keys are silently ignored, so an admin's
-- phone edit would report success and change nothing.

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
       certificates, certificates_normalized, seeking_work)
    = (select r.arabic_first_name, r.arabic_first_name_normalized,
              r.arabic_family_name, r.arabic_family_name_normalized,
              r.arabic_full_name_normalized, r.hebrew_first_name,
              r.hebrew_family_name, r.phone_e164, r.phone_display,
              r.is_phone_verified, r.email, r.subspecialty,
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
