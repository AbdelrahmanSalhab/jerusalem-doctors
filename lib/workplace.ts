// Workplace types, shared by the signup form, the profile editor, the public
// cards and every zod schema that accepts a workplace.
//
// Kept in its own module (rather than inside careerStage.ts) because the
// literal union used to be hand-written in ten places, widening it by hand
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

/** A phone typed into a named row that the server would reject. Blank is
 *  fine: clinic details are optional. */
export function hasInvalidClinicPhone(w: { name: string; phone: string }): boolean {
  return w.name.trim() !== "" && w.phone.trim() !== "" && !isValidClinicPhone(w.phone);
}

/** Which clinic details a named عيادة row still lacks. Optional, so this only
 *  drives the profile's reminder; the caller decides whether the stage shows
 *  them at all (طب عام and specialists). */
export function missingClinicFields(w: {
  name: string;
  /** Only compared with "clinic": a stored row's text column fits as is. */
  workplace_type: WorkplaceType | (string & {});
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

/** A clinic phone as a tap-to-call link: digits, plus a leading +. */
export function clinicTelHref(phone: string | null): string | null {
  const trimmed = phone?.trim() ?? "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** Search links that open a clinic's address in Google Maps and Waze. */
export function mapLinks(address: string | null): { google: string; waze: string } | null {
  const q = address?.trim();
  if (!q) return null;
  const enc = encodeURIComponent(q);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${enc}`,
    waze: `https://waze.com/ul?q=${enc}&navigate=yes`,
  };
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
  // The health fund a clinic belongs to, by its name in the institutions
  // list; the server stores the fund's id (lib/institutions.ts hmoIdsByName).
  hmo: optionalText(120),
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
  /** A clinic's health fund, by name; "" when none. */
  hmo: string;
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
  hmo: "",
  is_primary: isPrimary,
});

/** A doctor_workplaces row as the profile page reads it. */
export interface SavedWorkplace {
  name: string;
  workplace_type: WorkplaceType;
  details: string | null;
  address: string | null;
  hours: string | null;
  phone: string | null;
  /** The clinic's health fund, by name (embedded from institutions). */
  hmo?: { name_ar: string } | { name_ar: string }[] | null;
  is_primary: boolean;
  sort_order: number;
}

/** The fund name of a saved row's embed (a to-one embed the untyped client
 *  may hand back as a list). */
export const hmoNameOf = (hmo: SavedWorkplace["hmo"]): string =>
  (Array.isArray(hmo) ? hmo[0]?.name_ar : hmo?.name_ar) ?? "";

/** The select that reads a SavedWorkplace, fund name included. */
export const SAVED_WORKPLACE_COLUMNS =
  "name, workplace_type, details, address, hours, phone, is_primary, sort_order, hmo:institutions!doctor_workplaces_hmo_id_fkey(name_ar)";

/** Saved rows as form entries (nulls as ""); one empty primary row if none. */
export function toWorkplaceEntries(rows: readonly SavedWorkplace[]): WorkplaceEntry[] {
  if (rows.length === 0) return [emptyWorkplace(true)];
  return rows.map((w) => ({
    name: w.name,
    workplace_type: w.workplace_type,
    details: w.details ?? "",
    address: w.address ?? "",
    hours: w.hours ?? "",
    phone: w.phone ?? "",
    hmo: hmoNameOf(w.hmo),
    is_primary: w.is_primary,
  }));
}

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
      hmo: w.workplace_type === "clinic" ? orNull(w.hmo) : null,
      is_primary: w.is_primary,
    }));
}
