import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResendClient, ResendError } from "./resend";

const ORIGINAL_FETCH = globalThis.fetch;

describe("ResendClient", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "Jerusalem Doctors <noreply@example.com>";
    process.env.RESEND_BASE_URL = "https://example.test";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("posts the rendered email and returns the message id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ResendClient();
    const result = await client.send({
      to: "dr@hadassah.org.il",
      subject: "Verify",
      html: "<p>hi</p>",
      text: "hi",
      idempotencyKey: "abc",
    });

    expect(result.id).toBe("msg_123");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/emails");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("abc");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      to: ["dr@hadassah.org.il"],
      from: "Jerusalem Doctors <noreply@example.com>",
      subject: "Verify",
      html: "<p>hi</p>",
      text: "hi",
    });
  });

  it("throws ResendError on non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "bad" }), { status: 422 })) as unknown as typeof fetch;
    const client = new ResendClient();
    await expect(
      client.send({ to: "x@y.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toBeInstanceOf(ResendError);
  });

  it("dev-bypasses with no API key (logs to console, returns synthetic id)", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "test";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new ResendClient();
    const r = await client.send({ to: "x@y.com", subject: "s", html: "h", text: "t" });
    expect(r.id).toMatch(/^dev-/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws if RESEND_API_KEY missing in production", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    const client = new ResendClient();
    await expect(
      client.send({ to: "x@y.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    process.env.NODE_ENV = "test";
  });
});
