# Test Plan: Signup Security Overhaul
# Issues #16, #17, #18, #19, #20

## Strategy reconciliation

The agreed testing strategy recommended real-DB HTTP integration tests as the primary harness, backed by unit tests for pure helpers and an extended `scripts/rls-smoke-test.ts`. The implementation plan resolves one key assumption differently: the maintainer deferred the dedicated test-database decision to before merge, so a full integration harness is not built in this round. The plan explicitly documents this in Strategy decision 10.

**Adjustments made without user approval needed** (no cost or scope increase):

- The integration tests become vitest unit tests that exercise route handlers with injected Supabase stubs, consistent with the existing `fakeSupabase` builder pattern in `lib/moh/match.test.ts`. This is the highest-fidelity approach available without a real Postgres + RLS environment.
- All pure-logic helpers (allowlist, token, pre-approved, revocation predicate, email dispatch) are tested in isolation exactly as agreed.
- The three RLS smoke-test additions (Task 15) are preserved as the DB-level integration layer. They run against a live Supabase project via `npm run test:rls` before merge, exactly as agreed.
- The Playwright admin snapshot is removed: no hosted environment is available and the strategy explicitly allowed this deferral. The admin UI additions are documented in the PR manual checklist instead.

**No items in `## Strategy changes requiring user approval`:** the adjustments above all reduce cost and are consistent with the maintainer's explicit "not yet, will provide at the end" instruction.

---

## Harness requirements

### Harness 1: Vitest unit harness (already exists)

**What it does:** Runs `lib/**/*.test.ts` in the Node.js environment with the `@/` alias resolved to the repo root.

**How it works:** `npm test` (vitest run). Concretely it is `vitest.config.ts` with the `node` environment and the glob `lib/**/*.test.ts`.

**Estimated complexity:** Zero — it already exists.

**Tests that depend on it:** Tests 1-14, 16-21.

### Harness 2: Fetch-stub pattern for Resend HTTP boundary

**What it does:** Replaces `globalThis.fetch` per-test to capture the HTTP call made by `ResendClient` and return a controlled response. Pattern already used in the plan's test sketches.

**API exposed:** `vi.fn(() => new Response(...))` assigned to `globalThis.fetch`.

**Estimated complexity:** Zero new setup code — each test configures its own stub inline.

**Tests that depend on it:** Tests 7, 8.

### Harness 3: RLS smoke-test extension (already exists at `scripts/rls-smoke-test.ts`)

**What it does:** Creates an anonymous Supabase client against the live project and probes each table or view for unintended reads.

**Estimated complexity:** Additive — three new entries in the `checks` array.

**Tests that depend on it:** Test 22, 23, 24.

---

## Test plan

### Section A: Integration/scenario tests (route-level behavior through real user-facing surface)

#### Test 1 — New doctor signup cannot appear in search until admin approves

**Type:** scenario  
**Harness:** Harness 1 (unit — route functions called directly with stubbed Supabase)  
**Source of truth:** Issue #16 acceptance criterion "attempted impersonation cannot reach directory"; `app/api/signup/verify/route.ts` plan spec (`is_admin_approved: false` unconditionally); `app/api/search/route.ts` plan spec (reads `doctor_visible` view, which requires `is_admin_approved = true`).

**Preconditions:** A fresh doctor-insert stub that records every upserted row. The stub returns `is_admin_approved: false` on reads from `doctors`. The `doctor_visible` view stub returns zero rows for any unapproved doctor.

**Actions:**
1. Call `POST /api/signup/verify` with a valid OTP response (stub returns `verify.data.user.id = "uid-1"`), pending payload with institutional email.
2. Assert the inserted `doctors` row has `is_admin_approved: false`, `user_chose_visible: true`, `email_is_institutional: true`.
3. Call `GET /api/search` as the same authenticated user.
4. Assert the response body is `{ results: [], count: 0 }`.

**Expected outcome:** The doctor row is created with `is_admin_approved: false`. The search returns zero results because the view/RLS filter excludes the row. The response from `signup/verify` includes `{ ok: true, auto_approved: false }`.

