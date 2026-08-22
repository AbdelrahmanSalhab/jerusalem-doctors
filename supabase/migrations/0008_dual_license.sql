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

-- ---------- cross-slot license uniqueness ----------
-- A doctor now has up to two (region, license_number) pairs — primary and
-- secondary. A plain unique index on the primary columns and another on the
-- secondary columns (what an earlier version of this migration did) only
-- catches primary-vs-primary and secondary-vs-secondary collisions; it does
-- NOT stop the same license number from being registered as one doctor's
-- primary and a different doctor's secondary. A SELECT-based check in
-- application code (see app/api/signup/start) can't close that gap either —
-- two concurrent signups can both pass the SELECT before either commits.
--
-- This mirror table gives every logical (region, license_number) slot a
-- real row with a real UNIQUE constraint, so Postgres itself serializes
-- concurrent inserts and the second one gets a genuine unique_violation
-- instead of racing past a check. It's kept in sync by triggers — nothing
-- reads or writes it directly except the trigger function below.
create table public.doctor_license_slots (
  doctor_id      uuid not null references public.doctors(id) on delete cascade,
  slot           text not null check (slot in ('primary', 'secondary')),
  license_region text not null check (license_region in ('IL', 'PS')),
  license_number text not null,
  primary key (doctor_id, slot),
  unique (license_region, license_number)
);

alter table public.doctor_license_slots enable row level security;
-- Deny-all for everyone except service role. Nothing outside the trigger
-- below ever reads or writes this table.

create or replace function public.tg_sync_doctor_license_slots()
returns trigger language plpgsql as $$
begin
  delete from public.doctor_license_slots where doctor_id = new.id;

  insert into public.doctor_license_slots (doctor_id, slot, license_region, license_number)
  values (new.id, 'primary', new.license_region, new.license_number);

  if new.secondary_license_region is not null and new.secondary_license_number is not null then
    insert into public.doctor_license_slots (doctor_id, slot, license_region, license_number)
    values (new.id, 'secondary', new.secondary_license_region, new.secondary_license_number);
  end if;

  return new;
end;
$$;

create trigger doctors_sync_license_slots
  after insert or update of
    license_region, license_number,
    secondary_license_region, secondary_license_number
  on public.doctors
  for each row execute function public.tg_sync_doctor_license_slots();

-- Backfill for any doctors inserted before this trigger existed (none yet
-- in a fresh deploy, but harmless / idempotent either way).
insert into public.doctor_license_slots (doctor_id, slot, license_region, license_number)
select id, 'primary', license_region, license_number from public.doctors
on conflict do nothing;

insert into public.doctor_license_slots (doctor_id, slot, license_region, license_number)
select id, 'secondary', secondary_license_region, secondary_license_number
from public.doctors
where secondary_license_region is not null and secondary_license_number is not null
on conflict do nothing;
