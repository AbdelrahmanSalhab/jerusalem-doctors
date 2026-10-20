// POST /api/login/password
//
// Email + password sign-in for developers and QA, who cannot receive the
// WhatsApp OTP for an account they do not own. Off unless DEV_LOGIN=1 and
// DEV_LOGIN_EMAILS lists the address; see lib/auth/devLogin.ts for what in
// this arrangement actually protects it (and what does not).
//
// Every failure answers the same way. Distinguishing "not on the allowlist"
// from "wrong password" would turn this route into a way to discover which
// addresses are allowlisted, which is the one thing worth knowing about it.

import { z } from "zod";
import { ipFromHeaders, jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { devLoginEnabled, isAllowedDevEmail } from "@/lib/auth/devLogin";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

/** One answer for every way this can fail. */
const refuse = () => jsonError(401, { error: "invalid_credentials", code: "invalid_credentials" });

export const POST = withJsonErrors(async (req: Request) => {
  // Not merely hidden: with the flag unset the route denies that it exists.
  if (!devLoginEnabled()) {
    return jsonError(404, { error: "not_found", code: "not_found" });
  }

  const ip = ipFromHeaders(req);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return refuse();
  }

  const email = body.email.toLowerCase();

  // Per address and per IP: a leaked password is the real risk here, so
  // guessing against one is kept slow even from many addresses.
  const [rl, rlIp] = await Promise.all([
    rateLimit("devLogin", `email:${email}`),
    rateLimit("devLoginIp", `ip:${ip}`),
  ]);
  if (!rl.success || !rlIp.success) {
    return jsonError(429, { error: "rate_limited", code: "rate_limited" });
  }

  if (!isAllowedDevEmail(email)) return refuse();

  const ssr = await createSupabaseServerClient();
  const signIn = await ssr.auth.signInWithPassword({ email, password: body.password });
  if (signIn.error || !signIn.data.user) return refuse();

  // A session is only access once a doctors row claims it, which is what
  // getCurrentDoctor resolves. An auth user with no row would otherwise hold
  // a valid session that every page bounces, so refuse it here and drop the
  // cookies rather than leave a half-signed-in browser.
  const service = createSupabaseServiceClient();
  const doctor = await service
    .from("doctors")
    .select("id, is_active, is_admin, is_admin_approved")
    .eq("auth_user_id", signIn.data.user.id)
    .maybeSingle();

  if (!doctor.data || !doctor.data.is_active) {
    await ssr.auth.signOut();
    return refuse();
  }

  // Password sign-ins bypass the phone-verification guarantee every other
  // account rests on, so each one is on the record.
  await writeAudit(service, {
    actor_doctor_id: doctor.data.id,
    action: "dev_password_login",
    target_doctor_id: doctor.data.id,
    metadata: { email, is_admin: doctor.data.is_admin },
  });

  return jsonOk({ ok: true, is_admin_approved: doctor.data.is_admin_approved });
});
