// The dashboard's filter panel: what it can narrow a search to, and how that
// travels to /api/search (which passes it to search_directory()).

import type { WorkplaceType } from "@/lib/workplace";

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
