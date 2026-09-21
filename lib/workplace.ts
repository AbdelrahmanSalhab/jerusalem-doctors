// Workplace types, shared by the signup form, the profile editor, the public
// cards and every zod schema that accepts a workplace.
//
// Kept in its own module (rather than inside careerStage.ts) because the
// literal union used to be hand-written in ten places — widening it by hand
// is exactly the kind of edit that gets missed in one of them.

export const WORKPLACE_TYPES = ["hospital", "clinic", "hmo"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const WORKPLACE_TYPE_LABEL: Record<WorkplaceType, string> = {
  hospital: "مستشفى",
  // Not "عيادة خاصة": a clinic listed here isn't necessarily private.
  clinic: "عيادة",
  hmo: "صندوق مرضى",
};
