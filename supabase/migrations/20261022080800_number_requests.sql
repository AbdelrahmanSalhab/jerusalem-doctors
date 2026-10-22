-- Number requests: a doctor whose search found nobody asks the admins for
-- that colleague's number. The admins send it over WhatsApp and close the
-- request on /admin/requests. Open means resolved_at is null.
--
-- Server-only, like the other tables only the server reads or writes
-- (20261021110400_server_only_policies.sql).
-- Apply in the Supabase SQL editor before deploying the code that uses it.
-- Safe to run more than once.

create table if not exists public.number_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.doctors(id) on delete cascade,
  query        text not null check (char_length(query) between 1 and 100),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

alter table public.number_requests enable row level security;

drop policy if exists "server only" on public.number_requests;
create policy "server only"
  on public.number_requests
  for all
  to anon, authenticated
  using (false)
  with check (false);
