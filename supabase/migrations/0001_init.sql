-- 0001_init.sql — schema for Jerusalem Doctors Directory MVP.
-- Apply once to a fresh Supabase project. RLS is enabled in 0002_rls.sql,
-- specialties seeded in 0003_seed_specialties.sql.

-- ---------- extensions ----------
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ---------- doctors ----------
create table public.doctors (
  id                            uuid primary key default gen_random_uuid(),
  auth_user_id                  uuid unique references auth.users(id) on delete set null,

  phone_e164                    text not null unique,
  phone_display                 text,

  arabic_first_name             text not null,
  arabic_family_name            text not null,
  arabic_full_name              text generated always as
                                  (arabic_first_name || ' ' || arabic_family_name) stored,

  arabic_first_name_normalized  text not null,
  arabic_family_name_normalized text not null,
  arabic_full_name_normalized   text not null,

  hebrew_first_name             text not null,
  hebrew_family_name            text not null,
  hebrew_full_name              text generated always as
                                  (hebrew_first_name || ' ' || hebrew_family_name) stored,

  license_number                text not null unique,
  license_verified_at           timestamptz,
  license_verification_status   text
    check (license_verification_status in (
      'verified', 'soft_match', 'not_found', 'name_mismatch_overridden'
    )),

  subspecialty                  text,
  subspecialty_normalized       text,

  email                         text,

  consent_directory_use         boolean not null default false,
  consent_timestamp             timestamptz not null default now(),

  is_phone_verified             boolean not null default false,
  is_active                     boolean not null default true,
  is_visible                    boolean not null default true,
  is_admin_approved             boolean not null default false, -- gated by license-check at signup
  is_admin                      boolean not null default false,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- ---------- specialties (admin-editable) ----------
create table public.specialties (
  id                  uuid primary key default gen_random_uuid(),
  name_ar             text not null,
  name_ar_normalized  text not null,
  name_he             text,
  name_en             text,
  sort_order          int default 0,
  is_active           boolean not null default true
);

-- ---------- doctor_specialties (m:n) ----------
create table public.doctor_specialties (
  doctor_id     uuid references public.doctors(id) on delete cascade,
  specialty_id  uuid references public.specialties(id) on delete restrict,
  primary key (doctor_id, specialty_id)
);

-- ---------- audit logs ----------
create table public.audit_logs (
  id                uuid primary key default gen_random_uuid(),
  actor_doctor_id   uuid references public.doctors(id) on delete set null,
  action            text not null,
  target_doctor_id  uuid references public.doctors(id) on delete set null,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

-- ---------- pending_signups (OTP TTL store) ----------
create table public.pending_signups (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  payload       jsonb not null,
  expires_at    timestamptz not null,
  attempts      int  not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- moh_practitioners (mirror of data.gov.il, see plan §13) ----------
create table public.moh_practitioners (
  license_number          int  primary key,
  hebrew_first_name       text not null,
  hebrew_family_name      text not null,
  hebrew_first_norm       text not null,
  hebrew_family_norm      text not null,
  specialty_name_he       text,
  license_issued_yyyymmdd int,
  synced_at               timestamptz not null default now()
);

-- ---------- indexes ----------
-- Trigram indexes power ILIKE '%q%' substring search at directory scale.
create index doctors_arabic_full_norm_trgm
  on public.doctors using gin (arabic_full_name_normalized gin_trgm_ops);
create index doctors_arabic_first_norm_trgm
  on public.doctors using gin (arabic_first_name_normalized gin_trgm_ops);
create index doctors_arabic_family_norm_trgm
  on public.doctors using gin (arabic_family_name_normalized gin_trgm_ops);
create index doctors_subspecialty_norm_trgm
  on public.doctors using gin (subspecialty_normalized gin_trgm_ops);
create index doctors_hebrew_full_trgm
  on public.doctors using gin (hebrew_full_name gin_trgm_ops);

-- Visibility filter is the hot path on every search.
create index doctors_visibility
  on public.doctors (is_active, is_visible, is_phone_verified, is_admin_approved, consent_directory_use);

create index specialties_name_ar_norm_trgm
  on public.specialties using gin (name_ar_normalized gin_trgm_ops);

create index pending_signups_phone
  on public.pending_signups (phone_e164);

create index audit_logs_actor
  on public.audit_logs (actor_doctor_id, created_at desc);

create index moh_practitioners_norm
  on public.moh_practitioners (hebrew_first_norm, hebrew_family_norm);

-- ---------- updated_at trigger ----------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger doctors_touch_updated_at
  before update on public.doctors
  for each row execute function public.tg_touch_updated_at();
