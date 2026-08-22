-- Seed a single "dev doctor" for local development.
--
-- Run once in Supabase SQL Editor. After running, copy the printed UUID into
-- your local .env.local as DEV_DOCTOR_ID, then set USE_DEV_USER=1.
--
-- The dev doctor exists in the doctors table without a paired auth.users row,
-- so RLS would normally block access. Pages using `getCurrentDoctor()` go
-- through the service-role client, which bypasses RLS — fine for dev.

with new_doctor as (
  insert into public.doctors (
    auth_user_id,
    phone_e164,
    phone_display,
    arabic_first_name,
    arabic_family_name,
    arabic_first_name_normalized,
    arabic_family_name_normalized,
    arabic_full_name_normalized,
    hebrew_first_name,
    hebrew_family_name,
    license_number,
    license_verification_status,
    license_verified_at,
    consent_directory_use,
    is_phone_verified,
    is_admin_approved,
    is_active,
    user_chose_visible,
    is_admin
  ) values (
    null,
    '+972500000001',
    '050-000-0001',
    'مطور',
    'تجريبي',
    'مطور',
    'تجريبي',
    'مطور تجريبي',
    'מפתח',
    'ניסיון',
    '999000',
    'verified',
    now(),
    true,
    true,
    true,
    true,
    true,
    true                -- admin so dev can hit /admin pages too
  )
  on conflict (phone_e164) do update
    set arabic_first_name = excluded.arabic_first_name
  returning id
)
select id as dev_doctor_id from new_doctor;
