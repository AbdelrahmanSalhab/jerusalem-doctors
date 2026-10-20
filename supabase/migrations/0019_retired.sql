-- 0019: "retired doctor", self-declared on /signup and /profile.
--
-- A doctor must list at least one workplace unless their career stage makes
-- it optional (a resident rotates) or they have ticked "أبحث عن فرصة عمل".
-- A retired doctor fits neither: they are a specialist or طب عام with no
-- workplace and no intention of acquiring one, so signup refused them and
-- /profile refused to let them delete the workplace they had invented.
--
--   retired  independent of seeking_work, on purpose: a retired doctor may
--            still want locum work, and either flag alone makes the
--            workplace optional. The two are never checked against each other.
--
-- Three parts, and the second is the one that bites: save_doctor_profile is
-- the column allow-list for a profile save, so until it names `retired` the
-- key is silently dropped and the save reports success having changed nothing.
--
-- Apply in the Supabase SQL editor BEFORE deploying the code that calls it.

alter table public.doctors
  add column if not exists retired boolean not null default false;

-- save_doctor_profile, as 0018 left it plus `retired` in both column lists.
create or replace function public.save_doctor_profile(
  p_doctor_id uuid,
  p_updates jsonb,
  p_specialty_ids uuid[],
  p_workplaces jsonb
) returns void
language plpgsql
set search_path = public
as $$
begin
  if p_updates is not null and p_updates <> '{}'::jsonb then
    update public.doctors d set
      (arabic_first_name, arabic_first_name_normalized,
       arabic_family_name, arabic_family_name_normalized,
       arabic_full_name_normalized, hebrew_first_name, hebrew_family_name,
       phone_e164, phone_display, is_phone_verified, email, subspecialty,
       subspecialty_normalized, bio, career_stage, residency_start_year,
       certificates, certificates_normalized, seeking_work, retired)
    = (select r.arabic_first_name, r.arabic_first_name_normalized,
              r.arabic_family_name, r.arabic_family_name_normalized,
              r.arabic_full_name_normalized, r.hebrew_first_name,
              r.hebrew_family_name, r.phone_e164, r.phone_display,
              r.is_phone_verified, r.email, r.subspecialty,
              r.subspecialty_normalized, r.bio, r.career_stage,
              r.residency_start_year, r.certificates,
              r.certificates_normalized, r.seeking_work, r.retired
         from jsonb_populate_record(d, p_updates) r)
    where d.id = p_doctor_id;
  end if;

  if p_specialty_ids is not null then
    delete from public.doctor_specialties where doctor_id = p_doctor_id;
    insert into public.doctor_specialties (doctor_id, specialty_id)
    select p_doctor_id, s from unnest(p_specialty_ids) as s;
  end if;

  if p_workplaces is not null then
    delete from public.doctor_workplaces where doctor_id = p_doctor_id;
    insert into public.doctor_workplaces
      (doctor_id, name, name_normalized, workplace_type, details, address,
       hours, phone, is_primary, sort_order)
    select p_doctor_id, w.name, w.name_normalized, w.workplace_type,
           w.details, w.address, w.hours, w.phone, w.is_primary, w.sort_order
      from jsonb_to_recordset(p_workplaces) as w(
        name text, name_normalized text, workplace_type text, details text,
        address text, hours text, phone text, is_primary boolean,
        sort_order int);
  end if;
end;
$$;

revoke all on function public.save_doctor_profile(uuid, jsonb, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.save_doctor_profile(uuid, jsonb, uuid[], jsonb)
  to service_role;

-- admin_stats, as 0017 left it plus a `retired` count beside seeking_work.
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
    'retired', count(*) filter (where retired and is_active),
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
