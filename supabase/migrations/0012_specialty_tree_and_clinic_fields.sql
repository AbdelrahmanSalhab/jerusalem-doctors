-- 0012_specialty_tree_and_clinic_fields.sql
-- Signup feedback round. Apply after 0011. Idempotent: safe to re-run.
--
-- Changes:
--   1. specialties.parent_id: one level of nesting. An internist is asked
--      for their subspecialty (الكلى, الروماتيزم, ...) and only that is
--      stored and shown; "باطنية عامة" stores الباطنية itself. Search and
--      the specialty filter expand a parent to its children.
--   2. A stable `code` on every seeded specialty (0009 only gave one to
--      الطب العام), so this and later migrations never match on a name an
--      admin can edit.
--   3. sort_order re-ranked most common first. Names are unchanged.
--   4. Doctors linked to both الباطنية and one of its subspecialties keep
--      only the subspecialty.
--   5. doctor_workplaces.address / hours / phone for a specialist's عيادة,
--      replacing the single free-text `details` line. `details` stays: old
--      rows keep it and cards fall back to it.

-- ---------- 1) parent_id ----------
alter table public.specialties
  add column if not exists parent_id uuid
    references public.specialties(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'specialties_parent_not_self'
  ) then
    alter table public.specialties
      add constraint specialties_parent_not_self check (parent_id <> id);
  end if;
end $$;

create index if not exists specialties_parent_id_idx
  on public.specialties (parent_id);

-- ---------- 2 + 3) codes, order, parents ----------
-- One row per seeded specialty (0003 + 0005). Matched on the seeded English
-- OR Arabic name, since /admin/specialties can rename either, and only where
-- no code is set yet. Rows an admin added later keep their sort_order and
-- sit after these.
-- Dropped explicitly rather than ON COMMIT DROP, which would vanish
-- straight after CREATE when this file is run statement by statement.
drop table if exists pg_temp._seed;
create temporary table _seed (
  code text primary key,
  name_en text,
  name_ar text,
  sort_order int,
  parent_code text
);

insert into _seed (code, name_en, name_ar, sort_order, parent_code) values
  ('general',               'General Medicine',                     'الطب العام',                   0,  null),
  ('family_medicine',       'Family Medicine',                      'طب العائلة',                   1,  null),
  ('internal_medicine',     'Internal Medicine',                    'الباطنية',                     2,  null),
  ('pediatrics',            'Pediatrics',                           'الأطفال',                      3,  null),
  ('obgyn',                 'Obstetrics and Gynecology',            'النسائية والتوليد',            4,  null),
  ('general_surgery',       'General Surgery',                      'الجراحة العامة',               5,  null),
  ('orthopedics',           'Orthopedics',                          'العظام',                       6,  null),
  ('cardiology',            'Cardiology',                           'القلب',                        7,  'internal_medicine'),
  ('emergency',             'Emergency Medicine',                   'الطوارئ',                      8,  null),
  ('anesthesiology',        'Anesthesiology',                       'التخدير',                      9,  null),
  ('radiology',             'Radiology',                            'الأشعة',                       10, null),
  ('psychiatry',            'Psychiatry',                           'الطب النفسي',                  11, null),
  ('ophthalmology',         'Ophthalmology',                        'العيون',                       12, null),
  ('ent',                   'Otolaryngology (ENT)',                 'الأنف والأذن والحنجرة',        13, null),
  ('dermatology',           'Dermatology',                          'الجلدية',                      14, null),
  ('neurology',             'Neurology',                            'الأعصاب',                      15, null),
  ('urology',               'Urology',                              'المسالك البولية',              16, null),
  ('gastroenterology',      'Gastroenterology',                     'الجهاز الهضمي',                17, 'internal_medicine'),
  ('endocrinology',         'Endocrinology and Diabetes',           'الغدد الصماء والسكري',         18, 'internal_medicine'),
  ('nephrology',            'Nephrology',                           'أمراض الكلى',                  19, 'internal_medicine'),
  ('pulmonology',           'Pulmonology',                          'أمراض الجهاز التنفسي',         20, 'internal_medicine'),
  ('oncology',              'Oncology',                             'الأورام',                      21, null),
  ('hematology',            'Hematology',                           'أمراض الدم',                   22, 'internal_medicine'),
  ('infectious_diseases',   'Infectious Diseases',                  'الأمراض المعدية',              23, 'internal_medicine'),
  ('rheumatology',          'Rheumatology',                         'الروماتيزم',                   24, 'internal_medicine'),
  ('geriatrics',            'Geriatrics',                           'طب الشيخوخة',                  25, 'internal_medicine'),
  ('rehabilitation',        'Physical Medicine and Rehabilitation', 'الطب الطبيعي وإعادة التأهيل',  26, null),
  ('plastic_surgery',       'Plastic Surgery',                      'الجراحة التجميلية',            27, null),
  ('vascular_surgery',      'Vascular Surgery',                     'جراحة الأوعية الدموية',        28, null),
  ('public_health',         'Public Health',                        'الصحة العامة',                 29, null),
  ('occupational_medicine', 'Occupational Medicine',                'طب العمل',                     30, null);

-- Give each seeded row its code. A code already held by some row is left
-- alone (that row is the one, whatever its current name).
update public.specialties sp
   set code = s.code
  from _seed s
 where sp.code is null
   and (sp.name_en = s.name_en or sp.name_ar = s.name_ar)
   and not exists (select 1 from public.specialties x where x.code = s.code);

-- The rest goes by code only.
update public.specialties sp
   set sort_order = s.sort_order
  from _seed s
 where sp.code = s.code
   and sp.sort_order is distinct from s.sort_order;

update public.specialties child
   set parent_id = parent.id
  from _seed s
  join public.specialties parent on parent.code = s.parent_code
 where child.code = s.code
   and s.parent_code is not null
   and child.parent_id is distinct from parent.id;

-- A row renamed in both languages can't be matched and keeps its old
-- order and no parent. Name it so whoever applies this can fix it by hand.
do $$
declare missing text;
begin
  select string_agg(s.code, ', ') into missing
    from _seed s
   where not exists (select 1 from public.specialties sp where sp.code = s.code);
  if missing is not null then
    raise notice 'specialties: no row matched seed code(s): %', missing;
  end if;
end $$;

drop table if exists pg_temp._seed;

-- An internist already linked to both الباطنية and a subspecialty would
-- still show الباطنية on their card. Keep only the subspecialty, as the new
-- picker would. Doctors with الباطنية alone are untouched (باطنية عامة).
delete from public.doctor_specialties ds
 using public.specialties parent
 where ds.specialty_id = parent.id
   and exists (
     select 1
       from public.doctor_specialties other
       join public.specialties child on child.id = other.specialty_id
      where other.doctor_id = ds.doctor_id
        and child.parent_id = parent.id
   );

-- The signup form's subspecialty question hangs off this row. Fail loudly
-- rather than ship a form that silently lost it.
do $$
begin
  if not exists (
    select 1 from public.specialties where code = 'internal_medicine'
  ) then
    raise exception
      'specialties: no row matched Internal Medicine / الباطنية. Set it by '
      'hand (update public.specialties set code = ''internal_medicine'' '
      'where id = ...) then re-run 0012.';
  end if;
end $$;

-- ---------- 5) clinic fields ----------
alter table public.doctor_workplaces
  add column if not exists address text check (char_length(address) <= 200),
  add column if not exists hours   text check (char_length(hours)   <= 120),
  add column if not exists phone   text check (char_length(phone)   <= 30);
