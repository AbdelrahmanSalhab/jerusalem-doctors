import { describe, expect, it } from "vitest";
import {
  chooseGroupGeneral,
  groupSpecialties,
  isGroupActive,
  MAX_SUBSPECIALTIES,
  toggleChild,
  toggleGroup,
  withSubspecialties,
} from "./specialtyTree";

const s = (id: string, parent_id: string | null = null) => ({
  id,
  name_ar: id,
  parent_id,
});

// Input order is sort_order, as every loader queries it.
const LIST = [
  s("general"),
  s("internal"),
  s("peds"),
  s("cardio", "internal"),
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

describe("withSubspecialties", () => {
  // Searching or filtering by الباطنية must still find a nephrologist, who
  // is stored under the child only.
  it("adds every child of a selected parent", () => {
    expect(withSubspecialties(LIST, ["internal"]).sort()).toEqual(
      ["cardio", "internal", "nephro", "rheum"].sort(),
    );
  });

  it("leaves leaf ids alone", () => {
    expect(withSubspecialties(LIST, ["nephro", "peds"])).toEqual(["nephro", "peds"]);
  });
});
