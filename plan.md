# Jerusalem Doctors Directory — Execution Plan (MVP)


## 1. Product Understanding

- **Closed professional directory** for verified doctors in Jerusalem to find each other by Arabic name, specialty, or subspecialty and reach colleagues over WhatsApp click-to-chat. Not a public site.
- **Arabic-first, RTL UI** (`<html lang="ar" dir="rtl">`); Hebrew name fields are stored but UI stays Arabic.
- **Phone is the identity.** Auth is passwordless OTP delivered over WhatsApp; phone number and medical license number are both globally unique.
- **Visibility rule (hard).** Only authenticated, phone-verified, active, visible, consented doctors appear in search results. Guests see only landing/login/signup/privacy.
- **Arabic search correctness is a core feature, not polish.** Hamza variants (أ/إ/آ/ٱ → ا), ى → ي, ؤ → و, ئ → ي, tatweel and diacritics removal, all applied before storage and at query time. Search hits a normalized column, not the raw column.
- **Stack is locked by spec:** Next.js + TypeScript + Tailwind on Vercel Hobby or Cloudflare Pages, Supabase Postgres + Auth + RLS, Twilio (or Meta Cloud API) for WhatsApp OTP.
- **Free hosting, paid auth.** Hosting and DB fit free tiers; **WhatsApp authentication template messages are billed per delivery** — this is the only structurally non-free piece.
- **Privacy is regulated.** Real identifiable healthcare professionals in Israel — Israeli Privacy Protection Data Security Regulations apply; legal review required before any wider launch.
- **Out of scope (do not build):** ratings, patient reviews, public pages, in-app messaging, scheduling, patient-facing anything.

### Critical risks (called out up front)
- **OTP cost runaway** — abuse or growth turns a free MVP into a real bill. Mitigation: rate limits, Turnstile, dev-mode mock OTP. (Section 10)
- **Fake / unverified doctors** — phone verification proves a phone, not a license. Mitigation: automated cross-check at signup against the Israel MoH official doctors registry (data.gov.il, see §13); admin approval gate for soft-failures and edge cases.
- **Privacy / regulatory exposure** — leak of phones + license numbers is a real-world incident. Mitigation: strict RLS, no public endpoints, audit logs, legal review pre-launch.
- **Duplicate / collision profiles** — same doctor signs up twice with two phones, or two doctors share a phone. Mitigation: unique constraints on `phone_e164` and `license_number` enforced at DB level, admin merge tool.
- **Arabic search false negatives** — if normalization is inconsistent between write path and read path, "احمد" silently fails to find "أحمد". Mitigation: single shared `normalizeArabic` utility used by both ingestion and query handler, with a unit-test corpus.

---

## 2. Architecture Decisions (locked)

### 2.1 Frontend — Next.js App Router, mostly Server Components
- **Choice:** Next.js 14+ App Router. Public pages (landing, privacy) are static / server-rendered. Authenticated pages (dashboard, profile, admin) are server-rendered with the Supabase server client; interactive bits (search input, OTP form, multi-select) are Client Components.
- **Why:** Server-side data fetching with Supabase keeps the access token off the client for the initial render, plays cleanly with RLS via the user's JWT, and gives us cheap RTL-correct SSR.
- **Tradeoff:** App Router has a steeper mental model than Pages Router; we accept it because the alternative pushes more secrets and logic to the client.

### 2.2 Backend — Next.js Route Handlers + Supabase, no separate service
- **Choice:** All server logic lives in Next.js Route Handlers under `app/api/*`. Supabase is the database, the auth provider, and the RLS enforcer. No edge functions, no separate Node service.
- **Why:** One deploy target, one language, one auth context. The whole MVP is CRUD + OTP + search; it doesn't justify a second runtime.
- **Tradeoff:** Route Handlers run in Vercel's Node runtime; cold starts are fine for this scale. If we ever need Twilio webhooks or heavy fan-out, we revisit (not in MVP).

### 2.3 Auth — Supabase Phone OTP via Twilio Verify (WhatsApp channel), with mock fallback in dev
- **Choice:** Use Supabase's built-in phone auth with Twilio Verify configured for WhatsApp. In `NODE_ENV=development` (or when `OTP_PROVIDER=mock`), bypass Twilio: fixed code `123456` for any phone, log it to console.
- **Why:** Supabase Auth already issues sessions, refresh tokens, and JWTs we can use in RLS. Bolting Twilio Verify under it is the shortest path. Twilio Verify also lets us flip to SMS as a backup channel without rewriting code.
- **Tradeoff:** We're tied to Supabase's OTP UX (template wording, retry policy). Acceptable. If Twilio's WhatsApp template approval drags, we ship with **SMS OTP** and switch the channel later — login/signup copy already says "رمز التحقق" generically; we just add "(عبر واتساب أو رسالة نصية)" until the WA template is live.

### 2.4 Search — Postgres `ILIKE` over normalized columns for MVP, `pg_trgm` from day one
- **Choice:** Store `*_normalized` columns. Query with `ILIKE '%' || normalize(q) || '%'` against a GIN trigram index (`gin_trgm_ops`). Enable `pg_trgm` in the first migration.
- **Why:** Spec explicitly says ILIKE is the MVP minimum; trigram index makes substring queries actually fast at directory scale (< 100k rows is trivial). Skipping `to_tsvector('arabic', …)` because PG's Arabic FTS dictionary is weak and adds complexity without buying us much over normalize-then-ILIKE.
- **Tradeoff:** No fuzzy / typo-tolerant search yet. Easy upgrade later: add `similarity()` ranking or move to a meilisearch sidecar.

### 2.5 Data model — adopt the spec's later schema (section 16), drop the early one
- **Choice:** Use the section-16 schema (`doctors` + `specialties` + `doctor_specialties` + `audit_logs`), not the section-3 schema. The section-3 schema has `specialities TEXT[]`, which conflicts with the admin-editable specialty list in section 17. Many-to-many is correct.
- **Why:** Matches the spec's own admin requirements, gives us a single source of truth for specialty translations.
- **Tradeoff:** One extra join in search. Negligible.

### 2.6 Hosting — Vercel for MVP
- **Choice:** Vercel Hobby. Cloudflare Pages stays as a documented fallback.
- **Why:** Tighter Next.js integration, zero-config Route Handlers, built-in env-var management. Cloudflare Pages requires the OpenNext adapter and is slightly more setup.
- **Tradeoff:** Vendor lock-in to Vercel's Node runtime. Acceptable for MVP; the app code itself stays portable.

---

## 3. System Architecture (textual diagram)

