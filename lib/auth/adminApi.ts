// Admin authorization for API routes.
//
// requireAdmin() calls notFound(), which is right for a page and wrong for a
// route handler: a JSON caller needs a status it can read. This turns it into
// a nullable check so a route can answer 401.

import { requireAdmin } from "./session";

export async function requireAdminOrNull() {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}
