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
