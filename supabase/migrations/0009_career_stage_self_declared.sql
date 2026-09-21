-- 0009_career_stage_self_declared.sql
-- Career stage becomes self-declared at signup instead of inferred from the
-- Israeli MoH registry. Apply after 0008. Idempotent — safe to re-run.
--
-- Why: 0007 derived career_stage from the registry's `שם התמחות` column — a
-- blank specialty was read as "resident". Blank actually means "holds no
-- board certificate", which covers residents AND general practitioners, so
-- real GPs were badged طبيب مقيم. The column keeps its two values; طب عام is
-- represented by NULL (no new enum value), and the doctor declares it.
--
-- Changes:
--   1. doctor_workplaces.workplace_type gains 'hmo' (صندوق مرضى) — where
--      residents actually work, and where neither hospital nor clinic fit.
--   2. doctors.residency_start_year — asked of residents only. No DB-level
--      cross-field rule: the stage is self-declared and the legal
--      combinations are enforced in the form, not the schema.
--   3. specialties.code — a stable, rename-proof handle. The signup form has
--      to find الطب العام at runtime (auto-attach it for طب عام, filter it
--      out of the grid for the other two stages), and an admin can rename
--      any specialty from /admin/specialties, so a name match is fragile.

-- ---------- 1) workplace_type gains 'hmo' ----------
-- 0007 declared the check inline, so Postgres auto-named it
-- doctor_workplaces_workplace_type_check. Drop by predicate rather than by
-- name so this still works if it ended up named otherwise.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname  = 'public'
       and rel.relname = 'doctor_workplaces'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%workplace_type%'
  loop
    execute format(
      'alter table public.doctor_workplaces drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.doctor_workplaces
  add constraint doctor_workplaces_workplace_type_check
  check (workplace_type in ('hospital', 'clinic', 'hmo'));

-- ---------- 2) residency start year ----------
-- The upper bound is a fixed literal rather than an expression over now():
-- a CHECK has to stay immutable or a later dump/restore can fail on rows
-- that were perfectly valid when written. "Not in the future" is a UI rule.
alter table public.doctors
  add column if not exists residency_start_year int
    check (
      residency_start_year is null
      or residency_start_year between 1950 and 2100
    );

-- ---------- 3) stable specialty code ----------
alter table public.specialties
  add column if not exists code text;

-- Nullable + unique: POST /api/admin/specialties inserts no code at all, and
-- Postgres permits unlimited NULLs under a unique constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'specialties_code_key'
  ) then
    alter table public.specialties
      add constraint specialties_code_key unique (code);
  end if;
end $$;

-- One-shot name match, same technique as 0005. A migration-time lookup at a
-- known point in history, not a runtime dependency.
update public.specialties
   set code = 'general'
 where name_ar = 'الطب العام'
   and code is distinct from 'general';

-- Fail loudly if the row was renamed before this ran, rather than letting the
-- signup form quietly lose its الطب العام handle.
do $$
begin
  if not exists (select 1 from public.specialties where code = 'general') then
    raise exception
      'specialties: no row carries code=''general''. Set it by hand '
      '(update public.specialties set code = ''general'' where id = ...) '
      'then re-run 0009.';
  end if;
end $$;
