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

**Who failed, and why.** `/admin/stats` → "رموز التحقق" counts every code that
could not be sent (`sms_failed`, and `login_send_failed` for sign-ins), by
reason and with the latest cases: the doctor's name, or "تسجيل جديد" for a
signup (`/admin/signups` shows the count per signup too). Never the number.
Reasons: `daily_cap`, `sms4free_status_N` (the table below), `sms4free_timeout`,
`sms4free_http_N`, `supabase_<code>` (Supabase refused before our hook ran:
`over_sms_send_rate_limit` is its per-hour limit or one text per number per
60 seconds). A failure can appear twice, once from our hook and once from
Supabase. A login with a number that has no account is not a failure: it is
counted separately ("حاولوا الدخول بلا حساب"), and the doctor sees the same
code screen as anyone.

Since 1 Nov 2026 each sent, failed and delivery-report row from the hook and
the delivery webhook carries `meta.prefix`: the first three digits of the
number (`052`, `059`, `other`), never the number. Numbers move between
networks, so it is a hint to the carrier. Nothing shows it yet; read it with
`select meta->>'prefix', kind, count(*) from usage_events where meta ? 'prefix'
group by 1, 2`. Grouping it in `/admin/stats` needs a change to `otp_stats`.

**Fix:**
1. Supabase Dashboard → Authentication → Providers → Phone: confirm it is ON,
   and that "SMS OTP Expiry" equals `OTP_VALID_SECONDS` in
   `lib/otp/expiry.ts` (see **The code's lifetime** below).
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

How the registry is used: `moh_practitioners` is our copy of it, one row per
licence with every specialty certificate. The cron runs nightly at 04:00 UTC
(the ministry republishes at about 03:12):
- once a week it reads the whole registry, about 65 requests a second apart,
  and drops licences the registry no longer lists
- other nights it asks only for our doctors' licences, 300 per request

A signup checks the copy first; a licence issued since the last sweep gets
one live request and is kept. A 403 or 429 is never retried: the next night
tries again. A sweep that would shrink the copy by over 10%, or that misses
more than half our doctors' licences, is refused and logged as a failure.

When one of our doctors' licences is no longer in the registry, its status
becomes `not_found` (so the doctor shows under "ترخيص يحتاج مراجعة"), an
audit entry `license_missing_from_registry` is written, and Sentry gets a
warning. Nothing is hidden automatically: re-check the licence from the
doctor's panel and decide.

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

By design, every new signup lands in the admin queue (`is_admin_approved=false`), whatever the registry says (#16): the registry match is public data, so it proves nothing about who is typing. They DO NOT show up in search. Review at `/admin?status=pending`; accepting asks for a reason (how you know it is them), or use the action buttons to suspend.

### «ترخيص يحتاج مراجعة» on /admin

The tile (and the list behind it, `?status=license`) counts doctors whose
primary licence is not «موثّق» **and** that no admin has reviewed
(`doctors.license_reviewed_at`). Before, it counted every licence the registry
had not confirmed, so a Palestinian licence (no registry to check it against)
or an Israeli one the registry does not list stayed in it for good, however
carefully an admin had looked.

A licence is marked reviewed when an admin accepts the doctor with a reason,
saves the primary licence after a change, or presses «تمت المراجعة» in the
licence section (an optional note goes to the activity log). The nightly
registry sync clears the mark when it flags a licence as gone, so that doctor
comes back to the queue. A save that changes nothing writes nothing: use
«تمت المراجعة» for that.

### Who is in the directory (`listed_doctors`)

"Listed" is five conditions on `doctors`: active, visible, phone verified,
approved by an admin, and consent to the directory. They are written **once**,
as the `listed_doctors` view (migration `20261102180000_listed_doctors_view.sql`),
which has only the columns the directory shows and no grant to the public
roles. Search (`search_directory()`), the counts (`directory_counts()`) and the
card query (`lib/directory.ts`) all read it, and so a change to who is listed is
one edit to the view.

Code that lists doctors must read the view, never the `doctors` table: an ESLint
rule (`eslint.config.mjs`) fails on `.from("doctors")` outside an allowlist
(the admin panel, sign-in and sign-up, the cron jobs, the session and a few
helpers). A file that really needs the row itself is added to the allowlist,
which is the review point. `e2e/db/listed.spec.ts` takes each condition away
from a listed doctor and checks the view, search, counts and the admin panel's
own explanation (`directoryVisibility`) agree.

Two older places still repeat the conditions and read the table: the row-level
security policies on `doctor_specialties` and `doctor_workplaces`
(`20261021103844_supabase_lint.sql`). They are not changed here.

### New doctors, and who may search (#16)

Every signup waits for an admin, whatever the registry says: the registry match
is public data, so it proves nothing about who is typing. Until accepted a
doctor sees only a waiting panel and can edit their profile; search, contact
clicks and number requests answer 403 `not_approved` (`lib/auth/directoryAccess.ts`,
and an admin must also have passed the second factor). The new-doctor alert goes
to one admin at a time, in turn; a morning check (`/api/cron/waiting`) tells every
admin about doctors who have waited a day.

Accepting asks how you knew it is them (a number you found yourself, not one on
their profile or their phone; a colleague who vouches; a licence or ID you saw)
and a few words. Both are kept in the activity log.

- **Migrations first.** `20261104130000_approved_at.sql` and
  `20261104170000_identity_reviewed_at.sql` must be applied before the code that
  accepts doctors is deployed: accepting writes both columns, and fails with a
  500 without them.
- **Doctors accepted before this (on a registry match alone) are listed under
  «لم تُراجَع هويته»** in the admin list, with a badge on the row. Open one, press
  «مراجعة الهوية», say how you knew it is them and a few words; it goes to the
  activity log and the doctor leaves the list. Accepting a new doctor is the same
  review, so only the older ones are in it.
- **The WhatsApp message to a newly accepted doctor** is sent from the admin's
  own WhatsApp, so the doctor sees that admin's number. Use a shared admin or
  business number for it if that matters.
- **A duplicate licence at signup** (someone registered it first) raises an
  alert and an activity-log entry naming the existing account: either a doctor
  who signed up twice, or someone holding a real doctor's licence.
- **A heavy searcher:** an account over 600 searches in a day is refused and an
  alert is raised once a day for it.
- **An accepted doctor changes their Arabic name:** it is saved, logged with the
  old and new name, and the admins are alerted. The one rename that is refused
  is to the exact Arabic name another listed doctor already has (they are told
  to write to the admins); a real namesake is then fixed by an admin in the
  panel, which does not have this check. Any other new name is not held for
  review (#247).

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

### The code's lifetime ("SMS OTP Expiry")

Production was **60 seconds** (checked 27 Oct 2026), Supabase's
default, and is now **600** (set through the Management API; read it back with
a `GET` on the same URL to check). 60 was short: a text that arrives late, or a doctor who looks a minute later,
meets a dead code, and Supabase answers "wrong" and "expired" the same way.
Doctors reported exactly that ("I got two codes and both were wrong").

- **The verify page follows the setting.** `OTP_VALID_SECONDS` in
  `lib/otp/expiry.ts` drives the "valid for…" line and when a new code is
  offered. Change it together with the setting.
- **The resend wait is its own number.** `RESEND_AFTER_SECONDS` (60, Supabase's
  floor between two sends to a number) in the same file, so a longer lifetime
  does not make a doctor wait that long to ask again. `OTP_LENGTH` (6) must
  match "SMS OTP Length".
- **The sixth digit submits** the code, a refused one is cleared, and Android
  Chrome reads the text itself when it ends with the domain line (below).
- **Domain-bound text (off by default).** `SMS_DOMAIN_LINE=1` in Vercel makes the
  text `123456 رمز دليل أطباء القدس` + a last line `@<host> #123456`, which
  iOS 14+ and Android Chrome use to offer or read the code only on our site
  (`SMS_ORIGIN_HOST` overrides the host; default is Vercel's production
  address). Same one segment, but a line that looks like an address can be held
  back by a carrier, so turn it on, send yourself a code on each carrier's phone
  and look at `/admin/stats` (delivered, failed) before leaving it on. Off again:
  unset it, no deploy of code needed beyond Vercel's redeploy.
- **A new code cancels the previous one.** The page says so after a resend
  («استخدم آخر رمز وصلك فقط»).
- **The dashboard locks the field while the Send SMS hook is on** ("SMS
  provider settings are disabled while the SMS hook is enabled"). Both values
  were changed through the Management API's auth config,
  `PATCH https://api.supabase.com/v1/projects/<ref>/config/auth`, with the
  project Owner's personal access token: `{"sms_otp_exp": 600,
  "rate_limit_sms_sent": 100}` (read back on 1 Nov 2026: 600 and 100; SMS per
  hour was 30). Also set that day: `sms_max_frequency` 60 (seconds between two
  texts to one number; it was 5, so a direct call to Supabase could text a
  doctor every 5 s, which our per-number limit never saw), the unused Twilio
  account SID and message service SID cleared (the auth token field still
  reads back 64 characters; revoke it in Twilio if it matters), and the old
  `sms_test_otp` mapping (May, expired) emptied. The database now refuses
  connections without SSL (`PUT /v1/projects/<ref>/ssl-enforcement`, 1 Nov; the app
  uses the REST API and is not affected; a direct `psql` needs `sslmode=require`).
  Our own limits sit inside them: a code gets 5 guesses per 10
  minutes per phone at login (`loginVerify`) and 5 per code at signup, and the
  site sends at most 200 texts a day.
- **How Supabase calls the hook** (supabase.com/docs/guides/auth/auth-hooks):
  5 s for the whole call, retries included; it retries only a `429` or `503`
  carrying a non-empty `retry-after`, up to three times two seconds apart. A
  `500` is never retried. The hook answers a transient SMS4FREE failure with
  `503` + `retry-after`, and a permanent one (credentials, balance) with
  `400`. A call that runs out of time can still be retried, so
  `lib/otp/sentOnce.ts` sends a given code to a given phone only once.
- **The code's lifetime can be raised despite the locked field:** the
  Management API's `sms_otp_exp` (seconds) on
  `PATCH /v1/projects/<ref>/config/auth` (Supabase's published API schema).
- **Twilio** shows as the SMS provider but is unused while the hook is on. If
  the hook is ever switched off, Supabase falls back to it: clear its
  credentials so that can't happen by accident.
- The kill switch (`NEXT_PUBLIC_PHONE_AUTH_DISABLED=1`, then redeploy) is also
  enforced in the Send SMS hook, so direct calls send nothing while it is on.

### Backups (the free plan has none)

Supabase's free plan keeps no backups and has no point-in-time recovery
(checked 1 Nov 2026: 0 backups). `.github/workflows/backup.yml` runs
`scripts/backup/backup.sh` every night at 01:41 UTC:

**The plan decision (7 Nov 2026): stay on the free plan and rely on these
dumps.** Considered: Supabase Pro (from $25 a month: daily backups, last 7 days,
restorable from the dashboard) and Pro with point-in-time recovery (about $125
a month: restore to within about 2 minutes). Chosen because the worst case here
is a day of profile edits, signups and admin decisions, all re-doable by hand;
the dump is off Supabase, so it survives losing the account, and its restore has
been run end to end. Revisit when a day of changes stops being acceptable (many
more doctors, or things doctors enter that cannot be re-entered) or when the
dashboard restore is wanted for convenience. Prices are Supabase's, read 7 Nov;
check before paying. Profile photos are in Storage and in no database backup
under any plan, so they need their own copy.

- **What is dumped:** `pg_dump` of the `public` and `private` schemas, with
  their privileges (custom format). `private` holds `is_admin()`, which the RLS
  policies call; the privileges matter because the migrations revoke execute
  from the public roles on security definer functions, and a restore without
  them would hand it back. **Left out on purpose:** the registry mirror (the
  nightly sync refills it), unfinished signups (a phone number and a half-filled
  form, kept 30 days only), sign-ins (a doctor is linked again by phone at the
  next sign-in, `linkAuthUser`) and photos (storage).
- **Checks before it counts:** the database has at least 50 doctors (a wiped
  table is not tonight's "good" copy), the dump lists, holds the doctors and
  `private.is_admin()`, and the encrypted file is not under half of the previous
  one. A failed check is a red run; the log says which step and a coarse
  category (authentication, network, permission, ...), never the message.
- **Encrypted on the runner** with `age` (two recipients) and uploaded to a
  private Cloudflare R2 bucket `jd-backups` (S3-compatible, free 10 GB, no
  egress fees). `daily/` expires after 60 days by the bucket's own rule;
  `monthly/` gets a copy on the 1st and expires after a year. The database is about 30
  MB, so this is far inside the free tier.
- **Nothing here deletes anything:** the job's token cannot be used to wipe the
  backups through the script, and the bucket's rules do the expiring.

**The repository is public, so:** the dump is never a workflow artifact, the log
prints no host, row or connection string, the plaintext exists only on the
runner's temporary disk, and the secrets sit in a GitHub **environment** called
`backup`, limited to the `main` branch, so a pull request cannot read them. Only
the age *public* keys are on GitHub.

**The database login is a role of its own**, `backup` (login, `bypassrls`,
member of `pg_read_all_data`, nothing else), not the `postgres` admin: a leak of
the secret reads the data but cannot change or drop anything. Its pooler user is
`backup.<project ref>`. If it ever lacks a table, the dump fails loudly
(`pg_dump` runs with row security off) rather than leaving the table out.

**One-time setup (a repository admin), in this order:**
1. GitHub, Settings, Environments, new environment `backup` with deployment
   branches limited to `main` **before the workflow first runs**: a job that
   names an environment that does not exist creates it with no branch limit.
2. R2: a private bucket (`wrangler r2 bucket create jd-backups`) and an Account
   API token of the R2 type, **Object Read & Write**, limited to that bucket
   only (a token with zone permissions can change DNS; do not use one). That
   permission includes delete, so also, in the bucket's settings:
   - two object lifecycle rules: prefix `daily/`, expire after 60 days, and
     prefix `monthly/`, expire after 365 days (CLI: `wrangler r2 bucket lifecycle
     add jd-backups --name expire-daily --prefix daily/ --expire-days 60`, and the same with
     `expire-monthly`, `monthly/`, `365`);
   - a bucket lock rule if your plan has it: prefix `daily/` and `monthly/`,
     retention 30 days, so even a valid token cannot delete a recent backup
     (`wrangler r2 bucket lock add jd-backups ...`; the dashboard has it under
     Settings, Bucket lock rules).
   Endpoint `https://<account id>.r2.cloudflarestorage.com`, region `auto`.
3. Two age keys, for two different people, each generated on that person's own
   machine: `age-keygen -o jd-backup.key`. Each keeps their file offline and
   sends only the `age1...` line. Put both lines, one per line, in the secret
   `BACKUP_AGE_PUBLIC_KEY`. Either key alone restores; losing one loses
   nothing. (Rotating: add the new key, wait for a night to pass, remove the
   old one; older files still need the old key.)
4. The `backup` environment's secrets: `BACKUP_DATABASE_URL` (Supabase, Connect,
   **Session pooler**, port 5432, with the `backup.<ref>` user and that role's
   password; the direct host is IPv6-only on the free plan and the runner is
   IPv4; `sslmode=require` is set by the script), `BACKUP_AGE_PUBLIC_KEY`,
   `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`. Optional: `BACKUP_HEALTHCHECK_URL`, a dead man's
   switch (healthchecks.io or similar, expecting a ping a day), which is the
   only way a failure that nobody reads the email about is noticed.
5. Merge, then Actions, Nightly backup, Run workflow once: it ends with
   `backup ok: <file>, <bytes> bytes, <n> doctors`. Then the restore drill below.

**If a night fails:** GitHub emails the person who last edited the schedule
(or created the workflow), only if their Actions notification settings allow it,
not everyone watching the repository. Name that person here and check that
they receive it: the repository admin (Abdelrahman). A red run means last night
has no backup. Scheduled workflows are also switched off after 60 days without
repository activity; re-enable it under Actions (a manual run alone does not
reset that), and a healthcheck URL tells you it stopped.

**Restore drill (once now, then after any change to the workflow or the schema):**
1. Download the newest `daily/jd-*.dump.age`, then
   `age -d -i jd-backup.key -o jd.dump jd-....dump.age`.
2. Into a **fresh** Postgres with Supabase's roles: a scratch Supabase project
   (the free plan allows two; delete it after), or a scratch database in the
   local stack: `docker exec supabase_db_jerusalem-doctors createdb -U postgres jd_restore`.
   Not into the local database that already has the migrations applied: the data
   collides with what is there.
3. Create the schema the dump expects, then restore. `pg_restore` must be
   version 17 or newer:
   ```sql
   create schema if not exists extensions;
   create extension if not exists pg_trgm with schema extensions;
   ```
   A scratch Supabase project already has the `auth` schema. In a **bare**
   database (the local scratch above) create a stub first, or the policies that
   call `auth.uid()` fail to be created:
   ```sql
   create schema auth;
   create table auth.users (id uuid primary key);
   create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
   create function auth.role() returns text language sql as $$ select null::text $$;
   ```
   Then `pg_restore --no-owner -d "<scratch url>" jd.dump`. Keep the privileges
   (do not add `--no-privileges`).
4. **Expected errors, and only these:** `schema "public" already exists`; the
   foreign key from `doctors.auth_user_id` to `auth.users` failing to validate
   (the scratch project has no auth users; the data is all there, only the
   constraint is missing); `permission denied to change default privileges`
   (three, for roles you do not own). Anything else is a problem.
5. **Check it:** `select count(*) from doctors` and the workplace and specialty
   links against production; the policies came back (`select count(*) from
   pg_policies where schemaname = 'public'`, the same number as production); and
   **the grants are those of the source database**: until the migration
   `20261104150000_no_direct_directory_reads.sql` is applied there, `anon` and
   `authenticated` still have SELECT on `doctors`, `doctor_workplaces` and
   `doctor_specialties` (and, with no policy for `anon`, read nothing). This
   must return no rows, whatever the source:
   ```sql
   select proname from pg_proc
    where prosecdef and pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', oid, 'execute');
   ```
   and `has_table_privilege('anon', 'public.doctors', 'select')` must be false.
6. Delete the scratch project and the decrypted file.

Drilled 4 Nov 2026 with the real backup from the first workflow run (downloaded
from the bucket, decrypted with each of the two age keys, restored into a bare
scratch database with the `auth` stub): 133 of 133 doctors, 151 workplaces,
136 specialty links and 18 policies, as in production; no security definer
function open to `anon`; no unfinished signups or registry rows (left out on
purpose); exactly the errors listed above.

**After a real restore, in this order:** apply any migration newer than the
backup; run the registry sync by hand (the mirror table is empty); re-add the
foreign key to `auth.users` if it was dropped, after the auth users exist; **re-apply
account deletions made since the backup's date** (a restore brings deleted doctors
back, and the privacy page promises they are gone); restore the auth settings
(kept in this runbook) and the storage photos (not in this backup). Doctors
sign in again by phone and are linked to their rows (`linkAuthUser`).

**Privacy:** the dump holds doctors' personal data, but only encrypted: it is
encrypted on the runner before it leaves, and Cloudflare holds ciphertext.
The privacy page says backups exist and how long they last; a deleted account
can stay in a backup for up to 60 days (`daily/`) or, in the first-of-the-month
copy, up to a year (`monthly/`); the privacy page says so.

### Usage against the free plans

`/admin/stats` → **الاستخدام الفعلي** shows measured usage, one row per UTC
day from `metrics_daily`, written by `/api/cron/metrics` at 00:30 UTC:
database size against Supabase's 500 MB, the busiest SMS day against the
app's daily cap, and each day's searches, SMS sent, sign-ins, completed
signups, contact presses, alerts and requests to the MoH registry. Past 70%
of the database limit it raises an alert. The limits live in
`lib/limits.ts`.

What it cannot see, because only the provider counts it: Supabase egress,
Upstash commands, and Vercel function calls and cache use. Read those in each
dashboard's Usage page. To rebuild a missed day, run
`select record_daily_metrics('YYYY-MM-DD');` in the SQL editor.

### Alerts: the admin panel and Sentry

Every alert the app raises is listed in `lib/alerts.ts` and goes to two
places through `raiseAlert()`: Sentry, under the English message below, and
the activity log as an `تنبيه` entry. Admins who do not use Sentry see them
under **التنبيهات** in the admin panel (the log filtered to alerts); the tab's
badge counts warnings and urgent alerts from the last 24 hours. The rate
limiter's timeout alert reaches the log at most once an hour (Sentry once a
minute), so a slow Redis cannot flood it.

