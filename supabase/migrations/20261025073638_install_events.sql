-- Install analytics (#150): how doctors get from the dashboard's invitation
-- to opening the directory from their home screen.
--
-- Six usage kinds, kept apart because each says something different:
--   install_invite_shown    the dashboard's invitation appeared
--   install_invite_snoozed  «لاحقًا», ✕, or Chrome's install dialog cancelled
--   install_click           «تثبيت» / «طريقة الإضافة» (meta.source: card or menu)
--   install_accepted        Chrome's install dialog answered yes (Android, computers)
--   install_completed       the browser confirmed the install (appinstalled)
--   install_app_opened      the site opened as the installed app, once a
--                           browser session: the only signal iPhones give
-- meta.guide is the browser family (ios-safari, ios-other, android, in-app,
-- other). Nothing else: no device details, as with the other usage events.
--
-- install_funnel(days): those counts by kind and platform (iphone, android,
-- in-app, other), and by kind alone, with how many doctors, for
-- /admin/stats. One small query over the kind+time index.
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
  'install_accepted', 'install_completed', 'install_app_opened'));

create or replace function public.install_funnel(p_days int default 30)
returns table (kind text, platform text, events bigint, doctors bigint)
language sql
stable
set search_path = public
as $$
  -- platform null: every platform together (a doctor on two counts once).
  select e.kind,
         case when e.meta->>'guide' like 'ios-%' then 'iphone'
              else coalesce(e.meta->>'guide', 'other') end as platform,
         count(*) as events,
         count(distinct e.doctor_id) as doctors
  from usage_events e
  where e.kind = any (array[
          'install_invite_shown', 'install_invite_snoozed', 'install_click',
          'install_accepted', 'install_completed', 'install_app_opened'])
    and e.created_at >= now() - make_interval(days => p_days)
  group by grouping sets ((1, 2), (1));
$$;

revoke all on function public.install_funnel(int) from public, anon, authenticated;
grant execute on function public.install_funnel(int) to service_role;
