-- 0008_signup_security_overhaul.sql — combined schema change for
-- GitHub issues #16, #17, #18, #20.
--
-- Rationale: these changes are coupled and the cutover must be atomic.
-- Splitting them across migrations creates a window where the view exists
-- but admin code still reads the column, or where the column has been
-- renamed but RLS still references the old name.
--
-- Apply once on a fresh DB or as the next migration on an existing DB.
-- Idempotent guards on the lossless steps; the column rename is
-- non-idempotent by design (Postgres DDL).

-- =========================================================================
-- 1) Email verification columns on `doctors` (#16)
-- =========================================================================

alter table public.doctors
  add column if not exists email_verified_at        timestamptz,
  add column if not exists email_domain             text,
  add column if not exists email_is_institutional   boolean not null default false,
  add column if not exists email_verification_sent_at timestamptz;

-- Backfill email_domain + email_is_institutional for existing rows so the
-- admin queue is meaningful immediately after migration. Uses the same
-- rule as the application allowlist: exact match or `.<parent>` suffix.
-- The allowlist is duplicated here only for the backfill; the application
-- code remains the source of truth going forward.
do $$
declare
  inst_domains text[] := array[
    'hadassah.org.il',
    'al-maqassed.org',
    'augustavictoria.org',
    'stjoseph-jerusalem.com',
    'szmc.org.il'
  ];
  d text;
begin
  update public.doctors
  set email_domain = lower(split_part(email, '@', 2))
  where email is not null
    and position('@' in email) > 0
    and email_domain is null;

  foreach d in array inst_domains loop
    update public.doctors
    set email_is_institutional = true
    where email_domain is not null
      and (email_domain = d or email_domain like '%.' || d)
      and email_is_institutional = false;
  end loop;
end $$;

-- =========================================================================
-- 2) Revocation sweep columns (#18)
-- =========================================================================

alter table public.doctors
  add column if not exists missing_sync_count   int not null default 0,
  add column if not exists last_seen_in_moh_at  timestamptz;

-- Extend license_verification_status check constraint to allow 'revoked'.
-- The constraint was defined inline in CREATE TABLE (0001_init.sql) with a
-- system-generated name. We cannot reliably name it; instead we drop all
-- check constraints on this column dynamically and re-add a named one.
-- Using a DO block because ALTER TABLE ... DROP CONSTRAINT requires the
-- exact name, and Postgres does not support DROP CONSTRAINT IF EXISTS on
-- system-named constraints by pattern.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname
    from pg_constraint
    where conrelid = 'public.doctors'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%license_verification_status%'
  loop
    execute format('alter table public.doctors drop constraint %I', v_name);
  end loop;
end $$;

alter table public.doctors
  add constraint doctors_license_verification_status_check
    check (license_verification_status in (
      'verified', 'soft_match', 'not_found',
      'name_mismatch_overridden', 'revoked'
    ));

-- =========================================================================
-- 3) Visibility decoupling (#20): rename + view
-- =========================================================================

-- Rename the column so any forgotten reference fails to compile / runtime
-- error rather than silently leaking. The application code is updated in
-- the same PR.
alter table public.doctors
  rename column is_visible to user_chose_visible;

-- Update the existing visibility index to cover the renamed column.
drop index if exists doctors_visibility;
create index doctors_visibility
  on public.doctors (
    is_active, user_chose_visible, is_phone_verified,
    is_admin_approved, consent_directory_use
  );

-- Re-create the visibility-bound RLS policies on `doctors` to reference
-- the new column name. Drop+create is the only safe path; ALTER POLICY
-- cannot rewrite the USING expression.
drop policy if exists "verified doctors readable by authenticated" on public.doctors;
create policy "verified doctors readable by authenticated"
  on public.doctors
  for select
  to authenticated
  using (
    is_active
    and user_chose_visible
    and is_phone_verified
    and is_admin_approved
    and consent_directory_use
  );

-- Same for the joined tables. Their EXISTS predicates must reference the
-- new column or they silently keep returning rows for unapproved doctors.
drop policy if exists "doctor_specialties readable for visible doctors" on public.doctor_specialties;
create policy "doctor_specialties readable for visible doctors"
  on public.doctor_specialties
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_specialties.doctor_id
        and (
          d.auth_user_id = auth.uid()
          or public.is_admin()
          or (
            d.is_active
            and d.user_chose_visible
            and d.is_phone_verified
            and d.is_admin_approved
            and d.consent_directory_use
          )
        )
    )
  );

drop policy if exists "doctor_workplaces readable for visible doctors" on public.doctor_workplaces;
create policy "doctor_workplaces readable for visible doctors"
  on public.doctor_workplaces
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_workplaces.doctor_id
        and (
          d.auth_user_id = auth.uid()
          or public.is_admin()
          or (
            d.is_active
            and d.user_chose_visible
            and d.is_phone_verified
            and d.is_admin_approved
            and d.consent_directory_use
          )
        )
    )
  );

-- The directory-facing view. Read-only by construction. Routes that list
-- doctors for the search UI must read from this view, not the base table.
-- Selecting from the view runs as the caller, so RLS on `doctors` still
-- applies as defence in depth.
create or replace view public.doctor_visible
  with (security_invoker = true)
  as
    select *
    from public.doctors
    where is_active
      and user_chose_visible
      and is_phone_verified
      and is_admin_approved
      and consent_directory_use;

comment on view public.doctor_visible is
  'Directory-visible doctors. Reads are gated by RLS on the underlying table; this view also enforces visibility at the relation level so a forgotten WHERE clause cannot leak unapproved profiles.';

-- =========================================================================
-- 4) One-time approval reset (#16, maintainer decision)
-- =========================================================================

-- Per the maintainer's explicit decision: every existing approved doctor
-- (other than admins, who must remain logged-in to perform the re-review)
-- is unapproved by this migration so the new institutional-email +
-- human-review pipeline can re-evaluate them. Admins are spared.
update public.doctors
   set is_admin_approved = false
 where is_admin = false
   and is_admin_approved = true;
