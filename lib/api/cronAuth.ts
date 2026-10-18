// Shared auth for the Vercel Cron routes: header
// `Authorization: Bearer ${CRON_SECRET}`, which Vercel Cron sends
// automatically when configured in vercel.json.

import { timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/respond";

/** Null when the request may run; otherwise the response to return. */
export function verifyCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return jsonError(500, { error: "cron_unconfigured" });
    }
    // dev: allow without secret so it can be triggered locally for testing
    return null;
  }

  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  // timingSafeEqual throws on a length mismatch; the length itself is not
  // the secret, so checking it first leaks nothing useful.
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return jsonError(401, { error: "unauthorized" });
  }
  return null;
}
