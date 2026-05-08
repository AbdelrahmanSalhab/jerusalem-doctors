import { describe, expect, it } from "vitest";
import { normalizeArabic } from "./arabic";

describe("normalizeArabic", () => {
  it("collapses all hamza-on-alef forms to bare alef", () => {
    expect(normalizeArabic("أحمد")).toBe("احمد");
    expect(normalizeArabic("إحمد")).toBe("احمد");
    expect(normalizeArabic("آحمد")).toBe("احمد");
    expect(normalizeArabic("ٱحمد")).toBe("احمد");
  });

  it("makes the three hamza variants of أحمد search-equivalent", () => {
    const variants = ["احمد", "أحمد", "إحمد", "آحمد"];
    const normalized = variants.map(normalizeArabic);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("احمد");
  });

  it("converts alef maksura ى to ya ي", () => {
    expect(normalizeArabic("ليلى")).toBe("ليلي");
    expect(normalizeArabic("موسى")).toBe("موسي");
  });

  it("converts ؤ to و", () => {
    expect(normalizeArabic("مؤمن")).toBe("مومن");
  });

  it("converts ئ to ي", () => {
    expect(normalizeArabic("الطوارئ")).toBe("الطواري");
    expect(normalizeArabic("النسائية")).toBe("النسايية");
  });

  it("removes tatweel", () => {
    expect(normalizeArabic("محـمـد")).toBe("محمد");
    expect(normalizeArabic("ســـلام")).toBe("سلام");
  });

  it("removes diacritics (fatha, kasra, damma, sukun, shadda, etc.)", () => {
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("بِسْمِ")).toBe("بسم");
    expect(normalizeArabic("اللَّه")).toBe("الله");
  });

  it("removes dagger alef U+0670", () => {
    expect(normalizeArabic("هذا")).toBe("هذا");
    expect(normalizeArabic("هٰذا")).toBe("هذا");
  });

  it("preserves Arabic-Indic digits U+0660-U+0669", () => {
    expect(normalizeArabic("١٢٣٤٥٦٧٨٩٠")).toBe("١٢٣٤٥٦٧٨٩٠");
  });

  it("preserves Arabic punctuation U+066A-U+066F", () => {
    expect(normalizeArabic("٪")).toBe("٪");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeArabic("أحمد   الخطيب")).toBe("احمد الخطيب");
    expect(normalizeArabic("أحمد\t\n الخطيب")).toBe("احمد الخطيب");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeArabic("   أحمد  ")).toBe("احمد");
  });

  it("returns empty for empty input", () => {
    expect(normalizeArabic("")).toBe("");
    expect(normalizeArabic("   ")).toBe("");
  });

  it("lowercases mixed Arabic + Latin", () => {
    expect(normalizeArabic("Dr. أحمد")).toBe("dr. احمد");
  });

  it("does not transform ة (ta marbuta) — it's tracked separately per spec §9", () => {
    expect(normalizeArabic("العائلة")).toBe("العايلة");
  });

  it("is idempotent (normalize twice = normalize once)", () => {
    const inputs = ["أحمد", "مُحَمَّد", "  ليلى  ", "Dr. آحمد"];
    for (const i of inputs) {
      expect(normalizeArabic(normalizeArabic(i))).toBe(normalizeArabic(i));
    }
  });

  it("strips combining marks across the full U+064B-U+065F range", () => {
    // ب + fathatan U+064B, ب + fatha U+064E, ب + shadda U+0651,
    // ب + sukun U+0652, ب + combining hamza below U+0655 — all five marks vanish.
    const withMarks = "بًبَبّبْبٕ";
    expect(normalizeArabic(withMarks)).toBe("ببببب");
  });

  it("seeds spec §17 specialty list — hamza variants normalize stably", () => {
    expect(normalizeArabic("الأطفال")).toBe("الاطفال");
    expect(normalizeArabic("الأنف والأذن والحنجرة")).toBe(
      "الانف والاذن والحنجرة",
    );
    expect(normalizeArabic("الطب الطبيعي وإعادة التأهيل")).toBe(
      "الطب الطبيعي واعادة التاهيل",
    );
    expect(normalizeArabic("أمراض الكلى")).toBe("امراض الكلي");
  });
});
