// POST /api/profile/password: an admin changes the password of their email
// sign-in (/login/dev, lib/auth/devLogin.ts), then every other session of
// theirs is signed out, so a password that may have leaked, and anything
// signed in with it, stop working: renewal at once, and a session's current
// token when it expires, within the hour (jwt_expiry; lib/auth/session.ts
// verifies tokens by signature).
//
// Admins only: they are the accounts with a password at all. The current
// password is checked first, so a session someone else got hold of cannot
// lock its owner out.

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { jsonError, jsonOk, withJsonErrors } from "@/lib/api/respond";
import { writeAudit } from "@/lib/audit";
import { requireDoctor } from "@/lib/auth/session";
import { rateLimit } from "@/lib/ratelimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** Long enough that a password manager's is the easy way to meet it. */
export const MIN_PASSWORD = 16;

const Body = z
  .object({
    current: z.string().min(1).max(200),
    next: z.string().min(MIN_PASSWORD).max(200),
  })
  .refine((b) => b.current !== b.next, { path: ["next"] });

/** Whether `password` is this user's current one, without touching the
 *  caller's own session: a separate client that keeps nothing. */
async function passwordMatches(email: string, password: string): Promise<boolean> {
  const check = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await check.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  // That sign-in made a session of its own; end it.
  await check.auth.signOut({ scope: "local" });
  return true;
}

export const POST = withJsonErrors(async (req: Request) => {
  const me = await requireDoctor().catch(() => null);
  if (!me?.is_admin || !me.auth_user_id) return jsonError(401, { error: "unauthenticated", code: "unauthenticated" });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, { error: "invalid_body", code: "invalid_body" });

  const rl = await rateLimit("passwordChange", `doctor:${me.id}`);
  if (!rl.success) return jsonError(429, { error: "rate_limited", code: "rate_limited" });

  const service = createSupabaseServiceClient();
  const user = await service.auth.admin.getUserById(me.auth_user_id);
  const email = user.data.user?.email;
  if (!email) return jsonError(400, { error: "no_password_login", code: "no_password_login" });

  if (!(await passwordMatches(email, parsed.data.current))) {
    return jsonError(400, { error: "wrong_password", code: "wrong_password" });
  }

  const updated = await service.auth.admin.updateUserById(me.auth_user_id, { password: parsed.data.next });
  if (updated.error) {
    // Supabase's own rules (a leaked or weak password) refuse it here.
    return jsonError(400, { error: "weak_password", code: "weak_password" });
  }

  // Every session but this one: other browsers, and anyone else holding one.
  const ssr = await createSupabaseServerClient();
  const { data: own } = await ssr.auth.getSession();
  if (own.session) await service.auth.admin.signOut(own.session.access_token, "others");

  await writeAudit(service, {
    actor_doctor_id: me.id,
    action: "password_changed",
    target_doctor_id: me.id,
    metadata: {},
  });
  return jsonOk({ ok: true });
});
