// The daily balance watch: closed to anyone without the cron secret, and loud
// when the prepaid balance runs low.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/test/fakeSupabase";

const fetchAvailableSms = vi.hoisted(() => vi.fn());
const raiseAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/otp/sms4free", () => ({ fetchAvailableSms }));
vi.mock("@/lib/alerts", () => ({ raiseAlert }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/supabase/service", async () => {
  const { db } = await import("@/test/fakeSupabase");
  return { createSupabaseServiceClient: () => db.client };
});

const call = async (secret: string | null = "s3cret") =>
  (await import("./route")).GET(new Request("http://x/api/cron/sms-balance", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("OTP_PROVIDER", "");
  vi.stubEnv("SMS4FREE_LOW_BALANCE_THRESHOLD", "50");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/cron/sms-balance", () => {
  it("refuses a wrong or missing secret without calling the provider", async () => {
    expect((await call("nope")).status).toBe(401);
    expect((await call(null)).status).toBe(401);
    expect(fetchAvailableSms).not.toHaveBeenCalled();
  });

  it("stays quiet when the balance is enough", async () => {
    fetchAvailableSms.mockResolvedValue(500);
    expect(await (await call()).json()).toMatchObject({ balance: 500, threshold: 50, low: false });
    expect(raiseAlert).not.toHaveBeenCalled();
  });

  it("raises a warning below the threshold, an error at zero", async () => {
    fetchAvailableSms.mockResolvedValueOnce(10);
    await call();
    expect(raiseAlert).toHaveBeenLastCalledWith(expect.anything(), "sms_balance_low", { level: "warning", extra: { balance: 10, threshold: 50 } });
    fetchAvailableSms.mockResolvedValueOnce(0);
    await call();
    expect(raiseAlert).toHaveBeenLastCalledWith(expect.anything(), "sms_balance_low", expect.objectContaining({ level: "error" }));
  });

  it("answers 502 when the balance cannot be read, and skips another provider", async () => {
    fetchAvailableSms.mockRejectedValueOnce(new Error("bad credentials"));
    expect((await call()).status).toBe(502);
    vi.stubEnv("OTP_PROVIDER", "twilio");
    expect(await (await call()).json()).toMatchObject({ skipped: true });
  });
});