### Notifications on admins' phones

The alerts above that need someone to act also reach each admin's phone or
browser, as a notification: a doctor waiting for approval, a profile report,
licences gone from the registry, the daily SMS cap or a low SMS balance, the
database nearing its limit, a doctor asking for a colleague's number, and an
account-deletion request (`PUSH_TO` in `lib/alerts.ts`; the rest stay in the
activity log). Web Push, sent by `lib/push.ts` after the response.

- **What it says:** the alert's Arabic title and a link to the admin page.
  Never a name, a number or a licence: it passes through Apple's and Google's
  push services.
- **How often:** one notification per alert in five minutes, and a newer one
  replaces the older. The admin list always shows every one. A new doctor
  waiting is the exception: it goes to one admin at a time, in turn (each
  signup, no throttle), and a daily check pushes to all admins if anyone has
  waited a day (a morning check, once per doctor).
- **Setup, once:** the `push_subscriptions` migration
  (`20261102130000_push_subscriptions.sql`), then three Vercel variables, for
  Production only, and a redeploy (the public key is built in):
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (Sensitive) and
  `VAPID_SUBJECT` (`https://jerusalem-doctors.vercel.app`). A new pair:
  `npx web-push generate-vapid-keys`. Changing the pair signs every device out
  of notifications; admins turn them on again. Without the keys the switch is
  not shown and nothing is sent.
