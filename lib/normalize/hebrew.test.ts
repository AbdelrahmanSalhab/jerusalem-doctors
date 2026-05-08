import { describe, expect, it } from "vitest";
import { normalizeHebrew } from "./hebrew";

describe("normalizeHebrew", () => {
  it("strips niqqud (vowel marks) leaving consonants intact", () => {
    // דָּנִיֵּאל with patah + dagesh + hiriq + tsere + dagesh
    expect(normalizeHebrew("דָּנִיֵּאל")).toBe("דניאל");
  });

  it("leaves an unmarked name unchanged", () => {
    expect(normalizeHebrew("דריפוס")).toBe("דריפוס");
  });

  it("strips gershayim U+05F4 used in abbreviations", () => {
    expect(normalizeHebrew("ד״ר")).toBe("דר");
  });

  it("strips geresh U+05F3", () => {
    expect(normalizeHebrew("צ׳ייני")).toBe("צייני");
  });

  it("strips ASCII double quote and apostrophe", () => {
    expect(normalizeHebrew('ד"ר אחמד')).toBe("דר אחמד");
    expect(normalizeHebrew("ל'אונרדו")).toBe("לאונרדו");
  });

  it("normalizes NFKC decomposition", () => {
    // אֵל composed (U+05D0 U+05B5) vs decomposed both should match.
    const composed = "אֵל".normalize("NFC");
    const decomposed = "אֵל".normalize("NFD");
    expect(normalizeHebrew(composed)).toBe(normalizeHebrew(decomposed));
    expect(normalizeHebrew(composed)).toBe("אל");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeHebrew("דניאל   דריפוס")).toBe("דניאל דריפוס");
    expect(normalizeHebrew("דניאל\tדריפוס")).toBe("דניאל דריפוס");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeHebrew("  דניאל  ")).toBe("דניאל");
  });

  it("preserves Hebrew final letters distinctly", () => {
    // ך (U+05DA), ם (U+05DD), ן (U+05DF), ף (U+05E3), ץ (U+05E5) — should not be folded.
    expect(normalizeHebrew("מלך")).toBe("מלך");
    expect(normalizeHebrew("שלום")).toBe("שלום");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeHebrew("")).toBe("");
    expect(normalizeHebrew("   ")).toBe("");
  });

  it("does NOT lowercase (Hebrew has no case)", () => {
    expect(normalizeHebrew("Daniel")).toBe("Daniel");
  });

  it("strips meteg, dagesh, and other less-common marks", () => {
    // U+05BC dagesh, U+05BD meteg, U+05B0 sheva.
    expect(normalizeHebrew("בְּ")).toBe("ב");
    expect(normalizeHebrew("שׂ")).toBe("ש");
  });

  it("handles a realistic mix: 'ד״ר דָּנִיֵּאל דריפוס'", () => {
    expect(normalizeHebrew('ד״ר דָּנִיֵּאל דריפוס')).toBe("דר דניאל דריפוס");
  });

  it("is idempotent (normalize twice = normalize once)", () => {
    const inputs = ["דָּנִיֵּאל", 'ד״ר אחמד', "  שלום  "];
    for (const i of inputs) {
      expect(normalizeHebrew(normalizeHebrew(i))).toBe(normalizeHebrew(i));
    }
  });

  it("makes 'דניאל' and 'דָּנִיֵּאל' search-equivalent", () => {
    expect(normalizeHebrew("דניאל")).toBe(normalizeHebrew("דָּנִיֵּאל"));
  });

  it("strips cantillation marks (U+0591-U+05AF) from biblical text", () => {
    // ב + cantillation U+0591 etelnahta
    expect(normalizeHebrew("ב֑")).toBe("ב");
  });
});
