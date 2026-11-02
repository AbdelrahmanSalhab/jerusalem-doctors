import { describe, expect, it, vi } from "vitest";
import { MohClient, MohRefusedError } from "./client";

const ok = (records: unknown[]) => new Response(JSON.stringify({ success: true, result: { records } }), { status: 200 });

describe("findByLicenses", () => {
  it("asks for many licences in one request, saying who is asking", async () => {
    const fetchImpl = vi.fn(async () => ok([{ "מספר רישיון רופא": 1 }]));
    const client = new MohClient({ base: "https://x/api/3", fetchImpl });
    const rows = await client.findByLicenses([1, 2, 2, 0, -3, 1.5]);
    expect(rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(new URL(url).searchParams.get("filters")!)).toEqual({ "מספר רישיון רופא": [1, 2] });
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/jerusalem-doctors/);
  });

  it("splits a long list into batches of 300", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await new MohClient({ fetchImpl }).findByLicenses(Array.from({ length: 650 }, (_, i) => i + 1));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("asks nothing for an empty list", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    expect(await new MohClient({ fetchImpl }).findByLicenses([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops at once when refused, instead of retrying into a block", async () => {
    for (const status of [403, 429]) {
      const fetchImpl = vi.fn(async () => new Response("no", { status }));
      await expect(new MohClient({ fetchImpl, retries: 2 }).findByLicenses([1])).rejects.toBeInstanceOf(MohRefusedError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

describe("findAll", () => {
  it("pages through the registry until a short page", async () => {
    const pages = [[{}, {}], [{}, {}], [{}]];
    const fetchImpl = vi.fn(async () => ok(pages.shift() ?? []));
    const rows = await new MohClient({ fetchImpl }).findAll(2, 0);
    expect(rows).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const offsets = fetchImpl.mock.calls.map((c) => new URL((c as unknown as [string])[0]).searchParams.get("offset"));
    expect(offsets).toEqual(["0", "2", "4"]);
  });
});

describe("failures", () => {
  const bad = () => new Response(JSON.stringify({ success: false }), { status: 200 });

  it("rejects a CKAN answer that says it failed, for a licence lookup and a sweep", async () => {
    const fetchImpl = vi.fn(async () => bad());
    await expect(new MohClient({ fetchImpl }).findByLicenses([1])).rejects.toThrow("success=false");
    await expect(new MohClient({ fetchImpl }).findAll(10, 0)).rejects.toThrow("success=false");
  });

  it("retries a server error with a growing pause, then reports it", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => new Response("oops", { status: 500 }));
      const done = new MohClient({ fetchImpl, retries: 2 }).findByLicenses([1]);
      const check = expect(done).rejects.toThrow("MoH HTTP 500");
      await vi.advanceTimersByTimeAsync(200 + 400);
      await check;
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds on a retry after a network failure, and counts each request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(ok([]));
      const client = new MohClient({ fetchImpl, retries: 1 });
      const done = client.findByLicenses([1]);
      await vi.advanceTimersByTimeAsync(200);
      expect(await done).toEqual([]);
      expect(client.requests).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a plain error when what was thrown is not one", async () => {
    const fetchImpl = vi.fn(async () => {
      throw "plain string";
    });
    await expect(new MohClient({ fetchImpl, retries: 0 }).findByLicenses([1])).rejects.toThrow("failed after retries");
  });

  it("aborts a request that takes longer than its timeout", async () => {
    const fetchImpl = vi.fn((_: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
    await expect(new MohClient({ fetchImpl: fetchImpl as never, retries: 0, timeoutMs: 5 }).findByLicenses([1])).rejects.toThrow("aborted");
  });

  it("uses the global fetch when none is given", () => {
    expect(new MohClient()).toBeInstanceOf(MohClient);
  });
});
