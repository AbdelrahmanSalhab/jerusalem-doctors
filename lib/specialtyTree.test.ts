import { describe, expect, it } from "vitest";
import {
  chooseGroupGeneral,
  groupSpecialties,
  groupForPicker,
  isGroupActive,
  isGroupOpen,
  MAX_SUBSPECIALTIES,
  toggleChild,
  toggleGroup,
  toggleStandalone,
} from "./specialtyTree";

const s = (id: string, parent_id: string | null = null, code: string | null = null) => ({
  id,
  name_ar: id,
  parent_id,
  code,
});

// Input order is sort_order, as every loader queries it.
const LIST = [
  s("general"),
  s("internal"),
  s("peds"),
  s("cardio", "internal", "cardiology"),
  s("nephro", "internal"),
  s("rheum", "internal"),
];

const groups = groupSpecialties(LIST);
const internal = groups.find((g) => g.parent.id === "internal")!;
const peds = groups.find((g) => g.parent.id === "peds")!;

describe("groupSpecialties", () => {
  it("nests children under their parent and keeps sort order", () => {
    expect(groups.map((g) => g.parent.id)).toEqual(["general", "internal", "peds"]);
    expect(internal.children.map((c) => c.id)).toEqual(["cardio", "nephro", "rheum"]);
    expect(peds.children).toEqual([]);
  });

  it("promotes a child whose parent is missing (e.g. deactivated)", () => {
    const g = groupSpecialties([s("cardio", "internal"), s("peds")]);
    expect(g.map((x) => x.parent.id)).toEqual(["cardio", "peds"]);
  });
});

describe("selecting inside a group", () => {
  it("opening a group selects its general option (the parent itself)", () => {
    expect(toggleGroup([], internal)).toEqual(["internal"]);
    expect(isGroupActive(["internal"], internal)).toBe(true);
  });

  it("closing a group drops the parent and every child", () => {
    expect(toggleGroup(["peds", "cardio", "nephro"], internal)).toEqual(["peds"]);
  });

  it("toggles a group without children like a plain checkbox", () => {
    expect(toggleGroup(["internal"], peds)).toEqual(["internal", "peds"]);
    expect(toggleGroup(["peds"], peds)).toEqual([]);
  });

  it("picking a subspecialty replaces the general option", () => {
    expect(toggleChild(["internal"], internal, "nephro")).toEqual(["nephro"]);
  });

  it("allows up to MAX_SUBSPECIALTIES children", () => {
    const two = toggleChild(["cardio"], internal, "nephro");
    expect(two).toEqual(["cardio", "nephro"]);
    expect(MAX_SUBSPECIALTIES).toBe(2);
    expect(toggleChild(two, internal, "rheum")).toEqual(two);
  });

  it("falls back to the general option when the last child is removed", () => {
    expect(toggleChild(["peds", "nephro"], internal, "nephro")).toEqual(["peds", "internal"]);
  });

  it("choosing general clears the group's children", () => {
    expect(chooseGroupGeneral(["peds", "cardio", "nephro"], internal)).toEqual([
      "peds",
      "internal",
    ]);
  });
});

describe("standalone subspecialties (القلب, أمراض الدم, طب الشيخوخة)", () => {
  const picker = groupForPicker(LIST);
  const cardio = picker.find((g) => g.parent.id === "cardio")!;

  it("lists them at the top level too, in sort order, and under their parent", () => {
    expect(picker.map((g) => g.parent.id)).toEqual(["general", "internal", "peds", "cardio"]);
    expect(cardio.children).toEqual([]);
    expect(picker.find((g) => g.parent.id === "internal")!.children.map((c) => c.id)).toEqual([
      "cardio",
      "nephro",
      "rheum",
    ]);
  });

  it("leaves the search filter's grouping alone: nested once", () => {
    expect(groups.map((g) => g.parent.id)).toEqual(["general", "internal", "peds"]);
  });

  it("promotes one whose parent is missing once, not twice", () => {
    const g = groupForPicker([s("cardio", "internal", "cardiology"), s("peds")]);
    expect(g.map((x) => x.parent.id)).toEqual(["cardio", "peds"]);
  });

  it("a cardiologist alone is not an internist", () => {
    expect(isGroupActive(["cardio"], internal)).toBe(false);
    expect(isGroupActive(["nephro"], internal)).toBe(true);
    expect(isGroupActive(["internal"], internal)).toBe(true);
  });

  it("ticks and unticks at the top level like a plain checkbox", () => {
    expect(toggleStandalone(["peds"], internal, "cardio", false)).toEqual(["peds", "cardio"]);
    expect(toggleStandalone(["peds", "cardio"], internal, "cardio", false)).toEqual(["peds"]);
  });

  it("opening الباطنية over a picked one keeps it, as the answer", () => {
    expect(toggleGroup(["cardio"], internal, false)).toEqual(["cardio"]);
    expect(isGroupOpen(["cardio"], internal, true)).toBe(true);
    expect(isGroupOpen(["cardio"], internal, false)).toBe(false);
  });

  it("while الباطنية is open, the top-level box is the same as the one inside", () => {
    expect(toggleStandalone(["internal"], internal, "cardio", true)).toEqual(["cardio"]);
    expect(toggleStandalone(["cardio"], internal, "cardio", true)).toEqual(["internal"]);
    expect(toggleStandalone(["cardio", "nephro"], internal, "rheum", true)).toEqual(["cardio", "nephro"]);
  });

  it("closing الباطنية drops what was picked in it", () => {
    expect(toggleGroup(["cardio", "nephro"], internal, true)).toEqual([]);
  });

  it("never stores the general option twice", () => {
    expect(toggleChild(["internal", "cardio"], internal, "cardio")).toEqual(["internal"]);
  });
});
