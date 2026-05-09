-- 0006_profile_features.sql — per-field visibility toggles + profile picture.
-- Apply after 0005. Idempotent — safe to re-run.
--
-- Self-service `/profile` exposes phone_is_visible and workplaces_is_visible
-- to the doctor. The overall `is_visible` flag stays admin-only — doctors
-- who want to fully hide themselves contact the developer (link in footer
-- and on /profile).

alter table public.doctors
  add column if not exists phone_is_visible boolean not null default true,
  add column if not exists workplaces_is_visible boolean not null default true,
  add column if not exists profile_picture_url text;

-- Profile pictures live in Supabase Storage bucket "doctor-photos" — bucket
-- created from the dashboard (cannot be created via SQL). The column above
-- holds the public URL.
