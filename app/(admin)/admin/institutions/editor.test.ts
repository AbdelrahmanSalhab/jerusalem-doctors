// The institutions tab groups hospitals, funds and networks, and opens each
// institution's doctors by name.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Institution } from "@/lib/institutions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const list: Institution[] = [
  { id: "h1", name_ar: "هداسا (الفرعان)", name_he: "הדסה", kind: "hospital", aliases: ["هداسا"] },
  { id: "f1", name_ar: "كلاليت", name_he: "כללית", kind: "hmo", aliases: [] },
  { id: "f2", name_ar: "مكابي", name_he: "מכבי", kind: "hmo", aliases: [] },
  { id: "n1", name_ar: "تيريم", name_he: "טרם", kind: "clinic_network", aliases: [] },
];

describe("InstitutionsEditor", () => {
  it("groups by type and lists each institution's doctors", async () => {
    const { InstitutionsEditor } = await import("./InstitutionsEditor");
    const html = renderToStaticMarkup(
      createElement(InstitutionsEditor, {
        institutions: list,
        doctors: { f1: [{ id: "d1", name: "ليلى الخطيب" }, { id: "d2", name: "أحمد سلهب" }] },
        unmatched: [{ name: "مقاصد", count: 1, doctors: [{ id: "d3", name: "سامي نعمان" }] }],
      }),
    );
    const order = ["مستشفيات", "صناديق المرضى", "شبكات عيادات"].map((h) => html.indexOf(`>${h}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf("كلاليت")).toBeLessThan(html.lastIndexOf("مكابي"));
    expect(html).toContain("طبيبان");
    expect(html).toContain("ليلى الخطيب");
    expect(html).toContain("لا أطباء");
    expect(html).toContain('<optgroup label="صناديق المرضى">');
  });

  it("names the doctors behind an unlinked name and links them to their panel", async () => {
    const { InstitutionsEditor } = await import("./InstitutionsEditor");
    const html = renderToStaticMarkup(
      createElement(InstitutionsEditor, {
        institutions: list,
        doctors: { f1: [{ id: "d1", name: "ليلى الخطيب" }] },
        unmatched: [
          {
            name: "القدس",
            count: 2,
            doctors: [
              { id: "d3", name: "سامي نعمان" },
              { id: "d4", name: "رنا حدّاد" },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("سامي نعمان");
    expect(html).toContain("رنا حدّاد");
    expect(html).toContain('href="/admin/institutions?doctor=d3"');
    expect(html).toContain('href="/admin/institutions?doctor=d4"');
    // The doctors under an institution are links too.
    expect(html).toContain('href="/admin/institutions?doctor=d1"');
  });
});
