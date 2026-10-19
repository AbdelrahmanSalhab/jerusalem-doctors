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

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function DoctorPanel({
  closeHref,
  title,
  children,
}: {
  closeHref: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);

  const close = () => router.push(closeHref, { scroll: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-panel-title"
        className="fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto border-s border-line bg-surface shadow-lg"
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
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            إغلاق
          </button>
        </div>
        <div className="flex flex-col gap-5 px-4 py-4">{children}</div>
      </div>
    </>
  );
}
