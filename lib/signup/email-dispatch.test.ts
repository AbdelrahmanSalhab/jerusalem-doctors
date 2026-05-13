import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchSignupVerifyEmail } from "./email-dispatch";

const ORIGINAL_FETCH = globalThis.fetch;

describe("dispatchSignupVerifyEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "noreply@example.com";
    process.env.RESEND_BASE_URL = "https://example.test";
    process.env.SIGNUP_TOKEN_SECRET = "secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("posts an email containing a verify URL with a valid token", async () => {
    const captured: { url?: string; body?: string } = {};
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured.url = url;
      captured.body = init.body as string;
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await dispatchSignupVerifyEmail({
      doctorId: "00000000-0000-0000-0000-000000000001",
      email: "dr@hadassah.org.il",
      arabicFirstName: "نور",
    });

    expect(captured.url).toBe("https://example.test/emails");
    const body = JSON.parse(captured.body!);
    const html = body.html as string;
    expect(html).toContain("https://app.example/api/signup/email-verify?token=");
    // The token should round-trip through verifyEmailToken.
    const match = html.match(/token=([A-Za-z0-9_\-.]+)/);
    expect(match).toBeTruthy();
    const { verifyEmailToken } = await import("./email-token");
    const r = verifyEmailToken(match![1]!);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    }
  });
});
