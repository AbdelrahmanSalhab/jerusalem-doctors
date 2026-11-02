// The sender and the balance read against a stand-in for SMS4FREE: what each
// answer means for the doctor, and which failures are worth retrying.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtpProviderError } from "./provider";
import { Sms4FreeOtpSender, fetchAvailableSms } from "./sms4free";

const fetchMock = vi.fn();
const reply = (body: string, status = 200) => fetchMock.mockResolvedValueOnce(new Response(body, { status }));
const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as OtpProviderError;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SMS4FREE_KEY", "K");
  vi.stubEnv("SMS4FREE_USER", "0500000000");
  vi.stubEnv("SMS4FREE_PASS", "P");
  vi.stubEnv("SMS4FREE_SENDER", "JDoctors");
  vi.stubEnv("SMS4FREE_API_URL", undefined);
  vi.stubEnv("SMS4FREE_BALANCE_URL", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Sms4FreeOtpSender setup", () => {
  it("refuses to start without credentials, as a permanent configuration error", () => {
    vi.stubEnv("SMS4FREE_PASS", "");
    expect(() => new Sms4FreeOtpSender()).toThrow(expect.objectContaining({ permanent: true, reason: "provider_config" }));
  });

  it("refuses a sender name that is not 1-11 Latin letters or digits", () => {
    vi.stubEnv("SMS4FREE_SENDER", "أطباء");
    expect(() => new Sms4FreeOtpSender()).toThrow(/SMS4FREE_SENDER/);
  });
});

describe("Sms4FreeOtpSender.send", () => {
  it("reports the accepted count as the message reference", async () => {
    reply("1");
    expect(await new Sms4FreeOtpSender().send("+972501234567", "123456")).toEqual({ messageRef: "sms4free:accepted:1" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ recipient: "0501234567", sender: "JDoctors" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.sms4free.co.il/ApiSMS/v2/SendSMS");
  });

  it("uses an API address from the environment", async () => {
    vi.stubEnv("SMS4FREE_API_URL", "https://sms.example/send");
    reply("1");
    await new Sms4FreeOtpSender().send("+972501234567", "123456");
    expect(fetchMock.mock.calls[0][0]).toBe("https://sms.example/send");
  });

  it("fails permanently for a number it cannot text, without calling the provider", async () => {
    const err = await failure(new Sms4FreeOtpSender().send("+14155550123", "123456"));
    expect(err).toMatchObject({ permanent: true, reason: "number_not_deliverable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls a network failure transient, and unknown whether it was billed", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await failure(new Sms4FreeOtpSender().send("+972501234567", "1"))).toMatchObject({ permanent: false, reason: "sms4free_timeout" });
  });

  it("retries a 5xx but not a 4xx", async () => {
    reply("oops", 503);
    expect(await failure(new Sms4FreeOtpSender().send("+972501234567", "1"))).toMatchObject({ permanent: false, reason: "sms4free_http_503" });
    reply("no", 403);
    expect(await failure(new Sms4FreeOtpSender().send("+972501234567", "1"))).toMatchObject({ permanent: true, reason: "sms4free_http_403" });
  });

  it("does not count a body it cannot read as a rejection it can name", async () => {
    reply("<html>");
    expect(await failure(new Sms4FreeOtpSender().send("+972501234567", "1"))).toMatchObject({ permanent: false, reason: "sms4free_unreadable" });
  });

  it("names a documented rejection, and gives an undocumented one the provider's words", async () => {
    reply("-4");
    expect(await failure(new Sms4FreeOtpSender().send("+972501234567", "1"))).toMatchObject({ reason: "sms4free_status_-4", permanent: true });
    reply('{"status":-99,"message":"custom text"}');
    const odd = await failure(new Sms4FreeOtpSender().send("+972501234567", "1"));
    expect(odd.message).toContain("custom text");
    expect(odd.permanent).toBe(false);
    reply("-98");
    expect((await failure(new Sms4FreeOtpSender().send("+972501234567", "1"))).message).toContain("unknown status");
  });
});

describe("fetchAvailableSms", () => {
  it("reads the balance, including zero", async () => {
    reply("120");
    expect(await fetchAvailableSms()).toBe(120);
    reply("0");
    expect(await fetchAvailableSms()).toBe(0);
  });

  it("uses a balance address from the environment", async () => {
    vi.stubEnv("SMS4FREE_BALANCE_URL", "https://sms.example/balance");
    reply("5");
    await fetchAvailableSms();
    expect(fetchMock.mock.calls[0][0]).toBe("https://sms.example/balance");
  });

  it("fails without credentials, on a network error, on HTTP errors and on unreadable bodies", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await failure(fetchAvailableSms())).toMatchObject({ permanent: false });
    reply("x", 500);
    expect(await failure(fetchAvailableSms())).toMatchObject({ permanent: false });
    reply("x", 401);
    expect(await failure(fetchAvailableSms())).toMatchObject({ permanent: true });
    reply("<html>");
    expect((await failure(fetchAvailableSms())).message).toContain("unparseable");
    vi.stubEnv("SMS4FREE_USER", "");
    expect((await failure(fetchAvailableSms())).message).toContain("missing env");
  });

  it("reports a credential failure, documented or not", async () => {
    reply("-1");
    expect((await failure(fetchAvailableSms())).message).toContain("status -1");
    reply("-97");
    expect((await failure(fetchAvailableSms())).message).toContain("unknown status");
  });
});
