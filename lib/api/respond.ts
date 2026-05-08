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
