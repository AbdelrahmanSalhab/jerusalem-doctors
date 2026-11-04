-- doctors.identity_reviewed_at: an admin has satisfied themselves this doctor is
-- who they say (#16).
--
-- A registry match on the typed name and licence is public data matched against
-- itself, so until #244 a doctor could be accepted at signup by it alone, and
-- 99 of the 133 accounts were. Nothing marked them, so no admin could tell who
-- had been looked at. This column does: set when an admin accepts a doctor
-- (with the method and reason now asked for) or when an admin reviews an
-- already accepted one («تمت مراجعة الهوية»). The admin list's «لم تُراجَع هويته»
-- shows the accepted doctors where it is still null.
--
-- Backfill: the doctors an admin accepted (the activity log has an
-- admin_doctor_updated entry with is_admin_approved = true) get the time of that
-- acceptance. Those accepted by the signup alone stay null, on purpose: that is
-- the list to review. It is not in listed_doctors (admin only).
--
-- About 130 rows, read by the admin list only: no index.
--
-- Apply in the Supabase SQL editor BEFORE deploying the code that uses it:
-- accepting a doctor writes the column. Safe to run more than once.

alter table public.doctors add column if not exists identity_reviewed_at timestamptz;

update public.doctors d
   set identity_reviewed_at = r.at
  from (
    select target_doctor_id as id, max(created_at) as at
      from public.audit_logs
     where action = 'admin_doctor_updated'
       and (metadata->>'is_admin_approved') = 'true'
     group by target_doctor_id
  ) r
 where d.id = r.id and d.is_admin_approved and d.identity_reviewed_at is null;

insert into public.applied_migrations (name) values ('20261104170000_identity_reviewed_at') on conflict do nothing;