```
                        ┌─────────────────────────────────────────────┐
                        │  Browser (Arabic, RTL, mobile-first)         │
                        │  Next.js Server Components + small Client    │
                        └────────────────┬────────────────────────────┘
                                         │ HTTPS (cookie-based session)
                                         ▼
                        ┌─────────────────────────────────────────────┐
                        │  Vercel — Next.js (App Router)               │
                        │  app/(public)/...   app/(auth)/dashboard ... │
                        │  app/api/signup, /login, /search, /profile   │
                        └────┬────────────────────────────────┬────────┘
                             │                                │
                  ┌──────────▼──────────┐         ┌───────────▼──────────┐
                  │  Twilio Verify       │         │  Supabase             │
                  │  (WhatsApp channel,  │         │  - Postgres (RLS on)  │
                  │   SMS fallback)      │         │  - Auth (phone OTP)   │
                  │                      │         │  - service_role used  │
                  │  Mock provider in    │         │    only server-side   │
                  │  dev (code=123456)   │         └───────────────────────┘
                  └──────────────────────┘
```

### Auth flow — signup
1. Client `POST /api/signup/check-unique` { phone, license_number } → server normalizes both, queries `doctors`, returns `{available, duplicate_field?}`.
2. Client `POST /api/signup/check-license` { license_number, hebrew_first_name, hebrew_family_name } → server looks up `moh_practitioners` (synced daily from data.gov.il, see §13). Returns `{status: 'verified' | 'name_mismatch' | 'not_found' | 'specialty_warning', registry_first?, registry_family?}`. `name_mismatch` and `not_found` block OTP send.
3. Client `POST /api/signup/start` with full form → server re-validates, normalizes Arabic + phone, writes a **pending_signups** row (token + payload + expiry), calls Supabase `auth.signInWithOtp({ phone, channel: 'whatsapp' })`.
4. Twilio sends WA template message to the doctor's phone.
5. Client `POST /api/signup/verify` { signup_session_id, otp_code } → server calls `auth.verifyOtp`, on success copies pending payload into `doctors`, links `auth_user_id`, marks `is_phone_verified=true`, sets `is_admin_approved` per license-check outcome, deletes pending row, returns session cookie.
6. Redirect → `/dashboard`. License-verified doctors are auto-approved; `not_found` / `specialty_warning` doctors land in the admin queue (`is_admin_approved=false` until reviewed).

### Auth flow — login
1. `POST /api/login/start` { phone } → normalize → check doctor exists & active → `auth.signInWithOtp` (login channel).
2. `POST /api/login/verify` { phone, otp_code } → `auth.verifyOtp` → session cookie → `/dashboard`.

### Search flow
1. Client types in dashboard search box (debounced 250 ms) → `GET /api/search?q=...`.
2. Server validates session, normalizes query string.
3. Single SQL query against `doctors` JOIN `doctor_specialties` JOIN `specialties` with `WHERE is_active AND is_visible AND is_phone_verified AND is_admin_approved AND consent_directory_use AND (norm(name) ILIKE %q% OR norm(specialty) ILIKE %q% OR norm(subspecialty) ILIKE %q% OR hebrew_full_name ILIKE %q%)`. Uses GIN trigram indexes.
4. Server logs `search_submitted` to `audit_logs` with **only** actor id + query length (not the query text — privacy).
5. Returns array of doctor cards with `whatsapp_url` already constructed.

### WhatsApp interaction
- Pure client-side `<a href={whatsapp_url} target="_blank" rel="noopener">`. No proxy through our server. URL format `https://wa.me/${phoneE164.replace('+','')}?text=${encodeURIComponent(prefilled)}`.
- Optional: client-side fire-and-forget `POST /api/audit/whatsapp-click` to log the event for admin metrics — tolerate failure silently.

---

## 4. Development Phases

