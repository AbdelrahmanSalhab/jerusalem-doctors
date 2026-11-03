// The review button: a form until it has been done, then a line saying when.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { LicenseReviewed } from "./LicenseReviewed";

const html = (reviewedAt: string | null) => renderToStaticMarkup(createElement(LicenseReviewed, { doctorId: "d1", reviewedAt }));

describe("LicenseReviewed", () => {
  it("offers the button, with an optional note, until it has been done", () => {
    const out = html(null);
    expect(out).toContain("تمت المراجعة");
    expect(out).toContain("ملاحظة (اختياري)");
    expect(out).toContain("يعود إليها إن رصده السجل مفقودًا");
  });

  it("says when it was done, and offers nothing, once it has been", () => {
    const out = html("2026-11-02T12:00:00Z");
    expect(out).toContain("روجع هذا الترخيص في 02/11/2026");
    expect(out).not.toContain("<button");
    expect(out).not.toContain("<input");
  });
});
