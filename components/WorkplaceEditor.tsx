"use client";

// Workplace rows for /signup and /profile. What a row offers follows the
// doctor's stage (lib/careerStage.ts): which types, whether its
// عيادة asks for address/hours/phone (all optional), and whether any
// workplace is required.
// Input ids (`workplace_<i>_<field>`) are what the missing-fields list
// focuses.

import { useEffect, useState } from "react";
import { Field } from "@/components/FormField";
import { STAGE_BY_KEY, type Stage, workplaceForStage } from "@/lib/careerStage";
import { toAsciiDigits } from "@/lib/normalize/digits";
import {
  CLINIC_FIELD_LABEL,
  CLINIC_FIELD_MAX,
  emptyWorkplace,
  WORKPLACE_TYPE_LABEL,
  WORKPLACE_TYPES,
  type WorkplaceEntry,
  type WorkplaceType,
} from "@/lib/workplace";

type Suggestion = { name: string; kind: "hospital" | "hmo" | "clinic_network" };

// One fetch per page load, shared by every row and both forms.
let suggestions: Promise<Suggestion[]> | null = null;
function loadSuggestions(): Promise<Suggestion[]> {
  suggestions ??= fetch("/api/institutions")
    .then((r) => (r.ok ? r.json() : { institutions: [] }))
    .then((b) => (b.institutions ?? []) as Suggestion[])
    .catch(() => []);
  return suggestions;
}

/** Hospitals for a hospital row; health funds and clinic networks otherwise. */
function Suggestions({ list }: { list: Suggestion[] }) {
  return (
    <>
      <datalist id="institutions-hospital">
        {list.filter((s) => s.kind === "hospital").map((s) => (
          <option key={s.name} value={s.name} />
        ))}
      </datalist>
      <datalist id="institutions-other">
        {list.filter((s) => s.kind !== "hospital").map((s) => (
          <option key={s.name} value={s.name} />
        ))}
      </datalist>
    </>
  );
}

