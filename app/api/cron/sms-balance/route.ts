// GET /api/cron/sms-balance — prepaid SMS balance watch.
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}`, same as sync-moh.
// Vercel Cron sends it automatically per vercel.json.
//
// Why this exists: the SMS4FREE account is prepaid. When it empties, every
// send comes back status -4, signup and login stop working completely, and
// there is nothing on the doctor's screen to suggest why. Discovering that
// from a support message is too late, so we check daily and shout early.

import * as Sentry from "@sentry/nextjs";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { fetchAvailableSms } from "@/lib/otp/sms4free";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Alert below this many remaining messages. */
const DEFAULT_THRESHOLD = 50;

export const GET = withJsonErrors(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return jsonError(500, { error: "cron_unconfigured" });
    }
    // dev: allow without secret so it can be triggered locally for testing
  } else {
    const authz = req.headers.get("authorization");
    if (authz !== `Bearer ${secret}`) {
      return jsonError(401, { error: "unauthorized" });
    }
  }

  // Nothing to watch if delivery has been rolled back to another provider.
  const provider = (process.env.OTP_PROVIDER ?? "").trim().toLowerCase();
  if (provider && provider !== "sms4free") {
    return jsonOk({ ok: true, skipped: true, provider });
  }

  const threshold = Number(
    process.env.SMS4FREE_LOW_BALANCE_THRESHOLD ?? DEFAULT_THRESHOLD,
  );

  let balance: number;
  try {
    balance = await fetchAvailableSms();
  } catch (err) {
    // A failing balance check is itself worth knowing about — it usually
    // means the credentials broke, which means sends are failing too.
    console.error("[cron/sms-balance] check failed:", (err as Error)?.message);
    Sentry.captureException(err);
    return jsonError(502, { error: "balance_check_failed" });
  }

  const low = balance < threshold;
  if (low) {
    // Log as well as report: Sentry no-ops without a DSN, and this is exactly
    // the signal we cannot afford to lose.
    console.error(
      `[cron/sms-balance] LOW BALANCE: ${balance} messages left (threshold ${threshold})`,
    );
    Sentry.captureMessage(
      `SMS4FREE balance low: ${balance} messages remaining`,
      balance === 0 ? "error" : "warning",
    );
  }

  return jsonOk({ ok: true, balance, threshold, low });
});
