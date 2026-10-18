// Cloudflare Turnstile server-side verification.
//
// Dev convenience: when TURNSTILE_SECRET_KEY is unset, every token is
// accepted. This lets us run signup locally without a Cloudflare site.
// Hard guard in production: throw if the secret is missing.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;

export interface TurnstileResult {
  ok: boolean;
  /** When the secret is unset in dev, returns ok:true with this flag set. */
  bypassed?: boolean;
  errors?: string[];
}

export async function verifyTurnstile(
  token: string | undefined | null,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        errors: ["TURNSTILE_SECRET_KEY is required in production"],
      };
    }
    return { ok: true, bypassed: true };
  }

  if (!token) {
    return { ok: false, errors: ["missing-token"] };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // A hung Cloudflare call must not hold the doctor's request open.
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, errors: ["turnstile-unreachable"] };
  }
  if (!res.ok) {
    return { ok: false, errors: [`turnstile-http-${res.status}`] };
  }
  const json = (await res.json()) as {
    success: boolean;
    "error-codes"?: string[];
  };
  return {
    ok: Boolean(json.success),
    errors: json["error-codes"],
  };
}
