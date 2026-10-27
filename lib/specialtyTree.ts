// One level of specialty nesting (specialties.parent_id, migration 0012).
//
// الباطنية is the only parent today: an internist is asked for their
// subspecialty (الكلى, الروماتيزم, ...) and only that is stored and shown on
// their card. "باطنية عامة" stores the parent itself. Search and the
// specialty filter expand a parent to its children so a query for الباطنية
// still finds every internist.
//
// Three of them (STANDALONE_CODES) can also be held without being an
// internist, so the pickers list them at the top level as well as under
// الباطنية. It is the same row either way: the id is stored once, and a
// search for الباطنية still finds it through parent_id.
//
// Pure functions over id arrays, shared by the signup and profile pickers.

export interface SpecialtyNode {
  id: string;
  name_ar: string;
  parent_id: string | null;
  code?: string | null;
}

export interface SpecialtyGroup<T extends SpecialtyNode = SpecialtyNode> {
  parent: T;
  children: T[];
}

/** Subspecialties an internist may pick (still within the overall cap of 5). */
export const MAX_SUBSPECIALTIES = 2;

/** Subspecialties of الباطنية that doctors also train in directly:
 *  القلب, أمراض الدم and طب الشيخوخة. By `code`, which an admin can't edit
 *  (migration 0012). */
export const STANDALONE_CODES: ReadonlySet<string> = new Set(["cardiology", "hematology", "geriatrics"]);

export const isStandalone = (s: SpecialtyNode): boolean => s.code != null && STANDALONE_CODES.has(s.code);

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

/** The picker's list: groupSpecialties, plus each standalone subspecialty
 *  again at the top level, in sort order. (The search filter keeps using
 *  groupSpecialties: it nests them once.) */
export function groupForPicker<T extends SpecialtyNode>(list: readonly T[]): SpecialtyGroup<T>[] {
  const ids = new Set(list.map((s) => s.id));
  const isChild = (s: T) => s.parent_id !== null && ids.has(s.parent_id);
  return list
    .filter((s) => !isChild(s) || isStandalone(s))
    .map((parent) => ({
      parent,
      children: list.filter((c) => c.parent_id === parent.id),
    }));
}

const groupIds = (g: SpecialtyGroup) => [g.parent.id, ...g.children.map((c) => c.id)];

export const hasSelection = (selected: readonly string[], g: SpecialtyGroup) =>
  groupIds(g).some((id) => selected.includes(id));

/** The group is an internist's: the general option, or a subspecialty
 *  that only an internist has. A standalone one alone doesn't make a
 *  cardiologist an internist. */
export function isGroupActive(selected: readonly string[], g: SpecialtyGroup): boolean {
  return (
    selected.includes(g.parent.id) ||
    g.children.some((c) => !isStandalone(c) && selected.includes(c.id))
  );
}

/** Whether the group's question is showing. `opened`: the doctor opened it
 *  (the picker remembers), so picking a standalone subspecialty inside it
 *  doesn't make it vanish. */
export function isGroupOpen(selected: readonly string[], g: SpecialtyGroup, opened: boolean): boolean {
  return isGroupActive(selected, g) || (opened && hasSelection(selected, g));
}

/** Open a group on its general option, or close it with everything in it.
 *  A standalone subspecialty already picked counts as the answer: opening
 *  leaves the selection alone. */
export function toggleGroup(selected: readonly string[], g: SpecialtyGroup, opened = false): string[] {
  if (!isGroupOpen(selected, g, opened)) {
    return hasSelection(selected, g) ? [...selected] : [...selected, g.parent.id];
  }
  const drop = new Set(groupIds(g));
  return selected.filter((id) => !drop.has(id));
}

/** A standalone subspecialty ticked at the top level. While الباطنية's
 *  question is showing it is the same as ticking it there; otherwise it is
 *  a plain checkbox, and does not make the doctor an internist. */
export function toggleStandalone(
  selected: readonly string[],
  parent: SpecialtyGroup,
  id: string,
  parentOpened: boolean,
): string[] {
  if (isGroupOpen(selected, parent, parentOpened)) return toggleChild(selected, parent, id);
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
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
    return chosen.length === 1 && !next.includes(g.parent.id) ? [...next, g.parent.id] : next;
  }
  if (chosen.length >= MAX_SUBSPECIALTIES) return [...selected];
  return [...selected.filter((id) => id !== g.parent.id), childId];
}
