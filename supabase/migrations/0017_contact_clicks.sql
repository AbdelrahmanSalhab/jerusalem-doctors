-- 0017: count contact clicks (call, WhatsApp, add to contacts).
--
-- Whether the directory produces conversations is the measure that matters,
-- and a single account opening many contacts in a day is what scraping
-- looks like. Events keep the viewer (doctor_id) and the colleague they
-- contacted (meta.target), nothing else.
--
-- Apply in the Supabase SQL editor before deploying the code that uses it.

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check check (kind in (
  'search', 'signup_started', 'login_code_sent', 'login_unregistered',
  'login_send_failed', 'login_succeeded',
  'contact_call', 'contact_whatsapp', 'contact_save'));

create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
  d as (
    select * from public.doctors where not (is_admin and not is_visible)
  ),
  logins as (
    select d.id, u.last_sign_in_at
      from d left join auth.users u on u.id = d.auth_user_id
  ),
  domain as (
    select ds.doctor_id, coalesce(s.parent_id, s.id) as domain_id
      from public.doctor_specialties ds
      join public.specialties s on s.id = ds.specialty_id
      join d on d.id = ds.doctor_id
  ),
  days as (
    select generate_series(
      (now() at time zone 'Asia/Jerusalem')::date - 29,
      (now() at time zone 'Asia/Jerusalem')::date,
      interval '1 day')::date as day
  ),
  deletion as (
    select distinct a.target_doctor_id as id
      from public.audit_logs a
      join d on d.id = a.target_doctor_id and not d.is_active
     where a.action = 'delete_requested'
  )
