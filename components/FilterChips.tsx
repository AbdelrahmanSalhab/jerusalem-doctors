"use client";

// The search filters as one row of chips (the pattern Google, Airbnb and
// Doximity use): each chip opens a short list; a chosen chip turns solid,
// shows its value and gets an ✕. Custom lists rather than native <select>,
// so they match the site's theme on every device (Android draws native
// options white-on-grey).
//
// On a phone a list spans the whole chip row (the row is the positioning
// box); from sm up it opens under its own chip.

import { useEffect, useId, useRef, useState } from "react";

// Touch screens get 44 px tall targets (pointer-coarse:), the size a finger
// needs; with a mouse the pills stay compact.
const PILL = "flex items-center rounded-full border text-sm whitespace-nowrap transition-colors";
const PILL_OFF = "border-line bg-surface hover:border-foreground/40";
const PILL_ON = "border-foreground bg-foreground text-background";

export function ChipMenu({
  label,
  selected,
  onClear,
  children,
}: {
  /** What the chip filters by, shown while nothing is chosen. */
  label: string;
  /** The chosen value's label, or null. */
  selected: string | null;
  onClear: () => void;
  /** The list. Picking any option (role="option") closes it. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /** Set by a pick or Escape: focus goes back to the chip on close. Not by
   *  a click elsewhere, which chose where focus goes. */
  const restoreFocus = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      restoreFocus.current = true;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    buttonRef.current?.focus();
  }, [open]);

  /** A click or Enter/Space on an option is a pick: close the list. */
  const onPicked = (e: React.SyntheticEvent) => {
    if (!(e.target as Element).closest('[role="option"]')) return;
    if (e.type === "keydown" && !["Enter", " "].includes((e as React.KeyboardEvent).key)) return;
    restoreFocus.current = true;
    setOpen(false);
  };

  return (
    <div ref={ref} className="sm:relative">
      <div className={`${PILL} ${selected ? PILL_ON : PILL_OFF}`}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-label={selected ? `${label}: ${selected}` : label}
          className="flex items-center gap-1.5 py-1.5 ps-3 pe-2 pointer-coarse:min-h-11"
        >
          <span className="max-w-[12rem] truncate">{selected ?? label}</span>
          {!selected && (
            <span aria-hidden="true" className="text-xs opacity-60">
              {open ? "▴" : "▾"}
            </span>
          )}
        </button>
        {selected && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`إزالة ${label}`}
            className="flex items-center justify-center py-1.5 pe-3 ps-1 opacity-80 hover:opacity-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div
          id={`${id}-list`}
          onClick={onPicked}
          onKeyDown={onPicked}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-line bg-surface py-1 text-foreground shadow-lg sm:inset-x-auto sm:start-0 sm:w-max sm:min-w-56 sm:max-w-[min(24rem,calc(100vw-2rem))]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A filter that is simply on or off, such as «يبحث عن عمل». */
export function ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`${PILL} ${on ? PILL_ON : PILL_OFF} gap-1.5 px-3 py-1.5 pointer-coarse:min-h-11`}
    >
      {on && <span aria-hidden="true">✓</span>}
      {label}
    </button>
  );
}

export function MenuList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ul role="listbox" aria-label={label}>
      {children}
    </ul>
  );
}

/** A heading inside a list (a kind of workplace), not itself a choice. */
export function MenuGroup({ title }: { title: string }) {
  return (
    <li role="presentation" className="px-3 pb-1 pt-3 text-xs font-semibold text-muted">
      {title}
    </li>
  );
}

export function MenuOption({
  label,
  hint,
  selected,
  nested,
  heading,
  onPick,
}: {
  label: string;
  /** A count or note after the label. */
  hint?: string | number;
  selected: boolean;
  /** Drawn under its parent with a guide line (a subspecialty). */
  nested?: boolean;
  /** Has options nested under it. */
  heading?: boolean;
  onPick: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      className={
        "flex cursor-pointer items-baseline justify-between gap-3 px-3 outline-none hover:bg-foreground/5 focus-visible:bg-foreground/10 " +
        (nested ? "py-1.5 ps-6 text-sm text-muted " : "py-2.5 text-base ") +
        (heading ? "font-semibold " : "") +
        (selected ? "bg-foreground/10 text-foreground" : "")
      }
    >
      {nested ? <span className="block border-s-2 border-line ps-3">{label}</span> : <span>{label}</span>}
      {hint !== undefined && <span className="text-xs text-muted tabular-nums">{hint}</span>}
    </li>
  );
}
