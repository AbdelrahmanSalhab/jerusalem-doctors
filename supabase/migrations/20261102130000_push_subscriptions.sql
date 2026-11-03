-- push_subscriptions: the phones and browsers an admin turned notifications on
-- for (Web Push). When the app raises an alert that needs an admin
-- (lib/alerts.ts), lib/push.ts sends one encrypted message to each row of an
-- admin who is still an admin and active, and deletes a row when the push
-- service says it is gone.
--
-- Server only, like the rest of the admin data: the endpoint and the two keys
-- are what lets anyone send to that phone, so the browser roles see nothing.
-- The message itself carries no name, number or licence, only the alert's title.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references public.doctors(id) on delete cascade,
  endpoint    text not null unique check (char_length(endpoint) <= 2000),
  p256dh      text not null check (char_length(p256dh) <= 200),
  auth        text not null check (char_length(auth) <= 100),
  created_at  timestamptz not null default now()
);

-- The foreign key, so deleting a doctor does not scan the table. (The unique
-- endpoint already indexes the lookup a re-subscribe makes.)
create index if not exists push_subscriptions_doctor on public.push_subscriptions (doctor_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "server only" on public.push_subscriptions;
create policy "server only"
  on public.push_subscriptions
  for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.applied_migrations (name) values ('20261102130000_push_subscriptions') on conflict do nothing;
