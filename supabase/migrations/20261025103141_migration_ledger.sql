-- applied_migrations: which of these files the database has run.
--
-- Every file is pasted into the SQL Editor by hand, and nothing recorded
-- which ones production had: a missed or repeated file showed up only when
-- something broke. From this file on, every migration ends by recording its
-- own name (supabase/migrations/README.md; lib/migrations.test.ts checks
-- that each one does). The production smoke check compares this table with
-- the repo's files after every deploy (GET /api/admin/migrations).
--
-- The files before this one are recorded here in one go, on the word that
-- production has run them all; a missing one would have broken its feature
-- already.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

create table if not exists public.applied_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);
-- Service role only, like the rest of the admin data, and said so with the
-- always-false policy every server-only table has (20261021110400).
alter table public.applied_migrations enable row level security;
revoke all on public.applied_migrations from anon, authenticated;
drop policy if exists "server only" on public.applied_migrations;
create policy "server only"
  on public.applied_migrations
  for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.applied_migrations (name) values
  ('0001_init'),
  ('0002_rls'),
  ('0003_seed_specialties'),
  ('0004_workplaces'),
  ('0005_specialty_updates'),
  ('0006_profile_features'),
  ('0007_region_career_workplace_bio'),
  ('0008_dual_license'),
  ('0009_career_stage_self_declared'),
  ('0010_drop_profile_visibility_flags'),
  ('0011_revoke_doctor_self_update'),
  ('0012_specialty_tree_and_clinic_fields'),
  ('0013_featured_and_certificates'),
  ('0014_atomic_profile_save'),
  ('0015_usage_events_and_admin_stats'),
  ('0016_institutions'),
  ('0017_contact_clicks'),
  ('0018_admin_profile_save'),
  ('0019_retired'),
  ('0020_is_admin_security_definer'),
  ('20261020181925_audit_filters'),
  ('20261021072127_registry_specialty'),
  ('20261021074856_moh_registry_rows'),
  ('20261021081703_audit_logs_action_index'),
  ('20261021084302_search_directory'),
  ('20261021085031_directory_counts'),
  ('20261021102333_metrics_daily'),
  ('20261021103844_supabase_lint'),
  ('20261021110150_drop_unused_indexes'),
  ('20261021110400_server_only_policies'),
  ('20261021124944_search_filters'),
  ('20261022060000_clinic_missing_details'),
  ('20261022080800_number_requests'),
  ('20261022120000_unfinished_signups'),
  ('20261022140000_profile_reports'),
  ('20261024090000_clinic_hmo'),
  ('20261025073638_install_events')
on conflict do nothing;

insert into public.applied_migrations (name) values ('20261025103141_migration_ledger') on conflict do nothing;
