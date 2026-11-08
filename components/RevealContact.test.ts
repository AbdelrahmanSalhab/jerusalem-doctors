// A card shows a colleague's number at once only when it arrived with one
// (the admins' «contacts without tap» switch); otherwise it offers the tap.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RevealContact } from "@/components/RevealContact";

const base = { id: "d1", arabic_first_name: "أحمد", arabic_family_name: "الخطيب", has_contact: true, specialties: [], workplaces: [] };
const html = (doctor: Parameters<typeof RevealContact>[0]["doctor"]) => renderToStaticMarkup(createElement(RevealContact, { doctor }));

describe("RevealContact", () => {
  it("offers the tap, and no number, for a card that came without one", () => {
    const out = html(base);
    expect(out).toContain("إظهار الهاتف والبريد");
    expect(out).not.toContain("050-123-4567");
  });

  it("shows the number and email straight away for a card that came with them", () => {
    const out = html({
      ...base,
      contact: { phone_display: "050-123-4567", phone_e164: "+972501234567", email: "a@b.test", whatsapp_url: "https://wa.me/972501234567" },
    });
    expect(out).toContain("050-123-4567");
    expect(out).toContain("a@b.test");
    expect(out).not.toContain("إظهار الهاتف والبريد");
  });

  it("renders nothing for a doctor with nothing to show", () => {
    expect(html({ ...base, has_contact: false })).toBe("");
  });
});
