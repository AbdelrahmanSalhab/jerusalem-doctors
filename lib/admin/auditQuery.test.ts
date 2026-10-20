import { describe, expect, it } from "vitest";
import { auditHref, parseAuditParams } from "./auditQuery";

describe("parseAuditParams", () => {
  it("keeps only what it understands", () => {
    expect(parseAuditParams({ action: "x", from: "2026-13-01", to: "yesterday", people: "yes", page: "0" })).toEqual({
      action: "",
      q: "",
      from: "",
      to: "",
      people: false,
      page: 1,
    });
  });

  it("round-trips through the URL", () => {
    const p = parseAuditParams({ action: "signup_verified", q: " ليلى ", from: "2026-10-01", to: "2026-10-19", people: "1", page: "3" });
    expect(p.q).toBe("ليلى");
    expect(parseAuditParams(Object.fromEntries(new URL(auditHref(p), "http://x").searchParams))).toEqual(p);
  });

  it("leaves the plain log at its plain address", () => {
    expect(auditHref(parseAuditParams({}))).toBe("/admin/audit");
  });
});
