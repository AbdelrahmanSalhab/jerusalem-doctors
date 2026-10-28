"use client";

// Specialty checkboxes for /signup and /profile. A specialty with children
// (الباطنية) opens an inline question when ticked: "باطنية عامة" (the parent
// itself) or up to MAX_SUBSPECIALTIES subspecialties. Only what is picked
// there is stored, so the card shows الكلى, not الباطنية. القلب, أمراض الدم
// and طب الشيخوخة are listed there and also at the top level, for doctors
// who trained in them directly. Selection rules live in
// lib/specialtyTree.ts.

import { useState } from "react";
import {
  chooseGroupGeneral,
  groupForPicker,
  hasSelection,
  isGroupOpen,
  isStandalone,
  MAX_SUBSPECIALTIES,
  type SpecialtyGroup,
  type SpecialtyNode,
  toggleChild,
  toggleGroup,
  toggleStandalone,
} from "@/lib/specialtyTree";

export const MAX_SPECIALTIES = 5;

const UP_TO: Record<number, string> = { 1: "تخصص واحد", 2: "تخصصين" };

export function SpecialtyPicker({
  id,
  specialties,
  selected,
  onChange,
}: {
  /** Focus target for the missing-fields list. */
  id: string;
  specialties: readonly SpecialtyNode[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const groups = groupForPicker(specialties);
  /** Groups whose question the doctor opened: it stays open while a
   *  standalone subspecialty inside it is picked (lib/specialtyTree.ts). */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (g: SpecialtyGroup) =>
    g.children.length > 0 && isGroupOpen(selected, g, opened.has(g.parent.id));
  const parentOf = new Map(groups.flatMap((g) => g.children.map((c) => [c.id, g] as const)));
  const commit = (next: string[], keep?: string, close?: string) => {
    setOpened((prev) => {
      const out = new Set(prev);
      for (const g of groups) if (isOpen(g)) out.add(g.parent.id);
      if (keep) out.add(keep);
      if (close) out.delete(close);
      return out;
    });
    onChange(next);
  };
  /** A change that would break the cap, or that the rules refused, is
   *  offered disabled rather than silently ignored. */
  const blocked = (next: string[]) =>
    next.length > MAX_SPECIALTIES ||
    (next.length === selected.length && next.every((x, i) => x === selected[i]));

  return (
    <div
      id={id}
      tabIndex={-1}
      className="max-h-96 space-y-1 overflow-y-auto rounded border border-foreground/15 p-2"
    >
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {groups.map((g) => {
          const parentGroup = isStandalone(g.parent) ? parentOf.get(g.parent.id) : undefined;
          const open = isOpen(g);
          const checked = g.children.length > 0 ? open : selected.includes(g.parent.id);
          const next = parentGroup
            ? toggleStandalone(selected, parentGroup, g.parent.id, opened.has(parentGroup.parent.id))
            : toggleGroup(selected, g, opened.has(g.parent.id));
          // Opening a group over a standalone pick leaves the selection as is.
          const opensOverPick = g.children.length > 0 && hasSelection(selected, g);
          const disabled = !checked && !opensOverPick && blocked(next);
          return (
            <div key={g.parent.id} className={open ? "sm:col-span-2" : undefined}>
              <label className="flex items-center gap-2 rounded p-1 hover:bg-foreground/5">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => commit(next, open || g.children.length === 0 ? undefined : g.parent.id, open ? g.parent.id : undefined)}
                />
                <span>{g.parent.name_ar}</span>
              </label>
              {open && (
                <SubspecialtyQuestion
                  group={g}
                  selected={selected}
                  onChange={commit}
                  blocked={blocked}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubspecialtyQuestion({
  group,
  selected,
  onChange,
  blocked,
}: {
  group: SpecialtyGroup;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  blocked: (next: string[]) => boolean;
}) {
  const general = selected.includes(group.parent.id);
  return (
    <fieldset className="ms-6 mt-1 rounded border border-foreground/10 bg-foreground/5 p-3">
      <legend className="px-1 text-sm font-medium">
        ما تخصصك الفرعي في {group.parent.name_ar}؟ (اختر حتى{" "}
        {UP_TO[MAX_SUBSPECIALTIES] ?? MAX_SUBSPECIALTIES})
      </legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded p-1 hover:bg-foreground/5">
          <input
            type="checkbox"
            checked={general}
            onChange={() => onChange(chooseGroupGeneral(selected, group))}
          />
          <span>{group.parent.name_ar} العامة (بدون تخصص فرعي)</span>
        </label>
        {group.children.map((c) => {
          const checked = selected.includes(c.id);
          const next = toggleChild(selected, group, c.id);
          return (
            <label key={c.id} className="flex items-center gap-2 rounded p-1 hover:bg-foreground/5">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && blocked(next)}
                onChange={() => onChange(next)}
              />
              <span>{c.name_ar}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
