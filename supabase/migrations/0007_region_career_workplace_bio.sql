-- 0007_region_career_workplace_bio.sql
-- Adds license region (IL/PS), auto-derived career stage (resident/
-- specialist), free-text bio, and workplace type (hospital/clinic) +
-- optional details. Apply after 0006.
--
-- Context: the MoH license-verification flow (plan §13) only covers the
-- Israeli registry. Doctors licensed by the Palestinian Ministry of
-- Health/Medical Council have no equivalent public registry we could find
-- (checked 2026-08-22) — their signups route straight to manual admin
-- review instead of an automated license-number/name cross-check.

alter table public.doctors
  add column if not exists license_region text not null default 'IL'
    check (license_region in ('IL', 'PS')),
  add column if not exists career_stage text
    check (career_stage in ('resident', 'specialist')),
  add column if not exists bio text
    check (bio is null or char_length(bio) <= 600);

-- Hebrew name was required for every signup because it was only ever used
-- to cross-check the Israeli registry. PS-track doctors have nothing to
-- cross-check against, so forcing a Hebrew name on them is a pure signup
-- blocker with no verification benefit — relax to optional.
alter table public.doctors
  alter column hebrew_first_name drop not null,
  alter column hebrew_family_name drop not null;

-- License numbers are only unique *within* an issuing region — an IL and a
-- PS doctor could coincidentally share the same license number string.
alter table public.doctors drop constraint if exists doctors_license_number_key;
alter table public.doctors
  add constraint doctors_license_region_number_key unique (license_region, license_number);

alter table public.doctor_workplaces
  add column if not exists workplace_type text not null default 'hospital'
    check (workplace_type in ('hospital', 'clinic')),
  add column if not exists details text
    check (details is null or char_length(details) <= 300);
