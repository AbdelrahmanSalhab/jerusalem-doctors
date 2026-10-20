// Email + password sign-in for the developers and QA engineers working on
// this app, who cannot receive a WhatsApp OTP for an account they do not own.
//
// What actually protects this, in order:
//
//  1. The `doctors` row. A session only becomes access when a doctors row
//     carries that auth_user_id (lib/auth/session.ts). A self-registered
//     email account resolves to nothing and gets bounced by the proxy.
//  2. This allowlist. Only the addresses in DEV_LOGIN_EMAILS can use the
//     route at all, whatever Supabase would accept.
//  3. The DEV_LOGIN flag, which has to be set deliberately per environment.
//
// What does NOT protect it, and must not be relied on: the page being at an
// unadvertised path. NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser
// bundle, so anyone can call Supabase's own token endpoint directly with it.
// Once password auth is enabled on a project, the passwords on these few
// accounts are the boundary. Keep them long, unique, and in a password
// manager; turn on Supabase's leaked-password protection and MFA.

/** Addresses allowed to sign in with a password, lowercased. */
export function devLoginEmails(raw: string | undefined = process.env.DEV_LOGIN_EMAILS): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export interface DevLoginEnv {
  DEV_LOGIN?: string;
  DEV_LOGIN_EMAILS?: string;
}

/**
 * Both the flag and a non-empty allowlist are required, so a half-configured
 * environment leaves the door shut rather than open to anyone Supabase would
 * authenticate.
 */
export function devLoginEnabled(env: DevLoginEnv = process.env as DevLoginEnv): boolean {
  return env.DEV_LOGIN === "1" && devLoginEmails(env.DEV_LOGIN_EMAILS).length > 0;
}

export function isAllowedDevEmail(
  email: string,
  allowlist: string[] = devLoginEmails(),
): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && allowlist.includes(normalized);
}