**Interactions:** `lib/signup/email-dispatch` (call is best-effort in verify — should be invoked but its failure must not affect the doctor insert).

---

#### Test 2 — Signup with MoH-verified license and institutional email dispatches verification email

**Type:** scenario  
**Harness:** Harnesses 1 + 2  
**Source of truth:** Issue #16 Phase 2; `dispatchSignupVerifyEmail` plan spec.

**Preconditions:** Supabase stub returns success for doctor insert. `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_BASE_URL`, `SIGNUP_TOKEN_SECRET`, `NEXT_PUBLIC_APP_URL` all set in env.

**Actions:**
1. Set `globalThis.fetch` to capture the Resend POST.
2. Call `dispatchSignupVerifyEmail({ doctorId: "uuid-1", email: "dr@hadassah.org.il", arabicFirstName: "نور" })`.
3. Assert fetch was called exactly once to `${RESEND_BASE_URL}/emails`.
4. Assert the request body includes a `html` field containing `https://.../api/signup/email-verify?token=`.
5. Extract the token from the URL and call `verifyEmailToken(token)`.
6. Assert `verifyEmailToken` returns `{ ok: true, id: "uuid-1" }`.

**Expected outcome:** The email is dispatched to Resend with a valid HMAC-signed token bound to the correct doctor id. The token round-trips correctly.

**Interactions:** `lib/email/resend.ts` (the `ResendClient`), `lib/signup/email-token.ts`, `lib/email/templates/signup-verify.ts`.

---

#### Test 3 — Signup with Gmail address still dispatches email but sets `email_is_institutional: false`

**Type:** scenario  
**Harness:** Harness 1  
**Source of truth:** Issue #16 (A+B design); `lib/signup/email-allowlist.ts` behavior; `app/api/signup/verify/route.ts` plan spec.

**Preconditions:** Same as Test 2 except `email: "dr@gmail.com"`.

**Actions:**
1. Call `POST /api/signup/verify` with email `dr@gmail.com` in the pending payload.
2. Assert inserted row has `email_is_institutional: false`, `email_domain: "gmail.com"`.
3. Assert `email_verification_sent` is in the response.

**Expected outcome:** Signup succeeds; `email_is_institutional: false` is recorded. The admin queue will show the non-institutional badge for this row.

**Interactions:** `lib/signup/email-allowlist.ts`, `lib/signup/email-dispatch.ts`.

---

#### Test 4 — `not_found` license at signup/start returns 409 without sending OTP

**Type:** scenario  
**Harness:** Harness 1  
**Source of truth:** Issue #19 acceptance criterion "not_found 409s without OTP"; `app/api/signup/start/route.ts` plan spec (early return before `signInWithOtp`).

**Preconditions:** `verifyLicense` stub returns `{ status: "not_found" }`. `isPreApproved` stub returns `false`. Supabase stub tracks OTP calls.

**Actions:**
1. Call `POST /api/signup/start` with a license number not on the pre-approved list.
2. Assert response status is 409.
3. Assert response body includes `{ error: "license_not_in_registry" }`.
4. Assert no call was made to `supabase.auth.signInWithOtp`.
5. Assert no `pending_signups` row was inserted.

**Expected outcome:** The route returns 409 immediately after the `not_found` branch and never proceeds to OTP dispatch or pending-row creation.

**Interactions:** `lib/moh/match.ts` (mocked), `lib/signup/pre-approved.ts` (mocked), Supabase OTP path (must not be reached).

---

#### Test 5 — Pre-approved `not_found` license proceeds to OTP

**Type:** scenario  
**Harness:** Harness 1  
**Source of truth:** Issue #19 "pre_approved_licenses exception table"; `app/api/signup/start/route.ts` plan spec.

**Preconditions:** `verifyLicense` stub returns `{ status: "not_found" }`. `isPreApproved` stub returns `true`.

**Actions:**
1. Call `POST /api/signup/start` with the pre-approved license number.
2. Assert response status is 200.
3. Assert Supabase `signInWithOtp` was called.
4. Assert a `pending_signups` row was created.

