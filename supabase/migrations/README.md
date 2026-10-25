# Database migrations

Each `.sql` file is one change to the database, applied in file-name order.
CI builds a fresh database from all of them on every PR (the `e2e` job), and
production gets each one by hand in the Supabase SQL Editor.

## Adding one

```bash
npx supabase migration new short_name_of_the_change
```

This names the file by date and time (`20261020114059_short_name_of_the_change.sql`),
so two people working at once never pick the same number. `0001` to `0020`
keep their old names; the dated ones sort after them.

Then:

1. Start the file with a comment saying what it changes and why.
2. Make it safe to run twice (`create or replace`, `if not exists`).
3. Run it in the Supabase SQL Editor **before** deploying code that needs it,
   and say so in the PR.
4. End it by recording itself, so production's record of what it ran
   (`applied_migrations`) stays complete:

   ```sql
   insert into public.applied_migrations (name) values ('20261020114059_short_name_of_the_change') on conflict do nothing;
   ```

   The name is the file's, without `.sql`. `lib/migrations.test.ts` fails
   without it, and after each deploy the production smoke check lists any
   file production has not run.
5. With the local stack up (`npx supabase db reset` applies it), run
   `npm run db:types` and commit `lib/db/database.types.ts`. CI fails while
   that file and the migrations disagree.

`lib/migrations.test.ts` fails if two files share a number.
