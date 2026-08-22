-- 0008_dual_license.sql — allow a doctor to hold licenses from both regions
-- (e.g. IL-licensed but also PS-certified, or vice versa). Apply after 0007.
--
-- The secondary license is supplementary: it's format-checked and, when it's
-- an IL number, opportunistically cross-checked against the MoH registry,
-- but it never gates account approval — only the primary license does.

alter table public.doctors
  add column if not exists secondary_license_region text
    check (secondary_license_region in ('IL', 'PS')),
  add column if not exists secondary_license_number text,
  add column if not exists secondary_license_verification_status text
    check (secondary_license_verification_status in (
      'verified', 'soft_match', 'not_found', 'name_mismatch_overridden'
    ));

alter table public.doctors
  add constraint doctors_secondary_license_pair check (
    (secondary_license_region is null) = (secondary_license_number is null)
  );

-- Multiple NULLs are allowed under a unique index (doctors with no
-- secondary license don't collide with each other).
create unique index if not exists doctors_secondary_license_key
  on public.doctors (secondary_license_region, secondary_license_number)
  where secondary_license_number is not null;
