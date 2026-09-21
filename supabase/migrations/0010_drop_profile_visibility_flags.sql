-- 0010_drop_profile_visibility_flags.sql
-- Drops the two per-doctor privacy toggles added by 0006. The directory is a
-- closed, admin-approved network whose purpose is colleagues reaching each
-- other, so phone, WhatsApp and workplaces are always shown. A doctor who
-- wants out uses حذف الحساب (/api/profile/delete-request), which sets the
-- admin-level is_visible/is_active — untouched here. Apply after 0009.
--
-- Nothing else referenced these columns: no RLS policy, index, trigger, view
-- or seed script, so a plain drop is enough.

alter table public.doctors
  drop column if exists phone_is_visible,
  drop column if exists workplaces_is_visible;