### Phase 0 — Setup (1–2 days)
**Goal:** Empty but deployable Next.js app wired to Supabase, with CI green.
**Deliverables:**
- `package.json`, Next.js 14 App Router scaffold, Tailwind configured for RTL.
- `.env.local.example` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_*`, `TURNSTILE_*`, `OTP_PROVIDER`.
- Supabase project created (free tier), Twilio trial account created, Cloudflare Turnstile site keys generated.
- Vercel project linked, preview deploys working from `main`.
- ESLint + Prettier + TypeScript strict mode + Husky pre-commit.
- `lib/supabase/{server,client,service}.ts` factories.

**Done when:** A `/` page renders "دليل أطباء القدس" in RTL on a Vercel preview URL, and a server-side health route reads a row from a throwaway Supabase table.

### Phase 1 — Core Infrastructure
**Goal:** Database schema, RLS policies, normalization utilities, shared types, all migrations checked in.
**Deliverables:**
- `supabase/migrations/0001_init.sql` — extensions (`pg_trgm`, `pgcrypto`), `doctors`, `specialties`, `doctor_specialties`, `audit_logs`, `pending_signups`, `moh_practitioners`, all unique constraints, all indexes.
- `supabase/migrations/0002_rls.sql` — RLS policies (Section 9).
- `supabase/migrations/0003_seed_specialties.sql` — 28 specialties from spec §17 with Arabic + Hebrew + English + normalized.
- `lib/normalize/arabic.ts` + `lib/normalize/phone.ts` (E.164) + `lib/normalize/hebrew.ts` (niqqud/gershayim strip) + Vitest unit tests (≥ 30 cases each for Arabic and phone, ≥ 15 for Hebrew).
- `lib/db/types.ts` generated via `supabase gen types typescript`.

**Done when:** Migrations apply cleanly to a fresh Supabase project; `npm test` passes; manual SQL test confirms ILIKE on normalized columns matches hamza variants.

### Phase 2 — Authentication
**Goal:** End-to-end signup and login with WhatsApp OTP working in dev (mock) and on a Twilio trial number, with MoH license cross-check live.
**Deliverables:**
- Pages: `app/(public)/signup`, `app/(public)/verify`, `app/(public)/login`.
- API routes: `app/api/signup/check-unique`, `signup/check-license`, `signup/start`, `signup/verify`, `login/start`, `login/verify`, `auth/logout`.
- `app/api/cron/sync-moh/route.ts` — Vercel Cron daily MoH practitioners sync (CKAN datastore_search, paginated upsert into `moh_practitioners`). Protected by `CRON_SECRET`.
- `lib/moh/client.ts` — CKAN API client (`datastore_search`, `datastore_search_sql`) with retry + timeout.
- `lib/moh/match.ts` — `verifyLicense({license_number, hebrew_first, hebrew_family})` returning `{status, registry_first?, registry_family?, registry_specialty_he?}`.
- `lib/otp/{provider,twilio,mock}.ts` — provider interface + Twilio + mock implementations.
- `lib/ratelimit.ts` — in-memory + Upstash Redis client (Upstash free tier).
- Cloudflare Turnstile widget on signup and login forms; server-side verification.
- Pending signup TTL: 15 min; OTP attempts: 5; OTP resends: 3/hour.

**Done when:** A new doctor with a valid license + matching Hebrew name can sign up, receive a real WhatsApp code on a Twilio trial number, verify, and reach `/dashboard`. A signup with a Hebrew name not matching the registry is blocked **before** OTP is sent. A signup with an unknown license is queued for admin review (no `/dashboard` access until approved).

### Phase 3 — Core Features: Search + Directory
**Goal:** Verified doctor can find any other verified doctor and click WhatsApp.
**Deliverables:**
- `app/(auth)/dashboard/page.tsx` — Google-style centered search + specialty filter dropdown.
- `app/api/search/route.ts` — query handler with trigram-indexed ILIKE.
- `components/DoctorCard.tsx` — card layout per spec §15, includes `<WhatsAppButton phone={...} />`.
- `lib/whatsapp.ts` — `buildWhatsAppLink`, `buildPrefilledMessage`.
- Empty / loading / error states for search.
- Specialty multi-select reused on signup form.

**Done when:** Searching "احمد" returns a row whose stored Arabic first name is "أحمد"; clicking the WhatsApp button opens `wa.me/972…?text=…` in a new tab.

### Phase 4 — Profile & Admin
**Goal:** Doctors edit their own data, admins moderate.
**Deliverables:**
- `app/(auth)/profile/page.tsx` + `app/api/profile/route.ts` (PATCH). Editable: Arabic names, Hebrew names, specialties, subspecialty, email, `is_visible`. Locked: `phone_e164`, `license_number`, `is_admin_approved`, `is_active`.
- Phone change flow (post-MVP placeholder): request goes to admin queue.
- `app/(admin)/admin/page.tsx` — list + filter doctors; toggle `is_active`, `is_admin_approved`; merge duplicates (manual SQL link until Phase 5 polish); view `audit_logs`.
- `is_admin` boolean on `doctors` (or separate `admins` table — pick `is_admin` for simplicity); admin RLS policy.
- `app/(public)/privacy/page.tsx` — static Arabic content from spec §25.

**Done when:** Admin user can deactivate a doctor; that doctor disappears from search next request; the doctor edits their visibility and disappears from search; audit log shows both events.

### Phase 5 — Security + Polish
**Goal:** Production-ready: hardened, observable, accessible.
**Deliverables:**
- Rate limits applied to every public API route.
- Account-deletion request endpoint (`/api/profile/delete-request`) → row in `audit_logs` for admin to action.
- Header / footer with logout, profile menu, language note.
- 404 / 500 pages in Arabic.
- Lighthouse pass on mobile (perf ≥ 80, a11y ≥ 95, RTL correct).
- Sentry (free tier) wired for client + server errors.
- README with run/deploy instructions; `docs/runbook.md` for OTP outages and Twilio incidents.
- Manual penetration pass: try to call admin routes as a regular doctor, try to UPDATE another doctor via PostgREST directly (RLS must block), try a missing-Turnstile signup.

**Done when:** All MVP-Done checklist items (§12) pass. Repository tagged `v0.1.0-mvp`.

---

## 5. Detailed Task Breakdown (execution-level, ordered)

> Numbering matches the phase. A senior dev or AI agent should be able to execute each in one sitting.

### Phase 0
0.1. `npx create-next-app@latest jerusalem-doctors --ts --tailwind --app --src-dir=false --import-alias '@/*'`
0.2. Add `dir="rtl"` and `lang="ar"` to root `app/layout.tsx`. Add `font-family` for Arabic (e.g. Noto Naskh Arabic via `next/font/google`).
0.3. Create Supabase project; copy URL + anon + service role keys.
0.4. Create Twilio account; provision trial number; enable WhatsApp sandbox.
0.5. Create Cloudflare Turnstile site; copy site key + secret.
0.6. Add Upstash Redis database (free tier); copy REST URL + token.
0.7. Write `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `lib/supabase/service.ts`.
0.8. Write `app/page.tsx` placeholder + `app/health/route.ts` doing a SELECT 1.
0.9. Push to GitHub; link Vercel; set all env vars on Vercel; verify preview deploy.

### Phase 1
1.1. `supabase init`; configure local dev; add `supabase/migrations/`.
1.2. **Migration 0001:** enable `pg_trgm`, `pgcrypto`. Create `doctors`, `specialties`, `doctor_specialties`, `audit_logs`, `pending_signups`. Add unique indexes on `doctors.phone_e164`, `doctors.license_number`, `doctors.auth_user_id`. Add GIN trigram indexes on `arabic_full_name_normalized`, `arabic_first_name_normalized`, `arabic_family_name_normalized`, `subspecialty_normalized`, `hebrew_full_name`. Add B-tree on `is_active, is_visible, is_phone_verified, is_admin_approved, consent_directory_use`.
1.3. **Migration 0002:** RLS policies — see §6 below.
1.4. **Migration 0003:** seed 28 specialties with Arabic / Hebrew / English / normalized.
1.5. Run `supabase gen types typescript --linked > lib/db/types.ts`.
1.6. Write `lib/normalize/arabic.ts` exactly as in spec §9 + tests covering: each hamza form, ى, ؤ, ئ, tatweel, all 8 diacritics, multi-space, mixed Arabic+Latin, empty string.
1.7. Write `lib/normalize/phone.ts` — accept `0501234567`, `+972501234567`, `972501234567`, `05-012-34567`, `+970...`, return E.164 or throw `InvalidPhoneError`. Use `libphonenumber-js`. Tests: 15+ cases.
1.8. Write `lib/normalize/hebrew.ts` — `normalizeHebrew(s)` strips niqqud (`U+0591`–`U+05C7`), gershayim/geresh (`"`, `'`, `״`, `׳`), collapses whitespace, NFKC-normalizes. Tests: 15+ cases including names with vowel marks, doubled letters, abbreviations (`ד״ר`).
1.9. Write `lib/whatsapp.ts` — `buildWhatsAppLink(e164, prefilledText?)`.
1.10. **Migration 0001 (addendum):** create `moh_practitioners` table — see §6. Includes B-tree on `(hebrew_first_norm, hebrew_family_norm)` and PK on `license_number`.

