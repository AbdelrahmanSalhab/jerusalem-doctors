-- 12 additional fake doctors for richer search testing.
-- Run once in Supabase SQL Editor. Idempotent — safe to re-run.
-- All seeded as fully approved + visible. Synthetic data; do NOT use in
-- production with real onboarding.

do $$
declare
  d_id uuid;
  s1 uuid;
  s2 uuid;
begin
  ----------------------------------------------------------------------------
  -- 7. د. يوسف نشاشيبي — الباطنية — مستشفى المقاصد
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
    '+972507000001', '050-700-0001', '100007',
    'يوسف', 'نشاشيبي',
    'يوسف', 'نشاشيبي', 'يوسف نشاشيبي',
    'יוסף', 'נשאשיבי',
    'yousef.nashashibi@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الباطنية';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى المقاصد', 'مستشفي المقاصد', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 8. د. رنا قرعان — العيون — عيادة خاصة - بيت حنينا
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
    '+972507000002', '050-700-0002', '100008',
    'رنا', 'قرعان',
    'رنا', 'قرعان', 'رنا قرعان',
    'רנא', 'קרעאן',
    'rana.qaraan@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'العيون';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'عيادة العيون - بيت حنينا', 'عيادة العيون - بيت حنينا', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 9. د. عمر خوري — الأشعة — مستشفى أوغوستا فكتوريا
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
    '+972507000003', '050-700-0003', '100009',
    'عمر', 'خوري',
    'عمر', 'خوري', 'عمر خوري',
    'עומר', 'חורי',
    'omar.khoury@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الأشعة';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى أوغوستا فكتوريا', 'مستشفي اوغوستا فكتوريا', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 10. د. سهى قاسم — الصحة العامة — مكتب الصحة - القدس
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
    '+972507000004', '050-700-0004', '100010',
    'سهى', 'قاسم',
    'سهي', 'قاسم', 'سهي قاسم',
    'סוהא', 'קאסם',
    'soha.qasem@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الصحة العامة';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مكتب الصحة - القدس', 'مكتب الصحة - القدس', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 11. د. وسام الجعبة — الأنف والأذن والحنجرة — مستشفى هداسا
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
    '+972507000005', '050-700-0005', '100011',
    'وسام', 'الجعبة',
    'وسام', 'الجعبة', 'وسام الجعبة',
    'ויסאם', 'אלג''עבה',
    'wisam.jabeh@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الأنف والأذن والحنجرة';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى هداسا عين كارم', 'مستشفي هداسا عين كارم', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 12. د. منى عرفات — الغدد الصماء والسكري — مستشفى المقاصد
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
    '+972507000006', '050-700-0006', '100012',
    'منى', 'عرفات',
    'مني', 'عرفات', 'مني عرفات',
    'מונא', 'ערפאת',
    'سكري الأطفال', 'سكري الاطفال',
    'mona.arafat@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الغدد الصماء والسكري';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى المقاصد', 'مستشفي المقاصد', true, 0),
    (d_id, 'عيادة السكري - شعفاط', 'عيادة السكري - شعفاط', false, 1)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 13. د. كريم البديري — أمراض الجهاز التنفسي — هداسا
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
    '+972507000007', '050-700-0007', '100013',
    'كريم', 'البديري',
    'كريم', 'البديري', 'كريم البديري',
    'כרים', 'אלבדירי',
    'kareem.budairi@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'أمراض الجهاز التنفسي';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى هداسا عين كارم', 'مستشفي هداسا عين كارم', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 14. د. رشا أبو شعبان — الطب النفسي — عيادة خاصة - بيت حنينا
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
    '+972507000008', '050-700-0008', '100014',
    'رشا', 'أبو شعبان',
    'رشا', 'ابو شعبان', 'رشا ابو شعبان',
    'ראשא', 'אבו שעבאן',
    'علاج معرفي سلوكي', 'علاج معرفي سلوكي',
    'rasha.abushaaban@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الطب النفسي';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'عيادة الطب النفسي - بيت حنينا', 'عيادة الطب النفسي - بيت حنينا', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 15. د. باسل العلمي — الجراحة العامة — مستشفى المقاصد + عيادة خاصة
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
    '+972507000009', '050-700-0009', '100015',
    'باسل', 'العلمي',
    'باسل', 'العلمي', 'باسل العلمي',
    'באסל', 'אלעלמי',
    'basel.alami@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الجراحة العامة';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى المقاصد', 'مستشفي المقاصد', true, 0),
    (d_id, 'عيادة الجراحة - الشيخ جراح', 'عيادة الجراحة - الشيخ جراح', false, 1)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 16. د. لارا خميس — الطب الطبيعي وإعادة التأهيل — بيت لحم
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
    '+972507000010', '050-700-0010', '100016',
    'لارا', 'خميس',
    'لارا', 'خميس', 'لارا خميس',
    'לארא', 'חמיס',
    'lara.khamis@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'الطب الطبيعي وإعادة التأهيل';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مركز إعادة التأهيل - بيت لحم', 'مركز اعادة التاهيل - بيت لحم', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 17. د. طارق دندس — جراحة الأوعية الدموية — هداسا
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
    '+972507000011', '050-700-0011', '100017',
    'طارق', 'دندس',
    'طارق', 'دندس', 'طارق دندس',
    'טארק', 'דנדס',
    'tareq.dandis@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'جراحة الأوعية الدموية';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  select id into s2 from public.specialties where name_ar = 'الجراحة العامة';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s2) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى هداسا عين كارم', 'مستشفي هداسا عين كارم', true, 0)
  on conflict do nothing;

  ----------------------------------------------------------------------------
  -- 18. د. هبة شويكي — أمراض الكلى — مستشفى المقاصد
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
    '+972507000012', '050-700-0012', '100018',
    'هبة', 'شويكي',
    'هبة', 'شويكي', 'هبة شويكي',
    'היבא', 'שוויכי',
    'heba.shweiki@example.test', true,
    true, true, true, true, now(), 'verified'
  )
  on conflict (phone_e164) do update set arabic_first_name = excluded.arabic_first_name
  returning id into d_id;
  select id into s1 from public.specialties where name_ar = 'أمراض الكلى';
  insert into public.doctor_specialties (doctor_id, specialty_id) values (d_id, s1) on conflict do nothing;
  insert into public.doctor_workplaces (doctor_id, name, name_normalized, is_primary, sort_order) values
    (d_id, 'مستشفى المقاصد', 'مستشفي المقاصد', true, 0)
  on conflict do nothing;
end $$;

select arabic_first_name, arabic_family_name, license_number, phone_e164
  from public.doctors
 where license_number between '100007' and '100018'
 order by license_number;
