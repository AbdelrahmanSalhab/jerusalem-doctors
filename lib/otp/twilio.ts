import {
  type OtpChannel,
  type OtpProvider,
  type OtpSendResult,
  OtpProviderError,
} from "./provider";

/**
 * Twilio Verify provider — delivers a code via WhatsApp (or SMS fallback)
 * and verifies it. Twilio owns the code, expiry, and brute-force protection.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_VERIFY_SERVICE_SID
 */
export class TwilioOtpProvider implements OtpProvider {
  readonly name = "twilio";
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly verifyServiceSid: string;

  constructor() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const verify = process.env.TWILIO_VERIFY_SERVICE_SID;
    if (!sid || !token || !verify) {
      throw new OtpProviderError(
        "TwilioOtpProvider missing env: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID",
      );
    }
    this.accountSid = sid;
    this.authToken = token;
    this.verifyServiceSid = verify;
  }

  private get baseUrl(): string {
    return `https://verify.twilio.com/v2/Services/${this.verifyServiceSid}`;
  }

  private get auth(): string {
    return Buffer.from(`${this.accountSid}:${this.authToken}`).toString(
      "base64",
    );
  }

  async send(
    phoneE164: string,
    channel: OtpChannel = "whatsapp",
  ): Promise<OtpSendResult> {
    const body = new URLSearchParams({ To: phoneE164, Channel: channel });
    const res = await fetch(`${this.baseUrl}/Verifications`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new OtpProviderError(
        `Twilio verification create failed (${res.status}): ${text}`,
      );
    }
    const json = (await res.json()) as { sid: string; channel: OtpChannel };
    return { sessionRef: json.sid, channel: json.channel ?? channel };
  }

  async verify(phoneE164: string, code: string): Promise<boolean> {
    const body = new URLSearchParams({ To: phoneE164, Code: code });
    const res = await fetch(`${this.baseUrl}/VerificationCheck`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      // 404 here means the verification expired or never existed — treat as
      // invalid. Other non-2xx codes are unexpected.
      if (res.status === 404) return false;
      const text = await res.text();
      throw new OtpProviderError(
        `Twilio verification check failed (${res.status}): ${text}`,
      );
    }
    const json = (await res.json()) as { status: string };
    return json.status === "approved";
  }
}