### Phase 2
2.1. UI: `app/(public)/signup/page.tsx` — consent block (spec §8 verbatim) + form (10 fields) + Turnstile + submit.
2.2. UI: `app/(public)/verify/page.tsx` — 6-digit OTP input, resend button (disabled 60 s), back link.
2.3. UI: `app/(public)/login/page.tsx` — single phone input + Turnstile.
2.4. `app/api/signup/check-unique/route.ts` — POST, normalize phone + license, SELECT, return JSON.
2.5. `app/api/signup/start/route.ts` — POST: validate Turnstile → validate fields → normalize → uniqueness check → INSERT into `pending_signups` with TTL 15 min → call OTP provider → return `{ signup_session_id }`.
2.6. `app/api/signup/verify/route.ts` — POST: load pending → call OTP provider verify → on success: Supabase admin `createUser({phone})`, INSERT doctor with `auth_user_id` linked, `is_phone_verified=true`, INSERT `doctor_specialties`, DELETE pending → set Supabase session cookies.
2.7. `app/api/login/start/route.ts` and `app/api/login/verify/route.ts` — analogous, simpler.
2.8. `app/api/auth/logout/route.ts`.
2.9. `lib/otp/provider.ts` — `interface OTPProvider { send(phone): Promise<string> /*sessionId*/; verify(phone, code): Promise<boolean>; }`.
2.10. `lib/otp/twilio.ts` — Twilio Verify implementation, channel `whatsapp`, fallback `sms`.
2.11. `lib/otp/mock.ts` — accepts any code === `'123456'`.
2.12. `lib/otp/index.ts` — picks based on `process.env.OTP_PROVIDER`.
2.13. `lib/ratelimit.ts` — Upstash sliding window: 5 OTP requests / phone / hour, 5 verify attempts / session, 30 search reqs / user / minute, 10 license-checks / IP / hour.
2.14. `lib/turnstile.ts` — server-side `verify(token)` against Cloudflare API.
2.15. `middleware.ts` — refresh Supabase session, redirect unauthenticated `/dashboard` and `/profile` to `/login`.
2.16. `lib/moh/client.ts` — typed wrapper around `https://data.gov.il/api/3/action/datastore_search` and `datastore_search_sql`. Resource ID lives in `MOH_RESOURCE_ID` env var (default `9c64c522-bbc2-48fe-96fb-3b2a8626f59e`). 10s timeout, 2 retries with backoff.
2.17. `lib/moh/match.ts` — `verifyLicense({license_number, hebrew_first, hebrew_family})`: looks up `moh_practitioners` by `license_number`, compares `normalizeHebrew(input)` to stored `*_norm`. Exact match → `verified`. Levenshtein ≤ 1 or substring → `verified` (log soft-match). License missing → fallback to live `datastore_search_sql` (in case of post-snapshot license issuance), then `not_found` if still missing. Different name → `name_mismatch` with registry name returned.
2.18. `app/api/signup/check-license/route.ts` — POST: rate-limit (10 / IP / hour) → Turnstile verify → call `verifyLicense` → return JSON. Audit log every call (`license_check_passed` / `license_check_failed`, license number only, no PII in metadata beyond outcome).
2.19. `app/api/cron/sync-moh/route.ts` — GET, header check `Authorization: Bearer ${CRON_SECRET}`. Paginate CKAN `datastore_search` in 1000-row chunks; upsert into `moh_practitioners`; record `last_synced_at` somewhere (e.g. `audit_logs` with action `moh_sync_completed`, metadata `{rows_upserted, duration_ms}`). Add `vercel.json` cron schedule `0 3 * * *`.
2.20. Wire `check-license` into `app/(public)/signup/page.tsx` — call after `check-unique`, before submitting full form. On `name_mismatch`, surface registry's spelling and ask user to retype. On `not_found`, show "سيتم مراجعة طلبك من قبل الإدارة قبل تفعيل الحساب" and let signup proceed (admin queue).

### Phase 3
3.1. `app/(auth)/dashboard/page.tsx` — server component reading user from cookie, rendering `<SearchBar/>` + `<SpecialtyFilter/>`.
3.2. `components/SearchBar.tsx` — Client Component, debounced 250 ms, posts to `/api/search`.
3.3. `app/api/search/route.ts` — GET, validate session, normalize `q`, single SQL query joining 3 tables, returns up to 50 rows.
3.4. `components/DoctorCard.tsx` per spec §15.
3.5. `components/WhatsAppButton.tsx` — `<a target=_blank>` with prefilled message from spec §15.
3.6. `components/SpecialtyMultiSelect.tsx` — reused on signup; combobox over `specialties` table.
3.7. Empty-result state with Arabic copy.
3.8. Audit log on every search (actor id + length only).

### Phase 4
4.1. `app/(auth)/profile/page.tsx` — read current doctor by `auth_user_id`, prefill form.
4.2. `app/api/profile/route.ts` — PATCH: whitelist editable columns server-side; reject `phone_e164`, `license_number`, `is_admin_approved`, `is_active` even if sent.
4.3. Add `is_admin boolean default false` to `doctors`. Migration 0004.
4.4. RLS: admin policies allowing SELECT/UPDATE on all rows when `is_admin=true`.
4.5. `app/(admin)/layout.tsx` — server-side guard: 404 if not admin.
4.6. `app/(admin)/admin/page.tsx` — table of doctors (search + filter on `is_admin_approved`, `is_active`).
4.7. `app/api/admin/doctors/[id]/route.ts` — PATCH: toggle moderation flags, write `audit_logs`.
4.8. `app/(admin)/admin/audit/page.tsx` — paginated list of audit events.
4.9. `app/(public)/privacy/page.tsx` — static Arabic content.
4.10. Account-deletion request: `app/api/profile/delete-request/route.ts` → audit log row + `is_visible=false` immediately; admin processes hard delete.

### Phase 5
5.1. Apply `lib/ratelimit.ts` to every public API route.
5.2. Add Sentry SDK (server + client), redact phone numbers.
5.3. Write `docs/runbook.md`: OTP outage (switch to SMS), Twilio account suspended, RLS policy change rollback.
5.4. README: env vars, local dev, migration commands, mock OTP usage.
5.5. Manual security pass (see Phase 5 deliverables).
5.6. Lighthouse pass on /, /signup, /dashboard mobile.
5.7. Tag `v0.1.0-mvp`.

---

## 6. Database Plan

