-- The code step, measured: who got a code, whether it arrived and how fast,
-- who typed it and was refused, and who never got in. Doctors reported
-- "two codes, both wrong" (a code lived 60 seconds); these say whether the
-- fixes were enough and whom to follow up with.
--
-- New usage kinds (no phone, no code, as with the other usage events):
--   otp_refused      a code was refused (meta: flow login|signup, attempt,
--                    signup = pending_signups.id; doctor_id for a sign-in)
--   otp_locked       too many tries (signup: this code's 5; sign-in: the
--                    per-phone limit)
--   otp_resent       a signup asked for a new code (sign-in resends are
--                    login_code_sent with meta.resend)
--   sms_delivered    SMS4FREE's delivery report: arrived (meta: delay_s)
--   sms_undelivered  SMS4FREE's delivery report: did not arrive
--   sms_voice        a kosher phone: SMS4FREE read the code in a voice call
-- sms_sent also gains meta.ms: how long SMS4FREE took to accept the text.
--
-- otp_stats(days, valid_seconds): the numbers for /admin/stats, and the
-- doctors who were refused and have not signed in since.
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
  'sms_delivered', 'sms_undelivered', 'sms_voice'));

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
            'login_code_sent', 'login_succeeded', 'signup_started'])
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
      'signups_started', count(*) filter (where kind = 'signup_started')
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
  )
  select (select j from totals)
    || jsonb_build_object(
         'stuck_signups', (select n from stuck_signups),
         'stuck_logins', coalesce((
           select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'refused', refused, 'last_at', last_at) order by last_at desc)
           from stuck_logins), '[]'::jsonb));
$$;

revoke all on function public.otp_stats(int, int) from public, anon, authenticated;
grant execute on function public.otp_stats(int, int) to service_role;

insert into public.applied_migrations (name) values ('20261027113048_otp_events') on conflict do nothing;
