"use client";

// The dashboard's filter row: التخصص، مكان العمل، المرحلة، يبحث عن عمل.
// «مكان العمل» holds both the kind of workplace (any hospital, clinic or
// health fund) and the specific places, with a search box for the places.

import { useState } from "react";
import { ChipMenu, MenuGroup, MenuList, MenuOption, ToggleChip } from "@/components/FilterChips";
import { INSTITUTION_KIND_LABEL, type InstitutionKind } from "@/lib/institutions";
import { normalizeArabic } from "@/lib/normalize/arabic";
import { activeFilterCount, NO_FILTERS, STAGE_FILTER_LABEL, type SearchFilters, type StageFilter } from "@/lib/searchFilters";
import { groupSpecialties } from "@/lib/specialtyTree";
import type { WorkplaceType } from "@/lib/workplace";

export interface FilterInstitution {
  id: string;
  name_ar: string;
  kind: InstitutionKind;
  /** Listed doctors who work there. */
  count: number;
}

interface Specialty {
  id: string;
  name_ar: string;
  parent_id: string | null;
}

const ANY_OF_TYPE: Record<WorkplaceType, string> = {
  hospital: "كل المستشفيات",
  clinic: "كل العيادات",
  hmo: "كل صناديق المرضى",
};
const KIND_ORDER: InstitutionKind[] = ["hospital", "hmo", "clinic_network"];
/** More places than this and the list gets a search box. */
const SEARCHABLE = 8;

export function SearchFilterChips({
  specialties,
  specialtyId,
  onSpecialty,
  institutions,
  filters,
  onFilters,
}: {
  specialties: Specialty[];
  specialtyId: string;
  onSpecialty: (id: string) => void;
  institutions: FilterInstitution[];
  filters: SearchFilters;
  onFilters: (next: SearchFilters) => void;
}) {
  const set = (patch: Partial<SearchFilters>) => onFilters({ ...filters, ...patch });
  const specialty = specialties.find((s) => s.id === specialtyId);
  const place = filters.institutionId
    ? institutions.find((i) => i.id === filters.institutionId)?.name_ar ?? null
    : filters.workplaceType
      ? ANY_OF_TYPE[filters.workplaceType]
      : null;
  const anyActive = Boolean(specialtyId) || activeFilterCount(filters) > 0;

  return (
    <div className="relative flex flex-wrap items-center gap-2" role="group" aria-label="تصفية البحث">
      <ChipMenu label="التخصص" selected={specialty?.name_ar ?? null} onClear={() => onSpecialty("")}>
        <MenuList label="التخصص">
          {/* A parent (الباطنية) matches its subspecialties too; they
              follow it, indented. */}
          {groupSpecialties(specialties).flatMap((g) => [
            <MenuOption
              key={g.parent.id}
              label={g.parent.name_ar}
              heading={g.children.length > 0}
              selected={specialtyId === g.parent.id}
              onPick={() => onSpecialty(g.parent.id)}
            />,
            ...g.children.map((c) => (
              <MenuOption
                key={c.id}
                label={c.name_ar}
                nested
                selected={specialtyId === c.id}
                onPick={() => onSpecialty(c.id)}
              />
            )),
          ])}
        </MenuList>
      </ChipMenu>

      <ChipMenu label="مكان العمل" selected={place} onClear={() => set({ institutionId: "", workplaceType: "" })}>
        <PlaceList
          institutions={institutions}
          filters={filters}
          pick={(patch) => set(patch)}
        />
      </ChipMenu>

      <ChipMenu
        label="المرحلة"
        selected={filters.stage ? STAGE_FILTER_LABEL[filters.stage] : null}
        onClear={() => set({ stage: "" })}
      >
        <MenuList label="المرحلة">
          {(Object.keys(STAGE_FILTER_LABEL) as StageFilter[]).map((s) => (
            <MenuOption
              key={s}
              label={STAGE_FILTER_LABEL[s]}
              selected={filters.stage === s}
              onPick={() => set({ stage: s })}
            />
          ))}
        </MenuList>
      </ChipMenu>

      <ToggleChip label="يبحث عن عمل" on={filters.seekingWork} onChange={(on) => set({ seekingWork: on })} />

      {anyActive && (
        <button
          type="button"
          onClick={() => {
            onSpecialty("");
            onFilters(NO_FILTERS);
          }}
          className="px-1 text-sm text-muted underline hover:text-foreground"
        >
          مسح الكل
        </button>
      )}
    </div>
  );
}

function PlaceList({
  institutions,
  filters,
  pick,
}: {
  institutions: FilterInstitution[];
  filters: SearchFilters;
  pick: (patch: Partial<SearchFilters>) => void;
}) {
  const [q, setQ] = useState("");
  const term = normalizeArabic(q);
  const shown = term ? institutions.filter((i) => normalizeArabic(i.name_ar).includes(term)) : institutions;
  return (
    <>
      {institutions.length > SEARCHABLE && (
        <div className="px-2 pb-1 pt-1.5">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن مكان"
            aria-label="ابحث عن مكان عمل"
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-base"
          />
        </div>
      )}
      <MenuList label="مكان العمل">
        {!term && (
          <>
            <MenuGroup title="النوع" />
            {(Object.keys(ANY_OF_TYPE) as WorkplaceType[]).map((t) => (
              <MenuOption
                key={t}
                label={ANY_OF_TYPE[t]}
                selected={!filters.institutionId && filters.workplaceType === t}
                onPick={() => pick({ workplaceType: t, institutionId: "" })}
              />
            ))}
          </>
        )}
        {KIND_ORDER.flatMap((kind) => {
          const group = shown.filter((i) => i.kind === kind);
          return group.length === 0
            ? []
            : [
                <MenuGroup key={`g-${kind}`} title={INSTITUTION_KIND_LABEL[kind]} />,
                ...group.map((i) => (
                  <MenuOption
                    key={i.id}
                    label={i.name_ar}
                    hint={i.count}
                    selected={filters.institutionId === i.id}
                    onPick={() => pick({ institutionId: i.id, workplaceType: "" })}
                  />
                )),
              ];
        })}
        {term && shown.length === 0 && <MenuGroup title="لا يوجد مكان بهذا الاسم" />}
      </MenuList>
    </>
  );
}
