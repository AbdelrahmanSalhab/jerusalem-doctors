import { MockOtpSender } from "./mock";
import type { OtpSender } from "./provider";
import { Sms4FreeOtpSender } from "./sms4free";
import { WhatsAppMetaOtpSender } from "./whatsapp_meta";

let cached: OtpSender | null = null;

/**
 * Resolve the OTP sender once per process. `OTP_PROVIDER` picks the
 * implementation; production defaults to SMS4FREE, everything else to mock.
 *
 * `whatsapp_meta` is kept wired but unused: it works, and it is blocked only
 * on Meta Business Verification. Leaving it registered makes a rollback one
 * environment variable rather than a revert.
 */
export function getOtpSender(): OtpSender {
  if (cached) return cached;

  const isProd = process.env.NODE_ENV === "production";
  const choice = (
    process.env.OTP_PROVIDER ?? (isProd ? "sms4free" : "mock")
  )
    .trim()
    .toLowerCase();

  switch (choice) {
    case "mock":
      cached = new MockOtpSender();
      return cached;
    case "sms4free":
      cached = new Sms4FreeOtpSender();
      return cached;
    case "whatsapp_meta":
      cached = new WhatsAppMetaOtpSender();
      return cached;
    default:
      throw new Error(
        `Unknown OTP_PROVIDER "${choice}". Expected "mock", "sms4free" or "whatsapp_meta".`,
      );
  }
}

/** Reset the cached sender — used by tests. */
export function __resetOtpSenderForTests(): void {
  cached = null;
}

export type { OtpSendResult, OtpSender } from "./provider";
export { OtpProviderError } from "./provider";
