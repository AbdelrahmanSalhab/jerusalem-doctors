-- metrics_daily: one row per day of what the app used, measured rather than
-- estimated, for /admin/stats and for alerting before a free-plan limit.
--
-- record_daily_metrics(day) writes the row for a UTC day (the cron in
-- app/api/cron/metrics runs it shortly after midnight for the day before):
--   - db_bytes: the database's size on disk, against Supabase's 500 MB
--   - top_tables: the largest tables with their size and estimated rows
--   - counts: that day's searches, SMS actually sent, login codes, sign-ins,
--     signups started and completed, contact presses, alerts, and requests to
--     the MoH registry (the nightly sync's own count plus signup lookups)
-- Running it again for the same day replaces the row.
--
-- Two new usage kinds feed it: sms_sent (the Send SMS hook, once per SMS
-- the provider accepted) and registry_lookup (a live data.gov.il lookup
-- at signup).
-- Apply in the Supabase SQL editor. Safe to run more than once.

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check check (kind in (
  'search', 'signup_started', 'login_code_sent', 'login_unregistered',
  'login_send_failed', 'login_succeeded',
  'contact_call', 'contact_whatsapp', 'contact_save',
  'sms_sent', 'registry_lookup'));

create table if not exists public.metrics_daily (
  day          date primary key,
  db_bytes     bigint not null,
  top_tables   jsonb not null,
  counts       jsonb not null,
  recorded_at  timestamptz not null default now()
);
-- Service role only, like the rest of the admin data.
alter table public.metrics_daily enable row level security;

create or replace function public.record_daily_metrics(p_day date)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  with
  bounds as (
    select p_day::timestamp at time zone 'UTC' as from_t,
           (p_day + 1)::timestamp at time zone 'UTC' as to_t
  ),
  events as (
    select e.kind, count(*) as n
    from usage_events e, bounds b
    where e.created_at >= b.from_t and e.created_at < b.to_t
    group by e.kind
  ),
  audits as (
    select a.action, count(*) as n,
           sum(coalesce((a.metadata->>'requests')::int, 0)) as requests
    from audit_logs a, bounds b
    where a.created_at >= b.from_t and a.created_at < b.to_t
    group by a.action
  ),
  ev as (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) as j from events),
  au as (select coalesce(jsonb_object_agg(action, jsonb_build_object('n', n, 'requests', requests)), '{}'::jsonb) as j from audits),
  row as (
    select
      pg_database_size(current_database()) as db_bytes,
      (select coalesce(jsonb_agg(t order by t.bytes desc), '[]'::jsonb) from (
        select c.relname as name,
               pg_total_relation_size(c.oid) as bytes,
               greatest(c.reltuples, 0)::bigint as rows
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 8) t) as top_tables,
      jsonb_build_object(
        'searches',          coalesce((ev.j->>'search')::int, 0),
        'sms_sent',          coalesce((ev.j->>'sms_sent')::int, 0),
        'login_codes',       coalesce((ev.j->>'login_code_sent')::int, 0),
        'logins',            coalesce((ev.j->>'login_succeeded')::int, 0),
        'signups_started',   coalesce((ev.j->>'signup_started')::int, 0),
        'signups_completed', coalesce((au.j->'signup_verified'->>'n')::int, 0),
        'contacts',          coalesce((ev.j->>'contact_call')::int, 0)
                             + coalesce((ev.j->>'contact_whatsapp')::int, 0)
                             + coalesce((ev.j->>'contact_save')::int, 0),
        'alerts',            coalesce((au.j->'alert'->>'n')::int, 0),
        'registry_requests', coalesce((au.j->'moh_sync_completed'->>'requests')::int, 0)
                             + coalesce((au.j->'moh_sync_failed'->>'requests')::int, 0)
                             + coalesce((ev.j->>'registry_lookup')::int, 0)
      ) as counts
    from ev, au
  ),
  saved as (
    insert into metrics_daily (day, db_bytes, top_tables, counts)
    select p_day, db_bytes, top_tables, counts from row
    on conflict (day) do update
      set db_bytes = excluded.db_bytes, top_tables = excluded.top_tables,
          counts = excluded.counts, recorded_at = now()
    returning day, db_bytes, top_tables, counts
  )
  select to_jsonb(saved) from saved;
$$;

revoke all on function public.record_daily_metrics(date) from public, anon, authenticated;
grant execute on function public.record_daily_metrics(date) to service_role;
