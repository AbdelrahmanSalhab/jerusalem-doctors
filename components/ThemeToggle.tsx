"use client";

// Cycles the theme: تلقائي (the device's setting) → فاتح → داكن.

import { useEffect, useState } from "react";
import { THEME_KEY, THEMES, type ThemeChoice } from "@/lib/theme";

const LABEL: Record<ThemeChoice, string> = { auto: "تلقائي", light: "فاتح", dark: "داكن" };
const ICON: Record<ThemeChoice, string> = { auto: "◐", light: "☀", dark: "☾" };

function apply(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("auto");

  useEffect(() => {
    // Read after mount: the server can't know this device's choice.
    try {
      const saved = localStorage.getItem(THEME_KEY) as ThemeChoice | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && THEMES.includes(saved)) setChoice(saved);
    } catch {
      // storage blocked: stay on auto
    }
  }, []);

  const next = () => {
    const n = THEMES[(THEMES.indexOf(choice) + 1) % THEMES.length];
    setChoice(n);
    try {
      if (n === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, n);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    apply(n);
  };

  return (
    <button
      type="button"
      onClick={next}
      className={className}
      aria-label={`المظهر: ${LABEL[choice]}. اضغط للتغيير`}
      title={`المظهر: ${LABEL[choice]}`}
    >
      <span aria-hidden="true">{ICON[choice]}</span>
      <span className="ms-1.5 hidden sm:inline">{LABEL[choice]}</span>
    </button>
  );
}
