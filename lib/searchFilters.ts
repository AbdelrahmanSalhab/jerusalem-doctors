// The dashboard's filter panel: what it can narrow a search to, and how that
// travels to /api/search (which passes it to search_directory()).

import { WORKPLACE_TYPES, type WorkplaceType } from "@/lib/workplace";

export type StageFilter = "specialist" | "resident" | "general";

export interface SearchFilters {
  /** A hospital or health fund (institutions.id), or "". */
  institutionId: string;
  workplaceType: WorkplaceType | "";
  stage: StageFilter | "";
  seekingWork: boolean;
}

export const NO_FILTERS: SearchFilters = { institutionId: "", workplaceType: "", stage: "", seekingWork: false };

export const STAGE_FILTER_LABEL: Record<StageFilter, string> = {
  specialist: "طبيب أخصائي",
  resident: "طبيب مقيم",
  general: "طب عام",
};

/** How many filters are on, for the button's badge. */
export function activeFilterCount(f: SearchFilters): number {
  return [f.institutionId, f.workplaceType, f.stage, f.seekingWork].filter(Boolean).length;
}

/** The filters as /api/search query parameters; unset ones are left out. */
export function setFilterParams(params: URLSearchParams, f: SearchFilters): void {
  if (f.institutionId) params.set("institution_id", f.institutionId);
  if (f.workplaceType) params.set("workplace_type", f.workplaceType);
  if (f.stage) params.set("stage", f.stage);
  if (f.seekingWork) params.set("seeking_work", "1");
}

/** What the dashboard's search is set to. It lives in the page's URL with
 *  the same names /api/search takes, so a reload, or the back button from a
 *  doctor's card, lands on the same results (#177). */
export interface DashboardSearchState {
  q: string;
  specialtyId: string;
  filters: SearchFilters;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES: readonly StageFilter[] = ["specialist", "resident", "general"];

export function searchParamsOf({ q, specialtyId, filters }: DashboardSearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (specialtyId) params.set("specialty_id", specialtyId);
  setFilterParams(params, filters);
  return params;
}

/** The URL is the visitor's to edit: a value /api/search would refuse is
 *  dropped here, so a mangled link opens the plain dashboard. */
export function searchFromParams(params: URLSearchParams): DashboardSearchState {
  const id = (key: string) => {
    const v = params.get(key) ?? "";
    return UUID.test(v) ? v : "";
  };
  const workplaceType = params.get("workplace_type");
  const stage = params.get("stage");
  return {
    q: params.get("q")?.trim() ?? "",
    specialtyId: id("specialty_id"),
    filters: {
      institutionId: id("institution_id"),
      workplaceType: WORKPLACE_TYPES.find((t) => t === workplaceType) ?? "",
      stage: STAGES.find((s) => s === stage) ?? "",
      seekingWork: params.get("seeking_work") === "1",
    },
  };
}
