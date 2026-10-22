-- Unfinished signups: a signup whose SMS code was never entered is kept for
-- 30 days (it used to go with the code, after 15 minutes) so an admin can
-- remind the doctor to finish, under /admin/signups. A daily cron deletes
-- the older ones (lib/signup/unfinished.ts).
--
--   resume_token_hash  sha256 of the token in the reminder's link
--                      (/signup?resume=...), which reopens the form filled
--                      in. Only the hash is stored.
--   reminded_at        when an admin last sent the reminder
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

alter table public.pending_signups add column if not exists resume_token_hash text;
alter table public.pending_signups add column if not exists reminded_at timestamptz;

create unique index if not exists pending_signups_resume_token
  on public.pending_signups (resume_token_hash) where resume_token_hash is not null;
-- The admin list (newest first) and the daily purge (older than 30 days).
create index if not exists pending_signups_created_at
  on public.pending_signups (created_at);