### Final schema (consolidated from spec §16)
```sql
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create table doctors (
  id                          uuid primary key default gen_random_uuid(),
  auth_user_id                uuid unique references auth.users(id) on delete set null,
  phone_e164                  text not null unique,
  phone_display               text,
  arabic_first_name           text not null,
  arabic_family_name          text not null,
  arabic_full_name            text generated always as
                                (arabic_first_name || ' ' || arabic_family_name) stored,
  arabic_first_name_normalized   text not null,
  arabic_family_name_normalized  text not null,
  arabic_full_name_normalized    text not null,
  hebrew_first_name           text not null,
  hebrew_family_name          text not null,
  hebrew_full_name            text generated always as
                                (hebrew_first_name || ' ' || hebrew_family_name) stored,
  license_number              text not null unique,
  subspecialty                text,
  subspecialty_normalized     text,
  email                       text,
  consent_directory_use       boolean not null default false,
  consent_timestamp           timestamptz not null default now(),
  is_phone_verified           boolean not null default false,
  is_active                   boolean not null default true,
  is_visible                  boolean not null default true,
  is_admin_approved           boolean not null default true,  -- flip to false if manual approval is desired
  is_admin                    boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table specialties (
  id                  uuid primary key default gen_random_uuid(),
  name_ar             text not null,
  name_ar_normalized  text not null,
  name_he             text,
  name_en             text,
  sort_order          int default 0,
  is_active           boolean not null default true
);

create table doctor_specialties (
  doctor_id     uuid references doctors(id) on delete cascade,
  specialty_id  uuid references specialties(id) on delete restrict,
  primary key (doctor_id, specialty_id)
);

-- Workplaces (added in migration 0004): main + arbitrary number of others.
-- Partial unique index enforces "at most one primary per doctor".
create table doctor_workplaces (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references doctors(id) on delete cascade,
  name            text not null,
  name_normalized text not null,
  is_primary      boolean not null default false,
  sort_order      int    not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table audit_logs (
  id                uuid primary key default gen_random_uuid(),
  actor_doctor_id   uuid references doctors(id) on delete set null,
  action            text not null,
  target_doctor_id  uuid references doctors(id) on delete set null,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

create table pending_signups (
  id            uuid primary key default gen_random_uuid(),
  phone_e164    text not null,
  payload       jsonb not null,         -- normalized form fields
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  created_at    timestamptz not null default now()
);

-- Mirror of the public Israel MoH doctors registry (data.gov.il).
-- Synced daily by /api/cron/sync-moh. See §13.
create table moh_practitioners (
  license_number          int  primary key,
  hebrew_first_name       text not null,
  hebrew_family_name      text not null,
  hebrew_first_norm       text not null,
  hebrew_family_norm      text not null,
  specialty_name_he       text,            -- nullable; GPs have no specialty cert
  license_issued_yyyymmdd int,             -- raw int from registry, e.g. 25071972
  synced_at               timestamptz not null default now()
);
```

The `doctors` table also gains a column to track license-check outcome:

```sql
alter table doctors
  add column license_verified_at timestamptz,
  add column license_verification_status text
    check (license_verification_status in ('verified', 'soft_match', 'not_found', 'name_mismatch_overridden') );
```

`is_admin_approved` defaults to `true` only when `license_verification_status = 'verified'`; otherwise the signup flow sets it to `false` and lands the doctor in the admin queue.

### Indexes
```sql
create index doctors_arabic_full_norm_trgm
  on doctors using gin (arabic_full_name_normalized gin_trgm_ops);
create index doctors_arabic_first_norm_trgm
  on doctors using gin (arabic_first_name_normalized gin_trgm_ops);
create index doctors_arabic_family_norm_trgm
  on doctors using gin (arabic_family_name_normalized gin_trgm_ops);
create index doctors_subspecialty_norm_trgm
  on doctors using gin (subspecialty_normalized gin_trgm_ops);
create index doctors_hebrew_full_trgm
  on doctors using gin (hebrew_full_name gin_trgm_ops);
create index doctors_visibility
  on doctors (is_active, is_visible, is_phone_verified, is_admin_approved, consent_directory_use);
create index specialties_name_ar_norm_trgm
  on specialties using gin (name_ar_normalized gin_trgm_ops);
create index pending_signups_phone on pending_signups (phone_e164);
create index audit_logs_actor on audit_logs (actor_doctor_id, created_at desc);
create index moh_practitioners_norm
  on moh_practitioners (hebrew_first_norm, hebrew_family_norm);

create unique index doctor_workplaces_one_primary
  on doctor_workplaces (doctor_id) where is_primary;
create index doctor_workplaces_doctor
  on doctor_workplaces (doctor_id, sort_order);
create index doctor_workplaces_name_norm_trgm
  on doctor_workplaces using gin (name_normalized gin_trgm_ops);
```

### RLS strategy
- `doctors`: enable RLS.
  - **SELECT** (regular users): `is_active AND is_visible AND is_phone_verified AND is_admin_approved AND consent_directory_use`.
  - **SELECT own row**: `auth.uid() = auth_user_id` (so users can see their full profile).
  - **UPDATE own row**: `auth.uid() = auth_user_id`. Editable columns enforced in API, not RLS (Postgres column-level grants are too coarse here — the API route whitelists).
  - **Admin SELECT/UPDATE all**: `exists(select 1 from doctors d where d.auth_user_id = auth.uid() and d.is_admin)`.
- `doctor_specialties`: SELECT mirrors doctors visibility via join policy; INSERT/DELETE only by owner or admin.
- `specialties`: SELECT public to authenticated users; INSERT/UPDATE/DELETE admin only.
- `audit_logs`: no policies for users (deny by default); admin SELECT all; INSERTs done via service role from API.
- `pending_signups`: deny all from users; only service role touches it.
- `moh_practitioners`: deny all from users; only service role reads/writes (the cron job and signup license-check route).

### Migration order
1. `0001_init.sql` — extensions + tables (incl. `moh_practitioners`) + constraints + indexes.
2. `0002_rls.sql` — enable RLS, define policies.
3. `0003_seed_specialties.sql` — seed 28 specialties.
4. `0004_admin_flag.sql` (Phase 4) — `is_admin` column + admin policies (or fold into 0002 if we know admins from day one).
5. `0005_license_verification.sql` (Phase 2) — `doctors.license_verified_at`, `doctors.license_verification_status`. Folded into 0001 if we lock §13 in before the first migration apply.
6. `0004_workplaces.sql` (mid-Phase-2 add) — `doctor_workplaces` table + RLS. Required field `main_workplace` on signup, optional unbounded list of others. Searchable via trigram-indexed normalized column; surfaced in Phase 3 dashboard cards and Phase 4 profile editor.

---

## 7. Authentication & OTP Strategy

### Recommended approach (revised — May 2026)
**Skip Twilio entirely. Build the rest of the site behind a dev-user shim, then plug in the direct Meta WhatsApp Cloud API as the last build step before pilot.**

Why the change from the earlier "Twilio first" plan:
- Twilio's all-in cost (number rental + Verify per-attempt + per-message) burns money during development for delivery we don't need yet.
- Twilio's WhatsApp Verify requires bringing your own WhatsApp Business sender (Meta verification, ~1–2 weeks). Same upstream Meta dependency we'd hit for direct Meta — no delivery-time saving.
- Direct Meta has no number rental, no Verify markup; only per-message delivery (~$0.005–$0.03 / Israel auth). Cheapest at any scale.
- The OTP layer is one swappable file (`lib/otp/*` interface), so deferring is risk-free.

