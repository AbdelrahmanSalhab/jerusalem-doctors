# Operational Runbook

What to do when something goes wrong, and where to find the levers. This file
should fit in a single tab.

## At a glance

- **Hosting:** Vercel, `jerusalem-doctors.vercel.app`
- **DB / Auth:** Supabase project `nqpkkxfmfctuodcubgwf`
- **Source of truth for licenses:** [data.gov.il dataset](https://data.gov.il/api/3/action/package_show?id=2721d62d-d0da-45fd-93ac-5e7809849222)
- **Logs:** Vercel → Project → Logs (server-side `console.error` + 5xx)
- **Audit log:** `/admin/audit` for app-level events
- **Email-of-record:** `asalhab94@gmail.com`

## Common incidents

### Doctors can't sign up, OTP never arrives

**How OTP delivery works.** Supabase Auth generates, stores, and verifies the
code. It does not send it. It POSTs Supabase's **Send SMS Hook** to
`/api/auth/hooks/send-otp`, which verifies a Standard Webhooks signature and
then calls the SMS4FREE API. So a missing OTP is a failure in one of three
places, in this order:

```
signInWithOtp  →  Supabase hook dispatch  →  our hook route  →  SMS4FREE
```

**Symptoms and where to look:**

| Symptom | Likely cause |
|---|---|
| `/api/signup/start` returns 502 `otp_send_failed` | Supabase rejected the request before the hook ran, Phone provider off, or the hook returned non-2xx |
| Many `otp_send_failed` at once on signup, or many Sentry `signInWithOtp failed` events tagged `route:login/start` / `route:login/resend` | Supabase's own Auth rate limit (SMS per hour, project-wide) is exhausted. Dashboard → Authentication → Rate Limits; size it for the expected signups per hour. Login never shows this error to the doctor (it would reveal the number is registered); they see the code screen and its "no code?" help, so Sentry is the only signal |
| `/api/login/start` returns 400 `phone_unsupported` | Not an incident: the number is outside +972 or is a landline. See "Which numbers we can reach" below |
| Vercel logs show `[send-otp] delivery failed: SMS4FREE send failed (status -N)` | The provider rejected the send, read the status table below |
| No `[send-otp]` line in Vercel logs at all | Supabase never reached us, wrong hook URL, or the hook is disabled |
| Hook route returns 401 | Signature mismatch, `SEND_SMS_HOOK_SECRET` in Vercel does not match the secret in Supabase |

**Fix:**
1. Supabase Dashboard → Authentication → Providers → Phone: confirm it is ON,
   and that the OTP expiry matches what the UI's resend timer promises.
2. Supabase Dashboard → Authentication → Hooks → **Send SMS hook**: confirm it
   is enabled, type HTTPS, URL is
   `https://jerusalem-doctors.vercel.app/api/auth/hooks/send-otp`.
3. Compare the secret shown there against `SEND_SMS_HOOK_SECRET` in Vercel.
   It has the form `v1,whsec_…`; paste it whole.
4. Check Vercel → Logs for `[send-otp]`. SMS4FREE statuses, all of which
   arrive inside an HTTP **200**, the body is the real result:

   | status | Meaning | What to do |
   |---|---|---|
   | `> 0` | Accepted, for that many recipients | Nothing, delivery is now the carrier's problem |
   | `0` | General error | Retried automatically. If it persists, contact SMS4FREE support |
   | `-1` | Bad key / user / password | Check `SMS4FREE_KEY`, `SMS4FREE_USER`, `SMS4FREE_PASS` in Vercel |
   | `-2` | Invalid sender ID | A custom `SMS4FREE_SENDER` needs a purchased package; otherwise it must be the registration number |
   | `-3` | No recipients | Our bug, the recipient field was empty. Escalate |
   | `-4` | **Out of message balance** | Top up the SMS package. This is the most likely cause of a sudden total outage |
   | `-5` | Message content rejected | Someone edited `lib/otp/message.ts`. Revert |
   | `-6` | Sender not verified | Send one message by hand from the SMS4FREE site to complete first-use verification |

5. `[send-otp] delivery failed: SMS4FREE send failed: network error or timeout`
   is the **unknown** case: we aborted at 4s and cannot tell whether the
   provider accepted and billed the message. Do not assume it failed. Supabase
   will retry, so the doctor may receive two codes; only the most recent one
   verifies.

**Balance monitoring.** The account is prepaid, so an empty balance is a silent,
total signup/login outage that looks like "nothing happens". `/api/cron/sms-balance`
polls `ApiSMS/AvailableSMS` daily at 06:00 UTC and raises a Sentry warning below
`SMS4FREE_LOW_BALANCE_THRESHOLD` (default 50), escalating to error at zero. To
check by hand:

```bash
curl -s -X POST https://api.sms4free.co.il/ApiSMS/AvailableSMS \
  -H 'Content-Type: application/json' \
  -d '{"key":"'"$SMS4FREE_KEY"'","user":"'"$SMS4FREE_USER"'","pass":"'"$SMS4FREE_PASS"'"}'
# -> a bare number: messages remaining
```

Reference pricing at the time of writing was ~40₪ per 1,000 messages before VAT.
Each Arabic OTP is one UCS-2 segment (see `lib/otp/message.ts`), so one message
per login attempt. Top up before any invite wave: a pilot of 40 doctors doing
signup plus a couple of logins each is ~120 messages.

**Which numbers we can reach.** OTP is restricted to Israeli mobiles
(`+9725XXXXXXXX`). `+970` numbers and landlines are refused at `/signup/start`
and `/login/start` with `phone_unsupported`, before Supabase issues a code:
that is deliberate, not a bug. WhatsApp reached `+970` over data; SMS4FREE has
no confirmed coverage there. Existing `+970` doctor rows still work for
directory search and click-to-chat; they just cannot log in. Widening this
means confirming coverage with the provider and relaxing `isSmsDeliverable`
in `lib/normalize/phone.ts`.

**WhatsApp (parked).** `lib/otp/whatsapp_meta.ts` still works and is still
registered. It is unused because Meta Business Verification could not be
completed. If that ever changes, `OTP_PROVIDER=whatsapp_meta` plus the
`META_*` variables switches back with no code change, and removes the +972
restriction, since WhatsApp delivers over data.

**Quick mitigation if delivery is broken:** flip `NEXT_PUBLIC_PHONE_AUTH_DISABLED=1`
in Vercel and redeploy. /signup and /login show a "coming soon" banner, and every route that sends an SMS (signup and login start, both resends) answers 503 `phone_auth_disabled`, so bots stop too.

**Testing the hook without waiting for a doctor.** The signature is the only
auth on that route, so you can probe it directly. Expect 401 on a bad
signature and 200 on a good one:

```bash
curl -i -X POST https://jerusalem-doctors.vercel.app/api/auth/hooks/send-otp \
  -H 'content-type: application/json' \
  -H 'webhook-id: probe' -H "webhook-timestamp: $(date +%s)" \
  -H 'webhook-signature: v1,obviously-wrong' \
  -d '{"user":{"phone":"972500000000"},"sms":{"otp":"000000"}}'
# → 401
```

### MoH license sync stops working

How the registry is used: `moh_practitioners` holds only licences we have
looked up, not a copy of the registry. A signup asks data.gov.il for its own
licence (one request, kept afterwards), and the nightly cron (04:00 UTC, after
the ministry republishes at about 03:12) asks for our doctors' licences only,
300 per request, then drops every other row. A 403 or 429 is never retried:
the next night tries again.

**Symptoms:** New signups land with `license_verification_status = 'not_found'` more often than usual.

**Why:**
- data.gov.il rate-limited, refusing us, or down
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
4. If data.gov.il itself is the issue: a signup's licence gets one live CKAN try (5 s, no retries). If that fails it is treated as `not_found`, so the signup still completes and lands in the admin queue. Look for `[moh] live registry lookup failed` in the logs.

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

You'll also need to update their corresponding `auth.users` row's phone.
Supabase Auth stores it **without** the leading `+`:

```sql
update auth.users
   set phone = '972...'
 where id = (select auth_user_id from public.doctors where id = '<doctor-uuid>');
```

After this, the doctor's next login attempt with the new number works.

### Spam signups

`/api/signup/start` rate limits are per-phone (3/hr) and per-IP (30/hr) via Upstash; every limit is in `lib/ratelimit.ts`. The per-IP ones are deliberately loose because a hospital or event Wi-Fi puts many doctors behind one address; the per-phone ones and Turnstile are the real brake. If they're being bypassed:

1. Check Upstash dashboard, confirm the limiter is hitting the right keys.
2. Tighten limits in `lib/ratelimit.ts` and redeploy.
3. As a hard stop, flip `NEXT_PUBLIC_PHONE_AUTH_DISABLED=1`.

### A signup got through with `license_verification_status = 'not_found'`

By design, these land in admin queue (`is_admin_approved=false`). They DO NOT show up in search. Review at `/admin?status=pending` and approve if legitimate, or use the action buttons to suspend.

### A doctor asked to delete their account

"طلب حذف الحساب" on /profile hides and suspends the account at once; the
privacy page promises an admin then completes the deletion. To do that:

1. /admin, filter "معلّقون / طلبات حذف", find the doctor (the audit page shows
   the `delete_requested` entry and when).
2. Press "حذف نهائي" and confirm. It removes the photo, the login
   (`auth.users`) and the doctors row; workplaces, specialties and license
   slots cascade. The doctor's own audit rows (delete request with its IP,
   moderation changes) are deleted too; what remains is one
   `admin_doctor_deleted` row with the old id and no personal data.
