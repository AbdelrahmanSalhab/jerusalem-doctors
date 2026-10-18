"use client";

// Shown above the submit button while anything required is still empty, so
// the doctor sees what is left before pressing it instead of after. Each
// item jumps to its field.

import type { MissingField } from "@/lib/signup/missingFields";

export function MissingFieldsNotice({ missing }: { missing: readonly MissingField[] }) {
  if (missing.length === 0) return null;

  const focus = (key: string) => {
    const el = document.getElementById(key);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  };

  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="mb-2 font-medium">أكمل الحقول التالية لتفعيل زر التسجيل:</p>
      <ul className="flex flex-wrap gap-2">
        {missing.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              onClick={() => focus(m.key)}
              className="rounded-full border border-amber-400 px-3 py-1 underline-offset-2 hover:underline dark:border-amber-600"
            >
              {m.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
