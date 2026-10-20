-- The /admin/audit filters: one page of the activity log, newest first.
--
-- Every filter is optional (null = not filtering):
--   p_action       one action code
--   p_term         a doctor's name, licence or phone, already normalised by
--                  the app (letters, digits and spaces only, so no ilike
--                  wildcards); matches whoever acted or whom it concerned
--   p_from, p_to   Jerusalem calendar days, both inclusive
--   p_people_only  drop the scheduled jobs and the CI smoke logins
--
-- total is the count of every matching row, repeated on each row; a page
-- past the end has no rows and so no total.
-- Apply in the Supabase SQL editor. Safe to run more than once.

create or replace function public.admin_audit_events(
  p_action text default null,
  p_term text default null,
  p_from date default null,
  p_to date default null,
  p_people_only boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  action text,
  actor_doctor_id uuid,
  target_doctor_id uuid,
  metadata jsonb,
  created_at timestamptz,
  total bigint
)
language sql
stable
set search_path = public
as $$
  select l.id, l.action, l.actor_doctor_id, l.target_doctor_id, l.metadata, l.created_at,
         count(*) over () as total
  from audit_logs l
  left join doctors a on a.id = l.actor_doctor_id
  left join doctors t on t.id = l.target_doctor_id
  where (p_action is null or l.action = p_action)
    and (p_from is null or l.created_at >= p_from::timestamp at time zone 'Asia/Jerusalem')
    and (p_to is null or l.created_at < (p_to + 1)::timestamp at time zone 'Asia/Jerusalem')
    and (not p_people_only or (
      l.action not in ('moh_sync_completed', 'moh_sync_failed', 'institutions_relinked')
      and l.metadata->>'ci_run' is null
    ))
    and (p_term is null
      or a.arabic_full_name_normalized ilike '%' || p_term || '%'
      or a.license_number ilike '%' || p_term || '%'
      or a.phone_e164 ilike '%' || p_term || '%'
      or t.arabic_full_name_normalized ilike '%' || p_term || '%'
      or t.license_number ilike '%' || p_term || '%'
      or t.phone_e164 ilike '%' || p_term || '%')
  -- Same time? The id keeps the order stable from one page to the next.
  order by l.created_at desc, l.id desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.admin_audit_events(text, text, date, date, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.admin_audit_events(text, text, date, date, boolean, int, int)
  to service_role;