### Build-time strategy
| Stage | OTP path | Notes |
|---|---|---|
| **Phase 2 → Phase 4 (development)** | `OTP_PROVIDER=mock` + dev-user shim | No real OTP. `lib/auth/session.ts → getCurrentDoctor()` returns the dev doctor when `USE_DEV_USER=1`. Production deploys keep auth pages but disable submit until Meta is wired (banner). |
| **Last week before pilot** | Add `lib/otp/whatsapp_meta.ts`, flip `OTP_PROVIDER=whatsapp_meta` | Meta Business verification, WABA, sender registration, Arabic auth-template approval. Switch flag, smoke-test, ship. |
| **Production fallback if Meta stalls** | Twilio with SMS channel | Reactivate Supabase Phone Auth → Twilio (creds left in place but disabled). Update Arabic copy from "واتساب" to "رسالة نصية". |

### Direct Meta integration spec (built last)
- Required env: `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` (System User long-lived), `META_VERIFY_TOKEN` (webhook verification), `META_AUTH_TEMPLATE_NAME`.
- Send: `POST https://graph.facebook.com/v21.0/{phone-number-id}/messages` with `type=template`, language `ar`, body parameter = generated code.
- Verify: code stored hashed in `pending_signups.payload.otp_hash` (we own the lifecycle, not Meta).
- Optional: `app/api/webhooks/whatsapp/route.ts` for delivery-status callbacks with `x-hub-signature-256` verification.
- No DB, route, or UI changes — the `OtpProvider` interface (`lib/otp/provider.ts`) already covers it.

### Risks (current strategy)
- **Late integration surfaces bugs.** Mitigation: dev-user shim exercises every auth-protected page through real RLS by issuing a session JWT for the dev doctor (Phase 3 work). Bugs surface at dev time, not pilot time.
- **Meta verification stalls.** Mitigation: Twilio account stays open; SMS fallback is one env-var flip + four `channel: "sms"` lines.
- **Cost runaway under abuse** (any provider). Mitigations: Cloudflare Turnstile on signup/login; per-IP and per-phone rate limits already in place.
- **Phone number recycling.** Out of scope for MVP, documented as known gap.

---

## 8. Search Strategy

### MVP search
- Single endpoint: `GET /api/search?q=...&specialty_id=...`.
- Server normalizes `q` with `normalizeArabic(q)` (same fn used at write time — single source of truth).
- One SQL query:
  ```sql
  select d.id, d.arabic_full_name, d.hebrew_full_name, d.license_number,
         d.phone_display, d.phone_e164, d.subspecialty, d.email,
         array_agg(s.name_ar) as specialties
  from doctors d
  left join doctor_specialties ds on ds.doctor_id = d.id
  left join specialties s on s.id = ds.specialty_id
  where d.is_active and d.is_visible and d.is_phone_verified
    and d.is_admin_approved and d.consent_directory_use
    and (
      d.arabic_full_name_normalized ilike '%' || $1 || '%'
      or d.subspecialty_normalized ilike '%' || $1 || '%'
      or d.hebrew_full_name ilike '%' || $1 || '%'
      or s.name_ar_normalized ilike '%' || $1 || '%'
    )
  group by d.id
  order by d.arabic_full_name
  limit 50;
  ```
- Returns the array shape from spec §18.

### Arabic normalization integration
- **Single utility** at `lib/normalize/arabic.ts`. Imported by:
  - signup form processing (writes `*_normalized` columns)
  - profile update endpoint
  - search endpoint (normalizes the query)
  - migration 0003 (specialty seed normalizes `name_ar` at seed time)
- Tests prove invariants: `normalize("أحمد") === normalize("احمد") === normalize("إحمد")`.

### Performance
- Trigram GIN indexes make `ILIKE '%q%'` index-eligible — directory of < 50k rows answers in single-digit ms.
- Limit 50 results, no pagination in MVP (typical query returns < 10 rows).
- Debounce 250 ms client-side.

### Future upgrade path (post-MVP, do not build)
1. **Ranking**: switch `ILIKE` to `similarity(arabic_full_name_normalized, $1) > 0.3 ORDER BY similarity DESC`.
2. **Typo tolerance**: `pg_trgm.word_similarity` or `levenshtein` from `fuzzystrmatch`.
3. **Sidecar search**: Meilisearch or Typesense if directory ever exceeds ~100k rows or needs faceted filters.

---

## 9. Security Plan

### RLS enforcement
- RLS **on** for every table with personal data (`doctors`, `doctor_specialties`, `audit_logs`, `pending_signups`).
- Default-deny: no policy ⇒ no access. Service role bypasses RLS — used only in server-side API routes, never exposed to browser.
- Anon role gets **zero** policies on `doctors` (public site reads no doctor data, ever).
- Test: every Phase 5 release runs a "RLS smoke test" — a script that hits PostgREST as anon and as a non-admin user, verifying no privileged data leaks.

### API protection
- Every Route Handler:
  1. Verifies session (`createServerClient` → `getUser()`).
  2. Reads rate-limit budget from Upstash.
  3. (Public routes) verifies Turnstile token.
  4. Whitelists request body fields with Zod.
  5. Uses the **user-scoped** Supabase client (RLS applies). Service role only for cross-cutting tasks (creating auth users, writing audit logs, reading pending_signups).

### Rate limiting (Upstash sliding window)
| Route | Limit |
|---|---|
| `/api/signup/start` | 3 / phone / hour, 10 / IP / hour |
| `/api/signup/verify` | 5 / session, 20 / IP / hour |
| `/api/login/start` | 5 / phone / hour, 20 / IP / hour |
| `/api/login/verify` | 5 / session |
| `/api/search` | 30 / user / minute |
| `/api/profile` PATCH | 10 / user / hour |

### Bot protection
- **Cloudflare Turnstile** on `/signup`, `/login`. Server-side verification before any DB write or OTP send.
- Reject any request without a valid Turnstile token at these routes.

