// One level of specialty nesting (specialties.parent_id, migration 0012).
//
// الباطنية is the only parent today: an internist is asked for their
// subspecialty (الكلى, الروماتيزم, ...) and only that is stored and shown on
// their card. "باطنية عامة" stores the parent itself. Search and the
// specialty filter expand a parent to its children so a query for الباطنية
// still finds every internist.
//
// Pure functions over id arrays, shared by the signup and profile pickers.

export interface SpecialtyNode {
  id: string;
  name_ar: string;
  parent_id: string | null;
}

export interface SpecialtyGroup<T extends SpecialtyNode = SpecialtyNode> {
  parent: T;
  children: T[];
}

/** Subspecialties an internist may pick (still within the overall cap of 5). */
export const MAX_SUBSPECIALTIES = 2;

/** Top-level rows with their children, both in input (sort_order) order. A
 *  child whose parent isn't in the list (deactivated) is shown top-level so
 *  it stays selectable. */
export function groupSpecialties<T extends SpecialtyNode>(
  list: readonly T[],
): SpecialtyGroup<T>[] {
  const ids = new Set(list.map((s) => s.id));
  const isChild = (s: T) => s.parent_id !== null && ids.has(s.parent_id);
  return list
    .filter((s) => !isChild(s))
    .map((parent) => ({
      parent,
      children: list.filter((c) => c.parent_id === parent.id),
    }));
}

const groupIds = (g: SpecialtyGroup) => [g.parent.id, ...g.children.map((c) => c.id)];

export function isGroupActive(selected: readonly string[], g: SpecialtyGroup): boolean {
  return groupIds(g).some((id) => selected.includes(id));
}

/** Open a group on its general option, or close it with everything in it. */
export function toggleGroup(selected: readonly string[], g: SpecialtyGroup): string[] {
  if (!isGroupActive(selected, g)) return [...selected, g.parent.id];
  const drop = new Set(groupIds(g));
  return selected.filter((id) => !drop.has(id));
}

/** The group's general option: the parent alone, no children. */
export function chooseGroupGeneral(selected: readonly string[], g: SpecialtyGroup): string[] {
  const drop = new Set(groupIds(g));
  return [...selected.filter((id) => !drop.has(id)), g.parent.id];
}

/** Toggle one subspecialty. Picking one replaces the general option;
 *  removing the last one falls back to it, so the group never goes blank. */
export function toggleChild(
  selected: readonly string[],
  g: SpecialtyGroup,
  childId: string,
): string[] {
  const childIds = new Set(g.children.map((c) => c.id));
  const chosen = selected.filter((id) => childIds.has(id));
  if (chosen.includes(childId)) {
    const next = selected.filter((id) => id !== childId);
    return chosen.length === 1 ? [...next, g.parent.id] : next;
  }
  if (chosen.length >= MAX_SUBSPECIALTIES) return [...selected];
  return [...selected.filter((id) => id !== g.parent.id), childId];
}

/** `ids` plus the children of any parent in it. */
export function withSubspecialties(
  list: readonly Pick<SpecialtyNode, "id" | "parent_id">[],
  ids: readonly string[],
): string[] {
  const children = list
    .filter((s) => s.parent_id !== null && ids.includes(s.parent_id))
    .map((s) => s.id);
  return Array.from(new Set([...ids, ...children]));
}
