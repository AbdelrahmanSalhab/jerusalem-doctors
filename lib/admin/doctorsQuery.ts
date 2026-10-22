// Reading the /admin doctors list from the URL.
//
// The page used to open on the pending queue, which answered "who is waiting"
// but never "who do we have". It opens on everyone now, with the queue one tab
// away, so the filter key keeps its old values: links from /admin/stats and
// from the activity log still mean what they meant.

export const ADMIN_PAGE_SIZE = 25;

/** `tile`: shown as a count box above the list rather than a pill.
 *  `attention`: a non-zero count is work waiting for an admin. */
export const DOCTOR_FILTERS = [
  { key: "all", label: "كل الأطباء", tile: true },
  { key: "pending", label: "بانتظار القبول", tile: true, attention: true },
  { key: "license", label: "ترخيص يحتاج مراجعة", tile: true, attention: true },
  { key: "stage", label: "مقيم والسجل يقول أخصائي", attention: true },
  { key: "clinic", label: "عيادة بلا عنوان أو هاتف", attention: true },
  { key: "hidden", label: "مخفي من الدليل", tile: true },
  { key: "suspended", label: "حساب مغلق / طلب حذف" },
  { key: "approved", label: "مقبولون" },
] as const;

export type DoctorFilter = (typeof DOCTOR_FILTERS)[number]["key"];

const FILTER_KEYS = DOCTOR_FILTERS.map((f) => f.key) as readonly string[];

export const DEFAULT_FILTER: DoctorFilter = "all";

export interface AdminDoctorsParams {
  filter: DoctorFilter;
  q: string;
  /** 1-based. */
  page: number;
  /** The doctor whose panel is open, if any. */
  doctorId: string | null;
  /** Whether that panel is showing the profile editor. In the URL so the
   *  wider panel and the specialties read are decided before first paint,
   *  and so Back closes the editor before the panel. */
  editing: boolean;
}

export type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** The `?doctor=` value. Every admin page that hosts the panel reads it the
 *  same way, so /admin/institutions does not grow its own copy. */
export function readDoctorParam(sp: RawParams): string | null {
  return one(sp.doctor).trim() || null;
}

export function readEditParam(sp: RawParams): boolean {
  return one(sp.edit) === "1";
}

/** The panel's own address on whichever admin page is hosting it. */
export function panelHref(base: string, doctorId: string, opts: { edit?: boolean } = {}): string {
  const qs = new URLSearchParams({ doctor: doctorId });
  if (opts.edit) qs.set("edit", "1");
  return `${base}?${qs.toString()}`;
}

export function parseAdminDoctorsParams(sp: RawParams): AdminDoctorsParams {
  const status = one(sp.status);
  const rawPage = Number(one(sp.page));

  return {
    filter: FILTER_KEYS.includes(status) ? (status as DoctorFilter) : DEFAULT_FILTER,
    q: one(sp.q).trim().slice(0, 100),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1,
    doctorId: readDoctorParam(sp),
    editing: readEditParam(sp),
  };
}

/** The page's own URL, keeping the filter, search and page the admin is on. */
export function adminDoctorsHref(
  params: Pick<AdminDoctorsParams, "filter" | "q" | "page">,
  over: Partial<AdminDoctorsParams> = {},
): string {
  const next = { ...params, ...over };
  const qs = new URLSearchParams();
  // The default filter stays out of the URL, so /admin is the canonical
  // address of the all-doctors view.
  if (next.filter !== DEFAULT_FILTER) qs.set("status", next.filter);
  if (next.q) qs.set("q", next.q);
  if (next.page > 1) qs.set("page", String(next.page));
  if (over.doctorId) qs.set("doctor", over.doctorId);
  if (over.doctorId && over.editing) qs.set("edit", "1");
  const s = qs.toString();
  return s ? `/admin?${s}` : "/admin";
}

export interface PageRange {
  from: number;
  to: number;
}

export function pageRange(page: number, size = ADMIN_PAGE_SIZE): PageRange {
  const from = (page - 1) * size;
  return { from, to: from + size - 1 };
}

export function pageCount(total: number, size = ADMIN_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}
