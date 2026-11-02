// The cached reads wrap Next's data cache; here it is a pass-through, so what
// is checked is what each read asks for, and that clearing a tag never throws.

import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ marker: "service" }) }));
const directory = vi.hoisted(() => ({
  fetchFeatured: vi.fn(async () => ({ doctor: null, graduates: [] })),
  fetchDirectoryCounts: vi.fn(async () => ({ listed: 3, byDomain: {}, byInstitution: {} })),
  fetchRecent: vi.fn(async () => []),
}));
vi.mock("@/lib/directory", () => directory);
vi.mock("@/lib/institutions", () => ({ fetchInstitutions: vi.fn(async () => [{ name_ar: "المقاصد" }]) }));
vi.mock("@/lib/specialties/catalogue", () => ({ fetchActiveSpecialties: vi.fn(async () => [{ name_ar: "جلدية" }]) }));

beforeEach(() => vi.clearAllMocks());

describe("cached reads", () => {
  it("read institutions, specialties and the dashboard overview from the service client", async () => {
    const m = await import("./cachedReads");
    expect(await m.cachedInstitutions()).toEqual([{ name_ar: "المقاصد" }]);
    expect(await m.cachedSpecialties()).toEqual([{ name_ar: "جلدية" }]);
    expect(await m.cachedDirectoryOverview()).toMatchObject({ counts: { listed: 3 } });
    expect(directory.fetchFeatured).toHaveBeenCalledWith({ marker: "service" });
  });

  it("clears the matching tag at once after an edit", async () => {
    const m = await import("./cachedReads");
    m.institutionsChanged();
    m.specialtiesChanged();
    m.directoryChanged();
    expect(revalidateTag.mock.calls.map((c) => c[0])).toEqual(["institutions", "specialties", "directory"]);
    expect(revalidateTag).toHaveBeenCalledWith("directory", { expire: 0 });
  });

  it("logs rather than throws when a tag cannot be cleared", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("outside a request");
    });
    (await import("./cachedReads")).directoryChanged();
    expect(err).toHaveBeenCalled();
  });

  it("serves the overview uncached when the cache is turned off", async () => {
    vi.resetModules();
    vi.stubEnv("DIRECTORY_CACHE_SECONDS", "0");
    const m = await import("./cachedReads");
    expect(await m.cachedDirectoryOverview()).toMatchObject({ counts: { listed: 3 } });
    vi.unstubAllEnvs();
  });
});