- **Each admin, on each device:** open the admin panel and press «تفعيل
  الإشعارات», then «جرّب» to see one arrive. On an **iPhone** (iOS 16.4 or
  later) the app must first be added to the Home Screen and opened from there;
  in Safari's tab the switch says so. If the browser's notifications for the
  site are blocked, the switch says that too: allow them in the browser's
  settings and reload.
- **Who gets them:** admins only, active ones. A demoted or closed account
  stops at once; a device the push service reports gone (the app removed) is
  deleted on the next send. «إيقاف» removes the device.
- **Not arriving:** check the switch says «مفعّلة», press «جرّب» (a 503 means
  the keys are not set in Vercel), and that the phone's own notification
  settings for the app are on. Delivery is the push service's: a phone that is
  off gets it, if at all, for an hour (`TTL` in `lib/push.ts`).

### Sentry alert rules worth having

Sentry groups identical messages into one issue, and a default "new issue"
alert fires only the first time. Add event-frequency rules ("number of events
in an issue is more than 0 in 1 minute") for:

- `New doctor waiting for approval`: a doctor needs approval (the admin nav
  badge shows the count too).
- `Doctor asked the admins for a number` and `Account deletion requested`:
  someone is waiting on a reply ("طلبات الأرقام"), or an account is closed and
  waits for "حذف نهائي" (see "A doctor asked to delete their account").
- `signInWithOtp failed` tagged `route:login/start` or `route:login/resend`:
  login codes are not being sent.
- `SMS4FREE balance low`: from the daily balance cron. The remaining balance
  is in the event's extra data (it used to be in the message).
- `Daily SMS cap reached` and `Half the daily SMS budget used`: from the
  Send SMS hook.
- `Doctor licences no longer in the MoH registry`: from the registry sync;
  the doctors are under "ترخيص يحتاج مراجعة".
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

### A second factor for these accounts (#164)

A password alone should not open /admin. With `ADMIN_MFA=1` in Vercel, a session
that began with a **password** only counts as an admin's once it has passed the
authenticator-app code (Supabase TOTP, assurance level `aal2`): until then the
admin panel and the admin API answer as they do to anyone who is not an admin.
Sessions that did not begin with a password are not asked: a doctor-admin who
signs in by phone code, and the smoke check's own sign-in (`/api/login/ci`).

**Enrolling.** An admin with a password opens «ملفي», presses «تفعيل التحقق بخطوتين»,
scans the QR with an authenticator app and types the first code. Until that code
is confirmed the factor does not count, so a bad scan locks nobody out. It can
be done once, and only while the flag is off: with it on, a password session that has not given its code cannot start one (a leaked password must not be enough to claim an account's factor). Replacing one, or enrolling a new admin, is for the super admins (step 3).
The browser never talks to Supabase (the site's content-security rules allow
only its own origin), so this goes through `/api/mfa`, `/api/mfa/enroll` and
`/api/mfa/verify`.

**Signing in.** After the password, a session that has a factor is asked for the
code on the same form (`/login/dev`), then lands on `/admin`. With the flag on,
opening `/admin` without the code sends an admin to `/login/dev?code=1`
instead of a 404.

**Supabase setting.** Authentication > Multi-Factor must have TOTP enrolment
and verification on (`mfa_totp_enroll_enabled`, `mfa_totp_verify_enabled`); the
local stack has them on in `supabase/config.toml`.

**A lost phone.** Two super admins, the addresses in `SUPER_ADMIN_EMAILS`
(Vercel; Khaled and Abdelrahman), can reset another admin's authenticator from
the doctor panel in `/admin`: «إعادة تعيين التحقق بخطوتين», pressed twice. It
removes the factor, is on the audit trail (`admin_mfa_reset`), and gives that
admin 15 minutes to enrol a new one from «ملفي»: with the flag on, a password
session without its code cannot enrol otherwise, so a leaked password cannot
claim an account's factor. That window is how a **new** admin is enrolled
once the flag is on. If neither super admin can sign in, whoever holds the
project's keys runs `npm run mfa:reset -- --email <address>` (it only works on admin accounts and writes the audit log too). Super admins reset each other the
same way, and cannot reset themselves. Be on the call while it is open: for
15 minutes a password alone can claim the factor.

**A reset does not end the admin's current sessions.** Supabase's admin API
cannot revoke a user's sessions, so a session that already passed the code stays
an admin's until its token lapses (up to an hour, `jwt_expiry`). If the reset is
an answer to a compromise, also have that admin change their password in «ملفي»
(it signs out their other sessions), or sign them out in the Supabase dashboard
(Authentication > Users).

**What can lock everyone out, and what prevents it.** The flag only asks the
code of a session that began with a **password**. An admin who signs in by phone
code is never asked, so as long as the SMS provider works and an admin's phone
number is on their account, they get in. Keep it that way: do not remove the
phone numbers of the admins who also have a password (three of the four admin
accounts today; the fourth is the CI account), and do not turn the flag on while
the SMS provider is failing. Ways in, in the order to try them:

1. Sign in by phone code (not affected by the flag).
2. Another super admin resets the factor in the panel (above).
3. **Break-glass by SQL**, which needs no service key: in the Supabase SQL
   editor (Abdelrahman; or with the Management API token), for the admin's
   sign-in address:

   ```sql
   delete from auth.mfa_factors
   where user_id = (select id from auth.users where email = '<address>');
   update auth.users
   set raw_app_meta_data = raw_app_meta_data
     || jsonb_build_object('mfa_enrol_until', (extract(epoch from now()) * 1000 + 900000)::bigint)
   where email = '<address>';
   ```

   (The first removes the authenticator, and its challenges with it; the second
   opens the 15 minute window.) `npm run mfa:reset` does the same with the
   service key.
4. Take the flag off: remove `ADMIN_MFA` in Vercel and redeploy (Abdelrahman).
   Every password session works again at once.

**Before the flag goes on**, read who is enrolled and who could still get in:

```sql
select d.is_visible as a_doctor,
       (u.phone_confirmed_at is not null) as can_sign_in_by_phone,
       (u.encrypted_password <> '') as has_password,
       (select count(*) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as authenticators
from auth.users u join public.doctors d on d.auth_user_id = u.id
where d.is_admin and d.is_active
order by 1, 2;
```

Every row with a password and no phone must have an authenticator, and at least
two rows must be able to sign in by phone. The authenticator itself is tested
against real tokens with `E2E_ADMIN_MFA=1` (`e2e/README.md`), which CI does not
run.

**It is off.** Turning it on before every password account has enrolled
locks that account out of /admin. Rollout:

1. Merge steps 1 to 3. Set `SUPER_ADMIN_EMAILS` in Vercel.
2. In Supabase, Authentication > Multi-Factor: TOTP enrolment and verification on.
3. Each password admin enrols in «ملفي». The audit page shows who has
   (`admin_mfa_enrolled`).
4. Set `ADMIN_MFA=1` and redeploy. Check that each admin still reaches `/admin`
   (password, then the code).
5. To turn it off in an emergency, remove `ADMIN_MFA` and redeploy.

### What this does not have

**MFA is not enforced until `ADMIN_MFA=1`.** Enrolling a factor alone adds a
code step at sign-in, but `/admin` still opens for a password session that
skipped it (for example by going straight to the URL) while the flag is off.

## The production smoke check's sign-in (no password)

`.github/workflows/smoke.yml` checks the live site after every deploy and every
six hours, signed in as an admin. It signs in as a dedicated **CI account**,
with a token GitHub issues to that workflow (OpenID Connect), checked by
`POST /api/login/ci` (`lib/auth/githubOidc.ts`): GitHub's signature, this
repository, `smoke.yml`, GitHub's own runners, fresh, and each token once.

- **Nothing to leak.** No password or secret exists for it. The CI account
  has no password and no phone, and its email is on the reserved `.invalid`
  domain, so no other sign-in reaches it. A copied token is single-use and
  lives for minutes.
- **Signed out at the end** of every run (`e2e/smoke/smoke.teardown.ts`).
- **The trust boundary** is write access to this repository: only a workflow
  file named `smoke.yml` here can get a token that passes, which is the same
  boundary a GitHub secret had. Pull requests from forks get no token.

Setting it up, once per Supabase project:

1. `npm run ci-login:add` (needs `.env.local` with the service key). It
   creates the account, hidden from the directory, and prints the email.
2. On Vercel (Production): `CI_LOGIN_EMAIL=ci@jerusalem-doctors.invalid`,
   then redeploy.
3. Delete the old `SMOKE_EMAIL` and `SMOKE_PASSWORD` secrets on GitHub, and
   take that address off `DEV_LOGIN_EMAILS` if nobody signs in with it.

The smoke check records no traces, screenshots or videos: they would record
the session and admin pages, and the repository is public.

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
