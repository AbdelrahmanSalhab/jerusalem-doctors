import { describe, expect, it } from "vitest";
import { type Institution, institutionsMatching, matchInstitution, matchKey } from "./institutions";
import { INSTITUTIONS_SEED } from "./institutionsSeed";

const LIST: Institution[] = INSTITUTIONS_SEED.map((s) => ({ id: s.name_ar, ...s }));
const m = (name: string, type: "hospital" | "clinic" | "hmo") => matchInstitution(LIST, name, type);

// Every workplace name in production on 2026-10-19, with what it should link to.
const REAL: [string, "hospital" | "clinic" | "hmo", string | null][] = [
  ["טרם", "clinic", "تيريم"],
  ["כללית", "clinic", "كلاليت"],
  ["לב ביתר", "clinic", null],
  ["קופת חולים כללית كوبات حوليم كلاليت", "clinic", "كلاليت"],
  ["רמות ,פסגת זאב", "clinic", null],
  ["القدس", "clinic", null],
  ["تيريم", "clinic", "تيريم"],
  ["صناديق المرضى مؤوحيدت", "clinic", "مئوحيدت"],
  ["صناديق المضى كلاليت", "clinic", "كلاليت"],
  ["عيادات كلاليت السكري الضيخ جراح والموشافاه", "clinic", "كلاليت"],
  ["عيادة خاصة", "clinic", null],
  ["عيادة كلاليت التفسية كريات يوفيل وبيت حنينا", "clinic", "كلاليت"],
  ["عيادة كلاليت بيت صفافا", "clinic", "كلاليت"],
  ["كلاليت -القدس", "clinic", "كلاليت"],
  ["كوبات حوليم كلاليت", "clinic", "كلاليت"],
  ["لؤميت صورباهر", "clinic", "لئوميت"],
  ["لؤوميت و مكابي", "clinic", null],
  ["لئوميت", "clinic", "لئوميت"],
  ["مؤحيدت", "clinic", "مئوحيدت"],
  ["مكابي", "clinic", "مكابي"],
  ["מרפאת יפת השמש", "hmo", null],
  ["مقاصد", "hmo", "المقاصد"],
  ["המרכז הירושלמי לבריאות הנפש-مركز القدس للصحة النفسية- كفار شؤول", "hospital", "مركز القدس للصحة النفسية (كفار شاؤول)"],
  ["משגב לדך", "hospital", "مسغاف لداخ"],
  ["القدس", "hospital", null],
  ["شعري تسيدك- שערי צדק", "hospital", "شعاري تسيدك"],
  ["شعري تصيدق", "hospital", "شعاري تسيدك"],
  ["شعري تصيديق", "hospital", "شعاري تسيدك"],
  ["شعريه تسيدك", "hospital", "شعاري تسيدك"],
  ["طبيبة مقيمة في هداسا العيسوية", "hospital", "هداسا جبل المشارف"],
  ["عيادات كلاليت", "hospital", "كلاليت"],
  ["مستشفى أسوتا", "hospital", "مستشفى أسوتا"],
  ["مستشفى برزلاي", "hospital", "مستشفى برزلاي"],
  ["مستشفى جرياتريا בית בלב", "hospital", "بيت بالب"],
  ["مستشفى شعري تسيدك", "hospital", "شعاري تسيدك"],
  ["مستشفى هداسا عين كارم", "hospital", "هداسا عين كارم"],
  ["مستشفى هشارون", "hospital", "مستشفى هشارون"],
  ["مستشفى وولفسون", "hospital", "مستشفى وولفسون"],
  ["مسجات لداخ موحيدت", "hospital", "مسغاف لداخ"],
  ["مشتشفى اساف هروفا/ شمير", "hospital", "مستشفى أساف هروفيه (شمير)"],
  ["هداسا العيسوية", "hospital", "هداسا جبل المشارف"],
  ["هداسا عين كارم", "hospital", "هداسا عين كارم"],
  ["هداسا هار هتسوفيم", "hospital", "هداسا جبل المشارف"],
  ["هداسا", "hospital", null],
];

describe("matchInstitution on every production workplace name", () => {
  it.each(REAL)("%s (%s) -> %s", (name, type, expected) => {
    expect(m(name, type)).toBe(expected);
  });

  it("links a name that is exactly a spelling, whatever type was picked", () => {
    expect(m("مقاصد", "hmo")).toBe("المقاصد");
    expect(m("المقاصد", "clinic")).toBe("المقاصد");
  });

  it("keeps hospitals to workplaces entered as hospitals", () => {
    expect(m("عيادة العيون في المقاصد", "clinic")).toBeNull();
    expect(m("مستشفى المقاصد", "hospital")).toBe("المقاصد");
  });
});

describe("matchKey", () => {
  it("folds hamza forms, punctuation and Hebrew marks", () => {
    expect(matchKey("لؤوميت-القدس")).toBe(matchKey("لووميت القدس"));
    expect(matchKey("שַׁעֲרֵי צֶדֶק")).toBe("שערי צדק");
  });
});

describe("institutionsMatching (search)", () => {
  it("finds an institution by any spelling, or by part of its name", () => {
    expect(institutionsMatching(LIST, "شعري")).toContain("شعاري تسيدك");
    expect(institutionsMatching(LIST, "כללית")).toEqual(["كلاليت"]);
    expect(institutionsMatching(LIST, "x")).toEqual([]);
  });
});

describe("relinkWorkplaces", () => {
  it("writes only rows whose institution changes, and reports unclaimed names", async () => {
    const { db } = await import("@/test/fakeSupabase");
    const { relinkWorkplaces } = await import("./institutions");
    db.reset();
    db.queue("institutions", {
      data: [
        { id: "szmc", name_ar: "شعاري تسيدك", name_he: "שערי צדק", kind: "hospital", aliases: ["شعري تسيدك"] },
        { id: "clalit", name_ar: "كلاليت", name_he: "כללית", kind: "hmo", aliases: [] },
      ],
    });
    db.queue("doctor_workplaces", {
      data: [
        { id: "w1", name: "مستشفى شعري تسيدك", workplace_type: "hospital", institution_id: null },
        { id: "w2", name: "كلاليت الشيخ جراح", workplace_type: "clinic", institution_id: "clalit" },
        { id: "w3", name: "هداسا", workplace_type: "hospital", institution_id: null },
        { id: "w4", name: "عيادة خاصة", workplace_type: "clinic", institution_id: null },
      ],
    });
    const result = await relinkWorkplaces(db.client as never);
    expect(result).toEqual({ changed: 1, unmatched: [{ name: "هداسا", count: 1 }] });
    expect(db.argsOf("doctor_workplaces", "update")).toEqual([[{ institution_id: "szmc" }]]);
    expect(db.argsOf("doctor_workplaces", "in")).toEqual([["id", ["w1"]]]);
  });
});