select jsonb_build_object(
  'generated_at', now(),

  'doctors', (select jsonb_build_object(
    'total', count(*),
    'listed', count(*) filter (where is_active and is_visible and is_phone_verified
                                 and is_admin_approved and consent_directory_use),
    'pending', count(*) filter (where is_active and not is_admin_approved),
    'suspended', count(*) filter (where not is_active),
    'new_24h', count(*) filter (where created_at > now() - interval '24 hours'),
    'new_7d', count(*) filter (where created_at > now() - interval '7 days'),
    'new_30d', count(*) filter (where created_at > now() - interval '30 days'),
    'seeking_work', count(*) filter (where seeking_work and is_active),
    'with_photo', count(*) filter (where profile_picture_url is not null),
    'with_bio', count(*) filter (where coalesce(bio, '') <> ''),
    'with_workplace', count(*) filter (where exists (
        select 1 from public.doctor_workplaces w where w.doctor_id = d.id)),
    'approved_auto', count(*) filter (where is_admin_approved
                                        and license_verification_status = 'verified'),
    'approved_manual', count(*) filter (where is_admin_approved
                                          and license_verification_status is distinct from 'verified')
  ) from d),

  'stage', (select jsonb_build_object(
    'general', count(*) filter (where career_stage is null),
    'resident', count(*) filter (where career_stage = 'resident'),
    'specialist', count(*) filter (where career_stage = 'specialist')
  ) from d),

  'license', (select jsonb_build_object(
    'il_only', count(*) filter (where license_region = 'IL' and secondary_license_region is null),
    'ps_only', count(*) filter (where license_region = 'PS' and secondary_license_region is null),
    'both', count(*) filter (where secondary_license_region is not null),
    'verified', count(*) filter (where license_verification_status = 'verified'),
    'soft_match', count(*) filter (where license_verification_status = 'soft_match'),
    'not_found', count(*) filter (where license_verification_status = 'not_found'),
    'mismatch_overridden', count(*) filter (where license_verification_status = 'name_mismatch_overridden')
  ) from d),

  'activity', (select jsonb_build_object(
    'active_7d', count(*) filter (where last_sign_in_at > now() - interval '7 days'),
    'active_30d', count(*) filter (where last_sign_in_at > now() - interval '30 days'),
    'never', count(*) filter (where last_sign_in_at is null)
  ) from logins),

  'daily', (select coalesce(jsonb_agg(jsonb_build_object(
      'day', days.day,
      'signups', (select count(*) from d
                   where (d.created_at at time zone 'Asia/Jerusalem')::date = days.day),
      'searchers', (select count(distinct e.doctor_id) from public.usage_events e
                     where e.kind = 'search'
                       and (e.created_at at time zone 'Asia/Jerusalem')::date = days.day),
      'contacts', (select count(*) from public.usage_events e
                    where e.kind in ('contact_call', 'contact_whatsapp', 'contact_save')
                      and (e.created_at at time zone 'Asia/Jerusalem')::date = days.day)
    ) order by days.day), '[]'::jsonb) from days),

  'domains', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name_ar, 'count', x.n)
                                        order by x.n desc, s.name_ar), '[]'::jsonb)
      from (select domain_id, count(distinct doctor_id) as n from domain group by domain_id) x
      join public.specialties s on s.id = x.domain_id),

  'workplace_types', (select jsonb_build_object(
    'hospital', count(distinct w.doctor_id) filter (where w.workplace_type = 'hospital'),
    'clinic', count(distinct w.doctor_id) filter (where w.workplace_type = 'clinic'),
    'hmo', count(distinct w.doctor_id) filter (where w.workplace_type = 'hmo')
  ) from public.doctor_workplaces w join d on d.id = w.doctor_id),

  'institutions', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name_ar, 'kind', i.kind, 'count', x.n)
                                             order by x.n desc, i.name_ar), '[]'::jsonb)
      from (select w.institution_id, count(distinct w.doctor_id) as n
              from public.doctor_workplaces w join d on d.id = w.doctor_id
             where w.institution_id is not null
             group by w.institution_id) x
      join public.institutions i on i.id = x.institution_id),

  'attention', (select jsonb_build_object(
    'pending', (select count(*) from d where is_active and not is_admin_approved),
    'pending_oldest', (select min(created_at) from d where is_active and not is_admin_approved),
    'pending_not_found', (select count(*) from d where is_active and not is_admin_approved
                                                  and license_verification_status = 'not_found'),
    'pending_mismatch', (select count(*) from d where is_active and not is_admin_approved
                                                 and license_verification_status = 'name_mismatch_overridden'),
    'deletion_requests', (select count(*) from deletion),
    'deletion_oldest', (select min(a.created_at) from public.audit_logs a
                         join deletion on deletion.id = a.target_doctor_id
                        where a.action = 'delete_requested'),
    'clinics', (select count(*) from public.doctor_workplaces w join d on d.id = w.doctor_id
                 where w.workplace_type = 'clinic'),
    'clinics_missing_details', (select count(*) from public.doctor_workplaces w join d on d.id = w.doctor_id
                                 where w.workplace_type = 'clinic'
                                   and (coalesce(w.address, '') = '' or coalesce(w.phone, '') = '')),
    'never_logged_in', (select count(*) from logins where last_sign_in_at is null),
    'unmatched_workplaces', (select count(distinct w.name) from public.doctor_workplaces w
                              join d on d.id = w.doctor_id
                             where w.institution_id is null and w.workplace_type <> 'clinic')
  )),

  'usage', (select jsonb_build_object(
    'searchers_7d', count(distinct doctor_id) filter (where kind = 'search'
                                                        and created_at > now() - interval '7 days'),
    'searches_7d', count(*) filter (where kind = 'search' and created_at > now() - interval '7 days'),
    'filter_empty_7d', count(*) filter (where kind = 'search' and created_at > now() - interval '7 days'
                                          and (meta->>'filtered')::boolean and (meta->>'results')::int = 0),
    'signup_started_7d', count(*) filter (where kind = 'signup_started'
                                            and created_at > now() - interval '7 days'),
    'login_code_sent_7d', count(*) filter (where kind = 'login_code_sent'
                                             and created_at > now() - interval '7 days'),
    'login_succeeded_7d', count(*) filter (where kind = 'login_succeeded'
                                             and created_at > now() - interval '7 days'),
    'login_unregistered_7d', count(*) filter (where kind = 'login_unregistered'
                                                and created_at > now() - interval '7 days'),
    'login_send_failed_24h', count(*) filter (where kind = 'login_send_failed'
                                                and created_at > now() - interval '24 hours'),
    'since', min(created_at)
  ) from public.usage_events),

  'contacts', (select jsonb_build_object(
    'whatsapp_7d', count(*) filter (where kind = 'contact_whatsapp'),
    'call_7d', count(*) filter (where kind = 'contact_call'),
    'save_7d', count(*) filter (where kind = 'contact_save'),
    'contacters_7d', count(distinct doctor_id),
    'contacted_7d', count(distinct meta->>'target')
  ) from public.usage_events
    where kind in ('contact_call', 'contact_whatsapp', 'contact_save')
      and created_at > now() - interval '7 days'),

  -- One account reaching many different doctors in a day is what copying the
  -- directory looks like.
  'heavy_contacters', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', d.arabic_first_name || ' ' || d.arabic_family_name, 'count', x.n)
        order by x.n desc), '[]'::jsonb)
      from (select doctor_id, count(distinct meta->>'target') as n
              from public.usage_events
             where kind in ('contact_call', 'contact_whatsapp', 'contact_save')
               and created_at > now() - interval '24 hours'
             group by doctor_id
            having count(distinct meta->>'target') >= 20) x
      join public.doctors d on d.id = x.doctor_id),

  'signup_completed_7d', (select count(*) from public.audit_logs
                           where action = 'signup_verified' and created_at > now() - interval '7 days'),

  'empty_specialties', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name_ar, 'count', x.n)
                                                  order by x.n desc), '[]'::jsonb)
      from (select meta->>'specialty_id' as sid, count(*) as n
              from public.usage_events
             where kind = 'search' and created_at > now() - interval '30 days'
               and (meta->>'filtered')::boolean and (meta->>'results')::int = 0
             group by 1 order by 2 desc limit 10) x
      join public.specialties s on s.id::text = x.sid),

  'moh_sync', (select jsonb_build_object('action', action, 'at', created_at)
                 from public.audit_logs
                where action in ('moh_sync_completed', 'moh_sync_failed')
                order by created_at desc limit 1)
);
$$;

revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;
