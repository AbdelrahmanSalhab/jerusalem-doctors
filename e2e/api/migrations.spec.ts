// Every migration records itself (supabase/migrations/README.md): the test
// database, built from all of them, must have recorded exactly the repo's
// files. The production smoke check runs the same comparison live.

import { expect, test } from "../fixtures";
import { stateFile } from "../helpers";
import { repoMigrations } from "../migrations";

test.use({ storageState: stateFile("admin") });

test("the database records every migration it ran, and only those", async ({ request }) => {
  const res = await request.get("/api/admin/migrations");
  expect(res.status()).toBe(200);
  const { applied } = await res.json();
  expect(applied).toEqual(repoMigrations());
});
