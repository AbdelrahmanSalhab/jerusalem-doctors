// /api/admin/pending-signups/[id], an unfinished signup (/admin/signups).
//   POST    makes the reminder: a fresh link that reopens the form filled in
//           (lib/signup/unfinished.ts) and the WhatsApp message carrying it.
//           A new link replaces the last one.
//   DELETE  drops the signup (a test, a duplicate, or the doctor said no).

import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { requireAdminOrNull } from "@/lib/auth/adminApi";
import { writeAudit } from "@/lib/audit";
import { hashResumeToken, keepCutoff, newResumeToken } from "@/lib/signup/unfinished";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => jsonError(404, { error: "not_found", code: "not_found" });

export function reminderText(firstName: string, link: string): string {
  return [
    `مرحبًا د. ${firstName}،`,
    "بدأتَ التسجيل في دليل أطباء القدس ولم يكتمل. بياناتك محفوظة، وهذا الرابط يفتح النموذج كما تركته لتكمله برسالة تحقق واحدة:",
    link,
  ].join("\n");
}

export const POST = withJsonErrors(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return notFound();

  const token = newResumeToken();
  const service = createSupabaseServiceClient();
  const row = await service
    .from("pending_signups")
    .update({ resume_token_hash: hashResumeToken(token), reminded_at: new Date().toISOString() })
    .eq("id", id)
    .gte("created_at", keepCutoff())
    .select("phone_e164, payload")
    .maybeSingle();
  if (row.error) throw row.error;
  const payload = row.data?.payload as { arabic_first_name?: string; resume_form?: unknown } | undefined;
  // A returning phone's sign-in attempt has no form to reopen.
  if (!row.data || !payload?.resume_form) return notFound();

  const link = `${new URL(req.url).origin}/signup?resume=${token}`;
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "unfinished_signup_reminded",
    metadata: { name: payload.arabic_first_name ?? null },
  });
  return jsonOk({ ok: true, whatsapp: buildWhatsAppLink(row.data.phone_e164, reminderText(payload.arabic_first_name ?? "", link)) });
});

export const DELETE = withJsonErrors(async (_req: Request, ctx: Ctx) => {
  const admin = await requireAdminOrNull();
  if (!admin) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });
  const { id } = await ctx.params;
  if (!z.guid().safeParse(id).success) return notFound();

  const service = createSupabaseServiceClient();
  const row = await service.from("pending_signups").delete().eq("id", id).select("payload").maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return notFound();
  await writeAudit(service, {
    actor_doctor_id: admin.id,
    action: "unfinished_signup_deleted",
    metadata: { name: (row.data.payload as { arabic_first_name?: string }).arabic_first_name ?? null },
  });
  return jsonOk({ ok: true });
});
