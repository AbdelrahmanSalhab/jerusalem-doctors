// Building blocks for /admin/stats. Server components: plain markup and CSS
// bars, no chart library.

import Link from "next/link";
import { type NamedCount, pct } from "@/lib/adminStats";

export { Section, Tile, TileGrid } from "@/components/AdminParts";

export function BarList({
  items,
  total,
  empty = "لا بيانات بعد.",
}: {
  items: NamedCount[];
  total: number;
  empty?: string;
}) {
  if (items.length === 0 || total === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={it.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={it.name}>
            {it.name}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
            <span
              className="block h-full rounded-full bg-foreground/70"
              style={{ width: `${Math.min(100, (it.count * 100) / total)}%` }}
            />
          </span>
          <span className="tabular-nums text-muted">
            {it.count} · {pct(it.count, total)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One bar per day, to the busiest day's scale. */
export function DailyBars({
  days,
  label,
}: {
  days: { day: string; value: number }[];
  label: string;
}) {
  const peak = Math.max(0, ...days.map((d) => d.value));
  // Scale to at least 1 so an empty month draws flat bars, not NaN heights.
  const max = Math.max(1, peak);
  const total = days.reduce((n, d) => n + d.value, 0);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm text-muted">
        {label}: <span className="tabular-nums font-semibold text-foreground">{total}</span> في 30 يومًا
        (أعلى يوم {peak})
      </figcaption>
      <div className="flex h-28 items-end gap-0.5" dir="ltr" role="img" aria-label={`${label}، آخر 30 يومًا`}>
        {days.map((d) => (
          <span
            key={d.day}
            title={`${d.day}: ${d.value}`}
            className="flex-1 rounded-t-sm bg-foreground/70"
            style={{ height: `${(d.value * 100) / max}%`, minHeight: d.value > 0 ? 3 : 1, opacity: d.value > 0 ? 1 : 0.25 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted" dir="ltr">
        <span>{days[0]?.day}</span>
        <span>{days.at(-1)?.day}</span>
      </div>
    </figure>
  );
}

/** A "needs attention" row: what, how many, where to act. */
export function Attention({
  count,
  text,
  href,
}: {
  count: number;
  text: string;
  href?: string;
}) {
  if (count === 0) return null;
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-warn-line py-2 last:border-b-0">
      <span>
        <span className="me-2 font-bold tabular-nums">{count}</span>
        {text}
      </span>
      {href && (
        <Link href={href} className="shrink-0 text-sm underline">
          عرض
        </Link>
      )}
    </li>
  );
}
