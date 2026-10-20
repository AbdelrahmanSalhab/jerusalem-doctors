// Admin authorization for API routes.
//
// requireAdmin() calls notFound(), which is right for a page and wrong for a
// route handler: a JSON caller needs a status it can read. Null means "not an
// admin" (answer 401); a failed lookup still throws, so an outage is a 500
// and never reads as an auth problem.

import { getCurrentAdmin } from "./session";

export const requireAdminOrNull = getCurrentAdmin;
