# Signup Security Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Close the "anyone can impersonate any MoH-listed doctor" hole and the four related defects (RLS dependency on app-layer filters, no license revocation sweep, `not_found` OTP fraud surface, `is_visible` decoupled from approval) in a single coherent cutover.

**Architecture:** Move the trust anchor from "exact MoH match auto-approves" to "human admin approves after reviewing email + MoH signals." Make Postgres RLS, not API code, the source of truth for which doctor rows are visible. Replace the `is_visible` boolean with a derived `doctor_visible` view that bakes the visibility contract into the schema, so a missed `.eq()` in a future route cannot leak unapproved profiles. Add a stateless HMAC-signed email token (no new tokens table), an idempotent Resend client, and a daily revocation sweep that uses a 3-cycle grace counter to tolerate MoH dataset hiccups.

**Tech Stack:** Next.js 16.2.5 App Router (Route Handlers, SSR Supabase cookie helper), Supabase Postgres + RLS, Zod 4, Resend HTTP API (no SDK), Upstash Redis sliding-window rate limit, Cloudflare Turnstile, Vitest 4 with `node` env.

---

## Pre-flight reading (do not skip)

The executor must skim these files before writing any code. They are short and they encode invariants this plan relies on:

- `app/api/signup/start/route.ts` — current signup flow, the Zod body, the `licenseStatusToColumn` helper, the `pending_signups.payload` shape.
- `app/api/signup/verify/route.ts` — the `isAutoApproved` site that this plan changes; the `PendingPayload` interface; the audit-log row written on signup.
- `app/api/signup/check-license/route.ts` — also calls `verifyLicense`; must reject `not_found` consistently with `signup/start` so the UI gives the same message early.
- `app/api/search/route.ts` — currently uses `createSupabaseServiceClient()`; this plan switches it to the SSR (RLS-enforced) client.
- `app/api/cron/sync-moh/route.ts` — extended with the revocation sweep; `MohClient.iterateAll(1000)` already streams the full snapshot.
- `app/(admin)/admin/page.tsx` and `AdminDoctorsTable.tsx` — extended to surface email verification + domain badges.
- `app/(public)/signup/SignupForm.tsx` — receives the new `not_found` error; verify-email message after submit.
- `lib/auth/session.ts` — `getCurrentDoctor()` is the SSR-friendly entry point; `requireAdmin()` is the admin gate.
- `lib/supabase/{server,service,browser}.ts` — three clients; this plan reserves the service client for writes and admin reads.
- `lib/moh/match.ts` — `verifyLicense()` returns one of four statuses; not modified here, but the `not_found` path is treated differently downstream.
- `lib/ratelimit.ts` — `RATE_LIMITS` map; we add `signupStartNotFound`.
- `lib/turnstile.ts` — bypassed in dev; production fail-closed.
- `supabase/migrations/0001_init.sql`, `0002_rls.sql`, `0004_workplaces.sql`, `0006_profile_features.sql` — schema and RLS that this plan extends.
- `scripts/rls-smoke-test.ts` — extended; same pattern (anon Supabase client probes).
- `vitest.config.ts` — `lib/**/*.test.ts` glob; node env; `@/` alias.
- `next.config.ts` — `headers()` adds the existing security headers; no change required here.
- `proxy.ts` — middleware; `/api/signup/email-verify` is under `/api/` which is already public, so no middleware change.
- `node_modules/next/dist/docs/` — Next.js 16 has breaking changes from training data; before writing any route handler, the executor must skim the App Router route handler doc and the cookies()/headers() async API doc (both are async in 16). All existing routes already use `await cookies()` / `await req.json()` / `Promise<{ params }>` shapes; follow the same conventions.

The executor must read existing files before editing. Do not re-read unchanged files between tasks.

---

## Strategy decisions baked into this plan (so reviewers do not relitigate)

