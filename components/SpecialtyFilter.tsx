"use client";

// Custom dropdown for specialty filtering. Replaces native <select> so the
// open list matches the site's dark theme on every device, Android in
// particular renders native selects with stark white-on-grey options that
// look out of place.

import { useEffect, useRef, useState } from "react";
import { groupSpecialties } from "@/lib/specialtyTree";

interface Option {
  id: string;
  name_ar: string;
  parent_id: string | null;
}

const ALL = "كل التخصصات";

export function SpecialtyFilter({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const label = selected ? selected.name_ar : ALL;

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-base hover:bg-foreground/5"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <span aria-hidden="true" className="text-foreground/60">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          // Anchored to the box's left edge (end-0 in RTL) so a list wider
          // than the box grows toward the middle of the screen; the box sits
          // at the left of the search row on a phone, and growing the other
          // way pushed the list, and the page, past the screen edge.
          className="absolute end-0 z-20 mt-1 max-h-[60vh] w-max min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          <Item
            label={ALL}
            selected={value === ""}
            onPick={() => pick("")}
          />
          {/* A parent (الباطنية) matches its subspecialties too; they follow
              it, indented. */}
          {groupSpecialties(options).flatMap((g) => [
            <Item
              key={g.parent.id}
              label={g.parent.name_ar}
              heading={g.children.length > 0}
              selected={value === g.parent.id}
              onPick={() => pick(g.parent.id)}
            />,
            ...g.children.map((c) => (
              <Item
                key={c.id}
                label={c.name_ar}
                nested
                selected={value === c.id}
                onPick={() => pick(c.id)}
              />
            )),
          ])}
        </ul>
      )}
    </div>
  );
}

function Item({
  label,
  selected,
  nested,
  heading,
  onPick,
}: {
  label: string;
  selected: boolean;
  /** A subspecialty, drawn under its parent with a guide line. */
  nested?: boolean;
  /** A specialty with subspecialties under it. */
  heading?: boolean;
  onPick: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={
        "cursor-pointer px-3 hover:bg-foreground/5 " +
        (nested ? "py-1.5 ps-6 text-sm text-muted " : "py-2.5 text-base ") +
        (heading ? "font-semibold " : "") +
        (selected ? "bg-foreground/10 font-medium text-foreground" : "")
      }
    >
      {nested ? <span className="block border-s-2 border-line ps-3">{label}</span> : label}
    </li>
  );
}