**Expected outcome:** The pre-approved exception bypasses the rejection branch. The full signup flow continues normally.

**Interactions:** `lib/signup/pre-approved.ts` (mocked to return true), `lib/moh/match.ts`.

---

#### Test 6 — email-verify endpoint marks email verified on first click and is idempotent on second

**Type:** scenario  
**Harness:** Harness 1  
**Source of truth:** Issue #16 Phase 2; `app/api/signup/email-verify/route.ts` plan spec ("idempotent — second click is a no-op").

**Preconditions:** A valid HMAC token issued for `doctorId: "uuid-1"`. Supabase stub returns `{ email_verified_at: null }` on first read, `{ email_verified_at: "2026-05-12T..." }` on second read.

**Actions (first click):**
1. Call `GET /api/signup/email-verify?token=<valid-token>`.
2. Assert response status 200, content-type `text/html`.
3. Assert HTML body contains the Arabic confirmation title.
4. Assert Supabase `update({ email_verified_at: ... })` was called once.
5. Assert `audit_logs` insert with `action: "email_verified"`.

**Actions (second click, same token):**
1. Call `GET /api/signup/email-verify?token=<same-token>` again.
2. Assert response status 200.
3. Assert Supabase `update` was NOT called again (stub call count unchanged).

**Expected outcome:** First click sets `email_verified_at`. Second click is a no-op — the endpoint detects `email_verified_at` is already set and skips the update.

**Interactions:** `lib/signup/email-token.ts`, Supabase service client.

---

#### Test 7 — email-verify rejects tampered, expired, and malformed tokens with appropriate HTML

**Type:** boundary  
**Harness:** Harness 1  
**Source of truth:** `app/api/signup/email-verify/route.ts` plan spec; `lib/signup/email-token.ts` error codes.

**Preconditions:** None special; `SIGNUP_TOKEN_SECRET` set.

**Actions:**
1. Call `GET /api/signup/email-verify?token=garbage`. Assert 400 HTML, Arabic "invalid" message.
2. Call with expired token (`issueEmailToken({ ..., ttlMs: -1 })`). Assert 400 HTML with Arabic "expired" copy.
3. Call with tampered payload. Assert 400 HTML.
4. Call with no token param. Assert 400 HTML.

**Expected outcome:** Each invalid token returns a user-readable Arabic HTML error page — not JSON, not a 500.

**Interactions:** `lib/signup/email-token.ts`.

---

#### Test 8 — email-start (resend) dispatches email to authenticated doctor and updates `email_verification_sent_at`

**Type:** integration  
**Harness:** Harnesses 1 + 2  
**Source of truth:** Issue #16; `app/api/signup/email-start/route.ts` plan spec.

**Preconditions:** `getCurrentDoctor()` stub returns doctor with `id: "uuid-1"`, `email: "dr@hadassah.org.il"`, `arabic_first_name: "نور"`. Fetch stub captures Resend POST.

**Actions:**
1. Call `POST /api/signup/email-start`.
2. Assert response is `{ ok: true, sent: true }`.
3. Assert fetch was called once to Resend.
4. Assert Supabase update set `email_verification_sent_at`.

**Expected outcome:** The resend endpoint dispatches the email and records the send timestamp.

**Interactions:** `lib/signup/email-dispatch.ts`, `lib/email/resend.ts`.

---

#### Test 9 — email-start returns 401 for unauthenticated caller

**Type:** integration  
**Harness:** Harness 1  
**Source of truth:** `app/api/signup/email-start/route.ts` plan spec ("caller must have a session").

**Preconditions:** `getCurrentDoctor()` stub throws or returns null.

**Actions:**
1. Call `POST /api/signup/email-start`.
2. Assert response status 401 with `{ error: "unauthenticated" }`.

**Expected outcome:** No email is dispatched. No Supabase update occurs.

---

#### Test 10 — Revocation sweep does not revoke doctor until 3 consecutive misses

