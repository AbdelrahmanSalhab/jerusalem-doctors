import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sms4FreeOtpSender, fetchAvailableSms } from "./sms4free";

let reply = { body: "1", status: 200 };
let lastRequest: Record<string, string> | null = null;
let server: ReturnType<typeof createServer>;
let sender: Sms4FreeOtpSender;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastRequest = JSON.parse(raw);
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.SMS4FREE_KEY = "K";
  process.env.SMS4FREE_USER = "0500000000";
  process.env.SMS4FREE_PASS = "P";
  process.env.SMS4FREE_SENDER = "JDoctors";
  process.env.SMS4FREE_API_URL = `http://127.0.0.1:${port}/`;
  process.env.SMS4FREE_BALANCE_URL = `http://127.0.0.1:${port}/`;
  sender = new Sms4FreeOtpSender();
});

afterAll(() => server.close());

const send = () => sender.send("+972501234567", "012345");

describe("Sms4FreeOtpSender over HTTP", () => {
  it("accepts status 1 and sends the right payload", async () => {
    reply = { body: '{"status":1,"message":"OK"}', status: 200 };
    const r = await send();
    expect(r.messageRef).toBe("sms4free:accepted:1");
    expect(lastRequest).toEqual({
      key: "K",
      user: "0500000000",
      pass: "P",
      sender: "JDoctors",
      recipient: "0501234567",
      msg: "رمز دخول دليل أطباء القدس: 012345. لا تشاركه.",
    });
  });

  it("accepts a bare numeric body", async () => {
    reply = { body: "1", status: 200 };
    await expect(send()).resolves.toMatchObject({ messageRef: "sms4free:accepted:1" });
  });

  it("FAILS on HTTP 200 carrying a negative status", async () => {
    reply = { body: '{"status":-4,"message":"low"}', status: 200 };
    await expect(send()).rejects.toMatchObject({ permanent: true });
  });

  it("marks an unverified sender permanent", async () => {
    reply = { body: "-6", status: 200 };
    await expect(send()).rejects.toMatchObject({ permanent: true });
  });

  it("leaves the general error retryable", async () => {
    reply = { body: "0", status: 200 };
    await expect(send()).rejects.toMatchObject({ permanent: false });
  });

  it("does not claim success on an unparseable body", async () => {
    reply = { body: "<html>oops</html>", status: 200 };
    await expect(send()).rejects.toMatchObject({ permanent: false });
  });

  it("treats 5xx as transient and 4xx as permanent", async () => {
    reply = { body: "err", status: 500 };
    await expect(send()).rejects.toMatchObject({ permanent: false });
    reply = { body: "nope", status: 403 };
    await expect(send()).rejects.toMatchObject({ permanent: true });
  });

  it("refuses a +970 number without touching the network", async () => {
    lastRequest = null;
    await expect(sender.send("+970599123456", "012345")).rejects.toMatchObject({
      permanent: true,
    });
    expect(lastRequest).toBeNull();
  });

  it("never puts the OTP in the error message", async () => {
    reply = { body: "-1", status: 200 };
    await expect(send()).rejects.toThrow(/^(?!.*012345).*$/);
  });
});

describe("fetchAvailableSms", () => {
  it("reads the bare number the live endpoint returns", async () => {
    reply = { body: "10", status: 200 };
    await expect(fetchAvailableSms()).resolves.toBe(10);
    // credentials only — no sender, no recipient
    expect(lastRequest).toEqual({ key: "K", user: "0500000000", pass: "P" });
  });

  it("treats an empty account as a valid answer, not an error", async () => {
    reply = { body: "0", status: 200 };
    await expect(fetchAvailableSms()).resolves.toBe(0);
  });

  it("throws on a credential failure", async () => {
    reply = { body: "-1", status: 200 };
    await expect(fetchAvailableSms()).rejects.toMatchObject({ permanent: true });
  });

  it("does not report a balance from an unparseable body", async () => {
    reply = { body: "<html>oops</html>", status: 200 };
    await expect(fetchAvailableSms()).rejects.toThrow(/unparseable/);
  });
});