export function WorkplaceEditor({
  workplaces,
  onChange,
  stage,
  optional = false,
}: {
  workplaces: readonly WorkplaceEntry[];
  onChange: (next: WorkplaceEntry[]) => void;
  /** null: a legacy profile that never declared a stage; nothing is coerced. */
  stage: Stage | null;
  /** The doctor is looking for work, so no workplace is required. */
  optional?: boolean;
}) {
  const [known, setKnown] = useState<Suggestion[]>([]);
  useEffect(() => {
    let live = true;
    loadSuggestions().then((l) => live && setKnown(l));
    return () => {
      live = false;
    };
  }, []);
  const opt = stage ? STAGE_BY_KEY[stage] : null;
  const types = opt?.workplaceTypes ?? WORKPLACE_TYPES;
  const showsClinic = opt ? opt.showsClinicFields : true;

  const patch = (i: number, p: Partial<WorkplaceEntry>) =>
    onChange(workplaces.map((w, j) => (j === i ? { ...w, ...p } : w)));

  /** Type changes go through workplaceForStage so clinic fields never
   *  survive a switch into a row that hides them. */
  const setType = (i: number, workplace_type: WorkplaceType) =>
    onChange(
      workplaces.map((w, j) =>
        j !== i
          ? w
          : stage
            ? workplaceForStage({ ...w, workplace_type }, stage)
            : { ...w, workplace_type },
      ),
    );

  const setPrimary = (i: number) =>
    onChange(workplaces.map((w, j) => ({ ...w, is_primary: j === i })));

  const remove = (i: number) => {
    const next = workplaces.filter((_, j) => j !== i);
    if (next.length === 0) return onChange([emptyWorkplace(true, opt?.defaultWorkplaceType)]);
    onChange(
      next.some((w) => w.is_primary)
        ? next
        : next.map((w, j) => (j === 0 ? { ...w, is_primary: true } : w)),
    );
  };

  /** One button per type, so a clinic opens with its fields ready. A blank
   *  last row (the one every form starts with) takes the type instead of
   *  leaving an empty row above the new one. */
  const add = (type: WorkplaceType) => {
    const last = workplaces.length - 1;
    if (last >= 0 && !workplaces[last].name.trim()) return setType(last, type);
    onChange([...workplaces, emptyWorkplace(workplaces.length === 0, type)]);
  };

  return (
    <div className="space-y-4">
      <Suggestions list={known} />
      {workplaces.map((wp, i) => {
        const id = (field: string) => `workplace_${i}_${field}`;
        const clinicOpen = showsClinic && wp.workplace_type === "clinic";
        return (
          <div key={i} className="space-y-3 rounded border border-foreground/15 p-3">
            <div className="flex gap-2">
              <input
                id={id("name")}
                aria-label="اسم مكان العمل"
                required={i === 0 && !opt?.workplaceOptional && !optional}
                className="input flex-1"
                // Suggests the institutions list; anything else can still be typed.
                list={wp.workplace_type === "hospital" ? "institutions-hospital" : "institutions-other"}
                value={wp.name}
                maxLength={120}
                onChange={(e) => patch(i, { name: e.target.value })}
                placeholder="مثلاً: مستشفى هداسا عين كارم"
              />
              {workplaces.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="shrink-0 rounded border border-foreground/20 px-3 text-base hover:bg-foreground/5"
                  aria-label="حذف مكان العمل"
                >
                  حذف
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {types.map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`workplace_type_${i}`}
                    checked={wp.workplace_type === t}
                    onChange={() => setType(i, t)}
                  />
                  {WORKPLACE_TYPE_LABEL[t]}
                </label>
              ))}
              {workplaces.length > 1 && (
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="workplace_primary"
                    checked={wp.is_primary}
                    onChange={() => setPrimary(i)}
                  />
                  مكان العمل الرئيسي
                </label>
              )}
            </div>

            {clinicOpen && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label={`${CLINIC_FIELD_LABEL.address} (اختياري)`} htmlFor={id("address")}>
                    <input
                      id={id("address")}
                      className="input"
                      maxLength={CLINIC_FIELD_MAX.address}
                      value={wp.address}
                      onChange={(e) => patch(i, { address: e.target.value })}
                      placeholder="مثلاً: شارع صلاح الدين ١٢، القدس"
                    />
                  </Field>
                </div>
                <Field label={`${CLINIC_FIELD_LABEL.phone} (اختياري)`} htmlFor={id("phone")}>
                  <input
                    id={id("phone")}
                    type="tel"
                    dir="ltr"
                    inputMode="tel"
                    className="input"
                    maxLength={CLINIC_FIELD_MAX.phone}
                    value={wp.phone}
                    onChange={(e) => patch(i, { phone: toAsciiDigits(e.target.value) })}
                    placeholder="02-6271234"
                  />
                </Field>
                <Field label={`${CLINIC_FIELD_LABEL.hours} (اختياري)`} htmlFor={id("hours")}>
                  <input
                    id={id("hours")}
                    className="input"
                    maxLength={CLINIC_FIELD_MAX.hours}
                    value={wp.hours}
                    onChange={(e) => patch(i, { hours: e.target.value })}
                    placeholder="مثلاً: الأحد-الخميس ٩:٠٠-١٧:٠٠"
                  />
                </Field>
                {wp.details && (
                  <div className="sm:col-span-2">
                    <Field label="ملاحظات (من النسخة السابقة)" htmlFor={id("details")}>
                      <input
                        id={id("details")}
                        className="input"
                        maxLength={300}
                        value={wp.details}
                        onChange={(e) => patch(i, { details: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => add(t)}
            className="rounded border border-dashed border-foreground/30 px-4 py-2 text-base text-foreground/80 hover:bg-foreground/5"
          >
            + إضافة {WORKPLACE_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
