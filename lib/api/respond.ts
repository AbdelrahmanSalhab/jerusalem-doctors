// Tiny helper for consistent JSON responses across all route handlers.
import { NextResponse } from "next/server";

export interface ApiErrorBody {
  error: string;
  code?: string;
  fields?: Record<string, string>;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function jsonError(
  status: number,
  body: ApiErrorBody,
): NextResponse {
  return NextResponse.json(body, { status });
}

export function ipFromHeaders(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown";
  const real = req.headers.get("x-real-ip");
  return real ?? "unknown";
}

/**
 * Wraps a route handler so an unexpected throw (bad env config, a Supabase
 * client error we didn't anticipate, etc.) always comes back as JSON.
 * Without this, Next's default error page is HTML — the client's
 * `res.json()` then throws, and the user sees a generic "server connection
 * error" with zero information for us to act on. Every route handler should
 * be wrapped with this.
 */
export function withJsonErrors<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<NextResponse>,
): (req: Request, ...args: Args) => Promise<NextResponse> {
  return async (req, ...args) => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      console.error(`[${new URL(req.url).pathname}] unhandled error`, err);
      return jsonError(500, { error: "internal_error", code: "internal_error" });
    }
  };
}
