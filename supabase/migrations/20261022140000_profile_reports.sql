-- profile_reports: someone says a profile is not who it claims to be (#30).
--
-- Two ways in: a signed-in doctor's «أبلغ عن هذا الملف» on a card (reporter
-- and target known), and the public /report form for a doctor who may have
-- no account, typically one whose licence or number was already taken
-- (reporter's name and contact typed in, target found by licence when it
-- matches). Reports never suspend anyone on their own: the admin reviews them
-- under /admin/reports and closes each with a note.
-- Server only, like the rest of the admin data.
-- Apply in the Supabase SQL editor. Safe to run more than once.

create table if not exists public.profile_reports (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null check (source in ('card', 'public')),
  target_doctor_id    uuid references public.doctors(id) on delete set null,
  license_number      text check (char_length(license_number) <= 20),
  reporter_doctor_id  uuid references public.doctors(id) on delete set null,
  reporter_name       text check (char_length(reporter_name) <= 100),
  reporter_contact    text check (char_length(reporter_contact) <= 100),
  details             text not null check (char_length(details) between 1 and 1000),
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by         uuid references public.doctors(id) on delete set null,
  resolution_note     text check (char_length(resolution_note) <= 500)
);

-- The open list and the nav badge read only open reports.
create index if not exists profile_reports_open
  on public.profile_reports (created_at) where resolved_at is null;
-- Foreign keys, so deleting a doctor does not scan the table.
create index if not exists profile_reports_target on public.profile_reports (target_doctor_id);
create index if not exists profile_reports_reporter on public.profile_reports (reporter_doctor_id);
create index if not exists profile_reports_resolved_by on public.profile_reports (resolved_by);

alter table public.profile_reports enable row level security;

drop policy if exists "server only" on public.profile_reports;
create policy "server only"
  on public.profile_reports
  for all
  to anon, authenticated
  using (false)
  with check (false);
