# Operational Runbook

What to do when something goes wrong, and where to find the levers. This file
should fit in a single tab.

## At a glance

- **Hosting:** Vercel — `jerusalem-doctors.vercel.app`
- **DB / Auth:** Supabase project `nqpkkxfmfctuodcubgwf`
- **Source of truth for licenses:** [data.gov.il dataset](https://data.gov.il/api/3/action/package_show?id=2721d62d-d0da-45fd-93ac-5e7809849222)
- **Logs:** Vercel → Project → Logs (server-side `console.error` + 5xx)
- **Audit log:** `/admin/audit` for app-level events
- **Email-of-record:** `asalhab94@gmail.com`

## Common incidents

### Doctors can't sign up — OTP never arrives

**Symptoms:** `/api/signup/start` returns 502 `otp_send_failed`.

**Why it happens:** Supabase Phone provider is not configured, or the provider (Twilio/etc.) is rejecting the destination.

**Fix:**
1. Supabase Dashboard → Authentication → Sign In / Up → Phone Auth.
2. Confirm the toggle is ON and creds are filled.
3. If using Twilio: confirm trial credit isn't exhausted; confirm the recipient phone is on the Twilio Verified-Caller-IDs list (only an issue while Twilio is on trial).
4. If everything looks fine, try the curl probe from `README.md` to see Supabase's raw error response.

**Quick mitigation if the provider is broken:** flip `NEXT_PUBLIC_PHONE_AUTH_DISABLED=1` in Vercel and redeploy. /signup and /login will show a "coming soon" banner.

### MoH license sync stops working

**Symptoms:** New signups land with `license_verification_status = 'not_found'` more often than usual.

**Why:**
- data.gov.il rate-limited or down
- Their dataset URL changed (resource ID rotates very rarely)
- CKAN responded with HTML instead of JSON (anti-bot)

**Fix:**
1. Check `/admin/audit` for the latest `moh_sync_completed` row. If it's > 48 h old, the cron is failing.
2. Vercel → Functions → `/api/cron/sync-moh` → recent invocations. Check status code.
3. Run the cron manually:
   ```bash
   curl -X GET "https://jerusalem-doctors.vercel.app/api/cron/sync-moh" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
4. If data.gov.il itself is the issue, the route falls back to live CKAN per signup, so signups still work — they just take a few hundred ms longer and route through admin queue.

If the dataset URL changed, update `MOH_RESOURCE_ID` in Vercel env vars; no code change needed.

### `is_visible=false` runaway / accidental mass hide

A bug or admin mistake hides everyone from search.

```sql
update public.doctors set is_visible = true where is_active = true;
```

Restores all active doctors to visible. Audit `/admin/audit` to see who toggled what.

### Need to roll back an RLS policy change

If a new RLS policy breaks reads, drop it:

```sql
drop policy "<policy name>" on public.doctors;
```

Then `\dp public.doctors` (or `select * from pg_policies` ) to see what's left.

If that's not enough, temporarily disable RLS on the table (use only as last resort):

```sql
alter table public.doctors disable row level security;
-- diagnose, then re-enable:
alter table public.doctors enable row level security;
```

### A doctor is locked out / wants their phone changed

The phone field is intentionally locked to avoid identity-rebinding attacks. To change it for a real doctor:

```sql
update public.doctors
   set phone_e164 = '+972...',
       phone_display = '050-...',
       is_phone_verified = true
 where id = '<doctor-uuid>';
```

You'll also need to update their corresponding `auth.users` row's phone:

```sql
update auth.users
   set phone = '+972...'
 where id = (select auth_user_id from public.doctors where id = '<doctor-uuid>');
```

After this, the doctor's next login attempt with the new number works.

### Spam signups

`/api/signup/start` rate limits are per-phone (3/hr) and per-IP (10/hr) via Upstash. If they're being bypassed:

1. Check Upstash dashboard — confirm the limiter is hitting the right keys.
2. Tighten limits in `lib/ratelimit.ts` and redeploy.
3. As a hard stop, flip `NEXT_PUBLIC_PHONE_AUTH_DISABLED=1`.

### A signup got through with `license_verification_status = 'not_found'`

By design — these land in admin queue (`is_admin_approved=false`). They DO NOT show up in search. Review at `/admin?status=pending` and approve if legitimate, or use the action buttons to suspend.

## Common one-liners

### Promote yourself to admin

```sql
update public.doctors set is_admin = true where phone_e164 = '+972...';
```

### Count by approval status

```sql
select is_admin_approved, count(*)
  from public.doctors
 group by 1;
```

### Latest signups

```sql
select arabic_first_name, arabic_family_name, license_number, license_verification_status, is_admin_approved, created_at
  from public.doctors
 order by created_at desc
 limit 20;
```

### Force-resync MoH (deletes mirror, then refills)

```sql
truncate table public.moh_practitioners;
```

Then hit the cron endpoint manually as documented above.

### See cron history

```sql
select created_at, action, metadata
  from public.audit_logs
 where action like 'moh_sync%'
 order by created_at desc
 limit 20;
```

## Contacts

- **Developer:** Abdelrahman Salhab — WhatsApp `+972524209156`, [LinkedIn](https://www.linkedin.com/in/abdelrahman-salhab/)
- **Supabase support:** dashboard chat (response in hours, free tier)
- **Vercel support:** docs + community forum on hobby plan
