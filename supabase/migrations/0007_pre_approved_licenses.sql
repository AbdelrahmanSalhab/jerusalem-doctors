-- 0007_pre_approved_licenses.sql — admin allowlist for legitimate signups
-- whose license is not in moh_practitioners (e.g. freshly issued or
-- license-number changed). Apply after 0006.
--
-- Read by app/api/signup/start/route.ts and /check-license/route.ts when
-- license verification returns "not_found". Without a row here, those
-- routes 409 the signup; with a row, they let it proceed (the doctor
-- still goes through admin review per #16).

create table public.pre_approved_licenses (
  -- license_number must be normalized: no leading zeros, digits only.
  -- The app normalizes via String(Number(raw)) before lookup; this constraint
  -- ensures admin-inserted rows are also normalized so they reliably match.
  -- Example: "09417" is rejected; "9417" is accepted.
  license_number   text primary key check (license_number ~ '^[1-9][0-9]*$'),
  reason           text not null,
  added_by         uuid references public.doctors(id) on delete set null,
  added_at         timestamptz not null default now()
);

alter table public.pre_approved_licenses enable row level security;

-- Admins manage; service role bypasses RLS for the read path in /signup/start.
create policy "admin manages pre_approved_licenses"
  on public.pre_approved_licenses
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
