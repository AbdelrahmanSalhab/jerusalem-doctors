"use client";

// The dashboard's «أكمل ملفك» note. Everything in it is optional, so it can be
// closed, and stays closed on this browser until the list of gaps changes
// (lib/profile/reminders). Hidden until the saved choice is read, so a doctor
// who closed it never sees it flash back.

import Link from "next/link";
import { useEffect, useState } from "react";
import { gapsKey } from "@/lib/profile/reminders";

const CLOSED_KEY = "profileReminderClosed";

export function ProfileReminder({ gaps }: { gaps: string[] }) {
  const key = gapsKey(gaps);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let closedOn: string | null = null;
    try {
      closedOn = localStorage.getItem(CLOSED_KEY);
    } catch {
      // Storage refused: show it, it just won't be remembered.
    }
    // Browser-only fact (storage): read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(closedOn !== key);
  }, [key]);

  if (!open) return null;

  const close = () => {
    try {
      localStorage.setItem(CLOSED_KEY, key);
    } catch {
      // Closed for this visit only.
    }
    setOpen(false);
  };

  return (
    <section
      aria-label="أكمل ملفك"
      className="relative flex flex-col gap-2 rounded-md border border-info-line bg-info-bg p-4 pe-12 text-sm text-info sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        onClick={close}
        aria-label="إغلاق"
        className="absolute end-1 top-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-foreground/10 pointer-coarse:h-11 pointer-coarse:w-11"
      >
        ✕
      </button>
      <div>
        <p className="font-semibold">أكمل ملفك ليسهل على الزملاء الوصول إليك</p>
        <ul className="mt-1 list-disc ps-5">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
      <Link
        href="/profile"
        className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-primary-fg hover:opacity-90 pointer-coarse:min-h-11"
      >
        إكمال الملف
      </Link>
    </section>
  );
}
