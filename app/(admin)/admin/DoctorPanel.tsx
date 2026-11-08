"use client";

// The slide-over that holds one doctor's details. A sheet over the list on a
// phone, a panel on the inner edge on a desktop.
//
// Its contents are server-rendered and come in as children, so a save
// followed by router.refresh() updates the panel and the row behind it
// together, with no second fetch and no duplicate loading state.
//
// Closing is a navigation back to the list URL, which means the browser's
// Back button closes it too.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** The read-only record fits a narrow sheet; the profile editor's workplace
 *  rows do not. */
const STEP = "rounded-md border border-line px-3 py-1.5 text-sm hover:bg-foreground/5 pointer-coarse:py-3";

const WIDTH = { md: "max-w-xl", lg: "max-w-3xl" } as const;

export function DoctorPanel({
  closeHref,
  title,
  width = "md",
  prevHref,
  nextHref,
  position,
  children,
}: {
  closeHref: string;
  title: string;
  width?: keyof typeof WIDTH;
  /** The doctors either side in the list behind the panel, to go through it without closing. */
  prevHref?: string;
  nextHref?: string;
  /** "3 of 9": where this doctor is in that list. */
  position?: { n: number; of: number };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const close = () => router.push(closeHref, { scroll: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      // Tab stays in the panel: the list behind it is covered, and not for a keyboard to wander into.
      if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const here = document.activeElement;
        if (e.shiftKey && (here === first || here === box.current || !box.current.contains(here))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (here === last || !box.current.contains(here))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeHref]);

  // Locking the page behind the sheet, and always giving it back: a mobile
  // admin left with a frozen page would have no way out.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Stepping to the next doctor reuses this panel: start them at the top, where
  // the licence check is, not wherever the last one was scrolled to.
  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
  }, [title]);

  // Focus starts on the heading so a keyboard or screen-reader user lands
  // inside the panel rather than back at the top of the list.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        className="fixed inset-0 z-40 bg-foreground/40"
      />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-panel-title"
        className={
          "fixed inset-y-0 end-0 z-50 flex w-full flex-col overflow-y-auto overscroll-contain border-s border-line bg-surface shadow-lg " +
          WIDTH[width]
        }
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
          <h2
            id="doctor-panel-title"
            ref={heading}
            tabIndex={-1}
            className="truncate text-lg font-semibold outline-none"
          >
            {title}
          </h2>
          {/* Said when the panel moves on to another doctor (focus stays on the link, for the next press). */}
          <p role="status" className="sr-only">
            {title}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {position && (
              <span className="px-1 text-sm tabular-nums text-muted">
                {position.n} من {position.of}
              </span>
            )}
            {prevHref && (
              <Link href={prevHref} scroll={false} className={STEP}>
                السابق
              </Link>
            )}
            {nextHref && (
              <Link href={nextHref} scroll={false} className={STEP}>
                التالي
              </Link>
            )}
            <button type="button" onClick={close} className={STEP + " ms-2"}>
              إغلاق
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-5 px-4 py-4">{children}</div>
      </div>
    </>
  );
}
