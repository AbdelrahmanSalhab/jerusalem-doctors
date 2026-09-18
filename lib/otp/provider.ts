// OTP sender interface.
//
// Supabase Auth owns the OTP lifecycle — it generates the code, stores it,
// enforces expiry, and verifies it on /verify. Our only job is delivery: the
// Send SMS Hook hands us a phone and a code, and an implementation of this
// interface puts it in front of the doctor.
//
// That is why there is no verify() here and no code storage on our side.

export interface OtpSendResult {
  /** Provider-specific message reference, for log correlation. */
  messageRef: string;
}

export interface OtpSender {
  readonly name: string;
  send(phoneE164: string, code: string): Promise<OtpSendResult>;
}

export class OtpProviderError extends Error {
  constructor(
    message: string,
    /** True when the failure is a config/permanent error, not worth retrying. */
    public readonly permanent: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OtpProviderError";
  }
}
