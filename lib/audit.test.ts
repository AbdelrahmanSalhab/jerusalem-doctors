import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { writeAudit } from "./audit";

function serviceReturning(result: { error: unknown } | Error) {
  const insert = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { from: vi.fn(() => ({ insert })) }, insert };
}

describe("writeAudit", () => {
  beforeEach(() => {
    captureException.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("inserts the row into audit_logs", async () => {
    const { client, insert } = serviceReturning({ error: null });
    await writeAudit(client as never, { action: "x", metadata: { a: 1 } });
    expect(client.from).toHaveBeenCalledWith("audit_logs");
    expect(insert).toHaveBeenCalledWith({ action: "x", metadata: { a: 1 } });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports an insert error without throwing", async () => {
    const { client } = serviceReturning({ error: { message: "rls" } });
    await expect(writeAudit(client as never, { action: "x" })).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("reports a thrown error without throwing", async () => {
    const { client } = serviceReturning(new Error("network"));
    await expect(writeAudit(client as never, { action: "x" })).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledOnce();
  });
});
