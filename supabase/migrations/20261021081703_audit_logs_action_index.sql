-- An index for reading the activity log by event, newest first.
--
-- The admin panel now counts recent alerts on every page (the التنبيهات
-- badge), and the log's event filter, the registry sync's "was there a full
-- sweep this week" and the admin panel's "when did the registry last sync"
-- all ask for one action ordered by time. Without this each is a scan of the
-- whole log, which only grows.
-- Apply in the Supabase SQL editor. Safe to run more than once.

create index if not exists audit_logs_action_created
  on public.audit_logs (action, created_at desc);