**Type:** scenario  
**Harness:** Harness 1 (unit test on the predicate; the DB function is tested via manual smoke)  
**Source of truth:** Issue #18 "3-cycle grace window"; `lib/moh/revocation.ts` and the SQL function spec in `0009_revocation_sweep_fn.sql`.

**Preconditions:** N/A — pure logic test.

**Actions:**
1. Assert `shouldRevoke(0)` returns `false`.
2. Assert `shouldRevoke(1)` returns `false`.
3. Assert `shouldRevoke(2)` returns `false` (REVOKE_AFTER_MISSING_CYCLES is 3).
4. Assert `shouldRevoke(3)` returns `true`.
5. Assert `shouldRevoke(10)` returns `true`.
6. Assert `REVOKE_AFTER_MISSING_CYCLES === 3`.

**Expected outcome:** The threshold is exactly 3 consecutive misses, not 2 and not 4.

**Interactions:** None external.

---

#### Test 11 — Cron sync-moh calls the revocation sweep RPC and writes per-doctor audit rows

**Type:** integration  
**Harness:** Harness 1 (route function with Supabase stub)  
**Source of truth:** Issue #18; `app/api/cron/sync-moh/route.ts` plan spec.

**Preconditions:** Supabase service stub: RPC `revocation_sweep` returns `{ missed: 2, reset: 10, revoked: ["uuid-revoked-1", "uuid-revoked-2"] }`. CKAN stub returns a minimal paginated response (one page of 5 practitioners).

**Actions:**
1. Call `GET /api/cron/sync-moh` with `Authorization: Bearer ${CRON_SECRET}`.
2. Assert Supabase `rpc("revocation_sweep", { threshold_cycles: 3 })` was called once.
3. Assert two `audit_logs` rows were inserted with `action: "license_revoked_sync"` and `target_doctor_id` matching `uuid-revoked-1` and `uuid-revoked-2`.
4. Assert the final `moh_sync_completed` audit row includes `sweep_revoked_count: 2`.

**Expected outcome:** The cron route calls the sweep RPC, writes individual revocation audit rows, and records the sweep summary in the sync-completed audit entry.

**Interactions:** Supabase RPC, CKAN HTTP (stubbed).

---

#### Test 12 — Revocation sweep failure does not abort the sync

**Type:** invariant  
**Harness:** Harness 1  
**Source of truth:** `app/api/cron/sync-moh/route.ts` plan spec ("if the sweep RPC fails, log and continue — the sync itself succeeded; revocation is best-effort for a single run").

**Preconditions:** Supabase RPC stub returns an error. CKAN stub returns valid data.

**Actions:**
1. Call `GET /api/cron/sync-moh` with valid bearer.
2. Assert response status 200.
3. Assert zero revocation `audit_logs` rows inserted.
4. Assert the sync-completed audit row still exists with `sweep_revoked_count: 0`.

**Expected outcome:** A sweep RPC failure degrades gracefully — the upsert into `moh_practitioners` still succeeds and the cron route returns 200.

---

#### Test 13 — check-license returns 409 for `not_found` when not pre-approved

**Type:** integration  
**Harness:** Harness 1  
**Source of truth:** Issue #19; `app/api/signup/check-license/route.ts` plan spec.

**Preconditions:** `verifyLicense` stub returns `{ status: "not_found" }`. `isPreApproved` stub returns `false`.

**Actions:**
1. Call `POST /api/signup/check-license` with a valid Turnstile token and a license number.
2. Assert response status 409.
3. Assert `{ error: "license_not_in_registry", fields: { license_number: "..." } }`.

**Expected outcome:** The check-license endpoint returns the same error shape as signup/start for `not_found`, so the form can surface the error at the first interaction.

---

#### Test 14 — check-license passes through for pre-approved `not_found` license

**Type:** integration  
**Harness:** Harness 1  
**Source of truth:** Issue #19; `app/api/signup/check-license/route.ts` plan spec.

**Preconditions:** `verifyLicense` stub returns `{ status: "not_found" }`. `isPreApproved` stub returns `true`.

**Actions:**
1. Call `POST /api/signup/check-license`.
2. Assert response status 200.