| # | Decision | Why |
|---|---|---|
| 1 | **One cutover, not phased.** Phase 1 stopgap (`isAutoApproved=false`) is folded into the same migration set as Phase 2 (institutional email verification). | The user asked for #16 + #17 + #18 + #19 + #20 implemented together. A "ship Phase 1, then Phase 2 next week" rollout fragments the database state, requires throwaway code, and leaves an awkward window where the admin queue grows with no email signal to sort by. The clean steady-state is "admin always approves; admin always sees email + MoH signal." |
| 2 | **Resend over SDK or SMTP.** Direct `fetch` to `https://api.resend.com/emails` — no SDK, matches the rest of the repo (no Twilio SDK either; Supabase Auth dispatches OTP). | Smallest dependency footprint; Resend's HTTP API is one POST and is trivially mockable through a `RESEND_BASE_URL` env override (we add this for tests). Avoids pulling in `@react-email` or `react-email`; the email template is one short HTML/plaintext literal in `lib/email/templates/signup-verify.ts`. |
| 3 | **Stateless HMAC tokens, no new `email_tokens` table.** Token payload = `{pid: pending_signup_id, exp: <unix-ms>}`, base64url-encoded JSON, HMAC-SHA256 signed with `SIGNUP_TOKEN_SECRET`. | Persistence buys nothing here: the `pending_signups` row already has a TTL, the token's expiry must be at-or-before the pending TTL anyway, and replay is blocked by the fact that `email_verified_at` on the pending row goes from null to non-null on first use (the verify endpoint refuses to flip it twice). One-table, one-secret design. The same secret is also used to verify a doctor-row token after signup completes, for late-arriving email clicks (see Task 5). |
| 4 | **Email allowlist as TypeScript constant**, not a DB table. | The list is short (5 seeds plus a TODO marker for the maintainer), changes through PRs, and applies to write-time logic that runs before there is any session. Putting it in code means the allowlist diff is reviewable in git and tests can import it directly. The user explicitly approved the seed list and asked for a TODO. |
| 5 | **`is_visible` rename + view (#20 option 1)**, not approval-time-flip. | Pairs cleanly with #17 (RLS as source of truth). The rename forces every existing reference to be updated, which surfaces every read site that previously trusted the boolean — a one-time grep produces a complete migration list. The view is read-only by construction; the underlying column toggle is a no-op for visibility unless approval has also happened. |
| 6 | **Revocation sweep stores its grace counter on `doctors`**, not in a side table. | A `missing_sync_count int not null default 0` and `last_seen_in_moh_at timestamptz` column pair is enough. Sweep increments-or-resets in one `UPDATE` per cron run. The threshold (3) is a constant in the cron route. Avoids cross-table joins on the hot path of the sweep. |
| 7 | **`pre_approved_licenses` exception table** (admin-managed) for legitimate `not_found` signups. | The CKAN live fallback already handles "freshly issued" — the residual `not_found` case is genuinely rare (license-number changes, edge cases). Admins insert one row when they want to whitelist a specific license number. Simpler than a "pre-approval token" or "exception code" pattern. |
| 8 | **All new env vars listed in the PR body, not committed to `.env.example`**, because `.env.example` does not exist (issue #13). | Maintainer asked for this explicitly. The plan includes a "PR body checklist" task (Task 18) that emits the exact list of env vars and Supabase configuration steps the maintainer must apply before merge. |
| 9 | **Existing approved doctors are flipped to `is_admin_approved=false` in the migration**, per maintainer decision. They will all need re-review. | Maintainer explicitly requested this. Encoded as `UPDATE doctors SET is_admin_approved=false WHERE is_admin=false` in the migration; admin users are spared so they can perform the re-review. |
| 10 | **Tests cover real user-visible behavior via vitest unit tests + an extended `scripts/rls-smoke-test.ts`**, not a real DB integration harness or Playwright. | The earlier testing-strategy proposal recommended a real-DB integration harness. Maintainer pushed that to a separate decision before merge ("not yet, will provide at the end"). For this plan we ship vitest coverage of every pure helper (token issuer/verifier, allowlist matcher, grace-window predicate, `not_found` rejection) and we extend the existing RLS smoke test to prove the new invariants against the live Supabase project the maintainer already uses for `npm run test:rls`. The PR body lists the manual smoke checks the maintainer must run before merge (signup flow end-to-end, admin approval flow). |
| 11 | **Sentry PII scrub does not need changes**: the existing `PII_KEYS` set in `sentry.server.config.ts` already includes `email`, `phone`, `license_number`, `token`. The new `email_token` query param falls under `token` already. Do not regress this. | Verified by inspection. Issue #27 tracks it separately; not in scope here. |
| 12 | **No middleware (`proxy.ts`) change.** `/api/signup/email-verify` is reached via a public link in the verification email; `/api/signup/*` is already public. | The middleware's `PUBLIC_PREFIXES` already covers `/api/`. |

---

## End-state architecture

The final flow on green:

```
Signup form submit
  └─> POST /api/signup/start
        ├─ Turnstile verified
        ├─ Zod validates body (email is required, plain email, no domain check yet)
        ├─ phone normalised
        ├─ uniqueness re-checked
        ├─ verifyLicense(): if status === "not_found":
        │     ├─ if license is in pre_approved_licenses → continue
        │     └─ else: 409 license_not_in_registry, audit-log {ip,reason}, no OTP, no pending row
        ├─ verifyLicense(): if status === "name_mismatch" && !override → 409 (existing)
        ├─ pending_signups insert with email_domain + email_is_institutional pre-computed
        ├─ Supabase signInWithOtp(sms) → OTP sent
        └─ returns { signup_session_id, license_status, email_is_institutional }

POST /api/signup/verify
  ├─ Validates OTP via Supabase Auth
  ├─ Inserts doctors row with is_admin_approved=false, user_chose_visible=true (via column rename),
  │   email_verified_at=null, email_domain, email_is_institutional, license_verification_status
  ├─ links specialties + workplaces (existing)
  ├─ writes audit_log signup_verified {auto_approved:false, email_is_institutional}
  ├─ kicks off email-start in background (best-effort, non-fatal)
  └─ returns { ok:true, auto_approved:false, email_verification_sent:bool }

POST /api/signup/email-start (also called from /verify above; idempotent)
  ├─ Either body has signup_session_id (called during signup before auth)
  │   OR caller has a session and we resolve target via getCurrentDoctor()
  ├─ Generates HMAC-signed token bound to (pending_signup_id|doctor_id, expiry)
  ├─ Calls Resend with idempotency-key = sha256(target_id + email)
  ├─ Records email_verification_sent_at on the pending row or doctor row
  └─ returns { ok:true, sent_to_masked: "h***@hadassah.org.il" }

GET /api/signup/email-verify?token=...
  ├─ Verifies HMAC, expiry
  ├─ Resolves target (pending row or doctor row)
  ├─ Sets email_verified_at = now() if null; idempotent (returns 200 either way)
  ├─ If target is a pending row, just updates payload field; doctor row created later
  ├─ If target is a doctor row, writes audit_log email_verified
  └─ Returns a small HTML page (single template literal) confirming success

GET /api/search (now SSR-client)
  └─ Reads from doctor_visible view; RLS denies any unapproved row by construction.

GET /api/cron/sync-moh (extended)
  ├─ Existing pagination + upsert into moh_practitioners (unchanged)
  ├─ NEW revocation sweep:
  │     UPDATE doctors SET missing_sync_count = missing_sync_count + 1,
  │                        last_seen_in_moh_at = last_seen_in_moh_at  -- unchanged
  │       WHERE is_admin_approved
  │         AND license_verification_status <> 'revoked'
  │         AND NOT EXISTS (SELECT 1 FROM moh_practitioners mp WHERE mp.license_number::text = doctors.license_number)
  │     -- second pass: reset for those that did appear
  │     UPDATE doctors SET missing_sync_count = 0, last_seen_in_moh_at = now()
  │       WHERE EXISTS (SELECT 1 FROM moh_practitioners mp WHERE mp.license_number::text = doctors.license_number)
  │     -- third pass: revoke at threshold
  │     UPDATE doctors SET is_active = false,
  │                        license_verification_status = 'revoked',
  │                        is_admin_approved = false
  │       WHERE missing_sync_count >= 3 AND license_verification_status <> 'revoked'
  │       RETURNING id
  │     -- per revoked id: insert audit_log row
  └─ existing audit_log row records sync stats including {revoked_count}

Admin /admin
  └─ table now shows: email_status badge, domain badge (institutional / non-institutional / none)
```

---

## Task list (TDD; one action per step)

The executor performs these in order. After each task: lint passes, vitest passes, hand-edited migrations apply cleanly to a fresh DB.

### Task 0: Worktree pre-checks

**Files:** none

**Step 0.1: Confirm branch + clean tree**

Run:
```bash
git -C /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul branch --show-current
git -C /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul status --short
```

Expected: branch `signup-security-overhaul`, status empty (or only `?? docs/plans/...`).

**Step 0.2: Confirm node + npm install state**

Run:
```bash
cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && node --version && ls node_modules/.bin/vitest >/dev/null && echo OK
```

Expected: node v22+ (Next.js 16 minimum), `OK`. `npm install` was already run.

**Step 0.3: Confirm baseline tests pass**

Run:
```bash
cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && npm test
```

Expected: existing test suite green. Capture the pass count to verify nothing regresses.

---

### Task 1: Email allowlist module (pure logic, ships first to unblock everything else)

**Files:**
- Create: `lib/signup/email-allowlist.ts`
- Test: `lib/signup/email-allowlist.test.ts`

**Step 1.1: Write the failing test**

`lib/signup/email-allowlist.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { JERUSALEM_INSTITUTION_DOMAINS, isInstitutionalEmail, extractDomain } from "./email-allowlist";

describe("extractDomain", () => {
  it("returns lowercased domain", () => {
    expect(extractDomain("Foo@HADASSAH.org.il")).toBe("hadassah.org.il");
  });

  it("returns null for malformed input", () => {
    expect(extractDomain("not-an-email")).toBeNull();
    expect(extractDomain("")).toBeNull();
    expect(extractDomain("a@")).toBeNull();
    expect(extractDomain("@b.com")).toBeNull();
  });
});

describe("isInstitutionalEmail", () => {
  it("matches an exact allowlisted domain", () => {
    expect(isInstitutionalEmail("dr@hadassah.org.il")).toBe(true);
  });

  it("matches a subdomain of an allowlisted domain", () => {
    // Justification: hospital sub-units (nursing.hadassah.org.il) are still
    // implicitly attested by the parent institution's mail infrastructure.
    expect(isInstitutionalEmail("dr@nursing.hadassah.org.il")).toBe(true);
  });

  it("does not match a homoglyph", () => {
    // Cyrillic 'а' (U+0430) instead of Latin 'a'.
    expect(isInstitutionalEmail("dr@hаdassah.org.il")).toBe(false);
  });

  it("does not match a similarly-named non-institutional domain", () => {
    expect(isInstitutionalEmail("dr@hadassah-fan.com")).toBe(false);
    expect(isInstitutionalEmail("dr@my-hadassah.org.il")).toBe(false);
  });

  it("returns false for gmail-style providers", () => {
    expect(isInstitutionalEmail("dr@gmail.com")).toBe(false);
    expect(isInstitutionalEmail("dr@walla.co.il")).toBe(false);
  });

  it("returns false for empty / malformed input", () => {
    expect(isInstitutionalEmail("")).toBe(false);
    expect(isInstitutionalEmail("garbage")).toBe(false);
  });

  it("exposes the seed list", () => {
    expect(JERUSALEM_INSTITUTION_DOMAINS).toContain("hadassah.org.il");
    expect(JERUSALEM_INSTITUTION_DOMAINS).toContain("szmc.org.il");
  });
});
```

**Step 1.2: Run the test to verify it fails**

Run: `cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && npm test -- email-allowlist`

Expected: fail with "Cannot find module './email-allowlist'".

**Step 1.3: Implement the allowlist**

`lib/signup/email-allowlist.ts`:
```ts
// Allowlist of Jerusalem medical-institution email domains. Membership
// implies the institution implicitly attests to the doctor's identity by
// running their mail server. Subdomain matches are accepted (e.g.
// `nursing.hadassah.org.il` counts as `hadassah.org.il`) because hospital
// sub-units share the institutional mail boundary.
//
// TODO(maintainer): Confirm this seed list with the Jerusalem-doctors
// pilot cohort before launch. Add Augusta Victoria, St Joseph, and any
// other Jerusalem-area medical institutions whose doctors are expected
// to participate. Each entry must be a domain you trust to gate
// institutional identity.

export const JERUSALEM_INSTITUTION_DOMAINS: readonly string[] = [
  "hadassah.org.il",
  "al-maqassed.org",
  "augustavictoria.org",
  "stjoseph-jerusalem.com",
  "szmc.org.il",
] as const;

const NORMALIZED = new Set(
  JERUSALEM_INSTITUTION_DOMAINS.map((d) => d.toLowerCase()),
);

/**
 * Returns the lowercased domain part of an email, or null if the input is
 * not a syntactically plausible email. We do not validate beyond
 * "@ present, both sides non-empty" — Zod handles full RFC validation
 * upstream.
 */
export function extractDomain(email: string): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  return domain;
}

/**
 * True when the email belongs to an allowlisted Jerusalem medical
 * institution (or a subdomain thereof). Subdomain matching is by literal
 * suffix (`.${parent}`); we do not strip TLD eTLDs because that opens a
 * homoglyph and shared-second-level-domain hole.
 */
export function isInstitutionalEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  if (NORMALIZED.has(domain)) return true;
  for (const parent of NORMALIZED) {
    if (domain.endsWith(`.${parent}`)) return true;
  }
  return false;
}
```

**Step 1.4: Run the test to verify it passes**

Run: `cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && npm test -- email-allowlist`

Expected: all tests pass.

**Step 1.5: Commit**

```bash
git -C /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul add lib/signup/email-allowlist.ts lib/signup/email-allowlist.test.ts
git -C /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul commit -m "feat: add Jerusalem institutional email allowlist module"
```

---

### Task 2: HMAC-signed email-verification token

**Files:**
- Create: `lib/signup/email-token.ts`
- Test: `lib/signup/email-token.test.ts`

**Step 2.1: Write the failing test**

`lib/signup/email-token.test.ts`:
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { issueEmailToken, verifyEmailToken } from "./email-token";

const SECRET = "test-secret-not-real";

describe("email token", () => {
  beforeEach(() => {
    process.env.SIGNUP_TOKEN_SECRET = SECRET;
  });

  it("round-trips a pending-signup token", () => {
    const token = issueEmailToken({
      target: "pending",
      id: "00000000-0000-0000-0000-000000000001",
      ttlMs: 60_000,
    });
    const r = verifyEmailToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe("pending");
      expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    }
  });

  it("round-trips a doctor token", () => {
    const token = issueEmailToken({
      target: "doctor",
      id: "00000000-0000-0000-0000-000000000002",
      ttlMs: 60_000,
    });
    const r = verifyEmailToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.target).toBe("doctor");
  });

  it("rejects a tampered payload", () => {
    const token = issueEmailToken({
      target: "pending",
      id: "00000000-0000-0000-0000-000000000001",
      ttlMs: 60_000,
    });
    // Flip a byte in the payload portion.
    const [payload, sig] = token.split(".");
    const bad = `${payload}AA.${sig}`;
    const r = verifyEmailToken(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });

  it("rejects a tampered signature", () => {
    const token = issueEmailToken({
      target: "pending",
      id: "00000000-0000-0000-0000-000000000001",
      ttlMs: 60_000,
    });
    const [payload, sig] = token.split(".");
    const flipped = sig.replace(/.$/, sig.slice(-1) === "A" ? "B" : "A");
    const r = verifyEmailToken(`${payload}.${flipped}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });

  it("rejects an expired token", () => {
    const token = issueEmailToken({
      target: "pending",
      id: "00000000-0000-0000-0000-000000000001",
      ttlMs: -1,
    });
    const r = verifyEmailToken(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a malformed token", () => {
    expect(verifyEmailToken("garbage")).toMatchObject({
      ok: false,
      reason: "malformed",
    });
    expect(verifyEmailToken("")).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  it("throws on issue when the secret is missing in production", () => {
    delete process.env.SIGNUP_TOKEN_SECRET;
    process.env.NODE_ENV = "production";
    expect(() =>
      issueEmailToken({
        target: "pending",
        id: "00000000-0000-0000-0000-000000000001",
        ttlMs: 60_000,
      }),
    ).toThrow(/SIGNUP_TOKEN_SECRET/);
    process.env.NODE_ENV = "test";
  });
});
```

**Step 2.2: Run the test to verify it fails**

Run: `npm test -- email-token`. Expected: missing module.

**Step 2.3: Implement the token helper**

`lib/signup/email-token.ts`:
```ts
// Stateless email-verification token. Carries (target_kind, target_id, exp)
// in a base64url JSON payload and an HMAC-SHA256 signature over the payload.
//
// Format: `${base64url(payload_json)}.${base64url(hmac_sha256(payload_json, secret))}`
//
// We do not persist tokens. Replay is blocked by the verify endpoint, which
// only flips `email_verified_at` from null; a second click is a no-op.
//
// `ttlMs` upper-bound = pending_signups TTL (15min). For doctor-row tokens
// (post-signup), the upper bound is 24h — long enough for an email that
// landed in spam to still work.

import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenTarget = "pending" | "doctor";

export interface IssueOptions {
  target: TokenTarget;
  id: string;
  ttlMs: number;
}

export interface TokenPayload {
  target: TokenTarget;
  id: string;
  exp: number; // unix ms
}

export type VerifyResult =
  | { ok: true; target: TokenTarget; id: string }
  | { ok: false; reason: "malformed" | "invalid_signature" | "expired" };

function getSecret(): string {
  const s = process.env.SIGNUP_TOKEN_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SIGNUP_TOKEN_SECRET is required in production");
    }
    // Dev convenience — tokens still validate locally without the env set,
    // but they cannot cross between dev and prod.
    return "dev-only-do-not-use-in-prod";
  }
  return s;
}

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  // Pad to multiple of 4.
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

function sign(payloadB64url: string): string {
  const mac = createHmac("sha256", getSecret()).update(payloadB64url).digest();
  return b64urlEncode(mac);
}

export function issueEmailToken(opts: IssueOptions): string {
  const payload: TokenPayload = {
    target: opts.target,
    id: opts.id,
    exp: Date.now() + opts.ttlMs,
  };
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(Buffer.from(json, "utf8"));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyEmailToken(token: string): VerifyResult {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sig] = token.split(".", 2);
  if (!payloadB64 || !sig) return { ok: false, reason: "malformed" };

  const expected = sign(payloadB64);
  let aBuf: Buffer;
  let bBuf: Buffer;
  try {
    aBuf = b64urlDecode(sig);
    bBuf = b64urlDecode(expected);
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !payload ||
    (payload.target !== "pending" && payload.target !== "doctor") ||
    typeof payload.id !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, target: payload.target, id: payload.id };
}
```

**Step 2.4: Run the test to verify it passes**

Run: `npm test -- email-token`. Expected: all pass.

**Step 2.5: Commit**

```bash
git add lib/signup/email-token.ts lib/signup/email-token.test.ts
git commit -m "feat: add stateless HMAC-signed email verification token"
```

---

### Task 3: Resend HTTP client

**Files:**
- Create: `lib/email/resend.ts`
- Test: `lib/email/resend.test.ts`
- Create: `lib/email/templates/signup-verify.ts`

**Step 3.1: Write the failing test**

`lib/email/resend.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResendClient, ResendError } from "./resend";

const ORIGINAL_FETCH = globalThis.fetch;

describe("ResendClient", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "Jerusalem Doctors <noreply@example.com>";
    process.env.RESEND_BASE_URL = "https://example.test";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("posts the rendered email and returns the message id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ResendClient();
    const result = await client.send({
      to: "dr@hadassah.org.il",
      subject: "Verify",
      html: "<p>hi</p>",
      text: "hi",
      idempotencyKey: "abc",
    });

    expect(result.id).toBe("msg_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/emails");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("abc");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      to: ["dr@hadassah.org.il"],
      from: "Jerusalem Doctors <noreply@example.com>",
      subject: "Verify",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("throws ResendError on non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "bad" }), { status: 422 })) as unknown as typeof fetch;
    const client = new ResendClient();
    await expect(
      client.send({ to: "x@y.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toBeInstanceOf(ResendError);
  });

  it("dev-bypasses with no API key (logs to console, returns synthetic id)", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "test";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ResendClient();
    const r = await client.send({ to: "x@y.com", subject: "s", html: "h", text: "t" });
    expect(r.id).toMatch(/^dev-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws if RESEND_API_KEY missing in production", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    const client = new ResendClient();
    await expect(
      client.send({ to: "x@y.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    process.env.NODE_ENV = "test";
  });
});
```

**Step 3.2: Run the test to verify it fails**

Run: `npm test -- resend`. Expected: missing module.

**Step 3.3: Implement the Resend client**

`lib/email/resend.ts`:
```ts
// Minimal Resend client. One call: POST /emails. Tokens, batching, replies,
// and attachments are out of scope.
//
// Dev convenience: when RESEND_API_KEY is unset and NODE_ENV !== production,
// the client logs the email to stdout and returns a synthetic message id.
// Production fail-closed: throws if key is missing.

const DEFAULT_BASE_URL = "https://api.resend.com";

export class ResendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional Resend Idempotency-Key. We pass it through verbatim. */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  id: string;
}

export class ResendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env.RESEND_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM ?? "Jerusalem Doctors <noreply@example.com>";

    if (!apiKey) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("RESEND_API_KEY is required in production");
      }
      console.log("[email:dev]", {
        to: input.to,
        subject: input.subject,
        textPreview: input.text.slice(0, 200),
      });
      return { id: `dev-${Date.now()}` };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    const res = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      throw new ResendError(
        `Resend returned HTTP ${res.status}`,
        res.status,
        body,
      );
    }
    const id =
      body && typeof body === "object" && "id" in body
        ? String((body as { id: unknown }).id)
        : "";
    if (!id) {
      throw new ResendError(
        "Resend did not return a message id",
        res.status,
        body,
      );
    }
    return { id };
  }
}
```

**Step 3.4: Email template**

`lib/email/templates/signup-verify.ts`:
```ts
// Email template for the signup verification link.
//
// Single template literal — no template engine. Arabic copy + LTR link.
// The plaintext fallback exists so spam filters and CLI mail readers can
// still use the link.

interface TemplateInput {
  arabicFirstName: string;
  verifyUrl: string;
  expiryMinutes: number;
}

export function renderSignupVerifyEmail(input: TemplateInput): {
  subject: string;
  html: string;
  text: string;
} {
  const safeName = escapeHtml(input.arabicFirstName);
  const safeUrl = escapeHtml(input.verifyUrl);
  const subject = "تأكيد البريد الإلكتروني — دليل أطباء القدس";

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
  <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px;">مرحبًا د. ${safeName}،</h1>
    <p>شكرًا على التسجيل في دليل أطبّاء القدس.</p>
    <p>للتحقق من بريدك الإلكتروني، اضغط الزر التالي:</p>
    <p style="text-align: center; margin: 32px 0;">
      <a href="${safeUrl}" dir="ltr" style="display: inline-block; padding: 12px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 6px;">تأكيد البريد</a>
    </p>
    <p style="color: #555; font-size: 14px;">صالح لمدة ${input.expiryMinutes} دقيقة. إذا لم تطلب التسجيل، تجاهل هذه الرسالة.</p>
    <p style="color: #888; font-size: 12px; word-break: break-all;" dir="ltr">${safeUrl}</p>
  </body>
</html>`;

  const text = [
    `مرحبًا د. ${input.arabicFirstName}،`,
    "",
    "شكرًا على التسجيل في دليل أطبّاء القدس.",
    "",
    "للتحقق من بريدك الإلكتروني، افتح الرابط التالي:",
    input.verifyUrl,
    "",
    `صالح لمدة ${input.expiryMinutes} دقيقة.`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

**Step 3.5: Run all tests; lint**

Run:
```bash
cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && npm test && npm run lint
```

Expected: all green.

**Step 3.6: Commit**

```bash
git add lib/email/resend.ts lib/email/resend.test.ts lib/email/templates/signup-verify.ts
git commit -m "feat: add Resend HTTP client and signup verification email template"
```

---

### Task 4: Pre-approved licenses table + helper

**Files:**
- Create: `supabase/migrations/0007_pre_approved_licenses.sql`
- Create: `lib/signup/pre-approved.ts`
- Test: `lib/signup/pre-approved.test.ts`

**Step 4.1: Write the migration**

`supabase/migrations/0007_pre_approved_licenses.sql`:
```sql
-- 0007_pre_approved_licenses.sql — admin allowlist for legitimate signups
-- whose license is not in moh_practitioners (e.g. freshly issued or
-- license-number changed). Apply after 0006.
--
-- Read by app/api/signup/start/route.ts and /check-license/route.ts when
-- license verification returns "not_found". Without a row here, those
-- routes 409 the signup; with a row, they let it proceed (the doctor
-- still goes through admin review per #16).

create table public.pre_approved_licenses (
  license_number   text primary key,
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
```

**Step 4.2: Write the failing helper test**

`lib/signup/pre-approved.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPreApproved } from "./pre-approved";

function fakeClient(matched: boolean) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: matched ? { license_number: "1" } : null,
            error: null,
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe("isPreApproved", () => {
  it("returns true when a row exists", async () => {
    expect(await isPreApproved(fakeClient(true), "12345")).toBe(true);
  });

  it("returns false when no row exists", async () => {
    expect(await isPreApproved(fakeClient(false), "12345")).toBe(false);
  });
});
```

**Step 4.3: Run test → fails (missing module)**

Run: `npm test -- pre-approved`.

**Step 4.4: Implement helper**

`lib/signup/pre-approved.ts`:
```ts
// Admin-managed allowlist for `not_found` license signups. See
// supabase/migrations/0007_pre_approved_licenses.sql.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function isPreApproved(
  service: SupabaseClient,
  licenseNumber: string,
): Promise<boolean> {
  const { data, error } = await service
    .from("pre_approved_licenses")
    .select("license_number")
    .eq("license_number", licenseNumber)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return Boolean(data);
}
```

**Step 4.5: Run test → passes**

Run: `npm test -- pre-approved`.

**Step 4.6: Commit**

```bash
git add supabase/migrations/0007_pre_approved_licenses.sql lib/signup/pre-approved.ts lib/signup/pre-approved.test.ts
git commit -m "feat: add pre_approved_licenses table and helper for not_found exceptions"
```

---

### Task 5: Schema migration — visibility view, email columns, revocation columns, status enum extension, existing-doctor reset

**Files:**
- Create: `supabase/migrations/0008_signup_security_overhaul.sql`
- Modify: `lib/db/types.ts`

**Step 5.1: Write the migration**

`supabase/migrations/0008_signup_security_overhaul.sql`:
```sql
-- 0008_signup_security_overhaul.sql — combined schema change for
-- GitHub issues #16, #17, #18, #20.
--
-- Rationale: these changes are coupled and the cutover must be atomic.
-- Splitting them across migrations creates a window where the view exists
-- but admin code still reads the column, or where the column has been
-- renamed but RLS still references the old name.
--
-- Apply once on a fresh DB or as the next migration on an existing DB.
-- Idempotent guards on the lossless steps; the column rename is
-- non-idempotent by design (Postgres DDL).

-- =========================================================================
-- 1) Email verification columns on `doctors` (#16)
-- =========================================================================

alter table public.doctors
  add column if not exists email_verified_at        timestamptz,
  add column if not exists email_domain             text,
  add column if not exists email_is_institutional   boolean not null default false,
  add column if not exists email_verification_sent_at timestamptz;

-- Backfill email_domain + email_is_institutional for existing rows so the
-- admin queue is meaningful immediately after migration. Uses the same
-- rule as the application allowlist: exact match or `.<parent>` suffix.
-- The allowlist is duplicated here only for the backfill; the application
-- code remains the source of truth going forward.
do $$
declare
  inst_domains text[] := array[
    'hadassah.org.il',
    'al-maqassed.org',
    'augustavictoria.org',
    'stjoseph-jerusalem.com',
    'szmc.org.il'
  ];
  d text;
begin
  update public.doctors
  set email_domain = lower(split_part(email, '@', 2))
  where email is not null
    and position('@' in email) > 0
    and email_domain is null;

  foreach d in array inst_domains loop
    update public.doctors
    set email_is_institutional = true
    where email_domain is not null
      and (email_domain = d or email_domain like '%.' || d)
      and email_is_institutional = false;
  end loop;
end $$;

-- =========================================================================
-- 2) Revocation sweep columns (#18)
-- =========================================================================

alter table public.doctors
  add column if not exists missing_sync_count   int not null default 0,
  add column if not exists last_seen_in_moh_at  timestamptz;

-- Extend license_verification_status check constraint to allow 'revoked'.
alter table public.doctors
  drop constraint if exists doctors_license_verification_status_check;

alter table public.doctors
  add constraint doctors_license_verification_status_check
    check (license_verification_status in (
      'verified', 'soft_match', 'not_found',
      'name_mismatch_overridden', 'revoked'
    ));

-- =========================================================================
-- 3) Visibility decoupling (#20): rename + view
-- =========================================================================

-- Rename the column so any forgotten reference fails to compile / runtime
-- error rather than silently leaking. The application code is updated in
-- the same PR.
alter table public.doctors
  rename column is_visible to user_chose_visible;

-- Update the existing visibility index to cover the renamed column.
drop index if exists doctors_visibility;
create index doctors_visibility
  on public.doctors (
    is_active, user_chose_visible, is_phone_verified,
    is_admin_approved, consent_directory_use
  );

-- Re-create the visibility-bound RLS policies on `doctors` to reference
-- the new column name. Drop+create is the only safe path; ALTER POLICY
-- cannot rewrite the USING expression.
drop policy if exists "verified doctors readable by authenticated" on public.doctors;
create policy "verified doctors readable by authenticated"
  on public.doctors
  for select
  to authenticated
  using (
    is_active
    and user_chose_visible
    and is_phone_verified
    and is_admin_approved
    and consent_directory_use
  );

-- Same for the joined tables. Their EXISTS predicates must reference the
-- new column or they silently keep returning rows for unapproved doctors.
drop policy if exists "doctor_specialties readable for visible doctors" on public.doctor_specialties;
create policy "doctor_specialties readable for visible doctors"
  on public.doctor_specialties
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.doctors d
      where d.id = doctor_specialties.doctor_id
        and (
          d.auth_user_id = auth.uid()
          or public.is_admin()
          or (
            d.is_active
            and d.user_chose_visible
            and d.is_phone_verified
            and d.is_admin_approved
            and d.consent_directory_use
          )
        )
    )
  );

drop policy if exists "doctor_workplaces readable for visible doctors" on public.doctor_workplaces;
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
            and d.user_chose_visible
            and d.is_phone_verified
            and d.is_admin_approved
            and d.consent_directory_use
          )
        )
    )
  );

-- The directory-facing view. Read-only by construction. Routes that list
-- doctors for the search UI must read from this view, not the base table.
-- Selecting from the view runs as the caller, so RLS on `doctors` still
-- applies as defence in depth.
create or replace view public.doctor_visible
  with (security_invoker = true)
  as
    select *
    from public.doctors
    where is_active
      and user_chose_visible
      and is_phone_verified
      and is_admin_approved
      and consent_directory_use;

comment on view public.doctor_visible is
  'Directory-visible doctors. Reads are gated by RLS on the underlying table; this view also enforces visibility at the relation level so a forgotten WHERE clause cannot leak unapproved profiles.';

-- =========================================================================
-- 4) One-time approval reset (#16, maintainer decision)
-- =========================================================================

-- Per the maintainer's explicit decision: every existing approved doctor
-- (other than admins, who must remain logged-in to perform the re-review)
-- is unapproved by this migration so the new institutional-email +
-- human-review pipeline can re-evaluate them. Admins are spared.
update public.doctors
   set is_admin_approved = false
 where is_admin = false
   and is_admin_approved = true;
```

**Step 5.2: Update the TS shadow type**

Modify `lib/db/types.ts`:

Replace the existing `Doctor` interface with the same shape but with these changes:
- `is_visible: boolean;` → `user_chose_visible: boolean;`
- Add: `email_verified_at: string | null;`
- Add: `email_domain: string | null;`
- Add: `email_is_institutional: boolean;`
- Add: `email_verification_sent_at: string | null;`
- Add: `missing_sync_count: number;`
- Add: `last_seen_in_moh_at: string | null;`
- Extend `license_verification_status` union to include `"revoked"`.

Add a new interface:
```ts
export interface PreApprovedLicense {
  license_number: string;
  reason: string;
  added_by: string | null;
  added_at: string;
}
```

(The full final shape:)
```ts
export interface Doctor {
  id: string;
  auth_user_id: string | null;
  phone_e164: string;
  phone_display: string | null;
  arabic_first_name: string;
  arabic_family_name: string;
  arabic_full_name: string;
  arabic_first_name_normalized: string;
  arabic_family_name_normalized: string;
  arabic_full_name_normalized: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  hebrew_full_name: string;
  license_number: string;
  license_verified_at: string | null;
  license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | "revoked"
    | null;
  subspecialty: string | null;
  subspecialty_normalized: string | null;
  email: string | null;
  email_verified_at: string | null;
  email_domain: string | null;
  email_is_institutional: boolean;
  email_verification_sent_at: string | null;
  missing_sync_count: number;
  last_seen_in_moh_at: string | null;
  consent_directory_use: boolean;
  consent_timestamp: string;
  is_phone_verified: boolean;
  is_active: boolean;
  user_chose_visible: boolean;
  is_admin_approved: boolean;
  is_admin: boolean;
  phone_is_visible: boolean;
  workplaces_is_visible: boolean;
  profile_picture_url: string | null;
  created_at: string;
  updated_at: string;
}
```

**Step 5.3: Commit**

```bash
git add supabase/migrations/0008_signup_security_overhaul.sql lib/db/types.ts
git commit -m "feat(db): rename is_visible→user_chose_visible, add email + revocation columns, doctor_visible view, reset approvals"
```

---

### Task 6: Update every code reference to `is_visible` (rename impact)

Scope discovered by `rg "\bis_visible\b" --type ts --type tsx --type sql`. Required edits, file by file:

**Files:**
- Modify: `app/api/signup/verify/route.ts` — see Task 7 for full edit.
- Modify: `app/api/profile/delete-request/route.ts` — change `is_visible: false` to `user_chose_visible: false`.
- Modify: `app/api/admin/doctors/[id]/route.ts` — Zod field `is_visible` → `user_chose_visible`.
- Modify: `app/(admin)/admin/page.tsx` — select column `is_visible` → `user_chose_visible`.
- Modify: `app/(admin)/admin/AdminDoctorsTable.tsx` — interface `is_visible` → `user_chose_visible`.
- Modify: `app/api/search/route.ts` — see Task 8 for full route rewrite.
- Modify: `scripts/seed-dev-doctor.sql`, `scripts/seed-test-doctors.sql`, `scripts/seed-more-test-doctors.sql` — replace every `is_visible,` with `user_chose_visible,`.

**Step 6.1: Run the rename**

For each file above, edit the `is_visible` references to `user_chose_visible`. After the global edit:

```bash
cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && rg "\bis_visible\b" --type ts --type tsx --type sql
```

Expected: zero matches outside of git history. (The Supabase migrations under `0001-0006` are historical and must remain unchanged. Only the *current* application code and seed scripts are renamed.)

**Step 6.2: Run lint + tests**

```bash
npm run lint && npm test
```

Expected: green.

**Step 6.3: Commit**

```bash
git add -A
git commit -m "refactor: rename is_visible to user_chose_visible across app and seed scripts"
```

---

### Task 7: Replace `signup/verify` with the no-auto-approve flow that fires the verification email

**Files:**
- Modify: `app/api/signup/verify/route.ts`

**Step 7.1: Replace the file**

The new file. Key changes versus current:
- `isAutoApproved` constant removed; insert always uses `is_admin_approved: false`.
- Inserted row carries email-verification columns (pre-computed in `signup/start`, carried in payload).
- After successful insert, fire a best-effort call to `dispatchSignupVerifyEmail(doctorId, email, arabicFirstName)`. Failure is logged + Sentry-reported, never returned as a 5xx — the doctor row is created.
- Audit log entry now records `auto_approved: false` and `email_is_institutional`.
- Response includes `email_verification_sent: boolean`.

```ts
// POST /api/signup/verify
// Validates the OTP via Supabase Auth, then materialises the doctor row from
// the pending_signups payload, links specialties + workplaces, dispatches a
// verification email, and lets the SSR cookie helper persist the session.
//
// As of issue #16, no signup is auto-approved. Every new doctor row has
// is_admin_approved=false. Visibility in the directory requires:
//   1. admin approval (sets is_admin_approved=true), and
//   2. user_chose_visible=true (default), and
//   3. all the existing gates (is_active, is_phone_verified, consent).
//
// The directory view `doctor_visible` enforces the conjunction at the
// relation level; RLS enforces it at the row level.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { dispatchSignupVerifyEmail } from "@/lib/signup/email-dispatch";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const MAX_ATTEMPTS = 5;

const Body = z.object({
  signup_session_id: z.uuid(),
  otp_code: z.string().regex(/^\d{4,8}$/),
});

interface PendingWorkplace {
  name: string;
  name_normalized: string;
  is_primary: boolean;
  sort_order: number;
}

interface PendingPayload {
  phone_e164: string;
  phone_display: string;
  license_number: string;
  arabic_first_name: string;
  arabic_family_name: string;
  arabic_first_name_normalized: string;
  arabic_family_name_normalized: string;
  arabic_full_name_normalized: string;
  hebrew_first_name: string;
  hebrew_family_name: string;
  subspecialty: string | null;
  subspecialty_normalized: string | null;
  email: string;                 // required as of #16
  email_domain: string;          // required as of #16
  email_is_institutional: boolean;
  specialty_ids: string[];
  workplaces: PendingWorkplace[];
  license_verification_status:
    | "verified"
    | "soft_match"
    | "not_found"
    | "name_mismatch_overridden"
    | null;
}

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const rl = await rateLimit("signupVerify", `session:${parsed.signup_session_id}`);
  const rlIp = await rateLimit("signupVerify", `ip:${ip}`);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const service = createSupabaseServiceClient();
  const ssr = await createSupabaseServerClient();

  const pending = await service
    .from("pending_signups")
    .select("id, phone_e164, payload, expires_at, attempts")
    .eq("id", parsed.signup_session_id)
    .maybeSingle();
  if (pending.error && pending.error.code !== "PGRST116") throw pending.error;
  if (!pending.data) {
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }
  if (new Date(pending.data.expires_at).getTime() < Date.now()) {
    await service.from("pending_signups").delete().eq("id", pending.data.id);
    return jsonError(410, { error: "session_expired", code: "session_expired" });
  }
  if (pending.data.attempts >= MAX_ATTEMPTS) {
    await service.from("pending_signups").delete().eq("id", pending.data.id);
    return jsonError(429, { error: "too_many_attempts", code: "too_many_attempts" });
  }

  await service
    .from("pending_signups")
    .update({ attempts: pending.data.attempts + 1 })
    .eq("id", pending.data.id);

  const verify = await ssr.auth.verifyOtp({
    phone: pending.data.phone_e164,
    token: parsed.otp_code,
    type: "sms",
  });
  if (verify.error || !verify.data.user) {
    return jsonError(400, { error: "invalid_otp", code: "invalid_otp" });
  }

  const userId = verify.data.user.id;
  const payload = pending.data.payload as PendingPayload;

  const insert = await service
    .from("doctors")
    .insert({
      auth_user_id: userId,
      phone_e164: payload.phone_e164,
      phone_display: payload.phone_display,
      license_number: payload.license_number,
      license_verified_at:
        payload.license_verification_status === "verified" ||
        payload.license_verification_status === "soft_match"
          ? new Date().toISOString()
          : null,
      license_verification_status: payload.license_verification_status,

      arabic_first_name: payload.arabic_first_name,
      arabic_family_name: payload.arabic_family_name,
      arabic_first_name_normalized: payload.arabic_first_name_normalized,
      arabic_family_name_normalized: payload.arabic_family_name_normalized,
      arabic_full_name_normalized: payload.arabic_full_name_normalized,

      hebrew_first_name: payload.hebrew_first_name,
      hebrew_family_name: payload.hebrew_family_name,

      subspecialty: payload.subspecialty,
      subspecialty_normalized: payload.subspecialty_normalized,
      email: payload.email,
      email_domain: payload.email_domain,
      email_is_institutional: payload.email_is_institutional,

      consent_directory_use: true,
      consent_timestamp: new Date().toISOString(),

      is_phone_verified: true,
      // No auto-approval — every new doctor row awaits admin review (#16).
      is_admin_approved: false,
      // Default visibility preference; visibility in the directory still
      // requires admin approval via the doctor_visible view (#20).
      user_chose_visible: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (insert.error) {
    console.error("[signup/verify] doctor insert failed", insert.error);
    return jsonError(500, { error: "create_failed", code: "create_failed" });
  }

  if (payload.specialty_ids.length > 0) {
    const links = await service.from("doctor_specialties").insert(
      payload.specialty_ids.map((sid) => ({
        doctor_id: insert.data.id,
        specialty_id: sid,
      })),
    );
    if (links.error) console.error("[signup/verify] specialty link failed", links.error);
  }

  if (payload.workplaces?.length) {
    const wp = await service.from("doctor_workplaces").insert(
      payload.workplaces.map((w) => ({
        doctor_id: insert.data.id,
        name: w.name,
        name_normalized: w.name_normalized,
        is_primary: w.is_primary,
        sort_order: w.sort_order,
      })),
    );
    if (wp.error) console.error("[signup/verify] workplace insert failed", wp.error);
  }

  await service.from("pending_signups").delete().eq("id", pending.data.id);

  await service.from("audit_logs").insert({
    actor_doctor_id: insert.data.id,
    action: "signup_verified",
    target_doctor_id: insert.data.id,
    metadata: {
      license_status: payload.license_verification_status,
      auto_approved: false,
      email_is_institutional: payload.email_is_institutional,
      email_domain: payload.email_domain,
    },
  });

  // Fire the verification email best-effort. Doctor row exists either way;
  // the admin review surface shows whether the email was confirmed.
  let emailSent = false;
  try {
    await dispatchSignupVerifyEmail({
      doctorId: insert.data.id,
      email: payload.email,
      arabicFirstName: payload.arabic_first_name,
    });
    emailSent = true;
    await service
      .from("doctors")
      .update({ email_verification_sent_at: new Date().toISOString() })
      .eq("id", insert.data.id);
  } catch (err) {
    console.error("[signup/verify] email dispatch failed", err);
  }

  return jsonOk({ ok: true, auto_approved: false, email_verification_sent: emailSent });
}
```

**Step 7.2: Lint**

Run: `npm run lint`. Expected: passes (`dispatchSignupVerifyEmail` is provided in Task 8).

**Step 7.3: Commit (deferred until Task 8 — code does not compile alone)**

This file references `lib/signup/email-dispatch.ts`, created in the next task. Stage but do not commit yet.

---

### Task 8: Email-dispatch helper used by `signup/verify`, `signup/email-start`, and admin "Resend" button

**Files:**
- Create: `lib/signup/email-dispatch.ts`
- Test: `lib/signup/email-dispatch.test.ts`

**Step 8.1: Write the failing test**

`lib/signup/email-dispatch.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchSignupVerifyEmail } from "./email-dispatch";

const ORIGINAL_FETCH = globalThis.fetch;

describe("dispatchSignupVerifyEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.SIGNUP_TOKEN_SECRET = "secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("posts an email containing a verify URL with a valid token", async () => {
    const captured: { url?: string; body?: string } = {};
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.body = init.body as string;
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await dispatchSignupVerifyEmail({
      doctorId: "00000000-0000-0000-0000-000000000001",
      email: "dr@hadassah.org.il",
      arabicFirstName: "نور",
    });

    expect(captured.url).toBe("https://example.test/emails");
    const body = JSON.parse(captured.body!);
    const html = body.html as string;
    expect(html).toContain("https://app.example/api/signup/email-verify?token=");
    // The token should round-trip through verifyEmailToken.
    const match = html.match(/token=([A-Za-z0-9_\-.]+)/);
    expect(match).toBeTruthy();
    const { verifyEmailToken } = await import("./email-token");
    const r = verifyEmailToken(match![1]!);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe("doctor");
      expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    }
  });
});
```

**Step 8.2: Run test → fails**

Run: `npm test -- email-dispatch`.

**Step 8.3: Implement**

`lib/signup/email-dispatch.ts`:
```ts
// Cross-cutting helper: build the verify URL, render the email, send it.
// Used by signup/verify (initial dispatch), signup/email-start (resend),
// and an admin "resend email" action.

import { createHash } from "node:crypto";
import { ResendClient } from "@/lib/email/resend";
import { renderSignupVerifyEmail } from "@/lib/email/templates/signup-verify";
import { issueEmailToken, type TokenTarget } from "./email-token";

const PENDING_TTL_MS = 15 * 60_000;          // matches pending_signups TTL
const DOCTOR_TTL_MS = 24 * 60 * 60_000;      // generous post-signup window

export interface DispatchInput {
  /**
   * For pending-signup tokens, pass `{ pendingId }`. For doctor-row tokens
   * (post-signup), pass `{ doctorId }`. Exactly one of the two is required.
   */
  pendingId?: string;
  doctorId?: string;
  email: string;
  arabicFirstName: string;
  resend?: ResendClient;
}

export async function dispatchSignupVerifyEmail(input: DispatchInput): Promise<void> {
  const target: TokenTarget = input.pendingId ? "pending" : "doctor";
  const id = input.pendingId ?? input.doctorId;
  if (!id) throw new Error("dispatchSignupVerifyEmail: pendingId or doctorId required");

  const ttlMs = target === "pending" ? PENDING_TTL_MS : DOCTOR_TTL_MS;
  const token = issueEmailToken({ target, id, ttlMs });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  const normalisedBase = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const verifyUrl = `${normalisedBase}/api/signup/email-verify?token=${encodeURIComponent(token)}`;

  const { subject, html, text } = renderSignupVerifyEmail({
    arabicFirstName: input.arabicFirstName,
    verifyUrl,
    expiryMinutes: Math.floor(ttlMs / 60_000),
  });

  const idempotencyKey = createHash("sha256")
    .update(`${target}:${id}:${input.email}`)
    .digest("hex");

  const client = input.resend ?? new ResendClient();
  await client.send({
    to: input.email,
    subject,
    html,
    text,
    idempotencyKey,
  });
}
```

**Step 8.4: Run test → passes; commit Task 7 + 8 together**

```bash
npm test -- email-dispatch
git add app/api/signup/verify/route.ts lib/signup/email-dispatch.ts lib/signup/email-dispatch.test.ts
git commit -m "feat(signup): drop auto-approve, dispatch verification email on OTP verify"
```

---

### Task 9: `signup/start` rejects `not_found` (with pre-approved exception); records email columns; tightens rate limit

**Files:**
- Modify: `lib/ratelimit.ts` (add `signupStartNotFound` key)
- Modify: `app/api/signup/start/route.ts`
- Modify: `app/api/signup/check-license/route.ts` (consistent UI message)

**Step 9.1: Add the rate-limit key**

Edit `lib/ratelimit.ts`. In the `RATE_LIMITS` constant, add:
```ts
  signupStartNotFound: { limit: 1, window: "1 h" },
```
Adjacent to `signupStart`.

**Step 9.2: Modify `app/api/signup/start/route.ts`**

The diff (specific edits, not a full rewrite):

1. Add imports near the top:
   ```ts
   import { extractDomain, isInstitutionalEmail } from "@/lib/signup/email-allowlist";
   import { isPreApproved } from "@/lib/signup/pre-approved";
   ```

2. After the `verified = await verifyLicense(...)` block (currently at line ~118), insert a new branch that fires before the `name_mismatch` check:

   ```ts
   if (verified.status === "not_found") {
     const allowed = await isPreApproved(service, license);
     if (!allowed) {
       // Tighten rate limit on the not_found path so an attacker probing
       // license ranges burns through their quota fast.
       await rateLimit("signupStartNotFound", `ip:${ip}`);
       await service.from("audit_logs").insert({
         action: "signup_not_found_rejected",
         metadata: { ip }, // license number deliberately omitted to avoid
                            // logging the attacker's probe payload
       });
       return jsonError(409, {
         error: "license_not_in_registry",
         code: "license_not_in_registry",
         fields: {
           license_number:
             "رقم الترخيص غير موجود في سجل وزارة الصحة. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
         },
       });
     }
   }
   ```

   Also add an early gate: before doing the heavy work, check the `signupStartNotFound` budget:

   Insert near the top of `POST`, immediately after the `signupStart` IP rate limit check:
   ```ts
   const rlNotFound = await rateLimit("signupStartNotFound", `ip:${ip}`);
   if (!rlNotFound.success) {
     return jsonError(429, { error: "rate_limited", code: "rate_limited" });
   }
   ```

   This consumes a budget unit for *every* attempt; that is intentional. A legitimate attempt costs nothing extra (the limit is 1/h, but the window is per-IP and 99% of users sign up once). The point of the bucket is that the *second* attempt after a `not_found` rejection within the same hour is denied — making enumeration via repeated `not_found`s impossibly slow per IP.

3. In the `pending_signups` insert (existing, search for `payload: {`), extend the payload object with three new fields just before `license_verification_status:`:

   ```ts
   email_domain: extractDomain(parsed.email) ?? "",
   email_is_institutional: isInstitutionalEmail(parsed.email),
   ```

   And ensure `email: parsed.email.trim(),` (current is already there but is `parsed.email?.trim() || null`; tighten to `parsed.email.trim()` because email is now mandatory; the Zod schema already forces it via `z.email()`).

4. Extend the response so the client knows whether the signup will require an email click:

   ```ts
   return jsonOk({
     signup_session_id: insert.data.id,
     expires_at: expiresAt,
     license_status: verified.status,
     email_is_institutional: isInstitutionalEmail(parsed.email),
   });
   ```

**Step 9.3: Modify `app/api/signup/check-license/route.ts`**

Add a single early branch so the UI surfaces the same `not_found` message at the first interaction (matches the `signup/start` 409). After `verifyLicense` returns, before the existing `jsonOk`:

```ts
if (result.status === "not_found") {
  return jsonError(409, {
    error: "license_not_in_registry",
    code: "license_not_in_registry",
    fields: {
      license_number:
        "رقم الترخيص غير موجود في سجل وزارة الصحة. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
    },
  });
}
```

Note: `check-license` runs without the service client having access to `pre_approved_licenses` lookups today, but it does — it already uses `createSupabaseServiceClient()`. Add the same `isPreApproved` short-circuit so a pre-approved license number gets through this check:

```ts
import { isPreApproved } from "@/lib/signup/pre-approved";
// ... after verifyLicense returns:
if (result.status === "not_found") {
  const license = String(parsed.license_number).trim();
  if (!(await isPreApproved(supabase, license))) {
    return jsonError(409, {
      error: "license_not_in_registry",
      code: "license_not_in_registry",
      fields: {
        license_number:
          "رقم الترخيص غير موجود في سجل وزارة الصحة. تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
      },
    });
  }
}
```

**Step 9.4: Lint + tests**

```bash
npm run lint && npm test
```

Expected: green.

**Step 9.5: Commit**

```bash
git add lib/ratelimit.ts app/api/signup/start/route.ts app/api/signup/check-license/route.ts
git commit -m "feat(signup): reject not_found licenses, gate via pre_approved exception list"
```

---

### Task 10: New `email-start` endpoint (re-send) and `email-verify` endpoint (consume token)

**Files:**
- Create: `app/api/signup/email-start/route.ts`
- Create: `app/api/signup/email-verify/route.ts`

**Step 10.1: Implement `email-start`**

`app/api/signup/email-start/route.ts`:
```ts
// POST /api/signup/email-start
// Re-sends the verification email. Two modes:
//   1) Caller sends `{ signup_session_id }` — used when the doctor wants to
//      re-trigger an email during the pending-signup window.
//   2) Caller is authenticated — uses the current doctor's id and email.
//
// Idempotent at the Resend layer via deterministic Idempotency-Key.
// Rate-limited so it isn't used as a spam vector.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk } from "@/lib/api/respond";
import { getCurrentDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { dispatchSignupVerifyEmail } from "@/lib/signup/email-dispatch";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  signup_session_id: z.uuid().optional(),
});

export async function POST(req: Request) {
  const ip = ipFromHeaders(req);
  const rl = await rateLimit("signupCheckUnique", `ip:${ip}`); // share the cheap unauth bucket
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json().catch(() => ({})));
  } catch {
    return jsonError(400, { error: "invalid_body", code: "invalid_body" });
  }

  const service = createSupabaseServiceClient();

  if (parsed.signup_session_id) {
    const pending = await service
      .from("pending_signups")
      .select("id, payload, expires_at")
      .eq("id", parsed.signup_session_id)
      .maybeSingle();
    if (pending.error && pending.error.code !== "PGRST116") throw pending.error;
    if (!pending.data || new Date(pending.data.expires_at).getTime() < Date.now()) {
      return jsonError(410, { error: "session_expired", code: "session_expired" });
    }
    const payload = pending.data.payload as {
      email: string;
      arabic_first_name: string;
    };
    try {
      await dispatchSignupVerifyEmail({
        pendingId: pending.data.id,
        email: payload.email,
        arabicFirstName: payload.arabic_first_name,
      });
    } catch (err) {
      console.error("[email-start] dispatch failed", err);
      return jsonError(502, { error: "email_send_failed", code: "email_send_failed" });
    }
    return jsonOk({ ok: true, sent: true });
  }

  const me = await getCurrentDoctor().catch(() => null);
  if (!me) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  if (!me.email) return jsonError(400, { error: "no_email_on_file", code: "no_email_on_file" });

  try {
    await dispatchSignupVerifyEmail({
      doctorId: me.id,
      email: me.email,
      arabicFirstName: me.arabic_first_name,
    });
    await service
      .from("doctors")
      .update({ email_verification_sent_at: new Date().toISOString() })
      .eq("id", me.id);
  } catch (err) {
    console.error("[email-start] dispatch failed", err);
    return jsonError(502, { error: "email_send_failed", code: "email_send_failed" });
  }
  return jsonOk({ ok: true, sent: true });
}
```

**Step 10.2: Implement `email-verify`**

`app/api/signup/email-verify/route.ts`:
```ts
// GET /api/signup/email-verify?token=...
// Consumes the HMAC-signed verification token and marks the email verified.
// Returns a small RTL HTML confirmation page rather than JSON, since the
// caller is a click from the user's email client.

import { ipFromHeaders, jsonError } from "@/lib/api/respond";
import { rateLimit } from "@/lib/ratelimit";
import { verifyEmailToken } from "@/lib/signup/email-token";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = ipFromHeaders(req);
  const rl = await rateLimit("signupCheckUnique", `ip:${ip}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  const result = verifyEmailToken(token);
  if (!result.ok) {
    return htmlPage(400, {
      title: "رابط غير صالح",
      message:
        result.reason === "expired"
          ? "انتهت صلاحية هذا الرابط. يمكنك طلب رابط جديد من صفحة تسجيل الدخول."
          : "هذا الرابط غير صالح.",
    });
  }

  const service = createSupabaseServiceClient();

  if (result.target === "pending") {
    const pending = await service
      .from("pending_signups")
      .select("id, payload, expires_at")
      .eq("id", result.id)
      .maybeSingle();
    if (pending.error && pending.error.code !== "PGRST116") throw pending.error;
    if (!pending.data || new Date(pending.data.expires_at).getTime() < Date.now()) {
      return htmlPage(410, {
        title: "انتهت الجلسة",
        message: "أكمل العملية وسجّل من جديد.",
      });
    }
    const payload = pending.data.payload as Record<string, unknown>;
    if (!payload.email_verified_at) {
      payload.email_verified_at = new Date().toISOString();
      await service
        .from("pending_signups")
        .update({ payload })
        .eq("id", pending.data.id);
    }
    return htmlPage(200, {
      title: "تم التحقق من بريدك",
      message: "أكمل خطوة رمز SMS لإنشاء حسابك.",
    });
  }

  // target === "doctor" — mark on the row.
  const doctor = await service
    .from("doctors")
    .select("id, email_verified_at")
    .eq("id", result.id)
    .maybeSingle();
  if (doctor.error && doctor.error.code !== "PGRST116") throw doctor.error;
  if (!doctor.data) {
    return htmlPage(410, {
      title: "حساب غير موجود",
      message: "تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
    });
  }
  if (!doctor.data.email_verified_at) {
    await service
      .from("doctors")
      .update({ email_verified_at: new Date().toISOString() })
      .eq("id", doctor.data.id);
    await service.from("audit_logs").insert({
      actor_doctor_id: doctor.data.id,
      action: "email_verified",
      target_doctor_id: doctor.data.id,
    });
  }
  return htmlPage(200, {
    title: "تم التحقق من بريدك",
    message: "ستظهر حالة التحقق للإدارة عند مراجعة طلبك.",
  });
}

function htmlPage(
  status: number,
  body: { title: string; message: string },
): Response {
  const safeTitle = escapeHtml(body.title);
  const safeMessage = escapeHtml(body.message);
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${safeTitle}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 64px auto; padding: 24px; text-align: center;">
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <p><a href="/">العودة للصفحة الرئيسية</a></p>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

**Step 10.3: Lint**

Run: `npm run lint`. Expected: passes.

**Step 10.4: Commit**

```bash
git add app/api/signup/email-start/ app/api/signup/email-verify/
git commit -m "feat(signup): add email-start (resend) and email-verify (consume token) endpoints"
```

---

### Task 11: Switch `/api/search` from service client to SSR client; read from `doctor_visible` view

**Files:**
- Modify: `app/api/search/route.ts`

**Step 11.1: Replace the file**

Two structural changes:

1. Replace `createSupabaseServiceClient()` with `createSupabaseServerClient()` for the *main* doctor query. The user-scoped client carries the doctor's JWT, so RLS applies. The pre-resolution of specialty + workplace IDs may stay on the service client for performance (RLS would deny those joined-table reads from the user side, but the application layer still owns the OR composition and does not leak anything because the main `doctor_visible` query enforces visibility).
   - Actually, a cleaner design: do the entire search through the SSR client against the `doctor_visible` view. Joined tables (`specialties`, `doctor_workplaces`) have RLS policies that already grant authenticated reads of *visible* doctors' specialties/workplaces. Reading via the SSR client is therefore safe and self-consistent. Keep the service client out of `search` entirely.

2. Read from `public.doctor_visible` instead of `public.doctors`. Drop the manual `.eq("is_active", true).eq(...)`-quintet entirely; the view bakes it in.

The new file body (replacing lines 44-225 of current; preserving the imports and the `SearchHit` interface):

```ts
export async function GET(req: Request) {
  const me = await getCurrentDoctor().catch(() => null);
  if (!me) {
    return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  }

  const rl = await rateLimit("search", `doctor:${me.id}`);
  if (!rl.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? "",
    specialty_id: url.searchParams.get("specialty_id") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, { error: "invalid_query", code: "invalid_query" });
  }

  const qRaw = parsed.data.q;
  const qNorm = normalizeArabic(qRaw);
  const ssr = await createSupabaseServerClient();

  // Read from the doctor_visible view: visibility contract is enforced at
  // the relation level, so a missed .eq() here cannot leak unapproved rows.
  let query = ssr
    .from("doctor_visible")
    .select(
      `
      id,
      arabic_first_name,
      arabic_family_name,
      hebrew_first_name,
      hebrew_family_name,
      phone_display,
      phone_e164,
      phone_is_visible,
      workplaces_is_visible,
      profile_picture_url,
      email,
      subspecialty,
      doctor_specialties${parsed.data.specialty_id ? "!inner" : ""}(
        specialty:specialties(id, name_ar)
      ),
      doctor_workplaces(name, is_primary, sort_order)
    `,
    )
    .order("arabic_full_name", { ascending: true })
    .limit(50);

  if (parsed.data.specialty_id) {
    query = query.eq(
      "doctor_specialties.specialty_id",
      parsed.data.specialty_id,
    );
  }

  if (qNorm) {
    const escaped = qNorm.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    if (!escaped) {
      return jsonOk({ results: [], count: 0 });
    }
    const pattern = `*${escaped}*`;

    const [specialtyMatches, workplaceMatches] = await Promise.all([
      ssr
        .from("specialties")
        .select("id")
        .or(
          [
            `name_ar_normalized.ilike.${pattern}`,
            `name_ar.ilike.${pattern}`,
          ].join(","),
        ),
      ssr
        .from("doctor_workplaces")
        .select("doctor_id")
        .or(
          [
            `name_normalized.ilike.${pattern}`,
            `name.ilike.${pattern}`,
          ].join(","),
        ),
    ]);

    const specialtyIds = (specialtyMatches.data ?? []).map((r) => r.id);
    const doctorIdsViaSpecialty = specialtyIds.length
      ? (
          await ssr
            .from("doctor_specialties")
            .select("doctor_id")
            .in("specialty_id", specialtyIds)
        ).data?.map((r) => r.doctor_id) ?? []
      : [];

    const doctorIdsViaWorkplace =
      (workplaceMatches.data ?? []).map((r) => r.doctor_id);

    const joinedDoctorIds = Array.from(
      new Set([...doctorIdsViaSpecialty, ...doctorIdsViaWorkplace]),
    );

    const orFilters = [
      `arabic_full_name_normalized.ilike.${pattern}`,
      `arabic_first_name_normalized.ilike.${pattern}`,
      `arabic_family_name_normalized.ilike.${pattern}`,
      `subspecialty_normalized.ilike.${pattern}`,
    ];
    if (joinedDoctorIds.length) {
      orFilters.push(`id.in.(${joinedDoctorIds.join(",")})`);
    }
    query = query.or(orFilters.join(","));
  }

  const { data, error } = await query;
  if (error) {
    console.error("[search] query failed", error);
    return jsonOk({ results: [], count: 0 });
  }
  // mapping unchanged — strip license_number from the SearchHit interface
  // and from the select above per issue #26 (separate issue, but the
  // license_number leak is a known issue and the user explicitly excluded
  // #26 from this round, so leave it; remove only if maintainer requests).
  // ... existing results mapping (drop the license_number field if maintainer wants it gone).
  // ...
}
```

(Preserve the existing `results` mapping; the only meaningful changes there are: drop the `license_number` column from the select list above, and drop the `license_number` from the `SearchHit` interface — **only if** maintainer wants this round to also close issue #26. Issue #26 is *not* in scope per the user's explicit list (#16-#20 only). So **keep** `license_number` in select and mapping for now and let #26 be closed separately. The executor must NOT silently expand scope.)

**Step 11.2: Remove the now-unused service-client import**

Delete `import { createSupabaseServiceClient } from "@/lib/supabase/service";` if no other line in `search/route.ts` references it. Add `import { createSupabaseServerClient } from "@/lib/supabase/server";` if not present.

**Step 11.3: Lint**

Run: `npm run lint`. Expected: passes.

**Step 11.4: Commit**

```bash
git add app/api/search/route.ts
git commit -m "refactor(search): read from doctor_visible via SSR client; visibility now RLS-enforced"
```

---

### Task 12: Revocation sweep in `/api/cron/sync-moh`

**Files:**
- Modify: `app/api/cron/sync-moh/route.ts`

**Step 12.1: Add the sweep**

After the existing `await flush();` and before the `audit_logs` insert (currently around line 66-89), add:

```ts
// Revocation sweep (#18). After the mirror has been refreshed, find
// approved doctors whose license is no longer in the registry and bump
// their missing_sync_count. After 3 consecutive misses, mark them
// revoked + inactive. Doctors whose license is present have the counter
// reset.
const REVOKE_AFTER_MISSING_CYCLES = 3;

const sweep = await supabase.rpc("revocation_sweep", {
  threshold_cycles: REVOKE_AFTER_MISSING_CYCLES,
});
```

Where `revocation_sweep(threshold_cycles int)` is a SQL function defined in a follow-on migration (Step 12.2). Returns a JSON object `{ missed: int, reset: int, revoked: uuid[] }`.

**Step 12.2: Add the sweep function as a migration**

Create `supabase/migrations/0009_revocation_sweep_fn.sql`:
```sql
-- 0009_revocation_sweep_fn.sql — revocation sweep stored procedure (#18).
-- Invoked from app/api/cron/sync-moh/route.ts after the mirror upsert.
-- Returns counters + the list of newly-revoked doctor ids so the route
-- can write per-doctor audit_log rows.

create or replace function public.revocation_sweep(threshold_cycles int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed int := 0;
  v_reset  int := 0;
  v_revoked uuid[];
begin
  -- 1) Bump miss counter for approved doctors not present in the mirror.
  with bumped as (
    update public.doctors d
       set missing_sync_count = d.missing_sync_count + 1
     where d.is_admin_approved
       and d.is_active
       and coalesce(d.license_verification_status, '') <> 'revoked'
       and not exists (
         select 1 from public.moh_practitioners mp
          where mp.license_number::text = d.license_number
       )
    returning d.id
  )
  select count(*) into v_missed from bumped;

  -- 2) Reset for doctors that did appear (also stamps last_seen_in_moh_at).
  with refreshed as (
    update public.doctors d
       set missing_sync_count = 0,
           last_seen_in_moh_at = now()
     where exists (
       select 1 from public.moh_practitioners mp
        where mp.license_number::text = d.license_number
     )
    returning d.id
  )
  select count(*) into v_reset from refreshed;

  -- 3) Revoke at threshold.
  with revoked as (
    update public.doctors d
       set is_active = false,
           is_admin_approved = false,
           license_verification_status = 'revoked'
     where d.missing_sync_count >= threshold_cycles
       and coalesce(d.license_verification_status, '') <> 'revoked'
    returning d.id
  )
  select coalesce(array_agg(id), '{}') into v_revoked from revoked;

  return jsonb_build_object(
    'missed', v_missed,
    'reset', v_reset,
    'revoked', to_jsonb(v_revoked)
  );
end;
$$;

revoke all on function public.revocation_sweep(int) from public, anon, authenticated;
grant execute on function public.revocation_sweep(int) to service_role;
```

**Step 12.3: After `revocation_sweep` call, write per-doctor audit logs**

Continuing in `cron/sync-moh/route.ts`, after the RPC call:

```ts
type SweepResult = { missed: number; reset: number; revoked: string[] };
const sweepResult: SweepResult =
  (sweep.data as SweepResult | null) ?? { missed: 0, reset: 0, revoked: [] };

if (sweepResult.revoked.length > 0) {
  const rows = sweepResult.revoked.map((id) => ({
    action: "license_revoked_sync",
    target_doctor_id: id,
    metadata: { reason: "license missing from MoH for >=3 sync cycles" },
  }));
  await supabase.from("audit_logs").insert(rows);
}
```

And extend the final `audit_logs` "moh_sync_completed" metadata:
```ts
metadata: {
  rows_upserted: upserted,
  duration_ms: Date.now() - startedAt,
  sweep_missed: sweepResult.missed,
  sweep_reset: sweepResult.reset,
  sweep_revoked_count: sweepResult.revoked.length,
},
```

**Step 12.4: Add a tiny vitest for the sweep predicate**

Create `lib/moh/revocation.ts`:
```ts
// Pure predicate used by the cron route's smoke tests and any future
// sweep-related code. Keeping the threshold constant lifted to a module
// makes it greppable.

export const REVOKE_AFTER_MISSING_CYCLES = 3;

export function shouldRevoke(missingCount: number): boolean {
  return missingCount >= REVOKE_AFTER_MISSING_CYCLES;
}
```

Create `lib/moh/revocation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { REVOKE_AFTER_MISSING_CYCLES, shouldRevoke } from "./revocation";

describe("shouldRevoke", () => {
  it("does not revoke under threshold", () => {
    expect(shouldRevoke(0)).toBe(false);
    expect(shouldRevoke(1)).toBe(false);
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES - 1)).toBe(false);
  });
  it("revokes at and above threshold", () => {
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES)).toBe(true);
    expect(shouldRevoke(REVOKE_AFTER_MISSING_CYCLES + 5)).toBe(true);
  });
});
```

In `cron/sync-moh/route.ts`, replace the inline `REVOKE_AFTER_MISSING_CYCLES = 3` with `import { REVOKE_AFTER_MISSING_CYCLES } from "@/lib/moh/revocation";`.

**Step 12.5: Run lint + tests**

```bash
npm run lint && npm test
```

Expected: green.

**Step 12.6: Commit**

```bash
git add app/api/cron/sync-moh/route.ts supabase/migrations/0009_revocation_sweep_fn.sql lib/moh/revocation.ts lib/moh/revocation.test.ts
git commit -m "feat(cron): revocation sweep with 3-cycle grace window after MoH sync"
```

---

### Task 13: Admin UI — surface email verification + domain badges + revoked tab

**Files:**
- Modify: `app/(admin)/admin/page.tsx`
- Modify: `app/(admin)/admin/AdminDoctorsTable.tsx`

**Step 13.1: Extend the admin select**

In `app/(admin)/admin/page.tsx`, expand the `select` string to also fetch the email signals:

```ts
.select(
  "id, arabic_first_name, arabic_family_name, phone_e164, license_number, email, email_domain, email_is_institutional, email_verified_at, license_verification_status, is_admin_approved, is_active, user_chose_visible, created_at",
)
```

And extend the `SearchParams` `status` union to include `"revoked"`:
```ts
interface SearchParams {
  status?: "pending" | "approved" | "all" | "revoked";
  q?: string;
}
```

After the existing status branches, add:
```ts
if (status === "revoked") query = query.eq("license_verification_status", "revoked");
```

**Step 13.2: Extend the table component**

In `app/(admin)/admin/AdminDoctorsTable.tsx`:

1. Extend the `Row` interface:
   ```ts
   interface Row {
     id: string;
     arabic_first_name: string;
     arabic_family_name: string;
     phone_e164: string;
     license_number: string;
     email: string | null;
     email_domain: string | null;
     email_is_institutional: boolean;
     email_verified_at: string | null;
     license_verification_status: string | null;
     is_admin_approved: boolean;
     is_active: boolean;
     user_chose_visible: boolean;
     created_at: string;
   }
   ```

2. Add `"revoked"` to the tab list:
   ```ts
   {(["pending", "approved", "revoked", "all"] as const).map((s) => ( … ))}
   ```
   And the label:
   ```ts
   {s === "pending" ? "قيد المراجعة" : s === "approved" ? "مفعّلون" : s === "revoked" ? "مُلغى" : "الكل"}
   ```

3. Add two new columns: "البريد" (email + verification badge) and "المؤسسة" (institutional badge). Insert them after the existing license column. Each cell:

   ```tsx
   <td className="p-3 text-center">
     {r.email ? (
       <div className="flex flex-col items-center gap-1">
         <span dir="ltr" className="text-xs">{r.email}</span>
         <span
           className={
             "inline-block rounded-full px-2 py-0.5 text-xs " +
             (r.email_verified_at
               ? "bg-green-100 text-green-800"
               : "bg-foreground/10 text-foreground/70")
           }
         >
           {r.email_verified_at ? "موثّق" : "بانتظار التحقق"}
         </span>
       </div>
     ) : (
       <span className="text-foreground/50">—</span>
     )}
   </td>
   <td className="p-3 text-center">
     <span
       className={
         "inline-block rounded-full px-2 py-0.5 text-xs " +
         (r.email_is_institutional
           ? "bg-blue-100 text-blue-800"
           : "bg-amber-100 text-amber-800")
       }
     >
       {r.email_is_institutional ? "مؤسسي" : "غير مؤسسي"}
     </span>
     {r.email_domain && (
       <div dir="ltr" className="mt-1 text-xs text-foreground/60">
         {r.email_domain}
       </div>
     )}
   </td>
   ```

   And bump the table header `colSpan` for the empty row from `5` to `7`. Update the `<thead>` to add the two new headers.

**Step 13.3: Lint**

Run: `npm run lint`.

**Step 13.4: Commit**

```bash
git add "app/(admin)/admin/page.tsx" "app/(admin)/admin/AdminDoctorsTable.tsx"
git commit -m "feat(admin): surface email verification status, institutional badge, revoked tab"
```

---

### Task 14: Signup form — surface the new `not_found` error and the post-signup "check your inbox" message

**Files:**
- Modify: `app/(public)/signup/SignupForm.tsx`
- Modify: `app/(public)/verify/VerifyForm.tsx` (only the success path message)

**Step 14.1: Map `license_not_in_registry` to a Field error**

In `SignupForm.tsx`, the existing `if (!start.ok)` branch already pulls `startBody?.fields` into `setFieldErrors`. The `license_not_in_registry` error returns `fields: { license_number: "..." }`, so this works without code change. Add a comment confirming the new error code is handled.

In the `lic.status === "name_mismatch"` branch (line ~96), add a sibling check for the new `license_not_in_registry` 409 returned by `/api/signup/check-license`:

```ts
const lic = await fetch(...).then((r) => r.json());

// New: check-license now 409s for not_found unless the license is on the
// admin allowlist (issue #19). Surface the field error directly.
if (lic?.error === "license_not_in_registry") {
  setFieldErrors({
    license_number: lic.fields?.license_number ??
      "رقم الترخيص غير موجود في سجل وزارة الصحة.",
  });
  setSubmitting(false);
  return;
}
```

**Step 14.2: After successful signup, redirect to verify with a flag that the email is also pending**

The current code redirects to `/verify?mode=signup` after the OTP request succeeds. The downstream `/verify` step is unchanged — OTP first, then the doctor row is inserted in `signup/verify`. After signup/verify returns `email_verification_sent: true`, the user lands on the dashboard (existing flow); we need to surface "check your email" there.

Modify `app/(public)/verify/VerifyForm.tsx` (only the success branch — find the line that calls `router.push("/dashboard")` or similar after a successful `/api/signup/verify` POST). Right after the POST:

```ts
const verifyJson = await verifyRes.json();
if (verifyRes.ok && verifyJson?.email_verification_sent) {
  // Stash a flag so the holding page can show "check your inbox".
  sessionStorage.setItem("verify:email_sent", "1");
}
```

If the existing `/verify` page does not yet have a "holding" state for unapproved-but-OTP'd users, add a tiny notice on the existing thank-you page that reads (in Arabic): "تم التسجيل. أرسلنا رسالة تأكيد إلى بريدك الإلكتروني، الرجاء فتحها للمتابعة. حسابك قيد المراجعة من قبل الإدارة." — read `sessionStorage.getItem("verify:email_sent")` to show it.

(Executor: the exact phrasing of the existing post-OTP screen depends on what the file currently does; preserve its structure and only add the email-sent notice.)

**Step 14.3: Lint**

Run: `npm run lint`.

**Step 14.4: Commit**

```bash
git add "app/(public)/signup/SignupForm.tsx" "app/(public)/verify/VerifyForm.tsx"
git commit -m "feat(signup ui): surface not_found error and post-signup email notice"
```

---

### Task 15: Extend `scripts/rls-smoke-test.ts` with the new invariants

**Files:**
- Modify: `scripts/rls-smoke-test.ts`

**Step 15.1: Add three new checks**

Append these to the `checks` array:

```ts
{
  name: "anon cannot read doctor_visible view",
  run: async () => testEmpty("doctor_visible"),
},
{
  name: "anon cannot read pre_approved_licenses",
  run: async () => testEmpty("pre_approved_licenses"),
},
{
  name: "doctor_visible has zero rows when no doctor is approved",
  // This is a soft check — if the test database happens to have an
  // approved + visible doctor seeded, we skip rather than fail. The
  // important invariant (anon-deny) is already covered above.
  run: async () => {
    const { data, error } = await anon
      .from("doctor_visible")
      .select("id")
      .limit(1);
    if (error) {
      return { leaked: false, detail: `denied (${error.code ?? error.message})` };
    }
    // anon should never get rows from doctor_visible regardless of DB content.
    const count = data?.length ?? 0;
    return {
      leaked: count > 0,
      detail: count > 0 ? `LEAK — anon read ${count} row(s) of view` : "ok (empty)",
    };
  },
},
```

**Step 15.2: Run the smoke test (manual)**

The smoke test requires a Supabase project. The executor must NOT run it as part of the implementation loop. The test plan and PR body call this out as a manual pre-merge check.

**Step 15.3: Commit**

```bash
git add scripts/rls-smoke-test.ts
git commit -m "test(rls): cover doctor_visible view and pre_approved_licenses"
```

---

### Task 16: Full lint + test + build sweep

**Step 16.1: Lint**

```bash
cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && npm run lint
```

Expected: zero errors. Warnings are acceptable but list them in the implementation report.

**Step 16.2: Tests**

```bash
npm test
```

Expected: all green. Capture the test count vs baseline.

**Step 16.3: Build**

```bash
npm run build
```

Expected: build succeeds. Next.js 16 is strict about typed routes and async cookies; if any new route fails to build, the executor must read the relevant doc under `node_modules/next/dist/docs/` and fix the route to match Next 16 conventions before continuing.

**Step 16.4: Commit (only if any small fixes were needed)**

If the lint/test/build sweep required a touch-up, commit with `chore: lint and build cleanup`.

---

### Task 17: Update `app/api/admin/doctors/[id]/route.ts` to handle `user_chose_visible` rename and to write a richer audit row

**Files:**
- Modify: `app/api/admin/doctors/[id]/route.ts`

**Step 17.1: Rename + add new approval columns**

Update the Zod body:
```ts
const Body = z.object({
  is_admin_approved: z.boolean().optional(),
  is_active: z.boolean().optional(),
  user_chose_visible: z.boolean().optional(),
});
```

When `is_admin_approved` is being set to `true` and the doctor has no `email_verified_at`, log a warning audit row but allow the action — admin override is intentional.

Insert before the existing `update`:
```ts
if (body.is_admin_approved === true) {
  const target = await service
    .from("doctors")
    .select("id, email_verified_at")
    .eq("id", id)
    .maybeSingle();
  if (target.data && !target.data.email_verified_at) {
    await service.from("audit_logs").insert({
      actor_doctor_id: admin.id,
      action: "admin_approved_without_email_verification",
      target_doctor_id: id,
      metadata: { override: true },
    });
  }
}
```

**Step 17.2: Lint + commit**

```bash
git add "app/api/admin/doctors/[id]/route.ts"
git commit -m "feat(admin): support user_chose_visible rename, audit no-email overrides"
```

---

### Task 18: Write the PR body — env vars, manual checklist, acceptance map

**Files:**
- Create: `docs/plans/2026-05-12-signup-security-overhaul-PR-NOTES.md`

**Step 18.1: Write the PR notes file**

`docs/plans/2026-05-12-signup-security-overhaul-PR-NOTES.md`:
```md
# PR notes — signup security overhaul

Closes #16, #17, #18, #19, #20.

## Required environment variables (set before merge)

| Var | Where | Notes |
|---|---|---|
| `RESEND_API_KEY` | Vercel project (Production + Preview) | Get from Resend dashboard. Without it, signup emails will fail. |
| `RESEND_FROM` | Vercel project | e.g. `Jerusalem Doctors <noreply@yourdomain.example>`. Domain must be verified in Resend. |
| `SIGNUP_TOKEN_SECRET` | Vercel project | 32+ random bytes (`openssl rand -hex 32`). Rotating invalidates pending email-verify links — set once, do not rotate without comms. |
| `NEXT_PUBLIC_APP_URL` | Vercel project | e.g. `https://jerusalem-doctors.vercel.app`. Used to build the email verification URL. Without it the dispatcher falls back to `VERCEL_URL` then `localhost:3000`. |
| `RESEND_BASE_URL` | optional | Override for tests; do not set in prod. |

## Required Supabase actions (before merge)

1. Apply migrations 0007, 0008, 0009 to the prod database. **0008 includes a column rename** (`is_visible` → `user_chose_visible`) and a one-time `UPDATE` that flips every non-admin `is_admin_approved=true` to `false`. Make a snapshot before applying.
2. Verify `pg_trgm` is still enabled (it is from 0001).
3. After apply: confirm `select count(*) from doctor_visible;` returns 0 (since all approvals were reset).
4. Verify the Supabase project's email domain (Resend) is set up with SPF, DKIM, and DMARC.

## Pre-merge manual smoke test

Run from the deployed preview URL:

- [ ] **Sign up with an institutional email** (e.g. `+test@hadassah.org.il`). Expect: OTP completes, you land on the post-signup page with "check your email" notice, doctor row exists with `is_admin_approved=false`, `email_is_institutional=true`, `email_verified_at` becomes non-null after clicking the email link.
- [ ] **Sign up with a Gmail address.** Expect: same flow, `email_is_institutional=false`. Admin queue shows the non-institutional badge.
- [ ] **Sign up with a `not_found` license.** Expect: 409 at the form, no OTP sent (check Twilio dashboard).
- [ ] **Insert a `pre_approved_licenses` row for one license; sign up with that license.** Expect: signup proceeds.
- [ ] **Search as an authenticated non-admin doctor.** Expect: zero results (no one is approved yet). Approve one doctor in the admin panel → re-search → that doctor appears.
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
| #17 | Removed `.eq` does not leak | RLS rewrite + view |
| #18 | Daily cron runs revocation step | Task 12 |
| #18 | Approved doctor missing 3 cycles → inactive + revoked | Task 12 (`shouldRevoke`) |
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

- Email allowlist completeness — `lib/signup/email-allowlist.ts` ships with a TODO marker and 5 seed domains per maintainer decision. Adding more is a one-line PR.
- Removing `license_number` from search results (issue #26).
- Sentry PII scrub audit (issue #27).
- `pending_signups` janitor (issue #21).
- `email_is_visible` toggle (issue #22).
- Subspecialty/workplace input hardening (issue #23).
- Normalization SQL/JS dedup (issue #24).
- CKAN hot-path dependency (issue #25).
```

**Step 18.2: Commit**

```bash
git add docs/plans/2026-05-12-signup-security-overhaul-PR-NOTES.md
git commit -m "docs: add PR notes for signup security overhaul"
```

---

### Task 19: Final sweep — ensure nothing references the old `is_visible` column name; rerun full suite

**Step 19.1: Final grep**

```bash
cd /home/khaleds/projects/salhab/jerusalem-doctors/.worktrees/signup-security-overhaul && rg "\bis_visible\b" -t ts -t tsx -t sql --glob '!supabase/migrations/000{1,2,3,4,5,6}_*.sql' --glob '!docs/**'
```

Expected: zero matches. (Migrations 0001-0006 are historical; their `is_visible` references are correct as historical context. Migration 0008 rewrites the column.)

**Step 19.2: Final lint + test + build**

```bash
npm run lint && npm test && npm run build
```

All green.

**Step 19.3: Final commit (if any cleanup)**

```bash
git status --short
git add -A   # if anything pending
git commit -m "chore: final cleanup pass"
```

---

## Tests we are explicitly NOT writing in this round (called out so reviewers don't ask)

1. **A real-DB integration harness.** Maintainer deferred the test-database decision to before merge. The pure-logic vitest suite + the extended `scripts/rls-smoke-test.ts` cover what can be tested without a dedicated test DB. PR notes call out the manual checks that must run on a real DB before merge.
2. **A Playwright snapshot of the admin dashboard.** Same reason: requires a hosted environment and a seeded admin login. The DOM markup added in Task 13 is small and is tested by virtue of being rendered server-side from the same data shape; visual regressions are out of scope for this round.
3. **Resend deliverability.** We assert payload + URL via the dispatcher test. SPF/DKIM/DMARC and inbox placement are deployment concerns called out in PR notes.
4. **A real Twilio assertion that no SMS is sent on `not_found`.** The `not_found` branch returns before the `signInWithOtp` call; this is provable by code inspection. A second witness (the audit_log row `signup_not_found_rejected`) is added in Task 9 so production can confirm the path.

---

## Risks and mitigations

| Risk | Mitigation in this plan |
|---|---|
| Approval reset (`UPDATE doctors SET is_admin_approved=false`) creates an admin backlog overnight. | Maintainer explicitly chose this. Task 13 adds badges so admins can sort/triage. The "revoked" tab is separate from "pending" so the two surfaces don't conflate. |
| Migration 0008 can't be rolled back losslessly (column rename + UPDATE). | Documented in PR notes; maintainer takes a snapshot before applying. The schema change is small and the data change is well-scoped. |
| Resend API outage breaks signup. | The email send is best-effort in `signup/verify` (try/catch logs but does not 500). The doctor row exists; the email is re-sendable via `/api/signup/email-start`. Admin queue still works without email verification. |
| Stateless tokens lose their meaning if `SIGNUP_TOKEN_SECRET` rotates. | PR notes warn maintainer not to rotate without comms. The 24h doctor TTL and 15min pending TTL bound the blast radius. |
| `doctor_visible` view changes break PostgREST nested selects. | The view is `SELECT *` from `doctors` with a WHERE clause; PostgREST treats it like a table and infers FK joins through the underlying `id` column. Existing `doctor_specialties(...)` joins keep working because the join is by FK on `doctors.id`, which the view exposes. Verified by inspection of PostgREST view semantics. |
| Rename causes any external consumer (BI export, Supabase dashboard query) to break. | Search returned: there are no external references in the repo. Maintainer to do one-off audit of any saved Supabase queries. |
| 3-cycle revocation grace is too aggressive if Vercel cron misses a day. | The grace counter is on the doctor row, not on the cron run. A missed cron day means missing_sync_count is not bumped that day; the threshold is reached after 3 *bumps*, not 3 calendar days. So a missed day delays revocation, not accelerates it. |
| RLS on `doctor_visible` view: the `security_invoker = true` setting requires Postgres 15+. Supabase has been on 15 since mid-2023, so this is safe; if the project is somehow on an older instance, the migration will fail loudly. | Documented; failure mode is loud and reversible. |

---

## Rollback plan (if maintainer needs to revert post-merge)

The cleanest path is `git revert` of the merge commit + a forward migration that reverses the schema:

```sql
-- 00XX_rollback_signup_security.sql
alter table public.doctors rename column user_chose_visible to is_visible;
drop view if exists public.doctor_visible;
drop function if exists public.revocation_sweep(int);
drop policy if exists "verified doctors readable by authenticated" on public.doctors;
create policy "verified doctors readable by authenticated"
  on public.doctors for select to authenticated
  using (is_active and is_visible and is_phone_verified and is_admin_approved and consent_directory_use);
-- (similar restoration for doctor_specialties / doctor_workplaces policies)
-- Re-approve everyone (or selectively):
-- update public.doctors set is_admin_approved = true where ...;
```

Email verification columns are additive — they can stay through a rollback without breaking anything.
