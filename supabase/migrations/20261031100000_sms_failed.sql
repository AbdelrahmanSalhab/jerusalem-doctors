-- Why a code was not sent, and who it was for: /admin/stats' code section and
-- /admin/signups could say a code arrived or was refused, but a send that
-- failed (SMS4FREE's refusal, the daily cap, Supabase's own limits) reached
-- only logs and Sentry. A doctor reporting "no code" could not be matched to
-- anything.
--
-- New usage kind sms_failed (meta.reason: a short label with no number;
-- meta.signup for a signup's; doctor_id for a doctor's). Sign-in failures keep
-- their kind login_send_failed and gain meta.reason.
--
-- otp_stats gains: failed, failed_by_reason, recent_failures.
--
-- Apply in the Supabase SQL editor before deploying the code that uses it.
-- Safe to run more than once.

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check check (kind in (
  'search', 'signup_started', 'login_code_sent', 'login_unregistered',
  'login_send_failed', 'login_succeeded',
  'contact_call', 'contact_whatsapp', 'contact_save',
  'sms_sent', 'registry_lookup',
  'install_invite_shown', 'install_invite_snoozed', 'install_click',
  'install_accepted', 'install_completed', 'install_app_opened',
  'otp_refused', 'otp_locked', 'otp_resent',
  'sms_delivered', 'sms_undelivered', 'sms_voice',
  'sms_failed'));

create or replace function public.otp_stats(p_days int default 7, p_valid_seconds int default 60)
returns jsonb
language sql
stable
set search_path = public
as $$
  with
  ev as (
    select kind, doctor_id, meta, created_at
    from usage_events
    where kind = any (array[
            'sms_sent', 'sms_delivered', 'sms_undelivered', 'sms_voice',
            'otp_refused', 'otp_locked', 'otp_resent',
            'login_code_sent', 'login_succeeded', 'signup_started',
            'sms_failed', 'login_send_failed'])
      and created_at >= now() - make_interval(days => p_days)
  ),
  totals as (
    select jsonb_build_object(
      'sent',          count(*) filter (where kind = 'sms_sent'),
      'send_ms_p50',   round(percentile_cont(0.5) within group (order by (meta->>'ms')::numeric) filter (where kind = 'sms_sent' and meta ? 'ms')),
      'send_ms_max',   max((meta->>'ms')::numeric) filter (where kind = 'sms_sent'),
      'delivered',     count(*) filter (where kind = 'sms_delivered'),
      'undelivered',   count(*) filter (where kind = 'sms_undelivered'),
      'voice',         count(*) filter (where kind = 'sms_voice'),
      'delay_p50',     round(percentile_cont(0.5) within group (order by (meta->>'delay_s')::numeric) filter (where kind = 'sms_delivered' and meta ? 'delay_s')),
      'delay_max',     max((meta->>'delay_s')::numeric) filter (where kind = 'sms_delivered'),
      'late',          count(*) filter (where kind = 'sms_delivered' and (meta->>'delay_s')::numeric > p_valid_seconds),
      'refused',       count(*) filter (where kind = 'otp_refused'),
      'locked',        count(*) filter (where kind = 'otp_locked'),
      'resent',        count(*) filter (where kind = 'otp_resent')
                       + count(*) filter (where kind = 'login_code_sent' and meta->>'resend' = 'true'),
      'logins_ok',     count(*) filter (where kind = 'login_succeeded'),
      'signups_started', count(*) filter (where kind = 'signup_started'),
      'failed',        count(*) filter (where kind in ('sms_failed', 'login_send_failed'))
    ) as j
    from ev
  ),
  -- Signed-in doctors refused (or locked out) with no sign-in since.
  stuck_logins as (
    select d.id, d.arabic_full_name as name, r.refused, r.last_at
    from (
      select doctor_id, count(*) as refused, max(created_at) as last_at
      from ev
      where kind in ('otp_refused', 'otp_locked') and meta->>'flow' = 'login' and doctor_id is not null
      group by doctor_id
    ) r
    join doctors d on d.id = r.doctor_id
    where not exists (
      select 1 from ev ok
      where ok.kind = 'login_succeeded' and ok.doctor_id = r.doctor_id and ok.created_at > r.last_at)
  ),
  -- Signups refused at the code that are still unfinished (their row is
  -- kept for a reminder, /admin/signups).
  stuck_signups as (
    select count(distinct e.meta->>'signup') as n
    from ev e
    join pending_signups p on p.id::text = e.meta->>'signup'
    where e.kind in ('otp_refused', 'otp_locked') and e.meta->>'flow' = 'signup'
  ),
  -- Why sends failed (meta.reason; older sign-in failures have none), most
  -- common first, and the latest ones with who they were for.
  failed_by_reason as (
    select coalesce(meta->>'reason', 'unknown') as reason, count(*) as n
    from ev
    where kind in ('sms_failed', 'login_send_failed')
    group by 1
  ),
  recent_failed as (
    select e.created_at, coalesce(e.meta->>'reason', 'unknown') as reason,
           d.arabic_full_name as name, e.meta->>'signup' as signup
    from ev e
    left join doctors d on d.id = e.doctor_id
    where e.kind in ('sms_failed', 'login_send_failed')
    order by e.created_at desc
    limit 15
  )
  select (select j from totals)
    || jsonb_build_object(
         'failed_by_reason', coalesce((
           select jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc)
           from failed_by_reason), '[]'::jsonb),
         'recent_failures', coalesce((
           select jsonb_agg(jsonb_build_object('at', created_at, 'reason', reason, 'name', name, 'signup', signup) order by created_at desc)
           from recent_failed), '[]'::jsonb),
         'stuck_signups', (select n from stuck_signups),
         'stuck_logins', coalesce((
           select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'refused', refused, 'last_at', last_at) order by last_at desc)
           from stuck_logins), '[]'::jsonb));
$$;

revoke all on function public.otp_stats(int, int) from public, anon, authenticated;
grant execute on function public.otp_stats(int, int) to service_role;

insert into public.applied_migrations (name) values ('20261031100000_sms_failed') on conflict do nothing;
