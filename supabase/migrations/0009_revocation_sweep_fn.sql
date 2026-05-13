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

  -- 2) Reset for doctors that did appear (also stamps last_seen_in_moh_at).
  with refreshed as (
    update public.doctors d
       set missing_sync_count = 0,
           last_seen_in_moh_at = now()
     where exists (
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
           license_verification_status = 'revoked'
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