### Sensitive data handling
- `audit_logs.metadata` never contains the search query string, OTP code, or phone number — only IDs, lengths, and timestamps.
- Sentry breadcrumbs scrub `phone`, `phone_e164`, `license_number`, `otp_code`, `code` keys.
- HTTPS only (Vercel default).
- Cookies: `httpOnly`, `secure`, `sameSite=lax`.
- No `console.log` of full doctor records in server routes.
- Backups (Supabase automatic) — document retention; ensure deletion requests propagate (eventually; document as known limitation).
- `Content-Security-Policy` header restricting scripts to self + Turnstile + Sentry.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OTP cost runaway from abuse | Medium | High ($) | Turnstile + per-phone + per-IP rate limits; daily Twilio spend cap; alarm on > N OTPs / hour |
| Fake doctor signups (phone verifies, license is fabricated) | High | High (privacy / trust) | **Automated cross-check at signup** against the official MoH registry (data.gov.il, see §13): license number must exist and Hebrew name must match before OTP is sent. Soft-failures (recently issued, name mismatch overridden, no specialty cert) land in admin queue with `is_admin_approved=false`. Pilot stays invitation-only as a second layer. |
| Privacy leak (RLS misconfig, public scrape) | Low | Critical | RLS smoke test in CI; no public endpoints exposing doctor data; audit logs reviewed weekly during pilot |
| Arabic search false negatives (normalization drift) | Medium | High (UX) | Single shared normalizer fn; >30 unit tests; integration test that signs up "أحمد" and finds him via "احمد" |
| Duplicate profiles (same doctor, two phones) | Medium | Medium | Unique on `license_number`; admin merge tool; warn on signup if license matches an existing record (already in spec §11) |
| Twilio template / channel disapproval | Medium | Medium | Ship with SMS as fallback channel from day one; runbook for switching channels |
| Vendor lock-in (Supabase / Vercel / Twilio) | Low | Low | All three are replaceable post-MVP; the data is plain Postgres |
| Legal / regulatory blocker | Medium | Critical | Legal review **before** wider launch; pilot stays under N users; consent text reviewed by counsel |
| Scope creep (ratings, messaging, public pages) | High | High (timeline) | This plan is the contract; any new feature ⇒ new plan, post-MVP |

---

## 11. Timeline

| Phase | Deliverables | Checkpoint |
|---|---|---|---|
| Phase 0 + start Phase 1 | Repo, Vercel preview, Supabase + Twilio + Turnstile + Upstash accounts, RTL layout, normalize utilities + tests | "Hello" page live in Arabic on a Vercel URL; `npm test` green |
| Finish Phase 1 | All migrations, RLS, seed specialties, generated DB types | Migrations apply to a clean Supabase project; manual ILIKE confirms hamza match |
| Phase 2 (signup half) | Signup UI + 3 signup APIs + mock OTP + Turnstile | A real human can sign up locally with mock OTP and land in `/dashboard` |
| Phase 2 (auth polish) + start Phase 3 | Login UI + APIs, Twilio integrated on staging, rate limits, dashboard + search skeleton | Twilio sends a real WA code on staging |
| Finish Phase 3 | Search API, doctor cards, WhatsApp button, specialty filter | Search "احمد" returns "أحمد"; WhatsApp button opens correct chat |
| Phase 4 | Profile page + API, admin panel, privacy page, audit logs UI | Admin deactivates a doctor; doctor disappears from search |
| Phase 5 | Rate-limit hardening, Sentry, CSP, runbook, RLS smoke test, Lighthouse, manual pen pass, tag `v0.1.0-mvp` | All §12 acceptance criteria pass |

**Critical dependencies:**
- Twilio WA template approval (start of week 3 at the latest — can take 1–7 days).
- Supabase project provisioned (week 1).
- Pilot doctor list ready (week 6) for week 7 invite-only smoke test.

**Buffer:** week 8 reserved for legal review, pilot feedback, and any blockers from week 7.

---

## 12. Definition of MVP Done

- [ ] Signup works end-to-end: Arabic-first form → Turnstile → uniqueness check → MoH license cross-check → WhatsApp OTP → verification → dashboard.
- [ ] License cross-check: a signup with `license_number=12345` and Hebrew name "דניאל דריפוס" matches the MoH registry → `verified` → auto-approved. The same license with a different Hebrew name → `name_mismatch` → blocked before OTP. An unknown license → `not_found` → signup proceeds but lands in admin queue (`is_admin_approved=false`, no `/dashboard` access).
- [ ] MoH sync cron runs daily, upserts the full `moh_practitioners` table (~63k rows), records completion in `audit_logs`. Manual trigger via `Authorization: Bearer $CRON_SECRET` works.
- [ ] Duplicate phone returns the spec §11 message and the "go to login" CTA.
- [ ] Duplicate license returns the spec §11 message and the "contact admin" CTA.
- [ ] Login by phone works end-to-end: phone → OTP → dashboard.
- [ ] Login with unknown phone shows the §12 redirect copy.
- [ ] Search box on `/dashboard` finds doctors by Arabic name with hamza variants normalized: searching "احمد" returns "أحمد", "احمد", and "إحمد".
- [ ] Search filters by specialty.
- [ ] Search results show only `is_active && is_visible && is_phone_verified && is_admin_approved && consent_directory_use` doctors.
- [ ] Doctor card shows Arabic name, Hebrew name, license, specialties, subspecialty, **main workplace + any other workplaces**, phone (display format), email, WhatsApp button.
- [ ] WhatsApp button opens `wa.me/<e164-no-plus>?text=<encoded prefilled>` in a new tab.
- [ ] Guests cannot reach `/dashboard`, `/profile`, or any doctor data via URL or API. Confirmed by RLS smoke test.
- [ ] Doctors can update their Arabic / Hebrew name, specialties, subspecialty, email, visibility on `/profile`.
- [ ] Doctors **cannot** change `phone_e164`, `license_number`, `is_admin_approved`, or `is_active` — confirmed both in UI and at the API level.
- [ ] Admin panel lists all doctors, can deactivate / reactivate, can approve / unapprove, can view audit logs.
- [ ] `/privacy` page renders the Arabic privacy text from spec §25.
- [ ] Rate limits live on every public API route.
- [ ] Cloudflare Turnstile gates `/signup` and `/login`.
- [ ] All migrations versioned in `supabase/migrations/`.
- [ ] All tests passing: `lib/normalize/arabic.ts`, `lib/normalize/phone.ts`, integration test for signup → search round-trip.
- [ ] Sentry receives a synthetic test error from prod build.
- [ ] README + runbook checked in.
- [ ] Repo tagged `v0.1.0-mvp`.

---

## 13. License Verification (Israel MoH Registry)

### What we cross-check
Every signup is gated on the **Israel Ministry of Health doctors registry** before any OTP is sent. The registry is a public, open-licensed dataset published on data.gov.il and updated monthly.

- **Dataset:** מאגר רישיונות רופאים משרד הבריאות (Database of Doctors Licenses — Ministry of Health).
- **Resource ID:** `9c64c522-bbc2-48fe-96fb-3b2a8626f59e` (kept in `MOH_RESOURCE_ID` env var so we can swap if Israel re-publishes).
- **Volume:** ~63,000 rows.
- **License:** "אחר (פתוח)" — open.
- **Disclaimer (from MoH):** the registry "should not be regarded as an official document; for legal purposes, verify directly with the Department for Licensing of Medical Professions". We use it for access gating, not legal attestation.