**Expected outcome:** The pre-approved exception is correctly handled at the check-license step, giving the user early feedback that their license is accepted.

---

### Section B: Invariant tests

#### Test 15 — doctor_visible view enforces all five visibility conditions

**Type:** invariant  
**Harness:** Harness 1 (vitest — asserts the view definition in the migration SQL, not the DB output)  
**Source of truth:** `supabase/migrations/0008_signup_security_overhaul.sql` view definition; Issue #20 acceptance criterion.

**Preconditions:** Read the migration file.

**Actions:**
1. Parse the `CREATE OR REPLACE VIEW doctor_visible` block from the migration SQL file.
2. Assert the WHERE clause includes all five conditions: `is_active`, `user_chose_visible`, `is_phone_verified`, `is_admin_approved`, `consent_directory_use`.
3. Assert the view is declared with `security_invoker = true`.

**Expected outcome:** The view definition bakes in all five visibility conditions and is security_invoker so RLS on the base table also applies. A future developer cannot bypass visibility by selecting from the view without also satisfying RLS.

**Interactions:** The migration SQL file only — no live DB needed.

---

#### Test 16 — `is_admin_approved: false` is always inserted in signup/verify

**Type:** invariant  
**Harness:** Harness 1  
**Source of truth:** Issue #16 Phase 1; `app/api/signup/verify/route.ts` plan spec.

**Preconditions:** Supabase stub records every field passed to `doctors` insert.

**Actions:**
1. Call POST with `license_verification_status: "verified"` in the pending payload (the path that previously triggered auto-approve).
2. Assert the captured insert has `is_admin_approved: false`.
3. Call POST with `license_verification_status: "soft_match"`.
4. Assert the captured insert again has `is_admin_approved: false`.
5. Call POST with `license_verification_status: "not_found"` (pre-approved path).
6. Assert the captured insert has `is_admin_approved: false`.

**Expected outcome:** No license verification status — not even an exact MoH match — produces an auto-approved doctor row. This is the direct closure of the impersonation hole described in issue #16.

---

#### Test 17 — signup/verify never sets `is_visible` (old column name)

**Type:** invariant  
**Harness:** Harness 1  
**Source of truth:** Issue #20; migration 0008 renames `is_visible` to `user_chose_visible`.

**Preconditions:** Supabase stub records every field passed to `doctors` insert.

**Actions:**
1. Call POST with a valid pending payload.
2. Assert the captured insert object does NOT contain the key `is_visible`.
3. Assert the captured insert object DOES contain the key `user_chose_visible` with value `true`.

**Expected outcome:** The renamed column is used consistently. A regression where `is_visible` is passed would fail at the DB level (unknown column) and at this test.

---

### Section C: Pure unit tests

#### Test 18 — `extractDomain` and `isInstitutionalEmail` (email allowlist)

**Type:** unit  
**Harness:** Harness 1  
**Source of truth:** `lib/signup/email-allowlist.ts` plan spec; issue #16 design doc (subdomain matching accepted; homoglyphs rejected; Gmail rejected).

**Cases:**
1. `extractDomain("Foo@HADASSAH.org.il")` returns `"hadassah.org.il"` (lowercased).
2. `extractDomain("not-an-email")` returns `null`.
3. `extractDomain("")` returns `null`.
4. `extractDomain("a@")` returns `null`.
5. `extractDomain("@b.com")` returns `null`.
6. `isInstitutionalEmail("dr@hadassah.org.il")` returns `true` (exact match).
7. `isInstitutionalEmail("dr@nursing.hadassah.org.il")` returns `true` (subdomain).
8. `isInstitutionalEmail("dr@hаdassah.org.il")` returns `false` (Cyrillic homoglyph).
9. `isInstitutionalEmail("dr@hadassah-fan.com")` returns `false`.
10. `isInstitutionalEmail("dr@my-hadassah.org.il")` returns `false`.
11. `isInstitutionalEmail("dr@gmail.com")` returns `false`.
12. `isInstitutionalEmail("")` returns `false`.
13. `JERUSALEM_INSTITUTION_DOMAINS` contains `"hadassah.org.il"` and `"szmc.org.il"`.

