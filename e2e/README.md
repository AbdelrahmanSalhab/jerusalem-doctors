# Integration and browser tests

Playwright, against the real production build, a local Supabase built from
`supabase/migrations`, and a local Redis for rate limits. CI runs the same
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

## Browser diagnostics

Every browser test records console errors and warnings, page errors, failed
requests and 4xx/5xx responses. An unexpected error fails the test; after the
run `e2e/.results/diagnostics.md` (and the CI job summary) lists everything
unexpected, plus the app server's warnings. Known noise is listed with a
reason in `EXPECTED` in `fixtures.ts`.

## Adding an API route

`api/authz.spec.ts` fails until the new route is added to `POLICY` with who
may call it.
