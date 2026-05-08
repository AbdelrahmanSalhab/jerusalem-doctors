-- 0004_workplaces.sql — add doctor workplaces.
-- Apply after 0003. Adds a new table + RLS, no destructive changes.

create table public.doctor_workplaces (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references public.doctors(id) on delete cascade,
  name            text not null,
  name_normalized text not null,
  is_primary      boolean not null default false,
  sort_order      int    not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One primary workplace per doctor (partial unique index).
create unique index doctor_workplaces_one_primary
  on public.doctor_workplaces (doctor_id)
  where is_primary;

create index doctor_workplaces_doctor
  on public.doctor_workplaces (doctor_id, sort_order);

create index doctor_workplaces_name_norm_trgm
  on public.doctor_workplaces using gin (name_normalized gin_trgm_ops);

create trigger doctor_workplaces_touch_updated_at
  before update on public.doctor_workplaces
  for each row execute function public.tg_touch_updated_at();

alter table public.doctor_workplaces enable row level security;

-- Read mirrors doctors visibility through the join.
create policy "doctor_workplaces readable for visible doctors"
  on public.doctor_workplaces
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_workplaces.doctor_id
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

-- Owner can manage their own workplaces.
create policy "doctor_workplaces owner manages"
  on public.doctor_workplaces
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_workplaces.doctor_id
        and d.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_workplaces.doctor_id
        and d.auth_user_id = auth.uid()
    )
  );

-- Admin can manage all.
create policy "doctor_workplaces admin manages"
  on public.doctor_workplaces
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
