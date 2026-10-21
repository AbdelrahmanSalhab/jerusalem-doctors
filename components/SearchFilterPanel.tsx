"use client";

// The dashboard's «تصفية» panel: where a doctor works (a hospital or fund,
// and the kind of workplace), their career stage, and whether they are
// looking for work. Native controls on purpose: they are the accessible
// pickers phones already know. lib/searchFilters.ts carries the values.

import { useId, useState } from "react";
import { INSTITUTION_KIND_LABEL, type InstitutionKind } from "@/lib/institutions";
import { activeFilterCount, NO_FILTERS, STAGE_FILTER_LABEL, type SearchFilters, type StageFilter } from "@/lib/searchFilters";
import { WORKPLACE_TYPE_LABEL, WORKPLACE_TYPES, type WorkplaceType } from "@/lib/workplace";

export interface FilterInstitution {
  id: string;
  name_ar: string;
  kind: InstitutionKind;
  /** Listed doctors who work there. */
  count: number;
}

const KIND_ORDER: InstitutionKind[] = ["hospital", "hmo", "clinic_network"];
const SELECT = "w-full rounded-md border border-line bg-surface px-3 py-2.5 text-base";

export function SearchFilterPanel({
  institutions,
  value,
  onChange,
}: {
  institutions: FilterInstitution[];
  value: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const active = activeFilterCount(value);
  const set = <K extends keyof SearchFilters>(key: K, v: SearchFilters[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm hover:border-foreground/40"
        >
          تصفية
          {active > 0 && (
            <span className="rounded-full bg-foreground px-1.5 text-xs text-background" aria-label={`${active} مفعّلة`}>
              {active}
            </span>
          )}
        </button>
        {active > 0 && (
          <button type="button" onClick={() => onChange(NO_FILTERS)} className="text-sm text-muted underline">
            مسح التصفية
          </button>
        )}
      </div>

      {open && (
        <div
          id={`${id}-panel`}
          className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">مكان العمل</span>
            <select value={value.institutionId} onChange={(e) => set("institutionId", e.target.value)} className={SELECT}>
              <option value="">كل الأماكن</option>
              {KIND_ORDER.map((kind) => {
                const group = institutions.filter((i) => i.kind === kind);
                return group.length === 0 ? null : (
                  <optgroup key={kind} label={INSTITUTION_KIND_LABEL[kind]}>
                    {group.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name_ar} ({i.count})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">نوع مكان العمل</span>
            <select
              value={value.workplaceType}
              onChange={(e) => set("workplaceType", e.target.value as WorkplaceType | "")}
              className={SELECT}
            >
              <option value="">الكل</option>
              {WORKPLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {WORKPLACE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">المرحلة المهنية</span>
            <select
              value={value.stage}
              onChange={(e) => set("stage", e.target.value as StageFilter | "")}
              className={SELECT}
            >
              <option value="">الكل</option>
              {(Object.keys(STAGE_FILTER_LABEL) as StageFilter[]).map((s) => (
                <option key={s} value={s}>
                  {STAGE_FILTER_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 self-end py-2.5 text-sm">
            <input type="checkbox" checked={value.seekingWork} onChange={(e) => set("seekingWork", e.target.checked)} />
            يبحث عن فرصة عمل
          </label>
        </div>
      )}
    </div>
  );
}
