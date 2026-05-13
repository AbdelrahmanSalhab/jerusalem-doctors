-- 0010_atomic_otp_increment.sql
-- Replaces the read-then-write pattern in signup/verify with a single atomic
-- UPDATE RETURNING so concurrent OTP submissions cannot bypass the attempt cap.

create or replace function public.increment_pending_attempts(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  update pending_signups
     set attempts = attempts + 1
   where id = p_session_id
  returning attempts into v_attempts;
  return v_attempts;
end;
$$;

revoke all on function public.increment_pending_attempts(uuid) from public, anon, authenticated;
grant execute on function public.increment_pending_attempts(uuid) to service_role;
