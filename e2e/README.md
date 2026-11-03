# Integration and browser tests

Playwright, against the real production build, a local Supabase built from
`supabase/migrations`, and a local Redis for rate limits, and `stubs.mjs` standing in for data.gov.il and
SMS4FREE. CI runs the same
thing in the `e2e` job.

## Run locally

Needs Docker and Node 22.

```bash
npm run e2e:stack   # Supabase (migrations from zero) + Redis
npm run e2e         # builds the app, seeds, runs everything
npx playwright test --project=desktop e2e/ui/directory.spec.ts   # one file
npx playwright show-report e2e/.report                         # after a CI-style run
```

Every run reseeds the local database (`e2e/seed.ts`), so it never touches
production. `npx supabase stop` and `docker compose -p jd-e2e down` stop the stack.

## Layout

| Folder | What it checks |
|---|---|
| `db/` | Row-level security on every table, and the database functions |
| `api/` | The permission table: every API route as every kind of user |
| `ui/` | User journeys; tests tagged `@phone` also run at iPhone size (WebKit in CI) |
| `smoke/` | Read-only checks against production (`.github/workflows/smoke.yml`): pages and security headers, the SMS hook and cron not blocked by the firewall, an admin sign-in and search, the nightly registry sync; Lighthouse on public pages after each deploy |

## One sign-up test needs Docker to reach the app

Supabase Auth sends codes through the app's own Send SMS hook
(`http://host.docker.internal:3123/...`, `supabase/config.toml`). The three
numbers in `[auth.sms.test_otp]` never call it, which is what the sign-up tests
use. `a new code cancels the old one` uses an ordinary number, so it needs the
real hook.

- **CI** (Docker on Linux): `host.docker.internal` is the host, and it passes.
- **Docker Desktop on Windows, app in WSL:** `host.docker.internal` is the
  Windows host, which has no route to a server inside WSL. Auth's log says
  `dial tcp 192.168.65.254:3123: connect: connection refused`, and the test used
  to fail on every local run (#180). It now skips itself, saying so, when a probe
  from the Auth container (`authReachesApp()` in `helpers.ts`) cannot reach the
  app. To run it locally, make the app reachable from Docker's side (WSL's
  mirrored networking mode, `networkingMode=mirrored` in `.wslconfig`, is the
  likely way; not tried here).

## Browser diagnostics

Every browser test records console errors and warnings, page errors, failed
requests and 4xx/5xx responses. An unexpected error fails the test; after the
run `e2e/.results/diagnostics.md` (and the CI job summary) lists everything
unexpected, plus the app server's warnings. Known noise is listed with a
reason in `EXPECTED` in `fixtures.ts`.

## Writing a test

- **Find things the way a person does:** `getByRole`, `getByLabel`,
  `getByPlaceholder`, `getByText`. CSS only where there is no accessible handle,
  with a comment saying why.
- **Wait on what the user waits on:** web-first assertions (`await expect(...)`),
  never `waitForTimeout`. Start `waitForResponse` before the action that
  triggers it.
- **Own the data you change:** `createDoctor()` in `seed.ts` makes a doctor for
  one test and `remove()` cleans it up, so a retry starts from the same place.
  The seeded doctors are read-only by convention.
- **Rate limits remember:** the limiter also caches blocked callers in the
  server's memory, so a test that trips one uses its own identity.
- `no-floating-promises` is on for `e2e/`: an un-awaited step is a race.
- Before pushing a new test: `npx playwright test <file> --repeat-each=3`.

## Adding an API route

`api/authz.spec.ts` fails until the new route is added to `POLICY` with who
may call it.

## The second factor with ADMIN_MFA=1

CI runs the server with `ADMIN_MFA` off: with it on, the shared admin sessions
(password sign-ins) cannot reach `/admin`. `e2e/ui/mfa-enforced.spec.ts` covers
the enforced behaviour with real Supabase tokens (a password session without a
factor cannot enrol, a reset window lets it, `/admin` asks for the code) and
skips itself unless the server has the flag. Run it alone, before turning the
flag on in production:

```
E2E_ADMIN_MFA=1 npx playwright test --project=desktop --no-deps e2e/ui/mfa-enforced.spec.ts
```
