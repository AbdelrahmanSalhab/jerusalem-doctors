import { describe, expect, it } from "vitest";
import { whatsappHref, whatsappIntro } from "./contactIntro";

describe("whatsappIntro", () => {
  it("says who is writing", () => {
    expect(
      whatsappIntro({ firstName: "خالد", familyName: "سلهب", specialty: "طب عام", workplace: "كلاليت" }, "ليلى"),
    ).toBe("السلام عليكم د. ليلى، معك د. خالد سلهب، طب عام، كلاليت. وصلت إلى رقمك من خلال دليل أطباء القدس.");
  });

  it("leaves out what the viewer hasn't filled in", () => {
    expect(whatsappIntro({ firstName: "خالد", familyName: "سلهب", workplace: " " }, "ليلى")).toBe(
      "السلام عليكم د. ليلى، معك د. خالد سلهب. وصلت إلى رقمك من خلال دليل أطباء القدس.",
    );
  });

  it("falls back to the plain greeting without a viewer, and encodes the link", () => {
    expect(whatsappIntro(null, "ليلى")).toContain("دليل أطباء القدس");
    expect(whatsappHref("https://wa.me/972501234567", "مرحبا د.")).toBe(
      "https://wa.me/972501234567?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%20%D8%AF.",
    );
  });
});
