// Unfinished signups: the doctor filled the form and got an SMS code but
// never entered it. The pending_signups row is kept KEEP_DAYS so an admin can
// send a reminder whose link reopens the form filled in, then deleted.

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STAGE_BY_KEY } from "@/lib/careerStage";
import { INITIAL, type FormState } from "@/lib/signup/formState";
import { WORKPLACE_TYPES } from "@/lib/workplace";

export const KEEP_DAYS = 30;

/** The form as the doctor left it, stored with the signup (bytes of JSON). */
export const RESUME_FORM_MAX_BYTES = 16_000;

export const keepCutoff = (now = Date.now()) => new Date(now - KEEP_DAYS * 86_400_000).toISOString();

export const newResumeToken = () => randomBytes(24).toString("base64url");

export const hashResumeToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Deletes unfinished signups older than KEEP_DAYS. Returns how many. */
export async function purgeUnfinished(service: SupabaseClient, now = Date.now()): Promise<number> {
  const { count, error } = await service
    .from("pending_signups")
    .delete({ count: "exact" })
    .lt("created_at", keepCutoff(now));
  if (error) throw new Error(`pending_signups purge failed: ${error.message}`);
  return count ?? 0;
}

/** The stored form back as FormState: every key the form knows, with the
 *  stored value only when it has the right type, so an old or odd snapshot
 *  can never break the form. Consent is always asked again. */
export function toFormState(raw: unknown): FormState {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...INITIAL };
  for (const [k, init] of Object.entries(INITIAL)) {
    const v = src[k];
    if (k === "workplaces") continue;
    if (Array.isArray(init) ? Array.isArray(v) && v.every((x) => typeof x === "string") : typeof v === typeof init && v !== null) {
      out[k] = v;
    }
  }
  if (typeof src.stage === "string" && src.stage in STAGE_BY_KEY) out.stage = src.stage;
  // Snapshots from before clinics had a fund carry no `hmo`.
  const workplaces = Array.isArray(src.workplaces)
    ? src.workplaces.filter(isWorkplace).map((w) => ({ ...w, hmo: typeof w.hmo === "string" ? w.hmo : "" }))
    : [];
  if (workplaces.length > 0) out.workplaces = workplaces;
  out.consent = false;
  out.pledge = false;
  return out as FormState;
}

function isWorkplace(w: unknown): w is FormState["workplaces"][number] {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  return (
    ["name", "details", "address", "hours", "phone"].every((k) => typeof o[k] === "string") &&
    typeof o.is_primary === "boolean" &&
    (WORKPLACE_TYPES as readonly unknown[]).includes(o.workplace_type)
  );
}

/** The form behind a reminder link, or null when the link is unknown or the
 *  signup has been deleted. */
export async function readResumeForm(service: SupabaseClient, token: string): Promise<FormState | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const { data, error } = await service
    .from("pending_signups")
    .select("payload")
    .eq("resume_token_hash", hashResumeToken(token))
    .gte("created_at", keepCutoff())
    .maybeSingle();
  if (error) throw new Error(`pending_signups read failed: ${error.message}`);
  const form = (data?.payload as { resume_form?: unknown } | undefined)?.resume_form;
  return form ? toFormState(form) : null;
}
