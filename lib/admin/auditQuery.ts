// Reading the /admin/audit filters from the URL, so a filtered view can be
// bookmarked, shared, and paged through without losing the filter.

import { AUDIT_ACTIONS } from "@/lib/auditText";
import type { RawParams } from "@/lib/admin/doctorsQuery";

export interface AuditParams {
  /** One of AUDIT_ACTIONS, or "" for every event. */
  action: string;
  /** A doctor's name, licence or phone. */
  q: string;
  /** YYYY-MM-DD, Jerusalem days, both inclusive; "" for open-ended. */
  from: string;
  to: string;
  /** Hide the automatic events. */
  people: boolean;
  /** 1-based. */
  page: number;
}

function one(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
}

/** A real calendar day, or "". */
function day(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) ? v : "";
}

export function parseAuditParams(sp: RawParams): AuditParams {
  const action = one(sp.action);
  const page = Math.floor(Number(one(sp.page)));
  return {
    action: AUDIT_ACTIONS.includes(action) ? action : "",
    q: one(sp.q).slice(0, 100),
    from: day(one(sp.from)),
    to: day(one(sp.to)),
    people: one(sp.people) === "1",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export function isFiltered(p: AuditParams): boolean {
  return Boolean(p.action || p.q || p.from || p.to || p.people);
}

export function auditHref(p: AuditParams, over: Partial<AuditParams> = {}): string {
  const next = { ...p, ...over };
  const qs = new URLSearchParams();
  if (next.action) qs.set("action", next.action);
  if (next.q) qs.set("q", next.q);
  if (next.from) qs.set("from", next.from);
  if (next.to) qs.set("to", next.to);
  if (next.people) qs.set("people", "1");
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString();
  return s ? `/admin/audit?${s}` : "/admin/audit";
}
