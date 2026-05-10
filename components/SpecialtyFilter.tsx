"use client";

// Custom dropdown for specialty filtering. Replaces native <select> so the
// open list matches the site's dark theme on every device — Android in
// particular renders native selects with stark white-on-grey options that
// look out of place.

import { useEffect, useRef, useState } from "react";

interface Option {
  id: string;
  name_ar: string;
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
        className="flex w-full items-center justify-between gap-2 rounded-md border border-foreground/20 bg-transparent px-3 py-3 text-base hover:bg-foreground/5"
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
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-foreground/20 bg-background py-1 shadow-lg"
        >
          <Item
            label={ALL}
            selected={value === ""}
            onPick={() => pick("")}
          />
          {options.map((o) => (
            <Item
              key={o.id}
              label={o.name_ar}
              selected={value === o.id}
              onPick={() => pick(o.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Item({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={
        "cursor-pointer px-3 py-2.5 text-base hover:bg-foreground/5 " +
        (selected ? "bg-foreground/10 font-medium" : "")
      }
    >
      {label}
    </li>
  );
}
