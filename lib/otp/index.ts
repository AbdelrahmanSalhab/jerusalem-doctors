import { MockOtpSender } from "./mock";
import type { OtpSender } from "./provider";
import { WhatsAppMetaOtpSender } from "./whatsapp_meta";

let cached: OtpSender | null = null;

/**
 * Resolve the OTP sender once per process. `OTP_PROVIDER` picks the
 * implementation; production defaults to Meta, everything else to mock.
 */
export function getOtpSender(): OtpSender {
  if (cached) return cached;

  const isProd = process.env.NODE_ENV === "production";
  const choice = (
    process.env.OTP_PROVIDER ?? (isProd ? "whatsapp_meta" : "mock")
  )
    .trim()
    .toLowerCase();

  switch (choice) {
    case "mock":
      cached = new MockOtpSender();
      return cached;
    case "whatsapp_meta":
      cached = new WhatsAppMetaOtpSender();
      return cached;
    default:
      throw new Error(
        `Unknown OTP_PROVIDER "${choice}". Expected "mock" or "whatsapp_meta".`,
      );
  }
}

/** Reset the cached sender — used by tests. */
export function __resetOtpSenderForTests(): void {
  cached = null;
}

export type { OtpSendResult, OtpSender } from "./provider";
export { OtpProviderError } from "./provider";
