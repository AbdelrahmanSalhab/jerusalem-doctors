"use client";

// A row of page links that marks the current one and scrolls sideways on a
// narrow screen instead of wrapping. Used by the site header and the admin
// panel.

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavTab {
  href: string;
  label: string;
  /** A small count after the label (e.g. doctors waiting for approval). */
  badge?: number;
  /** What the badge counts, for screen readers. */
  badgeLabel?: string;
  /** Match only this exact path (for a section root like /admin). */
  exact?: boolean;
}

export function NavTabs({ tabs, label }: { tabs: NavTab[]; label: string }) {
  const path = usePathname();
  const active = (t: NavTab) => (t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/"));
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t) ? "page" : undefined}
          className={
            "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors " +
            (active(t)
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-muted hover:text-foreground")
          }
        >
          {t.label}
          {t.badge ? (
            <span
              className="ms-1.5 rounded-full bg-warn-solid px-1.5 text-xs font-semibold text-white"
              aria-label={t.badgeLabel ?? `${t.badge} بانتظار المراجعة`}
            >
              {t.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
