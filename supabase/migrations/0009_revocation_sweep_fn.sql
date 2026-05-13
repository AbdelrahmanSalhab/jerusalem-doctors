-- 0009_revocation_sweep_fn.sql — revocation sweep stored procedure (#18).
-- Invoked from app/api/cron/sync-moh/route.ts after the mirror upsert.
-- Returns counters + the list of newly-revoked doctor ids so the route
-- can write per-doctor audit_log rows.

create or replace function public.revocation_sweep(threshold_cycles int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed int := 0;
  v_reset  int := 0;
  v_revoked uuid[];
begin
  -- 1) Bump miss counter for approved doctors not present in the mirror.
  with bumped as (
    update public.doctors d
       set missing_sync_count = d.missing_sync_count + 1
     where d.is_admin_approved
       and d.is_active
       and coalesce(d.license_verification_status, '') <> 'revoked'
       and not exists (
         select 1 from public.moh_practitioners mp
          where mp.license_number::text = d.license_number
       )
    returning d.id
  )
  select count(*) into v_missed from bumped;

  -- 2) Reset for approved, active doctors that did appear in the mirror.
  --    The is_admin_approved AND is_active guard is intentional: resetting
  --    missing_sync_count and last_seen_in_moh_at for a previously-revoked
  --    doctor (is_admin_approved=false, is_active=false) would be misleading
  --    and could interfere with future sweep logic. Only doctors that step 1
  --    could have bumped should be eligible for reset here.
  with refreshed as (
    update public.doctors d
       set missing_sync_count = 0,
           last_seen_in_moh_at = now()
     where d.is_admin_approved
       and d.is_active
       and exists (
         select 1 from public.moh_practitioners mp
          where mp.license_number::text = d.license_number
       )
    returning d.id
  )
  select count(*) into v_reset from refreshed;

  -- 3) Revoke at threshold. Guard is_admin_approved and is_active so that a
  --    doctor who was manually un-approved after their counter was already
  --    bumped is not swept into revoked state here (step 1 stopped
  --    incrementing them). Matches the plan pseudocode:
  --    WHERE is_admin_approved AND license_verification_status <> 'revoked'.
  with revoked as (
    update public.doctors d
       set is_active = false,
           is_admin_approved = false,
           license_verification_status = 'revoked',
           -- Reset counter to 0 so revoked rows are self-consistent and do not
           -- appear to have a stale accumulation that could confuse debugging or
           -- future sweep logic.
           missing_sync_count = 0
     where d.is_admin_approved
       and d.is_active
       and d.missing_sync_count >= threshold_cycles
       and coalesce(d.license_verification_status, '') <> 'revoked'
    returning d.id
  )
  select coalesce(array_agg(id), '{}') into v_revoked from revoked;

  return jsonb_build_object(
    'missed', v_missed,
    'reset', v_reset,
    'revoked', to_jsonb(v_revoked)
  );
end;
$$;

revoke all on function public.revocation_sweep(int) from public, anon, authenticated;
grant execute on function public.revocation_sweep(int) to service_role;
