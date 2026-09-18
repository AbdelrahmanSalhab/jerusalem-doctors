import {
  type OtpSendResult,
  type OtpSender,
  OtpProviderError,
} from "./provider";

const GRAPH_VERSION = "v21.0";

// Supabase's Send SMS Hook gives us a 5s budget before it times out and
// retries. Bail at 4s so we return a real status code instead of being cut off.
const SEND_TIMEOUT_MS = 4_000;

type MetaError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

/**
 * Build the Cloud API request body for an authentication template.
 *
 * The code appears twice on purpose: once in the body, once as the parameter
 * of the copy-code button. Meta requires both for AUTHENTICATION templates —
 * omitting the button component gets you a 132000 parameter-count mismatch.
 *
 * Exported separately so it can be unit-tested without a network call.
 */
export function buildAuthTemplatePayload(
  phoneE164: string,
  code: string,
  templateName: string,
  languageCode = "ar",
) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    // Meta wants the number without a leading +.
    to: phoneE164.replace(/^\+/, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }],
        },
      ],
    },
  };
}

/**
 * Direct Meta WhatsApp Cloud API sender.
 *
 * Required env vars:
 *   META_PHONE_NUMBER_ID     — from App > WhatsApp > API Setup (not the number)
 *   META_ACCESS_TOKEN        — permanent System User token
 *   META_AUTH_TEMPLATE_NAME  — approved AUTHENTICATION template, e.g. otp_login_ar
 */
export class WhatsAppMetaOtpSender implements OtpSender {
  readonly name = "whatsapp_meta";
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly templateName: string;
  private readonly languageCode: string;

  constructor() {
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    const templateName = process.env.META_AUTH_TEMPLATE_NAME;
    if (!phoneNumberId || !accessToken || !templateName) {
      throw new OtpProviderError(
        "WhatsAppMetaOtpSender missing env: META_PHONE_NUMBER_ID / META_ACCESS_TOKEN / META_AUTH_TEMPLATE_NAME",
        true,
      );
    }
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    this.templateName = templateName;
    this.languageCode = process.env.META_AUTH_TEMPLATE_LANG ?? "ar";
  }

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`;
    const payload = buildAuthTemplatePayload(
      phoneE164,
      code,
      this.templateName,
      this.languageCode,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or timeout — transient, worth a retry.
      throw new OtpProviderError("Meta send failed: network error", false, err);
    }

    if (!res.ok) {
      // Never include the response body verbatim beyond Meta's own error
      // fields — and never the code, which is not echoed back anyway.
      let detail = "";
      let metaCode: number | undefined;
      try {
        const body = (await res.json()) as MetaError;
        metaCode = body.error?.code;
        detail = `${metaCode ?? "?"}: ${body.error?.message ?? "unknown"}`;
      } catch {
        detail = `status ${res.status}`;
      }
      // 4xx from Meta is a config problem (bad template name, expired token,
      // recipient not whitelisted on a test number). Retrying 3x won't help.
      const permanent = res.status >= 400 && res.status < 500;
      throw new OtpProviderError(
        `Meta send failed (${res.status}) ${detail}`,
        permanent,
      );
    }

    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { messageRef: json.messages?.[0]?.id ?? "" };
  }
}
