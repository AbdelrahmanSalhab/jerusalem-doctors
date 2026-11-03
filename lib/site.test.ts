import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SITE_URL", () => {
  it("is the production domain Vercel names, else the current address", async () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "doctors.example");
    expect((await import("./site")).SITE_URL).toBe("https://doctors.example");
    vi.resetModules();
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect((await import("./site")).SITE_URL).toBe("https://jerusalem-doctors.vercel.app");
  });
});

describe("indexable", () => {
  it("opens a public page to search engines under its own address, keeping extras", async () => {
    const { indexable } = await import("./site");
    expect(indexable("/signup", { title: "x" })).toEqual({
      title: "x",
      robots: { index: true, follow: true },
      alternates: { canonical: "/signup" },
    });
    expect(indexable("/")).toMatchObject({ alternates: { canonical: "/" } });
  });
});
