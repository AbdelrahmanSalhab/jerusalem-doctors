import { describe, expect, it } from "vitest";
import {
  approvalNeedsReason,
  licenseDisplay,
  licenseStatusLabel,
  licenseStatusSentence,
  licenseStatusTone,
  LICENSE_STATUSES,
  PS_LABEL,
  toneChip,
  UNCHECKED_LABEL,
} from "./licenseStatus";

describe("licenseStatus", () => {
  it("labels every value the column accepts", () => {
    for (const s of LICENSE_STATUSES) {
      expect(licenseStatusLabel(s)).not.toBe(UNCHECKED_LABEL);
      expect(licenseStatusLabel(s).length).toBeGreaterThan(2);
      expect(licenseStatusSentence(s).length).toBeGreaterThan(2);
    }
  });

  it("treats null, undefined and junk as not yet checked", () => {
    for (const v of [null, undefined, "", "soft-match", 7]) {
      expect(licenseStatusLabel(v)).toBe(UNCHECKED_LABEL);
      expect(licenseStatusTone(v)).toBe("neutral");
    }
  });

  // The activity log asserts these exact sentences (lib/auditText.test.ts and
  // app/(admin)/admin/audit/page.test.ts), so they are a contract.
  it("keeps the activity log wording", () => {
    expect(licenseStatusSentence("verified")).toBe("الترخيص مطابق لسجل الوزارة");
    expect(licenseStatusSentence("soft_match")).toBe("تطابق تقريبي مع السجل");
    expect(licenseStatusSentence("not_found")).toBe("الترخيص غير موجود في السجل");
    expect(licenseStatusSentence("name_mismatch_overridden")).toBe("الاسم لا يطابق السجل (تجاوزه الطبيب)");
  });

  it("tones a match green, a near match amber and an override red", () => {
    expect(licenseStatusTone("verified")).toBe("success");
    expect(licenseStatusTone("soft_match")).toBe("warn");
    expect(licenseStatusTone("not_found")).toBe("warn");
    expect(licenseStatusTone("name_mismatch_overridden")).toBe("danger");
  });

  it("builds a chip class from the semantic tokens only", () => {
    expect(toneChip("success")).toContain("bg-success-bg");
    expect(toneChip("neutral")).toContain("border-line");
    // No raw alpha utilities: those are what the old admin screens used.
    for (const tone of ["success", "warn", "danger", "neutral"] as const) {
      expect(toneChip(tone)).not.toMatch(/foreground\/\d/);
    }
  });

  describe("licenseDisplay", () => {
    it("never presents a Palestinian licence as a registry miss", () => {
      const ps = licenseDisplay({ status: "not_found", region: "PS" });
      expect(ps.label).toBe(PS_LABEL);
      expect(ps.tone).toBe("neutral");
      expect(ps.label).not.toContain("غير موجود");
    });

    it("still warns on an Israeli licence that was not found", () => {
      const il = licenseDisplay({ status: "not_found", region: "IL" });
      expect(il.label).toBe("غير موجود في السجل");
      expect(il.tone).toBe("warn");
    });

    it("defaults to the status when no region is known", () => {
      expect(licenseDisplay({ status: "verified" })).toEqual({ label: "موثّق", tone: "success" });
    });
  });

  describe("approvalNeedsReason", () => {
    it("is false only for an exact registry match", () => {
      expect(approvalNeedsReason("verified")).toBe(false);
      expect(approvalNeedsReason("soft_match")).toBe(true);
      expect(approvalNeedsReason("not_found")).toBe(true);
      expect(approvalNeedsReason("name_mismatch_overridden")).toBe(true);
      expect(approvalNeedsReason(null)).toBe(true);
    });
  });
});
