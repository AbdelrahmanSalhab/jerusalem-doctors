-- Supabase's performance advisor: number_requests.requester_id is a foreign
-- key (number_requests_requester_id_fkey) with no index behind it, so deleting
-- or updating a doctor scans the table for their requests. Small today, free
-- to fix. The four "unused index" findings are left alone: those tables see
-- little traffic, which is why nothing has used them yet.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

create index if not exists number_requests_requester_id_idx
  on public.number_requests (requester_id);

insert into public.applied_migrations (name) values ('20261101120000_number_requests_requester_index') on conflict do nothing;
