// Layout primitives shared by the admin screens. Server components: plain
// markup, no client JS. /admin/stats grew them first; the doctors list uses
// the same ones so the two screens read as one panel.

import Link from "next/link";

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-foreground/60">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export function Tile({
  label,
  value,
  sub,
  href,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  sub?: string;
  href?: string;
  tone?: "plain" | "warn";
}) {
  const body = (
    <>
      <span className="text-sm text-foreground/65">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-foreground/60">{sub}</span>}
    </>
  );
  const cls =
    "flex flex-col gap-0.5 rounded-lg border p-3 " +
    (tone === "warn" ? "border-warn-line bg-warn-bg text-warn" : "border-line bg-surface");
  return href ? (
    <Link href={href} className={cls + " hover:border-foreground/40"}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}

/** Rows of label, count, share of `total`, and a bar to scale. */