3. If it reports a failure, press it again: each step is safe to retry.

The button is offered only on suspended rows, and an admin can't delete
their own account.

### Supabase Auth settings that back our limits

Our Upstash limits only cover requests that go through the app. Supabase Auth
can also be called directly with the public anon key, so its own settings are
the floor (Dashboard → Authentication):

- **Rate Limits:** SMS sent per hour is project-wide. Size it for the busiest
  expected hour (a launch wave plus resends); too low and every send fails
  (signup shows `otp_send_failed`; login stays silent and only Sentry sees
  it). Keep "token verifications" per IP low.
- **Providers → Phone:** OTP length 6 or more, expiry 10 minutes or less.
- The kill switch (`NEXT_PUBLIC_PHONE_AUTH_DISABLED=1`, then redeploy) is also
  enforced in the Send SMS hook, so direct calls send nothing while it is on.

### Sentry alert rules worth having

Sentry groups identical messages into one issue, and a default "new issue"
alert fires only the first time. Add event-frequency rules ("number of events
in an issue is more than 0 in 1 minute") for:

- `New doctor waiting for approval`: a doctor needs approval (the admin nav
  badge shows the count too).
- `signInWithOtp failed` tagged `route:login/start` or `route:login/resend`:
  login codes are not being sent.
- `SMS4FREE balance low`: from the daily balance cron.
- `Workplace names not in the institutions list`: from the daily
  institutions cron. Open /admin/institutions and, for each name, either
  "ربط كطريقة كتابة" (add it as a spelling of an existing hospital or fund)
  or "مؤسسة جديدة". Every change re-links all doctors at once. A name that is
  simply a typo belongs to neither: each unlinked name lists the doctors who
  typed it, and their names open the doctor panel over the same tab, where
  "تعديل الملف" lets you correct what they wrote. Saving re-links that
  doctor's workplaces immediately, so the row disappears on refresh.

## Team sign-in with email and password (/login/dev)

Developers and QA cannot receive the WhatsApp OTP for an account they do not
own, so `/login/dev` signs them in with an email and password instead. It is
off until `DEV_LOGIN=1` and `DEV_LOGIN_EMAILS` are both set; without them the
page and the route answer 404.

### Read this before enabling it in production

**The unadvertised URL protects nothing.** `NEXT_PUBLIC_SUPABASE_ANON_KEY` is
in the browser bundle by design, so once password auth is on for the Supabase
project, anyone can post these credentials straight to
`https://<project>.supabase.co/auth/v1/token?grant_type=password` and get a
session our app accepts. Hiding our page does not change that.

What does hold, in order:

1. **The `doctors` row.** A session is only access once a row carries that
   `auth_user_id` (`lib/auth/session.ts`). A self-registered email account
   resolves to no doctor and every page bounces it.
2. **The allowlist.** `DEV_LOGIN_EMAILS` is checked before Supabase is called
   at all, so our route refuses anyone else outright.
3. **The passwords on these few accounts.** With one shared Supabase project
   this is the real boundary. Long, unique, in a password manager, never in
   the repo and never in a ticket.

Every failure answers `401 invalid_credentials` identically, so the route
cannot be used to find out which addresses are allowlisted. Attempts are rate
limited per address and per IP, and every success writes a
`dev_password_login` entry visible in /admin/audit.

### Setting it up

1. **Supabase → Authentication → Providers → Email**: enable it.
2. **Do NOT turn off "Allow new users to sign up."** That setting is global,
   not per provider, and `signInWithOtp` creates the auth user on a doctor's
   first signup (`app/api/signup/start/route.ts`), so disabling it breaks
   doctor registration with `otp_send_failed`.

   This leaves email self-registration possible while the provider is on, and
   that matters more than it looks: the directory read policy in
   `supabase/migrations/0002_rls.sql` is granted `to authenticated` with no
   requirement that the reader has a `doctors` row, so **any** auth user can
   read every listed doctor straight from PostgREST with the public anon key.
   An account with no doctors row is stopped by the app, not by the database.
   Tighten that policy before enabling the Email provider.
3. **Supabase → Authentication → Password settings**: minimum length 12 or
   more, and turn on leaked-password protection (HaveIBeenPwned).
4. **Create each account** under Authentication → Users → Add user, with
   "Auto Confirm User" checked. Use a generated password per person.
5. **Link each one to a doctor row.** Either a dedicated test doctor, or your
   own. The account is useless without this step:

   ```sql
   -- a dedicated QA doctor, kept out of the directory
   update public.doctors
      set auth_user_id = '<auth user uuid>',
          is_visible   = false
    where phone_e164 = '+972...';
   ```

   Keep `is_visible = false` on test accounts so they never appear in a real
   doctor's search results. Grant `is_admin = true` only to the accounts that
   actually need the admin panel.
6. **Set the env vars** on the deployment (Vercel → Settings → Environment
   Variables), per environment:

   ```
   DEV_LOGIN=1
   DEV_LOGIN_EMAILS=dev@example.com,qa@example.com
   ```

### Turning it off

Unset `DEV_LOGIN` (or clear `DEV_LOGIN_EMAILS`) and redeploy: the page and
route go back to 404. That closes **our** door, not Supabase's. To close that
one, disable the Email provider in Supabase or delete the accounts' passwords.

### When someone leaves the team

Remove their address from `DEV_LOGIN_EMAILS`, redeploy, **and** delete their
Supabase auth user. The first alone leaves them able to use the project's
token endpoint directly.

### What this does not have

**MFA is not enforced.** Supabase can enrol TOTP, but `signInWithPassword`
returns a session at AAL1 and nothing in this app checks the `aal` claim, so
enrolling it would look like protection without being any. Making it real
needs a challenge step in `/api/login/password` and an `aal2` check in
`requireDoctor`. Worth doing if these accounts stay enabled in production
long term.

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

### Force-resync MoH (empties the table, then refills our doctors' licences)

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

- **Developer:** Abdelrahman Salhab, WhatsApp `+972524209156`, [LinkedIn](https://www.linkedin.com/in/abdelrahman-salhab/)
- **Supabase support:** dashboard chat (response in hours, free tier)
- **Vercel support:** docs + community forum on hobby plan
