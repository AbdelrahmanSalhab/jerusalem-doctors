-- doctors.approved_at: when an admin accepted this doctor.
--
-- «جديد هذا الأسبوع» was keyed on created_at. That was the same as "listed
-- since" while a registry match approved at signup; now that every signup
-- waits for an admin (#16), a doctor accepted a week after signing up would
-- never show there, and one accepted on day five would show for two days.
-- The section is now keyed on approval time.
--
-- Set by PATCH /api/admin/doctors/[id] when it accepts (cleared when it
-- withdraws). Backfill: the time of the latest admin acceptance in the audit
-- log, else the signup time (those were approved at signup).
--
-- listed_doctors gets the column appended as its last column (create or
-- replace view only allows appending). Nothing else about it changes.
--
-- Apply in the Supabase SQL editor BEFORE deploying the code that uses it
-- (applied on production on 4 Nov 2026). Without it the "new this week"
-- section shows nothing (its read fails and is logged), AND accepting or
-- withdrawing a doctor fails with a 500, because that PATCH writes the column.
-- Safe to run more than once.

alter table public.doctors add column if not exists approved_at timestamptz;

update public.doctors d
   set approved_at = coalesce(
         (select max(a.created_at)
            from public.audit_logs a
           where a.target_doctor_id = d.id
             and a.action = 'admin_doctor_updated'
             and (a.metadata->>'is_admin_approved') = 'true'),
         d.created_at)
 where d.is_admin_approved and d.approved_at is null;

create or replace view public.listed_doctors
with (security_invoker = true) as
select
  d.id,
  d.arabic_full_name,
  d.arabic_first_name,
  d.arabic_family_name,
  d.arabic_full_name_normalized,
  d.hebrew_first_name,
  d.hebrew_family_name,
  d.phone_display,
  d.phone_e164,
  d.profile_picture_url,
  d.email,
  d.subspecialty,
  d.subspecialty_normalized,
  d.bio,
  d.career_stage,
  d.residency_start_year,
  d.certificates,
  d.certificates_normalized,
  d.seeking_work,
  d.retired,
  d.featured,
  d.featured_at,
  d.created_at,
  d.approved_at
from public.doctors d
where d.is_active and d.is_visible and d.is_phone_verified
  and d.is_admin_approved and d.consent_directory_use;

revoke all on public.listed_doctors from public, anon, authenticated;
grant select on public.listed_doctors to service_role;

insert into public.applied_migrations (name) values ('20261104130000_approved_at') on conflict do nothing;
