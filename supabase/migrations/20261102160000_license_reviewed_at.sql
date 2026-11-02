-- doctors.license_reviewed_at: an admin has looked at this doctor's licence.
--
-- «ترخيص يحتاج مراجعة» on /admin counted every licence the registry had not
-- confirmed, reviewed or not: a Palestinian licence (no registry to check it
-- against) or an Israeli one the registry does not list stayed in it for
-- good, even after an admin accepted the doctor with a reason. The tile now
-- counts licences that are not verified AND not reviewed.
--
-- Set by an admin: approving a doctor with a reason, saving the primary
-- licence, or «تمت المراجعة» in the licence section. Cleared when the
-- registry sync flags the licence as gone, so it comes back to the queue.
--
-- Backfill: the doctors an admin approved with a recorded reason (the
-- audit log's approval_reason) are marked, at the time of that approval.
-- The ones approved without a reason stay in the queue until someone looks.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

alter table public.doctors add column if not exists license_reviewed_at timestamptz;

update public.doctors d
   set license_reviewed_at = r.at
  from (
    select target_doctor_id as id, max(created_at) as at
      from public.audit_logs
     where action = 'admin_doctor_updated'
       and metadata ? 'approval_reason'
       and (metadata->>'is_admin_approved') = 'true'
     group by target_doctor_id
  ) r
 where d.id = r.id
   and d.license_reviewed_at is null;

insert into public.applied_migrations (name) values ('20261102160000_license_reviewed_at') on conflict do nothing;
