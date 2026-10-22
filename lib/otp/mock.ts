import type { OtpSendResult, OtpSender } from "./provider";

/**
 * Dev-only sender. Logs the real code to stderr instead of sending it, so
 * local signup/login work without spending SMS credit. Refuses to run in
 * production.
 */
export class MockOtpSender implements OtpSender {
  readonly name = "mock";

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "MockOtpSender cannot be used in production. Set OTP_PROVIDER=sms4free.",
      );
    }
  }

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    // stderr so it shows up in `next dev` output and is never mistaken for a
    // real delivery channel.
    // One line per code, whatever the values hold.
    const oneLine = (v: string) => v.replace(/[\r\n]/g, " ");
    console.error(`[mock-otp] code ${oneLine(code)} for ${oneLine(phoneE164)} (not sent)`);
    return { messageRef: `mock:${phoneE164}` };
  }
}
