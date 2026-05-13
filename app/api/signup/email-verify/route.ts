// GET /api/signup/email-verify?token=...
// Consumes the HMAC-signed verification token and marks the email verified.
// Returns a small RTL HTML confirmation page rather than JSON, since the
// caller is a click from the user's email client.

import { ipFromHeaders, jsonError } from "@/lib/api/respond";
import { rateLimit } from "@/lib/ratelimit";
import { verifyEmailToken } from "@/lib/signup/email-token";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = ipFromHeaders(req);
  // Per-IP rate limit: verification links are sent via email and may be
  // forwarded or pasted, so doctor-session gating is not appropriate here.
  const rl = await rateLimit("signupEmailVerify", `ip:${ip}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  const result = verifyEmailToken(token);
  if (!result.ok) {
    return htmlPage(400, {
      title: "رابط غير صالح",
      message:
        result.reason === "expired"
          ? "انتهت صلاحية هذا الرابط. يمكنك طلب رابط جديد من صفحة تسجيل الدخول."
          : "هذا الرابط غير صالح.",
    });
  }

  const service = createSupabaseServiceClient();

  // Token always targets a doctor row (no pending-row path; tokens are issued post-OTP).
  const doctor = await service
    .from("doctors")
    .select("id, email_verified_at")
    .eq("id", result.id)
    .maybeSingle();
  if (doctor.error && doctor.error.code !== "PGRST116") throw doctor.error;
  if (!doctor.data) {
    return htmlPage(410, {
      title: "حساب غير موجود",
      message: "تواصل مع الإدارة إذا كنت تعتقد أن هذا خطأ.",
    });
  }
  if (!doctor.data.email_verified_at) {
    await service
      .from("doctors")
      .update({ email_verified_at: new Date().toISOString() })
      .eq("id", doctor.data.id);
    await service.from("audit_logs").insert({
      actor_doctor_id: doctor.data.id,
      action: "email_verified",
      target_doctor_id: doctor.data.id,
    });
  }
  return htmlPage(200, {
    title: "تم التحقق من بريدك",
    message: "ستظهر حالة التحقق للإدارة عند مراجعة طلبك.",
  });
}

function htmlPage(
  status: number,
  body: { title: string; message: string },
): Response {
  const safeTitle = escapeHtml(body.title);
  const safeMessage = escapeHtml(body.message);
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${safeTitle}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 64px auto; padding: 24px; text-align: center;">
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <p><a href="/">العودة للصفحة الرئيسية</a></p>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
