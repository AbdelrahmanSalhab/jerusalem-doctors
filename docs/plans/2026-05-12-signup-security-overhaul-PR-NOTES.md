# PR notes - signup security overhaul

Closes #16, #17, #18, #19, #20.

## Required environment variables (set before merge)

| Var | Where | Notes |
|---|---|---|
| `RESEND_API_KEY` | Vercel project (Production + Preview) | Get from Resend dashboard. Without it, signup emails will fail. |
| `RESEND_FROM` | Vercel project | e.g. `Jerusalem Doctors <noreply@yourdomain.example>`. Domain must be verified in Resend. |
| `SIGNUP_TOKEN_SECRET` | Vercel project | 32+ random bytes (`openssl rand -hex 32`). Rotating invalidates pending email-verify links — set once, do not rotate without comms. |
| `NEXT_PUBLIC_APP_URL` | Vercel project | e.g. `https://jerusalem-doctors.vercel.app`. Used to build the email verification URL. Without it the dispatcher falls back to `VERCEL_URL` then `localhost:3000`. |
| `RESEND_BASE_URL` | optional | Override for tests; do not set in prod. |
| `CRON_SECRET` | Vercel project | Must match the Vercel cron secret configured for this project. Without it, the revocation sweep endpoint is publicly callable. |

## Required Supabase actions (before merge)

1. Apply migrations 0007, 0008, 0009 to the prod database. **0008 includes a column rename** (`is_visible` to `user_chose_visible`) and a one-time `UPDATE` that flips every non-admin `is_admin_approved=true` to `false`. Make a snapshot before applying.
2. Verify `pg_trgm` is still enabled (it is from 0001).
3. After apply: confirm `select count(*) from doctor_visible;` returns 0 (since all approvals were reset).
4. Verify the Supabase project's email domain (Resend) is set up with SPF, DKIM, and DMARC.

## Pre-merge manual smoke test

Run from the deployed preview URL:

- [ ] **Sign up with an institutional email** (e.g. `+test@hadassah.org.il`). Expect: OTP completes, you land on the post-signup page with "check your email" notice, doctor row exists with `is_admin_approved=false`, `email_is_institutional=true`, `email_verified_at` becomes non-null after clicking the email link.
- [ ] **Sign up with a Gmail address.** Expect: same flow, `email_is_institutional=false`. Admin queue shows the non-institutional badge.
- [ ] **Sign up with a `not_found` license.** Expect: 409 at the form, no OTP sent (check Twilio dashboard).
- [ ] **Insert a `pre_approved_licenses` row for one license; sign up with that license.** Expect: signup proceeds.
- [ ] **Search as an authenticated non-admin doctor.** Expect: zero results (no one is approved yet). Approve one doctor in the admin panel, re-search, that doctor appears.
- [ ] **Run `npm run test:rls` against the prod-like DB.** Expect: all green, including the three new checks.
- [ ] **Sentry**: trigger a deliberate error in `/api/signup/email-verify` (e.g. tamper a token); confirm Sentry captures the event without the token value (it should be `[Filtered]`).

## Acceptance map

| Issue | Acceptance criterion | Met by |
|---|---|---|
| #16 | Phase 1 stopgap merged | `app/api/signup/verify/route.ts` `is_admin_approved: false` |
| #16 | Email verification flow built | Tasks 1, 2, 3, 8, 10 |
| #16 | Admin review UI shows trust signals | Task 13 |
| #16 | E2E signup test demonstrates approval gate | Manual smoke check above |
| #16 | Attempted impersonation cannot reach directory | Same (admin must explicitly approve) |
| #17 | RLS denies unapproved selects | Task 5 (RLS rewrite) + Task 11 (route uses SSR client) |
| #17 | Search route uses SSR client | Task 11 |
| #17 | RLS smoke test extended | Task 15 |
| #17 | Removed .eq does not leak | RLS rewrite + view |
| #18 | Daily cron runs revocation step | Task 12 |
| #18 | Approved doctor missing 3 cycles is inactive + revoked | Task 12 (`shouldRevoke`) |
| #18 | Audit log per revocation | Task 12 |
| #18 | Admin UI lists revoked accounts | Task 13 ("revoked" tab) |
| #19 | `not_found` 409s without OTP | Task 9 |
| #19 | No pending row created | Task 9 (early return) |
| #19 | Audit log captures attempt | Task 9 (`signup_not_found_rejected`) |
| #19 | Smoke test confirms no Twilio | Manual smoke check above |
| #20 | View or approval-time-flip implemented | Task 5 (view) |
| #20 | Signup no longer sets `is_visible: true` directly | Task 7 (column renamed; new field `user_chose_visible: true`) |
| #20 | Smoke test demonstrates invisibility | Task 15 |

## Out of scope (deferred to other issues)

- Email allowlist completeness: `lib/signup/email-allowlist.ts` ships with a TODO marker and 5 seed domains per maintainer decision. Adding more is a one-line PR.
- Removing `license_number` from search results (issue #26).
- Sentry PII scrub audit (issue #27).
- `pending_signups` janitor (issue #21).
- `email_is_visible` toggle (issue #22).
- Subspecialty/workplace input hardening (issue #23).
- Normalization SQL/JS dedup (issue #24).
- CKAN hot-path dependency (issue #25).
