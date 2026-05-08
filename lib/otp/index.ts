import { MockOtpProvider } from "./mock";
import type { OtpProvider } from "./provider";
import { TwilioOtpProvider } from "./twilio";

let cached: OtpProvider | null = null;

/**
 * Resolve the OTP provider once per process. `OTP_PROVIDER` env picks the
 * implementation; default is `mock` outside production. Production startup
 * fails loudly if `mock` is set there.
 */
export function getOtpProvider(): OtpProvider {
  if (cached) return cached;

  const isProd = process.env.NODE_ENV === "production";
  const choice = (process.env.OTP_PROVIDER ?? (isProd ? "twilio" : "mock"))
    .trim()
    .toLowerCase();

  switch (choice) {
    case "mock":
      cached = new MockOtpProvider();
      return cached;
    case "twilio":
      cached = new TwilioOtpProvider();
      return cached;
    default:
      throw new Error(
        `Unknown OTP_PROVIDER "${choice}". Expected "mock" or "twilio".`,
      );
  }
}

/** Reset the cached provider — used by tests. */
export function __resetOtpProviderForTests(): void {
  cached = null;
}

export type { OtpChannel, OtpProvider, OtpSendResult } from "./provider";
export { OtpProviderError } from "./provider";
