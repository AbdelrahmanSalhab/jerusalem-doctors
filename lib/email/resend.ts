// Minimal Resend client. One call: POST /emails. Tokens, batching, replies,
// and attachments are out of scope.
//
// Dev convenience: when RESEND_API_KEY is unset and NODE_ENV is not "production",
// the client logs the email to stdout and returns a synthetic message id.
// This covers development, test, staging, preview, and any unset NODE_ENV.
// Production fail-closed: throws if key is missing.

const DEFAULT_BASE_URL = "https://api.resend.com";

export class ResendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional Resend Idempotency-Key. We pass it through verbatim. */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  id: string;
}

export class ResendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env.RESEND_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM ?? "Jerusalem Doctors <noreply@example.com>";

    if (!apiKey) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("RESEND_API_KEY is required in production");
      }
      // Log in all non-production environments (dev, test, staging, preview,
      // unset) so engineers can see the email without a real key.
      console.log("[email:dev]", {
        to: input.to,
        subject: input.subject,
        textPreview: input.text.slice(0, 200),
      });
      return { id: `dev-${Date.now()}` };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    const res = await this.fetchImpl(`${this.baseUrl}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      throw new ResendError(
        `Resend returned HTTP ${res.status}`,
        res.status,
        body,
      );
    }
    const id =
      body && typeof body === "object" && "id" in body
        ? String((body as { id: unknown }).id)
        : "";
    if (!id) {
      throw new ResendError(
        "Resend did not return a message id",
        res.status,
        body,
      );
    }
    return { id };
  }
}
