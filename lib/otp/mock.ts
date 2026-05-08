import type { OtpChannel, OtpProvider, OtpSendResult } from "./provider";

const FIXED_CODE = "123456";

/**
 * Dev-only OTP provider. Logs the (would-be) code to stderr and accepts
 * `123456` for any phone. Refuses to instantiate in production.
 */
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock";

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "MockOtpProvider cannot be used in production. Set OTP_PROVIDER=twilio.",
      );
    }
  }

  async send(
    phoneE164: string,
    channel: OtpChannel = "whatsapp",
  ): Promise<OtpSendResult> {
    // Use stderr so it's visible in `next dev` output but never confused
    // with a real OTP delivery side-channel.
    console.error(
      `[mock-otp] would send code ${FIXED_CODE} to ${phoneE164} via ${channel}`,
    );
    return { sessionRef: `mock:${phoneE164}:${Date.now()}`, channel };
  }

  async verify(_phoneE164: string, code: string): Promise<boolean> {
    return code === FIXED_CODE;
  }
}

export const MOCK_OTP_CODE = FIXED_CODE;
