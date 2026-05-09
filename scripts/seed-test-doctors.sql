-- Seed six fake doctors with specialties + workplaces for local search testing.
-- Run once in Supabase SQL Editor. Idempotent — safe to re-run (uses
-- ON CONFLICT (phone_e164) DO NOTHING for the doctor inserts, and specialty/
-- workplace links use NOT EXISTS guards).

-- All doctors are inserted as fully approved + visible so they show in search.
-- license_verification_status = 'verified' (synthetic — these are not real
-- licenses; do not deploy this file to production).

do $$
declare
  d_id uuid;
  s_id uuid;
begin
  ----------------------------------------------------------------------------
  -- 1. د. أحمد الخطيب — طب العائلة — مستشفى هداسا عين كارم
  ----------------------------------------------------------------------------
  insert into public.doctors (
    phone_e164, phone_display, license_number,
    arabic_first_name, arabic_family_name,
    arabic_first_name_normalized, arabic_family_name_normalized, arabic_full_name_normalized,
    hebrew_first_name, hebrew_family_name,
    email, consent_directory_use,
    is_phone_verified, is_active, is_visible, is_admin_approved,
    license_verified_at, license_verification_status
  ) values (
    '+972501111111', '050-111-1111', '100001',
    'أحمد', 'الخطيب',
    'احمد', 'الخطيب', 'احمد الخطيب',
    'אחמד', 'אלחטיב',
    'ahmad.khatib@example.test', true,
    true, true, true, true,
    now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;

  select id into s_id from public.specialties where name_ar = 'طب العائلة';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;

  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى هداسا عين كارم', 'مستشفي هداسا عين كارم', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 2. د. ليلى عبد الرحمن — الأطفال — مستشفى المقاصد
  ----------------------------------------------------------------------------
  insert into public.doctors (
    phone_e164, phone_display, license_number,
    arabic_first_name, arabic_family_name,
    arabic_first_name_normalized, arabic_family_name_normalized, arabic_full_name_normalized,
    hebrew_first_name, hebrew_family_name,
    email, consent_directory_use,
    is_phone_verified, is_active, is_visible, is_admin_approved,
    license_verified_at, license_verification_status
  ) values (
    '+972502222222', '050-222-2222', '100002',
    'ليلى', 'عبد الرحمن',
    'ليلي', 'عبد الرحمن', 'ليلي عبد الرحمن',
    'ליילה', 'עבד אלרחמן',
    'leila.abdulrahman@example.test', true,
    true, true, true, true,
    now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;

  select id into s_id from public.specialties where name_ar = 'الأطفال';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;

  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى المقاصد', 'مستشفي المقاصد', true, 0),
    (d_id, 'عيادة خاصة - الشيخ جراح', 'عيادة خاصة - الشيخ جراح', false, 1)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 3. د. محمد أبو سرحان — القلب — مستشفى شعاري تصدق + عيادة خاصة
  ----------------------------------------------------------------------------
  insert into public.doctors (
    phone_e164, phone_display, license_number,
    arabic_first_name, arabic_family_name,
    arabic_first_name_normalized, arabic_family_name_normalized, arabic_full_name_normalized,
    hebrew_first_name, hebrew_family_name,
    subspecialty, subspecialty_normalized,
    email, consent_directory_use,
    is_phone_verified, is_active, is_visible, is_admin_approved,
    license_verified_at, license_verification_status
  ) values (
    '+972503333333', '050-333-3333', '100003',
    'محمد', 'أبو سرحان',
    'محمد', 'ابو سرحان', 'محمد ابو سرحان',
    'מוחמד', 'אבו סרחאן',
    'قسطرة', 'قسطرة',
    'mohammed.abusarhan@example.test', true,
    true, true, true, true,
    now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;

  select id into s_id from public.specialties where name_ar = 'القلب';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;

  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى شعاري تصدق', 'مستشفي شعاري تصدق', true, 0),
    (d_id, 'عيادة القلب - بيت حنينا', 'عيادة القلب - بيت حنينا', false, 1)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 4. د. سارة بدر — الجلدية + الجراحة التجميلية — عيادة سارة بدر
  ----------------------------------------------------------------------------
  insert into public.doctors (
    phone_e164, phone_display, license_number,
    arabic_first_name, arabic_family_name,
    arabic_first_name_normalized, arabic_family_name_normalized, arabic_full_name_normalized,
    hebrew_first_name, hebrew_family_name,
    email, consent_directory_use,
    is_phone_verified, is_active, is_visible, is_admin_approved,
    license_verified_at, license_verification_status
  ) values (
    '+972504444444', '050-444-4444', '100004',
    'سارة', 'بدر',
    'سارة', 'بدر', 'سارة بدر',
    'שרה', 'בדר',
    'sarah.badr@example.test', true,
    true, true, true, true,
    now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;

  select id into s_id from public.specialties where name_ar = 'الجلدية';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;
  select id into s_id from public.specialties where name_ar = 'الجراحة التجميلية';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;

  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'عيادة د. سارة بدر', 'عيادة د. سارة بدر', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 5. د. خالد عيسى — العظام — مستشفى أوغوستا فكتوريا
  ----------------------------------------------------------------------------
  insert into public.doctors (
    phone_e164, phone_display, license_number,
    arabic_first_name, arabic_family_name,
    arabic_first_name_normalized, arabic_family_name_normalized, arabic_full_name_normalized,
    hebrew_first_name, hebrew_family_name,
    email, consent_directory_use,
    is_phone_verified, is_active, is_visible, is_admin_approved,
    license_verified_at, license_verification_status
  ) values (
    '+972505555555', '050-555-5555', '100005',
    'خالد', 'عيسى',
    'خالد', 'عيسي', 'خالد عيسي',
    'חאלד', 'עיסא',
    'khaled.issa@example.test', true,
    true, true, true, true,
    now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;

  select id into s_id from public.specialties where name_ar = 'العظام';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;

  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى أوغوستا فكتوريا', 'مستشفي اوغوستا فكتوريا', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 6. د. ميرنا خوري — النسائية والتوليد — مستشفى سانت جوزيف
  ----------------------------------------------------------------------------
  insert into public.doctors (
    phone_e164, phone_display, license_number,
    arabic_first_name, arabic_family_name,
    arabic_first_name_normalized, arabic_family_name_normalized, arabic_full_name_normalized,
    hebrew_first_name, hebrew_family_name,
    email, consent_directory_use,
    is_phone_verified, is_active, is_visible, is_admin_approved,
    license_verified_at, license_verification_status
  ) values (
    '+972506666666', '050-666-6666', '100006',
    'ميرنا', 'خوري',
    'ميرنا', 'خوري', 'ميرنا خوري',
    'מירנה', 'חורי',
    'mirna.khoury@example.test', true,
    true, true, true, true,
    now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;

  select id into s_id from public.specialties where name_ar = 'النسائية والتوليد';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s_id) on conflict do nothing;

  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى سانت جوزيف', 'مستشفي سانت جوزيف', true, 0)
  on conflict do nothing;
end $$;

select count(*) as test_doctors from public.doctors where license_number like '10000_';
