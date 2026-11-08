-- site_settings: switches the admins can flip from the panel (/admin/settings).
--
-- One row, two switches, both off. Off is how the directory has behaved since
-- #16: a doctor an admin has not accepted cannot search, and a colleague's
-- number and email appear only after a tap. Each switch gives one of those up
-- on purpose, so a column's default must stay false.
--
--   search_before_review  a doctor not yet accepted may search the directory
--   contacts_without_tap  an accepted doctor's cards carry numbers and emails
--
-- Server only, like the rest of the admin data: the app reads and writes it
-- with the service role, the browser roles see nothing. A missing row or an
-- unreadable table reads as both off (lib/siteSettings.ts), so code deployed
-- before this runs behaves as it did.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

create table if not exists public.site_settings (
  -- One row: the primary key can only be true.
  id                    boolean primary key default true check (id),
  search_before_review  boolean not null default false,
  contacts_without_tap  boolean not null default false,
  updated_at            timestamptz not null default now()
);

insert into public.site_settings (id) values (true) on conflict do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "server only" on public.site_settings;
create policy "server only"
  on public.site_settings
  for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.applied_migrations (name) values ('20261108090000_site_settings') on conflict do nothing;
