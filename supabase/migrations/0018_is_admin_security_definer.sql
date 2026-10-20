-- 0018: is_admin() without the RLS recursion it was written to avoid.
--
-- 0002 says is_admin() "doesn't trigger RLS recursion", but it ran as the
-- caller: its read of public.doctors went through the doctors policies, one
-- of which calls is_admin() again. Any request with a user's JWT that touched
-- doctors (or a table whose policy calls is_admin()) ended in "stack depth
-- limit exceeded". The app reads with the service role, so no screen broke,
-- but the admin policies never worked and each such request ran to the stack
-- limit. Found by the e2e row-level security tests.
--
-- security definer runs the lookup as the function owner, which bypasses
-- RLS; search_path is pinned so the definer rights cannot be redirected.
-- Apply in the Supabase SQL editor. Safe to run more than once.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select d.is_admin
    from public.doctors d
    where d.auth_user_id = auth.uid()
    limit 1
  ), false);
$$;
