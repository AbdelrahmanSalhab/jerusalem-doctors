// Workplace types, shared by the signup form, the profile editor, the public
// cards and every zod schema that accepts a workplace.
//
// Kept in its own module (rather than inside careerStage.ts) because the
// literal union used to be hand-written in ten places — widening it by hand
// is exactly the kind of edit that gets missed in one of them.

import { z } from "zod";
import { toAsciiDigits } from "@/lib/normalize/digits";

export const WORKPLACE_TYPES = ["hospital", "clinic", "hmo"] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const WORKPLACE_TYPE_LABEL: Record<WorkplaceType, string> = {
  hospital: "مستشفى",
  // Not "عيادة خاصة": a clinic listed here isn't necessarily private.
  clinic: "عيادة",
  hmo: "صندوق مرضى",
};

// A specialist's عيادة carries its own address, hours and phone (0012).
// `details` is the free-text line they replaced; existing rows keep it and
// cards fall back to it.

export const CLINIC_FIELD_MAX = { address: 200, hours: 120, phone: 30 } as const;

export const CLINIC_FIELD_LABEL = {
  address: "عنوان العيادة",
  hours: "ساعات العمل",
  phone: "هاتف العيادة",
} as const;

const PHONE_DIGITS_MIN = 7;
const PHONE_DIGITS_MAX = 15;

/** Loose on purpose: landlines (02-...), mobiles and +970/+972 numbers all
 *  pass. It only has to catch typos, not prove the number rings. */
export function isValidClinicPhone(raw: string): boolean {
  const s = toAsciiDigits(raw).trim();
  if (!/^\+?[\d\s\-().]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  return digits >= PHONE_DIGITS_MIN && digits <= PHONE_DIGITS_MAX;
}

/** Which required clinic fields a named عيادة row still lacks. The caller
 *  decides whether the stage asks for them at all (specialists only). */
export function missingClinicFields(w: {
  name: string;
  workplace_type: WorkplaceType;
  address: string;
  phone: string;
}): ("address" | "phone")[] {
  if (w.workplace_type !== "clinic" || !w.name.trim()) return [];
  const missing: ("address" | "phone")[] = [];
  if (!w.address.trim()) missing.push("address");
  if (!isValidClinicPhone(w.phone)) missing.push("phone");
  return missing;
}

/** "address · hours · phone" for a card, or the legacy details, or null. */
export function workplaceInfoLine(w: {
  address: string | null;
  hours: string | null;
  phone: string | null;
  details: string | null;
}): string | null {
  const line = [w.address, w.hours, w.phone]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");
  return line || w.details?.trim() || null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

/** One workplace as posted by /signup and /profile. Blank optional fields
 *  arrive as null; the clinic phone is stored with ASCII digits. Which
 *  fields a stage *requires* is a form rule (see missingFields), not this. */
export const WorkplaceInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  workplace_type: z.enum(WORKPLACE_TYPES).default("hospital"),
  details: optionalText(300),
  address: optionalText(CLINIC_FIELD_MAX.address),
  hours: optionalText(CLINIC_FIELD_MAX.hours),
  phone: z
    .string()
    .max(CLINIC_FIELD_MAX.phone)
    .nullable()
    .optional()
    .transform((v) => (v ? toAsciiDigits(v).trim() || null : null))
    .refine((v) => v === null || isValidClinicPhone(v), {
      message: "رقم هاتف العيادة غير صالح",
    }),
  is_primary: z.boolean(),
});

/** A workplace row as both forms hold it: every field a string. */
export interface WorkplaceEntry {
  name: string;
  workplace_type: WorkplaceType;
  details: string;
  address: string;
  hours: string;
  phone: string;
  is_primary: boolean;
}

export const emptyWorkplace = (
  isPrimary: boolean,
  workplace_type: WorkplaceType = "hospital",
): WorkplaceEntry => ({
  name: "",
  workplace_type,
  details: "",
  address: "",
  hours: "",
  phone: "",
  is_primary: isPrimary,
});

/** Trimmed, unnamed rows dropped, blanks as null: the request body shape. */
export function cleanWorkplaces(rows: readonly WorkplaceEntry[]) {
  const orNull = (v: string) => v.trim() || null;
  return rows
    .filter((w) => w.name.trim())
    .map((w) => ({
      name: w.name.trim(),
      workplace_type: w.workplace_type,
      details: orNull(w.details),
      address: orNull(w.address),
      hours: orNull(w.hours),
      phone: orNull(w.phone),
      is_primary: w.is_primary,
    }));
}