---

#### Test 19 — HMAC email token (issue, verify, edge cases)

**Type:** unit  
**Harness:** Harness 1  
**Source of truth:** `lib/signup/email-token.ts` plan spec.

**Cases:**
1. `issueEmailToken` + `verifyEmailToken` round-trip returns `{ ok: true, id: original_id }`.
2. Tampered payload returns `{ ok: false, reason: "invalid_signature" }`.
3. Tampered signature returns `{ ok: false, reason: "invalid_signature" }`.
4. Expired token (`ttlMs: -1`) returns `{ ok: false, reason: "expired" }`.
5. Malformed token (`"garbage"`) returns `{ ok: false, reason: "malformed" }`.
6. Empty string returns `{ ok: false, reason: "malformed" }`.
7. Missing `SIGNUP_TOKEN_SECRET` in production throws with a message containing `"SIGNUP_TOKEN_SECRET"`.

---

#### Test 20 — Resend HTTP client

**Type:** unit  
**Harness:** Harnesses 1 + 2  
**Source of truth:** `lib/email/resend.ts` plan spec.

**Cases:**
1. Sends POST to `${RESEND_BASE_URL}/emails` with correct headers (`Authorization: Bearer <key>`, `Idempotency-Key: <key>`) and body (`from`, `to`, `subject`, `html`, `text`). Returns `{ id: "msg_123" }`.
2. Non-2xx response throws `ResendError` with `.status` set.
3. Missing `RESEND_API_KEY` in development returns a synthetic id starting with `"dev-"` without calling fetch.
4. Missing `RESEND_API_KEY` in production throws with message containing `"RESEND_API_KEY"`.

---

#### Test 21 — `isPreApproved` helper

**Type:** unit  
**Harness:** Harness 1  
**Source of truth:** `lib/signup/pre-approved.ts` plan spec.

**Cases:**
1. Returns `true` when Supabase `maybeSingle` returns a row.
2. Returns `false` when Supabase `maybeSingle` returns `null`.

---

### Section D: Regression tests (protecting unchanged behavior)

#### Test 22 — Existing tests remain green after all changes

**Type:** regression  
**Harness:** Harness 1  
**Source of truth:** Baseline 75 tests across 7 files (captured before implementation).

**Actions:**
1. Run `npm test`.
2. Assert all 75 baseline tests still pass.
3. Assert total test count is baseline + new tests added by Tasks 1-12, 16.

**Expected outcome:** No existing test is broken by the rename, schema change, or new modules.

---

### Section E: RLS smoke tests (live Supabase, pre-merge only)

These three tests extend `scripts/rls-smoke-test.ts` and require `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` set to a real Supabase project with migrations 0007-0009 applied.

#### Test 23 — Anon cannot read `doctor_visible` view

**Type:** invariant  
**Harness:** Harness 3  
**Source of truth:** Issue #17; migration 0008 RLS policy rewrite; `scripts/rls-smoke-test.ts` pattern.

**Actions:**
1. Anon client: `SELECT id FROM doctor_visible LIMIT 1`.
2. Assert: either an error (RLS deny) or zero rows.

**Expected outcome:** Anon receives zero rows regardless of database content. Any row returned is a critical leak.

---

#### Test 24 — Anon cannot read `pre_approved_licenses`

**Type:** invariant  
**Harness:** Harness 3  
**Source of truth:** Migration 0007 (`ALTER TABLE public.pre_approved_licenses ENABLE ROW LEVEL SECURITY`; policy grants only `authenticated` + `is_admin()`).

**Actions:**
1. Anon client: `SELECT * FROM pre_approved_licenses LIMIT 1`.
2. Assert: error or zero rows.

**Expected outcome:** The admin-only allowlist table is invisible to anon callers.

---

#### Test 25 — Anon receives zero rows from `doctor_visible` when no approved doctor exists

**Type:** invariant  
**Harness:** Harness 3  
**Source of truth:** Migration 0008 one-time approval reset; post-migration `doctor_visible` must be empty for all non-admin rows.

