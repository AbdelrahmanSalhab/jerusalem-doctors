"use client";

// The admin panel's tab row. A tab can group pages: it is lit on any of them,
// and a second row of pills under the tabs names each one. A row that does not
// fit scrolls sideways instead of wrapping, so the tabs that carry a count are
// listed first.
//
// useSearchParams is safe here: the admin layout is dynamic, never prerendered.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export interface NavChild {
  /** May carry a query (`/admin/audit?action=alert`): the pill is lit only while it is in the address. */
  href: string;
  label: string;
  badge?: number;
  badgeLabel?: string;
}

export interface NavTab {
  /** Where the tab goes; for a group, the page that most needs a look. */
  href: string;
  label: string;
  /** A small count after the label (e.g. doctors waiting for approval). */
  badge?: number;
  /** What the badge counts, for screen readers. */
  badgeLabel?: string;
  /** Match only this exact path (for a section root like /admin). */
  exact?: boolean;
  /** The pages this tab groups, shown as pills while the tab is open. */
  children?: NavChild[];
}

const pathOf = (href: string) => href.split("?")[0];

/** A big count would crowd the tab on a phone. */
const shown = (n: number) => (n > 99 ? "99+" : String(n));

function Badge({ n, label }: { n?: number; label?: string }) {
  if (!n) return null;
  return (
    <span className="ms-1.5 rounded-full border border-warn-line bg-warn-bg px-1.5 text-xs font-semibold text-warn">
      <span aria-hidden="true">{shown(n)}</span>
      <span className="sr-only">{` (${label ?? `${n} بانتظار المراجعة`})`}</span>
    </span>
  );
}

/** The one pill that is lit: among those whose path matches and whose every
 *  query pair is in the address, the one that names the most pairs. */
function activeChild(children: NavChild[], path: string, params: URLSearchParams): NavChild | undefined {
  let best: { child: NavChild; score: number } | undefined;
  for (const child of children) {
    if (pathOf(child.href) !== path) continue;
    const wanted = [...new URLSearchParams(child.href.split("?")[1] ?? "")];
    if (!wanted.every(([k, v]) => params.get(k) === v)) continue;
    if (!best || wanted.length > best.score) best = { child, score: wanted.length };
  }
  return best?.child;
}

export function NavTabs({ tabs, label }: { tabs: NavTab[]; label: string }) {
  const path = usePathname();
  const params = useSearchParams();
  const inside = (href: string) => path === pathOf(href) || path.startsWith(pathOf(href) + "/");
  const active = (t: NavTab) => (t.children ? t.children.some((c) => inside(c.href)) : t.exact ? path === t.href : inside(t.href));
  const open = tabs.find(active);
  const lit = open?.children && activeChild(open.children, path, params);

  return (
    <>
      <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <Link
            key={t.label}
            // Open already: it goes to the page the admin is on (or the group's first), not wherever the counts would send a visitor.
            href={active(t) && t.children ? (lit?.href ?? t.children[0].href) : t.href}
            // A group is "true", not "page": the pill under it carries the page.
            aria-current={active(t) ? (t.children ? "true" : "page") : undefined}
            className={
              "shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm transition-colors pointer-coarse:py-3 sm:px-3 " +
              (active(t) ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground")
            }
          >
            {t.label}
            <Badge n={t.badge} label={t.badgeLabel} />
          </Link>
        ))}
      </nav>
      {open?.children && (
        <nav aria-label={`${open.label}: صفحات القسم`} className="flex flex-wrap gap-1.5 border-t border-line bg-background/40 px-1 py-2">
          {open.children.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              aria-current={c === lit ? "page" : undefined}
              className={
                "whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors pointer-coarse:py-3 " +
                (c === lit ? "border-foreground bg-foreground/5 font-semibold" : "border-line bg-surface text-muted hover:border-foreground/40 hover:text-foreground")
              }
            >
              {c.label}
              <Badge n={c.badge} label={c.badgeLabel} />
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
