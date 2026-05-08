// OTP provider interface — see plan §7. Twilio for prod, mock for dev,
// Meta WhatsApp Cloud API later (single new file, no callsite changes).
//
// Each implementation is responsible for delivering and verifying a code.
// We intentionally do NOT keep a side-channel store of the code in our DB
// for the Twilio path — Twilio Verify owns that. The mock path also keeps
// nothing on our side; it accepts a fixed code.
//
// Channels: WhatsApp by default, SMS as a fallback when WA template is
// blocked. Implementations decide; callers don't need to know.

export type OtpChannel = "whatsapp" | "sms";

export interface OtpSendResult {
  /** Provider-specific reference. Returned to the client opaquely. */
  sessionRef: string;
  /** Channel actually used (may differ from requested if failover happened). */
  channel: OtpChannel;
}

export interface OtpProvider {
  readonly name: string;
  send(phoneE164: string, channel?: OtpChannel): Promise<OtpSendResult>;
  verify(phoneE164: string, code: string): Promise<boolean>;
}

export class OtpProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OtpProviderError";
  }
}