**Actions:**
1. After applying 0008 (which resets all non-admin approvals to false): anon client `SELECT id FROM doctor_visible LIMIT 1`.
2. Assert zero rows.

**Expected outcome:** The migration's approval reset leaves the view empty. The next doctor to appear in the directory requires explicit admin approval.

**Note:** If the test database has an admin doctor row (admins were spared by the migration), that admin doctor would only appear in `doctor_visible` if `user_chose_visible = true` and `is_active = true`. This is expected and acceptable — the test verifies the non-admin reset.

---

## Coverage summary

### Areas covered

| Area | Tests | Notes |
|---|---|---|
| Impersonation fix (#16 P1): `is_admin_approved: false` always | 16 | Covers all license_verification_status paths |
| Email verification dispatch (#16 P2) | 2, 3, 8 | Covers both institutional and non-institutional emails |
| Email token round-trip, tampering, expiry | 19 (7 cases) | All failure modes |
| Email verify endpoint idempotency | 6 | First click + second click |
| Email verify endpoint error paths | 7 | 4 token error cases |
| Email resend endpoint auth gate | 9 | Unauthenticated rejection |
| RLS enforcement via view definition | 15 | SQL artifact-based |
| `is_visible` rename regression | 17 | Insert field name invariant |
| not_found rejection without OTP | 4 | SMS pump prevention |
| Pre-approved exception | 5, 14 | Both check-license and signup/start paths |
| Revocation grace-window predicate | 10 (6 cases) | Boundary conditions at 0, 1, 2, 3, 10 |
| Revocation audit trail | 11 | Per-doctor audit rows |
| Revocation sweep degradation | 12 | RPC failure does not abort sync |
| check-license consistent 409 | 13 | UI sees error at first interaction |
| Resend HTTP client | 20 (4 cases) | Including dev bypass and prod fail-closed |
| Email allowlist | 18 (13 cases) | Subdomain, homoglyph, exact, negative |
| isPreApproved helper | 21 | Match + no-match |
| RLS: doctor_visible anon deny | 23 | Live Supabase |
| RLS: pre_approved_licenses anon deny | 24 | Live Supabase |
| Post-migration approval reset | 25 | Live Supabase |
| Baseline non-regression | 22 | Protects all 75 existing tests |

### Areas explicitly excluded per agreed strategy

| Area | Reason | Risk |
|---|---|---|
| Real Resend email deliverability (SPF/DKIM, inbox placement) | No API call to live Resend in tests; stub captures payload | Low: covered by one-time manual send at deploy time (called out in PR notes) |
| Real Twilio assertion that no SMS is sent on `not_found` | Route returns before `signInWithOtp`; code path is provable by inspection + audit log | Low: the `signup_not_found_rejected` audit row in production confirms the path was taken |
| Playwright admin dashboard screenshot | No hosted environment available; deferred to manual smoke check in PR notes | Low: the DOM additions are server-rendered from a typed data shape; rendering correctness verified by lint + typecheck |
| Real-DB integration harness for RLS policies on non-anon sessions | Maintainer deferred test-DB decision to before merge | Medium: mitigated by the view definition test (Test 15) and the RLS smoke tests (Tests 23-25). A non-admin authenticated session bypassing `doctor_visible` cannot be proven without a real DB; PR notes call this out explicitly |
| Concurrent email-verify token replay under load | No concurrency test harness available | Low: Supabase transactional semantics handle this; the `UPDATE ... WHERE email_verified_at IS NULL` conditional update is the DB-level guard |

### Risk summary for excluded areas

The most meaningful residual risk is the non-admin authenticated RLS bypass scenario: a non-admin session could theoretically select from `doctors` directly (not via `doctor_visible`) and read unapproved rows if the RLS policy on `doctors` is misconfigured. This risk is mitigated by Task 5's RLS rewrite, the view's `security_invoker = true` declaration, and the fact that `app/api/search/route.ts` reads from the view via the SSR client. It is NOT fully closed without running an authenticated-non-admin probe against a real Supabase instance — which is a manual pre-merge smoke check in the PR notes.
