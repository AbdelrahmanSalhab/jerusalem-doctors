import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_SIZE,
  adminDoctorsHref,
  DOCTOR_FILTERS,
  pageCount,
  pageRange,
  parseAdminDoctorsParams,
} from "./doctorsQuery";

describe("parseAdminDoctorsParams", () => {
  // Requirement: the page opens on everyone, not on the review queue.
  it("defaults to all doctors, page one, no panel", () => {
    expect(parseAdminDoctorsParams({})).toEqual({ filter: "all", q: "", page: 1, doctorId: null, editing: false });
  });

  it("keeps the filter values the rest of the app already links to", () => {
    for (const key of ["pending", "approved", "suspended", "all"]) {
      expect(parseAdminDoctorsParams({ status: key }).filter).toBe(key);
    }
  });

  it("falls back to all doctors on an unknown filter", () => {
    expect(parseAdminDoctorsParams({ status: "nonsense" }).filter).toBe("all");
  });

  it("floors and clamps the page, never asking for a negative range", () => {
    expect(parseAdminDoctorsParams({ page: "3" }).page).toBe(3);
    expect(parseAdminDoctorsParams({ page: "2.7" }).page).toBe(2);
    expect(parseAdminDoctorsParams({ page: "0" }).page).toBe(1);
    expect(parseAdminDoctorsParams({ page: "-4" }).page).toBe(1);
    expect(parseAdminDoctorsParams({ page: "abc" }).page).toBe(1);
  });

  it("trims the search and caps its length", () => {
    expect(parseAdminDoctorsParams({ q: "  أحمد  " }).q).toBe("أحمد");
    expect(parseAdminDoctorsParams({ q: "x".repeat(200) }).q).toHaveLength(100);
  });

  it("reads the open doctor, treating blank as none", () => {
    expect(parseAdminDoctorsParams({ doctor: "abc-123" }).doctorId).toBe("abc-123");
    expect(parseAdminDoctorsParams({ doctor: "  " }).doctorId).toBeNull();
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseAdminDoctorsParams({ status: ["pending", "all"] }).filter).toBe("pending");
  });
});

describe("adminDoctorsHref", () => {
  const base = { filter: "all", q: "", page: 1 } as const;

  it("leaves the default view at the bare /admin address", () => {
    expect(adminDoctorsHref(base)).toBe("/admin");
  });

  it("keeps the filter, search and page together", () => {
    expect(adminDoctorsHref({ filter: "pending", q: "أحمد", page: 2 })).toBe("/admin?status=pending&q=%D8%A3%D8%AD%D9%85%D8%AF&page=2");
  });

  it("opens a panel without losing where the admin was", () => {
    expect(adminDoctorsHref({ filter: "pending", q: "", page: 3 }, { doctorId: "d1" })).toBe(
      "/admin?status=pending&page=3&doctor=d1",
    );
  });

  it("drops the panel when no doctor is given, which is how closing works", () => {
    expect(adminDoctorsHref({ filter: "all", q: "", page: 1 }, { doctorId: null })).toBe("/admin");
  });
});

describe("paging", () => {
  it("asks for one page of rows at a time", () => {
    expect(pageRange(1)).toEqual({ from: 0, to: ADMIN_PAGE_SIZE - 1 });
    expect(pageRange(3, 25)).toEqual({ from: 50, to: 74 });
  });

  it("counts at least one page, even with no doctors at all", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});

describe("the filter list", () => {
  it("offers an entry point for each thing an admin goes looking for", () => {
    expect(DOCTOR_FILTERS.map((f) => f.key)).toEqual([
      "all",
      "pending",
      "license",
      "stage",
      "hidden",
      "suspended",
      "approved",
    ]);
    for (const f of DOCTOR_FILTERS) expect(f.label).toMatch(/[؀-ۿ]/);
  });
});

describe("the panel's address", () => {
  it("opens, and opens into the editor, on whichever page hosts it", async () => {
    const { panelHref, readDoctorParam, readEditParam } = await import("./doctorsQuery");
    expect(panelHref("/admin/institutions", "d1")).toBe("/admin/institutions?doctor=d1");
    expect(panelHref("/admin/institutions", "d1", { edit: true })).toBe(
      "/admin/institutions?doctor=d1&edit=1",
    );
    expect(readDoctorParam({ doctor: " d1 " })).toBe("d1");
    expect(readDoctorParam({})).toBeNull();
    expect(readEditParam({ edit: "1" })).toBe(true);
    expect(readEditParam({ edit: "yes" })).toBe(false);
  });

  it("keeps the editor out of the doctors-list URL unless a panel is open", async () => {
    const { adminDoctorsHref } = await import("./doctorsQuery");
    const here = { filter: "all" as const, q: "", page: 1 };
    expect(adminDoctorsHref(here, { doctorId: "d1", editing: true })).toBe("/admin?doctor=d1&edit=1");
    expect(adminDoctorsHref(here, { editing: true })).toBe("/admin");
  });
});