### Fields used
| Hebrew field | Type | Used as |
|---|---|---|
| `מספר רישיון רופא` | numeric | License number (PK lookup) |
| `שם פרטי` | text | Hebrew first name |
| `שם משפחה` | text | Hebrew family name |
| `שם התמחות` | text, nullable | Specialty (Hebrew). Nullable for GPs without specialty cert |
| `תאריך רישום רישיון` | numeric (ddmmyyyy) | Stored for admin context |

We ignore `מספר תעודת התמחות` and `תאריך רישום התמחות` for MVP.

### Recommended approach: nightly sync + on-signup local lookup

Don't hit data.gov.il in the signup hot path — it's a third party with no SLA. Mirror it nightly.

#### 1. Daily sync
- Vercel Cron at `0 3 * * *` UTC → `GET /api/cron/sync-moh` (route handler).
- Authorization via `Authorization: Bearer ${CRON_SECRET}` header.
- Calls `https://data.gov.il/api/3/action/datastore_search?resource_id=${MOH_RESOURCE_ID}&limit=1000&offset=N` repeatedly until `result.records.length < limit`.
- For each row: build `hebrew_first_norm` and `hebrew_family_norm` via `normalizeHebrew()`, then upsert into `moh_practitioners` keyed on `license_number`.
- Records sync stats in `audit_logs` (`action='moh_sync_completed'`, `metadata={rows_upserted, duration_ms}`).
- Soft-failure: if CKAN is down, the cron logs and exits non-fatally; the previous snapshot stays valid.

#### 2. On-signup check
`POST /api/signup/check-license` is called from the signup form **after `check-unique`** and **before submitting the full form**. Body:

```json
{ "license_number": 12345, "hebrew_first_name": "דניאל", "hebrew_family_name": "דריפוס" }
```

Logic:

```ts
const row = await db.from('moh_practitioners')
  .select('*').eq('license_number', license_number).single();

if (!row) {
  // Fall back to live CKAN — handles licenses issued after last snapshot.
  const liveRow = await mohClient.searchByLicense(license_number);
  if (!liveRow) return { status: 'not_found' };
  // Treat live hit as if synced — proceed with comparison.
  ...
}

const inFirst  = normalizeHebrew(hebrew_first_name);
const inFamily = normalizeHebrew(hebrew_family_name);

if (inFirst === row.hebrew_first_norm && inFamily === row.hebrew_family_norm) {
  return { status: 'verified', registry_specialty_he: row.specialty_name_he };
}

// Soft-match: tolerate 1 edit distance per field, or substring match
// (handles דוד / דויד, abbreviations, hyphenation differences).
if (closeEnough(inFirst, row.hebrew_first_norm)
    && closeEnough(inFamily, row.hebrew_family_norm)) {
  return { status: 'soft_match',
           registry_first: row.hebrew_first_name,
           registry_family: row.hebrew_family_name };
}

return { status: 'name_mismatch',
         registry_first: row.hebrew_first_name,
         registry_family: row.hebrew_family_name };
```

#### 3. UX outcomes (Arabic copy)

| Status | UX | Account state |
|---|---|---|
| `verified` | Proceed silently to `/signup/start` | `is_admin_approved=true`, `license_verification_status='verified'` |
| `soft_match` | Show registry's spelling: "اسمك في سجل وزارة الصحة هو **{registry_first} {registry_family}**. هل هذا أنت؟" with [نعم / لا]. On "yes": proceed; status `soft_match` → admin queue (`is_admin_approved=false`) | Auto-approved after admin click |
| `name_mismatch` | "الاسم العبري الذي أدخلته لا يطابق رقم الترخيص في سجل وزارة الصحة. الرجاء إدخال الاسم تمامًا كما يظهر على الرخصة." Block submit. | No account created |
| `not_found` | "رقم الترخيص غير موجود في النسخة الحالية من سجل وزارة الصحة. يمكنك المتابعة، وسيتم مراجعة طلبك من قبل الإدارة قبل تفعيل الحساب." Allow signup with admin queue. | `is_admin_approved=false`, `license_verification_status='not_found'` |

### Hebrew normalization rules (`lib/normalize/hebrew.ts`)
```ts
export function normalizeHebrew(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '') // niqqud, cantillation marks, dagesh, etc.
    .replace(/["'״׳]/g, '')          // gershayim and geresh (handles ד״ר etc.)
    .replace(/\s+/g, ' ')
    .trim();
}
```

`closeEnough(a, b)`: exact match, or one of (`a` is substring of `b`, `b` is substring of `a`, Levenshtein distance ≤ 1). Keep this conservative; bias toward admin review on ambiguity.

### Specialty cross-check (soft, non-blocking)
At signup, after license-check passes, server compares the registry's `specialty_name_he` to each selected specialty's `name_he` in our `specialties` seed. On mismatch, set `is_admin_approved=false` with `license_verification_status='soft_match'`. Doctors with no `specialty_name_he` (general practitioners) can still pick "الطب العام" / "طب العائلة" without warning; warn for any subspecialty selection.

### Edge cases
- **Recently licensed doctor (post-snapshot):** the live CKAN fallback handles this. If CKAN is also slow to publish, admin queue catches it.
- **Name change (marriage, transliteration variant):** `name_mismatch` shows the registry name; user can override and submit, which routes to admin queue.
- **License number formatting:** registry stores `מספר רישיון רופא` as `numeric`. Our user input is text; coerce both sides to integer (strip leading zeros) before comparison. Reject non-numeric input client-side.
- **Hebrew RTL rendering:** the form's Hebrew name fields must render LTR-in-RTL correctly; use `dir="auto"` on the `<input>` so the user sees what they type.
- **Cron failure:** the daily snapshot is idempotent and ~3 MB; missing one day is harmless because every signup falls back to live CKAN on miss. Alarm if `audit_logs` shows no `moh_sync_completed` for > 48 h.

### Privacy & data hygiene
- `moh_practitioners` is a mirror of public open data — no privacy escalation.
- We do **not** publish or expose `moh_practitioners` to clients; RLS denies all user access.
- We do **not** store the registry copy of any doctor's license date in the `doctors` table — the doctor's authoritative record is what they entered themselves; the registry is consulted only at verification time.
- License-check audit logs record only license number and outcome — not the doctor's name input or registry response body.

### Env vars
```
CRON_SECRET=<random, set in Vercel and used by cron route>
MOH_RESOURCE_ID=9c64c522-bbc2-48fe-96fb-3b2a8626f59e
MOH_API_BASE=https://data.gov.il/api/3
```

### Open decisions
- **Seed the registry on first deploy** vs wait for first cron tick? Seed: run the cron once manually after the first migration apply. Saves a day of "everyone is in admin queue" pain.
- **Block `not_found` outright** vs admin queue? Plan recommends queue. Flip if pilot reveals abuse.
- **Tighten `closeEnough`** if false-positives appear (real attackers passing soft-match). Start permissive, tighten on telemetry.
