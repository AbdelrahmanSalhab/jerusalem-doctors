-- 0005_specialty_updates.sql — specialty list edits.
-- Apply after 0003 (and 0004). Idempotent — safe to re-run.
--
-- Changes:
--   1. الطب العام becomes the first option (sort_order = 0) on signup.
--   2. أمراض الرئة renamed to أمراض الجهاز التنفسي.
--   3. Add الجراحة التجميلية + جراحة الأوعية الدموية.

-- 1) Promote الطب العام to the top of the list.
update public.specialties
   set sort_order = 0
 where name_ar = 'الطب العام';

-- 2) Rename الرئة → الجهاز التنفسي (keep id + sort_order intact so existing
--    doctor_specialties links still resolve).
update public.specialties
   set name_ar            = 'أمراض الجهاز التنفسي',
       name_ar_normalized = 'امراض الجهاز التنفسي'
 where name_ar = 'أمراض الرئة';

-- 3) Two new specialties. Sort orders chosen to sit alongside the surgical
--    block (الجراحة العامة was sort_order=15).
insert into public.specialties
  (name_ar, name_ar_normalized, name_he, name_en, sort_order, is_active)
values
  ('الجراحة التجميلية', 'الجراحة التجميلية',
   'כירורגיה פלסטית', 'Plastic Surgery', 30, true),
  ('جراحة الأوعية الدموية', 'جراحة الاوعية الدموية',
   'כירורגיית כלי דם', 'Vascular Surgery', 31, true)
on conflict do nothing;
