-- 0002_rls.sql — Row Level Security policies (plan §6, §9).
-- Apply after 0001_init.sql.
--
-- Default-deny stance: every table gets RLS enabled, only the listed
-- policies grant access. Service role bypasses RLS automatically — used by
-- API routes for cross-cutting tasks (creating auth users, writing audit
-- logs, MoH sync, reading pending_signups).

alter table public.doctors             enable row level security;
alter table public.specialties         enable row level security;
alter table public.doctor_specialties  enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.pending_signups     enable row level security;
alter table public.moh_practitioners   enable row level security;

-- ---------- helpers ----------
-- A self-contained admin check that doesn't trigger RLS recursion.
-- Service role is sometimes detected via auth.role(); we keep this as the
-- primary signal for app-level admin and let service_role bypass RLS.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce((
    select d.is_admin
    from public.doctors d
    where d.auth_user_id = auth.uid()
    limit 1
  ), false);
$$;

-- ---------- doctors ----------
-- Visible-doctor read policy: any authenticated user can see other verified,
-- active, visible, consented, admin-approved doctors.
create policy "verified doctors readable by authenticated"
  on public.doctors
  for select
  to authenticated
  using (
    is_active
    and is_visible
    and is_phone_verified
    and is_admin_approved
    and consent_directory_use
  );

-- Self-read: the signed-in doctor can always see their own row.
create policy "doctor reads own row"
  on public.doctors
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- Self-update: column whitelist is enforced in the API layer (plan §9).
create policy "doctor updates own row"
  on public.doctors
  for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Admin: full read + update on every row.
create policy "admin reads all doctors"
  on public.doctors
  for select
  to authenticated
  using (public.is_admin());

create policy "admin updates all doctors"
  on public.doctors
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- specialties ----------
-- Catalogue is readable by every authenticated user. Writes are admin-only.
create policy "specialties readable by authenticated"
  on public.specialties
  for select
  to authenticated
  using (is_active);

create policy "admin manages specialties"
  on public.specialties
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- doctor_specialties ----------
-- Read mirrors doctors visibility through the join.
create policy "doctor_specialties readable for visible doctors"
  on public.doctor_specialties
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_specialties.doctor_id
        and (
          d.auth_user_id = auth.uid()
          or public.is_admin()
          or (
            d.is_active
            and d.is_visible
            and d.is_phone_verified
            and d.is_admin_approved
            and d.consent_directory_use
          )
        )
    )
  );

-- Owner can manage their own specialty links.
create policy "doctor_specialties owner manages"
  on public.doctor_specialties
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_specialties.doctor_id
        and d.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_specialties.doctor_id
        and d.auth_user_id = auth.uid()
    )
  );

-- Admin can manage all specialty links.
create policy "doctor_specialties admin manages"
  on public.doctor_specialties
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- audit_logs ----------
-- No INSERT/SELECT for regular users; service role writes from API.
-- Admin gets full read.
create policy "admin reads audit logs"
  on public.audit_logs
  for select
  to authenticated
  using (public.is_admin());

-- ---------- pending_signups ----------
-- Deny-all for everyone except service role (which bypasses RLS).
-- No policies needed; default-deny applies.

-- ---------- moh_practitioners ----------
-- Deny-all for everyone except service role. The license-check API and the
-- daily sync job both run with the service role.
-- No policies needed; default-deny applies.
